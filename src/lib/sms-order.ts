// 식당 문자 주문 읽기 (관리자 '주문발주 입력'용, 브라우저에서 실행)
// 예) "130-14\n숙성지2.칼집비엔나6봉.코다리1.동전어묵1봉.모듬해물2개.부탄까스1박스요"
import type { Product } from "./db.server";
import { customerShortLabel } from "./customer-login-id";

export type SmsAlias = { alias: string; customerId: string; productId: string; optionLabel: string };
export type SmsCustomer = { id: string; code: string; name: string; active?: boolean };
export type Candidate = { product: Product; score: number; why: string };
export type SmsLine = {
  raw: string;
  query: string;
  quantity: number;
  quantityGiven: boolean;
  unitWord: string;
  status: "auto" | "pick" | "none";
  candidates: Candidate[];
  productId: string;
  optionLabel: string;
};

const UNIT_WORDS = ["박스", "박", "box", "봉지", "봉", "팩", "개", "통", "캔", "판", "묶음", "병", "포", "kg", "키로", "ea", "장", "단", "망", "말", "마리", "손", "미"];
const UNIT_RE = UNIT_WORDS.slice().sort((a, b) => b.length - a.length).join("|");
const TAIL_RE = /(이요|요|입니다|이에요|에요|주세요|부탁(?:드립니다|드려요|해요|합니다)?|씩|만)+$/;

/** 비교용: 소문자, 띄어쓰기·기호 제거, 괄호 속 제조사 표기는 따로 둠 */
export function normalizeName(value: string) {
  return String(value ?? "").toLowerCase().replace(/[\s()[\]{}·.,/_\-~*]+/g, "");
}

function coreName(name: string) {
  // "칼집비엔나(오양)" → "칼집비엔나", "치킨너겟 (하림)" → "치킨너겟"
  return normalizeName(String(name).replace(/\([^)]*\)|\[[^\]]*\]/g, ""));
}

export function normalizeAlias(value: string) {
  return normalizeName(value).replace(TAIL_RE, "");
}

