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
  spec: string;
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
  const [zoomPhoto, setZoomPhoto] = useState<{ src: string; name: string } | null>(null);

  const promo = store.promoCategory && store.promoCategory in store.categories ? store.promoCategory : "";

  // 행사품목 카테고리를 "전체" 바로 다음 맨 앞에 배치
  const categories = useMemo(() => {
    const rest = Object.keys(store.categories).filter((name) => name !== promo);
    return promo ? ["전체", promo, ...rest] : ["전체", ...rest];
  }, [store.categories, promo]);

  const filtered = useMemo(() => {
    const needle = normalize(query);
    const list = store.products.filter((product) => {
      if (category !== "전체" && product.category !== category) return false;
      if (!needle) return true;
      return normalize(`${product.name} ${product.category} ${product.sub} ${product.unit}`).includes(needle);
    });
    if (category !== "전체" || !promo) return list;
    // 전체 보기에서도 행사 상품을 먼저 보여줌 (나머지 순서는 그대로 유지)
    return [...list.filter((p) => p.category === promo), ...list.filter((p) => p.category !== promo)];
  }, [store.products, category, query, promo]);

  function quantityFor(productId: string, optionLabel: string) {
    return cart.find((line) => line.productId === productId && line.optionLabel === optionLabel)?.quantity ?? 0;
  }

  function setQuantity(product: Product, option: PackOption, quantity: number) {
    const step = option.step || 1;
    const nextQuantity = Math.max(0, Number(quantity.toFixed(3)));
    const optionLabel = option.label || product.unit;
    const key = `${product.id}::${optionLabel}`;
    setCart((current) => {
      const index = current.findIndex((line) => line.key === key);
      if (nextQuantity <= 0) return current.filter((line) => line.key !== key);
      const next: CartLine = {
        key,
        productId: product.id,
        productName: product.name,
        spec: product.unit,
        optionLabel,
        quantity: nextQuantity,
        step,
      };
      // 기존 줄은 제자리에서 수량만 바꿔서 장바구니 순서가 흔들리지 않게 함
      if (index >= 0) return current.map((line, i) => (i === index ? next : line));
      return [...current, next];
    });
  }

  function changeCartLine(line: CartLine, direction: -1 | 1) {
    const product = store.products.find((item) => item.id === line.productId);
    const option = product?.packOptions.find((item) => item.label === line.optionLabel)
      ?? { label: line.optionLabel, price: null, step: line.step };
    if (!product) return;
    setQuantity(product, option, line.quantity + direction * line.step);
  }

  function removeCartLine(line: CartLine) {
    setCart((current) => current.filter((item) => item.key !== line.key));
  }

  function composeSms() {
    if (!cart.length) return;
    const lines = cart.map((line) => `${line.productName}${line.spec ? ` ${line.spec}` : ""} / ${line.quantity}${line.optionLabel}`);
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
          <h1>필요한 상품을 담고<br />문자로 주문하세요</h1>
          <ol className="simple-howto">
            <li><b>1</b>상품의 <em>＋</em> 버튼으로 수량 선택</li>
            <li><b>2</b>아래 <em>주문하기</em> 버튼 누르기</li>
            <li><b>3</b>문자 보내기만 누르면 끝</li>
          </ol>
        </section>

        <div className="simple-search">
          <span aria-hidden="true">⌕</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="상품 이름으로 찾기" type="search" />
          {query && <button type="button" aria-label="검색어 지우기" onClick={() => setQuery("")}>×</button>}
        </div>

        <nav className="simple-categories" aria-label="상품 카테고리">
          {categories.map((name) => (
            <button
              key={name}
              type="button"
              className={`${category === name ? "selected" : ""} ${name === promo ? "promo" : ""}`}
              onClick={() => setCategory(name)}
            >
              {name === promo ? `🔥 ${name}` : name}
            </button>
          ))}
        </nav>

        <div className="simple-list-head">
          <strong>{category === "전체" ? "전체 상품" : category}</strong>
          <span>{filtered.length}개</span>
        </div>

        <section className="simple-product-list">
          {filtered.map((product) => (
            <SimpleProductCard
              key={product.id}
              product={product}
              isPromo={!!promo && product.category === promo}
              quantityFor={quantityFor}
              onQuantity={setQuantity}
              onZoom={(src) => setZoomPhoto({ src, name: product.name })}
            />
          ))}
          {!filtered.length && <div className="simple-empty">찾는 상품이 없습니다.<br />다른 이름으로 검색해 보세요.</div>}
        </section>
      </main>

      <div className="simple-cart-dock">
        <div className="wrap simple-cart-dock-inner">
          {cart.length > 0 ? (
            <button type="button" className="simple-cart-summary" onClick={() => setCartOpen(true)}>
              <span className="simple-cart-count"><b>{cart.length}</b>품목 담김</span>
              <strong>주문하기 <i>›</i></strong>
            </button>
          ) : (
            <div className="simple-cart-summary empty">
              <span>장바구니가 비어 있습니다</span>
              <small>상품의 ＋ 버튼을 눌러 담아주세요</small>
            </div>
          )}
        </div>
      </div>

      {cartOpen && (
        <div className="simple-cart-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setCartOpen(false); }}>
          <section className="simple-cart-sheet" aria-modal="true" role="dialog" aria-label="주문 내용 확인">
            <div className="simple-cart-title">
              <div><p>보내기 전에 확인하세요</p><h2>주문 내용</h2></div>
              <button type="button" aria-label="닫기" onClick={() => setCartOpen(false)}>×</button>
            </div>
            <div className="simple-cart-lines">
              {cart.map((line) => (
                <div className="simple-cart-line" key={line.key}>
                  <div className="simple-cart-line-name">
                    <strong>{line.productName}</strong>
                    <span>{line.spec ? `${line.spec} · ` : ""}{line.optionLabel} 단위</span>
                  </div>
                  <div className="simple-cart-line-controls">
                    <div className="simple-stepper active">
                      <button type="button" aria-label="수량 줄이기" onClick={() => changeCartLine(line, -1)}>−</button>
                      <b>{line.quantity}<small>{line.optionLabel}</small></b>
                      <button type="button" aria-label="수량 늘리기" onClick={() => changeCartLine(line, 1)}>＋</button>
                    </div>
                    <button type="button" className="simple-cart-remove" onClick={() => removeCartLine(line)}>빼기</button>
                  </div>
                </div>
              ))}
              {!cart.length && <div className="simple-empty">담긴 상품이 없습니다.</div>}
            </div>
            <div className="simple-cart-total"><span>총</span><strong>{cart.length}품목</strong></div>
            <button type="button" className="simple-final-sms" onClick={composeSms} disabled={!cart.length}>📩 문자로 주문 보내기</button>
            <p className="simple-sms-help">누르면 문자 앱이 열리고 주문 내용이 자동으로 입력됩니다.<br />문자 앱에서 <b>보내기</b>를 눌러야 주문이 접수됩니다.</p>
            <button type="button" className="simple-cart-continue" onClick={() => setCartOpen(false)}>← 상품 더 담기</button>
          </section>
        </div>
      )}

      {zoomPhoto && (
        <div className="simple-photo-zoom" role="dialog" aria-modal="true" aria-label={`${zoomPhoto.name} 사진`} onClick={() => setZoomPhoto(null)}>
          <img src={zoomPhoto.src} alt={zoomPhoto.name} />
          <p>{zoomPhoto.name}</p>
          <button type="button" aria-label="닫기">× 닫기</button>
        </div>
      )}
    </div>
  );
}

