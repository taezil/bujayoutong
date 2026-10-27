// 거래처 로그인/권한 end-to-end 점검 (CI에서 vite preview 로컬 Worker + 로컬 D1 대상으로 실행)
// 사용: node tests/auth-e2e.mjs http://localhost:4173
import { execFileSync } from "node:child_process";
import { pbkdf2Sync } from "node:crypto";
import { writeFileSync } from "node:fs";

const BASE = (process.argv[2] || "http://localhost:4173").replace(/\/$/, "");
const results = [];
let failed = 0;

function check(name, ok, detail = "") {
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failed += 1;
  console.log(results[results.length - 1]);
}

function sql(command) {
  return execFileSync("npx", ["wrangler", "d1", "execute", "bujafood-db", "--local", "--json", "--command", command], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

class Client {
  constructor() { this.cookies = new Map(); }
  header() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "); }
  async req(path, init = {}) {
    const headers = new Headers(init.headers || {});
    if (this.cookies.size) headers.set("cookie", this.header());
    if (init.method && init.method !== "GET") headers.set("origin", BASE);
    if (init.json !== undefined) {
      headers.set("content-type", "application/json");
      init.body = JSON.stringify(init.json);
    }
    const res = await fetch(BASE + path, { ...init, headers, redirect: "manual" });
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair, ...attrs] = raw.split(";");
      const idx = pair.indexOf("=");
      const key = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      const maxAge = attrs.map((a) => a.trim().toLowerCase()).find((a) => a.startsWith("max-age="));
      if (!value || maxAge === "max-age=0") this.cookies.delete(key);
      else this.cookies.set(key, value);
    }
    return res;
  }
  async json(path, init) {
    const res = await this.req(path, init);
    let body = null;
    try { body = await res.json(); } catch {}
    return { status: res.status, body, res };
  }
}

