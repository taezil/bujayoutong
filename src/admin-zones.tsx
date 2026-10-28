import { useCallback, useEffect, useMemo, useState } from "react";
import type { StoreData } from "./lib/db.server";
import { DEFAULT_RULE, parseRuns, slotChoices, type DeliveryRule } from "./lib/delivery-rules";

/* 관리자: 구역·배송 마감 / 창고 위치 화면 (주문 처리 기능 없음) */

type Zone = { name: string; sortOrder: number; amUntil: string; pmRuns: string; customerCount: number };
type Location = { name: string; sortOrder: number; storage: string; productCount: number };
type Defaults = { openFrom: string; sameDayCutoff: string; amUntil: string; pmRuns: string[] };
type CustomerRow = { id: string; code: string; name: string; region: string; active: boolean };
type ZonesData = { zones: Zone[]; locations: Location[]; defaults: Defaults; customers: CustomerRow[] };

type Props = { onError: (value: string) => void; onNotice: (value: string) => void };

export const STORAGE_LABEL: Record<string, string> = { frozen: "❄ 냉동", chilled: "🧊 냉장", dry: "📦 공산품" };

async function post(body: Record<string, unknown>) {
  const response = await fetch("/api/admin/zones", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({})) as { error?: string; message?: string };
  if (!response.ok) throw new Error(data.error || "저장하지 못했습니다.");
  return data.message ?? "저장했습니다.";
}

function useZonesData(onError: (value: string) => void) {
  const [data, setData] = useState<ZonesData | null>(null);
  const load = useCallback(async () => {
    const response = await fetch("/api/admin/zones", { cache: "no-store" });
    if (!response.ok) throw new Error("구역 정보를 불러오지 못했습니다.");
    setData(await response.json() as ZonesData);
  }, []);
  useEffect(() => { void load().catch((reason) => onError(reason instanceof Error ? reason.message : String(reason))); }, [load, onError]);
  return { data, load };
}

function normalize(value: string) {
  return value.toLocaleLowerCase("ko-KR").replace(/\s+/g, "");
}

function hm(time: string) {
  const [h, m] = time.split(":").map(Number);
  const text = h < 12 ? `오전 ${h || 12}시` : h === 12 ? "낮 12시" : `오후 ${h - 12}시`;
  return m ? `${text} ${m}분` : text;
}

/** 구역 규칙 설명 한 줄 (관리자 확인용) */
export function ruleSummary(rule: DeliveryRule) {
  const runs = rule.pmRuns.length > 1
    ? rule.pmRuns.map((time, index) => `${hm(time)} 전 → ${index + 1}차`).join(", ")
    : `${hm(rule.pmRuns[0])} 전 주문`;
  return `오늘 배송 ${hm(rule.openFrom)}~${hm(rule.sameDayCutoff)} 주문 · 오전 배송 ${hm(rule.amUntil)} 전 주문 · 오후 배송 ${runs}`;
}

