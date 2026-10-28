import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import type { PackOption, Product, StoreData } from "../lib/db.server";

// 거래처 단가표: 로그인한 거래처의 가격그룹 가격만 표시 (A=정가, B=B그룹 가격).
// 비로그인이면 첫 화면(로그인)으로 보냅니다.
const isCustomerLoggedIn = createServerFn({ method: "GET" }).handler(async () => {
  const [{ getRequest }, { getCustomer }] = await Promise.all([import("@tanstack/react-start/server"), import("../lib/auth.server")]);
  return Boolean(await getCustomer(getRequest()));
});

export const Route = createFileRoute("/price-list")({
  beforeLoad: async () => {
    if (!(await isCustomerLoggedIn())) throw redirect({ to: "/", replace: true });
  },
  head: () => ({ meta: [{ title: "단가표 · 부자유통" }, { name: "robots", content: "noindex,nofollow" }] }),
  component: PriceListPage,
});

function priceText(product: Product, option: PackOption) {
  if (product.priceDisplayMode === "market") return "시세";
  if (product.priceDisplayMode === "inquiry" || option.price == null) return "가격문의";
  return `${new Intl.NumberFormat("ko-KR").format(option.price)}원`;
}

function todayText() {
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function PriceListPage() {
  const [store, setStore] = useState<StoreData | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const [statusResponse, storeResponse] = await Promise.all([
          fetch("/api/customer/status", { cache: "no-store" }),
          fetch("/api/store", { cache: "no-store" }),
        ]);
        const status = await statusResponse.json() as { authenticated?: boolean; customer?: { name: string } | null };
        if (!status.authenticated || storeResponse.status === 401) {
          window.location.replace("/");
          return;
        }
        setCustomerName(status.customer?.name ?? "");
        setStore(await storeResponse.json() as StoreData);
      } catch {
        setError("단가표를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
      }
    })();
  }, []);

  const sections = useMemo(() => {
    if (!store) return [];
    const q = query.trim().replace(/\s+/g, "").toLowerCase();
    const visible = store.products.filter((product) => product.priceListVisible !== false && !product.hidden
      && (!q || product.name.replace(/\s+/g, "").toLowerCase().includes(q)));
    const promo = store.promoCategory;
    const order = Object.keys(store.categories);
    const names = promo && order.includes(promo) ? [promo, ...order.filter((name) => name !== promo)] : order;
    return names.map((category) => {
      const products = visible.filter((product) => product.category === category);
      const subs = new Map<string, Product[]>();
      for (const product of products) {
        const key = product.sub || "";
        subs.set(key, [...(subs.get(key) ?? []), product]);
      }
      return { category, isPromo: category === promo, subs: Array.from(subs.entries()), count: products.length };
    }).filter((section) => section.count > 0);
  }, [store, query]);

  if (error) return <main className="pl-page"><p className="pl-empty">{error}</p></main>;
  if (!store) return <main className="pl-page"><p className="pl-empty">단가표를 불러오는 중입니다.</p></main>;

  return (
    <main className="pl-page">
      <header className="pl-head">
        <a href="/" className="pl-back">← 주문하기</a>
        <div>
          <h1>단가표</h1>
          <p>{customerName ? `${customerName} · ` : ""}{todayText()} 기준</p>
        </div>
        <button type="button" className="pl-print" onClick={() => window.print()}>인쇄</button>
      </header>
      <input className="pl-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="상품명 검색" aria-label="상품명 검색" />
      {sections.length === 0 && <p className="pl-empty">검색 결과가 없습니다.</p>}
      {sections.map((section) => (
        <section className="pl-section" key={section.category}>
          <h2>{section.category}{section.isPromo && <small>오늘·내일 배송</small>}</h2>
          {section.subs.map(([sub, products]) => (
            <div key={sub || "-"}>
              {sub && <h3>{sub}</h3>}
              <table className="pl-table">
                <tbody>
                  {products.flatMap((product) => {
                    const options = product.packOptions.length ? product.packOptions : [{ label: product.unit, price: product.price, step: 1 }];
                    return options.map((option, index) => (
                      <tr key={`${product.id}-${option.label}`} className={product.soldout ? "soldout" : ""}>
                        <td className="pl-name">{index === 0 && <>{product.name}{product.unit && <small>{product.unit}</small>}{product.soldout && <em>품절</em>}</>}</td>
                        <td className="pl-unit">{option.label}</td>
                        <td className="pl-price">{priceText(product, option)}</td>
                      </tr>
                    ));
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </section>
      ))}
    </main>
  );
}
