import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
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

const CART_STORAGE_KEY = "buja-simple-cart-v1";
const SENT_STORAGE_KEY = "buja-simple-cart-sent-v1";

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

function isChoseongOnly(value: string) {
  return value.length > 0 && /^[ㄱ-ㅎ]+$/.test(value);
}

/* ---------- 상품 안내 문구 ---------- */

function smallPackWord(options: PackOption[]) {
  return options.map((option) => option.label.trim()).find((label) => label && !label.includes("박스")) ?? "";
}

function servingsLines(product: Product, options: PackOption[]) {
  const lines: string[] = [];
  const unitServings = (product.servingsPerUnit ?? "").trim();
  const boxContents = (product.boxContents ?? "").trim();
  const boxServings = (product.servingsPerBox ?? "").trim();
  const word = smallPackWord(options);

  if (unitServings) {
    const alreadyLabeled = /^1/.test(unitServings) || (word && unitServings.includes(word));
    lines.push(alreadyLabeled || !word ? unitServings : `1${word} ${unitServings}`);
  }
  if (boxContents || boxServings) {
    const contents = boxContents && (/^1\s*박스/.test(boxContents) ? boxContents : `1박스 ${boxContents}`);
    if (contents && boxServings) lines.push(`${contents} (${boxServings})`);
    else if (contents) lines.push(contents);
    else lines.push(/^1\s*박스/.test(boxServings) ? boxServings : `1박스 ${boxServings}`);
  }
  return lines;
}

/* ---------- 문자/복사 ---------- */

