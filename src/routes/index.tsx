import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { readStore } from "../lib/db.server";
import type { PackOption, Product, StoreData } from "../lib/db.server";
import { BUJA_LOGO_DATA, BUJA_MARK_DATA } from "../brand-assets";

const getStore = createServerFn({ method: "GET" }).handler(async () => readStore());

export const Route = createFileRoute("/")({
  loader: () => getStore(),
  component: SimpleOrderPage,
});

type CartLine = {
  key: string;
  productId: string;
  productName: string;
  optionLabel: string;
  quantity: number;
  step: number;
};

function normalize(value: string) {
  return value.toLocaleLowerCase("ko-KR").replace(/\s+/g, "");
}

function SimpleOrderPage() {
  const store = Route.useLoaderData() as StoreData;
  const [category, setCategory] = useState("전체");
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartOpen, setCartOpen] = useState(false);

  const categories = useMemo(() => ["전체", ...Object.keys(store.categories)], [store.categories]);
  const filtered = useMemo(() => {
    const needle = normalize(query);
    return store.products.filter((product) => {
      if (category !== "전체" && product.category !== category) return false;
      if (!needle) return true;
      return normalize(`${product.name} ${product.category} ${product.sub} ${product.unit}`).includes(needle);
    });
  }, [store.products, category, query]);

  const totalQuantity = cart.reduce((sum, line) => sum + line.quantity, 0);

  function quantityFor(productId: string, optionLabel: string) {
    return cart.find((line) => line.productId === productId && line.optionLabel === optionLabel)?.quantity ?? 0;
  }

  function setQuantity(product: Product, option: PackOption, quantity: number) {
    const step = option.step || 1;
    const nextQuantity = Math.max(0, Number(quantity.toFixed(3)));
    const key = `${product.id}::${option.label}`;
    setCart((current) => {
      const rest = current.filter((line) => line.key !== key);
      if (nextQuantity <= 0) return rest;
      return [...rest, {
        key,
        productId: product.id,
        productName: product.name,
        optionLabel: option.label || product.unit,
        quantity: nextQuantity,
        step,
      }];
    });
  }

  function changeCartLine(line: CartLine, direction: -1 | 1) {
    const product = store.products.find((item) => item.id === line.productId);
    const option = product?.packOptions.find((item) => item.label === line.optionLabel)
      ?? product?.packOptions[0];
    if (!product || !option) return;
    setQuantity(product, option, line.quantity + direction * line.step);
  }

  function composeSms() {
    if (!cart.length) return;
    const lines = cart.map((line) => `${line.productName} / ${line.quantity}${line.optionLabel}`);
    const body = ["[부자유통 발주]", "", ...lines, "", `총 ${cart.length}품목`].join("\n");
    const recipient = (store.sms || "").replace(/[^0-9+]/g, "");
    window.location.href = `sms:${recipient}?body=${encodeURIComponent(body)}`;
  }

  return (
    <div className="simple-order-page">
      <header className="simple-order-header">
        <div className="wrap simple-order-header-inner">
          <a href="/" className="simple-order-brand"><img src={BUJA_LOGO_DATA} alt="부자유통" /></a>
          <span>간편 문자발주</span>
        </div>
      </header>

      <main className="wrap simple-order-main">
        <section className="simple-order-intro">
          <p>부자유통 식자재 발주</p>
          <h1>필요한 상품을 담고<br />한 번에 문자로 주문하세요.</h1>
          <span>상품 옆 + 버튼으로 수량을 선택하면 장바구니에 바로 담깁니다.</span>
        </section>

        <div className="simple-search">
          <span aria-hidden="true">⌕</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="상품명 검색" type="search" />
          {query && <button type="button" onClick={() => setQuery("")}>×</button>}
        </div>

        <nav className="simple-categories" aria-label="상품 카테고리">
          {categories.map((name) => (
            <button key={name} type="button" className={category === name ? "selected" : ""} onClick={() => setCategory(name)}>
              {name}
            </button>
          ))}
        </nav>

        <div className="simple-list-head">
          <strong>{category === "전체" ? "전체 품목" : category}</strong>
          <span>{filtered.length}개</span>
        </div>

        <section className="simple-product-list">
          {filtered.map((product) => (
            <SimpleProductRow
              key={product.id}
              product={product}
              quantityFor={quantityFor}
              onQuantity={setQuantity}
            />
          ))}
          {!filtered.length && <div className="simple-empty">검색 결과가 없습니다.</div>}
        </section>
      </main>

      {cart.length > 0 && (
        <div className="simple-cart-dock">
          <div className="wrap simple-cart-dock-inner">
            <button type="button" className="simple-cart-summary" onClick={() => setCartOpen(true)}>
              <span><b>장바구니 {cart.length}품목</b><small>총 수량 {totalQuantity}</small></span>
              <strong>주문내용 확인 <i>›</i></strong>
            </button>
            <button type="button" className="simple-cart-sms" onClick={() => setCartOpen(true)}>문자로 발주하기</button>
          </div>
        </div>
      )}

      {cartOpen && (
        <div className="simple-cart-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setCartOpen(false); }}>
          <section className="simple-cart-sheet" aria-modal="true" role="dialog">
            <div className="simple-cart-title">
              <div><p>최종 발주 확인</p><h2>장바구니</h2></div>
              <button type="button" onClick={() => setCartOpen(false)}>×</button>
            </div>
            <div className="simple-cart-lines">
              {cart.map((line) => (
                <div className="simple-cart-line" key={line.key}>
                  <div><strong>{line.productName}</strong><span>{line.optionLabel}</span></div>
                  <div className="simple-stepper">
                    <button type="button" onClick={() => changeCartLine(line, -1)}>−</button>
                    <b>{line.quantity}</b>
                    <button type="button" onClick={() => changeCartLine(line, 1)}>＋</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="simple-cart-total"><span>총 {cart.length}품목</span><strong>수량 {totalQuantity}</strong></div>
            <button type="button" className="simple-final-sms" onClick={composeSms}>📩 문자로 발주하기</button>
            <p className="simple-sms-help">누르면 문자 앱이 열리고 위 상품들이 한 번에 입력됩니다.</p>
          </section>
        </div>
      )}
    </div>
  );
}

function SimpleProductRow({
  product,
  quantityFor,
  onQuantity,
}: {
  product: Product;
  quantityFor: (productId: string, optionLabel: string) => number;
  onQuantity: (product: Product, option: PackOption, quantity: number) => void;
}) {
  const options = product.packOptions.length ? product.packOptions : [{ label: product.unit, price: product.price, step: 1 }];

  return (
    <article className={`simple-product-row ${product.soldout ? "soldout" : ""}`}>
      <div className="simple-product-photo">
        {product.photo ? <img src={product.photo} alt="" /> : <img src={BUJA_MARK_DATA} alt="" />}
        {product.soldout && <b>품절</b>}
      </div>
      <div className="simple-product-info">
        <small>{product.category}{product.sub ? ` · ${product.sub}` : ""}</small>
        <h3>{product.name}</h3>
        <span>{product.unit}</span>
      </div>
      <div className="simple-product-options">
        {options.map((option) => {
          const quantity = quantityFor(product.id, option.label);
          const step = option.step || 1;
          return (
            <div className="simple-option" key={option.label}>
              <span>{option.label}</span>
              {product.soldout ? <strong className="simple-soldout-text">품절</strong> : (
                <div className={`simple-stepper ${quantity > 0 ? "active" : ""}`}>
                  <button type="button" aria-label="수량 줄이기" onClick={() => onQuantity(product, option, quantity - step)} disabled={quantity <= 0}>−</button>
                  <b>{quantity}</b>
                  <button type="button" aria-label="수량 늘리기" onClick={() => onQuantity(product, option, quantity + step)}>＋</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </article>
  );
}