export function ZonesView({ onError, onNotice }: Props) {
  const { data, load } = useZonesData(onError);
  const [busy, setBusy] = useState(false);
  const [defaults, setDefaults] = useState({ openFrom: "", sameDayCutoff: "", amUntil: "", pmRuns: "" });
  const [edits, setEdits] = useState<Record<string, { amUntil: string; pmRuns: string }>>({});
  const [newZone, setNewZone] = useState("");
  const [filter, setFilter] = useState("__all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState("");

  useEffect(() => {
    if (!data) return;
    setDefaults({ openFrom: data.defaults.openFrom, sameDayCutoff: data.defaults.sameDayCutoff, amUntil: data.defaults.amUntil, pmRuns: data.defaults.pmRuns.join(", ") });
    setEdits(Object.fromEntries(data.zones.map((zone) => [zone.name, { amUntil: zone.amUntil, pmRuns: zone.pmRuns.split(",").filter(Boolean).join(", ") }])));
    setTarget((current) => current || data.zones[0]?.name || "");
  }, [data]);

  async function run(body: Record<string, unknown>, after?: () => void) {
    setBusy(true);
    try {
      onError("");
      onNotice(await post(body));
      after?.();
      await load();
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const customers = useMemo(() => {
    if (!data) return [];
    const needle = normalize(query);
    return data.customers.filter((row) => {
      if (filter === "__none" && row.region && data.zones.some((zone) => zone.name === row.region)) return false;
      if (filter !== "__all" && filter !== "__none" && row.region !== filter) return false;
      return !needle || normalize(`${row.code}${row.name}${row.region}`).includes(needle);
    });
  }, [data, filter, query]);

  if (!data) return <section className="adm-panel"><p className="admin-loading">구역 정보를 불러오는 중입니다.</p></section>;
  const zoneNames = data.zones.map((zone) => zone.name);
  const unassigned = data.customers.filter((row) => row.active && !zoneNames.includes(row.region)).length;
  const base: DeliveryRule = { ...DEFAULT_RULE, openFrom: data.defaults.openFrom, sameDayCutoff: data.defaults.sameDayCutoff, amUntil: data.defaults.amUntil, pmRuns: data.defaults.pmRuns };
  const visibleIds = customers.map((row) => row.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));

  return (
    <section className="adm-panel adm-zones">
      <div className="adm-head">
        <div><h1>구역 · 배송 마감</h1><p>거래처를 구역으로 묶고, 구역마다 오전/오후(1차·2차) 배송 마감 시각을 정합니다. 주문은 24시간 받고, 마감이 지나면 거래처 달력에서 그 배송만 막힙니다.</p></div>
      </div>

      <div className="adm-zone-card">
        <h2>기본 마감 시각 <small>구역 칸을 비워 두면 이 값을 씁니다</small></h2>
        <div className="adm-zone-grid">
          <label className="adm-field">오늘 배송 주문 시작<input value={defaults.openFrom} onChange={(e) => setDefaults({ ...defaults, openFrom: e.target.value })} placeholder="01:00" /></label>
          <label className="adm-field">오늘 배송 마감<input value={defaults.sameDayCutoff} onChange={(e) => setDefaults({ ...defaults, sameDayCutoff: e.target.value })} placeholder="15:00" /></label>
          <label className="adm-field">오전 배송 마감<input value={defaults.amUntil} onChange={(e) => setDefaults({ ...defaults, amUntil: e.target.value })} placeholder="10:00" /></label>
          <label className="adm-field">오후 차수 마감<input value={defaults.pmRuns} onChange={(e) => setDefaults({ ...defaults, pmRuns: e.target.value })} placeholder="15:00" /></label>
        </div>
        <p className="adm-help">오늘 배송 마감이 지나면 달력에서 ‘오늘’이 막히고 내일부터 고를 수 있습니다. 내일 이후 날짜(예약·전날 주문)는 언제나 오전/오후 모두 가능합니다.</p>
        <button type="button" className="adm-primary" disabled={busy} onClick={() => void run({ action: "defaults-save", ...defaults })}>기본값 저장</button>
      </div>

      <div className="adm-zone-card">
        <h2>구역 <small>위에서부터 상차준비표 구역 순서 · 구역 미지정 거래처 {unassigned}곳</small></h2>
        <div className="adm-zone-list">
          {data.zones.map((zone, index) => {
            const edit = edits[zone.name] ?? { amUntil: "", pmRuns: "" };
            const rule: DeliveryRule = { ...base, zone: zone.name, amUntil: edit.amUntil.trim() || base.amUntil, pmRuns: edit.pmRuns.trim() ? parseRuns(edit.pmRuns, base.pmRuns) : base.pmRuns };
            const sample = slotChoices(rule, "2999-01-01").find((choice) => choice.slot === "PM");
            return (
              <article className="adm-zone" key={zone.name}>
                <div className="adm-zone-title">
                  <strong>{zone.name}</strong><span>거래처 {zone.customerCount}곳</span>
                  <div className="adm-cat-actions">
                    <button type="button" disabled={busy || index === 0} onClick={() => { const names = [...zoneNames]; [names[index - 1], names[index]] = [names[index], names[index - 1]]; void run({ action: "zone-order", names }); }}>▲</button>
                    <button type="button" disabled={busy || index === data.zones.length - 1} onClick={() => { const names = [...zoneNames]; [names[index + 1], names[index]] = [names[index], names[index + 1]]; void run({ action: "zone-order", names }); }}>▼</button>
                    <button type="button" disabled={busy} onClick={() => { const next = window.prompt("새 구역 이름", zone.name); if (next && next.trim() && next.trim() !== zone.name) void run({ action: "zone-rename", name: zone.name, newName: next.trim() }); }}>이름변경</button>
                    <button type="button" className="danger" disabled={busy} onClick={() => { if (window.confirm(`‘${zone.name}’ 구역을 삭제할까요? 이 구역 거래처 ${zone.customerCount}곳은 ‘구역 미지정’이 됩니다.`)) void run({ action: "zone-delete", name: zone.name }); }}>삭제</button>
                  </div>
                </div>
                <div className="adm-zone-grid two">
                  <label className="adm-field">오전 배송 마감<input value={edit.amUntil} placeholder={`기본 ${base.amUntil}`} onChange={(e) => setEdits({ ...edits, [zone.name]: { ...edit, amUntil: e.target.value } })} /></label>
                  <label className="adm-field">오후 차수 마감 <small className="adm-field-hint">예: 13:00, 15:00 → 1차·2차</small><input value={edit.pmRuns} placeholder={`기본 ${base.pmRuns.join(", ")}`} onChange={(e) => setEdits({ ...edits, [zone.name]: { ...edit, pmRuns: e.target.value } })} /></label>
                  <button type="button" className="adm-ghost" disabled={busy} onClick={() => void run({ action: "zone-save", name: zone.name, amUntil: edit.amUntil, pmRuns: edit.pmRuns })}>저장</button>
                </div>
                <p className="adm-zone-rule">{ruleSummary(rule)}{sample && rule.pmRuns.length > 1 ? " · 예약 주문 오후는 1차" : ""}</p>
              </article>
            );
          })}
        </div>
        <div className="adm-inline-add">
          <input value={newZone} onChange={(e) => setNewZone(e.target.value)} placeholder="새 구역 이름 예: 서구" />
          <button type="button" className="adm-primary" disabled={busy || !newZone.trim()} onClick={() => void run({ action: "zone-add", name: newZone.trim() }, () => setNewZone(""))}>구역 추가</button>
        </div>
      </div>

      <div className="adm-zone-card">
        <h2>거래처 구역 지정 <small>체크한 거래처를 한 번에 옮깁니다</small></h2>
        <div className="adm-zone-toolbar">
          <select value={filter} onChange={(e) => { setFilter(e.target.value); setSelected(new Set()); }}>
            <option value="__all">전체 거래처</option>
            <option value="__none">구역 미지정</option>
            {zoneNames.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="거래처 이름·코드 검색" />
          <span className="adm-zone-move">
            선택 {selected.size}곳 →
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              {zoneNames.map((name) => <option key={name} value={name}>{name}</option>)}
              <option value="">구역 미지정</option>
            </select>
            <button type="button" className="adm-primary" disabled={busy || !selected.size}
              onClick={() => void run({ action: "assign", customerIds: Array.from(selected), zone: target }, () => setSelected(new Set()))}>옮기기</button>
          </span>
        </div>
        <div className="adm-zone-customers">
          <label className="adm-zone-customer head">
            <input type="checkbox" checked={allVisibleSelected} onChange={(e) => {
              const next = new Set(selected);
              for (const id of visibleIds) { if (e.target.checked) next.add(id); else next.delete(id); }
              setSelected(next);
            }} />
            <span>보이는 거래처 모두 선택 ({customers.length}곳)</span>
          </label>
          {customers.slice(0, 400).map((row) => (
            <label key={row.id} className={`adm-zone-customer ${row.active ? "" : "inactive"}`}>
              <input type="checkbox" checked={selected.has(row.id)} onChange={(e) => {
                const next = new Set(selected);
                if (e.target.checked) next.add(row.id); else next.delete(row.id);
                setSelected(next);
              }} />
              <span className="name">{row.name}<small>{row.code}{row.active ? "" : " · 사용중지"}</small></span>
              <em className={zoneNames.includes(row.region) ? "" : "none"}>{zoneNames.includes(row.region) ? row.region : row.region ? `${row.region} (없는 구역)` : "미지정"}</em>
            </label>
          ))}
          {customers.length > 400 && <p className="adm-help">앞의 400곳만 보입니다. 검색으로 좁혀 주세요.</p>}
        </div>
      </div>
    </section>
  );
}

export function LocationsView({ store, onReload, onError, onNotice }: Props & { store: StoreData; onReload: () => Promise<void> }) {
  const { data, load } = useZonesData(onError);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [newStorage, setNewStorage] = useState("frozen");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState("");

  useEffect(() => { if (data && !target) setTarget(data.locations[0]?.name ?? ""); }, [data, target]);

  async function run(body: Record<string, unknown>, after?: () => void, reloadStore = false) {
    setBusy(true);
    try {
      onError("");
      onNotice(await post(body));
      after?.();
      await load();
      if (reloadStore) await onReload();
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const products = useMemo(() => {
    const needle = normalize(query);
    return store.products.filter((product) => {
      if (category && product.category !== category) return false;
      if (onlyMissing && (product.warehouseZone ?? "").trim()) return false;
      return !needle || normalize(`${product.name}${product.warehouseZone ?? ""}${product.sub}`).includes(needle);
    });
  }, [store.products, query, category, onlyMissing]);

  if (!data) return <section className="adm-panel"><p className="admin-loading">창고 위치를 불러오는 중입니다.</p></section>;
  const names = data.locations.map((row) => row.name);
  const missing = store.products.filter((product) => !(product.warehouseZone ?? "").trim()).length;
  const visibleIds = products.slice(0, 300).map((product) => product.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));

  return (
    <section className="adm-panel adm-zones">
      <div className="adm-head">
        <div><h1>창고 위치</h1><p>상차준비표는 위치 순서(위 → 아래)대로 나옵니다. 창고를 한 바퀴 도는 순서로 맞춰 두세요. 위치가 없는 상품은 표 맨 끝 ‘위치 미지정’에 모입니다.</p></div>
      </div>

      <div className="adm-zone-card">
        <h2>위치 순서 <small>위치 미지정 상품 {missing}개</small></h2>
        <div className="adm-loc-list">
          {data.locations.map((row, index) => (
            <div className="adm-loc" key={row.name}>
              <b className="adm-loc-no">{index + 1}</b>
              <strong>{row.name}</strong>
              <select value={row.storage} disabled={busy} onChange={(e) => void run({ action: "location-save", name: row.name, storage: e.target.value })}>
                <option value="frozen">❄ 냉동</option><option value="chilled">🧊 냉장</option><option value="dry">📦 공산품</option><option value="">구분 없음</option>
              </select>
              <span>상품 {row.productCount}개</span>
              <div className="adm-cat-actions">
                <button type="button" disabled={busy || index === 0} onClick={() => { const list = [...names]; [list[index - 1], list[index]] = [list[index], list[index - 1]]; void run({ action: "location-order", names: list }); }}>▲</button>
                <button type="button" disabled={busy || index === names.length - 1} onClick={() => { const list = [...names]; [list[index + 1], list[index]] = [list[index], list[index + 1]]; void run({ action: "location-order", names: list }); }}>▼</button>
                <button type="button" disabled={busy} onClick={() => { const next = window.prompt("새 위치 이름", row.name); if (next && next.trim() && next.trim() !== row.name) void run({ action: "location-rename", name: row.name, newName: next.trim() }, undefined, true); }}>이름변경</button>
                <button type="button" className="danger" disabled={busy} onClick={() => { if (window.confirm(`‘${row.name}’ 위치를 삭제할까요? 상품 ${row.productCount}개는 ‘위치 미지정’이 됩니다.`)) void run({ action: "location-delete", name: row.name }, undefined, true); }}>삭제</button>
              </div>
            </div>
          ))}
        </div>
        <div className="adm-inline-add">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="새 위치 예: 냉동창고 안쪽" />
          <select value={newStorage} onChange={(e) => setNewStorage(e.target.value)}><option value="frozen">❄ 냉동</option><option value="chilled">🧊 냉장</option><option value="dry">📦 공산품</option></select>
          <button type="button" className="adm-primary" disabled={busy || !newName.trim()} onClick={() => void run({ action: "location-add", name: newName.trim(), storage: newStorage }, () => setNewName(""))}>위치 추가</button>
        </div>
      </div>

      <div className="adm-zone-card">
        <h2>상품 위치 한꺼번에 지정 <small>상품 수정 화면에서도 하나씩 바꿀 수 있습니다</small></h2>
        <div className="adm-zone-toolbar">
          <select value={category} onChange={(e) => { setCategory(e.target.value); setSelected(new Set()); }}>
            <option value="">전체 카테고리</option>
            {Object.keys(store.categories).map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="상품 이름 검색 예: 돈까스" />
          <label className="adm-check"><input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} /> 위치 없는 상품만</label>
          <span className="adm-zone-move">
            선택 {selected.size}개 →
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              {names.map((name) => <option key={name} value={name}>{name}</option>)}
              <option value="">위치 미지정</option>
            </select>
            <button type="button" className="adm-primary" disabled={busy || !selected.size}
              onClick={() => void run({ action: "products-location", productIds: Array.from(selected), location: target }, () => setSelected(new Set()), true)}>지정</button>
          </span>
        </div>
        <div className="adm-zone-customers">
          <label className="adm-zone-customer head">
            <input type="checkbox" checked={allVisibleSelected} onChange={(e) => {
              const next = new Set(selected);
              for (const id of visibleIds) { if (e.target.checked) next.add(id); else next.delete(id); }
              setSelected(next);
            }} />
            <span>보이는 상품 모두 선택 ({Math.min(products.length, 300)}개)</span>
          </label>
          {products.slice(0, 300).map((product) => (
            <label key={product.id} className="adm-zone-customer">
              <input type="checkbox" checked={selected.has(product.id)} onChange={(e) => {
                const next = new Set(selected);
                if (e.target.checked) next.add(product.id); else next.delete(product.id);
                setSelected(next);
              }} />
              <span className="name">{product.name}<small>{product.category}{product.sub ? ` · ${product.sub}` : ""}</small></span>
              <em className={product.warehouseZone ? "" : "none"}>{product.warehouseZone || "미지정"}</em>
            </label>
          ))}
          {products.length > 300 && <p className="adm-help">앞의 300개만 보입니다. 검색이나 카테고리로 좁혀 주세요.</p>}
        </div>
      </div>

      <div className="adm-zone-card">
        <h2>카테고리 보관 구분 <small>위치가 없는 상품은 이 구분(냉동·냉장·공산품)으로 묶어 출력</small></h2>
        <div className="adm-loc-list">
          {Object.keys(store.categories).map((name) => (
            <div className="adm-loc" key={name}>
              <strong>{name}</strong>
              <select value={store.categoryStorage?.[name] ?? ""} disabled={busy} onChange={(e) => void run({ action: "category-storage", category: name, storage: e.target.value }, undefined, true)}>
                <option value="frozen">❄ 냉동</option><option value="chilled">🧊 냉장</option><option value="dry">📦 공산품</option><option value="">구분 없음</option>
              </select>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
