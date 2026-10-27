// 배송처 관리 브라우저 시나리오: 관리자 화면(배송처 관리) + 거래처 휴대폰 화면
import { chromium, devices } from "playwright";

export async function adminUiFlow(ctx, env) {
  const { BASE, check } = env;
  const { admin, accounts, specs } = ctx;
  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: BASE });
  await context.addCookies([...admin.cookies].map(([name, value]) => ({ name, value, url: BASE })));
  const page = await context.newPage();
  page.on("dialog", (dialog) => void dialog.accept());
  try {
    await page.goto("/admin");
    const headerLinks = await page.locator(".adm-side-foot").innerText();
    check("[관리자] 상단 '단가표 보기'·'주문화면 보기' 제거, 계정관리·로그아웃 유지",
      !headerLinks.includes("단가표 보기") && !headerLinks.includes("주문화면 보기") && headerLinks.includes("거래처 계정 관리") && headerLinks.includes("로그아웃"), headerLinks.replace(/\n/g, " | "));

    for (const acc of accounts.filter((a) => a.via === "ui")) {
      await page.goto("/admin/accounts");
      await page.getByPlaceholder(/거래처 검색/).fill(acc.username);
      const card = page.locator(".account-card", { hasText: `아이디 ${acc.username}` }).first();
      await card.waitFor({ timeout: 30000 });
      const buttons = await card.locator("button").allInnerTexts();
      check(`[관리자 ${acc.username}] 카드 버튼 = 이름/아이디/배송처 관리/비밀번호/계정중지`,
        buttons.includes("배송처 관리") && !buttons.includes("거래처 연결") && !buttons.some((b) => b.includes("추가 배송처")), buttons.join(","));
      await card.getByRole("button", { name: "배송처 관리" }).click();
      const modal = page.locator(".destination-modal");
      await modal.waitFor();

      for (const code of acc.link) {
        const spec = specs.find((s) => s.code === code);
        await modal.getByPlaceholder("상호명 또는 거래처번호 검색").fill(spec.name.split(" ")[0]);
        const row = modal.locator(".destination-search label", { hasText: spec.name });
        await row.getByRole("button", { name: "연결" }).click();
        await modal.locator(".destination-current label", { hasText: spec.name }).waitFor({ timeout: 15000 });
      }
      for (const extra of acc.extras) {
        await modal.getByPlaceholder(/배송처 이름/).fill(extra.name);
        await modal.getByPlaceholder("주소").fill(extra.address);
        await modal.getByPlaceholder("전화번호").fill("010-1234-5678");
        await modal.getByRole("button", { name: "+ 배송처 추가" }).click();
        await modal.locator(".destination-current label", { hasText: extra.name }).waitFor({ timeout: 15000 });
      }
      const current = await modal.locator(".destination-current label").allInnerTexts();
      const expected = acc.expectedLabels;
      check(`[관리자 ${acc.username}] 배송처 관리 한 목록에 ${expected.length}곳 표시`,
        current.length === expected.length && expected.every((label) => current.some((t) => t.split("\n")[0].trim() === label)), current.map((t) => t.split("\n")[0]).join(","));
      await modal.locator(".account-link-head button").click();
    }
  } catch (error) {
    check("[관리자] 배송처 관리 화면 흐름", false, String(error.message || error).slice(0, 400));
    await page.screenshot({ path: "delivery-admin-failure.png", fullPage: true }).catch(() => {});
  } finally {
    await browser.close();
  }
}

