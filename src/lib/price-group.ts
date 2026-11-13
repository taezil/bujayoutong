// 가격 그룹 A·B·C·D. A=기본 가격(정가), B·C·D=그룹별 가격(비워두면 기본 가격과 같음)
export const PRICE_GROUPS = ["A", "B", "C", "D"] as const;
export type PriceGroup = (typeof PRICE_GROUPS)[number];
export const EXTRA_PRICE_GROUPS = ["B", "C", "D"] as const;
export type ExtraPriceGroup = (typeof EXTRA_PRICE_GROUPS)[number];
export const PRICE_KEY = { B: "priceB", C: "priceC", D: "priceD" } as const;

export function normalizePriceGroup(value: unknown): PriceGroup {
  const text = String(value ?? "").trim().toUpperCase();
  return (PRICE_GROUPS as readonly string[]).includes(text) ? (text as PriceGroup) : "A";
}

type GroupPrices = { price: number | null; priceB?: number | null; priceC?: number | null; priceD?: number | null };

/** 그룹 가격: B·C·D 가격이 있으면 그 값, 없으면 기본 가격 */
export function groupPriceOf(option: GroupPrices, group: unknown): number | null {
  if (option.price == null) return null;
  const g = normalizePriceGroup(group);
  if (g === "A") return option.price;
  return option[PRICE_KEY[g]] ?? option.price;
}
