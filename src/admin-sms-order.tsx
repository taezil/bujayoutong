// 관리자 '주문발주 입력': 식당 문자를 붙여넣으면 거래처·품목·수량을 찾아 주문 목록에 담아줌.
// 못 찾은 품목을 직접 고르면 연관어로 저장 → 다음부터 자동으로 찾음.
import { useMemo, useState } from "react";
import type { Product, StoreData } from "./lib/db.server";
import { normalizeAlias, normalizeName, pickOption, readSms, type SmsAlias, type SmsCustomer, type SmsLine } from "./lib/sms-order";

type Row = SmsLine & { key: string; picked: boolean; saved?: "saving" | "ok" | "fail" };
export type SmsItem = { productId: string; productName: string; optionLabel: string; quantity: number };

async function post<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/admin/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "요청을 처리하지 못했습니다.");
  return data;
}

function ProductSearch({ products, onPick, placeholder }: { products: Product[]; onPick: (p: Product) => void; placeholder: string }) {
  const [q, setQ] = useState("");
  const needle = normalizeName(q);
  const list = needle
    ? products.filter((p) => normalizeName(p.name).includes(needle))
        .sort((a, b) => Number(!normalizeName(a.name).startsWith(needle)) - Number(!normalizeName(b.name).startsWith(needle)))
        .slice(0, 8)
    : [];
  return (
    <div className="sms-search">
      <input value={q} placeholder={placeholder} onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && list[0]) { e.preventDefault(); onPick(list[0]); setQ(""); } }} />
      {list.length > 0 && <div className="sms-search-list">
        {list.map((p) => <button type="button" key={p.id} onMouseDown={(e) => e.preventDefault()} onClick={() => { onPick(p); setQ(""); }}>
          <b>{p.name}</b><small>{p.category}{p.sub ? ` · ${p.sub}` : ""}{p.soldout ? " · 품절" : ""}</small>
        </button>)}
      </div>}
    </div>
  );
}

