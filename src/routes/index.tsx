import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { readStore } from "../lib/db.server";
import type { CustomerSummary, PackOption, Product, StoreData } from "../lib/db.server";
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

type CustomerStatus = { authenticated: boolean; customer: CustomerSummary | null };
type DashboardData = {
  recent: Array<{ id: string; status: string; total: number; createdAt: string; deliveryDate: string; summary: string; printed: boolean }>;
  frequentProductIds: string[];
  usualOrderItems: Array<{ productId: string; productName: string; optionLabel: string; quantity: number; orderCount: number }>;
  lastOrderItems: Array<{ productId: string; productName: string; optionLabel: string; quantity: number }>;
  weekdayTemplates: Array<{ weekday: number; label: string; orderId: string | null; orderedAt: string | null; items: Array<{ productId: string; productName: string; optionLabel: string; quantity: number }> }>;
};
type CartLine = {
  productId: string; productName: string; unit: string; optionLabel: string; quantity: number; unitPrice: number; step: number;
};

function StorePage() {
  const initial = Route.useLoaderData() as StoreData;
  const [store, setStore] = useState(initial);
  const [category, setCategory] = useState("전체");
  const [sub, setSub] = useState("전체");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Product | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [auth, setAuth] = useState<CustomerStatus | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [notice, setNotice] = useState("");
  const [weekdayOpen, setWeekdayOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  async function refreshStore() {
    try {
      const response = await fetch("/api/store", { cache: "no-store" });
      if (response.ok) setStore(await response.json() as StoreData);
    } catch {
      // Keep the last successfully loaded catalogue on screen.
    }
  }

  async function refreshDashboard() {
    try {
      const response = await fetch("/api/customer/dashboard", { cache: "no-store" });
      if (response.ok) setDashboard(await response.json() as DashboardData);
    } catch {
      // Recent ordering shortcuts are optional.
    }
  }

  async function loadSession() {
    const response = await fetch("/api/customer/status", { cache: "no-store" });
    const next = await response.json() as CustomerStatus;
    setAuth(next);
    if (next.authenticated) await Promise.all([refreshStore(), refreshDashboard()]);
  }

  async function logoutCustomer() {
    await fetch("/api/customer/logout", { method: "POST" });
    setDashboard(null);
    setCart([]);
    setEditingOrderId(null);
    setAuth({ authenticated: false, customer: null });
  }

  useEffect(() => {
    void loadSession().catch(() => setAuth({ authenticated: false, customer: null }));
  }, []);

  useEffect(() => {
    if (!auth?.authenticated) return;
    const timer = window.setInterval(() => { void refreshStore(); void refreshDashboard(); }, 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [auth?.authenticated]);

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

  const frequentProducts = useMemo(() => {
    if (!dashboard) return [];
    const rank = new Map(dashboard.frequentProductIds.map((id, index) => [id, index]));
    return store.products
      .filter((product) => rank.has(product.id))
      .sort((a, b) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99));
  }, [dashboard, store.products]);

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

  function addToCart(lines: CartLine[]) {
    setCart((current) => {
      const next = [...current];
      for (const line of lines) {
        const index = next.findIndex((item) => item.productId === line.productId && item.optionLabel === line.optionLabel);
        if (index >= 0) next[index] = { ...next[index], quantity: Number((next[index].quantity + line.quantity).toFixed(3)) };
        else next.push(line);
      }
      return next;
    });
    setSelected(null);
    setNotice("장바구니에 담았습니다.");
    window.setTimeout(() => setNotice(""), 1600);
  }

  function loadUsualOrder() {
    if (!dashboard?.usualOrderItems?.length) return;
    const lines: CartLine[] = [];
    for (const item of dashboard.usualOrderItems) {
      const product = store.products.find((row) => row.id === item.productId);
      const option = product?.packOptions.find((row) => row.label === item.optionLabel);
      if (product && option && !product.soldout) lines.push({ productId: product.id, productName: product.name, unit: product.unit, optionLabel: option.label, quantity: item.quantity, unitPrice: option.price ?? 0, step: option.step || 1 });
    }
    if (!lines.length) return;
    setEditingOrderId(null); setCart(lines); setCheckoutOpen(true);
    setNotice(`평소 주문표 ${lines.length}개 품목을 불러왔습니다.`);
    window.setTimeout(() => setNotice(""), 1800);
  }

  function repeatLastOrder() {
    if (!dashboard?.lastOrderItems.length) return;
    setEditingOrderId(null);
    const lines: CartLine[] = [];
    for (const item of dashboard.lastOrderItems) {
      const product = store.products.find((row) => row.id === item.productId);
      const option = product?.packOptions.find((row) => row.label === item.optionLabel);
      if (product && option && !product.soldout) {
        lines.push({ productId: product.id, productName: product.name, unit: product.unit, optionLabel: option.label, quantity: item.quantity, unitPrice: option.price ?? 0, step: option.step || 1 });
      }
    }
    if (!lines.length) return;
    addToCart(lines);
    setNotice(`지난 주문 ${lines.length}개 품목을 장바구니에 담았습니다.`);
  }

  function loadWeekdayTemplate(items: DashboardData["weekdayTemplates"][number]["items"], label: string) {
    const lines: CartLine[] = [];
    for (const item of items) {
      const product = store.products.find((row) => row.id === item.productId);
      const option = product?.packOptions.find((row) => row.label === item.optionLabel);
      if (product && option && !product.soldout) lines.push({ productId: product.id, productName: product.name, unit: product.unit, optionLabel: option.label, quantity: item.quantity, unitPrice: option.price ?? 0, step: option.step || 1 });
    }
    if (!lines.length) return;
    setEditingOrderId(null);
    setCart(lines);
    setWeekdayOpen(false);
    setCheckoutOpen(true);
    setNotice(`${label} 지난 주문을 불러왔습니다.`);
    window.setTimeout(() => setNotice(""), 1800);
  }

  function editLatestOrder(orderId: string) {
    if (!dashboard?.lastOrderItems.length || dashboard.recent[0]?.id !== orderId) return;
    const lines: CartLine[] = [];
    for (const item of dashboard.lastOrderItems) {
      const product = store.products.find((row) => row.id === item.productId);
      const option = product?.packOptions.find((row) => row.label === item.optionLabel);
      if (product && option) {
        lines.push({ productId: product.id, productName: product.name, unit: product.unit, optionLabel: option.label, quantity: item.quantity, unitPrice: option.price ?? 0, step: option.step || 1 });
      }
    }
    if (!lines.length) return;
    setCart(lines);
    setEditingOrderId(orderId);
    setCheckoutOpen(true);
  }

  function canEditOrder(order: DashboardData["recent"][number]) {
    if (order.status !== "received" || order.printed) return false;
    const created = new Date(order.createdAt.replace(" ", "T") + "Z").getTime();
    return Number.isFinite(created) && Date.now() - created <= store.orderSettings.editMinutes * 60 * 1000;
  }

  async function cancelOrder(orderId: string) {
    if (!window.confirm("이 주문을 취소할까요? 이미 출고준비가 시작된 주문은 취소되지 않습니다.")) return;
    const response = await fetch("/api/orders", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId }),
    });
    const data = await response.json() as { error?: string };
    if (!response.ok) { window.alert(data.error || "주문 취소에 실패했습니다."); return; }
    setNotice("주문이 취소되었습니다.");
    await refreshDashboard();
    window.setTimeout(() => setNotice(""), 2500);
  }

  if (auth === null) {
    return <div className="state-page"><img className="state-logo" src={BUJA_MARK_DATA} alt="" /><p>거래처 정보를 확인하는 중입니다.</p></div>;
  }
  if (!auth.authenticated || !auth.customer) {
    return <CustomerLogin onSuccess={loadSession} />;
  }

  return (
    <div className="site-shell">
      <header className="topbar">
        <div className="wrap topbar-inner">
          <a href="/" className="brand-lockup" aria-label="부자유통 홈">
            <img src={BUJA_LOGO_DATA} alt="부자유통" />
          </a>
          <div className="session-actions customer-session-actions">
            <span><b>{auth.customer.loginName || auth.customer.name}</b><small>{auth.customer.code} · {auth.customer.loginName ? auth.customer.name : "거래처"}</small></span>
            <a className="price-list-shortcut" href="/price-list">단가표</a>
            <button type="button" onClick={logoutCustomer}>로그아웃</button>
          </div>
        </div>
      </header>

      <main>
        <section className="wrap customer-home">
          <div className="customer-greeting">
            <div>
              <p>{auth.customer.region ? `${auth.customer.region} · ` : ""}{auth.customer.code}</p>
              <h1>{auth.customer.name} 사장님, 무엇을 주문할까요?</h1>
            </div>
            <div className={`order-open-badge ${store.orderSettings.enabled ? "on" : "off"}`}>
              {store.orderSettings.enabled
                ? (store.orderSettings.open24h ? "24시간 주문 가능" : `${store.orderSettings.openTime}~${store.orderSettings.closeTime}`)
                : "주문 접수 중지"}
            </div>
          </div>
          <div className="quick-actions primary-order-actions">
            <button type="button" className="event" onClick={() => chooseCategory(store.promoCategory)}>🚨 행사상품</button>
            <button type="button" className="weekday" disabled={!dashboard?.weekdayTemplates?.some((row) => row.items.length)} onClick={() => setWeekdayOpen(true)}>📅 요일별 지난 주문</button>
            <button type="button" onClick={() => { setCategory("전체"); setQuery(""); window.setTimeout(() => searchRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 50); }}>🔎 전체상품</button>
            <button type="button" onClick={() => { window.location.href = "/price-list"; }}>📋 부자유통 단가표</button>
          </div>
        </section>

        {frequentProducts.length > 0 && (
          <section className="wrap frequent-section">
            <div className="section-mini-head"><div><p>이 거래처 기준</p><h2>평소 주문표 · 자주 주문</h2></div><button type="button" className="usual-order-load" onClick={loadUsualOrder}>평소 수량으로 한 번에 담기</button></div>
            <div className="frequent-rail">
              {frequentProducts.slice(0, 8).map((product) => (
                <button type="button" className="mini-product" key={product.id} onClick={() => setSelected(product)} disabled={product.soldout}>
                  <div>{product.photo ? <img src={product.photo} alt="" /> : <img src={BUJA_MARK_DATA} alt="" />}</div>
                  <strong>{product.name}</strong><span>{product.unit}{dashboard?.usualOrderItems?.find((row) => row.productId === product.id) ? ` · 평소 ${dashboard.usualOrderItems.find((row) => row.productId === product.id)?.quantity}${dashboard.usualOrderItems.find((row) => row.productId === product.id)?.optionLabel}` : ""}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {dashboard && dashboard.recent.length > 0 && (
          <section className="wrap recent-orders">
            <div className="section-mini-head"><div><p>최근 접수내역</p><h2>이전 주문</h2></div></div>
            <div className="recent-order-rail">
              {dashboard.recent.slice(0, 4).map((order) => (
                <div className="recent-order-card" key={order.id}>
                  <div><b>{order.createdAt.slice(5, 16)}{order.deliveryDate ? ` · 배송 ${order.deliveryDate.slice(5)}` : ""}</b><span>{order.status === "shipped" ? "출고완료" : order.status === "cancelled" ? "취소" : "접수"}</span></div>
                  <p>{order.summary}</p><div className="recent-order-bottom"><strong>{won(order.total)}원</strong><span className="recent-order-actions">{canEditOrder(order) && dashboard.recent[0]?.id === order.id && <button type="button" onClick={() => editLatestOrder(order.id)}>수정</button>}{order.status === "received" && !order.printed && <button type="button" onClick={() => void cancelOrder(order.id)}>취소</button>}</span></div>
                </div>
              ))}
            </div>
          </section>
        )}

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
            <h2>앱에서 주문하면 부자유통에 바로 접수됩니다.</h2>
            <p>문자를 다시 보낼 필요가 없습니다. 주문 완료 안내가 뜨면 정상 접수된 것입니다.</p>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="wrap footer-inner">
          <span>부자유통</span>
          <span>거래처용 식자재 주문</span>
        </div>
      </footer>

      {selected && <OrderSheet product={selected} onClose={() => setSelected(null)} onAdd={addToCart} />}
      {cart.length > 0 && (
        <button type="button" className="floating-cart" onClick={() => setCheckoutOpen(true)}>
          <span>장바구니 · {cart.length}품목</span>
          <b>{new Intl.NumberFormat("ko-KR").format(cart.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0))}원</b>
        </button>
      )}
      {checkoutOpen && (
        <CheckoutSheet
          cart={cart}
          setCart={setCart}
          editingOrderId={editingOrderId}
          receivable={auth.customer.receivable ?? 0}
          onClose={() => setCheckoutOpen(false)}
          onOrdered={async (id) => {
            setCheckoutOpen(false); setCart([]); setEditingOrderId(null); setNotice(`주문이 ${editingOrderId ? "수정" : "접수"}되었습니다. ${id}`);
            await refreshDashboard(); window.setTimeout(() => setNotice(""), 3500);
          }}
        />
      )}
      {weekdayOpen && dashboard && (
        <div className="sheet-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setWeekdayOpen(false); }}>
          <section className="order-sheet weekday-sheet" role="dialog" aria-modal="true">
            <div className="sheet-top"><div><p>최근 해당 요일 주문</p><h2>요일별 지난 주문</h2><span>월요일부터 토요일까지 골라 바로 불러올 수 있습니다.</span></div><button type="button" className="sheet-close" onClick={() => setWeekdayOpen(false)}>×</button></div>
            <div className="weekday-template-list">{dashboard.weekdayTemplates.map((row) => (
              <div className={`weekday-template ${row.items.length ? "has-order" : "empty"}`} key={row.weekday}>
                <div><strong>{row.label}</strong><span>{row.orderedAt ? `최근 ${row.orderedAt.slice(0,10)}` : "주문기록 없음"}</span></div>
                {row.items.length ? <><p>{row.items.slice(0,6).map((item) => `${item.productName} ${item.quantity}${item.optionLabel}`).join(" · ")}{row.items.length > 6 ? ` 외 ${row.items.length - 6}개` : ""}</p><button type="button" onClick={() => loadWeekdayTemplate(row.items, row.label)}>{row.label} 주문 불러오기</button></> : <p>아직 이 요일의 주문기록이 없습니다.</p>}
              </div>
            ))}</div>
          </section>
        </div>
      )}
      {notice && <div className="toast-message">{notice}</div>}
    </div>
  );
}


function CustomerLogin({ onSuccess }: { onSuccess: () => Promise<void> }) {
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/customer/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, pin, username }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "로그인에 실패했습니다.");
      await onSuccess();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "로그인에 실패했습니다.");
    } finally { setBusy(false); }
  }

  return (
    <div className="customer-login-page">
      <header className="login-brand"><img src={BUJA_LOGO_DATA} alt="부자유통" /></header>
      <main className="customer-login-card">
        <img src={BUJA_MARK_DATA} alt="" />
        <p>거래처 전용 주문</p>
        <h1>처음 한 번만 로그인해 주세요.</h1>
        <span>이 휴대폰에서는 다음부터 자동으로 로그인됩니다.</span>
        <form onSubmit={submit}>
          <label>거래처번호<input value={code} onChange={(e) => setCode(e.target.value)} placeholder="예: 8-18" autoComplete="organization" /></label>
          <label>직원 아이디 <small>직원계정 사용 시에만</small><input value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} placeholder="사장님 기존 계정은 비워두세요" autoComplete="username" /></label>
          <label>인증번호 / PIN<input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="숫자 6자리" inputMode="numeric" autoComplete="current-password" /></label>
          {error && <p className="form-error">{error}</p>}
          <button type="submit" disabled={busy || !code.trim() || pin.length !== 6}>{busy ? "확인 중..." : "로그인"}</button>
        </form>
        <a className="login-price-list-link" href="/price-list">로그인 없이 부자유통 단가표 보기</a>
        <small>인증번호를 모르시면 부자유통으로 문의해 주세요.</small>
      </main>
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
  const positionRef = useRef(0);
  const interactionTimerRef = useRef<number | null>(null);
  const [paused, setPaused] = useState(false);
  const repeatCount = Math.max(6, Math.ceil(14 / Math.max(products.length, 1)));
  const repeatedProducts = Array.from({ length: repeatCount }, () => products).flat();

  function pauseForInteraction(delay = 2200) {
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

    let next = track.scrollLeft;
    while (next >= segment * 2) next -= segment;
    while (next < segment * 0.55) next += segment;

    positionRef.current = next;
    if (Math.abs(track.scrollLeft - next) > 1) track.scrollLeft = next;
  }

  function scrollByViewport(direction: -1 | 1) {
    const track = trackRef.current;
    if (!track) return;
    pauseForInteraction(2400);
    track.scrollBy({
      left: direction * Math.max(240, track.clientWidth * 0.72),
      behavior: "smooth",
    });
    window.setTimeout(normalizeLoopPosition, 650);
  }

  useEffect(() => {
    const track = trackRef.current;
    if (!track || products.length === 0) return;

    const placeAtLoopStart = () => {
      const segment = segmentWidth();
      if (!segment) return;
      positionRef.current = segment;
      track.scrollLeft = segment;
    };

    const frame = window.requestAnimationFrame(placeAtLoopStart);
    return () => window.cancelAnimationFrame(frame);
  }, [products.length, repeatCount]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track || products.length === 0) return;

    let frame = 0;
    let previous = 0;
    const pixelsPerSecond = 22;

    const animate = (time: number) => {
      if (!previous) previous = time;
      const elapsed = Math.min(time - previous, 80);
      previous = time;

      const segment = segmentWidth();
      if (segment > 0) {
        if (paused) {
          positionRef.current = track.scrollLeft;
        } else {
          let next = positionRef.current + (pixelsPerSecond * elapsed) / 1000;
          while (next >= segment * 2) next -= segment;
          while (next < segment * 0.55) next += segment;
          positionRef.current = next;
          track.scrollLeft = next;
        }
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
          onPointerUp={() => pauseForInteraction(1500)}
          onTouchStart={() => pauseForInteraction()}
          onWheel={() => pauseForInteraction()}
          onScroll={() => {
            if (paused && trackRef.current) positionRef.current = trackRef.current.scrollLeft;
          }}
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
        {product.soldout ? "품절" : "바로 주문"} <span aria-hidden="true">→</span>
      </button>
    </article>
  );
}

