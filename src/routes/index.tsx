import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { readStore } from "../lib/db.server";
import type { PackOption, Product, StoreData } from "../lib/db.server";
import { BUJA_LOGO_DATA, BUJA_MARK_DATA } from "../brand-assets";

const getStore = createServerFn({ method: "GET" }).handler(async () => readStore());

export const Route = createFileRoute("/")({
  loader: () => getStore(),
  component: StorePage,
});

function won(value: number) {
  return new Intl.NumberFormat("ko-KR").format(Math.round(value));
}

function normalize(value: string) {
  return value.toLocaleLowerCase("ko-KR").replace(/\s+/g, "");
}

function StorePage() {
  const initial = Route.useLoaderData() as StoreData;
  const [store, setStore] = useState(initial);
  const [category, setCategory] = useState("전체");
  const [sub, setSub] = useState("전체");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Product | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  async function refreshStore() {
    try {
      const response = await fetch("/api/store", { cache: "no-store" });
      if (response.ok) setStore(await response.json() as StoreData);
    } catch {
      // Keep the last successfully loaded catalogue on screen.
    }
  }

  useEffect(() => {
    const timer = window.setInterval(refreshStore, 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  const categoryNames = Object.keys(store.categories);
  const tabs = [
    ...(store.promoCategory && categoryNames.includes(store.promoCategory) ? [store.promoCategory] : []),
    "전체",
    ...categoryNames.filter((name) => name !== store.promoCategory),
  ];

  const promoProducts = useMemo(
    () => store.products.filter((product) => product.category === store.promoCategory),
    [store.products, store.promoCategory],
  );

  const filtered = useMemo(() => {
    const needle = normalize(query);
    return store.products.filter((product) => {
      if (category !== "전체" && product.category !== category) return false;
      if (category !== "전체" && sub !== "전체" && product.sub !== sub) return false;
      if (!needle) return true;
      return normalize(`${product.name} ${product.category} ${product.sub} ${product.unit}`).includes(needle);
    });
  }, [store.products, category, sub, query]);

  function chooseCategory(name: string) {
    setCategory(name);
    setSub("전체");
  }

  return (
    <div className="site-shell">
      <header className="topbar">
        <div className="wrap topbar-inner">
          <a href="/" className="brand-lockup" aria-label="부자유통 홈">
            <img src={BUJA_LOGO_DATA} alt="부자유통" />
          </a>
          <span className="topbar-note">거래처 전용 식자재 주문</span>
        </div>
      </header>

      <main>

        {promoProducts.length > 0 && (
          <PromoCarousel
            products={promoProducts}
            onOrder={(product) => setSelected(product)}
          />
        )}

        <section className="category-zone" aria-label="상품 분류">
          <div className="wrap">
            <nav className="category-rail">
              {tabs.map((name) => {
                const promo = name === store.promoCategory;
                return (
                  <button
                    type="button"
                    key={name}
                    className={`category-chip ${category === name ? "selected" : ""} ${promo ? "promo" : ""}`}
                    onClick={() => chooseCategory(name)}
                    aria-pressed={category === name}
                  >
                    {promo ? `🚨${name}🚨` : name}
                  </button>
                );
              })}
            </nav>
            {category !== "전체" && (
              <div className="subcategory-rail">
                {["전체", ...(store.categories[category] ?? [])].map((name) => (
                  <button
                    type="button"
                    key={name}
                    className={sub === name ? "selected" : ""}
                    onClick={() => setSub(name)}
                    aria-pressed={sub === name}
                  >
                    {name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="wrap catalogue-section">
          <div className="catalogue-head">
            <div>
              <h2>{category === "전체" ? "전체 상품" : category}</h2>
              <p>{filtered.length}개 상품</p>
            </div>
            <label className="search-box">
              <span aria-hidden="true">⌕</span>
              <span className="sr-only">상품 검색</span>
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="상품명·분류 검색"
                autoComplete="off"
              />
              {query && (
                <button type="button" onClick={() => setQuery("")} aria-label="검색어 지우기">×</button>
              )}
            </label>
          </div>

          {filtered.length ? (
            <div className="product-grid">
              {filtered.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  promoCategory={store.promoCategory}
                  onOrder={() => setSelected(product)}
                />
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <img src={BUJA_MARK_DATA} alt="" />
              <strong>조건에 맞는 상품이 없습니다.</strong>
              <button type="button" onClick={() => { setQuery(""); setCategory("전체"); setSub("전체"); }}>전체 상품 보기</button>
            </div>
          )}
        </section>

        <section className="wrap order-guide">
          <div className="guide-number">01</div>
          <div>
            <h2>주문은 문자 전송까지 눌러야 완료됩니다.</h2>
            <p>웹사이트가 주문 내용을 문자 작성창에 넣어드립니다. 마지막 전송 버튼은 휴대폰 문자 앱에서 눌러 주세요.</p>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="wrap footer-inner">
          <span>부자유통</span>
          <span>거래처용 식자재 주문</span>
        </div>
      </footer>

      {selected && (
        <OrderSheet
          product={selected}
          sms={store.sms}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}


function PromoCarousel({
  products,
  onOrder,
}: {
  products: Product[];
  onOrder: (product: Product) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const interactionTimerRef = useRef<number | null>(null);
  const [paused, setPaused] = useState(false);
  const repeatCount = Math.max(4, Math.ceil(10 / Math.max(products.length, 1)));
  const repeatedProducts = Array.from({ length: repeatCount }, () => products).flat();

  function pauseForInteraction(delay = 2400) {
    setPaused(true);
    if (interactionTimerRef.current !== null) window.clearTimeout(interactionTimerRef.current);
    interactionTimerRef.current = window.setTimeout(() => setPaused(false), delay);
  }

  function segmentWidth() {
    const track = trackRef.current;
    return track ? track.scrollWidth / repeatCount : 0;
  }

  function normalizeLoopPosition() {
    const track = trackRef.current;
    if (!track) return;
    const segment = segmentWidth();
    if (!segment) return;
    if (track.scrollLeft >= segment * 2) track.scrollLeft -= segment;
    if (track.scrollLeft <= 1) track.scrollLeft += segment;
  }

  function scrollByViewport(direction: -1 | 1) {
    const track = trackRef.current;
    if (!track) return;
    pauseForInteraction(2600);
    track.scrollBy({
      left: direction * Math.max(240, track.clientWidth * 0.72),
      behavior: "smooth",
    });
    window.setTimeout(normalizeLoopPosition, 600);
  }

  useEffect(() => {
    const track = trackRef.current;
    if (!track || products.length < 2) return;
    const placeAtMiddle = () => {
      const segment = track.scrollWidth / repeatCount;
      if (segment > 0) track.scrollLeft = segment;
    };
    const frame = window.requestAnimationFrame(placeAtMiddle);
    return () => window.cancelAnimationFrame(frame);
  }, [products.length, repeatCount]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track || products.length < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    let previous = 0;
    const pixelsPerSecond = 13;

    const animate = (time: number) => {
      if (!previous) previous = time;
      const elapsed = Math.min(time - previous, 60);
      previous = time;

      if (!paused) {
        track.scrollLeft += (pixelsPerSecond * elapsed) / 1000;
        normalizeLoopPosition();
      }

      frame = window.requestAnimationFrame(animate);
    };

    frame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(frame);
  }, [paused, products.length, repeatCount]);

  useEffect(() => {
    return () => {
      if (interactionTimerRef.current !== null) window.clearTimeout(interactionTimerRef.current);
    };
  }, []);

  return (
    <section className="promo-showcase" aria-labelledby="promo-title">
      <div className="wrap promo-showcase-inner">
        <div className="promo-heading">
          <div>
            <p>부자유통 오늘의 추천</p>
            <h1 id="promo-title">🚨 행사품목</h1>
            <span>행사상품을 바로 확인하고 수량을 선택해 문자로 주문하세요.</span>
          </div>
          <div className="promo-controls" aria-label="행사상품 슬라이드 이동">
            <button type="button" onClick={() => scrollByViewport(-1)} aria-label="이전 행사상품">←</button>
            <button type="button" onClick={() => scrollByViewport(1)} aria-label="다음 행사상품">→</button>
          </div>
        </div>

        <div
          ref={trackRef}
          className="promo-track"
          onPointerDown={() => pauseForInteraction()}
          onPointerUp={() => pauseForInteraction(1800)}
          onTouchStart={() => pauseForInteraction()}
          onWheel={() => pauseForInteraction()}
        >
          {repeatedProducts.map((product, index) => (
            <ProductCard
              key={`${product.id}-promo-${index}`}
              product={product}
              promoCategory={product.category}
              onOrder={() => onOrder(product)}
              extraClassName="promo-slide-card"
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function ProductCard({
  product,
  promoCategory,
  onOrder,
  extraClassName = "",
}: {
  product: Product;
  promoCategory: string;
  onOrder: () => void;
  extraClassName?: string;
}) {
  const prices = product.packOptions
    .filter((option) => option.price !== null)
    .map((option) => option.price as number);
  const hasPrice = prices.length > 0;

  return (
    <article
      className={`product-card ${product.category === promoCategory ? "promo-card" : ""} ${product.soldout ? "soldout" : ""} ${extraClassName}`}
    >
      <div className="product-image">
        {product.photo ? (
          <img src={product.photo} alt={product.name} loading="lazy" />
        ) : (
          <div className="image-placeholder">
            <img src={BUJA_MARK_DATA} alt="" />
          </div>
        )}
        {product.category === promoCategory && <span className="event-badge">🚨 긴급 행사 상품</span>}
        {product.soldout && <span className="soldout-badge">품절</span>}
      </div>
      <div className="product-info">
        <p className="product-meta">{product.category} · {product.sub}</p>
        <h3>{product.name}</h3>
        <p className="product-unit">{product.unit || "규격 문의"}</p>
        <div className="price-line">
          <strong>{hasPrice ? won(Math.min(...prices)) : "가격 문의"}</strong>
          {hasPrice && <span>원{product.packOptions.length > 1 ? "부터" : ""}</span>}
        </div>
      </div>
      <button
        className="order-strip"
        type="button"
        disabled={product.soldout}
        onClick={onOrder}
      >
        {product.soldout ? "품절" : "문자 주문"} <span aria-hidden="true">→</span>
      </button>
    </article>
  );
}

function OrderSheet({ product, sms, onClose }: { product: Product; sms: string; onClose: () => void }) {
  const [quantities, setQuantities] = useState<number[]>(product.packOptions.map(() => 0));
  const [customer, setCustomer] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    try {
      setCustomer(localStorage.getItem("buja-customer") ?? "");
    } catch {
      setCustomer("");
    }
  }, []);

  const chosen = product.packOptions
    .map((option, index) => ({ option, qty: quantities[index] ?? 0 }))
    .filter((row) => row.qty > 0);
  const total = chosen.reduce((sum, row) => sum + (row.option.price ?? 0) * row.qty, 0);
  const valid = chosen.length > 0;

  function setQty(index: number, next: number) {
    const option = product.packOptions[index];
    if (!option) return;
    const step = option.step || 1;
    const rounded = Math.max(0, Math.round(next / step) * step);
    setQuantities((current) => current.map((value, i) => i === index ? Number(rounded.toFixed(3)) : value));
  }

  function sendSms() {
    if (!valid) {
      setMessage("수량을 하나 이상 선택해 주세요.");
      return;
    }
    try {
      localStorage.setItem("buja-customer", customer.trim());
    } catch {
      // Storage can be unavailable in private browser modes.
    }
    const qtyText = chosen.map(({ option, qty }) => `${qty}${option.label === "kg" ? "kg" : option.label}`).join(" + ");
    const body = [
      `상품: ${product.name}`,
      `규격: ${product.unit}`,
      `수량: ${qtyText}`,
      `식당명 또는 거래처번호: ${customer.trim()}`,
    ].join("\n");
    const apple = /iPad|iPhone|iPod/.test(navigator.userAgent);
    window.location.href = `sms:${sms}${apple ? "&" : "?"}body=${encodeURIComponent(body)}`;
  }

  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="order-sheet" role="dialog" aria-modal="true" aria-labelledby="order-title">
        <div className="sheet-top">
          <div>
            <p>문자 주문</p>
            <h2 id="order-title">{product.name}</h2>
            <span>{product.unit}</span>
          </div>
          <button type="button" className="sheet-close" onClick={onClose} aria-label="닫기">×</button>
        </div>

        <div className="quantity-list">
          {product.packOptions.map((option, index) => (
            <QuantityRow
              key={`${option.label}-${index}`}
              option={option}
              qty={quantities[index] ?? 0}
              onChange={(next) => setQty(index, next)}
            />
          ))}
        </div>

        <label className="customer-field">
          <span>식당명 또는 거래처번호</span>
          <input
            value={customer}
            onChange={(event) => setCustomer(event.target.value)}
            placeholder="예: 85-18 / ○○식당"
            maxLength={60}
          />
          <small>한 번 입력하면 이 기기에 저장됩니다.</small>
        </label>

        <div className="order-summary">
          <span>예상 금액</span>
          <strong>{total > 0 ? `${won(total)}원` : "가격 문의 포함"}</strong>
        </div>

        {message && <p className="form-error" role="alert">{message}</p>}

        <button type="button" className="compose-sms" onClick={sendSms}>
          문자 작성하기 <span aria-hidden="true">→</span>
        </button>
        <p className="sheet-help">문자 앱이 열리면 내용을 확인한 뒤 전송 버튼을 눌러 주세요.</p>
      </section>
    </div>
  );
}

function QuantityRow({
  option,
  qty,
  onChange,
}: {
  option: PackOption;
  qty: number;
  onChange: (next: number) => void;
}) {
  const step = option.step || 1;
  return (
    <div className="quantity-row">
      <div>
        <strong>{option.label}</strong>
        <span>{option.price === null ? "가격 문의" : `${won(option.price)}원`}</span>
      </div>
      <div className="stepper">
        <button type="button" onClick={() => onChange(qty - step)} aria-label={`${option.label} 수량 줄이기`}>−</button>
        <input
          inputMode="decimal"
          value={qty}
          onChange={(event) => onChange(Number(event.target.value || 0))}
          aria-label={`${option.label} 수량`}
        />
        <button type="button" onClick={() => onChange(qty + step)} aria-label={`${option.label} 수량 늘리기`}>+</button>
      </div>
    </div>
  );
}
