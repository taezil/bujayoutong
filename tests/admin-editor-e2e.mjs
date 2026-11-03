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
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check("휴대폰에서 관리자 화면 가로로 넘치지 않음", overflow <= 1, `${overflow}px`);
    await page.locator('input[type="search"]').first().fill(product.name);
    await page.locator(".c-name button", { hasText: product.name }).first().click();
    const editor = page.locator(".adm-editor");
    await editor.waitFor({ timeout: 20000 });
    // 뒤쪽 목록 페이지가 스크롤된 상태로 모달이 열리면 모바일 에뮬레이션에서 클릭 좌표가 어긋남 → 맨 위로
    await page.evaluate(() => window.scrollTo(0, 0));

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
    const closeBtn = editor.getByRole("button", { name: /B그룹 가격 닫기/ });
    const dbg = async () => closeBtn.evaluate((el) => {
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      const body = el.closest(".adm-editor-body");
      const chain = []; for (let n = el; n; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.transform !== "none" || cs.contain !== "none" || cs.position === "fixed" || cs.overflowY !== "visible") chain.push(`${n.className || n.tagName}[${cs.position} ${cs.transform !== "none" ? "T" : ""} ${cs.contain} ${cs.overflowY}]`); }
      return JSON.stringify({ r: [r.x, r.y, r.width, r.height].map(Math.round), hit: hit ? `${hit.tagName}.${hit.className}` : null, scrollY: window.scrollY, ih: innerHeight, vv: [visualViewport.offsetTop, visualViewport.height, visualViewport.scale], bodyTop: body?.scrollTop, bodyH: body?.clientHeight, docH: document.documentElement.scrollHeight, chain });
    });
    await closeBtn.click({ timeout: 8000 }).catch(async (e) => { throw new Error(`${await dbg()} :: ${String(e.message).slice(0, 200)}`); });
    check("빈 B그룹 가격 칸은 닫기 버튼으로 바로 닫힘", (await editor.locator(".adm-price-b").count()) === 0);
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
    await page.evaluate(() => window.scrollTo(0, 0));
    check("B가격 있는 상품은 열 때 B칸이 펼쳐져 있음", (await editor.locator(".adm-price-b").count()) >= 1);

    // 사진 3장(휴대폰 원본처럼 큰 사진) → 고르자마자 줄여서 올리기 시작, 저장은 바로
    const bigPhotos = await page.evaluate(async () => {
      const out = [];
      for (let i = 0; i < 3; i += 1) {
        const c = document.createElement("canvas"); c.width = 4000; c.height = 3000;
        const g = c.getContext("2d");
        for (let y = 0; y < 3000; y += 50) for (let x = 0; x < 4000; x += 50) { g.fillStyle = `hsl(${(x + y + i * 97) % 360},70%,${40 + ((x * y) % 30)}%)`; g.fillRect(x, y, 50, 50); }
        const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.95));
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let bin = "";
        for (let k = 0; k < bytes.length; k += 0x8000) bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(k, k + 0x8000)));
        out.push({ name: `big${i}.jpg`, mimeType: "image/jpeg", b64: btoa(bin) });
      }
      return out;
    });
    const sizes = bigPhotos.map((p) => Math.round(Buffer.from(p.b64, "base64").length / 1024));
    const photoRequests = [];
    page.on("request", (r) => { if (r.url().endsWith("/api/photo") && r.method() === "POST") photoRequests.push(r.postDataBuffer()?.length ?? 0); });
    await editor.locator(".adm-photos-add input").setInputFiles(bigPhotos.map((p) => ({ name: p.name, mimeType: p.mimeType, buffer: Buffer.from(p.b64, "base64") })));
    await editor.locator(".adm-photo-state.done").nth(2).waitFor({ timeout: 30000 });
    const t0 = Date.now();
    await page.getByRole("button", { name: "저장하기" }).click();
    await editor.waitFor({ state: "detached", timeout: 20000 });
    const saveMs = Date.now() - t0;
    const savedNow = (await (await fetch(`${BASE}/api/store?all=1`, { headers: { cookie } })).json()).products.find((p) => p.id === product.id);
    const newUrls = (savedNow.photos ?? []).slice(-3);
    const mainUploads = await Promise.all(newUrls.map(async (u) => Math.round((await (await fetch(`${BASE}${u}`, { headers: { cookie } })).arrayBuffer()).byteLength / 1024)));
    check("사진 고르자마자 올라감 → 저장 2초 이내", saveMs < 2000, `${saveMs}ms`);
    check("큰 사진은 줄여서 올림", mainUploads.length === 3 && mainUploads.every((kb) => kb > 0 && kb < sizes[0] / 2), `원본 ${sizes.join("/")}KB → 올린 크기 ${mainUploads.join("/")}KB`);
    const withPhotos = (await (await fetch(`${BASE}/api/store?all=1`, { headers: { cookie } })).json()).products.find((p) => p.id === product.id);
    check("사진 3장 추가 저장(대표 사진 유지)", (withPhotos.photos ?? []).length === (product.photos?.length || (product.photo ? 1 : 0)) + 3, JSON.stringify(withPhotos.photos?.length));
    await page.locator(".c-name button", { hasText: product.name }).first().click();
    await editor.waitFor();
    await page.evaluate(() => window.scrollTo(0, 0));
    page.once("dialog", (dialog) => void dialog.accept());
    await editor.getByRole("button", { name: /B그룹 가격 닫기/ }).click();
    check("값이 있으면 확인 후 지우고 닫힘", (await editor.locator(".adm-price-b").count()) === 0);
    await page.getByRole("button", { name: "저장하기" }).click();
    await editor.waitFor({ state: "detached", timeout: 20000 });
    const cleared = (await (await fetch(`${BASE}/api/store?all=1`, { headers: { cookie } })).json()).products.find((p) => p.id === product.id);
    check("닫고 저장하면 B그룹 가격 없음(기본 가격과 동일)", cleared.packOptions[0].priceB == null, JSON.stringify(cleared.packOptions[0]));
  } catch (error) {
    check("관리자 상품 수정 화면 진행", false, String(error.message || error).slice(0, 1500));
    await page.screenshot({ path: "desk-shot-editor-fail.png", fullPage: true }).catch(() => {});
  } finally {
    await browser.close();
  }
  writeFileSync("admin-editor-summary.txt", `${results.length - failed}/${results.length} passed\n${results.join("\n")}\n`);
  if (failed) process.exit(1);
}
main().catch((e) => { console.error(e); writeFileSync("admin-editor-summary.txt", `CRASH ${String(e?.stack || e).slice(0, 1200)}\n${results.join("\n")}\n`); process.exit(1); });