function OrderSheet({ product, onClose, onAdd }: { product: Product; onClose: () => void; onAdd: (lines: CartLine[]) => void }) {
  const [quantities, setQuantities] = useState<number[]>(product.packOptions.map(() => 0));
  const [message, setMessage] = useState("");

  function setQty(index: number, next: number) {
    const option = product.packOptions[index];
    if (!option) return;
    const step = option.step || 1;
    const rounded = Math.max(0, Math.round(next / step) * step);
    setQuantities((current) => current.map((value, i) => i === index ? Number(rounded.toFixed(3)) : value));
  }

  function add() {
    const lines = product.packOptions.map((option, index) => ({ option, qty: quantities[index] ?? 0 }))
      .filter((row) => row.qty > 0)
      .map(({ option, qty }) => ({ productId: product.id, productName: product.name, unit: product.unit, optionLabel: option.label, quantity: qty, unitPrice: option.price ?? 0, step: option.step || 1 }));
    if (!lines.length) { setMessage("수량을 하나 이상 선택해 주세요."); return; }
    onAdd(lines);
  }

  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="order-sheet" role="dialog" aria-modal="true" aria-labelledby="order-title">
        <div className="sheet-top"><div><p>주문 담기</p><h2 id="order-title">{product.name}</h2><span>{product.unit}</span></div><button type="button" className="sheet-close" onClick={onClose}>×</button></div>
        <div className="quantity-list">{product.packOptions.map((option, index) => <QuantityRow key={`${option.label}-${index}`} option={option} qty={quantities[index] ?? 0} onChange={(next) => setQty(index, next)} />)}</div>
        {message && <p className="form-error" role="alert">{message}</p>}
        <button type="button" className="compose-sms" onClick={add}>장바구니 담기 <span aria-hidden="true">→</span></button>
      </section>
    </div>
  );
}