function buildOrderText(cart: CartLine[]) {
  const lines = cart.map((line) => `${line.productName}${line.spec ? ` ${line.spec}` : ""} / ${line.quantity}${line.optionLabel}`);
  return ["[부자유통 발주]", "", ...lines, "", `총 ${cart.length}품목`].join("\n");
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

/* ---------- 페이지 ---------- */

function SimpleOrderPage() {
  const store = Route.useLoaderData() as StoreData;
  const [category, setCategory] = useState("전체");
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [zoomPhoto, setZoomPhoto] = useState<{ src: string; name: string } | null>(null);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const [askSent, setAskSent] = useState(false);
  const [copied, setCopied] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const promo = store.promoCategory && store.promoCategory in store.categories ? store.promoCategory : "";
  const recipient = (store.sms || "").replace(/[^0-9+]/g, "");

  // 저장된 장바구니 불러오기 (현재 판매 중인 상품만, 이름/규격은 최신 정보로)
  useEffect(() => {
    const raw = readStorage(CART_STORAGE_KEY);
    if (raw) {
      try {
        const saved = JSON.parse(raw) as CartLine[];
        const byId = new Map(store.products.map((product) => [product.id, product]));
        const restored = (Array.isArray(saved) ? saved : []).flatMap((line) => {
          const product = byId.get(line?.productId);
          if (!product || product.soldout || !(Number(line.quantity) > 0)) return [];
          return [{ ...line, productName: product.name, spec: product.unit, quantity: Number(line.quantity) }];
        });
        setCart(restored);
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

  // 행사품목 카테고리를 "전체" 바로 다음 맨 앞에 배치
  const categories = useMemo(() => {
    const rest = Object.keys(store.categories).filter((name) => name !== promo);
    return promo ? ["전체", promo, ...rest] : ["전체", ...rest];
  }, [store.categories, promo]);

  const searchIndex = useMemo(() => new Map(store.products.map((product) => {
    const text = `${product.name} ${product.category} ${product.sub} ${product.unit}`;
    return [product.id, { text: normalize(text), choseong: toChoseong(product.name.replace(/\s+/g, "")) }];
  })), [store.products]);

  const filtered = useMemo(() => {
    const rawQuery = query.trim().replace(/\s+/g, "");
    const choseongQuery = isChoseongOnly(rawQuery);
    const needle = normalize(query);
    const list = store.products.filter((product) => {
      if (category !== "전체" && product.category !== category) return false;
      if (!needle) return true;
      const entry = searchIndex.get(product.id);
      if (!entry) return false;
      return choseongQuery ? entry.choseong.includes(rawQuery) : entry.text.includes(needle);
    });
    // 순서: (전체 보기일 때) 행사 상품 먼저 → 판매 중 → 품절은 맨 아래. 같은 그룹 안의 순서는 그대로.
    const rank = (product: Product) =>
      (product.soldout ? 2 : 0) + (category === "전체" && promo && product.category !== promo ? 1 : 0);
    return list
      .map((product, index) => ({ product, index }))
      .sort((a, b) => rank(a.product) - rank(b.product) || a.index - b.index)
      .map((item) => item.product);
  }, [store.products, category, query, promo, searchIndex]);

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

  function changeFromCard(product: Product, option: PackOption, quantity: number) {
    const before = quantityFor(product.id, option.label || product.unit);
    setQuantity(product, option, quantity);
    const label = option.label || product.unit;
    const shown = Math.max(0, Number(quantity.toFixed(3)));
    if (shown > before) {
      setToast({ id: Date.now(), text: `${product.name} ${shown}${label} 담았습니다` });
    } else if (shown === 0 && before > 0) {
      setToast({ id: Date.now(), text: `${product.name} ${label} 뺐습니다` });
    }
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
    if (sent) {
      setCart([]);
      setToast({ id: Date.now(), text: "주문해 주셔서 감사합니다. 장바구니를 비웠습니다." });
    }
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
        <ol className="simple-howto" aria-label="주문 방법">
          <li><b>1</b>＋로 담기</li>
          <li aria-hidden="true" className="arrow">›</li>
          <li><b>2</b>주문하기</li>
          <li aria-hidden="true" className="arrow">›</li>
          <li><b>3</b>문자 보내기</li>
        </ol>

        <div className="simple-filterbar">
          <div className="simple-search">
            <span aria-hidden="true">⌕</span>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="상품 이름으로 찾기 (예: ㄷㄱㅅ)" type="search" />
            {query && <button type="button" aria-label="검색어 지우기" onClick={() => setQuery("")}>×</button>}
          </div>

          <nav className="simple-categories" aria-label="상품 카테고리">
            {categories.map((name) => (
              <button
                key={name}
                type="button"
                className={`${category === name ? "selected" : ""} ${name === promo ? "promo" : ""}`}
                onClick={() => { setCategory(name); window.scrollTo({ top: 0, behavior: "smooth" }); }}
              >
                {name === promo ? `🔥 ${name}` : name}
              </button>
            ))}
          </nav>
        </div>

        <div className="simple-list-head">
          <strong>{query ? `'${query}' 검색 결과` : category === "전체" ? "전체 상품" : category}</strong>
          <span>{filtered.length}개</span>
        </div>

        <section className="simple-product-list">
          {filtered.map((product) => (
            <SimpleProductCard
              key={product.id}
              product={product}
              isPromo={!!promo && product.category === promo}
              quantityFor={quantityFor}
              onQuantity={changeFromCard}
              onZoom={(src) => setZoomPhoto({ src, name: product.name })}
            />
          ))}
          {!filtered.length && <div className="simple-empty">찾는 상품이 없습니다.<br />다른 이름으로 검색해 보세요.</div>}
        </section>
      </main>

      {toast && <div className="simple-toast" key={toast.id} role="status">{toast.text}</div>}

      <div className="simple-cart-dock">
        <div className="wrap simple-cart-dock-inner">
          {cart.length > 0 ? (
            <button type="button" className="simple-cart-summary" onClick={() => setCartOpen(true)}>
              <span className="simple-cart-count"><b key={cart.length} className="bump">{cart.length}</b>품목 담김</span>
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
            <div className="simple-cart-alt">
              <button type="button" onClick={copyOrder} disabled={!cart.length}>{copied ? "✓ 복사됨" : "📋 주문내용 복사"}</button>
              {recipient && <a href={`tel:${recipient}`}>📞 전화로 주문</a>}
            </div>
            <button type="button" className="simple-cart-continue" onClick={() => setCartOpen(false)}>← 상품 더 담기</button>
          </section>
        </div>
      )}

      {askSent && !cartOpen && (
        <div className="simple-cart-backdrop center">
          <section className="simple-sent-dialog" role="dialog" aria-modal="true" aria-label="주문 전송 확인">
            <h2>주문 문자를 보내셨나요?</h2>
            <p>보내셨다면 장바구니를 비워 드릴게요.<br />같은 주문이 두 번 가는 것을 막아줍니다.</p>
            <button type="button" className="simple-final-sms" onClick={() => answerSent(true)}>네, 보냈어요 (장바구니 비우기)</button>
            <button type="button" className="simple-cart-continue" onClick={() => answerSent(false)}>아니요, 아직이요</button>
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
  const options: PackOption[] = product.packOptions.length ? product.packOptions : [{ label: product.unit, price: product.price, step: 1 }];
  const description = (product.description ?? "").trim();
  const longDescription = description.length > 50 || description.includes("\n");
  const servings = servingsLines(product, options);

  return (
    <article className={`simple-product-card ${product.soldout ? "soldout" : ""}`}>
      <div className="simple-product-top">
        <button
          type="button"
          className={`simple-product-photo ${product.photo ? "" : "no-photo"}`}
          onClick={() => product.photo && onZoom(product.photo)}
          aria-label={product.photo ? `${product.name} 사진 크게 보기` : `${product.name} 사진 준비중`}
          disabled={!product.photo}
        >
          {product.photo ? (
            <img src={product.photo} alt="" loading="lazy" decoding="async" />
          ) : (
            <span className="simple-photo-empty"><img src={BUJA_MARK_DATA} alt="" />사진 준비중</span>
          )}
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
          {servings.length > 0 && (
            <ul className="simple-servings" aria-label="인분 안내">
              {servings.map((line) => <li key={line}>{line}</li>)}
            </ul>
          )}
          {product.soldout ? (
            <div className="simple-soldout-text">현재 품절된 상품입니다</div>
          ) : (
            <div className="simple-product-options">
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

      {description && (
        <div className="simple-product-detail">
          <div className={`simple-product-desc ${expanded || !longDescription ? "open" : ""}`}>
            <span className="simple-desc-label">상품설명</span>{description}
          </div>
          {longDescription && (
            <button type="button" className="simple-desc-toggle" onClick={() => setExpanded((v) => !v)}>
              {expanded ? "접기 ▲" : "설명 더보기 ▼"}
            </button>
          )}
        </div>
      )}
    </article>
  );
}
