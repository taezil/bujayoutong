import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { PackOption, Product, StoreData } from "../lib/db.server";
import { BUJA_LOGO_DATA, BUJA_MARK_DATA } from "../brand-assets";

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

function AdminPage() {
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [store, setStore] = useState<StoreData | null>(null);
  const [error, setError] = useState("");
  const [setupKey, setSetupKey] = useState("");
  const [password, setPassword] = useState("");
  const [editing, setEditing] = useState<Product | "new" | null>(null);

  const loadStore = useCallback(async () => {
    const response = await fetch("/api/store", { cache: "no-store" });
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

  async function setup(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await jsonPost("/api/admin/setup", { key: setupKey, password });
      setPassword("");
      setSetupKey("");
      await loadStatus();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "설정에 실패했습니다.");
    }
  }

  async function login(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await jsonPost("/api/admin/login", { password });
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

  if (status.setupRequired) {
    return (
      <AdminShell>
        <div className="admin-auth-card">
          <h1>관리자 첫 설정</h1>
          <p>처음 한 번만 초기 설정 코드와 새 비밀번호를 입력합니다.</p>
          <form onSubmit={setup}>
            <label>초기 설정 코드<input value={setupKey} onChange={(e) => setSetupKey(e.target.value)} autoComplete="off" /></label>
            <label>새 비밀번호<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={10} autoComplete="new-password" /></label>
            {error && <p className="form-error">{error}</p>}
            <button type="submit">관리자 설정 완료</button>
          </form>
        </div>
      </AdminShell>
    );
  }

  if (!status.authenticated) {
    return (
      <AdminShell>
        <div className="admin-auth-card">
          <h1>관리자 로그인</h1>
          <p>상품, 가격, 품절, 사진과 카테고리를 관리합니다.</p>
          <form onSubmit={login}>
            <label>비밀번호<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>
            {error && <p className="form-error">{error}</p>}
            <button type="submit">로그인</button>
          </form>
        </div>
      </AdminShell>
    );
  }

  if (!store) return <AdminShell><p className="admin-loading">상품을 불러오는 중입니다.</p></AdminShell>;

  return (
    <AdminShell>
      <div className="admin-dashboard">
        <div className="admin-titlebar">
          <div><p>부자유통</p><h1>상품 관리자</h1><span>현재 {store.products.length}개 상품 · 버전 {store.version}</span></div>
          <div className="admin-top-actions"><a href="/" target="_blank" rel="noreferrer">고객 화면</a><button type="button" onClick={logout}>로그아웃</button></div>
        </div>
        {error && <p className="admin-banner-error">{error}</p>}
        <SettingsPanel store={store} onSaved={loadStore} onError={setError} />
        <CategoryPanel store={store} onSaved={loadStore} onError={setError} />
        <section className="admin-section">
          <div className="admin-section-head">
            <div><h2>상품</h2><p>상품은 계속 추가·수정·삭제할 수 있습니다.</p></div>
            <button type="button" className="admin-primary" onClick={() => setEditing("new")}>+ 새 상품 추가</button>
          </div>
          <div className="admin-product-list">
            {store.products.map((product) => (
              <div className="admin-product-row" key={product.id}>
                <div className="admin-product-thumb">{product.photo ? <img src={product.photo} alt="" /> : <img src={BUJA_MARK_DATA} alt="" />}</div>
                <div className="admin-product-copy"><strong>{product.name}</strong><span>{product.category} · {product.sub} · {product.unit}</span></div>
                <div className="admin-product-price">{product.soldout ? <b className="red">품절</b> : <b>{displayPrice(product)}</b>}</div>
                <button type="button" onClick={() => setEditing(product)}>수정</button>
              </div>
            ))}
          </div>
        </section>
      </div>
      {editing && (
        <ProductEditor
          product={editing === "new" ? makeNewProduct(store) : editing}
          creating={editing === "new"}
          categories={store.categories}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await loadStore(); }}
          onError={setError}
        />
      )}
    </AdminShell>
  );
}

function AdminShell({ children }: { children: ReactNode }) {
  return (
    <div className="admin-page">
      <header className="admin-brandbar"><a href="/" aria-label="부자유통 홈"><img src={BUJA_LOGO_DATA} alt="부자유통" /></a></header>
      <main className="admin-wrap">{children}</main>
    </div>
  );
}

