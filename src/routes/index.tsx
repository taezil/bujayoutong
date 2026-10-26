import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { readStore } from "../lib/db.server";
import type { PackOption, Product, StoreData } from "../lib/db.server";
import { BUJA_LOGO_DATA, BUJA_MARK_DATA } from "../brand-assets";
import { CATEGORY_IMAGE_DATA } from "../category-images";

// 거래처 화면에는 가격을 보여주지 않으므로 그룹별 단가(A/B)는 내려보내지 않음
const getStore = createServerFn({ method: "GET" }).handler(async () => {
  const store = await readStore();
  return {
    ...store,
    products: store.products.map((product) => ({
      ...product,
      packOptions: product.packOptions.map((option) => ({ label: option.label, spec: option.spec, price: option.price, step: option.step })),
    })),
  };
});

export const Route = createFileRoute("/")({
  loader: () => getStore(),
  component: OrderPage,
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

type Tab = "home" | "category" | "promo";

const CART_STORAGE_KEY = "buja-simple-cart-v1";
const SENT_STORAGE_KEY = "buja-simple-cart-sent-v1";
const ALL = "전체";


/* ---------- 검색 ---------- */

// 자주 섞여 쓰이는 표기를 하나로 맞춤 (돈까스=돈가스 등)
const SPELLING_VARIANTS: Array<[RegExp, string]> = [
  [/까스/g, "가스"],
  [/쭈꾸미/g, "주꾸미"],
  [/오뎅/g, "어묵"],
  [/소세지/g, "소시지"],
  [/케찹/g, "케첩"],
  [/짜장/g, "자장"],
  [/후라이/g, "프라이"],
];

const CHOSEONG = ["ㄱ","ㄲ","ㄴ","ㄷ","ㄸ","ㄹ","ㅁ","ㅂ","ㅃ","ㅅ","ㅆ","ㅇ","ㅈ","ㅉ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];

function normalize(value: string) {
  let text = value.toLocaleLowerCase("ko-KR").replace(/[\s()[\]{}·.,/_-]+/g, "");
  for (const [pattern, replacement] of SPELLING_VARIANTS) text = text.replace(pattern, replacement);
  return text;
}

function toChoseong(value: string) {
  let out = "";
  for (const char of value) {
    const code = char.charCodeAt(0) - 0xac00;
    out += code >= 0 && code < 11172 ? CHOSEONG[Math.floor(code / 588)] : char;
  }
  return out;
}

/* ---------- 상품 안내 문구 ---------- */

function productOptions(product: Product): PackOption[] {
  return product.packOptions.length ? product.packOptions : [{ label: product.unit, spec: product.unit, price: product.price, step: 1 }];
}

function smallPackWord(options: PackOption[]) {
  return options.map((option) => option.label.trim()).find((label) => label && !label.includes("박스")) ?? "";
}

function servingText(value: string) {
  const text = value.trim();
  if (!text) return "";
  return /인분\s*$/.test(text) ? text : `${text}인분`;
}

function packCountSuffix(label: string) {
  if (label.includes("봉")) return "봉";
  if (label.includes("팩")) return "팩";
  if (label.includes("개")) return "개";
  if (label.includes("통")) return "통";
  if (label.includes("캔")) return "캔";
  if (label.includes("판")) return "판";
  if (label.includes("묶음")) return "묶음";
  return "봉";
}

function boxContentsText(value: string, smallLabel: string) {
  const text = value.trim().replace(/^1\s*박스\s*/i, "");
  if (!text) return "";
  if (/^\d+(?:\.\d+)?$/.test(text)) return `${text}${packCountSuffix(smallLabel)}`;
  return text.replace(/봉지\s*$/, "봉");
}

function servingsLines(product: Product) {
  const lines: string[] = [];
  const unitServings = (product.servingsPerUnit ?? "").trim();
  const boxContents = (product.boxContents ?? "").trim();
  const boxServings = (product.servingsPerBox ?? "").trim();
  const word = smallPackWord(productOptions(product));

  if (unitServings) {
    const label = word || "단위";
    const normalized = servingText(unitServings);
    const alreadyLabeled = /^1/.test(normalized) || normalized.includes(label);
    lines.push(alreadyLabeled ? normalized : `1${label} ${normalized}`);
  }

  if (boxContents || boxServings) {
    const contents = boxContentsText(boxContents, word);
    const servings = servingText(boxServings);
    if (contents && servings) lines.push(`1박스 ${contents} (${servings})`);
    else if (contents) lines.push(`1박스 ${contents}`);
    else if (servings) lines.push(`1박스 ${servings}`);
  }

  return lines;
}

function optionSpec(product: Product, option: PackOption) {
  const explicit = (option.spec ?? "").trim();
  if (explicit) {
    const numericOnly = explicit.match(/^([0-9]+(?:\.[0-9]+)?)$/);
    if (numericOnly) return `${numericOnly[1]}kg`;
    return explicit;
  }
  const options = productOptions(product);
  if (options.length === 1 || !option.label.includes("박스")) return product.unit.trim();
  return "";
}

/* ---------- 문자/복사/저장 ---------- */

function buildOrderText(cart: CartLine[]) {
  const grouped = new Map<string, string[]>();

  for (const line of cart) {
    const parts = grouped.get(line.productName) ?? [];
    parts.push(`${line.quantity}${line.optionLabel}`);
    grouped.set(line.productName, parts);
  }

  const lines = Array.from(grouped, ([productName, quantities]) => `${productName} / ${quantities.join(" ")}`);
  return ["[부자유통 발주]", "", ...lines, "", `총 ${lines.length}품목`].join("\n");
}

function isIOS() {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

async function copyText(text: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 아래 예비 방식으로 진행
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

function readStorage(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // 저장이 막힌 브라우저(사생활 모드 등)에서는 조용히 무시
  }
}

function CategoryTilePhoto({ candidates }: { candidates: string[] }) {
  const clean = candidates.filter(Boolean);
  const [photoIndex, setPhotoIndex] = useState(0);
  const signature = clean.join("|");

  useEffect(() => {
    setPhotoIndex(0);
  }, [signature]);

  const src = clean[photoIndex] ?? "";
  return (
    <span className="od-tile-img category-photo">
      {src
        ? (
          <img
            src={src}
            alt=""
            loading="eager"
            decoding="async"
            onError={() => setPhotoIndex((current) => current + 1)}
          />
        )
        : <img src={BUJA_MARK_DATA} alt="" className="mark" />}
    </span>
  );
}

/* ---------- 페이지 ---------- */

function OrderPage() {
  const store = Route.useLoaderData() as StoreData;
  const [tab, setTab] = useState<Tab>("home");
  const [category, setCategory] = useState(ALL);
  const [sub, setSub] = useState(ALL);
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [detail, setDetail] = useState<Product | null>(null);
  const [zoomPhoto, setZoomPhoto] = useState<{ src: string; name: string } | null>(null);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const [askSent, setAskSent] = useState(false);
  const [copied, setCopied] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const promo = store.promoCategory && store.promoCategory in store.categories ? store.promoCategory : "";
  const recipient = (store.sms || "").replace(/[^0-9+]/g, "");
  const productById = useMemo(() => new Map(store.products.map((product) => [product.id, product])), [store.products]);

  // 저장된 장바구니만 불러온다.
  // 기존 최근주문 데이터(buja-simple-history-v1)는 삭제하지 않고 각 기기에 그대로 보존한다.
  useEffect(() => {
    const raw = readStorage(CART_STORAGE_KEY);
    if (raw) {
      try {
        const saved = JSON.parse(raw) as CartLine[];
        setCart(reconcile(Array.isArray(saved) ? saved : []).lines);
      } catch {
        writeStorage(CART_STORAGE_KEY, null);
      }
    }
    if (readStorage(SENT_STORAGE_KEY)) setAskSent(true);
    setHydrated(true);
    // 처음 한 번만 복원 (이후에는 화면의 장바구니가 기준)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    writeStorage(CART_STORAGE_KEY, cart.length ? JSON.stringify(cart) : null);
  }, [cart, hydrated]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 1800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function reconcile(lines: CartLine[]) {
    let skipped = 0;
    const result = lines.flatMap((line) => {
      const product = productById.get(line?.productId);
      if (!product || product.soldout || !(Number(line.quantity) > 0)) {
        skipped += 1;
        return [];
      }
      return [{ ...line, productName: product.name, spec: product.unit, quantity: Number(line.quantity) }];
    });
    return { lines: result, skipped };
  }

  // 행사품목 카테고리를 맨 앞에 배치
  const categoryNames = useMemo(() => {
    const rest = Object.keys(store.categories).filter((name) => name !== promo);
    return promo ? [promo, ...rest] : rest;
  }, [store.categories, promo]);

  // 카테고리 타일 사진 후보. 냉동수산은 깨진 과거 대표이미지를 건너뛰고
  // 현재 운영 중인 냉동수산 상품사진을 우선 사용하며, 404면 다음 후보로 자동 전환한다.
  const categoryPhotoCandidates = useMemo(() => {
    const covers: Record<string, string[]> = {};
    const unique = (values: Array<string | undefined>) => Array.from(new Set(values.filter((value): value is string => Boolean(value))));

    for (const name of categoryNames) {
      const productPhotos = store.products
        .filter((product) => product.category === name && product.photo)
        .map((product) => product.photo);

      if (name === "냉동수산") {
        const preferredIds = ["ERP-32399", "ERP-1021", "ERP-1072", "ERP-1024"];
        const preferredPhotos = preferredIds
          .map((id) => store.products.find((product) => product.id === id)?.photo)
          .filter((photo): photo is string => Boolean(photo));
        covers[name] = unique([
          store.categoryImages?.[name],
          "/api/photo?id=category-frozen-seafood-v2.webp",
          ...preferredPhotos,
          ...productPhotos.filter((photo) => photo !== "/api/photo?id=catalog-5daf8a49637b59ad9fba.webp"),
        ]);
      } else {
        covers[name] = unique([
          store.categoryImages?.[name],
          CATEGORY_IMAGE_DATA[name],
          ...productPhotos,
        ]);
      }
    }
    return covers;
  }, [categoryNames, store.categoryImages, store.products]);

  const searchIndex = useMemo(() => new Map(store.products.map((product) => {
    const text = `${product.name} ${product.category} ${product.sub} ${product.unit}`;
    return [product.id, { text: normalize(text), choseong: toChoseong(product.name.replace(/\s+/g, "")) }];
  })), [store.products]);

  // 판매 중 먼저, 품절은 맨 아래 (같은 그룹 안 순서는 관리자 정렬 그대로)
  function sortForDisplay(list: Product[], promoFirst: boolean) {
    const rank = (product: Product) => (product.soldout ? 2 : 0) + (promoFirst && promo && product.category !== promo ? 1 : 0);
    return list
      .map((product, index) => ({ product, index }))
      .sort((a, b) => rank(a.product) - rank(b.product) || a.index - b.index)
      .map((item) => item.product);
  }

  const searchResults = useMemo(() => {
    const raw = query.trim().replace(/\s+/g, "");
    if (!raw) return [];
    const choseongOnly = /^[ㄱ-ㅎ]+$/.test(raw);
    const needle = normalize(query);
    return sortForDisplay(store.products.filter((product) => {
      const entry = searchIndex.get(product.id);
      if (!entry) return false;
      return choseongOnly ? entry.choseong.includes(raw) : entry.text.includes(needle);
    }), true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, store.products, searchIndex, promo]);

  const promoProducts = useMemo(
    () => (promo ? sortForDisplay(store.products.filter((product) => product.category === promo), false) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store.products, promo],
  );

  const featuredProducts = useMemo(
    () => (promoProducts.length ? promoProducts : sortForDisplay(store.products, false)).slice(0, 6),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [promoProducts, store.products],
  );
  const heroProduct = featuredProducts.find((product) => product.photo) ?? store.products.find((product) => product.photo);
  const heroImage = store.heroImage || heroProduct?.photo || "";

  const categoryProducts = useMemo(() => {
    const list = store.products.filter((product) => {
      if (category !== ALL && product.category !== category) return false;
      if (category !== ALL && sub !== ALL && product.sub !== sub) return false;
      return true;
    });
    return sortForDisplay(list, category === ALL);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.products, category, sub, promo]);

  const subNames = category !== ALL ? (store.categories[category] ?? []).filter((name) => store.products.some((p) => p.category === category && p.sub === name)) : [];

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
      const next: CartLine = { key, productId: product.id, productName: product.name, spec: product.unit, optionLabel, quantity: nextQuantity, step };
      // 기존 줄은 제자리에서 수량만 바꿔서 장바구니 순서가 흔들리지 않게 함
      if (index >= 0) return current.map((line, i) => (i === index ? next : line));
      return [...current, next];
    });
  }

  function changeFromCard(product: Product, option: PackOption, quantity: number) {
    const label = option.label || product.unit;
    const before = quantityFor(product.id, label);
    setQuantity(product, option, quantity);
    const shown = Math.max(0, Number(quantity.toFixed(3)));
    if (shown > before) setToast({ id: Date.now(), text: `${product.name} ${shown}${label} 담았습니다` });
    else if (shown === 0 && before > 0) setToast({ id: Date.now(), text: `${product.name} ${label} 뺐습니다` });
  }

  function changeCartLine(line: CartLine, direction: -1 | 1) {
    const product = productById.get(line.productId);
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
    const body = encodeURIComponent(buildOrderText(cart));
    writeStorage(SENT_STORAGE_KEY, String(Date.now()));
    setCartOpen(false);
    setAskSent(true);
    // 아이폰은 '&body=', 안드로이드는 '?body=' 형식을 사용
    window.location.href = `sms:${recipient}${isIOS() ? "&" : "?"}body=${body}`;
  }

  async function copyOrder() {
    const ok = await copyText(buildOrderText(cart));
    setCopied(ok);
    setToast({ id: Date.now(), text: ok ? "주문 내용을 복사했습니다. 카톡이나 문자에 붙여넣으세요." : "복사가 되지 않았습니다. 문자로 보내기를 이용해 주세요." });
    if (ok) window.setTimeout(() => setCopied(false), 2500);
  }

  function answerSent(sent: boolean) {
    writeStorage(SENT_STORAGE_KEY, null);
    setAskSent(false);
    if (sent && cart.length) {
      setCart([]);
      setToast({ id: Date.now(), text: "주문해 주셔서 감사합니다." });
    }
  }

  function goTab(next: Tab, nextCategory?: string) {
    setQuery("");
    setTab(next);
    if (nextCategory !== undefined) {
      setCategory(nextCategory);
      setSub(ALL);
    }
    window.scrollTo({ top: 0 });
  }

  function openCategory(name: string) {
    goTab("category", name);
  }

  const searching = query.trim().length > 0;
  const cardProps = {
    promo,
    quantityFor,
    onQuantity: changeFromCard,
    onOpen: (product: Product) => setDetail(product),
  };

  let content: ReactNode;
  if (searching) {
    content = (
      <section className="od-section">
        <div className="od-section-head"><h2>'{query.trim()}' 검색 결과</h2><span>{searchResults.length}개</span></div>
        <ProductGrid products={searchResults} empty={<>찾는 상품이 없습니다.<br />다른 이름으로 검색해 보세요.</>} {...cardProps} />
      </section>
    );
  } else if (tab === "home") {
    content = (
      <>
        <nav className="od-tiles od-home-tiles" aria-label="카테고리">
          {categoryNames.map((name) => (
            <button type="button" key={name} className={`od-tile ${name === promo ? "promo" : ""}`} onClick={() => openCategory(name)}>
              <CategoryTilePhoto candidates={categoryPhotoCandidates[name] || []} />
              <span className="od-tile-name">{name}</span>
            </button>
          ))}
        </nav>

        <button type="button" className="od-hero" onClick={() => promo ? goTab("promo") : goTab("category", ALL)}>
          {heroImage
            ? <img src={heroImage} alt="" aria-hidden="true" />
            : <img src={BUJA_MARK_DATA} alt="" aria-hidden="true" className="mark" />}
          <span className="od-hero-shade" />
          <span className="od-hero-copy">
            <small>{store.heroKicker || "프리미엄 식자재몰"} <b>✦</b></small>
            <strong>{store.heroTitle || "좋은 식재료가\n사장님의 경쟁력입니다."}</strong>
            <em>{store.heroDescription || "신선한 식재료를 더 빠르고,\n더 편리하게 주문하세요."}</em>
          </span>
        </button>

        <section className="od-section od-featured">
          <div className="od-section-head">
            <h2>행사상품</h2>
            <button type="button" onClick={() => promoProducts.length ? goTab("promo") : goTab("category", ALL)}>전체보기 ›</button>
          </div>
          <ProductGrid products={featuredProducts} {...cardProps} />
        </section>

        <button type="button" className="od-all-button" onClick={() => goTab("category", ALL)}>전체 상품 보기 ({store.products.length}개) ›</button>
      </>
    );
  } else if (tab === "promo") {
    content = (
      <section className="od-section">
        <div className="od-section-head"><h2>🔥 {promo || "행사상품"}</h2><span>{promoProducts.length}개</span></div>
        <ProductGrid products={promoProducts} empty="지금 진행 중인 행사 상품이 없습니다." {...cardProps} />
      </section>
    );
  } else if (tab === "category") {
    content = (
      <>
        <nav className="od-tiles od-home-tiles od-category-fixed" aria-label="카테고리 선택">
          {categoryNames.map((name) => (
            <button
              type="button"
              key={name}
              className={`od-tile ${category === name ? "selected" : ""} ${name === promo ? "promo" : ""}`}
              onClick={() => { setCategory(name); setSub(ALL); window.scrollTo({ top: 0 }); }}
            >
              <CategoryTilePhoto candidates={categoryPhotoCandidates[name] || []} />
              <span className="od-tile-name">{name}</span>
            </button>
          ))}
        </nav>
        {subNames.length > 1 && (
          <nav className="od-subchips od-category-subchips" aria-label="세부 분류">
            {[ALL, ...subNames].map((name) => (
              <button type="button" key={name} className={sub === name ? "selected" : ""} onClick={() => setSub(name)}>{name}</button>
            ))}
          </nav>
        )}
        <section className="od-section">
          <div className="od-section-head"><h2>{category === ALL ? "전체 상품" : sub !== ALL ? `${category} · ${sub}` : category}</h2><span>{categoryProducts.length}개</span></div>
          <ProductGrid products={categoryProducts} empty="이 분류에 등록된 상품이 없습니다." {...cardProps} />
        </section>
      </>
    );
  }

  return (
    <div className={`od-page ${cart.length ? "has-cart" : ""}`}>
      <header className="od-header">
        <div className="od-wrap od-header-row">
          <button type="button" className="od-brand" onClick={() => goTab("home")} aria-label="홈으로">
            <img src={BUJA_LOGO_DATA} alt="부자유통" />
          </button>
          <span className="od-header-title"><strong>좋은 식재료,</strong><small>사장님의 성공을 위해</small></span>
          <button type="button" className="od-cart-icon" onClick={() => setCartOpen(true)} aria-label={`장바구니 ${cart.length}품목`}>
            <CartIcon />
            {cart.length > 0 && <b key={cart.length} className="bump">{cart.length}</b>}
          </button>
        </div>
        <div className="od-wrap">
          <div className="od-search">
            <SearchIcon />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="상품명 검색 (예: 돈까스, 만두, 김치 등)" type="search" enterKeyHint="search" />
            {query && <button type="button" aria-label="검색어 지우기" onClick={() => setQuery("")}>×</button>}
          </div>
        </div>
      </header>

      <main className="od-wrap od-main">{content}</main>

      {toast && <div className="od-toast" key={toast.id} role="status">{toast.text}</div>}

      <div className="od-bottom">
        {cart.length > 0 && (
          <div className="od-wrap">
            <button type="button" className="od-cartbar" onClick={() => setCartOpen(true)}>
              <span className="od-cartbar-icon"><CartIcon /><b key={cart.length} className="bump">{cart.length}</b></span>
              <span className="od-cartbar-text"><strong>장바구니 {cart.length}품목</strong><small>{cartSummary(cart)}</small></span>
              <span className="od-cartbar-go">주문 확인 ›</span>
            </button>
          </div>
        )}
        <nav className="od-tabbar" aria-label="메뉴">
          <TabButton active={!searching && tab === "home"} label="홈" onClick={() => goTab("home")} icon={<HomeIcon />} />
          <TabButton active={!searching && tab === "category"} label="카테고리" onClick={() => goTab("category")} icon={<GridIcon />} />
          <TabButton active={!searching && tab === "promo"} label="행사상품" onClick={() => goTab("promo")} icon={<TagIcon />} />
        </nav>
      </div>

      {detail && (
        <div className="od-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setDetail(null); }}>
          <section className="od-sheet od-detail" role="dialog" aria-modal="true" aria-label={`${detail.name} 상세`}>
            <button type="button" className="od-sheet-close" aria-label="닫기" onClick={() => setDetail(null)}>×</button>
            <button
              type="button"
              className="od-detail-photo"
              disabled={!detail.photo}
              onClick={() => detail.photo && setZoomPhoto({ src: detail.photo, name: detail.name })}
              aria-label={detail.photo ? "사진 크게 보기" : "사진 준비중"}
            >
              {detail.photo ? <img src={detail.photo} alt={detail.name} /> : <span className="od-photo-empty"><img src={BUJA_MARK_DATA} alt="" />사진 준비중</span>}
              {detail.photo && <i aria-hidden="true">⤢ 크게 보기</i>}
            </button>
            <div className="od-detail-body">
              <ProductTags product={detail} promo={promo} />
              <h2>{detail.name}</h2>
              {detail.unit && <p className="od-detail-spec">규격 <b>{detail.unit}</b></p>}
              <ServingsBox product={detail} />
              {(detail.description ?? "").trim() && (
                <div className="od-detail-desc"><span>상품설명</span><p>{(detail.description ?? "").trim()}</p></div>
              )}
              {detail.soldout
                ? <div className="od-soldout-text">현재 품절된 상품입니다</div>
                : <OptionSteppers product={detail} quantityFor={quantityFor} onQuantity={changeFromCard} large />}
              <button type="button" className="od-sheet-done" onClick={() => setDetail(null)}>확인</button>
            </div>
          </section>
        </div>
      )}

      {cartOpen && (
        <div className="od-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setCartOpen(false); }}>
          <section className="od-sheet od-cart" aria-modal="true" role="dialog" aria-label="주문 내용 확인">
            <div className="od-cart-title">
              <div><p>보내기 전에 확인하세요</p><h2>장바구니</h2></div>
              <button type="button" aria-label="닫기" onClick={() => setCartOpen(false)}>×</button>
            </div>
            <div className="od-cart-lines">
              {cart.map((line) => {
                const product = productById.get(line.productId);
                return (
                  <div className="od-cart-line" key={line.key}>
                    <div className="od-cart-thumb">{product?.photo ? <img src={product.photo} alt="" loading="lazy" /> : <img src={BUJA_MARK_DATA} alt="" className="mark" />}</div>
                    <div className="od-cart-info">
                      <strong>{line.productName}</strong>
                      <span>{line.spec ? `${line.spec} / ` : ""}{line.optionLabel}</span>
                      <div className="od-cart-controls">
                        <div className="od-stepper active">
                          <button type="button" aria-label="수량 줄이기" onClick={() => changeCartLine(line, -1)}>−</button>
                          <b>{line.quantity}</b>
                          <button type="button" aria-label="수량 늘리기" onClick={() => changeCartLine(line, 1)}>＋</button>
                        </div>
                        <button type="button" className="od-remove" onClick={() => removeCartLine(line)}>빼기</button>
                      </div>
                    </div>
                  </div>
                );
              })}
              {!cart.length && <div className="od-empty">담긴 상품이 없습니다.<br />상품의 ＋ 버튼을 눌러 담아주세요.</div>}
            </div>
            {cart.length > 0 && <div className="od-cart-total"><span>총 {cart.length}품목</span><strong>{cartSummary(cart)}</strong></div>}
            <button type="button" className="od-send" onClick={composeSms} disabled={!cart.length}>📩 문자로 주문 보내기</button>
            <p className="od-send-help">누르면 문자 앱이 열리고 주문 내용이 자동으로 입력됩니다.<br />문자 앱에서 <b>보내기</b>를 눌러야 주문이 접수됩니다.</p>
            <div className="od-cart-alt">
              <button type="button" onClick={copyOrder} disabled={!cart.length}>{copied ? "✓ 복사됨" : "📋 주문내용 복사"}</button>
              {recipient && <a href={`tel:${recipient}`}>📞 전화로 주문</a>}
            </div>
            <button type="button" className="od-continue" onClick={() => setCartOpen(false)}>← 상품 더 담기</button>
          </section>
        </div>
      )}

      {askSent && !cartOpen && (
        <div className="od-backdrop center">
          <section className="od-sent" role="dialog" aria-modal="true" aria-label="주문 전송 확인">
            <h2>주문 문자를 보내셨나요?</h2>
            <p>보내셨다면 장바구니를 비워드릴게요.</p>
            <button type="button" className="od-send" onClick={() => answerSent(true)}>네, 보냈어요</button>
            <button type="button" className="od-continue" onClick={() => answerSent(false)}>아니요, 아직이요</button>
          </section>
        </div>
      )}

      {zoomPhoto && (
        <div className="od-zoom" role="dialog" aria-modal="true" aria-label={`${zoomPhoto.name} 사진`} onClick={() => setZoomPhoto(null)}>
          <img src={zoomPhoto.src} alt={zoomPhoto.name} />
          <p>{zoomPhoto.name}</p>
          <button type="button" aria-label="닫기">× 닫기</button>
        </div>
      )}
    </div>
  );
}

function cartSummary(cart: CartLine[]) {
  const totals = new Map<string, number>();
  for (const line of cart) totals.set(line.optionLabel, Number(((totals.get(line.optionLabel) ?? 0) + line.quantity).toFixed(3)));
  return Array.from(totals.entries()).map(([label, quantity]) => `${label} ${quantity}`).join(" · ");
}

/* ---------- 상품 카드 ---------- */

type CardProps = {
  promo: string;
  quantityFor: (productId: string, optionLabel: string) => number;
  onQuantity: (product: Product, option: PackOption, quantity: number) => void;
  onOpen: (product: Product) => void;
};

function ProductGrid({ products, empty, ...props }: CardProps & { products: Product[]; empty?: ReactNode }) {
  if (!products.length) return <div className="od-empty">{empty ?? "상품이 없습니다."}</div>;
  return (
    <div className="od-grid">
      {products.map((product) => <ProductCard key={product.id} product={product} {...props} />)}
    </div>
  );
}

function ProductCard({ product, promo, quantityFor, onQuantity, onOpen }: CardProps & { product: Product }) {
  const isPromo = !!promo && product.category === promo;
  const servings = servingsLines(product);
  const hasDescription = Boolean((product.description ?? "").trim());
  return (
    <article className={`od-card ${product.soldout ? "soldout" : ""}`}>
      <button type="button" className="od-card-photo" onClick={() => onOpen(product)} aria-label={`${product.name} 자세히 보기`}>
        {product.photo
          ? <img src={product.photo} alt="" loading="lazy" decoding="async" />
          : <span className="od-photo-empty"><img src={BUJA_MARK_DATA} alt="" />사진 준비중</span>}
        {isPromo && <em className="od-badge">행사</em>}
        {product.soldout && <b className="od-soldout-cover">품절</b>}
      </button>
      <div className="od-card-body">
        <div className="od-card-title-row">
          <button type="button" className="od-card-name" onClick={() => onOpen(product)}>{product.name}</button>
          {servings.length > 0 && (
            <ul className="od-card-servings od-card-servings-inline">{servings.map((line) => <li key={line}>{line}</li>)}</ul>
          )}
        </div>
        {hasDescription && <button type="button" className="od-card-more" onClick={() => onOpen(product)}>상품설명 보기 ›</button>}
        {product.soldout
          ? <div className="od-soldout-text">품절</div>
          : <OptionSteppers product={product} quantityFor={quantityFor} onQuantity={onQuantity} />}
      </div>
    </article>
  );
}

function ProductTags({ product, promo }: { product: Product; promo: string }) {
  const isPromo = !!promo && product.category === promo;
  return (
    <div className="od-tags">
      {isPromo && <span className="t-promo">행사</span>}
      {product.sub && <span className="t-sub">{product.sub}</span>}
    </div>
  );
}

function ServingsBox({ product }: { product: Product }) {
  const lines = servingsLines(product);
  if (!lines.length) return null;
  return (
    <ul className="od-servings" aria-label="인분 안내">
      {lines.map((line) => <li key={line}>{line}</li>)}
    </ul>
  );
}

function OptionSteppers({
  product,
  quantityFor,
  onQuantity,
  large = false,
}: {
  product: Product;
  quantityFor: (productId: string, optionLabel: string) => number;
  onQuantity: (product: Product, option: PackOption, quantity: number) => void;
  large?: boolean;
}) {
  return (
    <div className={`od-options ${large ? "large" : ""}`}>
      {productOptions(product).map((option) => {
        const label = option.label || product.unit;
        const quantity = quantityFor(product.id, label);
        const step = option.step || 1;
        return (
          <div className={`od-option ${quantity > 0 ? "active" : ""}`} key={label}>
            <span className={`od-option-label ${label.includes("박스") ? "unit-box" : label.includes("봉") ? "unit-bag" : "unit-other"}`}>
              <strong>{label}</strong>{optionSpec(product, option) && <small>({optionSpec(product, option)})</small>}
            </span>
            <div className={`od-stepper ${quantity > 0 ? "active" : ""}`}>
              <button type="button" aria-label={`${label} 수량 줄이기`} onClick={() => onQuantity(product, option, quantity - step)} disabled={quantity <= 0}>−</button>
              <b>{quantity}</b>
              <button type="button" aria-label={`${label} 수량 늘리기`} onClick={() => onQuantity(product, option, quantity + step)}>＋</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- 하단 탭 / 아이콘 ---------- */

function TabButton({ active, label, onClick, icon, badge }: { active: boolean; label: string; onClick: () => void; icon: ReactNode; badge?: number }) {
  return (
    <button type="button" className={active ? "active" : ""} onClick={onClick} aria-current={active ? "page" : undefined}>
      <span className="od-tab-icon">{icon}{badge ? <b>{badge}</b> : null}</span>
      <span>{label}</span>
    </button>
  );
}

function Svg({ children }: { children: ReactNode }) {
  return <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
}
function CartIcon() { return <Svg><circle cx="9" cy="20" r="1.5" /><circle cx="18" cy="20" r="1.5" /><path d="M2 3h3l2.6 12.2a2 2 0 0 0 2 1.6h8.2a2 2 0 0 0 2-1.5L22 7H6" /></Svg>; }
function SearchIcon() { return <Svg><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Svg>; }
function HomeIcon() { return <Svg><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /><path d="M10 21v-6h4v6" /></Svg>; }
function GridIcon() { return <Svg><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></Svg>; }
function TagIcon() { return <Svg><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z" /><circle cx="7.5" cy="7.5" r="1.5" /></Svg>; }
