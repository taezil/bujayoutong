// 관리자 상품 수정 화면: 단위·가격 단순화 / B그룹 가격 접기 / 행사가격·1단위 인분 제거 확인 (+ 스크린샷)
import { execFileSync } from "node:child_process";
import { pbkdf2Sync } from "node:crypto";
import { writeFileSync } from "node:fs";
import { chromium, devices } from "playwright";

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
  const [name, value] = [cookie.slice(0, cookie.indexOf("=")), cookie.slice(cookie.indexOf("=") + 1)];
  const store = await (await fetch(`${BASE}/api/store?all=1`, { headers: { cookie } })).json();
  const product = store.products.find((p) => p.packOptions?.length >= 1 && p.packOptions.every((o) => o.priceB == null) && p.packOptions[0].price >= 10000);

  const browser = await chromium.launch();
  const context = await browser.newContext({ ...devices["Pixel 7"], baseURL: BASE });
  await context.addCookies([{ name, value, url: BASE }]);
  const page = await context.newPage();
  try {
    await page.goto("/admin");
    await page.locator('input[type="search"]').first().fill(product.name);
    await page.locator(".c-name button", { hasText: product.name }).first().click();
    const editor = page.locator(".adm-editor");
    await editor.waitFor({ timeout: 20000 });

    const text = await editor.innerText();
    check("행사 가격 칸 없음", !text.includes("행사 가격"));
    check("1단위(봉지·팩) 기준 인분 칸 없음", !text.includes("1단위(봉지"));
    check("1박스 입수 수량·1박스 기준 인분은 유지", text.includes("1박스 입수 수량") && text.includes("1박스 기준 인분"));
    const row = editor.locator(".adm-unit-row.simple").first();
    const priceValue = await row.locator("input").nth(1).inputValue();
    check("가격에 쉼표 표시", priceValue === new Intl.NumberFormat("ko-KR").format(product.packOptions[0].price), priceValue);
    check("B그룹 가격 칸은 처음엔 접혀 있음", (await editor.locator(".adm-price-b").count()) === 0);
    check("규격·증가 단위는 세부 설정 안에 접혀 있음", !(await editor.locator(".adm-unit-more").evaluate((el) => el.open)));
    await page.screenshot({ path: "desk-shot-editor-1-basic.png", fullPage: false });
    await editor.locator(".adm-units").screenshot({ path: "desk-shot-editor-2-units.png" });

    await editor.getByRole("button", { name: /B그룹 가격 따로 정하기/ }).click();
    const bInput = editor.locator(".adm-price-b input").first();
    await bInput.fill(String(product.packOptions[0].price - 1000));
    check("B가격이 더 싸면 경고", (await editor.locator(".adm-price-b-warn").count()) === 1);
    const higher = product.packOptions[0].price + 3000;
    await bInput.fill(String(higher));
    check("B가격 쉼표 표시 + 경고 사라짐", (await bInput.inputValue()) === new Intl.NumberFormat("ko-KR").format(higher) && (await editor.locator(".adm-price-b-warn").count()) === 0, await bInput.inputValue());
    await editor.locator(".adm-units").screenshot({ path: "desk-shot-editor-3-priceb.png" });

    await page.getByRole("button", { name: "저장하기" }).click();
    await editor.waitFor({ state: "detached", timeout: 20000 });
    const after = await (await fetch(`${BASE}/api/store?all=1`, { headers: { cookie } })).json();
    const saved = after.products.find((p) => p.id === product.id);
    check("저장: B그룹 가격 반영, 기본 가격 그대로", saved.packOptions[0].priceB === higher && saved.packOptions[0].price === product.packOptions[0].price, JSON.stringify(saved.packOptions[0]));

    await page.locator(".c-name button", { hasText: product.name }).first().click();
    await editor.waitFor();
    check("B가격 있는 상품은 열 때 B칸이 펼쳐져 있음", (await editor.locator(".adm-price-b").count()) >= 1);
  } catch (error) {
    check("관리자 상품 수정 화면 진행", false, String(error.message || error).slice(0, 300));
    await page.screenshot({ path: "desk-shot-editor-fail.png", fullPage: true }).catch(() => {});
  } finally {
    await browser.close();
  }
  writeFileSync("admin-editor-summary.txt", `${results.length - failed}/${results.length} passed\n${results.join("\n")}\n`);
  if (failed) process.exit(1);
}
main().catch((e) => { console.error(e); writeFileSync("admin-editor-summary.txt", `CRASH ${String(e?.stack || e).slice(0, 1200)}\n${results.join("\n")}\n`); process.exit(1); });
