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

// CI 전용 직원 계정 (사무실 직원 2명 역할)
function upsertStaff(id, username, displayName, pin, role = "ADMIN") {
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(pin, salt, 100000, 32, "sha256").toString("hex");
  sql(`INSERT INTO staff_users(id,username,display_name,role,auth_salt,auth_hash,active) VALUES('${id}','${username}','${displayName}','${role}','${salt}','${hash}',1)
       ON CONFLICT(id) DO UPDATE SET auth_salt=excluded.auth_salt, auth_hash=excluded.auth_hash, active=1`);
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
  upsertStaff("S-CI-DESK-A", "cidesk1", "사무실직원A", "246813");
  upsertStaff("S-CI-DESK-B", "cidesk2", "사무실직원B", "135792");
  const staffRows = sql("SELECT id, username, active, length(auth_hash) AS hash_len FROM staff_users WHERE id LIKE 'S-CI-DESK-%'");
  check("테스트 직원 2명 준비 (로컬 D1)", staffRows.length === 2, j(staffRows));
  const pcA = new Client();
  const wrongPin = await pcA.json("/api/desk/login", { method: "POST", origin: false, json: { username: "cidesk1", pin: "000000", deviceName: "CI-A" } });
  check("틀린 PIN → 401", wrongPin.status === 401 && !wrongPin.body?.token, JSON.stringify(wrongPin.body));
  const loginA = await pcA.json("/api/desk/login", { method: "POST", origin: false, json: { username: "cidesk1", pin: "246813", deviceName: "CI-A" } });
  pcA.token = loginA.body?.token ?? "";
  check("직원A 로그인(PC A) → 토큰 발급", loginA.status === 200 && /^[0-9a-f]{64}$/.test(pcA.token), JSON.stringify(loginA.body));
  check("로그인 응답에 쿠키 없음(토큰은 헤더 전용)", pcA.cookies.size === 0);
  const stored = sql("SELECT token_hash FROM desk_sessions WHERE device_name='CI-A'");
  check("서버에는 토큰 원문이 아닌 해시만 저장", stored.length > 0 && stored.every((r) => r.token_hash !== pcA.token), j(stored, 120));
  const pcB = new Client();
  const loginB = await pcB.json("/api/desk/login", { method: "POST", origin: false, json: { username: "cidesk2", pin: "135792", deviceName: "CI-B" } });
  pcB.token = loginB.body?.token ?? "";
  check("직원B 로그인(PC B)", loginB.status === 200 && pcB.token.length === 64, JSON.stringify(loginB.body));

  const pulse0 = await pcA.json("/api/desk/pulse");
  check("pulse → 직원 정보 + marker", pulse0.status === 200 && pulse0.body?.staff?.username === "cidesk1" && pulse0.body?.marker?.length === 64, JSON.stringify(pulse0.body));

  /* ---------- 3. 거래처 주문 확정 (중복 방지 키) ---------- */
  const customer = new Client();
  const cl = await customer.json("/api/customer/login", { method: "POST", json: { identifier: "12013", password: "12013" } });
  check("거래처 12013 로그인", cl.status === 200, JSON.stringify(cl.body));
  const store = await customer.json("/api/store");
  const sellable = (store.body?.products ?? []).filter((p) => !p.soldout && (p.packOptions ?? []).length).slice(5, 8);
  const items = sellable.map((p) => ({ productId: p.id, optionLabel: p.packOptions[0].label, quantity: p.packOptions[0].step || 1 }));
  const tomorrow = kstDate(1);
  const requestId = randomUUID();
  const payload = { items, note: "CI 요청사항: 오전 도착", requestId, deliveryDate: tomorrow, deliverySlot: "AM", confirmAnomaly: true };
  const first = await customer.json("/api/orders", { method: "POST", json: payload });
  const orderId = first.body?.order?.id;
  check("주문 확정 → 서버 저장 + 주문번호", first.status === 200 && Boolean(orderId) && first.body.order.duplicate === false, j(first.body, 200));
  check("배송일 + 오전 배송 저장", first.body?.order?.deliveryDate === tomorrow && first.body?.order?.deliverySlot === "AM", j(first.body?.order));
  const badSlot = await customer.json("/api/orders", { method: "POST", json: { ...payload, requestId: randomUUID(), deliverySlot: "NIGHT" } });
  check("잘못된 배송 시간 거절", badSlot.status === 400, `${badSlot.status}`);
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
    && mine.items.every((i) => i.productName && i.unit && i.quantity > 0) && mine.desk.state === "new" && mine.deliverySlot === "AM", j(mine, 400));
  const second = (openA.body?.orders ?? []).find((o) => o.id === [...parallelIds][0]);
  check("같은 배송일 두 번째 주문은 추가발주 표시", second?.isAdditional === true && mine?.isAdditional === false, JSON.stringify({ first: mine?.isAdditional, second: second?.isAdditional }));
  const since = sql("SELECT value FROM app_settings WHERE key='desk_tracking_since'")[0]?.value ?? "";
  const sinceIso = `${since.replace(" ", "T")}Z`;
  check("알림센터 도입 시각 이후 주문만 표시", Boolean(since) && (openA.body?.orders ?? []).every((o) => o.createdAt >= sinceIso), since);

  /* ---------- 5. 입력 시작 / 다른 PC 동기화 / 충돌 ---------- */
  const startA = await pcA.json("/api/desk/orders", { method: "POST", origin: false, json: { action: "start", orderId } });
  check("PC A 입력 시작", startA.status === 200 && startA.body?.order?.desk?.state === "entering" && startA.body.order.desk.enteringBy.length > 0, j(startA.body, 200));
  const seenB = (await pcB.json("/api/desk/orders")).body?.orders?.find((o) => o.id === orderId);
  check("PC B 에서도 '입력 중(직원A)' 으로 보임", seenB?.desk?.state === "entering" && seenB.desk.enteringById === "S-CI-DESK-A", JSON.stringify(seenB?.desk));
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
  check("처리내역(오늘 접수)에 보관 + 처리자", inHistory?.desk?.state === "done" && inHistory.desk.doneById === "S-CI-DESK-A", JSON.stringify(inHistory?.desk));
  const search = await pcB.json(`/api/desk/orders?scope=history&state=all&q=${encodeURIComponent("태승")}`);
  check("처리내역 검색(거래처명)", (search.body?.orders ?? []).some((o) => o.id === orderId), `count ${search.body?.orders?.length}`);
  const byDelivery = await pcB.json(`/api/desk/orders?scope=history&state=all&dateField=delivery&from=${tomorrow}&to=${tomorrow}`);
  check("처리내역 배송일 필터", (byDelivery.body?.orders ?? []).some((o) => o.id === orderId) && (byDelivery.body?.orders ?? []).every((o) => o.deliveryDate === tomorrow));
  const reopen = await pcB.json("/api/desk/orders", { method: "POST", origin: false, json: { action: "reopen", orderId } });
  check("입력완료 취소 → 다시 신규", reopen.status === 200 && reopen.body?.order?.desk?.state === "new");
  const finish = await pcB.json("/api/desk/orders", { method: "POST", origin: false, json: { action: "done", orderId } });
  check("PC B 입력완료(신규에서 바로)", finish.status === 200 && finish.body?.order?.desk?.doneById === "S-CI-DESK-B");
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

  /* ---------- 7-1. 휴대폰 화면: 주문 보내기 → 확인 → 주문 확정 ---------- */
  // 앞에서 입력완료한 주문의 '발주 확인' 알림이 화면을 가리지 않게 먼저 닫아 둠 (알림 화면은 7-6 에서 점검)
  {
    const pendingNotices = (await customer.json("/api/customer/notices")).body?.notices ?? [];
    if (pendingNotices.length) await customer.json("/api/customer/notices", { method: "POST", json: { ids: pendingNotices.map((n) => n.id) } });
  }
  try {
    const { chromium, devices } = await import("playwright");
    const browser = await chromium.launch();
    const context = await browser.newContext({ ...devices["Pixel 7"], baseURL: BASE });
    const page = await context.newPage();
    await page.goto("/");
    await page.locator('input[name="username"]').fill("12013");
    await page.locator('input[name="password"]').fill("12013");
    await page.locator('button[type="submit"]').click();
    await page.locator(".od-search input").waitFor({ timeout: 30000 });
    const product = sellable[0];
    async function addOne() {
      await page.locator(".od-search input").fill(product.name);
      const card = page.locator(".od-card", { hasText: product.name }).first();
      await card.waitFor({ timeout: 10000 });
      await card.locator('button[aria-label$="수량 늘리기"]').first().click();
      await page.locator(".od-search input").fill("");
    }
    await page.locator(".od-search input").fill(product.name);
    const priceLocator = page.locator(".od-card", { hasText: product.name }).first().locator(".od-opt-price").first();
    await priceLocator.waitFor({ timeout: 10000 });
    let priceShown = "";
    for (let i = 0; i < 20 && !priceShown; i += 1) {
      priceShown = (await priceLocator.innerText().catch(() => "")).trim();
      if (!priceShown) await page.waitForTimeout(250);
    }
    check("[화면] 상품 카드에 자기 그룹 가격 표시", /원$|가격문의|시세/.test(priceShown), priceShown);
    await page.locator(".od-search input").fill("");
    await addOne();
    await page.locator(".od-cart-icon").click();
    await page.locator(".od-send").first().click();
    await page.locator(".od-step-date").waitFor({ timeout: 10000 });
    const todayKst = kstDate(0);
    const todayCell = page.locator(`.od-cal-grid button[data-date="${todayKst}"]`);
    check("[화면] 주문 보내기 → 1단계 배송일 달력 먼저 표시", await page.locator(".od-cal-grid").count() === 1);
    // 오늘 배송 가능 시간(기본 01:00~15:00)이 지나면 '마감'으로 막힘 → CI 실행 시각에 따라 둘 중 하나
    const todayClass = await todayCell.getAttribute("class") || "";
    const kstHour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
    const expectClosed = kstHour >= 15 || kstHour < 1;
    check(`[화면] 달력: 오늘 표시(빨간 동그라미) · ${expectClosed ? "마감 시각 지나 막힘" : "선택 가능"}, 미리 선택 안 됨`,
      todayClass.includes("today") && !todayClass.includes("selected")
      && (expectClosed
        ? todayClass.includes("closed") && (await todayCell.innerText()).includes("마감") && await todayCell.isDisabled()
          && await page.locator("[data-testid=today-closed]").count() === 1
        : (await todayCell.innerText()).includes("오늘") && await todayCell.isEnabled()
          && await todayCell.locator(".n").evaluate((el) => getComputedStyle(el).boxShadow.includes("224, 49, 49"))),
      `${todayClass} hour=${kstHour}`);
    check("[화면] 달력: 지난 날짜 선택 불가", await page.locator(`.od-cal-grid button[data-date="${kstDate(-1)}"]`).count() === 0
      || await page.locator(`.od-cal-grid button[data-date="${kstDate(-1)}"]`).isDisabled());
    const nextButton = page.locator(".od-step-date .od-next");
    check("[화면] 날짜·시간 고르기 전 [다음] 꺼짐", await nextButton.isDisabled() && await page.locator(".od-slot-buttons button").first().isDisabled());
    async function pickDate(date) {
      if (await page.locator(`.od-cal-grid button[data-date="${date}"]`).count() === 0) await page.locator('.od-cal-head button[aria-label="다음 달"]').click();
      await page.locator(`.od-cal-grid button[data-date="${date}"]`).click();
    }
    await pickDate(tomorrow);
    check("[화면] 날짜만 고르면 아직 [다음] 꺼짐", await nextButton.isDisabled());
    const pmButtonText = await page.locator('.od-slot-buttons button[data-slot="PM"]').innerText();
    check("[화면] 2단지 거래처: 내일 오후는 '오후 1차 배송'으로 표시", pmButtonText.includes("오후 1차 배송"), pmButtonText);
    await page.locator('.od-slot-buttons button[data-slot="PM"]').click();
    check("[화면] 날짜 + 오후 배송 고르면 [다음] 켜짐", await nextButton.isEnabled());
    await nextButton.click();
    await page.locator(".od-confirm-main").waitFor({ timeout: 10000 });
    const confirmText = await page.locator(".od-confirm").innerText();
    check("[화면] 2단계 주문 확인: 배송일·오후 배송 표시", confirmText.includes("2 / 2") && confirmText.includes("오후 1차 배송"), confirmText.slice(0, 200));
    const phone = page.locator(".od-confirm a.od-phone-order");
    check("[화면] 주문 확정 아래 전화 주문(032-822-8874), 문자 주문 없음", await phone.getAttribute("href") === "tel:0328228874"
      && !confirmText.includes("문자") && await page.locator('a[href^="sms:"]').count() === 0);
    const mainBox = await page.locator(".od-confirm-main").boundingBox();
    const phoneBox = await phone.boundingBox();
    check("[화면] 주문 확정이 메인(더 크고 위), 전화 주문은 보조", Boolean(mainBox && phoneBox && mainBox.height > phoneBox.height && mainBox.y < phoneBox.y));
    const uiNote = `화면테스트-${Date.now()}`;
    await page.locator(".od-confirm-note textarea").fill(uiNote);

    // 저장은 됐지만 응답이 끊긴 상황: 성공 표시 없이 오류 → [다시 시도] 시 같은 주문으로 처리
    let dropped = 0;
    await page.route("**/api/orders", async (route) => {
      if (route.request().method() === "POST" && dropped === 0) {
        dropped += 1;
        await route.fetch();
        await route.abort("connectionreset");
        return;
      }
      await route.continue();
    });
    await page.locator(".od-confirm-main").click();
    await page.locator(".od-confirm-error").waitFor({ timeout: 20000 });
    check("[화면] 응답이 끊기면 성공으로 표시하지 않음(확인 못함 + 다시 시도 안내)", (await page.locator(".od-placed").count()) === 0
      && (await page.locator(".od-confirm-error").innerText()).includes("확인하지 못했습니다")
      && (await page.locator(".od-confirm .od-send", { hasText: "다시 시도" }).count()) === 1);
    check("[화면] 실패 시 장바구니 유지", (await page.locator(".od-cart-line").count()) === 1);
    await page.locator(".od-confirm .od-send", { hasText: "다시 시도" }).click();
    await page.locator(".od-placed").waitFor({ timeout: 20000 });
    const placedText = await page.locator(".od-placed").innerText();
    check("[화면] 다시 시도 → 접수 완료 표시(주문번호)", placedText.includes("주문이 접수되었습니다") && placedText.includes("접수번호"), placedText.replace(/\n/g, " "));
    const sameNote = sql(`SELECT COUNT(*) AS n FROM orders WHERE note='${uiNote}'`);
    check("[화면] 재시도해도 주문은 1건만 저장", Number(sameNote[0]?.n) === 1, j(sameNote));
    await page.locator(".od-placed .od-send").click();
    const cartLabel = await page.locator(".od-cart-icon").getAttribute("aria-label");
    check("[화면] 접수 후 장바구니 비움", /장바구니 0품목/.test(cartLabel || ""), cartLabel || "");
    const deskView = (await pcA.json("/api/desk/orders")).body?.orders?.find((o) => o.note === uiNote);
    check("[화면] 휴대폰 주문 → 알림센터 목록에 표시(내일 오후 배송)", deskView?.deliveryDate === tomorrow && deskView.deliverySlot === "PM" && deskView.items.length === 1, j(deskView));
    check("[화면] 접수 완료 화면에 오후 1차 배송 표시", placedText.includes("오후 1차 배송"), placedText.replace(/\n/g, " "));
    check("[화면] 알림센터에도 1차로 저장", deskView?.deliveryRun === 1, j(deskView?.deliveryRun));

    // 서버가 거절하면(예: 주문 중지) 성공 표시 없음
    sql("UPDATE app_settings SET value='0' WHERE key='orderEnabled'");
    await page.unroute("**/api/orders");
    await addOne();
    await page.locator(".od-cart-icon").click();
    await page.locator(".od-send").first().click();
    await pickDate(tomorrow);
    await page.locator('.od-slot-buttons button[data-slot="AM"]').click();
    await nextButton.click();
    await page.locator(".od-confirm-main").click();
    await page.locator(".od-confirm-error").waitFor({ timeout: 20000 });
    check("[화면] 서버 저장 실패(주문 중지) → 오류 표시, 성공 표시 없음", (await page.locator(".od-placed").count()) === 0
      && (await page.locator(".od-confirm-error").innerText()).includes("일시 중지"), await page.locator(".od-confirm-error").innerText());
    check("[화면] 실패 시 전화 주문 안내(문자 버튼 없음)", (await page.locator(".od-confirm-error").innerText()).includes("전화 주문")
      && await page.locator(".od-sms-fallback").count() === 0);
    sql("UPDATE app_settings SET value='1' WHERE key='orderEnabled'");

    // 단가표: 로그인한 거래처는 볼 수 있음 (비로그인은 첫 화면으로 — auth-e2e 에서 확인)
    await page.goto("/price-list");
    await page.locator(".pl-table").first().waitFor({ timeout: 20000 });
    const listText = await page.locator(".pl-page").innerText();
    check("[화면] 로그인 거래처 단가표 표시(가격 포함)", listText.includes("단가표") && /[0-9,]+원/.test(listText), listText.slice(0, 120).replace(/\n/g, " "));
    await browser.close();
  } catch (error) {
    sql("UPDATE app_settings SET value='1' WHERE key='orderEnabled'");
    check("[화면] 휴대폰 주문 흐름", false, String(error?.message || error).slice(0, 400));
  }

  /* ---------- 7-2. A/B 가격그룹 · 행사품목 배송일 ---------- */
  {
    const target = sellable[1];
    const option = target.packOptions[0];
    const listPrice = Number(option.price ?? 0);
    const priceB = Math.max(0, listPrice - 1000);
    sql(`UPDATE pack_options SET price_b=${priceB} WHERE product_id='${target.id}' AND label='${option.label}'`);
    const customerRow = sql("SELECT id, price_group FROM customers WHERE code='00124' LIMIT 1")[0];
    const asA = (await customer.json("/api/store")).body?.products?.find((p) => p.id === target.id);
    const aOption = asA?.packOptions?.find((o) => o.label === option.label);
    check("A그룹 거래처: 정가로 보임, B가격 정보 없음", aOption?.price === listPrice && !("priceB" in (aOption ?? {})), j(aOption));
    sql(`UPDATE customers SET price_group='B' WHERE id='${customerRow.id}'`);
    const asB = (await customer.json("/api/store")).body?.products?.find((p) => p.id === target.id);
    const bOption = asB?.packOptions?.find((o) => o.label === option.label);
    check("B그룹 거래처: B그룹 가격으로 보임(정가 정보 없음)", bOption?.price === priceB && !("priceB" in (bOption ?? {})), j(bOption));
    const otherB = (await customer.json("/api/store")).body?.products?.find((p) => p.id === sellable[2].id)?.packOptions?.[0];
    check("B가격 없는 상품은 B그룹도 정가", otherB?.price === (sellable[2].packOptions[0].price ?? null), j(otherB));
    const bOrder = await customer.json("/api/orders", { method: "POST", json: {
      items: [{ productId: target.id, optionLabel: option.label, quantity: option.step || 1 }], requestId: randomUUID(),
      deliveryDate: kstDate(1), deliverySlot: "PM", note: "B그룹 테스트", confirmAnomaly: true } });
    const bId = bOrder.body?.order?.id;
    const bItem = sql(`SELECT unit_price, list_price FROM order_items WHERE order_id='${bId}'`)[0];
    check("B그룹 주문 금액 = B그룹 가격, 정가도 함께 저장", Number(bItem?.unit_price) === priceB && Number(bItem?.list_price) === listPrice, j(bItem));
    const bDesk = (await pcA.json(`/api/desk/orders?id=${bId}`)).body?.order;
    check("알림센터: 가격 변동그룹(B) 주문 + 정가/단가", bDesk?.priceGroup === "B" && bDesk.items[0].unitPrice === priceB && bDesk.items[0].listPrice === listPrice, j(bDesk));
    sql(`UPDATE customers SET price_group='${customerRow.price_group || "A"}' WHERE id='${customerRow.id}'`);
    const aDesk = (await pcA.json(`/api/desk/orders?id=${orderId}`)).body?.order;
    check("A그룹 주문은 가격 변동그룹 아님", aDesk?.priceGroup === "A", j(aDesk?.priceGroup));

    // 관리자 상품 저장 시 B그룹 가격 유지/수정
    const adminSalt = "ci-desk-admin-salt";
    sql(`INSERT OR REPLACE INTO admin_credentials (id, salt, hash) VALUES (1, '${adminSalt}', '${pbkdf2Sync("ci-admin-password", adminSalt, 100000, 32, "sha256").toString("hex")}')`);
    const admin = new Client();
    await admin.json("/api/admin/login", { method: "POST", json: { username: "admin", password: "ci-admin-password" } });
    const adminProduct = (await admin.json("/api/store?all=1")).body?.products?.find((p) => p.id === target.id);
    check("관리자 화면 데이터에 B그룹 가격 포함", adminProduct?.packOptions?.find((o) => o.label === option.label)?.priceB === priceB, j(adminProduct?.packOptions));
    const saved = await admin.json("/api/admin/products", { method: "POST", json: { action: "update", product: {
      ...adminProduct, packOptions: adminProduct.packOptions.map((o, i) => ({ ...o, priceB: i === 0 ? priceB - 100 : null })) } } });
    const afterSave = sql(`SELECT price_b FROM pack_options WHERE product_id='${target.id}' ORDER BY sort_order LIMIT 1`)[0];
    check("관리자 상품 저장 → B그룹 가격 저장(비우면 정가와 동일)", saved.status === 200 && Number(afterSave?.price_b) === priceB - 100, j({ saved: saved.body, afterSave }));

    // 관리자 계정(admin + 관리자 비밀번호)으로 알림센터 로그인
    const pcAdmin = new Client();
    const adminDesk = await pcAdmin.json("/api/desk/login", { method: "POST", origin: false, json: { username: "admin", pin: "ci-admin-password", deviceName: "CI-ADMIN" } });
    pcAdmin.token = adminDesk.body?.token ?? "";
    check("관리자 계정(admin+비밀번호)으로 알림센터 로그인", adminDesk.status === 200 && pcAdmin.token.length === 64 && adminDesk.body?.staff?.displayName === "관리자", j(adminDesk.body));
    check("관리자 로그인 PC 주문 목록 조회", (await pcAdmin.json("/api/desk/orders")).status === 200);
    const adminWrong = await new Client().json("/api/desk/login", { method: "POST", origin: false, json: { username: "admin", pin: "wrong-password", deviceName: "CI-ADMIN" } });
    check("관리자 비밀번호 틀리면 거절", adminWrong.status === 401, j(adminWrong.body));
    const staffList = await admin.json("/api/admin/staff");
    check("알림센터용 관리자 처리자 계정은 직원 목록에 안 보임", staffList.status === 200 && !(staffList.body?.staff ?? []).some((r) => r.id === "S-DESK-ADMIN"), j(staffList.body).slice(0, 120));

    // 행사품목: 오늘·내일만
    const promoName = store.body?.promoCategory;
    const promoProduct = (store.body?.products ?? []).find((p) => p.category === promoName && !p.soldout && (p.packOptions ?? []).length);
    if (promoProduct) {
      const promoItems = [{ productId: promoProduct.id, optionLabel: promoProduct.packOptions[0].label, quantity: promoProduct.packOptions[0].step || 1 }];
      const far = await customer.json("/api/orders", { method: "POST", json: { items: [...promoItems, items[0]], requestId: randomUUID(), deliveryDate: kstDate(3), deliverySlot: "AM", confirmAnomaly: true } });
      check("행사품목 포함 주문은 모레 이후 배송 거절", far.status === 400 && String(far.body?.error).includes("행사품목"), j(far.body));
      const near = await customer.json("/api/orders", { method: "POST", json: { items: promoItems, requestId: randomUUID(), deliveryDate: kstDate(1), deliverySlot: "AM", confirmAnomaly: true } });
      check("행사품목 내일 배송 접수 + 알림센터 '행사품목 포함'", near.status === 200
        && (await pcA.json(`/api/desk/orders?id=${near.body?.order?.id}`)).body?.order?.hasPromo === true, j(near.body));
    } else {
      check("행사품목 테스트 상품 있음", false, `promo=${promoName}`);
    }
    const farNormal = await customer.json("/api/orders", { method: "POST", json: { items: [items[0]], requestId: randomUUID(), deliveryDate: kstDate(5), deliverySlot: "AM", confirmAnomaly: true } });
    check("일반 상품만이면 먼 날짜도 접수", farNormal.status === 200, j(farNormal.body));
  }

  /* ---------- 7-3. 발주 삭제 ---------- */
  {
    const victim = await customer.json("/api/orders", { method: "POST", json: { items: [items[0]], requestId: randomUUID(), deliveryDate: kstDate(2), deliverySlot: "AM", confirmAnomaly: true } });
    const victimId = victim.body?.order?.id;
    upsertStaff("S-CI-DESK-D", "cidriver", "배송기사테스트", "975310", "DRIVER");
    const pcDriver = new Client();
    pcDriver.token = (await pcDriver.json("/api/desk/login", { method: "POST", origin: false, json: { username: "cidriver", pin: "975310", deviceName: "CI-D" } })).body?.token ?? "";
    const driverDelete = await pcDriver.json("/api/desk/orders", { method: "POST", origin: false, json: { action: "delete", orderId: victimId } });
    check("배송기사 권한은 발주 삭제 불가(403)", driverDelete.status === 403, j(driverDelete.body));
    await pcB.json("/api/desk/orders", { method: "POST", origin: false, json: { action: "start", orderId: victimId } });
    const del = await pcA.json("/api/desk/orders", { method: "POST", origin: false, json: { action: "delete", orderId: victimId, reason: "CI 테스트" } });
    check("관리자 권한 발주 삭제 → 삭제됨", del.status === 200 && del.body?.order?.desk?.deleted === true && del.body.order.cancelled === true, j(del.body?.order?.desk));
    check("삭제한 발주는 모든 PC 목록에서 빠짐", !((await pcB.json("/api/desk/orders")).body?.orders ?? []).some((o) => o.id === victimId));
    const again = await pcB.json("/api/desk/orders", { method: "POST", origin: false, json: { action: "done", orderId: victimId } });
    check("삭제된 발주 다른 PC에서 완료 시도 → '이미 삭제' 안내", again.status === 409 && String(again.body?.error).includes("삭제"), j(again.body));
    const reopenDeleted = await pcA.json("/api/desk/orders", { method: "POST", origin: false, json: { action: "reopen", orderId: victimId } });
    check("삭제된 발주는 입력완료 취소로 되살릴 수 없음", reopenDeleted.status === 409);
    const custView = (await customer.json("/api/customer/dashboard")).body;
    check("거래처 최근 주문에서도 빠짐(취소)", !JSON.stringify(custView ?? {}).includes(victimId));
    check("삭제 기록(사유 포함) 남음", sql(`SELECT summary FROM audit_logs WHERE entity_id='${victimId}' AND action='desk_delete'`).some((r) => String(r.summary).includes("CI 테스트")));
  }

  /* ---------- 7-4. 관리자 가격그룹 지정 · 배송기사 발주 ---------- */
  {
    const salt = "ci-desk-admin-salt2";
    sql(`INSERT OR REPLACE INTO admin_credentials (id, salt, hash) VALUES (1, '${salt}', '${pbkdf2Sync("ci-admin-password", salt, 100000, 32, "sha256").toString("hex")}')`);
    const admin2 = new Client();
    await admin2.json("/api/admin/login", { method: "POST", json: { username: "admin", password: "ci-admin-password" } });
    const target = sql("SELECT id, price_group FROM customers WHERE code='00124' LIMIT 1")[0];
    const setB = await admin2.json("/api/admin/customers", { method: "POST", json: { action: "set-price-group", id: target.id, priceGroup: "B" } });
    const listed = (await admin2.json("/api/admin/customers")).body?.customers?.find((c) => c.id === target.id);
    check("관리자: 거래처 가격그룹 B 지정 → 목록에 반영", setB.status === 200 && listed?.priceGroup === "B", j({ setB: setB.body, listed: listed?.priceGroup }));
    check("가격그룹 변경 즉시 거래처 주문에 B그룹 적용", (await customer.json("/api/customer/status")).status === 200);
    await admin2.json("/api/admin/customers", { method: "POST", json: { action: "set-price-group", id: target.id, priceGroup: target.price_group || "A" } });
    const anonGroup = await anon.json("/api/admin/customers", { method: "POST", json: { action: "set-price-group", id: target.id, priceGroup: "B" } });
    check("비관리자 가격그룹 변경 불가", anonGroup.status === 403);

    const driver = new Client();
    const dl = await driver.json("/api/staff/login", { method: "POST", json: { username: "cidriver", pin: "975310" } });
    check("배송기사 웹 로그인", dl.status === 200, j(dl.body));
    const driverData = await driver.json(`/api/driver/data?date=${kstDate(1)}`);
    check("배송기사: 전체 거래처 목록 받음", driverData.status === 200 && (driverData.body?.customers ?? []).length >= 1, `${driverData.status}`);
    const noSlot = await driver.json("/api/driver/order", { method: "POST", json: { customerId: target.id, deliveryDate: kstDate(1), items: [items[0]], confirmAnomaly: true } });
    check("배송기사 발주: 배송 시간 없으면 거절", noSlot.status === 400, j(noSlot.body));
    const rid = randomUUID();
    const dPayload = { customerId: target.id, deliveryDate: kstDate(1), deliverySlot: "PM", requestId: rid, items: [items[0]], note: "기사 테스트", confirmAnomaly: true };
    const d1 = await driver.json("/api/driver/order", { method: "POST", json: dPayload });
    const d2 = await driver.json("/api/driver/order", { method: "POST", json: dPayload });
    check("배송기사 발주 접수 + 재전송 중복 없음", d1.status === 200 && d2.body?.order?.id === d1.body?.order?.id, j({ d1: d1.body?.order?.id, d2: d2.body?.order?.id }));
    const dDesk = (await pcA.json(`/api/desk/orders?id=${d1.body?.order?.id}`)).body?.order;
    check("사무실 알림센터에 기사발주(기사 이름·오후 배송)로 표시", dDesk?.source === "driver" && dDesk.createdByStaffName === "배송기사테스트" && dDesk.deliverySlot === "PM" && dDesk.desk.state === "new", j(dDesk));
    const staffPriceList = await fetch(`${BASE}/price-list`, { headers: { cookie: [...driver.cookies].map(([k, v]) => `${k}=${v}`).join("; ") }, redirect: "manual" });
    check("배송기사도 단가표 열림", staffPriceList.status === 200, `${staffPriceList.status}`);
  }

  /* ---------- 7-5. 품목 카테고리 순서 · 여러 주문 한 번에 처리 · 오늘 요약 ---------- */
  {
    const cats = sql("SELECT name, sort_order FROM categories ORDER BY sort_order");
    const products = (store.body?.products ?? []).filter((p) => !p.soldout && (p.packOptions ?? []).length);
    const order = cats.map((c) => c.name);
    // 카테고리 순서가 다른 상품 3개를 '거꾸로' 담아서 주문
    const picks = [];
    for (const cat of [...order].reverse()) {
      const p = products.find((x) => x.category === cat && cat !== store.body?.promoCategory);
      if (p) picks.push(p);
      if (picks.length === 3) break;
    }
    const sorted = await customer.json("/api/orders", { method: "POST", json: {
      items: picks.map((p) => ({ productId: p.id, optionLabel: p.packOptions[0].label, quantity: p.packOptions[0].step || 1 })),
      requestId: randomUUID(), deliveryDate: kstDate(7), deliverySlot: "AM", confirmAnomaly: true } });
    const sortedOrder = (await pcA.json(`/api/desk/orders?id=${sorted.body?.order?.id}`)).body?.order;
    const shownCats = (sortedOrder?.items ?? []).map((i) => order.indexOf(i.category));
    check("발주 품목이 카테고리 관리 순서대로 정렬", picks.length >= 2 && shownCats.every((v, i) => i === 0 || shownCats[i - 1] <= v), j({ picked: picks.map((p) => p.category), shown: (sortedOrder?.items ?? []).map((i) => i.category) }));
    const second2 = await customer.json("/api/orders", { method: "POST", json: {
      items: [{ productId: picks[0].id, optionLabel: picks[0].packOptions[0].label, quantity: picks[0].packOptions[0].step || 1 }],
      requestId: randomUUID(), deliveryDate: kstDate(7), deliverySlot: "AM", confirmAnomaly: true } });
    const ids = [sorted.body?.order?.id, second2.body?.order?.id];
    const startMany = await pcA.json("/api/desk/orders", { method: "POST", origin: false, json: { action: "start", orderIds: ids } });
    check("합친 발주 2건 한 번에 입력 시작", startMany.status === 200 && (startMany.body?.results ?? []).every((r) => r.ok && r.order?.desk?.state === "entering"), j(startMany.body));
    const conflictMany = await pcB.json("/api/desk/orders", { method: "POST", origin: false, json: { action: "start", orderIds: ids } });
    check("다른 PC가 같은 묶음 시작 → 주문별 충돌 안내", conflictMany.status === 200 && (conflictMany.body?.results ?? []).every((r) => !r.ok && String(r.error).includes("입력 중")), j(conflictMany.body));
    const doneMany = await pcA.json("/api/desk/orders", { method: "POST", origin: false, json: { action: "done", orderIds: ids } });
    check("합친 발주 2건 한 번에 입력완료", (doneMany.body?.results ?? []).every((r) => r.ok && r.order?.desk?.state === "done"), j(doneMany.body));
    const pulseStats = (await pcA.json("/api/desk/pulse")).body;
    check("오늘 접수·오늘 완료 숫자 제공", Number(pulseStats?.todayReceived) >= 2 && Number(pulseStats?.todayDone) >= 2, j(pulseStats));
  }

  /* ---------- 7-6. v1.2: 구역·배송 마감 · 창고 위치 · 상차준비표 · 거래처 확인 알림 · 사진 여러 장 · 휴대폰 알림 ---------- */
  {
    const adminSalt = randomBytes(16).toString("hex");
    sql(`INSERT OR REPLACE INTO admin_credentials (id, salt, hash) VALUES (1, '${adminSalt}', '${pbkdf2Sync("ci-admin-password", adminSalt, 100000, 32, "sha256").toString("hex")}')`);
    const admin = new Client();
    await admin.json("/api/admin/login", { method: "POST", json: { username: "admin", password: "ci-admin-password" } });
    const zonesData = (await admin.json("/api/admin/zones")).body;
    check("구역 기본값: 1단지·2단지·외곽·서구·부천 + 창고 위치 6곳", ["1단지", "2단지", "외곽", "서구", "부천"].every((z) => zonesData?.zones?.some((r) => r.name === z))
      && ["냉동창고 좌측", "냉동창고 우측", "냉장창고", "창고1층", "창고2층", "야외"].every((n) => zonesData?.locations?.some((r) => r.name === n)), j(zonesData?.zones));
    check("2단지 오후 차수 13:00·15:00, 1단지 15:00", zonesData?.zones?.find((z) => z.name === "2단지")?.pmRuns === "13:00,15:00"
      && zonesData?.zones?.find((z) => z.name === "1단지")?.pmRuns === "15:00", j(zonesData?.zones?.slice(0, 2)));
    check("비관리자 구역 API 차단", (await anon.json("/api/admin/zones")).status === 403
      && (await anon.json("/api/admin/zones", { method: "POST", json: { action: "zone-add", name: "x" } })).status === 403);

    const me = sql("SELECT id, region FROM customers WHERE code='00124' LIMIT 1")[0];
    const status2 = (await customer.json("/api/customer/status")).body;
    check("거래처 상태에 구역 배송 규칙(2단지) 포함", status2?.deliveryRule?.zone === "2단지" && status2.deliveryRule.pmRuns?.join(",") === "13:00,15:00" && typeof status2.serverNow === "number", j(status2?.deliveryRule));

    // 새 구역 만들고 거래처 옮기기 → 거래처 화면 규칙이 바뀜
    const addZone = await admin.json("/api/admin/zones", { method: "POST", json: { action: "zone-add", name: "CI구역" } });
    const saveZone = await admin.json("/api/admin/zones", { method: "POST", json: { action: "zone-save", name: "CI구역", amUntil: "09:30", pmRuns: "12:00, 14:00, 23:59" } });
    const assign = await admin.json("/api/admin/zones", { method: "POST", json: { action: "assign", customerIds: [me.id], zone: "CI구역" } });
    const status3 = (await customer.json("/api/customer/status")).body;
    check("관리자: 구역 추가·마감 저장·거래처 옮기기 → 거래처 규칙 반영", addZone.status === 200 && saveZone.status === 200 && assign.status === 200
      && status3?.deliveryRule?.zone === "CI구역" && status3.deliveryRule.amUntil === "09:30" && status3.deliveryRule.pmRuns.join(",") === "12:00,14:00,23:59", j({ a: addZone.body, s: saveZone.body, r: status3?.deliveryRule }));
    const badTime = await admin.json("/api/admin/zones", { method: "POST", json: { action: "zone-save", name: "CI구역", amUntil: "25:99", pmRuns: "" } });
    check("잘못된 마감 시각 거절", badTime.status === 400, j(badTime.body));

    // 오늘 배송 마감: 오늘배송 가능 시간을 지금이 아닌 시간대로 → 오늘 주문 거절(달력과 같은 메시지), 내일은 가능
    const nowHour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
    const closedWindow = nowHour < 12 ? { openFrom: "22:00", sameDayCutoff: "23:00" } : { openFrom: "00:00", sameDayCutoff: "01:00" };
    await admin.json("/api/admin/zones", { method: "POST", json: { action: "defaults-save", ...closedWindow, amUntil: "10:00", pmRuns: "15:00" } });
    const todayOrder = await customer.json("/api/orders", { method: "POST", json: { items: [items[0]], requestId: randomUUID(), deliveryDate: kstDate(0), deliverySlot: "PM", confirmAnomaly: true } });
    check("오늘 배송 마감 후 오늘 배송 주문 → 거절(마감 안내)", todayOrder.status === 400 && todayOrder.body?.deliveryClosed === true && /마감|주문 가능/.test(String(todayOrder.body?.error)), j(todayOrder.body));
    const tomorrowPm = await customer.json("/api/orders", { method: "POST", json: { items: [items[0]], requestId: randomUUID(), deliveryDate: kstDate(1), deliverySlot: "PM", note: "CI 내일 오후", confirmAnomaly: true } });
    check("마감 후에도 내일 배송 주문은 접수 · 예약 오후는 1차", tomorrowPm.status === 200 && tomorrowPm.body?.order?.deliveryRun === 1, j(tomorrowPm.body));
    // 오늘 하루 종일 열기 → 지금 시각 기준 차수 계산 (12:00 전 1차 / 14:00 전 2차 / 그 뒤 3차)
    await admin.json("/api/admin/zones", { method: "POST", json: { action: "defaults-save", openFrom: "00:00", sameDayCutoff: "23:59", amUntil: "10:00", pmRuns: "15:00" } });
    const nowHm = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
    if (nowHm < "23:57") {
      const todayPm = await customer.json("/api/orders", { method: "POST", json: { items: [items[0]], requestId: randomUUID(), deliveryDate: kstDate(0), deliverySlot: "PM", confirmAnomaly: true } });
      const expectRun = nowHm < "12:00" ? 1 : nowHm < "14:00" ? 2 : 3;
      check(`오늘 오후 주문 차수 = 접수 시각 기준(${nowHm} → ${expectRun}차)`, todayPm.status === 200 && todayPm.body?.order?.deliveryRun === expectRun, j(todayPm.body));
      const todayAm = await customer.json("/api/orders", { method: "POST", json: { items: [items[0]], requestId: randomUUID(), deliveryDate: kstDate(0), deliverySlot: "AM", confirmAnomaly: true } });
      if (nowHm < "09:25" || nowHm > "09:35") {
        check(`오늘 오전 배송: 09:30 마감(${nowHm})`, nowHm < "09:25" ? todayAm.status === 200 : todayAm.status === 400 && todayAm.body?.deliveryClosed === true, j(todayAm.body));
      }
      const tp = (await pcA.json(`/api/desk/orders?id=${todayPm.body?.order?.id}`)).body?.order;
      check("알림센터 주문에 차수·구역 표시용 값", tp?.deliveryRun === expectRun && tp?.zone === "CI구역", j({ run: tp?.deliveryRun, zone: tp?.zone }));
    }
    await admin.json("/api/admin/zones", { method: "POST", json: { action: "defaults-save", openFrom: "01:00", sameDayCutoff: "15:00", amUntil: "10:00", pmRuns: "15:00" } });

    // 창고 위치: 상품 위치 지정 → 상차준비표 데이터에 반영
    const locTarget = items[0].productId;
    const setLoc = await admin.json("/api/admin/zones", { method: "POST", json: { action: "products-location", productIds: [locTarget], location: "냉동창고 우측" } });
    const storeLoc = (await admin.json("/api/store?all=1")).body?.products?.find((p) => p.id === locTarget);
    check("관리자: 상품 창고 위치 지정", setLoc.status === 200 && storeLoc?.warehouseZone === "냉동창고 우측", j(setLoc.body));
    const sheet = await pcA.json(`/api/desk/load-sheet?date=${kstDate(1)}`);
    const sheetOrder = (sheet.body?.orders ?? []).find((o) => o.id === tomorrowPm.body?.order?.id);
    check("상차준비표 데이터: 구역·위치·보관구분·차수", sheet.status === 200 && sheetOrder?.zone === "CI구역" && sheetOrder.deliveryRun === 1
      && sheetOrder.items?.[0]?.location === "냉동창고 우측" && sheet.body?.locations?.some((l) => l.name === "냉동창고 우측" && l.storage === "frozen")
      && sheet.body?.zones?.includes("CI구역"), j(sheetOrder));
    check("상차준비표 API: 토큰 없으면 401", (await anon.json(`/api/desk/load-sheet?date=${kstDate(1)}`)).status === 401);
    const mark = await pcA.json("/api/desk/load-sheet", { method: "POST", origin: false, json: { orderIds: [sheetOrder?.id], label: "CI" } });
    const sheet2 = await pcA.json(`/api/desk/load-sheet?date=${kstDate(1)}`);
    check("상차준비표 출력 표시 → 다음엔 '새 발주만'에서 빠짐", mark.status === 200 && Boolean((sheet2.body?.orders ?? []).find((o) => o.id === sheetOrder?.id)?.loadPrintedAt), j(mark.body));
    writeFileSync("desk-loadsheet.json", JSON.stringify(sheet2.body ?? {}));

    // 거래처 '발주 확인' 알림: 입력완료 → 표시, 닫기 전까지 유지, 입력완료 취소 → 회수
    const noticeOrder = tomorrowPm.body?.order?.id;
    check("입력완료 전에는 확인 알림 없음", !((await customer.json("/api/customer/notices")).body?.notices ?? []).some((n) => n.orderId === noticeOrder));
    await pcA.json("/api/desk/orders", { method: "POST", origin: false, json: { action: "done", orderId: noticeOrder } });
    const n1 = (await customer.json("/api/customer/notices")).body?.notices ?? [];
    const myNotice = n1.find((n) => n.orderId === noticeOrder);
    check("입력완료 → 거래처에 '발주가 확인되었습니다' 알림", myNotice?.title === "발주가 확인되었습니다" && myNotice.body.includes("오후 1차 배송"), j(myNotice));
    check("다시 열어도 알림 유지(닫기 전)", ((await customer.json("/api/customer/notices")).body?.notices ?? []).some((n) => n.orderId === noticeOrder));
    const other = new Client();
    check("다른 사람(비로그인)은 알림 못 봄·못 닫음", (await other.json("/api/customer/notices")).status === 401
      && (await other.json("/api/customer/notices", { method: "POST", json: { ids: [myNotice?.id] } })).status === 401);
    const dismiss = await customer.json("/api/customer/notices", { method: "POST", json: { ids: [myNotice?.id] } });
    check("거래처가 [확인] → 알림 닫힘", dismiss.body?.dismissed === 1 && !((await customer.json("/api/customer/notices")).body?.notices ?? []).some((n) => n.orderId === noticeOrder), j(dismiss.body));
    const extraOrder = await customer.json("/api/orders", { method: "POST", json: { items: [items[0]], requestId: randomUUID(), deliveryDate: kstDate(3), deliverySlot: "AM", confirmAnomaly: true } });
    await pcA.json("/api/desk/orders", { method: "POST", origin: false, json: { action: "done", orderId: extraOrder.body?.order?.id } });
    await pcA.json("/api/desk/orders", { method: "POST", origin: false, json: { action: "reopen", orderId: extraOrder.body?.order?.id } });
    check("입력완료 취소 → 아직 안 닫은 알림 회수", !((await customer.json("/api/customer/notices")).body?.notices ?? []).some((n) => n.orderId === extraOrder.body?.order?.id));
    await pcA.json("/api/desk/orders", { method: "POST", origin: false, json: { action: "done", orderId: extraOrder.body?.order?.id } });
    writeFileSync("desk-notice.json", JSON.stringify({ orderId: extraOrder.body?.order?.id }));

    // 상품 사진 여러 장
    const photoProduct = (await admin.json("/api/store?all=1")).body?.products?.find((p) => p.id === locTarget);
    const photos = ["/api/photo?id=ci-a.webp", "/api/photo?id=ci-b.webp", "/api/photo?id=ci-c.webp"];
    const savePhotos = await admin.json("/api/admin/products", { method: "POST", json: { action: "update", product: { ...photoProduct, photo: photos[0], photos } } });
    const afterPhotos = (await customer.json("/api/store")).body?.products?.find((p) => p.id === locTarget);
    check("상품 사진 여러 장 저장 → 거래처 화면에 3장(첫 장 대표)", savePhotos.status === 200 && afterPhotos?.photo === photos[0] && afterPhotos?.photos?.join("|") === photos.join("|"), j(afterPhotos?.photos));
    writeFileSync("desk-photo.json", JSON.stringify({ productId: locTarget, name: photoProduct?.name }));

    // 휴대폰 알림 (텔레그램·푸시 미설정 상태)
    const alertsInfo = await admin.json("/api/admin/alerts");
    check("휴대폰 알림 설정: 푸시 공개키 발급, 봇 토큰은 화면에 안 나감", alertsInfo.status === 200 && /^[A-Za-z0-9_-]{80,90}$/.test(alertsInfo.body?.publicKey ?? "")
      && !("telegramToken" in (alertsInfo.body?.settings ?? {})), j(alertsInfo.body));
    check("미처리 발주 요약(신규 건수)", Number(alertsInfo.body?.pending?.count) >= 1, j(alertsInfo.body?.pending));
    const badToken = await admin.json("/api/admin/alerts", { method: "POST", json: { action: "save", telegramToken: "not-a-token" } });
    check("잘못된 텔레그램 토큰 거절", badToken.status === 400, j(badToken.body));
    const saveRepeat = await admin.json("/api/admin/alerts", { method: "POST", json: { action: "save", repeatMinutes: 5, repeatMax: 3, repeatFrom: "06:00", repeatTo: "18:00", instant: true } });
    const afterRepeat = (await admin.json("/api/admin/alerts")).body?.settings;
    check("반복 알림 설정 저장", saveRepeat.status === 200 && afterRepeat?.repeatMinutes === 5 && afterRepeat?.repeatMax === 3 && afterRepeat?.repeatFrom === "06:00", j(afterRepeat));
    const esc = await admin.json("/api/admin/alerts", { method: "POST", json: { action: "run-escalation", force: true } });
    check("알림 채널이 없으면 다시 알림 안 보냄(오류 없음)", esc.status === 200 && esc.body?.count === 0, j(esc.body));
    check("푸시 요약은 구독 토큰 없으면 401", (await anon.json("/api/push/summary")).status === 401);
    check("푸시 구독은 관리자만", (await anon.json("/api/push/subscribe", { method: "POST", json: { endpoint: "https://example.com/x" } })).status === 403);
    const sub = await admin.json("/api/push/subscribe", { method: "POST", json: { endpoint: "https://push.example.invalid/ci-endpoint", label: "CI" } });
    const summary = await fetch(`${BASE}/api/push/summary`, { headers: { authorization: `Bearer ${sub.body?.token}` } }).then((r) => r.json());
    check("구독 토큰으로 푸시 요약 받기(처리 안 된 발주 n건)", sub.status === 200 && String(summary?.title ?? "").includes("발주"), j(summary));
    await admin.json("/api/push/subscribe", { method: "DELETE", json: { endpoint: "https://push.example.invalid/ci-endpoint" } });
    check("구독 해제 → 토큰 무효", (await fetch(`${BASE}/api/push/summary`, { headers: { authorization: `Bearer ${sub.body?.token}` } })).status === 401);

    // 화면: 발주 확인 알림 · 상품 카드(가격 보임) · 상세 사진 넘겨보기 · 관리자 구역/창고 화면 · 휴대폰 알림 페이지
    try {
      const { chromium, devices } = await import("playwright");
      const browser = await chromium.launch();
      const mobile = await browser.newContext({ ...devices["Pixel 7"], baseURL: BASE });
      const page = await mobile.newPage();
      await page.goto("/");
      await page.locator('input[name="username"]').fill("12013");
      await page.locator('input[name="password"]').fill("12013");
      await page.locator('button[type="submit"]').click();
      await page.locator(".od-notice").waitFor({ timeout: 30000 });
      const noticeText = await page.locator(".od-notice").innerText();
      check("[화면] 입력완료된 발주 → 거래처 화면에 큰 '발주 확인' 알림", noticeText.includes("확인되었습니다") && noticeText.includes("배송"), noticeText.replace(/\n/g, " ").slice(0, 160));
      await page.waitForTimeout(500);
      const noticeBox = await page.locator(".od-notice").boundingBox();
      const viewport = page.viewportSize();
      check("[화면] 발주 확인 알림이 화면 가운데 다 보임", Boolean(noticeBox && viewport && noticeBox.x >= 0 && noticeBox.x + noticeBox.width <= viewport.width + 1), j(noticeBox));
      await page.screenshot({ path: "desk-shot-web-notice.png" });
      await page.mouse.click(5, 5);
      check("[화면] 바깥을 눌러도 알림 안 닫힘", await page.locator(".od-notice").isVisible());
      await page.locator(".od-notice .od-send").click();
      await page.locator(".od-notice").waitFor({ state: "detached", timeout: 10000 });
      await page.reload();
      await page.locator(".od-search input").waitFor({ timeout: 30000 });
      await page.waitForTimeout(1500);
      check("[화면] [확인했습니다] 누르면 다시 열어도 안 뜸", await page.locator(".od-notice").count() === 0);

      const photoInfo = { name: photoProduct?.name ?? "" };
      await page.locator(".od-search input").fill(photoInfo.name);
      const card = page.locator(".od-card", { hasText: photoInfo.name }).first();
      await card.waitFor({ timeout: 10000 });
      const priceBox = await card.locator(".od-opt-price").first().boundingBox();
      const cardBox = await card.boundingBox();
      check("[화면] 카드에 단위 옆 가격이 잘리지 않고 보임", Boolean(priceBox && cardBox && priceBox.width > 20 && priceBox.x + priceBox.width <= cardBox.x + cardBox.width + 1), j({ priceBox, cardBox }));
      check("[화면] 카드에는 입수·인분·설명 없음(사진·이름·가격·수량만)", await card.locator(".od-card-servings, .od-card-more").count() === 0);
      check("[화면] 사진 여러 장 표시(▦ 3)", (await card.locator(".od-photo-count").innerText()).includes("3"));
      await page.locator(".od-search input").fill("");
      await page.locator(".od-search input").fill(sellable[0].name);
      await page.waitForTimeout(400);
      await page.screenshot({ path: "desk-shot-web-cards.png" });
      await page.locator(".od-search input").fill(photoInfo.name);
      await card.locator(".od-card-photo").click();
      await page.locator(".od-gallery").waitFor({ timeout: 10000 });
      check("[화면] 사진 누르면 상세: 사진 1 / 3 넘겨보기", (await page.locator(".od-gallery-count").innerText()).trim() === "1 / 3" && await page.locator(".od-gallery-slide").count() === 3);
      await page.locator(".od-gallery-track").evaluate((el) => el.scrollTo({ left: el.clientWidth, behavior: "instant" }));
      await page.waitForTimeout(400);
      check("[화면] 옆으로 밀면 2 / 3", (await page.locator(".od-gallery-count").innerText()).trim() === "2 / 3");
      await page.screenshot({ path: "desk-shot-web-detail.png" });
      await page.locator(".od-sheet-done").click();

      await page.locator(".od-search input").fill(sellable[0].name);
      await page.locator(".od-card", { hasText: sellable[0].name }).first().locator('button[aria-label$="수량 늘리기"]').first().click();
      await page.locator(".od-cart-icon").click();
      await page.locator(".od-send").first().click();
      await page.locator(".od-step-date").waitFor({ timeout: 10000 });
      const tmr = kstDate(1);
      if (await page.locator(`.od-cal-grid button[data-date="${tmr}"]`).count() === 0) await page.locator('.od-cal-head button[aria-label="다음 달"]').click();
      await page.locator(`.od-cal-grid button[data-date="${tmr}"]`).click();
      await page.locator(".od-step-date .od-next").scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await page.screenshot({ path: "desk-shot-web-date.png" });

      const pc = await browser.newContext({ viewport: { width: 1360, height: 900 }, baseURL: BASE });
      const adminPage = await pc.newPage();
      await adminPage.goto("/admin");
      await adminPage.locator('input[type="password"]').fill("ci-admin-password");
      await adminPage.locator('button[type="submit"]').click();
      await adminPage.locator(".adm-side nav button", { hasText: "구역" }).click();
      await adminPage.locator(".adm-zone").first().waitFor({ timeout: 20000 });
      check("[화면] 관리자 '구역 · 배송 마감' 메뉴: 구역 목록·마감 설명", (await adminPage.locator(".adm-zone-rule").first().innerText()).includes("오전 배송"));
      await adminPage.screenshot({ path: "desk-shot-web-admin-zones.png", fullPage: false });
      await adminPage.locator(".adm-side nav button", { hasText: "창고 위치" }).click();
      await adminPage.locator(".adm-loc").first().waitFor({ timeout: 20000 });
      check("[화면] 관리자 '창고 위치' 메뉴: 위치 순서 6곳 이상", await adminPage.locator(".adm-loc-list").first().locator(".adm-loc").count() >= 6);
      await adminPage.screenshot({ path: "desk-shot-web-admin-locations.png", fullPage: false });
      await adminPage.locator(".adm-side nav button", { hasText: "상품 관리" }).click();
      await adminPage.locator('.adm-main input[type="search"]').first().fill(photoInfo.name);
      await adminPage.waitForTimeout(500);
      await adminPage.locator(".adm-btn-edit").first().click();
      await adminPage.locator(".adm-photos-grid").waitFor({ timeout: 10000 });
      check("[화면] 상품 수정: 사진 3장 + 창고 위치 선택", await adminPage.locator(".adm-photos-grid figure").count() === 3
        && (await adminPage.locator(".adm-editor select").evaluateAll((els) => els.map((e) => e.value))).includes("냉동창고 우측"));
      await adminPage.screenshot({ path: "desk-shot-web-admin-editor.png", fullPage: false });

      const alertsPage = await (await browser.newContext({ ...devices["Pixel 7"], baseURL: BASE })).newPage();
      await alertsPage.goto("/alerts");
      await alertsPage.locator('input[type="password"]').fill("ci-admin-password");
      await alertsPage.locator("button.alerts-primary").click();
      await alertsPage.locator(".alerts-status").waitFor({ timeout: 20000 });
      check("[화면] 휴대폰 알림 페이지: 미처리 요약·앱 알림·텔레그램 설정", (await alertsPage.locator("main").innerText()).includes("텔레그램")
        && await alertsPage.locator('link[rel="manifest"][href="/alerts.webmanifest"]').count() === 1);
      await alertsPage.screenshot({ path: "desk-shot-web-alerts.png", fullPage: true });
      await browser.close();
    } catch (error) {
      check("[화면] v1.2 화면 점검", false, String(error?.message || error).slice(0, 400));
    }

    // 거래처를 원래 구역으로
    await admin.json("/api/admin/zones", { method: "POST", json: { action: "assign", customerIds: [me.id], zone: me.region || "2단지" } });
  }

  /* ---------- 8. 권한 해제 ---------- */
  const logoutB = await pcB.json("/api/desk/logout", { method: "POST", origin: false, json: {} });
  check("PC B 로그아웃", logoutB.status === 200);
  check("로그아웃한 토큰 → 401", (await pcB.json("/api/desk/pulse")).status === 401);
  sql("UPDATE staff_users SET active=0 WHERE id='S-CI-DESK-A'");
  check("직원 계정 중지 → 해당 PC 토큰 즉시 401", (await pcA.json("/api/desk/pulse")).status === 401);
  sql("UPDATE staff_users SET active=1 WHERE id='S-CI-DESK-A'");
  check("계정 다시 사용 → 토큰 다시 유효", (await pcA.json("/api/desk/pulse")).status === 200);

  /* ---------- 9. 관리자 화면에 알림센터 기능 없음 ---------- */
  const adminHtml = await (await fetch(`${BASE}/admin`)).text();
  check("관리자 화면에 발주 알림센터 기능 추가 안 됨", !adminHtml.includes("알림센터") && !adminHtml.includes("/api/desk"));

  // Python(PC 프로그램) 통합 테스트용 계정/주문 정보 전달
  writeFileSync("desk-e2e.json", JSON.stringify({ base: BASE, staff: [{ username: "cidesk1", pin: "246813" }, { username: "cidesk2", pin: "135792" }] }));

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
