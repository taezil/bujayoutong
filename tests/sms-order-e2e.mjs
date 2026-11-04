// 관리자 '주문 입력' · 문자 붙여넣기: 거래처 찾기 → 품목 맞추기 → 못 찾은 품목 직접 고르기(연관어 저장) → 주문 접수 → 다시 붙여넣으면 자동
import { execFileSync } from "node:child_process";
import { pbkdf2Sync } from "node:crypto";
import { writeFileSync } from "node:fs";
import { chromium } from "playwright";

const BASE = (process.argv[2] || "http://localhost:4173").replace(/\/$/, "");
const results = [];
let failed = 0;
const check = (name, ok, detail = "") => { results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`); if (!ok) failed += 1; console.log(results.at(-1)); };

async function main() {
  const salt = "ci-admin-salt";
  const hash = pbkdf2Sync("ci-admin-password", salt, 100000, 32, "sha256").toString("hex");
  execFileSync("npx", ["wrangler", "d1", "execute", "bujafood-db", "--local", "--command", `INSERT OR REPLACE INTO admin_credentials (id, salt, hash) VALUES (1, '${salt}', '${hash}');`], { stdio: "ignore" });
  const login = await fetch(`${BASE}/api/admin/login`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ username: "admin", password: "ci-admin-password" }) });
  const cookie = (login.headers.getSetCookie?.() ?? [])[0]?.split(";")[0] ?? "";
  const store = await (await fetch(`${BASE}/api/store?all=1`, { headers: { cookie } })).json();
  const core = (n) => n.replace(/\([^)]*\)/g, "").replace(/\s+/g, "");
  const plain = store.products.filter((p) => !p.hidden && !p.soldout && p.packOptions.length >= 1 && /^[가-힣]{3,8}$/.test(core(p.name)));
  const unique = plain.filter((p) => plain.filter((q) => core(q.name).includes(core(p.name)) || core(p.name).includes(core(q.name))).length === 1);
  const [pA, pB, pTarget, pTeach] = [unique[3], unique[11], unique[20], unique[25]];
  const sms = `120-13\n${core(pA.name)}2.${core(pB.name)}1.박스요.동전어묵1봉`;

  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 1000 } });
  await context.addCookies([{ name: cookie.split("=")[0], value: cookie.slice(cookie.indexOf("=") + 1), url: BASE }]);
  const page = await context.newPage();
  const dialogs = [];
  page.on("dialog", (d) => { dialogs.push(d.message()); void d.accept(); });
  try {
    await page.goto("/admin");
    await page.getByRole("button", { name: /주문 입력/ }).first().click();
    const box = page.locator(".sms-paste");
    await box.waitFor({ timeout: 20000 });
    check("관리자 메뉴에 '주문 입력' + 문자 붙여넣기", true);

    await box.locator("textarea").fill(sms);
    await box.getByRole("button", { name: "문자 읽기" }).click();
    await box.locator(".sms-row").first().waitFor({ timeout: 20000 });
    const note = await box.locator(".sms-note").first().innerText();
    const selected = await page.locator(".manual-customer").inputValue();
    check("문자 첫 줄 120-13 → 거래처 자동 선택", selected === "C-ERP-00124" && note.includes("120-13"), `${selected} / ${note}`);
    const rows = box.locator(".sms-row");
    check("품목 3줄로 나눔 ('1.박스' 처럼 떨어진 단위는 앞 품목에 붙임)", (await rows.count()) === 3, (await box.locator(".sms-raw code").allInnerTexts()).join(" | "));
    const rowA = rows.nth(0), rowB = rows.nth(1), rowX = rows.nth(2);
    check(`'${core(pA.name)}2' → ${pA.name} 자동, 수량 2`, (await rowA.getAttribute("class")).includes("s-auto") && (await rowA.locator(".sms-product select").inputValue()) === pA.id && (await rowA.locator(".sms-qty input").inputValue()) === "2");
    check(`'${core(pB.name)}1.박스요' → ${pB.name} 자동, 수량 1 ('요' 무시)`, (await rowB.getAttribute("class")).includes("s-auto") && (await rowB.locator(".sms-qty input").inputValue()) === "1");
    const xClass = await rowX.getAttribute("class");
    check("'동전어묵1봉' → 자동으로 넣지 않음(빨강 또는 노랑 확인)", !xClass.includes("s-auto"), xClass);
    await page.screenshot({ path: "desk-shot-sms-1-read.png" });

    // 못 찾은 품목 직접 검색해서 고르기 → 연관어 저장 예정 표시
    await rowX.locator(".sms-search input").fill(pTarget.name.slice(0, 4));
    await rowX.locator(".sms-search-list button", { hasText: pTarget.name }).first().click();
    await rowX.locator(".sms-learn", { hasText: "저장됨" }).waitFor({ timeout: 10000 });
    check("직접 고르면 주문 전에 바로 연관어 저장", (await rowX.locator(".sms-learn").innerText()).includes("동전어묵"));
    const ctxNow = await (await fetch(`${BASE}/api/admin/orders`, { method: "POST", headers: { cookie, "content-type": "application/json", origin: BASE }, body: JSON.stringify({ action: "sms-context", customerId: "" }) })).json();
    check("주문 접수 전 서버에 연관어 있음", ctxNow.aliases.some((a) => a.alias === "동전어묵" && a.productId === pTarget.id), JSON.stringify(ctxNow.aliases).slice(0, 200));
    await box.getByRole("button", { name: /주문 목록에 담기/ }).click();
    const items = await page.locator(".manual-items").innerText();
    check("주문 목록에 3품목 담김", items.includes(pA.name) && items.includes(pB.name) && items.includes(pTarget.name), items.replace(/\n/g, " "));
    await page.getByRole("button", { name: "이 주문 접수" }).click();
    await page.locator(".manual-submitted").waitFor({ timeout: 20000 });
    check("주문 접수 완료 안내", (await page.locator(".manual-submitted").innerText()).includes("접수 완료"));
    const orders = (await (await fetch(`${BASE}/api/admin/orders`, { headers: { cookie } })).json()).orders;
    const order = orders.find((o) => o.customerId === "C-ERP-00124" && o.source === "admin");
    const names = (order?.items ?? []).map((i) => `${i.productName}×${i.quantity}`);
    check("실제 주문 저장(거래처·품목·수량)", Boolean(order) && names.includes(`${pA.name}×2`) && names.includes(`${pB.name}×1`) && names.includes(`${pTarget.name}×1`), names.join(", "));

    // 같은 문자를 또 넣으면 중복 주문 경고
    dialogs.length = 0;
    await box.locator("textarea").fill(sms);
    await box.getByRole("button", { name: "문자 읽기" }).click();
    await box.locator(".sms-row").nth(2).waitFor();
    await box.getByRole("button", { name: /주문 목록에 담기/ }).click();
    await page.getByRole("button", { name: "이 주문 접수" }).click();
    await page.waitForTimeout(1500);
    check("같은 날 같은 품목 다시 접수 → 중복 경고", dialogs.some((m) => m.includes("이미 있습니다") && m.includes("겹치는 품목 3개")), dialogs.join(" / ").slice(0, 300));
    const dupApi = await fetch(`${BASE}/api/admin/orders`, { method: "POST", headers: { cookie, "content-type": "application/json", origin: BASE }, body: JSON.stringify({ action: "create-order", customerId: "C-ERP-00124", items: [{ productId: pA.id, optionLabel: pA.packOptions[0].label, quantity: 1 }] }) });
    check("API도 확인 없이는 중복 주문 막음(409)", dupApi.status === 409 && (await dupApi.json()).duplicate === true, String(dupApi.status));

    // 수량 없는 품목은 확인 표시
    await box.locator("textarea").fill(`120-13\n${core(pA.name)}`);
    await box.getByRole("button", { name: "문자 읽기" }).click();
    await page.waitForTimeout(800);
    const noQty = box.locator(".sms-row").first();
    check("수량 없는 품목 → 노랑 + '수량 확인' 표시", (await noQty.getAttribute("class")).includes("s-pick") && (await noQty.locator(".sms-flag.q").count()) === 1);

    // 다시 붙여넣으면 연관어로 자동
    await box.locator("textarea").fill("120-13\n동전어묵 3봉");
    await box.getByRole("button", { name: "문자 읽기" }).click();
    await box.locator(".sms-row").first().waitFor();
    const again = box.locator(".sms-row").first();
    check("다음부터 '동전어묵' 자동으로 찾음(연관어)", (await again.getAttribute("class")).includes("s-auto") && (await again.locator(".sms-product select").inputValue()) === pTarget.id && (await again.locator(".sms-qty input").inputValue()) === "3");
    await page.screenshot({ path: "desk-shot-sms-2-alias.png" });

    // 연관어 관리: 주문 없이 미리 가르치기 · 목록 · 삭제
    await box.getByRole("button", { name: "연관어 관리" }).click();
    const add = box.locator(".sms-alias-add");
    await add.waitFor({ timeout: 10000 });
    await add.locator("input").first().fill("테스트별칭");
    await add.locator(".sms-search input").fill(pTeach.name.slice(0, 4));
    await add.locator(".sms-search-list button", { hasText: pTeach.name }).first().click();
    await add.getByRole("button", { name: "연관어 저장" }).click();
    await box.locator(".sms-aliases li", { hasText: "테스트별칭" }).first().waitFor({ timeout: 10000 });
    await box.locator("textarea").fill("120-13\n테스트별칭2박스");
    await box.getByRole("button", { name: "문자 읽기" }).click();
    await page.waitForTimeout(1000);
    const taught = box.locator(".sms-row").first();
    check("주문 없이 가르친 연관어로 자동", (await taught.getAttribute("class")).includes("s-auto") && (await taught.locator(".sms-product select").inputValue()) === pTeach.id && (await taught.locator(".sms-qty input").inputValue()) === "2");
    const aliasList = box.locator(".sms-aliases li", { hasText: "동전어묵" });
    await aliasList.first().waitFor({ timeout: 10000 });
    check("연관어 관리 목록에 표시", (await aliasList.count()) >= 1, await box.locator(".sms-aliases").innerText());
    const beforeDelete = await aliasList.count();
    await aliasList.first().getByRole("button", { name: "삭제" }).click();
    await page.waitForTimeout(800);
    check("연관어 삭제", (await aliasList.count()) === beforeDelete - 1, `${beforeDelete} → ${await aliasList.count()}`);

    // 데이터 백업: 지금 백업 → 목록 → 내려받기(세션 토큰은 빠짐)
    const made = await fetch(`${BASE}/api/admin/backup`, { method: "POST", headers: { cookie, "content-type": "application/json", origin: BASE }, body: "{}" });
    const madeBody = await made.json();
    check("지금 백업 만들기", made.ok && madeBody.counts?.products > 0 && madeBody.counts?.orders > 0, JSON.stringify(madeBody).slice(0, 200));
    const list = await (await fetch(`${BASE}/api/admin/backup`, { headers: { cookie } })).json();
    check("백업 목록에 표시", list.backups.some((b) => b.key === madeBody.key), String(list.backups.length));
    const dl = await fetch(`${BASE}/api/admin/backup?key=${encodeURIComponent(madeBody.key)}`, { headers: { cookie } });
    const { gunzipSync } = await import("node:zlib");
    const dump = JSON.parse(gunzipSync(Buffer.from(await dl.arrayBuffer())).toString("utf8"));
    check("백업 파일 내용(상품·주문 있음, 로그인 세션 없음)", dump.tables.products.rows.length > 0 && dump.tables.order_items.rows.length > 0 && !Object.keys(dump.tables).some((t) => /session/i.test(t)), Object.keys(dump.tables).length + " tables");
    const anon = await fetch(`${BASE}/api/admin/backup?key=${encodeURIComponent(madeBody.key)}`);
    const viaPhoto = await fetch(`${BASE}/api/photo?id=${encodeURIComponent(madeBody.key)}`, { headers: { cookie } });
    check("로그인 없이/사진 주소로는 백업 못 받음", anon.status === 403 && viaPhoto.status === 404, `${anon.status}/${viaPhoto.status}`);
    await page.getByRole("button", { name: /설정/ }).first().click();
    await page.locator(".adm-backup-list li").first().waitFor({ timeout: 10000 });
    check("설정 화면에 데이터 백업 카드", (await page.locator(".adm-backup").innerText()).includes("마지막 백업"));
    await page.locator(".adm-backup").screenshot({ path: "desk-shot-backup.png" });
  } catch (error) {
    check("문자 주문 시나리오 진행", false, String(error.message || error).slice(0, 400));
    await page.screenshot({ path: "desk-shot-sms-fail.png", fullPage: true }).catch(() => {});
  } finally {
    await browser.close();
  }
  writeFileSync("sms-summary.txt", `${results.length - failed}/${results.length} passed\n${results.join("\n")}\n`);
  if (failed) process.exit(1);
}
main().catch((e) => { console.error(e); writeFileSync("sms-summary.txt", `CRASH ${String(e?.stack || e).slice(0, 1200)}\n${results.join("\n")}\n`); process.exit(1); });
