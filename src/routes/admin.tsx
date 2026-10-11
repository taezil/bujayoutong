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

type AdminStatus = { setupRequired: boolean; authenticated: boolean; staff?: { id: string; username: string; displayName: string; role: "ADMIN" | "DRIVER" } | null };

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

const WAREHOUSE_ZONES = ["미지정", "냉동식품창고", "냉동수산창고", "냉동축산창고", "냉장창고", "김치창고", "건어물창고", "공산품창고", "상온창고"];

function AdminPage() {
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [store, setStore] = useState<StoreData | null>(null);
  const [error, setError] = useState("");
  const [setupKey, setSetupKey] = useState("");
  const [password, setPassword] = useState("");
  const [staffUsername, setStaffUsername] = useState("");
  const [staffPin, setStaffPin] = useState("");
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

  async function staffLogin(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const response = await fetch("/api/staff/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: staffUsername, pin: staffPin }) });
      const data = await response.json() as { error?: string; staff?: { role: string } };
      if (!response.ok) throw new Error(data.error || "로그인에 실패했습니다.");
      if (data.staff?.role !== "ADMIN") { await fetch("/api/staff/logout", { method: "POST" }); throw new Error("이 계정은 관리자 권한이 없습니다. 배송기사 앱을 이용해 주세요."); }
      setStaffPin("");
      await loadStatus();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "로그인에 실패했습니다."); }
  }

  async function logout() {
    await jsonPost("/api/admin/logout", {});
    setStore(null);
    setStatus({ setupRequired: false, authenticated: false, staff: null });
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
        <div className="admin-auth-card staff-admin-login">
          <h1>관리자 로그인</h1>
          <p>사무실 직원은 개인 아이디와 6자리 PIN으로 로그인합니다.</p>
          <form onSubmit={staffLogin}>
            <label>직원 아이디<input value={staffUsername} onChange={(e) => setStaffUsername(e.target.value)} autoComplete="username" placeholder="예: lee" /></label>
            <label>6자리 PIN<input type="password" inputMode="numeric" value={staffPin} onChange={(e) => setStaffPin(e.target.value.replace(/\D/g, "").slice(0, 6))} autoComplete="current-password" /></label>
            <button type="submit" disabled={!staffUsername.trim() || staffPin.length !== 6}>직원 로그인</button>
          </form>
          <details className="legacy-admin-login"><summary>기존 관리자 비밀번호로 로그인</summary><form onSubmit={login}><label>관리자 비밀번호<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label><button type="submit">기존 관리자 로그인</button></form></details>
          {error && <p className="form-error">{error}</p>}
        </div>
      </AdminShell>
    );
  }

  if (!store) return <AdminShell><p className="admin-loading">상품을 불러오는 중입니다.</p></AdminShell>;

  return (
    <AdminShell>
      <div className="admin-workspace">
        <aside className="admin-side admin-side-left"><SupplierPanel onError={setError} /></aside>
        <div className="admin-dashboard">
        <div className="admin-titlebar">
          <div><p>부자유통{status.staff ? ` · ${status.staff.displayName}` : ""}</p><h1>통합 관리자</h1><span>상품 {store.products.length}개 · 주문/거래처/재고 통합관리 · 버전 {store.version}</span></div>
          <div className="admin-top-actions"><a href="/dashboard">대시보드</a><a href="/driver" target="_blank" rel="noreferrer">배송기사 화면</a><a href="/" target="_blank" rel="noreferrer">고객 화면</a><button type="button" onClick={logout}>로그아웃</button></div>
        </div>
        {error && <p className="admin-banner-error">{error}</p>}
        <OrderOpsPanel store={store} onError={setError} />
        <CustomerOpsPanel onError={setError} />
        <StaffOpsPanel onError={setError} />
        <InventoryOpsPanel onError={setError} storeVersion={store.version} />
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
        <aside className="admin-side admin-side-right"><AuditPanel /></aside>
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
          <label>과세 구분
            <select value={draft.taxType ?? "taxable"} onChange={(e) => setDraft({ ...draft, taxType: e.target.value === "exempt" ? "exempt" : "taxable" })}>
              <option value="taxable">과세</option><option value="exempt">면세(비과세)</option>
            </select>
          </label>
          <label>창고 위치
            <select value={draft.warehouseZone || "미지정"} onChange={(e) => setDraft({ ...draft, warehouseZone: e.target.value === "미지정" ? "" : e.target.value })}>
              {draft.warehouseZone && !WAREHOUSE_ZONES.includes(draft.warehouseZone) && <option value={draft.warehouseZone}>{draft.warehouseZone}</option>}
              {WAREHOUSE_ZONES.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
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
            <button type="button" onClick={() => setDraft({ ...draft, packOptions: [...draft.packOptions, { label: "박스", price: null, priceA: null, priceB: null, step: 1 }] })}>+ 단위 추가</button>
          </div>
          {draft.packOptions.map((option, index) => (
            <div className="option-row" key={index}>
              <label>단위<input value={option.label} onChange={(e) => updateOption(index, { label: e.target.value })} /></label>
              <label>기본가격<input inputMode="numeric" value={option.price ?? ""} placeholder="가격 문의" onChange={(e) => updateOption(index, { price: e.target.value === "" ? null : Number(e.target.value) })} /></label>
              <label>A그룹 가격<input inputMode="numeric" value={option.priceA ?? ""} placeholder="기본가 사용" onChange={(e) => updateOption(index, { priceA: e.target.value === "" ? null : Number(e.target.value) })} /></label>
              <label>B그룹 가격<input inputMode="numeric" value={option.priceB ?? ""} placeholder="기본가 사용" onChange={(e) => updateOption(index, { priceB: e.target.value === "" ? null : Number(e.target.value) })} /></label>
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
    taxType: "taxable",
    warehouseZone: "",
    packOptions: [{ label: "박스", price: null, priceA: null, priceB: null, step: 1 }, { label: "봉지", price: null, priceA: null, priceB: null, step: 1 }],
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
  deliveryDate: string; isAdditional: boolean; createdByStaffName: string;
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
    <section className="admin-section ops-section">
      <div className="admin-section-head">
        <div><h2>거래처 · 미수금</h2><p>거래처 로그인, 지역, 가격그룹, 미수금과 입금을 관리합니다.</p></div>
        <div className="ops-metric"><b>{customers.length}</b><span>거래처</span><b>{new Intl.NumberFormat("ko-KR").format(totalReceivable)}원</b><span>총 미수</span></div>
      </div>
      <div className="customer-create-grid">
        <input placeholder="거래처번호 예: 8-18" value={code} onChange={(e) => setCode(e.target.value)} />
        <input placeholder="거래처명" value={name} onChange={(e) => setName(e.target.value)} />
        <input placeholder="지역 예: 1단지" value={region} onChange={(e) => setRegion(e.target.value)} />
        <input placeholder="가게 전화번호" value={storePhone} onChange={(e) => setStorePhone(e.target.value)} />
        <input className="customer-business-number" placeholder="사업자번호" value={businessNumber} onChange={(e) => setBusinessNumber(e.target.value)} />
        <input className="customer-address" placeholder="가게 주소" value={address} onChange={(e) => setAddress(e.target.value)} />
        <select value={priceGroup} onChange={(e) => setPriceGroup(e.target.value)}><option value="A">가격 A그룹</option><option value="B">가격 B그룹</option></select>
        <input placeholder="최초 인증번호 6자리" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))} />
        <button className="admin-primary" type="button" onClick={() => void create()} disabled={!code.trim() || !name.trim() || pin.length !== 6}>+ 거래처 추가</button>
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
  const [source, setSource] = useState("phone");
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
      if (!customerId && list[0]) setCustomerId(list[0].id);
    }
  }
  useEffect(() => { void load(); }, []);
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
    const response = await fetch("/api/admin/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create-order", customerId, source, deliveryDate, confirmAnomaly, items: manualItems.map((i) => ({ productId: i.productId, optionLabel: i.optionLabel, quantity: i.quantity })) }) });
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
    ? store.products.filter((p) => `${p.name} ${p.category} ${p.sub}`.toLowerCase().replace(/\s+/g, "").includes(productNeedle)).slice(0, 10)
    : [];

  function selectManualProduct(nextProduct: Product) {
    setProductId(nextProduct.id);
    setProductSearch(nextProduct.name);
    setOptionLabel(nextProduct.packOptions[0]?.label ?? "");
    setProductPickerOpen(false);
  }

  return (
    <section className="admin-section ops-section">
      <div className="admin-section-head"><div><h2>주문 · 전표출력 · 출고</h2><p>앱/전화/문자 주문을 한 곳에서 처리하고 지역별 신규분만 출력합니다.</p></div><div className="ops-metric"><b>{active.length}</b><span>출고대기</span><b>{active.filter((o) => !o.printedAt).length}</b><span>미출력</span></div></div>

      <div className="region-cards">
        {regions.map((region) => {
          const rows = active.filter((o) => (o.region || "미지정") === region);
          const unprinted = rows.filter((o) => !o.printedAt).length;
          return <div className="region-card" key={region}><div><strong>{region}</strong><span>주문 {rows.length}건 · 신규 {unprinted}건</span></div><div>
            <button type="button" disabled={!unprinted} onClick={() => window.open(`/api/admin/print-orders?region=${encodeURIComponent(region)}&deliveryDate=${encodeURIComponent(deliveryDate)}&unprinted=1`, "_blank")}>신규분 출력</button>
            <button type="button" disabled={!unprinted} onClick={() => { if (window.confirm(`${region} 신규 주문을 출력완료로 표시할까요?`)) void action({ action: "mark-region-printed", region, deliveryDate }); }}>출력완료</button>
          </div></div>;
        })}
        {!regions.length && <p className="ops-empty">현재 출고대기 주문이 없습니다.</p>}
      </div>

      <div className="manual-order-box">
        <div><h3>전화·문자 주문 대신 입력</h3><p>직원이 이 화면에서 입력하면 앱 주문과 동일하게 재고·미수·전표 흐름에 들어갑니다.</p></div>
        <div className="manual-order-controls">
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>{customers.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select>
          <select value={source} onChange={(e) => setSource(e.target.value)}><option value="phone">전화발주</option><option value="sms">문자발주</option><option value="admin">직접입력</option></select>
          <label className="manual-date"><span>배송일</span><input type="date" value={deliveryDate} min={kstDateLocal(0)} onChange={(e) => setDeliveryDate(e.target.value)} /></label>
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
          <select value={optionLabel} onChange={(e) => setOptionLabel(e.target.value)}>{(product?.packOptions ?? []).map((o) => <option key={o.label}>{o.label}</option>)}</select>
          <div className="manual-qty-unit"><input type="number" min="0" step="1" value={qty} onChange={(e) => setQty(Math.max(0, Math.round(Number(e.target.value || 0))))} /><b>{optionLabel || "단위"}</b></div>
          <button type="button" className="manual-add-item" onClick={addManualItem}>품목 추가</button>
        </div>
        {manualItems.length > 0 && <div className="manual-items">{manualItems.map((item, index) => <span key={`${item.productId}-${index}`}>{item.productName} {item.quantity}{item.optionLabel}<button type="button" onClick={() => setManualItems((x) => x.filter((_, i) => i !== index))}>×</button></span>)}</div>}
        <button className="admin-primary" type="button" disabled={!customerId || !manualItems.length} onClick={() => void createManualOrder(false)}>이 주문 접수</button>
      </div>

      <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>주문</th><th>지역</th><th>품목</th><th>금액</th><th>상태/처리</th></tr></thead><tbody>
        {orders.slice(0, 80).map((o) => <tr key={o.id}>
          <td><b>{o.customerCode} · {o.customerName} {o.isAdditional && <em className="additional-badge">🚨 추가발주</em>}</b><span>배송 {o.deliveryDate || "미지정"} · <strong className="order-period-badge">{orderPeriod(o.createdAt)}</strong> · {o.createdAt} · {o.createdByStaffName || o.source}</span></td><td>{o.region || "미지정"}</td>
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
    <section className="admin-section ops-section">
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
  async function load() { const r = await fetch("/api/admin/audit", { cache: "no-store" }); if (r.ok) setRows(((await r.json()) as { logs: AuditRow[] }).logs); }
  useEffect(() => { void load(); const t = window.setInterval(() => void load(), 30000); return () => window.clearInterval(t); }, []);
  return <div className="side-panel audit-panel"><div className="side-panel-head"><div><p>② 작업기록</p><h2>최근 이력</h2></div><button type="button" onClick={() => void load()}>↻</button></div><div className="audit-list">{rows.slice(0, 30).map((row) => <article key={row.id}><time>{row.created_at.slice(5, 16)}</time><strong>{row.actor_name || "시스템"}</strong><p>{row.summary}</p></article>)}{!rows.length && <p className="side-empty">아직 작업이력이 없습니다.</p>}</div></div>;
}

function StaffOpsPanel({ onError }: { onError: (value: string) => void }) {
  const [rows, setRows] = useState<StaffRow[]>([]);
  async function load() { const r = await fetch("/api/admin/staff", { cache: "no-store" }); if (r.ok) setRows(((await r.json()) as { staff: StaffRow[] }).staff); }
  useEffect(() => { void load(); }, []);
  async function action(body: Record<string, unknown>) { try { onError(""); await jsonPost("/api/admin/staff", body); await load(); } catch (reason) { onError(reason instanceof Error ? reason.message : "직원 계정 작업 실패"); } }
  return <section className="admin-section ops-section"><div className="admin-section-head"><div><h2>직원 계정 · 권한</h2><p>사무실은 전체 관리자, 배송기사는 배송기사 전용 앱을 사용합니다. 아이디와 PIN을 여기서 바로 변경할 수 있습니다.</p></div><div className="ops-metric"><b>{rows.filter((r) => r.role === "ADMIN").length}</b><span>관리자</span><b>{rows.filter((r) => r.role === "DRIVER").length}</b><span>배송기사</span></div></div><div className="staff-account-grid">{rows.map((row) => <article key={row.id} className={!Boolean(row.active) ? "disabled" : ""}><div><span className={`role-${row.role.toLowerCase()}`}>{row.role === "ADMIN" ? "관리자" : "배송기사"}</span><strong>{row.display_name}</strong><small>아이디 {row.username}</small></div><div><button type="button" onClick={() => { const username = window.prompt(`${row.display_name} 새 아이디`, row.username); if (username && username.trim() !== row.username) void action({ action: "update-username", id: row.id, username: username.trim() }); }}>아이디 변경</button><button type="button" onClick={() => { const pin = window.prompt(`${row.display_name} 새 6자리 PIN`); if (pin) void action({ action: "reset-pin", id: row.id, pin }); }}>PIN 변경</button><button type="button" onClick={() => void action({ action: "toggle", id: row.id, active: !Boolean(row.active) })}>{Boolean(row.active) ? "계정중지" : "사용"}</button></div></article>)}</div></section>;
}