function SettingsPanel({ store, onSaved, onError }: { store: StoreData; onSaved: () => Promise<void>; onError: (value: string) => void }) {
  const [sms, setSms] = useState(store.sms);
  const [promoCategory, setPromoCategory] = useState(store.promoCategory);
  useEffect(() => { setSms(store.sms); setPromoCategory(store.promoCategory); }, [store]);

  async function save() {
    try {
      onError("");
      await jsonPost("/api/admin/settings", { sms, promoCategory });
      await onSaved();
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "설정 저장에 실패했습니다.");
    }
  }

  return (
    <section className="admin-section admin-settings">
      <div><h2>주문 설정</h2><p>문자 주문 수신번호와 행사품목 카테고리를 지정합니다.</p></div>
      <label>문자 수신번호<input value={sms} onChange={(e) => setSms(e.target.value)} /></label>
      <label>행사 카테고리<select value={promoCategory} onChange={(e) => setPromoCategory(e.target.value)}>{Object.keys(store.categories).map((name) => <option key={name}>{name}</option>)}</select></label>
      <button type="button" onClick={save}>설정 저장</button>
    </section>
  );
}

function CategoryPanel({ store, onSaved, onError }: { store: StoreData; onSaved: () => Promise<void>; onError: (value: string) => void }) {
  const [newCategory, setNewCategory] = useState("");

  async function action(body: Record<string, string>) {
    try {
      onError("");
      await jsonPost("/api/admin/categories", body);
      await onSaved();
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "카테고리 작업에 실패했습니다.");
    }
  }

  return (
    <section className="admin-section">
      <div className="admin-section-head">
        <div><h2>카테고리</h2><p>카테고리와 세부 분류도 계속 추가·수정할 수 있습니다.</p></div>
        <div className="inline-add">
          <input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="새 카테고리" />
          <button type="button" onClick={async () => {
            if (!newCategory.trim()) return;
            await action({ action: "add-category", name: newCategory });
            setNewCategory("");
          }}>추가</button>
        </div>
      </div>
      <div className="category-admin-grid">
        {Object.entries(store.categories).map(([category, subs]) => (
          <div className="category-admin-card" key={category}>
            <div className="category-admin-title">
              <strong>{category}{category === store.promoCategory ? " 🚨" : ""}</strong>
              <div>
                <button type="button" onClick={() => {
                  const name = window.prompt("새 카테고리명", category);
                  if (name && name !== category) void action({ action: "rename-category", category, name });
                }}>이름변경</button>
                <button type="button" onClick={() => {
                  if (window.confirm(`‘${category}’ 카테고리를 삭제할까요? 상품이 들어 있으면 삭제되지 않습니다.`)) {
                    void action({ action: "delete-category", category });
                  }
                }}>삭제</button>
              </div>
            </div>
            <ul>
              {subs.map((sub) => (
                <li key={sub}>
                  <span>{sub}</span>
                  <div>
                    <button type="button" onClick={() => {
                      const name = window.prompt("새 세부 카테고리명", sub);
                      if (name && name !== sub) void action({ action: "rename-sub", category, sub, name });
                    }}>수정</button>
                    <button type="button" onClick={() => {
                      if (window.confirm(`‘${sub}’ 세부 카테고리를 삭제할까요?`)) void action({ action: "delete-sub", category, sub });
                    }}>삭제</button>
                  </div>
                </li>
              ))}
            </ul>
            <button type="button" className="add-sub" onClick={() => {
              const name = window.prompt(`‘${category}’에 추가할 세부 카테고리명`);
              if (name) void action({ action: "add-sub", category, name });
            }}>+ 세부 카테고리 추가</button>
          </div>
        ))}
      </div>
    </section>
  );
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
  onSaved: () => Promise<void>;
  onError: (value: string) => void;
}) {
  const [draft, setDraft] = useState<Product>(() => structuredClone(product));
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const categoryNames = Object.keys(categories);

  useEffect(() => {
    if (!categories[draft.category]?.includes(draft.sub)) {
      setDraft((current) => ({ ...current, sub: categories[current.category]?.[0] ?? "" }));
    }
  }, [draft.category, draft.sub, categories]);

  function updateOption(index: number, patch: Partial<PackOption>) {
    setDraft((current) => ({
      ...current,
      packOptions: current.packOptions.map((option, i) => i === index ? { ...option, ...patch } : option),
    }));
  }

  async function save() {
    setBusy(true);
    onError("");
    try {
      let photo = draft.photo;
      if (photoFile) {
        const form = new FormData();
        form.append("file", photoFile);
        const upload = await fetch("/api/photo", { method: "POST", body: form });
        const data = await upload.json() as { url?: string; error?: string };
        if (!upload.ok || !data.url) throw new Error(data.error || "사진 업로드에 실패했습니다.");
        photo = data.url;
      }
      await jsonPost("/api/admin/products", {
        action: creating ? "create" : "update",
        product: { ...draft, unit: normalizeStoredUnit(draft.unit), photo },
      });
      await onSaved();
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "상품 저장에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (creating || !window.confirm(`‘${draft.name}’ 상품을 삭제할까요?`)) return;
    setBusy(true);
    try {
      await jsonPost("/api/admin/products", { action: "delete", id: draft.id });
      await onSaved();
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "상품 삭제에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="editor-backdrop" onMouseDown={(e) => { if (e.currentTarget === e.target && !busy) onClose(); }}>
      <section className="product-editor" role="dialog" aria-modal="true">
        <div className="editor-head">
          <div><p>{creating ? "새 상품" : "상품 수정"}</p><h2>{draft.name || "상품 정보 입력"}</h2></div>
          <button type="button" onClick={onClose} disabled={busy}>×</button>
        </div>
        <div className="editor-grid">
          <label>상품명<input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
          <label>규격
            <span className="unit-input-wrap">
              <input
                inputMode="decimal"
                value={unitInputValue(draft.unit)}
                onChange={(e) => setDraft({ ...draft, unit: kgUnitFromInput(e.target.value) })}
                placeholder="예: 5 / 0.5"
              />
              <b>kg</b>
            </span>
            <small className="field-help">숫자만 입력하면 kg가 자동으로 붙습니다. 500g은 0.5로 입력하세요.</small>
          </label>
          <label>카테고리
            <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value, sub: categories[e.target.value]?.[0] ?? "" })}>
              {categoryNames.map((name) => <option key={name}>{name}</option>)}
            </select>
          </label>
          <label>세부 카테고리
            <select value={draft.sub} onChange={(e) => setDraft({ ...draft, sub: e.target.value })}>
              {(categories[draft.category] ?? []).map((name) => <option key={name}>{name}</option>)}
            </select>
          </label>
          <label className="editor-photo">상품 사진
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)} />
            <small>JPG·PNG·WebP, 최대 5MB</small>
          </label>
          <label className="soldout-check"><input type="checkbox" checked={draft.soldout} onChange={(e) => setDraft({ ...draft, soldout: e.target.checked })} /> 품절로 표시</label>
        </div>

        <div className="option-editor">
          <div className="option-head">
            <strong>판매 단위와 가격</strong>
            <button type="button" onClick={() => setDraft({ ...draft, packOptions: [...draft.packOptions, { label: "박스", price: null, step: 1 }] })}>+ 단위 추가</button>
          </div>
          {draft.packOptions.map((option, index) => (
            <div className="option-row" key={index}>
              <label>단위<input value={option.label} onChange={(e) => updateOption(index, { label: e.target.value })} /></label>
              <label>가격<input inputMode="numeric" value={option.price ?? ""} placeholder="가격 문의" onChange={(e) => updateOption(index, { price: e.target.value === "" ? null : Number(e.target.value) })} /></label>
              <label>수량 간격<input inputMode="decimal" value={option.step} onChange={(e) => updateOption(index, { step: Number(e.target.value || 1) })} /></label>
              <button type="button" onClick={() => setDraft({ ...draft, packOptions: draft.packOptions.filter((_, i) => i !== index) })}>삭제</button>
            </div>
          ))}
        </div>

        <div className="editor-actions">
          {!creating && <button type="button" className="danger" onClick={remove} disabled={busy}>상품 삭제</button>}
          <span />
          <button type="button" onClick={onClose} disabled={busy}>취소</button>
          <button type="button" className="admin-primary" onClick={save} disabled={busy}>{busy ? "저장 중" : "저장"}</button>
        </div>
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
    packOptions: [{ label: "박스", price: null, step: 1 }, { label: "봉지", price: null, step: 1 }],
  };
}

function displayPrice(product: Product) {
  const prices = product.packOptions.map((option) => option.price).filter((price): price is number => price !== null);
  if (!prices.length) return "가격 문의";
  return `${new Intl.NumberFormat("ko-KR").format(Math.min(...prices))}원`;
}
