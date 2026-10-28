// 발주 알림센터(PC 프로그램) 서버 API + 거래처 주문 확정 흐름 end-to-end 점검
// CI 에서 vite preview(로컬 Worker + 로컬 D1) 대상으로 실행:  node tests/desk-e2e.mjs http://localhost:4173
import { execFileSync } from "node:child_process";
import { pbkdf2Sync, randomBytes, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";

const BASE = (process.argv[2] || "http://localhost:4173").replace(/\/$/, "");
const results = [];
let failed = 0;

function check(name, ok, detail = "") {
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `  — ${detail}` : ""}`);
  if (!ok) failed += 1;
  console.log(results[results.length - 1]);
}

function j(value, length = 200) {
  return String(JSON.stringify(value) ?? "").slice(0, length);
}

function sql(command) {
  const out = execFileSync("npx", ["wrangler", "d1", "execute", "bujafood-db", "--local", "--json", "--command", command], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const parsed = JSON.parse(out);
    return parsed?.[0]?.results ?? [];
  } catch {
    return [];
  }
}

function kstDate(offset = 0) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(Date.now() + offset * 86400000));
}

class Client {
  constructor() { this.cookies = new Map(); this.token = ""; }
  async json(path, init = {}) {
    const headers = new Headers(init.headers || {});
    if (this.cookies.size) headers.set("cookie", [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "));
    if (this.token) headers.set("authorization", `Bearer ${this.token}`);
    if (init.method && init.method !== "GET" && init.origin !== false) headers.set("origin", BASE);
    let body;
    if (init.json !== undefined) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(init.json);
    }
    const res = await fetch(BASE + path, { method: init.method || "GET", headers, body, redirect: "manual" });
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(";");
      const idx = pair.indexOf("=");
      const key = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (!value || /max-age=0/i.test(raw)) this.cookies.delete(key); else this.cookies.set(key, value);
    }
    let data = null;
    try { data = await res.json(); } catch {}
    return { status: res.status, body: data };
  }
}

function setStaffPin(username, pin) {
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(pin, salt, 100000, 32, "sha256").toString("hex");
  sql(`UPDATE staff_users SET auth_salt='${salt}', auth_hash='${hash}', active=1 WHERE username='${username}'`);
}

async function main() {
  const anon = new Client();
  for (let i = 0; i < 30; i += 1) {
    const r = await anon.json("/api/customer/status");
    if (r.status === 200) break;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  /* ---------- 1. 인증 없이 알림센터 API 차단 ---------- */
  for (const path of ["/api/desk/pulse", "/api/desk/orders", "/api/desk/orders?scope=history"]) {
    const r = await anon.json(path);
    check(`비로그인 ${path} → 401`, r.status === 401, `status ${r.status}`);
  }
  const fakeToken = new Client();
  fakeToken.token = "f".repeat(64);
  check("가짜 토큰 → 401", (await fakeToken.json("/api/desk/orders")).status === 401);
  const postAnon = await anon.json("/api/desk/orders", { method: "POST", json: { action: "done", orderId: "X" } });
  check("비로그인 상태변경 → 401", postAnon.status === 401, `status ${postAnon.status}`);

  /* ---------- 2. 직원 로그인 (PIN) ---------- */
  setStaffPin("lee", "246813");
  setStaffPin("jung", "135792");
  const staffRows = sql("SELECT id, username, active, length(auth_hash) AS hash_len FROM staff_users WHERE username IN ('lee','jung')");
  check("테스트 직원 PIN 설정 (로컬 D1)", staffRows.length === 2, j(staffRows));
  const pcA = new Client();
  const wrongPin = await pcA.json("/api/desk/login", { method: "POST", origin: false, json: { username: "lee", pin: "000000", deviceName: "CI-A" } });
  check("틀린 PIN → 401", wrongPin.status === 401 && !wrongPin.body?.token, JSON.stringify(wrongPin.body));
  const loginA = await pcA.json("/api/desk/login", { method: "POST", origin: false, json: { username: "lee", pin: "246813", deviceName: "CI-A" } });
  pcA.token = loginA.body?.token ?? "";
  check("직원 lee 로그인(PC A) → 토큰 발급", loginA.status === 200 && /^[0-9a-f]{64}$/.test(pcA.token), JSON.stringify(loginA.body));
  check("로그인 응답에 쿠키 없음(토큰은 헤더 전용)", pcA.cookies.size === 0);
  const stored = sql("SELECT token_hash FROM desk_sessions WHERE device_name='CI-A'");
  check("서버에는 토큰 원문이 아닌 해시만 저장", stored.length > 0 && stored.every((r) => r.token_hash !== pcA.token), j(stored, 120));
  const pcB = new Client();
  const loginB = await pcB.json("/api/desk/login", { method: "POST", origin: false, json: { username: "jung", pin: "135792", deviceName: "CI-B" } });
  pcB.token = loginB.body?.token ?? "";
  check("직원 jung 로그인(PC B)", loginB.status === 200 && pcB.token.length === 64, JSON.stringify(loginB.body));

  const pulse0 = await pcA.json("/api/desk/pulse");
  check("pulse → 직원 정보 + marker", pulse0.status === 200 && pulse0.body?.staff?.username === "lee" && pulse0.body?.marker?.length === 64, JSON.stringify(pulse0.body));

  /* ---------- 3. 거래처 주문 확정 (중복 방지 키) ---------- */
  const customer = new Client();
  const cl = await customer.json("/api/customer/login", { method: "POST", json: { identifier: "12013", password: "12013" } });
  check("거래처 12013 로그인", cl.status === 200, JSON.stringify(cl.body));
  const store = await customer.json("/api/store");
  const sellable = (store.body?.products ?? []).filter((p) => !p.soldout && (p.packOptions ?? []).length).slice(5, 8);
  const items = sellable.map((p) => ({ productId: p.id, optionLabel: p.packOptions[0].label, quantity: p.packOptions[0].step || 1 }));
  const tomorrow = kstDate(1);
  const requestId = randomUUID();
  const payload = { items, note: "CI 요청사항: 오전 도착", requestId, deliveryDate: tomorrow, confirmAnomaly: true };
  const first = await customer.json("/api/orders", { method: "POST", json: payload });
  const orderId = first.body?.order?.id;
  check("주문 확정 → 서버 저장 + 주문번호", first.status === 200 && Boolean(orderId) && first.body.order.duplicate === false, j(first.body, 200));
  check("배송일 저장", first.body?.order?.deliveryDate === tomorrow, first.body?.order?.deliveryDate);
  const again = await customer.json("/api/orders", { method: "POST", json: payload });
  check("같은 키로 재전송 → 같은 주문 반환(중복 생성 없음)", again.status === 200 && again.body?.order?.id === orderId && again.body.order.duplicate === true, j(again.body, 200));
  const parallel = await Promise.all([1, 2, 3].map(() => customer.json("/api/orders", { method: "POST", json: { ...payload, requestId: `par-${requestId}` } })));
  const parallelIds = new Set(parallel.map((r) => r.body?.order?.id).filter(Boolean));
  check("같은 키 동시 3회 → 주문 1건", parallelIds.size === 1 && parallel.every((r) => r.status === 200), JSON.stringify(parallel.map((r) => [r.status, r.body?.order?.id, r.body?.error])));
  const dbCount = sql(`SELECT COUNT(*) AS n FROM orders WHERE client_request_id IN ('${requestId}','par-${requestId}')`);
  check("D1 저장 확인: 키당 주문 1건씩(총 2건)", Number(dbCount[0]?.n) === 2, JSON.stringify(dbCount));
  const dbItems = sql(`SELECT COUNT(*) AS n FROM order_items WHERE order_id='${orderId}'`);
  check("D1 품목 저장 확인", Number(dbItems[0]?.n) === items.length, JSON.stringify(dbItems));
  const pastDate = await customer.json("/api/orders", { method: "POST", json: { ...payload, requestId: randomUUID(), deliveryDate: kstDate(-1) } });
  check("지난 배송일 거절", pastDate.status === 400, `${pastDate.status}`);
  const badLocation = await customer.json("/api/orders", { method: "POST", json: { ...payload, requestId: randomUUID(), deliveryLocationId: "DL-NOT-MINE" } });
  check("내 배송처가 아닌 곳 거절", badLocation.status === 400, `${badLocation.status}`);
  const badKey = await customer.json("/api/orders", { method: "POST", json: { ...payload, requestId: "bad key!" } });
  check("잘못된 요청 키 거절", badKey.status === 400, `${badKey.status}`);
  const anonOrder = await anon.json("/api/orders", { method: "POST", json: payload });
  check("비로그인 주문 → 401", anonOrder.status === 401);

  /* ---------- 4. 알림센터에 신규 주문 표시 ---------- */
  const pulse1 = await pcA.json("/api/desk/pulse");
  check("주문 후 pulse marker 변경", pulse1.body?.marker && pulse1.body.marker !== pulse0.body?.marker);
  const openA = await pcA.json("/api/desk/orders");
  const mine = (openA.body?.orders ?? []).find((o) => o.id === orderId);
  check("PC A 목록에 신규 주문 표시", openA.status === 200 && Boolean(mine), `count ${openA.body?.orders?.length}`);
  check("상세: 거래처/배송일/구분/품목/요청사항", mine && mine.customerCode === "00124" && mine.deliveryDate === tomorrow
    && ["AM", "PM"].includes(mine.orderPeriod) && mine.items.length === items.length && mine.note.includes("오전 도착")
    && mine.items.every((i) => i.productName && i.unit && i.quantity > 0) && mine.desk.state === "new", j(mine, 400));
  const second = (openA.body?.orders ?? []).find((o) => o.id === [...parallelIds][0]);
  check("같은 배송일 두 번째 주문은 추가발주 표시", second?.isAdditional === true && mine?.isAdditional === false, JSON.stringify({ first: mine?.isAdditional, second: second?.isAdditional }));
  const since = sql("SELECT value FROM app_settings WHERE key='desk_tracking_since'")[0]?.value ?? "";
  const sinceIso = `${since.replace(" ", "T")}Z`;
  check("알림센터 도입 시각 이후 주문만 표시", Boolean(since) && (openA.body?.orders ?? []).every((o) => o.createdAt >= sinceIso), since);

  /* ---------- 5. 입력 시작 / 다른 PC 동기화 / 충돌 ---------- */
  const startA = await pcA.json("/api/desk/orders", { method: "POST", origin: false, json: { action: "start", orderId } });
  check("PC A 입력 시작", startA.status === 200 && startA.body?.order?.desk?.state === "entering" && startA.body.order.desk.enteringBy.length > 0, j(startA.body, 200));
  const seenB = (await pcB.json("/api/desk/orders")).body?.orders?.find((o) => o.id === orderId);
  check("PC B 에서도 '입력 중(lee)' 으로 보임", seenB?.desk?.state === "entering" && seenB.desk.enteringById === "S-LEE", JSON.stringify(seenB?.desk));
  const startB = await pcB.json("/api/desk/orders", { method: "POST", origin: false, json: { action: "start", orderId } });
  check("PC B 동시 입력 시작 → 409 충돌", startB.status === 409 && startB.body?.conflict === true, j(startB.body, 200));
  const doneB = await pcB.json("/api/desk/orders", { method: "POST", origin: false, json: { action: "done", orderId } });
  check("PC B 가 남의 입력 중 주문 완료 → 409", doneB.status === 409, `${doneB.status}`);
  const race = await Promise.all([
    pcA.json("/api/desk/orders", { method: "POST", origin: false, json: { action: "start", orderId: [...parallelIds][0] } }),
    pcB.json("/api/desk/orders", { method: "POST", origin: false, json: { action: "start", orderId: [...parallelIds][0] } }),
  ]);
  check("두 PC 동시에 입력 시작 → 한 명만 성공", race.filter((r) => r.status === 200).length === 1 && race.filter((r) => r.status === 409).length === 1, JSON.stringify(race.map((r) => r.status)));

  /* ---------- 6. 입력완료 ---------- */
  const doneA = await pcA.json("/api/desk/orders", { method: "POST", origin: false, json: { action: "done", orderId } });
  check("PC A 입력완료 + 처리자/시간 기록", doneA.status === 200 && doneA.body?.order?.desk?.state === "done" && doneA.body.order.desk.doneBy && doneA.body.order.desk.doneAt, JSON.stringify(doneA.body?.order?.desk));
  const doneAgain = await pcB.json("/api/desk/orders", { method: "POST", origin: false, json: { action: "done", orderId } });
  check("이미 완료된 주문 다시 완료 → 성공(alreadyDone)", doneAgain.status === 200 && doneAgain.body?.alreadyDone === true, j(doneAgain.body, 160));
  const openB = await pcB.json("/api/desk/orders");
  check("입력완료 주문은 처리할 목록에서 빠짐 (PC B)", !(openB.body?.orders ?? []).some((o) => o.id === orderId));
  const history = await pcB.json(`/api/desk/orders?scope=history&from=${kstDate(0)}&to=${kstDate(0)}`);
  const inHistory = (history.body?.orders ?? []).find((o) => o.id === orderId);
  check("처리내역(오늘 접수)에 보관 + 처리자", inHistory?.desk?.state === "done" && inHistory.desk.doneById === "S-LEE", JSON.stringify(inHistory?.desk));
  const search = await pcB.json(`/api/desk/orders?scope=history&state=all&q=${encodeURIComponent("태승")}`);
  check("처리내역 검색(거래처명)", (search.body?.orders ?? []).some((o) => o.id === orderId), `count ${search.body?.orders?.length}`);
  const byDelivery = await pcB.json(`/api/desk/orders?scope=history&state=all&dateField=delivery&from=${tomorrow}&to=${tomorrow}`);
  check("처리내역 배송일 필터", (byDelivery.body?.orders ?? []).some((o) => o.id === orderId) && (byDelivery.body?.orders ?? []).every((o) => o.deliveryDate === tomorrow));
  const reopen = await pcB.json("/api/desk/orders", { method: "POST", origin: false, json: { action: "reopen", orderId } });
  check("입력완료 취소 → 다시 신규", reopen.status === 200 && reopen.body?.order?.desk?.state === "new");
  const finish = await pcB.json("/api/desk/orders", { method: "POST", origin: false, json: { action: "done", orderId } });
  check("PC B 입력완료(신규에서 바로)", finish.status === 200 && finish.body?.order?.desk?.doneById === "S-JUNG");
  const takeover = await pcB.json("/api/desk/orders", { method: "POST", origin: false, json: { action: "done", orderId: [...parallelIds][0], force: true } });
  check("남이 입력 중인 주문 이어받아 완료(force)", takeover.status === 200 && takeover.body?.order?.desk?.state === "done", j(takeover.body, 160));
  const audit = sql(`SELECT COUNT(*) AS n FROM audit_logs WHERE entity_id='${orderId}' AND action LIKE 'desk_%'`);
  check("처리 기록(audit) 남음", Number(audit[0]?.n) >= 4, JSON.stringify(audit));

  /* ---------- 7. 취소/수정 감지 ---------- */
  const third = await customer.json("/api/orders", { method: "POST", json: { ...payload, requestId: randomUUID(), deliveryDate: kstDate(2) } });
  const thirdId = third.body?.order?.id;
  const before = (await pcA.json("/api/desk/orders")).body?.orders?.find((o) => o.id === thirdId);
  const cancel = await customer.json("/api/orders", { method: "DELETE", json: { orderId: thirdId } });
  check("거래처 15분 내 취소", cancel.status === 200, JSON.stringify(cancel.body));
  const after = (await pcA.json("/api/desk/orders")).body?.orders?.find((o) => o.id === thirdId);
  check("취소된 주문은 '취소 확인' 전까지 목록에 남음", after?.cancelled === true && after.contentVersion !== before?.contentVersion, JSON.stringify({ before: before?.contentVersion, after: after?.contentVersion }));
  const ack = await pcA.json("/api/desk/orders", { method: "POST", origin: false, json: { action: "done", orderId: thirdId } });
  check("취소 확인 → 목록에서 제거", ack.status === 200 && !((await pcA.json("/api/desk/orders")).body?.orders ?? []).some((o) => o.id === thirdId));

  /* ---------- 8. 권한 해제 ---------- */
  const logoutB = await pcB.json("/api/desk/logout", { method: "POST", origin: false, json: {} });
  check("PC B 로그아웃", logoutB.status === 200);
  check("로그아웃한 토큰 → 401", (await pcB.json("/api/desk/pulse")).status === 401);
  sql("UPDATE staff_users SET active=0 WHERE username='lee'");
  check("직원 계정 중지 → 해당 PC 토큰 즉시 401", (await pcA.json("/api/desk/pulse")).status === 401);
  sql("UPDATE staff_users SET active=1 WHERE username='lee'");
  check("계정 다시 사용 → 토큰 다시 유효", (await pcA.json("/api/desk/pulse")).status === 200);

  /* ---------- 9. 관리자 화면에 알림센터 기능 없음 ---------- */
  const adminHtml = await (await fetch(`${BASE}/admin`)).text();
  check("관리자 화면에 발주 알림센터 기능 추가 안 됨", !adminHtml.includes("알림센터") && !adminHtml.includes("/api/desk"));

  // Python(PC 프로그램) 통합 테스트용 계정/주문 정보 전달
  writeFileSync("desk-e2e.json", JSON.stringify({ base: BASE, staff: [{ username: "lee", pin: "246813" }, { username: "jung", pin: "135792" }] }));

  console.log("\n================ SUMMARY ================");
  console.log(results.join("\n"));
  console.log(`\n${results.length - failed}/${results.length} passed`);
  writeFileSync("desk-summary.txt", `${results.length - failed}/${results.length} passed\n${results.join("\n")}\n`);
  if (failed) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  writeFileSync("desk-summary.txt", `CRASH ${String(error?.stack || error).slice(0, 1500)}\n${results.join("\n")}\n`);
  process.exit(1);
});