function SimpleProductCard({
  product,
  isPromo,
  quantityFor,
  onQuantity,
  onZoom,
}: {
  product: Product;
  isPromo: boolean;
  quantityFor: (productId: string, optionLabel: string) => number;
  onQuantity: (product: Product, option: PackOption, quantity: number) => void;
  onZoom: (src: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const options = product.packOptions.length ? product.packOptions : [{ label: product.unit, price: product.price, step: 1 }];
  const description = (product.description ?? "").trim();
  const longDescription = description.length > 50 || description.includes("\n");

  const servingsPerUnit = (product.servingsPerUnit ?? "").trim();
  const boxContents = (product.boxContents ?? "").trim();
  const servingsPerBox = (product.servingsPerBox ?? "").trim();
  const boxLine = [boxContents && `1박스 ${boxContents}`, servingsPerBox].filter(Boolean).join(" · ");
  const hasInfo = Boolean(servingsPerUnit || boxLine || description);

  return (
    <article className={`simple-product-card ${product.soldout ? "soldout" : ""}`}>
      <div className="simple-product-top">
        <button
          type="button"
          className="simple-product-photo"
          onClick={() => product.photo && onZoom(product.photo)}
          aria-label={product.photo ? `${product.name} 사진 크게 보기` : product.name}
          disabled={!product.photo}
        >
          <img src={product.photo || BUJA_MARK_DATA} alt="" loading="lazy" decoding="async" className={product.photo ? "" : "placeholder"} />
          {product.soldout && <b>품절</b>}
          {product.photo && !product.soldout && <i aria-hidden="true">⤢</i>}
        </button>
        <div className="simple-product-side">
          <div className="simple-product-info">
            <div className="simple-product-tags">
              {isPromo && <span className="tag-promo">행사</span>}
              {product.storageMethod && <span className={`tag-storage tag-${product.storageMethod}`}>{product.storageMethod}</span>}
              {product.sub && <span className="tag-sub">{product.sub}</span>}
            </div>
            <h3>{product.name}</h3>
            {product.unit && <p className="simple-product-spec">규격 <b>{product.unit}</b></p>}
          </div>
          {product.soldout ? (
            <div className="simple-soldout-text">현재 품절된 상품입니다</div>
          ) : (
            <div className={`simple-product-options count-${Math.min(options.length, 3)}`}>
              {options.map((option) => {
                const label = option.label || product.unit;
                const quantity = quantityFor(product.id, label);
                const step = option.step || 1;
                return (
                  <div className={`simple-option ${quantity > 0 ? "active" : ""}`} key={label}>
                    <span className="simple-option-label">{label}</span>
                    <div className={`simple-stepper ${quantity > 0 ? "active" : ""}`}>
                      <button type="button" aria-label={`${label} 수량 줄이기`} onClick={() => onQuantity(product, option, quantity - step)} disabled={quantity <= 0}>−</button>
                      <b>{quantity}</b>
                      <button type="button" aria-label={`${label} 수량 늘리기`} onClick={() => onQuantity(product, option, quantity + step)}>＋</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {hasInfo && (
        <div className="simple-product-detail">
          {servingsPerUnit && <p><span>인분</span>{servingsPerUnit}</p>}
          {boxLine && <p><span>구성</span>{boxLine}</p>}
          {description && (
            <div className={`simple-product-desc ${expanded || !longDescription ? "open" : ""}`}>
              {description}
            </div>
          )}
          {description && longDescription && (
            <button type="button" className="simple-desc-toggle" onClick={() => setExpanded((v) => !v)}>
              {expanded ? "접기 ▲" : "설명 더보기 ▼"}
            </button>
          )}
        </div>
      )}
    </article>
  );
}