function bigrams(text: string) {
  const out = new Map<string, number>();
  for (let i = 0; i < text.length - 1; i += 1) {
    const g = text.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

/** 글자 묶음 비슷한 정도 (모듬해물 ↔ 해물모듬 처럼 순서가 달라도) */
function similarity(a: string, b: string) {
  if (a.length < 2 || b.length < 2) return 0;
  const A = bigrams(a);
  const B = bigrams(b);
  let common = 0;
  for (const [g, n] of A) common += Math.min(n, B.get(g) ?? 0);
  return (2 * common) / (a.length - 1 + b.length - 1);
}

function commonPrefix(a: string, b: string) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return i;
}

/** 첫 줄 등에서 거래처 찾기: "130-14", 거래처코드, 상호 일부 */
export function findCustomer(text: string, customers: SmsCustomer[]) {
  const firstLine = (text.split(/\r?\n/).find((line) => line.trim()) ?? "").trim();
  const blockLot = /^(\d{1,3})\s*[-–—]\s*(\d{1,3})(?!\d)/.exec(firstLine);
  const active = customers.filter((c) => c.active !== false);
  if (blockLot) {
    const label = `${blockLot[1]}-${blockLot[2]}`;
    const found = active.filter((c) => customerShortLabel(c) === label);
    return { customers: found, consumed: blockLot[0], label };
  }
  const head = normalizeName(firstLine.split(/[.,\s]/)[0] ?? "");
  if (head.length >= 2) {
    const byCode = active.filter((c) => normalizeName(c.code) === head);
    if (byCode.length) return { customers: byCode, consumed: firstLine.split(/[.,\s]/)[0], label: head };
    const byName = active.filter((c) => normalizeName(c.name).includes(head));
    if (byName.length && byName.length <= 3 && firstLine.length <= 20) return { customers: byName, consumed: firstLine, label: firstLine };
  }
  return { customers: [] as SmsCustomer[], consumed: "", label: "" };
}

/** 품목 한 줄 → 이름 / 수량 / 단위 */
export function parseItem(raw: string) {
  let text = raw.trim().replace(/\s+/g, " ");
  text = text.replace(new RegExp(`(\\d)\\s*(${UNIT_RE})?\\s*(${TAIL_RE.source.slice(0, -1)})$`, "i"), "$1$2");
  const match = new RegExp(`^(.*?)\\s*(\\d+(?:\\.\\d+)?)\\s*(${UNIT_RE})?\\s*$`, "i").exec(text);
  if (match && match[1].trim()) {
    return { name: match[1].trim(), quantity: Number(match[2]), quantityGiven: true, unitWord: (match[3] ?? "").toLowerCase() };
  }
  return { name: text.replace(TAIL_RE, "").trim(), quantity: 1, quantityGiven: false, unitWord: "" };
}

/** 문자 본문 → 품목 조각 */
export function splitItems(text: string, consumed: string) {
  let body = text;
  if (consumed) body = body.replace(consumed, " ");
  // "칼집비엔나6봉코다리1" 처럼 붙여 쓴 경우: 수량+단위 뒤에 글자가 바로 이어지면 나눔
  body = body.replace(/(\d+(?:\.\d+)?\s*(?:박스|봉지|봉|팩|개|통|캔|판|병))(?=[가-힣])(?!요|이요|씩|만)/g, "$1\n");
  // "해물모듬2박스 4종혼합야채3" 처럼 한 줄에 띄어쓰기로 나열한 경우: 수량(+단위) 뒤 띄어쓰기에서 나눔
  body = body.replace(new RegExp(`([가-힣a-zA-Z)\\]]\\s*\\d+(?:\\.\\d+)?\\s*(?:${UNIT_RE})?(?:${TAIL_RE.source.slice(0, -1)})?)[ \\t]+(?=\\d*[가-힣a-zA-Z])`, "gi"), "$1\n");
  // 마침표는 숫자 사이(1.5kg)가 아닐 때만 나눔
  const parts = body
    .split(/[\n\r,，、·;]+|(?<!\d)\.|\.(?!\d)|\s{2,}/)
    .map((part) => part.trim())
    .filter((part) => part && part.replace(TAIL_RE, "").trim());
  // "종이컵1.박스", "종이컵.1박스" 처럼 단위·수량만 떨어져 나온 조각은 앞 품목에 붙임
  const unitOnly = new RegExp(`^(\\d+(?:\\.\\d+)?)?\\s*(${UNIT_RE})?\\s*(${TAIL_RE.source.slice(0, -1)})?$`, "i");
  const out: string[] = [];
  for (const part of parts) {
    if (unitOnly.test(part) && out.length) {
      const prev = out[out.length - 1];
      // 숫자 뒤에 숫자가 오면 띄어서 붙임 ("1.5kg" + "2통" → "1.5kg 2통")
      out[out.length - 1] = /\d$/.test(prev) && /^\d/.test(part) ? `${prev} ${part}` : `${prev}${part}`;
      continue;
    }
    if (/[가-힣a-zA-Z]/.test(part) && !unitOnly.test(part)) out.push(part);
  }
  return out;
}

function pickOption(product: Product, unitWord: string) {
  const options = product.packOptions.length ? product.packOptions : [{ label: product.unit || "박스", price: product.price, step: 1 }];
  if (unitWord) {
    const word = unitWord === "박" || unitWord === "box" ? "박스" : unitWord === "키로" ? "kg" : unitWord;
    const exact = options.find((o) => o.label === word);
    if (exact) return exact.label;
    const partial = options.find((o) => o.label.includes(word) || word.includes(o.label));
    if (partial) return partial.label;
  }
  return options[0]?.label ?? "";
}

export type MatchContext = {
  products: Product[];
  aliases: SmsAlias[];
  customerId: string;
  /** 이 거래처가 최근에 시킨 상품 id → 횟수 */
  history: Map<string, number>;
};

/** 한 품목을 상품과 맞추기 */
export function matchItem(raw: string, ctx: MatchContext): SmsLine {
  const parsed = parseItem(raw);
  const query = normalizeAlias(parsed.name);
  const base = { raw, query: parsed.name, quantity: parsed.quantity, quantityGiven: parsed.quantityGiven, unitWord: parsed.unitWord };
  const byId = new Map(ctx.products.map((p) => [p.id, p]));
  const selling = ctx.products.filter((p) => !p.hidden);

  // 1) 연관어 (이 거래처 것 먼저, 다음 공통)
  const alias = ctx.aliases.find((a) => a.alias === query && a.customerId === ctx.customerId)
    ?? ctx.aliases.find((a) => a.alias === query && !a.customerId);
  const aliasProduct = alias ? byId.get(alias.productId) : undefined;
  const aliasOption = aliasProduct && alias
    ? (parsed.unitWord ? pickOption(aliasProduct, parsed.unitWord) : (aliasProduct.packOptions.some((o) => o.label === alias.optionLabel) ? alias.optionLabel : pickOption(aliasProduct, "")))
    : "";
  if (aliasProduct && !aliasProduct.soldout) {
    return { ...base, status: parsed.quantityGiven ? "auto" : "pick", candidates: [{ product: aliasProduct, score: 100, why: "연관어" }], productId: aliasProduct.id, optionLabel: aliasOption };
  }
  if (query.length < 1) return { ...base, status: "none", candidates: [], productId: "", optionLabel: "" };

  // 2) 상품명 비교
  const scored: Candidate[] = [];
  for (const product of selling) {
    const full = normalizeName(product.name);
    const core = coreName(product.name);
    let score = 0;
    let why = "";
    if (core === query || full === query) { score = 95; why = "이름 같음"; }
    else if (core.startsWith(query) && query.length >= 2) { score = 80 + Math.min(10, query.length); why = "이름 앞부분"; }
    else if (full.includes(query) && query.length >= 2) { score = 70 + Math.min(10, query.length); why = "이름에 포함"; }
    else {
      const sim = Math.max(similarity(query, core), similarity(query, full));
      const prefix = commonPrefix(query, core);
      if (sim >= 0.5) { score = Math.round(sim * 70); why = "비슷한 이름"; }
      else if (prefix >= 2) { score = 25 + prefix * 5; why = "앞글자 같음"; }
      else if (sim >= 0.3) { score = Math.round(sim * 60); why = "비슷한 이름"; }
    }
    if (!score) continue;
    const ordered = ctx.history.get(product.id) ?? 0;
    if (ordered) { score += Math.min(15, 5 + ordered * 2); why += " · 전에 주문"; }
    // 품절은 후보 아래로 (비슷한 판매중 상품이 먼저 보이게)
    if (product.soldout) score -= 20;
    scored.push({ product, score, why });
  }
  scored.sort((a, b) => b.score - a.score || a.product.name.length - b.product.name.length);
  let candidates = scored.slice(0, 6);
  // 연관어 상품이 품절: 그 상품을 골라 두되(품절 표시), 비슷한 판매중 상품을 같이 보여줌
  if (aliasProduct) {
    candidates = [{ product: aliasProduct, score: 100, why: "연관어 · 품절" }, ...candidates.filter((c) => c.product.id !== aliasProduct.id).slice(0, 5)];
    return { ...base, status: "pick", candidates, productId: aliasProduct.id, optionLabel: aliasOption };
  }
  if (!candidates.length) return { ...base, status: "none", candidates: [], productId: "", optionLabel: "" };

  const [top, second] = candidates;
  // 확실할 때만 자동: 이름이 같거나(1개), 이름에 포함된 상품이 하나뿐이거나, 2등과 차이가 클 때
  const strong = top.score >= 70;
  const clear = !second || top.score - second.score >= 15 || (top.score >= 95 && second.score < 95);
  // 품절 상품이거나 문자에 수량이 없으면 자동으로 넣지 않고 확인(노랑)
  const status: SmsLine["status"] = strong && clear && !top.product.soldout && parsed.quantityGiven ? "auto" : "pick";
  return { ...base, status, candidates, productId: top.product.id, optionLabel: pickOption(top.product, parsed.unitWord) };
}

export function readSms(text: string, customers: SmsCustomer[], ctx: Omit<MatchContext, "customerId"> & { customerId?: string }) {
  const customer = findCustomer(text, customers);
  const customerId = ctx.customerId ?? (customer.customers.length === 1 ? customer.customers[0].id : "");
  const lines = splitItems(text, customer.consumed).map((raw) => matchItem(raw, { ...ctx, customerId }));
  return { customer, customerId, lines };
}

export { pickOption };