async function main() {
  const anon = new Client();

  // 최초 요청으로 DB 초기화(스키마/카탈로그/테스트 계정)가 끝날 때까지 대기
  for (let i = 0; i < 30; i += 1) {
    const r = await anon.json("/api/customer/status");
    if (r.status === 200) break;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  /* ---------- 1~3. 비로그인 차단 ---------- */
  const home = await anon.req("/");
  const homeHtml = await home.text();
  check("비로그인 GET / → 200", home.status === 200, `status ${home.status}`);
  check("비로그인 / 화면은 로그인 화면", homeHtml.includes("거래처 전용 주문"));

  for (const path of ["/api/store", "/api/store?all=1", "/api/store?catalogPhotoReviewAll=1", "/api/store?photoMap=1&token=buja-photo-20261025-f6e3d9a4", "/api/customer/dashboard", "/api/orders"]) {
    const r = await anon.req(path);
    check(`비로그인 ${path} → 401`, r.status === 401, `status ${r.status}`);
  }
  const photo = await anon.req("/api/photo?id=category-frozen-seafood-v2.webp");
  check("비로그인 /api/photo → 401", photo.status === 401, `status ${photo.status}`);

  const priceList = await anon.req("/price-list");
  check("/price-list → / 리다이렉트", [301, 302, 303, 307, 308].includes(priceList.status) && new URL(priceList.headers.get("location") || "", BASE).pathname === "/",
    `status ${priceList.status} location ${priceList.headers.get("location")}`);

  /* ---------- 4. 로그인 ---------- */
  const wrong = await anon.json("/api/customer/login", { method: "POST", json: { identifier: "12013", password: "99999" } });
  check("틀린 비밀번호 → 401", wrong.status === 401, JSON.stringify(wrong.body));

  const customer = new Client();
  const login = await customer.json("/api/customer/login", { method: "POST", json: { identifier: "12013", password: "12013" } });
  check("12013 / 12013 로그인 성공", login.status === 200 && customer.cookies.size > 0, `${login.status} ${JSON.stringify(login.body)}`);

  const hyphen = new Client();
  const hyphenLogin = await hyphen.json("/api/customer/login", { method: "POST", json: { identifier: "120-13", password: "120-13" } });
  check("120-13 / 120-13 (하이픈 입력)도 로그인", hyphenLogin.status === 200, `${hyphenLogin.status} ${JSON.stringify(hyphenLogin.body)}`);

  const status = await customer.json("/api/customer/status");
  const me = status.body?.customer;
  check("로그인 상태 = 거래처 00124", status.body?.authenticated === true && me?.code === "00124", JSON.stringify(me));
  check("내정보 데이터(업체명/사업자번호/주소/핸드폰)", Boolean(me?.name && me?.businessNumber && me?.address && me?.phone), JSON.stringify(me));

  /* ---------- 5. 로그인 후 상품 데이터 ---------- */
  const store = await customer.json("/api/store");
  const products = store.body?.products ?? [];
  check("로그인 후 /api/store → 200 + 상품", store.status === 200 && products.length > 0, `status ${store.status}, products ${products.length}`);
  const maint = await customer.req("/api/store?catalogPhotoReviewAll=1");
  check("거래처는 사진점검용 API 불가(403)", maint.status === 403, `status ${maint.status}`);
  const photoAuthed = await customer.req("/api/photo?id=does-not-exist.webp");
  check("로그인 후 /api/photo 접근 가능(없는 키는 404)", photoAuthed.status === 404, `status ${photoAuthed.status}`);

  const names = products.map((p) => String(p.name)).filter((n) => n.length >= 3).slice(0, 80);
  const leaked = names.filter((n) => homeHtml.includes(n));
  check("비로그인 HTML에 상품명 없음", leaked.length === 0 && !homeHtml.includes("packOptions"), leaked.slice(0, 5).join(", "));

  const deadPriceApi = await anon.req("/api/price-list");
  check("사용 중지된 /api/price-list 는 데이터 없음", deadPriceApi.status !== 200, `status ${deadPriceApi.status}`);

  /* ---------- 앱 주문 접수 (품목 일괄 조회/수량 이력 일괄 조회) ---------- */
  const sellable = products.filter((p) => !p.soldout && (p.packOptions ?? []).length).slice(0, 3);
  const orderItems = sellable.map((p) => ({ productId: p.id, optionLabel: p.packOptions[0].label, quantity: p.packOptions[0].step || 1 }));
  for (let round = 1; round <= 4; round += 1) {
    const placed = await customer.json("/api/orders", { method: "POST", json: { items: orderItems, note: `ci ${round}` } });
    if (round === 1) check("앱 주문 접수(3품목)", placed.status === 200 && placed.body?.order?.itemCount === 3, `${placed.status} ${JSON.stringify(placed.body).slice(0, 200)}`);
  }
  const big = await customer.json("/api/orders", { method: "POST", json: { items: orderItems.map((i) => ({ ...i, quantity: i.quantity * 40 })) } });
  check("평소보다 많은 수량 경고(주문 이력 기반)", big.status === 409 && (big.body?.warnings ?? []).length === 3, `${big.status} ${JSON.stringify(big.body).slice(0, 200)}`);
  const badOption = await customer.json("/api/orders", { method: "POST", json: { items: [{ productId: sellable[0].id, optionLabel: "없는옵션", quantity: 1 }] } });
  check("없는 옵션 주문 거절", badOption.status === 400, `${badOption.status}`);

  /* ---------- 6. 세션 유지 (매 요청 삭제 버그 없음) ---------- */
  let stillIn = true;
  for (let i = 0; i < 3; i += 1) {
    const r = await customer.json("/api/customer/status");
    if (r.body?.authenticated !== true) stillIn = false;
  }
  check("반복 요청에도 로그인 유지", stillIn);

  /* ---------- 9. 다중 배송처 / 권한 ---------- */
  let linkedOk = false;
  try {
    sql(`INSERT OR IGNORE INTO customers (id,code,name,phone,business_number,address,store_phone,region,price_group,active) VALUES
      ('C-CI-8515','99001','테스트식당 85-15','010-0000-0001','111-11-11111','테스트 주소 1','', '1단지','A',1),
      ('C-CI-7302','99002','테스트급식소 73-2','010-0000-0002','222-22-22222','테스트 주소 2','', '1단지','A',1),
      ('C-CI-OTHER','99003','남의식당 9-9','010-0000-0003','333-33-33333','테스트 주소 3','', '1단지','A',1);
      INSERT OR IGNORE INTO customer_user_customers(customer_user_id,customer_id,sort_order)
        SELECT id,'C-CI-8515',1 FROM customer_users WHERE username='12013';
      INSERT OR IGNORE INTO customer_user_customers(customer_user_id,customer_id,sort_order)
        SELECT id,'C-CI-7302',2 FROM customer_users WHERE username='12013';
      INSERT OR REPLACE INTO customer_delivery_locations(id,customer_id,name,address,phone,note,active,sort_order)
        SELECT 'DL-CI-11813',id,'118-13','테스트 추가배송처','','같이 운영',1,0
        FROM customers WHERE code='00124' LIMIT 1;`);
    linkedOk = true;
  } catch (error) {
    check("테스트용 배송처 연결(wrangler d1 execute)", false, String(error.stderr || error.message).slice(0, 300));
  }
  if (linkedOk) {
    const s2 = await customer.json("/api/customer/status");
    check("연결된 배송처 3곳 조회", (s2.body?.locations ?? []).length === 3, JSON.stringify((s2.body?.locations ?? []).map((l) => l.name)));
    check("엑셀에 없는 추가 배송처 118-13 조회", (s2.body?.deliveryLocations ?? []).some((l) => l.name === "118-13"), JSON.stringify(s2.body?.deliveryLocations ?? []));
    const deny = await customer.json("/api/customer/switch", { method: "POST", json: { customerId: "C-CI-OTHER" } });
    check("연결 안 된 거래처로 전환 거부(403)", deny.status === 403, `${deny.status} ${JSON.stringify(deny.body)}`);
    const after = await customer.json("/api/customer/status");
    check("거부 후에도 현재 배송처 그대로", after.body?.customer?.code === "00124");
    const ok = await customer.json("/api/customer/switch", { method: "POST", json: { customerId: "C-CI-8515" } });
    check("연결된 배송처로 전환 허용", ok.status === 200 && ok.body?.customer?.id === "C-CI-8515", `${ok.status} ${JSON.stringify(ok.body?.customer)}`);
    const anonSwitch = await anon.json("/api/customer/switch", { method: "POST", json: { customerId: "C-CI-8515" } });
    check("비로그인 전환 요청 → 401", anonSwitch.status === 401, `${anonSwitch.status}`);
    await customer.json("/api/customer/switch", { method: "POST", json: { customerId: "C-ERP-00124" } });
    const back = await customer.json("/api/customer/status");
    const backId = back.body?.customer?.id;
    if (backId !== "C-ERP-00124") {
      // 운영 DB처럼 00124가 다른 id로 이미 있던 경우
      const first = (back.body?.locations ?? []).find((l) => l.code === "00124");
      if (first) await customer.json("/api/customer/switch", { method: "POST", json: { customerId: first.id } });
    }
  }

  /* ---------- 관리자 ---------- */
  let adminReady = false;
  let adminClient = null;
  try {
    const salt = "ci-admin-salt";
    const hash = pbkdf2Sync("ci-admin-password", salt, 100000, 32, "sha256").toString("hex");
    sql(`INSERT OR REPLACE INTO admin_credentials (id, salt, hash) VALUES (1, '${salt}', '${hash}');`);
    adminReady = true;
  } catch (error) {
    check("테스트 관리자 비밀번호 설정", false, String(error.stderr || error.message).slice(0, 300));
  }
  if (adminReady) {
    const admin = new Client();
    adminClient = admin;
    const al = await admin.json("/api/admin/login", { method: "POST", json: { username: "admin", password: "ci-admin-password" } });
    check("관리자 로그인", al.status === 200, `${al.status} ${JSON.stringify(al.body)}`);
    const adminStore = await admin.json("/api/store?all=1");
    check("관리자 /api/store?all=1 → 200", adminStore.status === 200 && (adminStore.body?.products ?? []).length > 0, `${adminStore.status}`);
    const adminMaint = await admin.req("/api/store?health=1");
    check("관리자는 점검용 API 허용", adminMaint.status === 200, `${adminMaint.status}`);
    const users = await admin.json("/api/admin/customer-users");
    check("관리자 거래처계정 목록", users.status === 200 && (users.body?.users ?? []).some((u) => u.username === "12013"), `${users.status}`);
    const plan = await admin.json("/api/admin/customer-users", { method: "POST", json: { action: "provision-preview" } });
    const pending = plan.body?.pending ?? [];
    check("일괄생성 미리보기", plan.status === 200 && Array.isArray(pending), `${plan.status} pending ${pending.length}`);
    const p8515 = pending.find((r) => r.customerId === "C-CI-8515");
    check("이미 연결된 배송처(85-15)는 일괄생성 대상 아님", !p8515);
    const pOther = pending.find((r) => r.customerId === "C-CI-OTHER");
    check("미연결 거래처 9-9 → 아이디 99", pOther?.loginId === "99", JSON.stringify(pOther));
    // 썸네일: 관리자가 원본+썸네일 업로드 → 거래처는 size=thumb 로 썸네일 수신, 없으면 원본(짧은 캐시)
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    const upForm = new FormData();
    upForm.append("file", new Blob([png], { type: "image/png" }), "a.png");
    const up = await admin.json("/api/photo", { method: "POST", body: upForm });
    const photoUrl = up.body?.url || "";
    check("관리자 사진 업로드", up.status === 200 && photoUrl.startsWith("/api/photo?id="), `${up.status} ${JSON.stringify(up.body)}`);
    const before = await customer.req(`${photoUrl}&size=thumb`);
    check("썸네일 없으면 원본을 짧은 캐시로", before.status === 200 && (before.headers.get("cache-control") || "").includes("max-age=600"), `${before.status} ${before.headers.get("cache-control")}`);
    const thumbForm = new FormData();
    const tiny = Buffer.from("UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=", "base64");
    thumbForm.append("file", new Blob([tiny], { type: "image/webp" }), "t.webp");
    thumbForm.append("thumbOf", photoUrl.split("id=")[1]);
    const tu = await admin.json("/api/photo", { method: "POST", body: thumbForm });
    check("썸네일 업로드", tu.status === 200, `${tu.status} ${JSON.stringify(tu.body)}`);
    const after = await customer.req(`${photoUrl}&size=thumb`);
    check("썸네일 수신(webp, 장기 캐시)", after.status === 200 && after.headers.get("content-type") === "image/webp" && (after.headers.get("cache-control") || "").includes("immutable"), `${after.status} ${after.headers.get("content-type")}`);
    const etag = after.headers.get("etag");
    const again = await customer.req(`${photoUrl}&size=thumb`, { headers: { "if-none-match": etag } });
    check("같은 사진 재요청 → 304", again.status === 304, `${again.status}`);
    const list = await admin.json("/api/photo?thumbList=1");
    check("썸네일 목록(관리자)", list.status === 200 && (list.body?.thumbs ?? []).includes(photoUrl.split("id=")[1]), `${list.status}`);
    const listDenied = await customer.req("/api/photo?thumbList=1");
    check("썸네일 목록은 거래처 불가", listDenied.status === 403, `${listDenied.status}`);
    const badThumb = new FormData();
    badThumb.append("file", new Blob([tiny], { type: "image/webp" }), "t.webp");
    badThumb.append("thumbOf", "no-such-original.webp");
    const bt = await admin.json("/api/photo", { method: "POST", body: badThumb });
    check("원본 없는 썸네일 거절", bt.status === 400, `${bt.status}`);

    const adminPage = await admin.req("/admin");
    check("관리자 /admin 페이지 200", adminPage.status === 200, `${adminPage.status}`);
    const accountsPage = await admin.req("/admin/accounts");
    check("관리자 /admin/accounts 페이지 200", accountsPage.status === 200, `${accountsPage.status}`);
  }

  /* ---------- 브라우저: 화면 흐름 ---------- */
  const { chromium, devices } = await import("playwright");
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...devices["Pixel 7"], baseURL: BASE });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  const page = await context.newPage();
  const productRequests = [];
  page.on("response", (r) => { if (r.url().includes("/api/store")) productRequests.push(r.status()); });

  try {
    await page.goto("/");
    await page.getByRole("heading", { name: "거래처 전용 주문" }).waitFor({ timeout: 20000 });
    await page.waitForTimeout(1500);
    check("[화면] 비로그인 / → 로그인 화면만", (await page.locator(".od-card, .od-search").count()) === 0 && productRequests.every((code) => code === 401),
      `cards ${await page.locator(".od-card").count()}, store responses ${JSON.stringify(productRequests)}`);
    const idMode = await page.locator('input[name="username"]').getAttribute("inputmode");
    const pwMode = await page.locator('input[name="password"]').getAttribute("inputmode");
    check("[화면] 아이디/비밀번호 숫자 키패드", idMode === "numeric" && pwMode === "numeric", `${idMode}/${pwMode}`);

    const t0 = Date.now();
    await page.reload();
    await page.locator('input[name="username"]').waitFor({ timeout: 20000 });
    check("[속도] 비로그인 로그인화면 표시 3초 이내", Date.now() - t0 < 3000, `${Date.now() - t0}ms`);
    await page.fill('input[name="username"]', "12013");
    await page.fill('input[name="password"]', "12013");
    await page.getByRole("button", { name: "로그인" }).click();
    await page.locator(".od-search input").waitFor({ timeout: 30000 });
    check("[화면] 로그인 후 / 상품 주문화면", page.url() === `${BASE}/`, page.url());

    const t1 = Date.now();
    await page.reload();
    await page.locator(".od-search input").waitFor({ timeout: 30000 });
    check("[화면] 새로고침해도 로그인 유지", true);
    check("[속도] 로그인 상태 새로고침 → 상품화면 3초 이내", Date.now() - t1 < 3000, `${Date.now() - t1}ms`);

    const banner = page.locator(".od-location-banner");
    await banner.waitFor({ timeout: 10000 });
    check("[화면] 현재 발주처 120-13 표시", (await banner.innerText()).includes("120-13"), await banner.innerText());

    // 관리자 단계에서 카탈로그 보정이 돌았을 수 있으므로 지금 화면 기준 상품으로 다시 고름
    const fresh = await page.evaluate(async () => (await (await fetch("/api/store", { cache: "no-store" })).json()).products);
    const available = fresh.filter((p) => !p.soldout && !p.hidden && p.name.length >= 3);
    async function addProduct(product) {
      await page.locator(".od-search input").fill(product.name);
      const card = page.locator(".od-card", { hasText: product.name }).first();
      await card.waitFor({ timeout: 10000 });
      await card.locator('button[aria-label$="수량 늘리기"]').first().click();
      await page.locator(".od-search input").fill("");
    }
    async function copiedOrder() {
      await page.locator(".od-cart-icon").click();
      await page.getByRole("button", { name: /주문내용 복사|복사됨/ }).click();
      await page.waitForTimeout(300);
      const text = await page.evaluate(() => navigator.clipboard.readText());
      await page.locator('.od-cart button[aria-label="닫기"]').first().click();
      return text;
    }
    async function cartCount() {
      const label = await page.locator(".od-cart-icon").getAttribute("aria-label");
      return Number((label || "").replace(/[^0-9]/g, ""));
    }
    async function switchTo(label) {
      await page.locator(".od-location-banner").click();
      await page.locator(".od-location-options button", { hasText: label }).click();
      await page.locator(".od-location-sheet").waitFor({ state: "detached", timeout: 10000 });
      await page.waitForFunction((l) => document.querySelector(".od-location-banner")?.textContent?.includes(l), label, { timeout: 10000 });
    }

    await addProduct(available[0]);
    check("[화면] 120-13 장바구니 1품목", (await cartCount()) === 1, String(await cartCount()));
    const textA = await copiedOrder();
    check("[화면] 문자 제목 [120-13 발주]", textA.startsWith("[120-13 발주]") && textA.includes(available[0].name), textA.split("\n")[0]);

    await switchTo("118-13");
    check("[화면] 추가 배송처 118-13 전환 시 장바구니 비어 있음", (await cartCount()) === 0, String(await cartCount()));
    await addProduct(available[3]);
    const textExtra = await copiedOrder();
    check("[화면] 추가 배송처 문자 제목 [118-13 발주]", textExtra.startsWith("[118-13 발주]") && textExtra.includes(available[3].name) && !textExtra.includes(available[0].name), textExtra.split("\n")[0]);

    await switchTo("120-13");
    const textAExtraBack = await copiedOrder();
    check("[화면] 추가 배송처에서 기본 120-13으로 돌아오면 장바구니 유지", (await cartCount()) === 1 && textAExtraBack.includes(available[0].name) && !textAExtraBack.includes(available[3].name), `${await cartCount()}품목`);

    await switchTo("85-15");
    check("[화면] 85-15로 전환 시 장바구니 비어 있음", (await cartCount()) === 0, String(await cartCount()));
    await addProduct(available[1]);
    await addProduct(available[2]);
    const textB = await copiedOrder();
    check("[화면] 85-15 문자 제목 [85-15 발주] + 85-15 상품만", textB.startsWith("[85-15 발주]") && textB.includes(available[1].name) && !textB.includes(available[0].name), textB.split("\n")[0]);

    await switchTo("120-13");
    const textA2 = await copiedOrder();
    check("[화면] 120-13으로 돌아오면 기존 장바구니 유지", (await cartCount()) === 1 && textA2.includes(available[0].name) && !textA2.includes(available[1].name), `${await cartCount()}품목`);

    await page.getByRole("button", { name: "내정보" }).click();
    const account = page.locator(".od-account-card");
    await account.waitFor();
    const accountText = await account.innerText();
    check("[화면] 내정보 업체명/사업자번호/주소/핸드폰", ["사업자번호", "주소", "핸드폰"].every((k) => accountText.includes(k)) && accountText.includes("120-13"), accountText.slice(0, 200).replace(/\n/g, " | "));
    await account.getByRole("button", { name: "로그아웃" }).click();
    await page.getByRole("heading", { name: "거래처 전용 주문" }).waitFor({ timeout: 20000 });
    await page.reload();
    await page.getByRole("heading", { name: "거래처 전용 주문" }).waitFor({ timeout: 20000 });
    check("[화면] 로그아웃 → 로그인 화면 (새로고침 후에도)", (await page.locator(".od-search").count()) === 0);

    await page.goto("/price-list");
    await page.getByRole("heading", { name: "거래처 전용 주문" }).waitFor({ timeout: 20000 });
    check("[화면] /price-list → / 로그인 화면", new URL(page.url()).pathname === "/", page.url());
  } catch (error) {
    check("[화면] 브라우저 시나리오 진행", false, String(error.message || error).slice(0, 400));
    await page.screenshot({ path: "e2e-failure.png", fullPage: true }).catch(() => {});
  }

  if (adminClient) {
    const adminContext = await browser.newContext({ baseURL: BASE });
    await adminContext.addCookies([...adminClient.cookies].map(([name, value]) => ({ name, value, url: BASE })));
    const adminPage = await adminContext.newPage();
    try {
      await adminPage.goto("/admin");
      const button = adminPage.getByRole("button", { name: "목록용 썸네일 만들기" });
      await button.waitFor({ timeout: 60000 });
      await button.click();
      const done = adminPage.locator(".adm-thumb-tool span", { hasText: /완료|이미 있습니다/ });
      await done.waitFor({ timeout: 240000 });
      const text = await done.innerText();
      const made = Number((text.match(/완료: (\d+)개/) || [])[1] || 0);
      check("[관리자] 썸네일 일괄 생성 버튼 동작", made > 0 || text.includes("이미 있습니다"), text);
      const second = await (async () => { await button.click(); await adminPage.waitForTimeout(500); await adminPage.locator(".adm-thumb-tool span", { hasText: /완료|이미 있습니다/ }).waitFor({ timeout: 120000 }); return adminPage.locator(".adm-thumb-tool span").innerText(); })();
      check("[관리자] 다시 누르면 없는 것만(이미 만든 건 건너뜀)", /이미 있습니다|완료: 0개/.test(second), second);
    } catch (error) {
      check("[관리자] 썸네일 도구 진행", false, String(error.message || error).slice(0, 300));
    }
  }
  await browser.close();

  /* ---------- 7. 로그아웃 후 서버 차단 ---------- */
  const lo = await customer.json("/api/customer/logout", { method: "POST" });
  check("로그아웃 API", lo.status === 200);
  const afterLogout = await customer.req("/api/store");
  check("로그아웃 후 /api/store → 401", afterLogout.status === 401, `${afterLogout.status}`);

  /* ---------- 로그인 시도 제한 ---------- */
  const brute = new Client();
  let last = null;
  for (let i = 0; i < 11; i += 1) {
    last = await brute.json("/api/customer/login", { method: "POST", json: { identifier: "77777", password: `x${i}x` } });
  }
  check("같은 아이디 반복 실패 시 일시 차단", String(last?.body?.error || "").includes("너무 많습니다"), JSON.stringify(last?.body));

  console.log("\n================ SUMMARY ================");
  console.log(results.join("\n"));
  console.log(`\n${results.length - failed}/${results.length} passed`);
  writeFileSync("e2e-summary.txt", `${results.length - failed}/${results.length} passed\n${results.join("\n")}\n`);
  if (failed) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  writeFileSync("e2e-summary.txt", `CRASH ${String(error?.stack || error).slice(0, 1500)}\n${results.join("\n")}\n`);
  process.exit(1);
});
