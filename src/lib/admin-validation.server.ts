import type { PackOption } from "./db.server";

export function cleanText(value: unknown, max = 120) {
  return String(value ?? "").trim().slice(0, max);
}

export function cleanPrice(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.min(999999999, Math.round(number));
}

export function cleanStep(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 1;
  return Math.min(999, Math.round(number * 1000) / 1000);
}

export function cleanOptions(value: unknown): PackOption[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 10).map((item) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const label = cleanText(row.label, 24);
    const rawPrice = row.price;
    return {
      label,
      price: rawPrice === null || rawPrice === "" || rawPrice === undefined ? null : cleanPrice(rawPrice),
      step: cleanStep(row.step),
    };
  }).filter((option) => option.label.length > 0);
}