export function SmsOrderPaste({ store, customers, customerId, onCustomer, onAdd, onError }: {
  store: StoreData;
  customers: SmsCustomer[];
  customerId: string;
  onCustomer: (id: string) => void;
  onAdd: (items: SmsItem[]) => void;
  onError: (message: string) => void;
}) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [aliases, setAliases] = useState<Array<SmsAlias & { useCount?: number }>>([]);
  const [showAliases, setShowAliases] = useState(false);
  const [readFor, setReadFor] = useState("");
  const [newWord, setNewWord] = useState("");
  const [newProduct, setNewProduct] = useState<Product | null>(null);
  const byId = useMemo(() => new Map(store.products.map((p) => [p.id, p])), [store.products]);
  const selectable = useMemo(() => store.products.filter((p) => !p.hidden), [store.products]);

  async function read() {
    if (!text.trim()) return;
    setBusy(true);
    onError("");
    try {
      // 1) 거래처 먼저 찾고, 그 거래처 주문이력·연관어로 품목 맞추기
      const first = readSms(text, customers, { products: store.products, aliases: [], history: new Map() });
      const targetId = first.customerId || customerId;
      const ctx = await post<{ aliases: Array<SmsAlias & { useCount: number }>; history: Array<{ productId: string; count: number }> }>({ action: "sms-context", customerId: targetId });
      setAliases(ctx.aliases);
      setReadFor(targetId);
      const result = readSms(text, customers, { products: store.products, aliases: ctx.aliases, history: new Map(ctx.history.map((h) => [h.productId, h.count])), customerId: targetId });
      if (first.customerId && first.customerId !== customerId) onCustomer(first.customerId);
      const found = first.customer;
      setNote(
        first.customerId ? `거래처: ${customers.find((c) => c.id === first.customerId)?.name ?? ""} (문자 첫 줄 '${found.label}')`
          : found.label ? `'${found.label}' 거래처를 찾지 못했습니다. 위에서 거래처를 직접 고르세요.`
          : "문자에 거래처 번호가 없어 위에서 고른 거래처로 넣습니다.",
      );
      setRows(result.lines.map((line, i) => ({ ...line, key: `${Date.now()}-${i}`, picked: false })));
      const used = result.lines.filter((l) => l.status === "auto" && l.candidates[0]?.why === "연관어").map((l) => ({ alias: normalizeAlias(l.query), customerId: aliasOwner(ctx.aliases, normalizeAlias(l.query), targetId) }));
      if (used.length) void post({ action: "alias-used", aliases: used }).catch(() => undefined);
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "문자를 읽지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  function aliasOwner(list: SmsAlias[], alias: string, cid: string) {
    return list.some((a) => a.alias === alias && a.customerId === cid) ? cid : "";
  }

  function update(key: string, patch: Partial<Row>) {
    setRows((current) => current.map((row) => row.key === key ? { ...row, ...patch } : row));
  }

  // 직접 고르면 바로 연관어로 저장 (주문 접수를 안 해도 학습됨)
  async function choose(row: Row, product: Product) {
    const optionLabel = pickOption(product, row.unitWord);
    const alias = normalizeAlias(row.query);
    update(row.key, { productId: product.id, optionLabel, picked: true, status: "auto", saved: alias ? "saving" : undefined });
    if (!alias) return;
    try {
      await post({ action: "alias-save", alias, productId: product.id, optionLabel, customerId: readFor || customerId });
      update(row.key, { saved: "ok" });
      setAliases((current) => [...current.filter((a) => !(a.alias === alias && a.customerId === "")), { alias, customerId: "", productId: product.id, optionLabel }]);
    } catch {
      update(row.key, { saved: "fail" });
    }
  }

  async function addAlias() {
    const alias = normalizeAlias(newWord);
    if (!alias || !newProduct) return;
    try {
      await post({ action: "alias-save", alias, productId: newProduct.id, optionLabel: pickOption(newProduct, ""), customerId: "" });
      setNewWord("");
      setNewProduct(null);
      await loadAliases();
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "연관어를 저장하지 못했습니다.");
    }
  }

  async function addAll() {
    const ready = rows.filter((row) => row.productId && row.quantity > 0);
    const skipped = rows.length - ready.length;
    if (!ready.length) { onError("담을 품목이 없습니다. 상품을 골라 주세요."); return; }
    const toSave = ready.filter((row) => row.saved === "ok");
    onAdd(ready.map((row) => ({ productId: row.productId, productName: byId.get(row.productId)?.name ?? "", optionLabel: row.optionLabel, quantity: row.quantity })));
    setRows([]);
    setText("");
    setNote(`${ready.length}개 품목을 담았습니다.${toSave.length ? ` (연관어 ${toSave.length}개는 고를 때 이미 저장됨)` : ""}${skipped ? ` 상품을 고르지 않은 ${skipped}개는 빠졌습니다.` : ""}`);
  }

  async function loadAliases() {
    try {
      const ctx = await post<{ aliases: Array<SmsAlias & { useCount: number }> }>({ action: "sms-context", customerId: "" });
      setAliases(ctx.aliases);
      setShowAliases(true);
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "연관어를 불러오지 못했습니다.");
    }
  }

  async function removeAlias(alias: SmsAlias) {
    if (!window.confirm(`연관어 '${alias.alias}' → ${byId.get(alias.productId)?.name ?? alias.productId} 를 지울까요?`)) return;
    await post({ action: "alias-delete", alias: alias.alias, customerId: alias.customerId });
    setAliases((current) => current.filter((a) => !(a.alias === alias.alias && a.customerId === alias.customerId)));
  }

  const counts = { auto: rows.filter((r) => r.productId && r.status === "auto").length, pick: rows.filter((r) => r.status === "pick").length, none: rows.filter((r) => !r.productId).length };
  const customerName = (id: string) => customers.find((c) => c.id === id)?.name ?? "";

  return (
    <div className="sms-paste">
      <div className="sms-paste-head">
        <b>📩 문자 붙여넣기</b>
        <span>식당 문자를 그대로 붙여넣으면 거래처·품목·수량을 찾아 드립니다.</span>
        <button type="button" className="sms-alias-btn" onClick={() => void (showAliases ? setShowAliases(false) : loadAliases())}>{showAliases ? "연관어 닫기" : "연관어 관리"}</button>
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3}
        placeholder={"예)\n130-14\n숙성지2.칼집비엔나6봉.코다리1.동전어묵1봉.모듬해물2개.부탄까스1박스요"} />
      <div className="sms-paste-actions">
        <button type="button" className="admin-primary" disabled={busy || !text.trim()} onClick={() => void read()}>{busy ? "읽는 중…" : "문자 읽기"}</button>
        {note && <span className="sms-note">{note}</span>}
      </div>

      {rows.length > 0 && (
        <div className="sms-rows">
          <div className="sms-summary">✅ 자동 {counts.auto} · 🟡 확인 {counts.pick} · 🔴 못 찾음 {counts.none}</div>
          {rows.map((row) => {
            const product = byId.get(row.productId);
            return (
              <div className={`sms-row s-${row.productId ? row.status : "none"}`} key={row.key}>
                <div className="sms-raw"><span className="sms-badge">{!row.productId ? "🔴" : row.status === "auto" ? "✅" : "🟡"}</span><code>{row.raw}</code>
                  {product?.soldout && <em className="sms-flag">품절 상품</em>}
                  {!row.quantityGiven && <em className="sms-flag q">수량 확인 (문자에 수량 없음)</em>}</div>
                <div className="sms-product">
                  {row.candidates.length > 0 && (
                    <select value={row.productId} onChange={(e) => { const p = byId.get(e.target.value); if (p) void choose(row, p); else update(row.key, { productId: "", optionLabel: "" }); }}>
                      {!row.productId && <option value="">— 상품 고르기 —</option>}
                      {row.productId && !row.candidates.some((c) => c.product.id === row.productId) && product && <option value={product.id}>{product.name}</option>}
                      {row.candidates.map((c) => <option key={c.product.id} value={c.product.id}>{c.product.name}{c.product.soldout ? " (품절)" : ""} · {c.why}</option>)}
                    </select>
                  )}
                  <ProductSearch products={selectable} onPick={(p) => void choose(row, p)} placeholder={row.candidates.length ? "다른 상품 검색" : `'${row.query}' 상품 검색해서 고르기`} />
                  {row.picked && <small className={`sms-learn${row.saved === "fail" ? " fail" : ""}`}>'{normalizeAlias(row.query)}' → {product?.name} {row.saved === "ok" ? "연관어 저장됨 ✓ (다음부터 자동)" : row.saved === "fail" ? "연관어 저장 실패 — 다시 골라 주세요" : "연관어 저장 중…"}</small>}
                </div>
                <div className="sms-qty">
                  <input type="number" min="0" step="any" value={row.quantity} onChange={(e) => update(row.key, { quantity: Math.max(0, Number(e.target.value || 0)), quantityGiven: true })} />
                  <select value={row.optionLabel} disabled={!product} onChange={(e) => update(row.key, { optionLabel: e.target.value })}>
                    {(product?.packOptions ?? []).map((o) => <option key={o.label}>{o.label}</option>)}
                  </select>
                </div>
                <button type="button" className="sms-del" aria-label="이 줄 빼기" onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}>×</button>
              </div>
            );
          })}
          <div className="sms-paste-actions">
            <button type="button" className="admin-primary" onClick={() => void addAll()}>주문 목록에 담기 ({rows.filter((r) => r.productId && r.quantity > 0).length}개)</button>
            {counts.none > 0 && <span className="sms-note warn">🔴 상품을 안 고른 줄은 빠집니다</span>}
            {rows.some((r) => byId.get(r.productId)?.soldout) && <span className="sms-note warn">품절 상품이 들어 있습니다. 다른 상품으로 바꾸거나 × 로 빼세요.</span>}
          </div>
        </div>
      )}

      {showAliases && (
        <div className="sms-aliases">
          <b>연관어 {aliases.length}개</b> <small>문자에서 직접 고른 상품이 바로 저장됩니다. 주문 없이 여기서 미리 가르칠 수도 있습니다.</small>
          <div className="sms-alias-add">
            <input value={newWord} placeholder="문자에 쓰는 말 (예: 동전어묵)" onChange={(e) => setNewWord(e.target.value)} />
            {newProduct
              ? <span className="sms-alias-picked">→ <b>{newProduct.name}</b> <button type="button" onClick={() => setNewProduct(null)}>바꾸기</button></span>
              : <ProductSearch products={selectable} onPick={setNewProduct} placeholder="연결할 상품 검색" />}
            <button type="button" className="admin-primary" disabled={!normalizeAlias(newWord) || !newProduct} onClick={() => void addAlias()}>연관어 저장</button>
          </div>
          <ul>
            {aliases.map((a) => <li key={`${a.alias}|${a.customerId}`}>
              <code>{a.alias}</code> → {byId.get(a.productId)?.name ?? "(삭제된 상품)"} <small>{a.customerId ? customerName(a.customerId) : "모든 거래처"}{a.useCount ? ` · ${a.useCount}회` : ""}</small>
              <button type="button" onClick={() => void removeAlias(a)}>삭제</button>
            </li>)}
            {!aliases.length && <li>아직 저장된 연관어가 없습니다.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