function CheckoutSheet({ cart, setCart, editingOrderId, receivable, onClose, onOrdered }: { cart: CartLine[]; setCart: React.Dispatch<React.SetStateAction<CartLine[]>>; editingOrderId: string | null; receivable: number; onClose: () => void; onOrdered: (id: string) => Promise<void> }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const total = cart.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);

  function change(index: number, direction: number) {
    setCart((current) => current.map((line, i) => i === index ? { ...line, quantity: Math.max(0, Number((line.quantity + direction * line.step).toFixed(3))) } : line).filter((line) => line.quantity > 0));
  }

  async function submit(confirmAnomaly = false) {
    if (!cart.length) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/orders", { method: editingOrderId ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: editingOrderId ?? undefined, items: cart.map((line) => ({ productId: line.productId, optionLabel: line.optionLabel, quantity: line.quantity })), note, confirmAnomaly }) });
      const data = await response.json() as { error?: string; warning?: boolean; warnings?: Array<{ message: string }>; order?: { id: string } };
      if (response.status === 409 && data.warning) {
        const details = (data.warnings ?? []).map((row) => `• ${row.message}`).join("\n");
        setBusy(false);
        if (window.confirm(`⚠ 평소 주문량보다 많은 품목이 있습니다.\n\n${details}\n\n수량이 맞으면 확인을 눌러 주문하세요.`)) await submit(true);
        return;
      }
      if (!response.ok || !data.order) throw new Error(data.error || "주문 접수에 실패했습니다.");
      await onOrdered(data.order.id);
    } catch (error) { setMessage(error instanceof Error ? error.message : "주문 접수에 실패했습니다."); }
    finally { setBusy(false); }
  }

  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="order-sheet checkout-sheet" role="dialog" aria-modal="true">
        <div className="sheet-top"><div><p>{editingOrderId ? "주문 수정" : "최종 확인"}</p><h2>{editingOrderId ? "주문 수정하기" : "주문하기"}</h2><span>{cart.length}개 품목</span></div><button type="button" className="sheet-close" onClick={onClose} disabled={busy}>×</button></div>
        <div className="checkout-lines">{cart.map((line, index) => (
          <div className="checkout-line" key={`${line.productId}-${line.optionLabel}`}>
            <div><strong>{line.productName}</strong><span>{line.optionLabel} · {line.unitPrice ? `${won(line.unitPrice)}원` : "가격 문의"}</span></div>
            <div className="compact-stepper"><button type="button" onClick={() => change(index, -1)}>−</button><b>{line.quantity}</b><button type="button" onClick={() => change(index, 1)}>+</button></div>
          </div>
        ))}</div>
        <label className="customer-field"><span>요청사항</span><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="없으면 비워두세요" maxLength={200} /></label>
        <div className="order-summary"><span>예상 금액</span><strong>{total > 0 ? `${won(total)}원` : "가격 문의 포함"}</strong></div>
        {message && <p className="form-error" role="alert">{message}</p>}
        <button type="button" className="compose-sms" onClick={() => void submit(false)} disabled={busy || !cart.length}>{busy ? "처리 중..." : editingOrderId ? "수정 확정" : "주문 확정"}</button>
        <p className={`receivable-note ${receivable > 0 ? "has-balance" : ""}`}>현재 미수금 {won(receivable)}원</p>
        <p className="sheet-help">주문 확정을 누르면 부자유통 관리자 화면에 바로 접수됩니다.</p>
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
