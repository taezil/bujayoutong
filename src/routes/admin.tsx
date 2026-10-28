import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { PackOption, Product, StoreData } from "../lib/db.server";
import { BUJA_LOGO_DATA, BUJA_MARK_DATA } from "../brand-assets";
import { thumbUrl } from "../lib/photo-url";
import { createThumbnailForUpload, generateMissingThumbnails, type ThumbnailProgress } from "../lib/photo-thumbs";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [{ title: "부자유통 관리자" }, { name: "robots", content: "noindex,nofollow" }],
    links: [{ rel: "canonical", href: "https://order.bujafood.kr/admin" }],
  }),
  component: AdminPage,
});

type AdminStatus = { setupRequired: boolean; authenticated: boolean };

async function jsonPost(path: string, body: unknown) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json() as { error?: string; [key: string]: unknown };
  if (!response.ok) throw new Error(data.error || "요청을 처리하지 못했습니다.");
  return data;
}

function kstDateLocal(offsetDays = 0) {
  const date = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function orderPeriod(value: string) {
  const parsed = new Date(value.replace(" ", "T") + "Z");
  if (!Number.isFinite(parsed.getTime())) return "";
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", hourCycle: "h23" }).format(parsed));
  return hour < 12 ? "오전발주" : "오후발주";
}

type AdminView = "products" | "categories" | "settings";
type StatusFilter = "all" | "selling" | "soldout" | "hidden" | "promo";
const PAGE_SIZE = 20;

function productStatus(product: Product): "selling" | "soldout" | "hidden" {
  if (product.hidden) return "hidden";
  if (product.soldout) return "soldout";
  return "selling";
}

function wonText(value: number | null | undefined) {
  return value == null ? "" : `${new Intl.NumberFormat("ko-KR").format(value)}원`;
}

async function uploadPhoto(file: File) {
  const form = new FormData();
  form.append("file", file);
  const upload = await fetch("/api/photo", { method: "POST", body: form });
  const data = await upload.json() as { url?: string; error?: string };
  if (!upload.ok || !data.url) throw new Error(data.error || "사진 업로드에 실패했습니다.");
  // 목록용 작은 사진도 함께 저장 (실패해도 원본 업로드는 정상)
  await createThumbnailForUpload(data.url, file);
  return data.url;
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.round(bytes / 1024)}KB`;
}

/** 상품 목록용 썸네일 일괄 생성 (관리자 브라우저에서 처리, 원본은 그대로 유지) */
function ThumbnailTool({ store }: { store: StoreData }) {
  const [progress, setProgress] = useState<ThumbnailProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  async function run() {
    setRunning(true);
    setMessage("");
    try {
      const urls = [
        ...store.products.map((product) => product.photo),
        ...Object.values(store.categoryImages ?? {}),
      ].filter(Boolean);
      const result = await generateMissingThumbnails(urls, setProgress);
      setMessage(result.total === 0
        ? "모든 사진에 썸네일이 이미 있습니다."
        : `완료: ${result.done - result.failed}개 생성${result.failed ? `, 실패 ${result.failed}개` : ""} · 원본 ${formatBytes(result.originalBytes)} → 썸네일 ${formatBytes(result.thumbBytes)}`);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "썸네일 생성에 실패했습니다.");
    } finally {
      setRunning(false);
    }
  }
  return (
    <div className="adm-thumb-tool">
      <button type="button" disabled={running} onClick={() => void run()}>
        {running ? `썸네일 만드는 중 ${progress?.done ?? 0}/${progress?.total ?? 0}` : "목록용 썸네일 만들기"}
      </button>
      <span>{message || "상품 목록에서 작은 사진을 써서 휴대폰 로딩을 빠르게 합니다. 없는 것만 새로 만듭니다."}</span>
    </div>
  );
}

function AdminPage() {
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [store, setStore] = useState<StoreData | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [view, setView] = useState<AdminView>("products");

  const loadStore = useCallback(async () => {
    // all=1: 관리자 인증 시 숨김 상품까지 포함
    const response = await fetch("/api/store?all=1", { cache: "no-store" });
    if (!response.ok) throw new Error("상품 데이터를 불러오지 못했습니다.");
    setStore(await response.json() as StoreData);
  }, []);

  const loadStatus = useCallback(async () => {
    const response = await fetch("/api/admin/status", { cache: "no-store" });
    const next = await response.json() as AdminStatus;
    setStatus(next);
    if (next.authenticated) await loadStore();
  }, [loadStore]);

  useEffect(() => {
    void loadStatus().catch((reason) => setError(reason instanceof Error ? reason.message : "관리자 화면을 불러오지 못했습니다."));
  }, [loadStatus]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 2200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function login(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await jsonPost("/api/admin/login", { username, password });
      setPassword("");
      await loadStatus();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "로그인에 실패했습니다.");
    }
  }

  async function logout() {
    await jsonPost("/api/admin/logout", {});
    setStore(null);
    setStatus({ setupRequired: false, authenticated: false });
  }

  if (!status) return <AdminShell><p className="admin-loading">관리자 정보를 확인하는 중입니다.</p></AdminShell>;

  if (!status.authenticated) return (
    <AdminShell><div className="admin-auth-card">
      <h1>품목 관리자 로그인</h1>
      <p>관리자 계정으로 로그인해 주세요.</p>
      <form onSubmit={login}>
        <label>아이디
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
        </label>
        <label>비밀번호
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </label>
        <button type="submit" disabled={!username.trim() || !password}>로그인</button>
      </form>
      {error && <p className="form-error">{error}</p>}
    </div></AdminShell>
  );

  if (!store) return <AdminShell><p className="admin-loading">상품을 불러오는 중입니다.</p></AdminShell>;

  const staffName = "admin";
  const menu: Array<{ id: AdminView; label: string; icon: string }> = [
    { id: "products", label: "상품 관리", icon: "📦" },
    { id: "categories", label: "카테고리 관리", icon: "🗂" },
    { id: "settings", label: "설정", icon: "⚙" },
  ];

  return (
    <div className="adm-layout">
      <aside className="adm-side">
        <div className="adm-side-brand"><img src={BUJA_LOGO_DATA} alt="부자유통" /><span>관리자</span></div>
        <nav>
          {menu.map((item) => (
            <button type="button" key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}>
              <i aria-hidden="true">{item.icon}</i>{item.label}
            </button>
          ))}
        </nav>
        <div className="adm-side-foot">
          <span>{staffName}</span>
          <a href="/admin/accounts" title="거래처 계정 · 가격 그룹(A/B) · 직원 PIN">거래처 계정 관리</a>
          <small className="adm-side-hint">가격 그룹(A/B) · 직원 PIN도 여기서</small>
          <button type="button" onClick={logout}>로그아웃</button>
        </div>
      </aside>
      <main className="adm-main">
        {error && <p className="adm-alert" role="alert">{error}<button type="button" onClick={() => setError("")} aria-label="닫기">×</button></p>}
        {notice && <p className="adm-notice" role="status">{notice}</p>}
        {view === "products" && (
          <ProductsView
            store={store}
            onEdit={(product) => setEditing(product)}
            onCreate={() => setEditing("new")}
            onReload={loadStore}
            onError={setError}
            onNotice={setNotice}
          />
        )}
        {view === "categories" && <CategoryView store={store} onSaved={loadStore} onError={setError} onNotice={setNotice} />}
        {view === "settings" && <SimpleSettingsView store={store} onSaved={loadStore} onError={setError} onNotice={setNotice} />}
      </main>
      {editing && (
        <ProductEditor
          product={editing === "new" ? makeNewProduct(store) : editing}
          creating={editing === "new"}
          categories={store.categories}
          onClose={() => setEditing(null)}
          onSaved={async (message) => { setEditing(null); await loadStore(); setNotice(message); }}
          onError={setError}
        />
      )}
    </div>
  );
}

function normalizeAdminQuery(value: string) {
  return value.toLocaleLowerCase("ko-KR").replace(/\s+/g, "");
}

function AdminShell({ children }: { children: ReactNode }) {
  return (
    <div className="admin-page">
      <header className="admin-brandbar"><a href="/" aria-label="부자유통 홈"><img src={BUJA_LOGO_DATA} alt="부자유통" /></a></header>
      <main className="admin-wrap">{children}</main>
    </div>
  );
}

function ProductsView({
  store,
  onEdit,
  onCreate,
  onReload,
  onError,
  onNotice,
}: {
  store: StoreData;
  onEdit: (product: Product) => void;
  onCreate: () => void;
  onReload: () => Promise<void>;
  onError: (value: string) => void;
  onNotice: (value: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("전체");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState("");

  const needle = normalizeAdminQuery(query);
  const filtered = store.products.filter((p) => {
    if (category !== "전체" && p.category !== category) return false;
    if (statusFilter === "promo" && p.category !== store.promoCategory) return false;
    if (statusFilter === "selling" && productStatus(p) !== "selling") return false;
    if (statusFilter === "soldout" && productStatus(p) !== "soldout") return false;
    if (statusFilter === "hidden" && productStatus(p) !== "hidden") return false;
    return !needle || (normalizeAdminQuery(p.name).includes(needle) || normalizeAdminQuery(p.id).includes(needle));
  });
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const rows = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  useEffect(() => { setPage(1); }, [query, category, statusFilter]);

  const counts = {
    all: store.products.length,
    selling: store.products.filter((p) => productStatus(p) === "selling").length,
    soldout: store.products.filter((p) => productStatus(p) === "soldout").length,
    hidden: store.products.filter((p) => productStatus(p) === "hidden").length,
  };

  async function quickStatus(product: Product, next: "selling" | "soldout" | "hidden") {
    setBusyId(product.id);
    onError("");
    try {
      await jsonPost("/api/admin/products", {
        action: "update",
        product: { ...product, soldout: next === "soldout", hidden: next === "hidden" },
      });
      await onReload();
      onNotice(`‘${product.name}’ ${next === "selling" ? "판매중" : next === "soldout" ? "품절" : "숨김"}으로 변경했습니다.`);
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "상태 변경에 실패했습니다.");
    } finally {
      setBusyId("");
    }
  }

  async function remove(product: Product) {
    if (!window.confirm(`‘${product.name}’ 상품을 삭제할까요?\n삭제하면 되돌릴 수 없습니다. 잠시 내릴 때는 '숨김'을 사용하세요.`)) return;
    setBusyId(product.id);
    onError("");
    try {
      await jsonPost("/api/admin/products", { action: "delete", id: product.id });
      await onReload();
      onNotice(`‘${product.name}’ 상품을 삭제했습니다.`);
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "상품 삭제에 실패했습니다.");
    } finally {
      setBusyId("");
    }
  }

  return (
    <section className="adm-panel">
      <div className="adm-head">
        <div><h1>상품 관리</h1><p>전체 {counts.all}개 · 판매중 {counts.selling} · 품절 {counts.soldout} · 숨김 {counts.hidden}</p></div>
        <button type="button" className="adm-primary" onClick={onCreate}>＋ 상품 추가</button>
      </div>
      <ThumbnailTool store={store} />
      <div className="adm-toolbar">
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="상품명, 코드 검색" />
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="카테고리">
          <option value="전체">전체 카테고리</option>
          {Object.keys(store.categories).map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} aria-label="상태">
          <option value="all">전체 상태</option>
          <option value="selling">판매중</option>
          <option value="soldout">품절</option>
          <option value="hidden">숨김</option>
          <option value="promo">행사</option>
        </select>
      </div>

      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead>
            <tr><th>사진</th><th>상품명</th><th>규격</th><th>단위</th><th>카테고리</th><th>가격</th><th>상태</th><th>관리</th></tr>
          </thead>
          <tbody>
            {rows.map((product) => {
              const state = productStatus(product);
              const isPromo = product.category === store.promoCategory;
              const minPrice = product.packOptions.map((o) => o.price).filter((v): v is number => v !== null);
              return (
                <tr key={product.id} className={state !== "selling" ? `is-${state}` : ""}>
                  <td className="c-photo"><div className="adm-thumb">{product.photo ? <img src={thumbUrl(product.photo)} alt="" loading="lazy" /> : <img src={BUJA_MARK_DATA} alt="" className="mark" />}</div></td>
                  <td className="c-name">
                    <button type="button" onClick={() => onEdit(product)}>{product.name}</button>
                    <small>{product.sub || "-"}{(product.servingsPerUnit || product.servingsPerBox) ? " · 인분정보 ✓" : ""}</small>
                  </td>
                  <td className="c-spec">{product.unit || "-"}</td>
                  <td className="c-unit">{product.packOptions.map((o) => o.label).join(" / ") || "-"}</td>
                  <td className="c-cat">{product.category}</td>
                  <td className="c-price">
                    {product.promoPrice != null
                      ? <><s>{minPrice.length ? wonText(Math.min(...minPrice)) : ""}</s><b className="promo">{wonText(product.promoPrice)}</b></>
                      : minPrice.length ? wonText(Math.min(...minPrice)) : <span className="muted">-</span>}
                    {product.packOptions.some((o) => o.priceB != null) && <small className="adm-price-b-badge">B {product.packOptions.filter((o) => o.priceB != null).map((o) => wonText(o.priceB as number)).join(" / ")}</small>}
                  </td>
                  <td className="c-state">
                    <select
                      className={`adm-state s-${isPromo && state === "selling" ? "promo" : state}`}
                      value={state}
                      disabled={busyId === product.id}
                      onChange={(e) => void quickStatus(product, e.target.value as "selling" | "soldout" | "hidden")}
                      aria-label={`${product.name} 상태`}
                    >
                      <option value="selling">{isPromo ? "행사·판매중" : "판매중"}</option>
                      <option value="soldout">품절</option>
                      <option value="hidden">숨김</option>
                    </select>
                  </td>
                  <td className="c-actions">
                    <button type="button" className="adm-btn-edit" onClick={() => onEdit(product)}>수정</button>
                    <button type="button" className="adm-btn-del" disabled={busyId === product.id} onClick={() => void remove(product)}>삭제</button>
                  </td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={8} className="adm-empty">조건에 맞는 상품이 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <nav className="adm-pager" aria-label="페이지">
          <button type="button" disabled={current <= 1} onClick={() => setPage(current - 1)}>‹</button>
          {pageNumbers(current, pages).map((n, i) => n === 0
            ? <span key={`gap-${i}`}>…</span>
            : <button type="button" key={n} className={n === current ? "active" : ""} onClick={() => setPage(n)}>{n}</button>)}
          <button type="button" disabled={current >= pages} onClick={() => setPage(current + 1)}>›</button>
        </nav>
      )}
    </section>
  );
}

function pageNumbers(current: number, pages: number) {
  const set = new Set([1, pages, current - 1, current, current + 1]);
  const list = Array.from(set).filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const out: number[] = [];
  list.forEach((n, i) => {
    if (i > 0 && n - list[i - 1]! > 1) out.push(0);
    out.push(n);
  });
  return out;
}

function CategoryView({ store, onSaved, onError, onNotice }: { store: StoreData; onSaved: () => Promise<void>; onError: (value: string) => void; onNotice: (value: string) => void }) {
  const [newCategory, setNewCategory] = useState("");
  const [busy, setBusy] = useState("");

  async function action(body: Record<string, string>, message: string) {
    setBusy(body.category ?? body.name ?? "x");
    try {
      onError("");
      await jsonPost("/api/admin/categories", body);
      await onSaved();
      onNotice(message);
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "카테고리 작업에 실패했습니다.");
    } finally {
      setBusy("");
    }
  }

  async function changeImage(category: string, file: File | null) {
    if (!file) return;
    setBusy(category);
    try {
      onError("");
      const url = await uploadPhoto(file);
      await jsonPost("/api/admin/categories", { action: "set-image", category, image: url });
      await onSaved();
      onNotice(`‘${category}’ 사진을 바꿨습니다.`);
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "사진 변경에 실패했습니다.");
    } finally {
      setBusy("");
    }
  }

  const names = Object.keys(store.categories);
  const productCount = (name: string) => store.products.filter((p) => p.category === name).length;

  return (
    <section className="adm-panel">
      <div className="adm-head">
        <div><h1>카테고리 관리</h1><p>순서·사진은 거래처 주문화면 첫 화면의 카테고리 칸에 그대로 반영됩니다. 사진이 없으면 그 카테고리 첫 상품 사진을 씁니다.</p></div>
        <div className="adm-inline-add">
          <input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="새 카테고리 이름" />
          <button type="button" className="adm-primary" disabled={!newCategory.trim()} onClick={async () => {
            const name = newCategory.trim();
            await action({ action: "add-category", name }, `‘${name}’ 카테고리를 추가했습니다.`);
            setNewCategory("");
          }}>추가</button>
        </div>
      </div>
      <div className="adm-cat-list">
        {names.map((category, index) => {
          const image = store.categoryImages?.[category] ?? "";
          const isPromo = category === store.promoCategory;
          return (
            <article className={`adm-cat ${busy === category ? "busy" : ""}`} key={category}>
              <div className="adm-cat-top">
                <label className="adm-cat-photo" title="사진 바꾸기">
                  {image ? <img src={image} alt="" /> : <span>{isPromo ? "%" : "사진\n없음"}</span>}
                  <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => { void changeImage(category, e.target.files?.[0] ?? null); e.target.value = ""; }} />
                  <em>변경</em>
                </label>
                <div className="adm-cat-title">
                  <strong>{category}{isPromo && <b className="adm-chip-promo">행사</b>}</strong>
                  <small>상품 {productCount(category)}개 · 세부 {store.categories[category]?.length ?? 0}개</small>
                  <div className="adm-cat-actions">
                    <button type="button" disabled={index === 0} onClick={() => void action({ action: "move-category", category, direction: "up" }, "순서를 바꿨습니다.")}>▲</button>
                    <button type="button" disabled={index === names.length - 1} onClick={() => void action({ action: "move-category", category, direction: "down" }, "순서를 바꿨습니다.")}>▼</button>
                    <button type="button" onClick={() => {
                      const name = window.prompt("새 카테고리명", category);
                      if (name && name.trim() && name.trim() !== category) void action({ action: "rename-category", category, name: name.trim() }, "이름을 바꿨습니다.");
                    }}>이름변경</button>
                    {image && <button type="button" onClick={() => void action({ action: "set-image", category, image: "" }, "사진을 지웠습니다.")}>사진삭제</button>}
                    <button type="button" className="danger" onClick={() => {
                      if (window.confirm(`‘${category}’ 카테고리를 삭제할까요? 상품이 들어 있으면 삭제되지 않습니다.`)) void action({ action: "delete-category", category }, "카테고리를 삭제했습니다.");
                    }}>삭제</button>
                  </div>
                </div>
              </div>
              <ul className="adm-subs">
                {(store.categories[category] ?? []).map((sub) => (
                  <li key={sub}>
                    <span>{sub}</span>
                    <button type="button" onClick={() => {
                      const name = window.prompt("새 세부 카테고리명", sub);
                      if (name && name.trim() && name.trim() !== sub) void action({ action: "rename-sub", category, sub, name: name.trim() }, "세부 카테고리를 수정했습니다.");
                    }}>수정</button>
                    <button type="button" onClick={() => {
                      if (window.confirm(`‘${sub}’ 세부 카테고리를 삭제할까요?`)) void action({ action: "delete-sub", category, sub }, "세부 카테고리를 삭제했습니다.");
                    }}>삭제</button>
                  </li>
                ))}
                <li className="add">
                  <button type="button" onClick={() => {
                    const name = window.prompt(`‘${category}’에 추가할 세부 카테고리명`);
                    if (name && name.trim()) void action({ action: "add-sub", category, name: name.trim() }, "세부 카테고리를 추가했습니다.");
                  }}>＋ 세부 카테고리 추가</button>
                </li>
              </ul>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function SimpleSettingsView({ store, onSaved, onError, onNotice }: { store: StoreData; onSaved: () => Promise<void>; onError: (value: string) => void; onNotice: (value: string) => void }) {
  const [sms, setSms] = useState(store.sms);
  const [promoCategory, setPromoCategory] = useState(store.promoCategory);
  const [heroImage, setHeroImage] = useState(store.heroImage);
  const [heroKicker, setHeroKicker] = useState(store.heroKicker);
  const [heroTitle, setHeroTitle] = useState(store.heroTitle);
  const [heroDescription, setHeroDescription] = useState(store.heroDescription);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    setSms(store.sms);
    setPromoCategory(store.promoCategory);
    setHeroImage(store.heroImage);
    setHeroKicker(store.heroKicker);
    setHeroTitle(store.heroTitle);
    setHeroDescription(store.heroDescription);
  }, [store.sms, store.promoCategory, store.heroImage, store.heroKicker, store.heroTitle, store.heroDescription]);

  async function changeHeroImage(file: File | null) {
    if (!file) return;
    setUploading(true);
    try {
      onError("");
      const url = await uploadPhoto(file);
      setHeroImage(url);
      onNotice("배너 이미지를 불러왔습니다. 아래 저장 버튼을 눌러 적용하세요.");
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "배너 사진 업로드에 실패했습니다.");
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    setBusy(true);
    try {
      onError("");
      await jsonPost("/api/admin/settings", {
        sms,
        promoCategory,
        heroImage,
        heroKicker,
        heroTitle,
        heroDescription,
        orderEnabled: store.orderSettings.enabled,
        order24h: store.orderSettings.open24h,
        orderOpenTime: store.orderSettings.openTime,
        orderCloseTime: store.orderSettings.closeTime,
        editMinutes: store.orderSettings.editMinutes,
        cancelMinutes: store.orderSettings.cancelMinutes,
      });
      await onSaved();
      onNotice("설정을 저장했습니다.");
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "설정 저장에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="adm-panel">
      <div className="adm-head"><div><h1>설정</h1><p>거래처 주문화면의 기본 설정과 메인 배너를 관리합니다.</p></div></div>

      <div className="adm-form-card adm-banner-settings">
        <h3>메인 배너</h3>
        <p className="adm-help">주문화면 첫 화면의 큰 홍보 영역입니다. 행사·신상품·공지 등에 사용할 수 있습니다.</p>
        <div className="adm-banner-preview">
          {heroImage ? <img src={heroImage} alt="" /> : <span>배너 이미지를 지정하지 않으면 행사상품 사진을 자동으로 사용합니다.</span>}
        </div>
        <div className="adm-banner-actions">
          <label className="adm-upload">
            {uploading ? "업로드 중…" : "＋ 배너 사진 변경"}
            <input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={(e) => { void changeHeroImage(e.target.files?.[0] ?? null); e.target.value = ""; }} />
          </label>
          {heroImage && <button type="button" className="adm-ghost" onClick={() => setHeroImage("")}>자동 이미지 사용</button>}
        </div>
        <label>상단 작은 문구
          <input value={heroKicker} onChange={(e) => setHeroKicker(e.target.value)} placeholder="예: 프리미엄 식자재몰" />
        </label>
        <label>큰 제목
          <textarea rows={2} value={heroTitle} onChange={(e) => setHeroTitle(e.target.value)} placeholder={"예: 좋은 식재료가\n사장님의 경쟁력입니다."} />
          <small>줄바꿈도 그대로 반영됩니다.</small>
        </label>
        <label>설명
          <textarea rows={2} value={heroDescription} onChange={(e) => setHeroDescription(e.target.value)} placeholder={"예: 신선한 식재료를 더 빠르고,\n더 편리하게 주문하세요."} />
        </label>
      </div>

      <div className="adm-form-card">
        <label>주문 문자 받을 번호
          <input inputMode="tel" value={sms} onChange={(e) => setSms(e.target.value)} placeholder="예: 01012345678" />
          <small>거래처가 '문자로 주문 보내기'를 누르면 이 번호로 문자가 작성됩니다.</small>
        </label>
        <label>행사 카테고리
          <select value={promoCategory} onChange={(e) => setPromoCategory(e.target.value)}>
            {Object.keys(store.categories).map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <small>이 카테고리 상품에 '행사' 표시가 붙고 첫 화면 행사상품에 노출됩니다.</small>
        </label>
        <div className="adm-form-actions"><button type="button" className="adm-primary" disabled={busy || uploading} onClick={save}>{busy ? "저장 중" : "설정 저장"}</button></div>
      </div>
    </section>
  );
}

function SettingsPanel({ store, onSaved, onError }: { store: StoreData; onSaved: () => Promise<void>; onError: (value: string) => void }) {
  const [sms, setSms] = useState(store.sms);
  const [promoCategory, setPromoCategory] = useState(store.promoCategory);
  const [orderEnabled, setOrderEnabled] = useState(store.orderSettings.enabled);
  const [order24h, setOrder24h] = useState(store.orderSettings.open24h);
  const [openTime, setOpenTime] = useState(store.orderSettings.openTime);
  const [closeTime, setCloseTime] = useState(store.orderSettings.closeTime);
  const [editMinutes, setEditMinutes] = useState(store.orderSettings.editMinutes);
  const [cancelMinutes, setCancelMinutes] = useState(store.orderSettings.cancelMinutes);
  useEffect(() => {
    setSms(store.sms); setPromoCategory(store.promoCategory);
    setOrderEnabled(store.orderSettings.enabled); setOrder24h(store.orderSettings.open24h);
    setOpenTime(store.orderSettings.openTime); setCloseTime(store.orderSettings.closeTime);
    setEditMinutes(store.orderSettings.editMinutes); setCancelMinutes(store.orderSettings.cancelMinutes);
  }, [store]);

  async function save() {
    try {
      onError("");
      await jsonPost("/api/admin/settings", { sms, promoCategory, orderEnabled, order24h, orderOpenTime: openTime, orderCloseTime: closeTime, editMinutes, cancelMinutes });
      await onSaved();
    } catch (reason) { onError(reason instanceof Error ? reason.message : "설정 저장에 실패했습니다."); }
  }

  return (
    <section className="admin-section admin-settings">
      <div><h2>주문 운영 설정</h2><p>관리자가 주문버튼과 주문 가능시간을 직접 통제합니다.</p></div>
      <label>문자 백업 수신번호<input value={sms} onChange={(e) => setSms(e.target.value)} /></label>
      <label>행사 카테고리<select value={promoCategory} onChange={(e) => setPromoCategory(e.target.value)}>{Object.keys(store.categories).map((name) => <option key={name}>{name}</option>)}</select></label>
      <label className="admin-check"><input type="checkbox" checked={orderEnabled} onChange={(e) => setOrderEnabled(e.target.checked)} /> 주문 접수 ON</label>
      <label className="admin-check"><input type="checkbox" checked={order24h} onChange={(e) => setOrder24h(e.target.checked)} /> 24시간 주문</label>
      {!order24h && <><label>주문 시작<input type="time" value={openTime} onChange={(e) => setOpenTime(e.target.value)} /></label><label>주문 마감<input type="time" value={closeTime} onChange={(e) => setCloseTime(e.target.value)} /></label></>}
      <label>수정 기준(분)<input type="number" min="0" value={editMinutes} onChange={(e) => setEditMinutes(Number(e.target.value || 0))} /></label>
      <label>취소 가능(분)<input type="number" min="0" value={cancelMinutes} onChange={(e) => setCancelMinutes(Number(e.target.value || 0))} /></label>
      <button type="button" onClick={save}>설정 저장</button>
    </section>
  );
}

function digitsOnly(value: string) {
  return value.replace(/\D/g, "");
}

function sanitizeKgNumber(value: string) {
  const normalized = value.replace(/,/g, ".").replace(/[^0-9.]/g, "");
  const [whole = "", ...decimals] = normalized.split(".");
  return decimals.length ? `${whole}.${decimals.join("")}` : whole;
}

function unitInputValue(unit: string) {
  const value = unit.trim().toLowerCase();
  const kg = value.match(/^([0-9]+(?:\.[0-9]+)?)\s*kg$/);
  if (kg) return kg[1] ?? "";
  const grams = value.match(/^([0-9]+(?:\.[0-9]+)?)\s*g$/);
  if (grams) {
    const converted = Number(grams[1]) / 1000;
    return Number.isFinite(converted) ? String(converted) : "";
  }
  return sanitizeKgNumber(value);
}

function kgUnitFromInput(value: string) {
  const cleaned = sanitizeKgNumber(value);
  return cleaned ? `${cleaned}kg` : "";
}

function normalizeStoredUnit(unit: string) {
  const value = unit.trim().toLowerCase();
  if (!value) return "";
  if (/^[0-9]+(?:\.[0-9]+)?\s*kg$/.test(value)) return `${unitInputValue(value)}kg`;
  if (/^[0-9]+(?:\.[0-9]+)?\s*g$/.test(value)) return `${unitInputValue(value)}kg`;
  if (/^[0-9]+(?:\.[0-9]+)?$/.test(value)) return `${value}kg`;
  return unit.trim();
}

function ProductEditor({
  product,
  creating,
  categories,
  onClose,
  onSaved,
  onError,
}: {
  product: Product;
  creating: boolean;
  categories: Record<string, string[]>;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
  onError: (value: string) => void;
}) {
  const [draft, setDraft] = useState<Product>(() => structuredClone(product));
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");
  const categoryNames = Object.keys(categories);
  const state = productStatus(draft);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousOverscroll = document.body.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";
    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.overscrollBehavior = previousOverscroll;
    };
  }, []);

  useEffect(() => {
    if (!categories[draft.category]?.includes(draft.sub)) {
      setDraft((current) => ({ ...current, sub: categories[current.category]?.[0] ?? "" }));
    }
  }, [draft.category, draft.sub, categories]);

  useEffect(() => {
    if (!photoFile) { setPhotoPreview(""); return; }
    const url = URL.createObjectURL(photoFile);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photoFile]);

  function updateOption(index: number, patch: Partial<PackOption>) {
    setDraft((current) => ({
      ...current,
      packOptions: current.packOptions.map((option, i) => i === index ? { ...option, ...patch } : option),
    }));
  }

  function setState(next: "selling" | "soldout" | "hidden") {
    setDraft((current) => ({ ...current, soldout: next === "soldout", hidden: next === "hidden" }));
  }

  async function save() {
    setLocalError("");
    if (!draft.name.trim()) { setLocalError("상품명을 입력해 주세요."); return; }
    if (!draft.packOptions.some((o) => o.label.trim())) { setLocalError("주문 단위를 하나 이상 입력해 주세요."); return; }
    setBusy(true);
    onError("");
    try {
      let photo = draft.photo;
      if (photoFile) photo = await uploadPhoto(photoFile);
      await jsonPost("/api/admin/products", {
        action: creating ? "create" : "update",
        product: { ...draft, name: draft.name.trim(), unit: normalizeStoredUnit(draft.unit), photo },
      });
      await onSaved(`‘${draft.name.trim()}’ ${creating ? "상품을 추가했습니다" : "저장했습니다"}.`);
    } catch (reason) {
      setLocalError(reason instanceof Error ? reason.message : "상품 저장에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (creating || !window.confirm(`‘${draft.name}’ 상품을 삭제할까요?\n삭제하면 되돌릴 수 없습니다. 잠시 내릴 때는 '숨김'을 사용하세요.`)) return;
    setBusy(true);
    try {
      await jsonPost("/api/admin/products", { action: "delete", id: draft.id });
      await onSaved(`‘${draft.name}’ 상품을 삭제했습니다.`);
    } catch (reason) {
      setLocalError(reason instanceof Error ? reason.message : "상품 삭제에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const shownPhoto = photoPreview || draft.photo;

  return (
    <div className="adm-modal-backdrop" onMouseDown={(e) => { if (e.currentTarget === e.target && !busy) onClose(); }}>
      <section className="adm-editor" role="dialog" aria-modal="true" aria-label={creating ? "상품 등록" : "상품 수정"}>
        <header className="adm-editor-head">
          <div><p>{creating ? "상품 등록" : "상품 수정"}</p><h2>{draft.name || "새 상품"}</h2></div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="닫기">×</button>
        </header>

        <div className="adm-editor-body">
          <div className="adm-editor-col">
            <h3>기본 정보</h3>
            <div className="adm-photo-field">
              <div className="adm-photo-preview">
                {shownPhoto ? <img src={shownPhoto} alt="" /> : <span>사진 없음</span>}
              </div>
              <div className="adm-photo-actions">
                <label className="adm-upload">
                  ＋ 사진 {shownPhoto ? "변경" : "등록"}
                  <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)} />
                </label>
                {(photoFile || draft.photo) && (
                  <button type="button" onClick={() => { setPhotoFile(null); setDraft({ ...draft, photo: "" }); }}>사진 빼기</button>
                )}
                <small>JPG·PNG·WebP, 최대 5MB<br />정사각형 사진이 가장 보기 좋습니다.</small>
              </div>
            </div>

            <label className="adm-field">상품명 <em>*</em>
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="예: 등심돈까스" />
            </label>
            <div className="adm-row2">
              <label className="adm-field">규격
                <span className="adm-suffix">
                  <input inputMode="decimal" value={unitInputValue(draft.unit)} onChange={(e) => setDraft({ ...draft, unit: kgUnitFromInput(e.target.value) })} placeholder="예: 3" />
                  <b>kg</b>
                </span>
              </label>
              <label className="adm-field">상품 코드
                <input value={draft.id || "저장하면 자동 생성"} readOnly className="readonly" />
              </label>
            </div>
            <div className="adm-row2">
              <label className="adm-field">카테고리 <em>*</em>
                <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value, sub: categories[e.target.value]?.[0] ?? "" })}>
                  {categoryNames.map((name) => <option key={name}>{name}</option>)}
                </select>
              </label>
              <label className="adm-field">세부 카테고리
                <select value={draft.sub} onChange={(e) => setDraft({ ...draft, sub: e.target.value })}>
                  {(categories[draft.category] ?? []).map((name) => <option key={name}>{name}</option>)}
                </select>
              </label>
            </div>

            <div className="adm-units">
              <div className="adm-units-head">
                <h3>주문 단위 설정</h3>
                <button type="button" onClick={() => setDraft({ ...draft, packOptions: [...draft.packOptions, { label: "박스", spec: "", price: null, step: 1 }] })}>＋ 단위 추가</button>
              </div>
              <p className="adm-help"><b>B그룹 가격</b>은 B그룹 거래처에게만 보이고 주문 금액도 이 가격으로 계산됩니다. 비워두면 B그룹도 정가로 판매됩니다.</p>
              <p className="adm-help">규격에는 숫자만 입력하세요. 거래처 화면에서는 kg가 자동으로 붙습니다. 예: 10 → ‘10kg’. ‘+/- 증가 단위’는 + 버튼을 한 번 눌렀을 때 늘어나는 수량이며, 박스·봉지는 보통 1로 두면 됩니다.</p>
              {draft.packOptions.map((option, index) => (
                <div className="adm-unit-row" key={index}>
                  <label>단위<input value={option.label} onChange={(e) => updateOption(index, { label: e.target.value })} placeholder="박스" list="adm-unit-presets" /></label>
                  <label>규격(kg)<input inputMode="decimal" value={option.spec ?? ""} onChange={(e) => updateOption(index, { spec: sanitizeKgNumber(e.target.value) })} placeholder="예: 10" /></label>
                  <label>+/- 증가 단위<input inputMode="decimal" value={option.step} onChange={(e) => { const value = sanitizeKgNumber(e.target.value); updateOption(index, { step: value ? Number(value) : 1 }); }} /></label>
                  <label>정가(A그룹)<input inputMode="numeric" value={option.price ?? ""} placeholder="가격문의" onChange={(e) => updateOption(index, { price: e.target.value === "" ? null : Number(e.target.value.replace(/\D/g, "")) })} /></label>
                  <label className="adm-price-b">B그룹 가격<input inputMode="numeric" value={option.priceB ?? ""} placeholder="정가와 동일" onChange={(e) => updateOption(index, { priceB: e.target.value === "" ? null : Number(e.target.value.replace(/\D/g, "")) })} /></label>
                  <button type="button" className="adm-unit-del" aria-label="단위 삭제" onClick={() => setDraft({ ...draft, packOptions: draft.packOptions.filter((_, i) => i !== index) })}>×</button>
                </div>
              ))}
              <datalist id="adm-unit-presets">
                {["박스", "반박스", "봉지", "팩", "kg", "개", "통", "캔", "판", "묶음"].map((u) => <option key={u} value={u} />)}
              </datalist>
            </div>
          </div>

          <div className="adm-editor-col">
            <h3>추가 정보</h3>
            <label className="adm-field">행사 가격
              <span className="adm-suffix">
                <input inputMode="numeric" value={draft.promoPrice ?? ""} placeholder="없음" onChange={(e) => setDraft({ ...draft, promoPrice: e.target.value === "" ? null : Number(e.target.value.replace(/\D/g, "")) })} />
                <b>원</b>
              </span>
            </label>

            <div className="adm-box-info">
              <strong>인분 안내 <small>거래처 상품카드에 노란 박스로 표시됩니다</small></strong>
              <label className="adm-field">1단위(봉지·팩) 기준 인분
                <input inputMode="numeric" value={draft.servingsPerUnit ?? ""} onChange={(e) => setDraft({ ...draft, servingsPerUnit: digitsOnly(e.target.value) })} placeholder="예: 20" />
              </label>
              <div className="adm-row2">
                <label className="adm-field">1박스 입수 수량
                  <input inputMode="numeric" value={draft.boxContents ?? ""} onChange={(e) => setDraft({ ...draft, boxContents: digitsOnly(e.target.value) })} placeholder="예: 10" />
                </label>
                <label className="adm-field">1박스 기준 인분
                  <input inputMode="numeric" value={draft.servingsPerBox ?? ""} onChange={(e) => setDraft({ ...draft, servingsPerBox: digitsOnly(e.target.value) })} placeholder="예: 100" />
                </label>
              </div>
            </div>

            <label className="adm-field">상품 설명
              <textarea value={draft.description ?? ""} onChange={(e) => setDraft({ ...draft, description: e.target.value })} rows={4} placeholder="예: 국내산 등심으로 만든 바삭한 돈까스입니다. 170도 기름에 4~5분 튀겨주세요." />
            </label>

            <label className="adm-field">과세 구분
              <select value={draft.taxType ?? "taxable"} onChange={(e) => setDraft({ ...draft, taxType: e.target.value === "exempt" ? "exempt" : "taxable" })}>
                <option value="taxable">과세</option><option value="exempt">면세(비과세)</option>
              </select>
            </label>

            <details className="adm-more">
              <summary>단가표 설정</summary>
              <div className="adm-row2">
                <label className="adm-field">가격표시 방식
                  <select value={draft.priceDisplayMode ?? "fixed"} onChange={(e) => setDraft({ ...draft, priceDisplayMode: e.target.value === "market" ? "market" : e.target.value === "inquiry" ? "inquiry" : "fixed" })}>
                    <option value="fixed">고정가격</option>
                    <option value="market">싯가</option>
                    <option value="inquiry">가격문의</option>
                  </select>
                </label>
                <label className="adm-check"><input type="checkbox" checked={draft.priceListVisible !== false} onChange={(e) => setDraft({ ...draft, priceListVisible: e.target.checked })} /> 단가표에 공개</label>
              </div>
            </details>

            <fieldset className="adm-status">
              <legend>상태</legend>
              {([["selling", "판매중", "주문화면에 보이고 주문 가능"], ["soldout", "품절", "보이지만 주문 불가"], ["hidden", "숨김", "주문화면에서 안 보임"]] as const).map(([value, label, help]) => (
                <label key={value} className={state === value ? "on" : ""}>
                  <input type="radio" name="adm-status" checked={state === value} onChange={() => setState(value)} />
                  <span><b>{label}</b><small>{help}</small></span>
                </label>
              ))}
            </fieldset>
          </div>
        </div>

        <footer className="adm-editor-foot">
          {localError && <p className="adm-editor-error" role="alert">{localError}</p>}
          {!creating && <button type="button" className="adm-btn-del" onClick={remove} disabled={busy}>상품 삭제</button>}
          <span />
          <button type="button" className="adm-ghost" onClick={onClose} disabled={busy}>취소</button>
          <button type="button" className="adm-primary" onClick={save} disabled={busy}>{busy ? "저장 중…" : "저장하기"}</button>
        </footer>
      </section>
    </div>
  );
}

function makeNewProduct(store: StoreData): Product {
  const category = Object.keys(store.categories)[0] ?? "";
  return {
    id: "",
    name: "",
    category,
    sub: store.categories[category]?.[0] ?? "",
    unit: "",
    price: 0,
    soldout: false,
    photo: "",
    taxType: "taxable",
    description: "",
    servingsPerUnit: "",
    boxContents: "",
    servingsPerBox: "",
    priceListVisible: true,
    priceDisplayMode: "fixed",
    hidden: false,
    promoPrice: null,
    packOptions: [{ label: "박스", spec: "", price: null, step: 1 }],
  };
}

function displayPrice(product: Product) {
  const prices = product.packOptions.map((option) => option.price).filter((price): price is number => price !== null);
  if (!prices.length) return "가격 문의";
  return `${new Intl.NumberFormat("ko-KR").format(Math.min(...prices))}원`;
}

type AdminCustomer = {
  id: string; code: string; name: string; phone: string; businessNumber: string; address: string;
  storePhone: string; region: string; priceGroup: string; active: boolean; receivable: number; lastOrderAt: string | null;
};

type AdminOrderItem = {
  id: number; productId: string; productName: string; unit: string; optionLabel: string;
  quantity: number; unitPrice: number; taxType: string; warehouseZone: string;
};

type AdminOrder = {
  id: string; customerId: string; customerCode: string; customerName: string; source: string; status: string;
  region: string; total: number; note: string; createdAt: string; printedAt: string | null; shippedAt: string | null;
  deliveryDate: string; isAdditional: boolean; createdByStaffName: string; orderPeriod: "AM" | "PM"; loadPrintedAt: string | null;
  items: AdminOrderItem[];
  adjustments: Array<{ id: number; itemId: number; type: string; quantity: number; amount: number; actorName: string; note: string; createdAt: string }>;
};

type InventoryRow = { productId: string; productName: string; category: string; warehouseZone: string; optionLabel: string; quantity: number };

function CustomerOpsPanel({ onError }: { onError: (value: string) => void }) {
  const [customers, setCustomers] = useState<AdminCustomer[]>([]);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [region, setRegion] = useState("");
  const [storePhone, setStorePhone] = useState("");
  const [businessNumber, setBusinessNumber] = useState("");
  const [address, setAddress] = useState("");
  const [priceGroup, setPriceGroup] = useState("A");
  const [pin, setPin] = useState("");
  const [query, setQuery] = useState("");
  const [filterGroup, setFilterGroup] = useState<"전체" | "A" | "B">("전체");

  async function load() {
    const response = await fetch("/api/admin/customers", { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json() as { customers: AdminCustomer[] };
    setCustomers(data.customers);
  }
  useEffect(() => { void load(); }, []);

  async function create() {
    try {
      onError("");
      await jsonPost("/api/admin/customers", { action: "create", code, name, region, storePhone, businessNumber, address, priceGroup, pin });
      setCode(""); setName(""); setRegion(""); setStorePhone(""); setBusinessNumber(""); setAddress(""); setPin("");
      await load();
    } catch (reason) { onError(reason instanceof Error ? reason.message : "거래처 추가에 실패했습니다."); }
  }

  async function action(body: Record<string, unknown>) {
    try { onError(""); await jsonPost("/api/admin/customers", body); await load(); }
    catch (reason) { onError(reason instanceof Error ? reason.message : "거래처 작업에 실패했습니다."); }
  }

  const needle = query.trim().toLowerCase();
  const visible = customers.filter((c) => {
    if (filterGroup !== "전체" && c.priceGroup !== filterGroup) return false;
    return !needle || `${c.code} ${c.name} ${c.region}`.toLowerCase().includes(needle);
  });
  const totalReceivable = customers.reduce((sum, c) => sum + c.receivable, 0);

  return (
    <section className="admin-section ops-section" id="admin-customers">
      <div className="admin-section-head">
        <div><h2>거래처 · 미수금</h2><p>거래처 로그인, 지역, 가격그룹, 미수금과 입금을 관리합니다.</p></div>
        <div className="ops-metric"><b>{customers.length}</b><span>거래처</span><b>{new Intl.NumberFormat("ko-KR").format(totalReceivable)}원</b><span>총 미수</span></div>
      </div>
      <div className="customer-create-grid">
        <input className="customer-code" placeholder="거래처번호 예: 8-18" value={code} onChange={(e) => setCode(e.target.value)} />
        <input className="customer-name" placeholder="거래처명" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="customer-region" placeholder="지역 예: 1단지" value={region} onChange={(e) => setRegion(e.target.value)} />
        <input className="customer-phone" placeholder="가게 전화번호" value={storePhone} onChange={(e) => setStorePhone(e.target.value)} />
        <input className="customer-business-number" placeholder="사업자번호" value={businessNumber} onChange={(e) => setBusinessNumber(e.target.value)} />
        <input className="customer-address" placeholder="가게 주소" value={address} onChange={(e) => setAddress(e.target.value)} />
        <select className="customer-price-group" value={priceGroup} onChange={(e) => setPriceGroup(e.target.value)}><option value="A">가격 A그룹</option><option value="B">가격 B그룹</option></select>
        <input className="customer-pin" placeholder="최초 인증번호 6자리" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))} />
        <button className="admin-primary customer-add" type="button" onClick={() => void create()} disabled={!code.trim() || !name.trim() || pin.length !== 6}>+ 거래처 추가</button>
      </div>
      <div className="customer-group-filter"><span>가격그룹 보기</span><button type="button" className={filterGroup === "전체" ? "selected" : ""} onClick={() => setFilterGroup("전체")}>전체 {customers.length}</button><button type="button" className={filterGroup === "A" ? "selected" : ""} onClick={() => setFilterGroup("A")}>A그룹 {customers.filter((c) => c.priceGroup === "A").length}</button><button type="button" className={filterGroup === "B" ? "selected" : ""} onClick={() => setFilterGroup("B")}>B그룹 {customers.filter((c) => c.priceGroup === "B").length}</button></div>
      <input className="ops-search" placeholder="거래처번호·상호·지역 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>거래처</th><th>지역</th><th>그룹</th><th>미수금</th><th>관리</th></tr></thead><tbody>
        {visible.map((c) => <tr key={c.id} className={!c.active ? "row-disabled" : ""}>
          <td><b>{c.code}</b><span>{c.name}</span></td><td>{c.region || "미지정"}</td><td>{c.priceGroup}</td><td className={c.receivable > 0 ? "money-warn" : ""}>{new Intl.NumberFormat("ko-KR").format(c.receivable)}원</td>
          <td><div className="row-actions">
            <button type="button" onClick={() => { const amount = window.prompt(`${c.name} 입금액`); if (amount && Number(amount) > 0) void action({ action: "payment", id: c.id, amount: Number(amount), method: "bank" }); }}>입금</button>
            <button type="button" onClick={() => { const month = window.prompt("출력할 거래월 (YYYY-MM)", new Date().toISOString().slice(0,7)); if (month) window.open(`/api/admin/print-ledger?customerId=${encodeURIComponent(c.id)}&month=${encodeURIComponent(month)}`, "_blank"); }}>원장</button>
            <button type="button" onClick={() => {
              const name = window.prompt("거래처명", c.name); if (!name) return;
              const region = window.prompt("배송지역", c.region) ?? c.region;
              const storePhone = window.prompt("가게 전화번호", c.storePhone) ?? c.storePhone;
              const businessNumber = window.prompt("사업자번호", c.businessNumber) ?? c.businessNumber;
              const address = window.prompt("가게 주소", c.address) ?? c.address;
              const priceGroup = window.prompt("가격그룹 A 또는 B", c.priceGroup) === "B" ? "B" : "A";
              void action({ action: "update", id: c.id, code: c.code, name, region, storePhone, businessNumber, address, phone: c.phone, priceGroup });
            }}>정보수정</button>
            <button type="button" onClick={() => { const next = window.prompt("새 6자리 인증번호", String(Math.floor(100000 + Math.random() * 900000))); if (next) void action({ action: "reset-pin", id: c.id, pin: next }); }}>PIN</button>
            <button type="button" onClick={() => void action({ action: "logout-all", id: c.id })}>로그인초기화</button>
            <button type="button" onClick={() => void action({ action: "toggle", id: c.id, active: !c.active })}>{c.active ? "중지" : "사용"}</button>
          </div></td>
        </tr>)}
      </tbody></table></div>
    </section>
  );
}

function OrderOpsPanel({ store, onError }: { store: StoreData; onError: (value: string) => void }) {
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [customers, setCustomers] = useState<AdminCustomer[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [productId, setProductId] = useState(store.products[0]?.id ?? "");
  const product = store.products.find((p) => p.id === productId) ?? store.products[0];
  const [optionLabel, setOptionLabel] = useState(product?.packOptions[0]?.label ?? "");
  const [qty, setQty] = useState(1);
  const [manualItems, setManualItems] = useState<Array<{ productId: string; productName: string; optionLabel: string; quantity: number }>>([]);
  const [orderPeriodValue, setOrderPeriodValue] = useState<"AM" | "PM">(() => orderPeriod(new Date().toISOString().replace("T"," ").replace("Z","")) === "오후발주" ? "PM" : "AM");
  const [productSearch, setProductSearch] = useState(product?.name ?? "");
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [deliveryDate, setDeliveryDate] = useState(kstDateLocal(0));

  async function load() {
    const [or, cr] = await Promise.all([
      fetch("/api/admin/orders", { cache: "no-store" }),
      fetch("/api/admin/customers", { cache: "no-store" }),
    ]);
    if (or.ok) setOrders(((await or.json()) as { orders: AdminOrder[] }).orders);
    if (cr.ok) {
      const list = ((await cr.json()) as { customers: AdminCustomer[] }).customers;
      setCustomers(list);
      setCustomerId((current) => current || list[0]?.id || "");
    }
  }
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const next = store.products.find((p) => p.id === productId);
    if (next && !next.packOptions.some((o) => o.label === optionLabel)) setOptionLabel(next.packOptions[0]?.label ?? "");
  }, [productId, optionLabel, store.products]);

  async function action(body: Record<string, unknown>) {
    try { onError(""); await jsonPost("/api/admin/orders", body); await load(); }
    catch (reason) { onError(reason instanceof Error ? reason.message : "주문 작업에 실패했습니다."); }
  }

  function addManualItem() {
    if (!product || !optionLabel || qty <= 0) return;
    setManualItems((current) => [...current, { productId: product.id, productName: product.name, optionLabel, quantity: Math.max(1, Math.round(qty)) }]);
  }

  async function createManualOrder(confirmAnomaly = false) {
    if (!customerId || !manualItems.length) return;
    onError("");
    const response = await fetch("/api/admin/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create-order", customerId, deliveryDate, orderPeriod: orderPeriodValue, confirmAnomaly, items: manualItems.map((i) => ({ productId: i.productId, optionLabel: i.optionLabel, quantity: i.quantity })) }) });
    const data = await response.json() as { error?: string; warning?: boolean; warnings?: Array<{ message: string }> };
    if (response.status === 409 && data.warning) {
      const details = (data.warnings ?? []).map((row) => `• ${row.message}`).join("\n");
      if (window.confirm(`⚠ 평소 주문량보다 많은 품목이 있습니다.\n\n${details}\n\n그래도 접수할까요?`)) await createManualOrder(true);
      return;
    }
    if (!response.ok) { onError(data.error || "주문 접수에 실패했습니다."); return; }
    setManualItems([]); await load();
  }

  const active = orders.filter((o) => (o.status === "received" || o.status === "preparing") && (!o.deliveryDate || o.deliveryDate === deliveryDate));
  const regions = Array.from(new Set(active.map((o) => o.region || "미지정"))).sort();
  const productNeedle = productSearch.trim().toLowerCase().replace(/\s+/g, "");
  const productSuggestions = productNeedle
    ? store.products
        .filter((p) => p.name.toLowerCase().replace(/\s+/g, "").includes(productNeedle))
        .sort((a, b) => Number(!a.name.toLowerCase().replace(/\s+/g, "").startsWith(productNeedle)) - Number(!b.name.toLowerCase().replace(/\s+/g, "").startsWith(productNeedle)))
        .slice(0, 10)
    : [];

  function selectManualProduct(nextProduct: Product) {
    setProductId(nextProduct.id);
    setProductSearch(nextProduct.name);
    setOptionLabel(nextProduct.packOptions[0]?.label ?? "");
    setProductPickerOpen(false);
  }

  return (
    <section className="admin-section ops-section" id="admin-orders">
      <div className="admin-section-head"><div><h2>주문 · 전표출력 · 출고</h2><p>앱/전화/문자 주문을 한 곳에서 처리하고 지역별 신규분만 출력합니다.</p></div><div className="ops-metric"><b>{active.length}</b><span>출고대기</span><b>{active.filter((o) => !o.printedAt).length}</b><span>미출력</span></div></div>

      <div className="region-cards">
        {regions.map((region) => {
          const rows = active.filter((o) => (o.region || "미지정") === region);
          const unprinted = rows.filter((o) => !o.printedAt).length;
          const loadPending = rows.filter((o) => !o.loadPrintedAt);
          const loadCustomers = new Set(loadPending.map((o) => o.customerId)).size;
          const loadLines = loadPending.reduce((sum, o) => sum + o.items.length, 0);
          const recommendLoadSheet = loadCustomers >= 10 || loadLines >= 30;
          return <div className={`region-card ${recommendLoadSheet ? "load-recommended" : ""}`} key={region}>
            <div><strong>{region}</strong><span>주문 {rows.length}건 · 명세표 신규 {unprinted}건</span><small>상차대기 {loadCustomers}곳 · 품목 {loadLines}줄 {recommendLoadSheet ? "· 상차준비표 출력 권장" : "· 필요 시 선택 출력"}</small></div>
            <div className="region-card-actions">
              <button type="button" disabled={!unprinted} onClick={() => window.open(`/api/admin/print-orders?region=${encodeURIComponent(region)}&deliveryDate=${encodeURIComponent(deliveryDate)}&unprinted=1`, "_blank")}>거래명세표</button>
              <button type="button" disabled={!unprinted} onClick={() => { if (window.confirm(`${region} 거래명세표 신규분을 출력완료로 표시할까요?`)) void action({ action: "mark-region-printed", region, deliveryDate }); }}>명세표 완료</button>
              <button type="button" className={recommendLoadSheet ? "recommended" : ""} disabled={!loadPending.length} onClick={() => window.open(`/api/admin/print-load-sheet?region=${encodeURIComponent(region)}&deliveryDate=${encodeURIComponent(deliveryDate)}&pending=1`, "_blank")}>{recommendLoadSheet ? "🚨 상차준비표" : "상차준비표"}</button>
              <button type="button" disabled={!loadPending.length} onClick={() => { if (window.confirm(`${region} 현재 상차대기분을 출력완료로 표시할까요? 이후 들어오는 주문은 다음 추가분으로 자동 분리됩니다.`)) void action({ action: "mark-load-printed", region, deliveryDate }); }}>상차표 완료</button>
            </div>
          </div>;
        })}
        {!regions.length && <p className="ops-empty">현재 출고대기 주문이 없습니다.</p>}
      </div>

      <div className="manual-order-box">
        <div className="manual-order-title"><div><h3>주문발주 입력</h3><p>직원이 대신 입력한 주문도 앱 주문과 동일하게 재고·미수·전표 흐름에 반영됩니다.</p></div></div>
        <div className="manual-order-controls">
          <select className="manual-customer" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>{customers.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select>
          <label className="manual-date"><span>배송일</span><input type="date" value={deliveryDate} min={kstDateLocal(0)} onChange={(e) => setDeliveryDate(e.target.value)} /></label>
          <div className="order-period-toggle" role="group" aria-label="발주 시간대">
            <button type="button" className={orderPeriodValue === "AM" ? "selected" : ""} onClick={() => setOrderPeriodValue("AM")}>오전발주</button>
            <button type="button" className={orderPeriodValue === "PM" ? "selected" : ""} onClick={() => setOrderPeriodValue("PM")}>오후발주</button>
          </div>
          <div className="product-autocomplete">
            <input
              value={productSearch}
              placeholder="상품명 입력 예: 등심돈"
              autoComplete="off"
              onFocus={() => setProductPickerOpen(true)}
              onChange={(e) => { setProductSearch(e.target.value); setProductPickerOpen(true); }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && productSuggestions[0]) { e.preventDefault(); selectManualProduct(productSuggestions[0]); }
                if (e.key === "Escape") setProductPickerOpen(false);
              }}
            />
            {productPickerOpen && productNeedle && (
              <div className="product-suggestions">
                {productSuggestions.length ? productSuggestions.map((p) => (
                  <button type="button" key={p.id} onMouseDown={(e) => e.preventDefault()} onClick={() => selectManualProduct(p)}>
                    <strong>{p.name}</strong><span>{p.category}{p.sub ? ` · ${p.sub}` : ""}{p.unit ? ` · ${p.unit}` : ""}</span>
                  </button>
                )) : <div className="product-suggestion-empty">일치하는 상품이 없습니다.</div>}
              </div>
            )}
          </div>
          <select className="manual-unit-select" value={optionLabel} onChange={(e) => setOptionLabel(e.target.value)}>{(product?.packOptions ?? []).map((o) => <option key={o.label}>{o.label}</option>)}</select>
          <div className="manual-qty-unit"><input type="number" min="0" step="1" value={qty} onChange={(e) => setQty(Math.max(0, Math.round(Number(e.target.value || 0))))} /><b>{optionLabel || "단위"}</b></div>
          <button type="button" className="manual-add-item" onClick={addManualItem}>품목 추가</button>
        </div>
        {manualItems.length > 0 && <div className="manual-items">{manualItems.map((item, index) => <span key={`${item.productId}-${index}`}>{item.productName} {item.quantity}{item.optionLabel}<button type="button" onClick={() => setManualItems((x) => x.filter((_, i) => i !== index))}>×</button></span>)}</div>}
        <div className="manual-submit-row"><button className="admin-primary" type="button" disabled={!customerId || !manualItems.length} onClick={() => void createManualOrder(false)}>이 주문 접수</button></div>
      </div>

      <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>주문</th><th>지역</th><th>품목</th><th>금액</th><th>상태/처리</th></tr></thead><tbody>
        {orders.slice(0, 80).map((o) => <tr key={o.id} data-order-id={o.id}>
          <td><b>{o.customerCode} · {o.customerName} {o.isAdditional && <em className="additional-badge">🚨 추가발주</em>}</b><span>배송 {o.deliveryDate || "미지정"} · <strong className="order-period-badge">{o.orderPeriod === "PM" ? "오후발주" : "오전발주"}</strong> · {o.createdAt} · {o.createdByStaffName || o.source}</span></td><td>{o.region || "미지정"}</td>
          <td><div className="order-item-lines">{o.items.map((i) => <div className="order-item-admin" key={i.id}><button type="button" title={o.status === "shipped" ? "출고완료 품목" : "단가수정"} onClick={() => { if (o.status === "shipped") return; const next = window.prompt(`${i.productName} 단가`, String(i.unitPrice)); if (next !== null && Number(next) >= 0) void action({ action: "update-price", id: o.id, itemId: i.id, unitPrice: Number(next) }); }}>{i.productName} {i.quantity}{i.optionLabel} · {new Intl.NumberFormat("ko-KR").format(i.unitPrice)}원</button>{o.status === "shipped" && <span className="shipment-adjust-buttons"><button type="button" onClick={() => { const q = window.prompt(`${i.productName} 반품 수량 (${i.optionLabel})`, "1"); if (q && Number(q) > 0) void action({ action: "adjust-shipment", id: o.id, itemId: i.id, quantity: Number(q), adjustmentType: "return" }); }}>반품</button><button type="button" onClick={() => { const q = window.prompt(`${i.productName} 미배송 수량 (${i.optionLabel})`, "1"); if (q && Number(q) > 0) void action({ action: "adjust-shipment", id: o.id, itemId: i.id, quantity: Number(q), adjustmentType: "missing" }); }}>미배송</button></span>}</div>)}</div>{o.adjustments?.length > 0 && <div className="adjustment-history">{o.adjustments.map((a) => <span key={a.id}>{a.type === "missing" ? "미배송" : "반품"} {a.quantity} · -{new Intl.NumberFormat("ko-KR").format(a.amount)}원</span>)}</div>}</td>
          <td>{new Intl.NumberFormat("ko-KR").format(o.total)}원</td>
          <td><div className="row-actions"><span>{o.status === "shipped" ? "출고완료" : o.status === "cancelled" ? "취소" : o.printedAt ? "출력완료" : "접수"}</span>{o.status !== "shipped" && o.status !== "cancelled" && <><button type="button" onClick={() => { if (window.confirm(`${o.customerName} 주문을 출고확정할까요? 재고와 미수금이 반영됩니다.`)) void action({ action: "ship", id: o.id }); }}>출고확정</button><button type="button" onClick={() => { if (window.confirm("이 주문을 취소할까요?")) void action({ action: "cancel", id: o.id }); }}>취소</button></>}</div></td>
        </tr>)}
      </tbody></table></div>
    </section>
  );
}

function InventoryOpsPanel({ onError, storeVersion }: { onError: (value: string) => void; storeVersion: number }) {
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("전체");
  async function load() {
    const response = await fetch("/api/admin/inventory", { cache: "no-store" });
    if (!response.ok) return;
    setRows(((await response.json()) as { inventory: InventoryRow[] }).inventory);
  }
  useEffect(() => { void load(); }, [storeVersion]);
  async function adjust(row: InventoryRow) {
    const next = window.prompt(`${row.productName} / ${row.optionLabel} 현재 재고 ${row.quantity}\n새 재고 수량`, String(row.quantity));
    if (next === null) return;
    try {
      onError("");
      await jsonPost("/api/admin/inventory", { productId: row.productId, optionLabel: row.optionLabel, quantity: Number(next), note: "관리자 재고조정" });
      await load();
    } catch (reason) { onError(reason instanceof Error ? reason.message : "재고 조정에 실패했습니다."); }
  }
  const needle = query.trim().toLowerCase();
  const categories = Array.from(new Set(rows.map((r) => r.category || "미분류"))).sort((a, b) => a.localeCompare(b, "ko"));
  const visible = rows.filter((r) => {
    if (category !== "전체" && (r.category || "미분류") !== category) return false;
    return !needle || `${r.productName} ${r.category} ${r.warehouseZone}`.toLowerCase().includes(needle);
  });
  const grouped = categories
    .filter((name) => category === "전체" || category === name)
    .map((name) => ({ name, rows: visible.filter((r) => (r.category || "미분류") === name) }))
    .filter((group) => group.rows.length > 0);
  const productCount = (name: string) => new Set(rows.filter((r) => (r.category || "미분류") === name).map((r) => r.productId)).size;
  return (
    <section className="admin-section ops-section" id="admin-inventory">
      <div className="admin-section-head"><div><h2>재고</h2><p>판매단위별 현재고를 확인하고 조정합니다. 출고확정 시 자동 차감됩니다.</p></div></div>
      <input className="ops-search" placeholder="상품·카테고리·창고위치 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="inventory-category-tabs">
        <button type="button" className={category === "전체" ? "selected" : ""} onClick={() => setCategory("전체")}>전체 <b>{new Set(rows.map((r) => r.productId)).size}</b></button>
        {categories.map((name) => <button type="button" key={name} className={category === name ? "selected" : ""} onClick={() => setCategory(name)}>{name} <b>{productCount(name)}</b></button>)}
      </div>
      <div className="inventory-groups">
        {grouped.map((group) => <section className="inventory-category-group" key={group.name}>
          <div className="inventory-category-head"><h3>{group.name}</h3><span>{productCount(group.name)}개 상품</span></div>
          <div className="inventory-grid">{group.rows.map((row) => <button type="button" className="inventory-card" key={`${row.productId}-${row.optionLabel}`} onClick={() => void adjust(row)}><span>{row.warehouseZone || "위치 미지정"}</span><strong>{row.productName}</strong><small>{row.optionLabel}</small><b className={row.quantity < 0 ? "red" : ""}>{row.quantity}</b></button>)}</div>
        </section>)}
        {!grouped.length && <p className="ops-empty">조건에 맞는 재고가 없습니다.</p>}
      </div>
    </section>
  );
}

type SupplierRow = { id: string; name: string; phone: string; category_note: string; order_cutoff: string; memo: string };
type AuditRow = { id: number; actor_name: string; action: string; entity_type: string; entity_id: string; summary: string; created_at: string };
type StaffRow = { id: string; username: string; display_name: string; role: "ADMIN" | "DRIVER"; active: number | boolean; updated_at: string };

function SupplierPanel({ onError }: { onError: (value: string) => void }) {
  const [rows, setRows] = useState<SupplierRow[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [categoryNote, setCategoryNote] = useState("");
  const [cutoff, setCutoff] = useState("");
  async function load() {
    const response = await fetch("/api/admin/suppliers", { cache: "no-store" });
    if (!response.ok) return;
    setRows(((await response.json()) as { suppliers: SupplierRow[] }).suppliers);
  }
  useEffect(() => { void load(); }, []);
  async function create() {
    try {
      onError("");
      await jsonPost("/api/admin/suppliers", { action: "create", name, phone, categoryNote, orderCutoff: cutoff });
      setName(""); setPhone(""); setCategoryNote(""); setCutoff(""); await load();
    } catch (reason) { onError(reason instanceof Error ? reason.message : "매입처 추가 실패"); }
  }
  async function edit(row: SupplierRow) {
    const nextName = window.prompt("업체명", row.name); if (!nextName) return;
    const nextPhone = window.prompt("전화번호", row.phone) ?? row.phone;
    const nextCategory = window.prompt("주요 품목", row.category_note) ?? row.category_note;
    const nextCutoff = window.prompt("발주마감/입고메모", row.order_cutoff) ?? row.order_cutoff;
    try { await jsonPost("/api/admin/suppliers", { action: "update", id: row.id, name: nextName, phone: nextPhone, categoryNote: nextCategory, orderCutoff: nextCutoff, memo: row.memo }); await load(); }
    catch (reason) { onError(reason instanceof Error ? reason.message : "매입처 수정 실패"); }
  }
  return <div className="side-panel supplier-panel"><div className="side-panel-head"><div><p>① 빠른업무</p><h2>매입처</h2></div><span>{rows.length}</span></div><div className="supplier-create"><input placeholder="업체명" value={name} onChange={(e) => setName(e.target.value)} /><input placeholder="전화번호" value={phone} onChange={(e) => setPhone(e.target.value)} /><input placeholder="주요 품목" value={categoryNote} onChange={(e) => setCategoryNote(e.target.value)} /><input placeholder="발주마감 예: 15:00" value={cutoff} onChange={(e) => setCutoff(e.target.value)} /><button type="button" disabled={!name.trim()} onClick={() => void create()}>+ 추가</button></div><div className="supplier-list">{rows.map((row) => <article key={row.id}><button type="button" className="supplier-main" onClick={() => void edit(row)}><strong>{row.name}</strong><span>{row.category_note || "품목 미지정"}</span>{row.order_cutoff && <small>{row.order_cutoff}</small>}</button>{row.phone ? <a href={`tel:${row.phone}`}>☎ {row.phone}</a> : <span className="no-phone">전화번호 없음</span>}</article>)}{!rows.length && <p className="side-empty">매입처를 추가하면 여기에 바로 표시됩니다.</p>}</div></div>;
}

function AuditPanel() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [unreadIds, setUnreadIds] = useState<number[]>([]);
  const latestIdRef = useRef(0);
  async function load() {
    const r = await fetch("/api/admin/audit", { cache: "no-store" });
    if (!r.ok) return;
    const next = ((await r.json()) as { logs: AuditRow[] }).logs;
    const maxId = next.reduce((max, row) => Math.max(max, row.id), 0);
    if (latestIdRef.current > 0 && maxId > latestIdRef.current) {
      const fresh = next.filter((row) => row.id > latestIdRef.current).map((row) => row.id);
      setUnreadIds((current) => Array.from(new Set([...current, ...fresh])));
    }
    latestIdRef.current = Math.max(latestIdRef.current, maxId);
    setRows(next);
  }
  useEffect(() => { void load(); const t = window.setInterval(() => void load(), 3000); return () => window.clearInterval(t); }, []);
  function meta(row: AuditRow) {
    if (row.action === "field_order" || row.action === "admin_order" || row.action === "customer_order") return { icon: "🚨", level: "urgent", label: "새 발주", target: "admin-orders" };
    if (row.action === "return" || row.action === "missing") return { icon: "⚠️", level: "warning", label: row.action === "return" ? "반품" : "미배송", target: "admin-orders" };
    if (row.action === "ship") return { icon: "📦", level: "normal", label: "출고", target: "admin-orders" };
    if (row.action === "payment") return { icon: "💰", level: "normal", label: "입금", target: "admin-customers" };
    if (row.action === "print_load_sheet") return { icon: "📋", level: "normal", label: "상차표", target: "admin-orders" };
    if (row.entity_type === "staff") return { icon: "👤", level: "normal", label: "계정", target: "accounts" };
    if (row.entity_type === "product") return { icon: "🛠️", level: "normal", label: "상품", target: "admin-products" };
    if (row.entity_type === "customer") return { icon: "🏪", level: "normal", label: "거래처", target: "admin-customers" };
    if (row.entity_type === "inventory") return { icon: "📦", level: "normal", label: "재고", target: "admin-inventory" };
    return { icon: "•", level: "normal", label: "작업", target: "" };
  }
  function flash(element: Element | null) {
    if (!element) return;
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    element.classList.add("audit-target-flash");
    window.setTimeout(() => element.classList.remove("audit-target-flash"), 1800);
  }
  function open(row: AuditRow) {
    setUnreadIds((current) => current.filter((id) => id !== row.id));
    const info = meta(row);
    if (info.target === "accounts") { window.location.href = "/admin/accounts"; return; }
    if (row.entity_type === "order" && row.entity_id) {
      const orderRow = document.querySelector(`[data-order-id="${CSS.escape(row.entity_id)}"]`);
      if (orderRow) { flash(orderRow); return; }
    }
    flash(info.target ? document.getElementById(info.target) : null);
  }
  return <div className="side-panel audit-panel"><div className="side-panel-head"><div><p>② 실시간 알림</p><h2>최근 이력 {unreadIds.length > 0 && <em className="audit-unread-count">{unreadIds.length}</em>}</h2></div><button type="button" onClick={() => void load()}>↻</button></div><div className="audit-list">{rows.slice(0, 30).map((row) => { const info = meta(row); const unread = unreadIds.includes(row.id); return <button type="button" className={`audit-item ${info.level} ${unread ? "unread" : ""}`} key={row.id} onClick={() => open(row)}><div className="audit-item-top"><span className="audit-icon">{info.icon}</span><span className="audit-label">{info.label}</span>{unread && <span className="audit-new-dot">NEW</span>}<time>{row.created_at.slice(5, 16)}</time></div><strong>{row.actor_name || "시스템"}</strong><p>{row.summary}</p><small>{row.entity_type === "order" ? "클릭하면 해당 주문으로 이동" : "클릭해서 관련 업무로 이동"}</small></button>; })}{!rows.length && <p className="side-empty">아직 작업이력이 없습니다.</p>}</div></div>;
}

function StaffOpsPanel({ onError }: { onError: (value: string) => void }) {
  const [rows, setRows] = useState<StaffRow[]>([]);
  async function load() { const r = await fetch("/api/admin/staff", { cache: "no-store" }); if (r.ok) setRows(((await r.json()) as { staff: StaffRow[] }).staff); }
  useEffect(() => { void load(); }, []);
  async function action(body: Record<string, unknown>) { try { onError(""); await jsonPost("/api/admin/staff", body); await load(); } catch (reason) { onError(reason instanceof Error ? reason.message : "직원 계정 작업 실패"); } }
  return <section className="admin-section ops-section"><div className="admin-section-head"><div><h2>직원 계정 · 권한</h2><p>사무실은 전체 관리자, 배송기사는 배송기사 전용 앱을 사용합니다. 아이디와 PIN을 여기서 바로 변경할 수 있습니다.</p></div><div className="ops-metric"><b>{rows.filter((r) => r.role === "ADMIN").length}</b><span>관리자</span><b>{rows.filter((r) => r.role === "DRIVER").length}</b><span>배송기사</span></div></div><div className="staff-account-grid">{rows.map((row) => <article key={row.id} className={!Boolean(row.active) ? "disabled" : ""}><div><span className={`role-${row.role.toLowerCase()}`}>{row.role === "ADMIN" ? "관리자" : "배송기사"}</span><strong>{row.display_name}</strong><small>아이디 {row.username}</small></div><div><button type="button" onClick={() => { const username = window.prompt(`${row.display_name} 새 아이디`, row.username); if (username && username.trim() !== row.username) void action({ action: "update-username", id: row.id, username: username.trim() }); }}>아이디 변경</button><button type="button" onClick={() => { const pin = window.prompt(`${row.display_name} 새 6자리 PIN`); if (pin) void action({ action: "reset-pin", id: row.id, pin }); }}>PIN 변경</button><button type="button" onClick={() => void action({ action: "toggle", id: row.id, active: !Boolean(row.active) })}>{Boolean(row.active) ? "계정중지" : "사용"}</button></div></article>)}</div></section>;
}
