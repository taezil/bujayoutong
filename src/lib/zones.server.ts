import { db, ensureDatabase } from "./db.server";
import { cleanTime, DEFAULT_RULE, parseRuns, type DeliveryRule } from "./delivery-rules";

export type ZoneRow = { name: string; sortOrder: number; amUntil: string; pmRuns: string; customerCount: number };
export type LocationRow = { name: string; sortOrder: number; storage: string; productCount: number };
export type DeliveryDefaults = { openFrom: string; sameDayCutoff: string; amUntil: string; pmRuns: string[] };

const DEFAULT_KEYS = ["delivery_open_from", "delivery_same_day_cutoff", "delivery_default_am_until", "delivery_default_pm_runs"];

export async function readDeliveryDefaults(): Promise<DeliveryDefaults> {
  await ensureDatabase();
  const rows = await db().prepare(`SELECT key,value FROM app_settings WHERE key IN (${DEFAULT_KEYS.map(() => "?").join(",")})`).bind(...DEFAULT_KEYS).all();
  const map = Object.fromEntries((rows.results as Array<Record<string, unknown>>).map((row) => [String(row.key), String(row.value)]));
  return {
    openFrom: cleanTime(map.delivery_open_from, DEFAULT_RULE.openFrom),
    sameDayCutoff: cleanTime(map.delivery_same_day_cutoff, DEFAULT_RULE.sameDayCutoff),
    amUntil: cleanTime(map.delivery_default_am_until, DEFAULT_RULE.amUntil),
    pmRuns: parseRuns(map.delivery_default_pm_runs, DEFAULT_RULE.pmRuns),
  };
}

export async function saveDeliveryDefaults(input: Partial<Record<keyof DeliveryDefaults, unknown>>) {
  const current = await readDeliveryDefaults();
  const next = {
    openFrom: cleanTime(input.openFrom, current.openFrom),
    sameDayCutoff: cleanTime(input.sameDayCutoff, current.sameDayCutoff),
    amUntil: cleanTime(input.amUntil, current.amUntil),
    pmRuns: parseRuns(input.pmRuns, current.pmRuns),
  };
  if (next.openFrom >= next.sameDayCutoff) throw new Error("오늘 배송 시작 시각은 마감 시각보다 빨라야 합니다.");
  const set = (key: string, value: string) => db().prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES(?,?)").bind(key, value);
  await db().batch([
    set("delivery_open_from", next.openFrom),
    set("delivery_same_day_cutoff", next.sameDayCutoff),
    set("delivery_default_am_until", next.amUntil),
    set("delivery_default_pm_runs", next.pmRuns.join(",")),
  ]);
  return next;
}

/** 거래처 구역(customers.region)에 맞는 배송 규칙. 구역 설정이 비어 있으면 기본값 */
export async function ruleForRegion(region: string): Promise<DeliveryRule> {
  const defaults = await readDeliveryDefaults();
  const zone = String(region ?? "").trim();
  const row = zone
    ? await db().prepare("SELECT name,am_until,pm_runs FROM delivery_zones WHERE name=?").bind(zone).first<Record<string, unknown>>()
    : null;
  return {
    zone,
    openFrom: defaults.openFrom,
    sameDayCutoff: defaults.sameDayCutoff,
    amUntil: cleanTime(row?.am_until, defaults.amUntil),
    pmRuns: parseRuns(row?.pm_runs, defaults.pmRuns),
  };
}

export async function listZones(): Promise<ZoneRow[]> {
  await ensureDatabase();
  const rows = await db().prepare(`
    SELECT z.name,z.sort_order,z.am_until,z.pm_runs,
           (SELECT COUNT(*) FROM customers c WHERE TRIM(c.region)=z.name AND c.active=1) AS customer_count
    FROM delivery_zones z ORDER BY z.sort_order, z.name
  `).all();
  return (rows.results as Array<Record<string, unknown>>).map((row) => ({
    name: String(row.name), sortOrder: Number(row.sort_order ?? 0), amUntil: String(row.am_until ?? ""), pmRuns: String(row.pm_runs ?? ""),
    customerCount: Number(row.customer_count ?? 0),
  }));
}

export async function listLocations(): Promise<LocationRow[]> {
  await ensureDatabase();
  const rows = await db().prepare(`
    SELECT l.name,l.sort_order,l.storage,
           (SELECT COUNT(*) FROM products p WHERE TRIM(p.warehouse_zone)=l.name) AS product_count
    FROM warehouse_locations l ORDER BY l.sort_order, l.name
  `).all();
  return (rows.results as Array<Record<string, unknown>>).map((row) => ({
    name: String(row.name), sortOrder: Number(row.sort_order ?? 0), storage: String(row.storage ?? ""), productCount: Number(row.product_count ?? 0),
  }));
}

export function cleanName(value: unknown, max = 40) {
  return String(value ?? "").replace(/[\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function cleanStorage(value: unknown) {
  const text = String(value ?? "");
  return text === "frozen" || text === "chilled" || text === "dry" ? text : "";
}

/** 순서 다시 매기기: names 순서대로 1,2,3… */
export async function reorder(table: "delivery_zones" | "warehouse_locations", names: string[]) {
  const unique = Array.from(new Set(names.map((name) => cleanName(name)).filter(Boolean)));
  if (!unique.length) return;
  await db().batch(unique.map((name, index) => db().prepare(`UPDATE ${table} SET sort_order=? WHERE name=?`).bind(index + 1, name)));
}
