// 상품 엑셀: 내려받기 양식 + 올린 파일과 현재 상품을 비교해 바뀐 점 계산 (관리자 브라우저용)
import type { PackOption, Product, StoreData } from "./db.server";
import type { Cell, SheetSpec } from "./xlsx-lite";

export const SHEET_COLUMNS = [
  "상품코드", "상품명", "카테고리", "세부카테고리", "규격(kg)", "단위", "가격", "B그룹가격",
  "1박스 입수", "1박스 인분", "상태", "창고위치", "상품설명", "최근수정",
] as const;

const COL = Object.fromEntries(SHEET_COLUMNS.map((name, index) => [name, index])) as Record<(typeof SHEET_COLUMNS)[number], number>;
const STATUS_LABEL = { selling: "판매중", soldout: "품절", hidden: "숨김" } as const;
type Status = keyof typeof STATUS_LABEL;

function statusOf(product: Product): Status {
  if (product.hidden) return "hidden";
  if (product.soldout) return "soldout";
  return "selling";
}

function kgText(unit: string) {
  const value = String(unit ?? "").trim();
  const kg = /^([0-9]+(?:\.[0-9]+)?)\s*kg$/i.exec(value);
  return kg ? kg[1] : value;
}

function unitFromSheet(value: string) {
  const text = value.trim();
  if (!text) return "";
  if (/^[0-9]+(?:\.[0-9]+)?$/.test(text)) return `${Number(text)}kg`;
  const kg = /^([0-9]+(?:\.[0-9]+)?)\s*kg$/i.exec(text);
  return kg ? `${Number(kg[1])}kg` : text;
}