export async function browserFlow(ctx, env) {
  const { BASE, check } = env;
  const { accounts } = ctx;
  const browser = await chromium.launch();
  try {
    for (const acc of accounts) {
      const context = await browser.newContext({ ...devices["Pixel 7"], baseURL: BASE });
      await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
      const page = await context.newPage();
      const tagName = `[휴대폰 ${acc.username}]`;
      try {
        async function loginUi() {
          await page.goto("/");
          await page.locator('input[name="username"]').waitFor({ timeout: 30000 });
          await page.fill('input[name="username"]', acc.username);
          await page.fill('input[name="password"]', acc.username);
          await page.getByRole("button", { name: "로그인" }).click();
          await page.locator(".od-search input").waitFor({ timeout: 30000 });
        }
        const bannerLabel = async () => (await page.locator(".od-location-banner strong").innerText()).trim();
        async function switchTo(label) {
          await page.locator(".od-location-banner").click();
          const option = page.locator(".od-location-options button").filter({ has: page.locator(".od-location-number", { hasText: new RegExp(`^${label.replace(/[-]/g, "\\-")}$`) }) });
          await option.first().click();
          await page.locator(".od-location-sheet").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
          await page.waitForFunction((l) => document.querySelector(".od-location-banner strong")?.textContent?.trim() === l, label, { timeout: 15000 });
        }
        async function cartCount() {
          const label = await page.locator(".od-cart-icon").getAttribute("aria-label");
          return Number((label || "").replace(/[^0-9]/g, ""));
        }
        async function addProduct(product) {
          await page.locator(".od-search input").fill(product.name);
          const card = page.locator(".od-card", { hasText: product.name }).first();
          await card.waitFor({ timeout: 10000 });
          await card.locator('button[aria-label$="수량 늘리기"]').first().click();
          await page.locator(".od-search input").fill("");
        }
        async function orderText() {
          await page.locator(".od-cart-icon").click();
          await page.getByRole("button", { name: /주문내용 복사|복사됨/ }).click();
          await page.waitForTimeout(300);
          const text = await page.evaluate(() => navigator.clipboard.readText());
          await page.locator('.od-cart button[aria-label="닫기"]').first().click();
          return text;
        }

        await loginUi();
        const products = (await page.evaluate(async () => (await (await fetch("/api/store", { cache: "no-store" })).json()).products))
          .filter((p) => !p.soldout && !p.hidden && p.name.length >= 3);
        // 계정마다 다른 상품 사용
        const offset = accounts.indexOf(acc) * 7;
        const pick = (i) => products[offset + i];

        // 3) 로그인 후 모두 표시
        await page.locator(".od-location-banner").click();
        const shown = (await page.locator(".od-location-options .od-location-number").allInnerTexts()).map((t) => t.trim());
        check(`${tagName} 배송처 ${acc.expectedLabels.length}곳 모두 표시 (구분 없이 한 목록)`,
          shown.length === acc.expectedLabels.length && acc.expectedLabels.every((l) => shown.includes(l)) && (await page.locator(".od-location-divider").count()) === 0, shown.join(","));
        const otherExtras = accounts.filter((o) => o !== acc).flatMap((o) => o.extras.map((e) => e.name));
        check(`${tagName} 다른 계정 배송처 안 보임`, !shown.some((l) => otherExtras.includes(l)), shown.join(","));
        await page.locator(".od-location-sheet-head button").click();

        // 4~5) 배송처 전환 + 장바구니 분리 + 문자 제목
        const targets = acc.expectedLabels.slice(0, 3);
        for (let i = 0; i < targets.length; i += 1) {
          if (await bannerLabel() !== targets[i]) await switchTo(targets[i]);
          check(`${tagName} ${targets[i]} 처음엔 장바구니 비어 있음`, (await cartCount()) === 0, String(await cartCount()));
          await addProduct(pick(i));
          const text = await orderText();
          check(`${tagName} 문자 제목 [${targets[i]} 발주]`, text.startsWith(`[${targets[i]} 발주]`) && text.includes(pick(i).name), text.split("\n")[0]);
        }
        for (let i = 0; i < targets.length; i += 1) {
          await switchTo(targets[i]);
          const text = await orderText();
          const others = targets.map((_, j) => j).filter((j) => j !== i).map((j) => pick(j).name);
          check(`${tagName} ${targets[i]}로 돌아오면 그 배송처 장바구니만`, (await cartCount()) === 1 && text.includes(pick(i).name) && !others.some((n) => text.includes(n)), `${await cartCount()}품목`);
        }

        // 선택 상태 유지: 새로고침
        const last = targets[targets.length - 1];
        await switchTo(last);
        await page.reload();
        await page.locator(".od-location-banner").waitFor({ timeout: 30000 });
        check(`${tagName} 새로고침 후 선택 유지(${last})`, (await bannerLabel()) === last, await bannerLabel());

        // 6) 로그아웃/재로그인 후 정상 유지 (마지막 선택, 배송처 목록, 장바구니)
        const second = targets[1] ?? targets[0];
        await switchTo(second);
        await page.getByRole("button", { name: "내정보" }).click();
        await page.locator(".od-account-card").getByRole("button", { name: "로그아웃" }).click();
        await page.getByRole("heading", { name: "거래처 전용 주문" }).waitFor({ timeout: 20000 });
        await loginUi();
        await page.locator(".od-location-banner").waitFor({ timeout: 30000 });
        check(`${tagName} 재로그인 후 마지막 배송처(${second}) 유지`, (await bannerLabel()) === second, await bannerLabel());
        await page.locator(".od-location-banner").click();
        const shownAgain = (await page.locator(".od-location-options .od-location-number").allInnerTexts()).map((t) => t.trim());
        await page.locator(".od-location-sheet-head button").click();
        check(`${tagName} 재로그인 후 배송처 목록 그대로`, acc.expectedLabels.every((l) => shownAgain.includes(l)), shownAgain.join(","));
        const textAgain = await orderText();
        const idx = targets.indexOf(second);
        check(`${tagName} 재로그인 후 ${second} 장바구니 유지`, (await cartCount()) === 1 && textAgain.includes(pick(idx).name) && textAgain.startsWith(`[${second} 발주]`), textAgain.split("\n")[0]);
      } catch (error) {
        check(`${tagName} 시나리오 진행`, false, String(error.message || error).slice(0, 400));
        await page.screenshot({ path: `delivery-${acc.username}-failure.png`, fullPage: true }).catch(() => {});
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}
