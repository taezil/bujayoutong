// 상품 엑셀: 내려받기 → (엑셀처럼 openpyxl 로 고쳐 저장) → 올리기 → 미리보기 → 반영 확인
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
  const storeNow = async () => (await (await fetch(`${BASE}/api/store?all=1`, { headers: { cookie } })).json());
  const before = await storeNow();
  const optionRows = before.products.reduce((n, p) => n + Math.max(1, p.packOptions.length), 0);
  const simple = before.products.filter((p) => p.packOptions.length === 1 && !p.hidden && !p.soldout && p.packOptions[0].price);
  const [pPrice, pName, pStatus, pB] = simple.slice(5, 9);
  const photoBefore = pPrice.photo;

  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: BASE, acceptDownloads: true, viewport: { width: 1280, height: 900 } });
  await context.addCookies([{ name: cookie.split("=")[0], value: cookie.slice(cookie.indexOf("=") + 1), url: BASE }]);
  const page = await context.newPage();
  try {
    await page.goto("/admin");
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /엑셀 내려받기/ }).click()]);
    check("엑셀 파일 이름", /^부자유통_상품목록_\d{8}\.xlsx$/.test(download.suggestedFilename()), download.suggestedFilename());
    await download.saveAs("excel-download.xlsx");

    // 엑셀처럼 저장되는 파일(공유 문자열)로 수정: openpyxl
    const py = `
import openpyxl, json, sys
wb = openpyxl.load_workbook("excel-download.xlsx")
ws = wb["상품목록"]
header = [c.value for c in ws[1]]
rows = list(ws.iter_rows(min_row=2, values_only=False))
col = {h: i for i, h in enumerate(header)}
info = {"header": header, "rows": len(rows), "sheets": wb.sheetnames}
targets = json.loads(sys.argv[1])
for r in rows:
    code = r[col["상품코드"]].value
    if code == targets["price"]: r[col["가격"]].value = targets["newPrice"]
    if code == targets["name"]: r[col["상품명"]].value = targets["newName"]
    if code == targets["status"]: r[col["상태"]].value = "품절"
    if code == targets["b"]: r[col["B그룹가격"]].value = "25,000"
ws.append(["NO-SUCH-CODE", "없는상품", "냉동식품", "", "", "박스", 1000])
wb.save("excel-upload.xlsx")
print(json.dumps(info, ensure_ascii=False))
`;
    const targets = { price: pPrice.id, newPrice: pPrice.packOptions[0].price + 1234, name: pName.id, newName: `${pName.name} (수정)`, status: pStatus.id, b: pB.id };
    const info = JSON.parse(execFileSync("python3", ["-c", py, JSON.stringify(targets)], { encoding: "utf8" }));
    check("엑셀 열 구성", info.header[0] === "상품코드" && info.header.includes("B그룹가격") && info.sheets.includes("사용법"), info.header.join(","));
    check("상품 단위 수만큼 줄 (전 품목)", info.rows === optionRows, `${info.rows} / ${optionRows}`);

    await page.locator(".adm-excel-upload input").setInputFiles("excel-upload.xlsx");
    const preview = page.locator(".adm-excel-preview");
    await preview.waitFor({ timeout: 20000 });
    const title = await preview.locator("h2").innerText();
    check("미리보기: 4개 상품 바뀜", title.includes("4개 상품"), title);
    const body = await preview.innerText();
    check("미리보기: 가격 변경 표시", body.includes(pPrice.name) && body.includes(new Intl.NumberFormat("ko-KR").format(targets.newPrice)));
    check("미리보기: 상품명·상태·B그룹가격 변경 표시", body.includes(targets.newName) && body.includes("품절") && body.includes("25,000원"));
    check("미리보기: 없는 상품코드 줄은 건너뜀 안내", body.includes("NO-SUCH-CODE"));
    check("반영 전에는 아무것도 안 바뀜", (await storeNow()).products.find((p) => p.id === pPrice.id).packOptions[0].price === pPrice.packOptions[0].price);
    await page.screenshot({ path: "desk-shot-excel-preview.png" });

    await preview.getByRole("button", { name: /개 상품 반영하기/ }).click();
    await preview.waitFor({ state: "detached", timeout: 60000 });
    const after = await storeNow();
    const find = (id) => after.products.find((p) => p.id === id);
    check("반영: 가격", find(pPrice.id).packOptions[0].price === targets.newPrice, String(find(pPrice.id).packOptions[0].price));
    check("반영: 상품명", find(pName.id).name === targets.newName);
    check("반영: 품절", find(pStatus.id).soldout === true && !find(pStatus.id).hidden);
    check("반영: B그룹가격", find(pB.id).packOptions[0].priceB === 25000);
    check("사진 등 다른 정보는 그대로", find(pPrice.id).photo === photoBefore && find(pPrice.id).category === pPrice.category);
    const untouched = before.products.filter((p) => ![pPrice.id, pName.id, pStatus.id, pB.id].includes(p.id)).slice(0, 50);
    check("나머지 상품은 그대로", untouched.every((p) => JSON.stringify(find(p.id).packOptions) === JSON.stringify(p.packOptions) && find(p.id).name === p.name));
    const msg = await page.locator(".adm-excel-tool > span").innerText();
    check("완료 안내", msg.includes("4개 상품 반영"), msg);

    // 같은 파일을 다시 올리면 바뀔 것 없음
    await page.locator(".adm-excel-upload input").setInputFiles("excel-upload.xlsx");
    await preview.waitFor();
    check("같은 파일 다시 올리면 '바뀌는 상품이 없습니다'", (await preview.locator("h2").innerText()).includes("바뀌는 상품이 없습니다"));
  } catch (error) {
    check("엑셀 시나리오 진행", false, String(error.message || error).slice(0, 400));
    await page.screenshot({ path: "desk-shot-excel-fail.png", fullPage: true }).catch(() => {});
  } finally {
    await browser.close();
  }
  writeFileSync("admin-excel-summary.txt", `${results.length - failed}/${results.length} passed\n${results.join("\n")}\n`);
  if (failed) process.exit(1);
}
main().catch((e) => { console.error(e); writeFileSync("admin-excel-summary.txt", `CRASH ${String(e?.stack || e).slice(0, 1200)}\n${results.join("\n")}\n`); process.exit(1); });