function kstStamp(value?: string) {
  if (!value) return "";
  const date = new Date(`${value.replace(" ", "T")}Z`);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

export function productSheets(store: StoreData): SheetSpec[] {
  const rows: Cell[][] = [[...SHEET_COLUMNS]];
  for (const product of store.products) {
    const options: PackOption[] = product.packOptions.length ? product.packOptions : [{ label: product.unit || "박스", price: product.price, step: 1 }];
    for (const option of options) {
      rows.push([
        product.id, product.name, product.category, product.sub, kgText(product.unit), option.label,
        option.price ?? "", option.priceB ?? "",
        product.boxContents ?? "", product.servingsPerBox ?? "",
        STATUS_LABEL[statusOf(product)], product.warehouseZone ?? "", product.description ?? "", kstStamp(product.updatedAt),
      ]);
    }
  }
  const guide: Cell[][] = [
    ["부자유통 상품 엑셀 사용법"],
    [""],
    ["1. '상품목록' 시트에서 고칠 칸만 고친 뒤 저장하세요. (엑셀 형식 .xlsx 그대로)"],
    ["2. 관리자 > 상품 관리 > '엑셀 올려서 일괄 수정'으로 올리면, 바뀔 내용을 먼저 보여드립니다. 확인을 눌러야 반영됩니다."],
    ["3. 회색 칸(상품코드·최근수정)은 고치지 마세요. 상품코드로 어느 상품인지 찾습니다."],
    ["4. 단위가 여러 개인 상품은 단위마다 한 줄입니다. 상품명·카테고리 등은 그 상품의 첫 줄 기준으로 반영됩니다."],
    ["5. 가격: 숫자만 (쉼표 있어도 됨). 비우면 '가격문의'."],
    ["6. B그룹가격: 비우면 기본 가격과 같음."],
    ["7. 상태: 판매중 / 품절 / 숨김 중 하나."],
    ["8. 카테고리·세부카테고리는 관리자에 이미 있는 이름만 쓸 수 있습니다."],
    ["9. 이 파일로는 새 상품 추가·상품 삭제·단위 추가는 하지 않습니다. (관리자 화면에서 해 주세요)"],
  ];
  return [
    { name: "상품목록", rows, header: true, widths: [13, 30, 12, 14, 9, 8, 11, 11, 9, 9, 8, 12, 40, 17], lockedColumns: [COL["상품코드"], COL["최근수정"]] },
    { name: "사용법", rows: guide, widths: [110] },
  ];
}

export type FieldChange = { field: string; before: string; after: string };
export type ProductChange = { product: Product; next: Product; changes: FieldChange[] };
export type SheetPlan = { changes: ProductChange[]; errors: string[]; rowCount: number; productCount: number };

function priceFromSheet(raw: string): number | null | "invalid" {
  const text = raw.replace(/[,\s원₩]/g, "");
  if (!text) return null;
  if (!/^\d+(\.0+)?$/.test(text)) return "invalid";
  return Math.round(Number(text));
}

function won(value: number | null | undefined) {
  return value == null ? "(없음)" : `${new Intl.NumberFormat("ko-KR").format(value)}원`;
}

/** 올린 엑셀과 현재 상품을 비교. 바뀐 상품만, 바꿀 수 있는 항목만 반영 계획을 만듦 */
export function planProductSheet(store: StoreData, table: string[][]): SheetPlan {
  const errors: string[] = [];
  const header = (table[0] ?? []).map((v) => String(v ?? "").trim());
  const index: Record<string, number> = {};
  for (const name of SHEET_COLUMNS) index[name] = header.indexOf(name);
  const missing = ["상품코드", "단위", "가격"].filter((name) => index[name] < 0);
  if (missing.length) return { changes: [], errors: [`첫 줄 제목이 다릅니다. '${missing.join("', '")}' 열을 찾을 수 없습니다. 내려받은 양식을 그대로 써 주세요.`], rowCount: 0, productCount: 0 };

  const get = (row: string[], name: string) => (index[name] >= 0 ? String(row[index[name]] ?? "").trim() : undefined);
  const byId = new Map(store.products.map((p) => [p.id, p]));
  const groups = new Map<string, Array<{ row: string[]; line: number }>>();
  let rowCount = 0;
  table.slice(1).forEach((row, i) => {
    const id = get(row, "상품코드") ?? "";
    if (!row.some((v) => String(v ?? "").trim())) return;
    rowCount += 1;
    const line = i + 2;
    if (!id) { errors.push(`${line}행: 상품코드가 비어 있어 건너뜀`); return; }
    if (!byId.has(id)) { errors.push(`${line}행: 상품코드 ${id} 를 찾을 수 없어 건너뜀 (새 상품은 관리자 화면에서 추가)`); return; }
    const list = groups.get(id) ?? [];
    list.push({ row, line });
    groups.set(id, list);
  });

  const changes: ProductChange[] = [];
  for (const [id, rows] of groups) {
    const product = byId.get(id)!;
    const first = rows[0].row;
    const next: Product = structuredClone(product);
    const fieldChanges: FieldChange[] = [];
    let bad = false;
    const fail = (line: number, message: string) => { errors.push(`${line}행 (${product.name}): ${message}`); bad = true; };

    const name = get(first, "상품명");
    if (name !== undefined) {
      if (!name) fail(rows[0].line, "상품명이 비어 있음");
      else if (name !== product.name) { next.name = name; fieldChanges.push({ field: "상품명", before: product.name, after: name }); }
    }
    const category = get(first, "카테고리");
    const sub = get(first, "세부카테고리");
    if (category !== undefined && category !== product.category) {
      if (!(category in store.categories)) fail(rows[0].line, `없는 카테고리 '${category}'`);
      else { next.category = category; fieldChanges.push({ field: "카테고리", before: product.category, after: category }); }
    }
    if (sub !== undefined && (sub !== product.sub || next.category !== product.category)) {
      const subs = store.categories[next.category] ?? [];
      if (sub && !subs.includes(sub)) fail(rows[0].line, `'${next.category}'에 없는 세부카테고리 '${sub}'`);
      else if (sub !== product.sub) { next.sub = sub; fieldChanges.push({ field: "세부카테고리", before: product.sub || "(없음)", after: sub || "(없음)" }); }
    }
    const unit = get(first, "규격(kg)");
    if (unit !== undefined) {
      const stored = unitFromSheet(unit);
      if (stored !== unitFromSheet(product.unit)) { next.unit = stored; fieldChanges.push({ field: "규격", before: product.unit || "(없음)", after: stored || "(없음)" }); }
    }
    for (const [col, key, label] of [["1박스 입수", "boxContents", "1박스 입수"], ["1박스 인분", "servingsPerBox", "1박스 인분"], ["창고위치", "warehouseZone", "창고위치"], ["상품설명", "description", "상품설명"]] as const) {
      const value = get(first, col);
      if (value === undefined) continue;
      const clean = col === "상품설명" || col === "창고위치" ? value : value.replace(/[^\d]/g, "");
      if (clean !== String(product[key] ?? "")) { next[key] = clean; fieldChanges.push({ field: label, before: String(product[key] ?? "") || "(없음)", after: clean || "(없음)" }); }
    }
    const statusText = get(first, "상태");
    if (statusText !== undefined && statusText) {
      const status = (Object.entries(STATUS_LABEL).find(([, label]) => label === statusText)?.[0]) as Status | undefined;
      if (!status) fail(rows[0].line, `상태는 판매중/품절/숨김 중 하나 ('${statusText}')`);
      else if (status !== statusOf(product)) {
        next.hidden = status === "hidden";
        next.soldout = status === "soldout" ? true : status === "selling" ? false : product.soldout;
        fieldChanges.push({ field: "상태", before: STATUS_LABEL[statusOf(product)], after: statusText });
      }
    }

    const seen = new Set<string>();
    for (const { row, line } of rows) {
      const label = get(row, "단위") ?? "";
      if (seen.has(label)) { fail(line, `단위 '${label}' 가 두 번 있음`); continue; }
      seen.add(label);
      const option = next.packOptions.find((o) => o.label === label);
      if (!option) { fail(line, `단위 '${label}' 가 이 상품에 없음 (단위 추가는 관리자 화면에서)`); continue; }
      const price = priceFromSheet(get(row, "가격") ?? "");
      if (price === "invalid") fail(line, `가격 '${get(row, "가격")}' 이 숫자가 아님`);
      else if (price !== option.price) { fieldChanges.push({ field: `${label} 가격`, before: won(option.price), after: won(price) }); option.price = price; }
      const rawB = get(row, "B그룹가격");
      if (rawB !== undefined) {
        const priceB = priceFromSheet(rawB);
        if (priceB === "invalid") fail(line, `B그룹가격 '${rawB}' 이 숫자가 아님`);
        else if (priceB !== (option.priceB ?? null)) { fieldChanges.push({ field: `${label} B그룹가격`, before: won(option.priceB), after: won(priceB) }); option.priceB = priceB; }
      }
    }
    if (bad) continue;
    if (fieldChanges.length) changes.push({ product, next, changes: fieldChanges });
  }
  return { changes, errors, rowCount, productCount: groups.size };
}
