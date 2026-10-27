import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { BUJA_LOGO_DATA, BUJA_MARK_DATA } from "../brand-assets";

export const Route = createFileRoute("/price-list")({
  beforeLoad: () => {
    throw redirect({ to: "/" });
  },
  head: () => ({
    meta: [
      { title: "부자유통 단가표" },
      { name: "description", content: "부자유통 거래처 전용 실시간 단가표입니다." },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: PriceListPage,
});

type Viewer =
  | { type: "customer"; name: string; customerName: string; priceGroup: "A" | "B" }
  | { type: "driver" | "admin"; name: string; priceGroup: null };

type PriceOption = { label: string; price: number | null; priceA?: number | null; priceB?: number | null };
type PriceProduct = {
  id: string;
  name: string;
  category: string;
  sub: string;
  unit: string;
  photo: string;
  soldout: boolean;
  description: string;
  servingsPerUnit: string;
  boxContents: string;
  servingsPerBox: string;
  storageMethod: string;
  priceDisplayMode: "fixed" | "market" | "inquiry";
  isPromo: boolean;
  packOptions: PriceOption[];
};
type PriceData = { viewer: Viewer; promoCategory: string; version: number; updatedLabel: string; products: PriceProduct[]; error?: string };

function won(value: number | null | undefined) {
  return value == null ? "가격문의" : `${new Intl.NumberFormat("ko-KR").format(Math.round(value))}원`;
}
function priceLabel(product: PriceProduct, option: PriceOption) {
  if (product.priceDisplayMode === "market") return "싯가";
  if (product.priceDisplayMode === "inquiry") return "가격문의";
  return won(option.price);
}

function servingsUnitLabel(product: PriceProduct) {
  const option = product.packOptions.find((row) => !row.label.includes("박스")) ?? product.packOptions[0];
  return option?.label ? `1${option.label} 기준` : "1단위 기준";
}

function PriceListPage() {
  const [data, setData] = useState<PriceData | null>(null);
  const [error, setError] = useState("");
  const [checked, setChecked] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("전체");
  const [compact, setCompact] = useState(false);
  const [copied, setCopied] = useState(false);

  async function load() {
    try {
      const response = await fetch("/api/price-list", { cache: "no-store" });
      const json = await response.json() as PriceData & { error?: string };
      if (response.status === 401) {
        setData(null);
        setAuthRequired(true);
        setError("");
        setChecked(true);
        return;
      }
      if (!response.ok) throw new Error(json.error || "단가표를 불러오지 못했습니다.");
      setData(json);
      setAuthRequired(false);
      setError("");
      setChecked(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "단가표를 불러오지 못했습니다.");
      setChecked(true);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (authRequired) return;
    const timer = window.setInterval(() => void load(), 10000);
    return () => window.clearInterval(timer);
  }, [authRequired]);

  const categories = useMemo(() => {
    if (!data) return [] as string[];
    return Array.from(new Set(data.products.map((product) => product.category)));
  }, [data]);

  const visible = useMemo(() => {
    if (!data) return [] as PriceProduct[];
    const needle = query.trim().toLowerCase().replace(/\s+/g, "");
    return data.products.filter((product) => {
      if (category !== "전체" && product.category !== category) return false;
      if (!needle) return true;
      return `${product.name}${product.category}${product.sub}${product.unit}${product.description}`
        .toLowerCase().replace(/\s+/g, "").includes(needle);
    });
  }, [data, query, category]);

  async function logout() {
    await fetch("/api/customer/logout", { method: "POST" });
    setData(null);
    setAuthRequired(true);
    setChecked(true);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt("아래 주소를 복사해 주세요.", window.location.href);
    }
  }

  const internal = data?.viewer.type === "admin" || data?.viewer.type === "driver";

  if (!checked) return <PriceListLogin checking onLogin={load} />;
  if (authRequired) return <PriceListLogin onLogin={load} />;

  return <div className="price-list-page">
    <header className="price-list-header">
      <div className="price-list-header-inner">
        <a href="/" className="price-list-logo"><img src={BUJA_LOGO_DATA} alt="부자유통" /></a>
        <div className="price-list-header-actions">
          <button type="button" onClick={copyLink}>{copied ? "링크 복사됨" : "공유 링크 복사"}</button>
          {data?.viewer.type === "customer" && <button type="button" onClick={() => void logout()}>로그아웃</button>}
          <button type="button" onClick={() => history.back()}>돌아가기</button>
        </div>
      </div>
    </header>

    <main className="price-list-main">
      <section className="price-list-hero">
        <div>
          <p>BUJA FOOD PRODUCT CATALOG</p>
          <h1>부자유통 단가표</h1>
          <span>상품사진 · 규격 · 판매단위 · 단가 · 인분 · 박스구성을 한눈에 확인할 수 있습니다.</span>
        </div>
        <div className="price-live-box">
          <b>● 실시간 연동</b>
          <span>관리자 상품정보를 수정하면 단가표도 함께 변경됩니다.</span>
          {data && <small>상품 {data.products.length}개 · 데이터 버전 {data.version}</small>}
        </div>
      </section>

      {data?.viewer.type === "customer" && <p className="price-list-notice customer">현재 <b>{data.viewer.customerName}</b>에 적용되는 {data.viewer.priceGroup}그룹 단가를 표시합니다.</p>}
      {internal && <p className="price-list-notice internal"><b>{data?.viewer.name}</b> 직원 화면입니다. 고정가격 상품은 기본가와 A/B 그룹 가격을 함께 확인할 수 있습니다.</p>}
      {error && <p className="price-list-error">{error}</p>}

      <section className="price-list-tools">
        <label className="price-search"><span>⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="품목명 · 카테고리 · 규격 검색" /></label>
        <div className="price-view-toggle">
          <button type="button" className={!compact ? "selected" : ""} onClick={() => setCompact(false)}>사진형</button>
          <button type="button" className={compact ? "selected" : ""} onClick={() => setCompact(true)}>간단표</button>
        </div>
      </section>

      <nav className="price-category-nav">
        {["전체", ...categories].map((name) => <button type="button" key={name} className={category === name ? "selected" : ""} onClick={() => setCategory(name)}>{name}{data?.promoCategory === name ? " 🚨" : ""}</button>)}
      </nav>

      {!data ? <div className="price-list-loading">단가표를 불러오는 중입니다.</div> : compact ? (
        <>
          <section className="price-table-wrap price-table-desktop">
            <table className="price-table">
              <thead><tr><th>품목</th><th>규격</th><th>판매단위 / 가격</th><th>구성·인분</th><th>보관</th></tr></thead>
              <tbody>
                {visible.map((product) => <tr key={product.id} className={product.soldout ? "soldout" : ""}>
                  <td><b>{product.name}</b><span>{product.category}{product.sub ? ` · ${product.sub}` : ""}{product.isPromo ? " · 🚨행사" : ""}</span></td>
                  <td>{product.unit || "-"}</td>
                  <td>{product.packOptions.map((option) => <div className="price-table-option" key={option.label}><span>{option.label}</span><b>{priceLabel(product, option)}</b>{internal && product.priceDisplayMode === "fixed" && <small>A {won(option.priceA ?? option.price)} · B {won(option.priceB ?? option.price)}</small>}</div>)}</td>
                  <td className="price-table-facts">
                    {product.servingsPerUnit && <span><b>{servingsUnitLabel(product)}</b>{product.servingsPerUnit}</span>}
                    {product.boxContents && <span><b>1박스 입수</b>{product.boxContents}</span>}
                    {product.servingsPerBox && <span><b>1박스 기준</b>{product.servingsPerBox}</span>}
                    {!product.servingsPerUnit && !product.boxContents && !product.servingsPerBox ? "-" : ""}
                  </td>
                  <td>{product.storageMethod || "-"}</td>
                </tr>)}
              </tbody>
            </table>
          </section>

          <section className="price-mobile-list" aria-label="모바일 간단 단가표">
            {visible.map((product) => <article className={`price-mobile-item ${product.soldout ? "soldout" : ""}`} key={product.id}>
              <div className="price-mobile-item-head">
                <div>
                  <p>{product.category}{product.sub ? ` · ${product.sub}` : ""}{product.isPromo ? " · 🚨행사" : ""}</p>
                  <h2>{product.name}</h2>
                </div>
                <span>{product.unit || "규격 문의"}</span>
              </div>
              <div className="price-mobile-options">
                {product.packOptions.map((option) => <div key={option.label}>
                  <span>{option.label}</span>
                  <strong>{priceLabel(product, option)}</strong>
                  {internal && product.priceDisplayMode === "fixed" && <small>A {won(option.priceA ?? option.price)} · B {won(option.priceB ?? option.price)}</small>}
                </div>)}
              </div>
              {(product.servingsPerUnit || product.boxContents || product.servingsPerBox || product.storageMethod) && <div className="price-mobile-facts">
                {product.servingsPerUnit && <span><b>{servingsUnitLabel(product)}</b>{product.servingsPerUnit}</span>}
                {product.boxContents && <span><b>1박스 입수</b>{product.boxContents}</span>}
                {product.servingsPerBox && <span><b>1박스 기준</b>{product.servingsPerBox}</span>}
                {product.storageMethod && <span><b>보관</b>{product.storageMethod}</span>}
              </div>}
            </article>)}
          </section>
        </>
      ) : (
        <section className="price-card-grid">
          {visible.map((product) => <article className={`price-card ${product.soldout ? "soldout" : ""}`} key={product.id}>
            <div className="price-card-image">
              {product.photo ? <img src={product.photo} alt={product.name} /> : <img className="placeholder" src={BUJA_MARK_DATA} alt="" />}
              {product.isPromo && <span className="price-promo-badge">🚨 행사</span>}
              {product.soldout && <span className="price-soldout-badge">품절</span>}
              {product.priceDisplayMode === "market" && <span className="price-market-badge">싯가</span>}
            </div>
            <div className="price-card-body">
              <div className="price-card-title"><div><p>{product.category}{product.sub ? ` · ${product.sub}` : ""}</p><h2>{product.name}</h2></div>{product.storageMethod && <span>{product.storageMethod}</span>}</div>
              <div className="price-spec"><span>규격</span><b>{product.unit || "미지정"}</b></div>
              <div className="price-option-list">
                {product.packOptions.map((option) => <div key={option.label} className="price-option-row">
                  <span>{option.label}</span>
                  <strong>{priceLabel(product, option)}</strong>
                  {internal && product.priceDisplayMode === "fixed" && <small>기본 {won(option.price)} · A {won(option.priceA ?? option.price)} · B {won(option.priceB ?? option.price)}</small>}
                </div>)}
              </div>
              {(product.servingsPerUnit || product.boxContents || product.servingsPerBox) && <dl className="price-info-list">
                {product.servingsPerUnit && <div><dt>{servingsUnitLabel(product)}</dt><dd>{product.servingsPerUnit}</dd></div>}
                {product.boxContents && <div><dt>1박스 입수</dt><dd>{product.boxContents}</dd></div>}
                {product.servingsPerBox && <div><dt>1박스 기준</dt><dd>{product.servingsPerBox}</dd></div>}
              </dl>}
              {product.description && <p className="price-description">{product.description}</p>}
            </div>
          </article>)}
        </section>
      )}

      {data && visible.length === 0 && <div className="price-list-empty">조건에 맞는 상품이 없습니다.</div>}
      <footer className="price-list-footer"><b>부자유통</b><span>관리자 상품관리와 연결된 실시간 상품·단가표</span></footer>
    </main>
  </div>;
}


function PriceListLogin({ onLogin, checking = false }: { onLogin: () => Promise<void>; checking?: boolean }) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (checking || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/customer/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, password }),
      });
      const json = await response.json() as { error?: string };
      if (!response.ok) throw new Error(json.error || "아이디 또는 비밀번호를 확인해 주세요.");
      await onLogin();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "로그인에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="price-login-page">
    <main className="price-login-shell">
      <section className="price-login-card">
        <img src={BUJA_LOGO_DATA} alt="부자유통" />
        <p>RESTAURANT PARTNER ONLY</p>
        <h1>거래처 전용 단가표</h1>
        <span>부자유통에서 전달받은 아이디와 비밀번호로 로그인해 주세요.</span>
        {checking ? <div className="price-login-checking">로그인 상태를 확인하는 중입니다.</div> : <form onSubmit={submit}>
          <label>아이디<input value={identifier} onChange={(event) => setIdentifier(event.target.value)} autoComplete="username" autoCapitalize="none" /></label>
          <label>비밀번호<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" /></label>
          {error && <p className="price-login-error">{error}</p>}
          <button type="submit" disabled={busy || !identifier.trim() || password.trim().length < 2}>{busy ? "확인 중..." : "로그인"}</button>
        </form>}
        <div className="price-login-help">
          <b>한 번 로그인하면 계속 로그인됩니다.</b>
          <span>같은 휴대폰에서는 로그인 상태를 최대 5년 유지합니다. 브라우저 데이터 삭제나 로그아웃을 하면 다시 로그인해야 합니다.</span>
          <span>홈 화면에 추가하면 앱처럼 사용할 수 있고, 새 버전은 다시 설치할 필요 없이 서버에서 자동 반영됩니다.</span>
        </div>
      </section>
    </main>
  </div>;
}
