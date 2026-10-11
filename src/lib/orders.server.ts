import { db, ensureDatabase } from "./db.server";
import type { CustomerSummary, OrderSettings } from "./db.server";
import type { StaffSession } from "./auth.server";
import { staffActor } from "./audit.server";
import { writeAudit } from "./audit.server";

function randomOrderId() {
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  return `O${stamp}${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

export function kstDate(offsetDays = 0) {
  const date = new Date(Date.now() + offsetDays * 86400000);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

function kstTime() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  return `${parts.find((p) => p.type === "hour")?.value ?? "00"}:${parts.find((p) => p.type === "minute")?.value ?? "00"}`;
}

function withinTimeRange(now: string, open: string, close: string) {
  if (open <= close) return now >= open && now <= close;
  return now >= open || now <= close;
}

export function normalizeDeliveryDate(value?: string) {
  const fallback = kstDate();
  const text = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return fallback;
  const time = new Date(`${text}T00:00:00+09:00`).getTime();
  if (!Number.isFinite(time)) return fallback;
  const min = new Date(`${kstDate(-1)}T00:00:00+09:00`).getTime();
  const max = new Date(`${kstDate(180)}T23:59:59+09:00`).getTime();
  if (time < min || time > max) throw new Error("배송일은 오늘부터 180일 이내로 선택해 주세요.");
  return text;
}

export async function readOrderSettings(): Promise<OrderSettings> {
  await ensureDatabase();
  const rows = await db().prepare("SELECT key, value FROM app_settings WHERE key IN ('orderEnabled','order24h','orderOpenTime','orderCloseTime','editMinutes','cancelMinutes')").all();
  const map = Object.fromEntries((rows.results as Array<Record<string, unknown>>).map((r) => [String(r.key), String(r.value)]));
  return {
    enabled: map.orderEnabled !== "0",
    open24h: map.order24h !== "0",
    openTime: map.orderOpenTime || "00:00",
    closeTime: map.orderCloseTime || "23:59",
    editMinutes: Number(map.editMinutes || 15),
    cancelMinutes: Number(map.cancelMinutes || 15),
  };
}

export async function orderAvailability() {
  const settings = await readOrderSettings();
  if (!settings.enabled) return { allowed: false, reason: "현재 주문 접수가 일시 중지되어 있습니다.", settings };
  if (settings.open24h) return { allowed: true, reason: "", settings };
  const now = kstTime();
  const allowed = withinTimeRange(now, settings.openTime, settings.closeTime);
  return { allowed, reason: allowed ? "" : `주문 가능시간은 ${settings.openTime} ~ ${settings.closeTime}입니다.`, settings };
}

type OrderRequestItem = { productId: string; optionLabel: string; quantity: number };
type PreparedItem = {
  productId: string; productName: string; unit: string; optionLabel: string; quantity: number;
  unitPrice: number; taxType: string; warehouseZone: string;
};

export type OrderQuantityWarning = {
  productId: string;
  productName: string;
  optionLabel: string;
  quantity: number;
  typicalQuantity: number;
  historyCount: number;
  message: string;
};

export class OrderWarningError extends Error {
  warnings: OrderQuantityWarning[];
  constructor(warnings: OrderQuantityWarning[]) {
    super("평소 주문량보다 많은 품목이 있습니다.");
    this.name = "OrderWarningError";
    this.warnings = warnings;
  }
}

async function prepareItems(customer: CustomerSummary, items: OrderRequestItem[]): Promise<PreparedItem[]> {
  if (!Array.isArray(items) || items.length === 0 || items.length > 100) throw new Error("주문상품을 확인해 주세요.");
  const normalized = items.map((item) => ({ productId: String(item.productId || "").trim(), optionLabel: String(item.optionLabel || "").trim(), quantity: Number(item.quantity) }))
    .filter((item) => item.productId && item.optionLabel && Number.isFinite(item.quantity) && item.quantity > 0);
  if (normalized.length !== items.length) throw new Error("주문 수량을 확인해 주세요.");

  const prepared: PreparedItem[] = [];
  for (const item of normalized) {
    const row = await db().prepare(`
      SELECT p.id,p.name,p.unit,p.soldout,p.tax_type,p.warehouse_zone,
             po.label,po.price,po.price_a,po.price_b,po.step
      FROM products p JOIN pack_options po ON po.product_id=p.id
      WHERE p.id=? AND po.label=? LIMIT 1
    `).bind(item.productId, item.optionLabel).first<Record<string, unknown>>();
    if (!row) throw new Error("판매중이지 않은 상품이 포함되어 있습니다.");
    if (Number(row.soldout ?? 0) === 1) throw new Error(`${String(row.name)}은(는) 현재 품절입니다.`);
    const step = Math.max(0.001, Number(row.step ?? 1));
    const ratio = item.quantity / step;
    if (Math.abs(ratio - Math.round(ratio)) > 0.0001) throw new Error(`${String(row.name)} 수량 단위를 확인해 주세요.`);
    const base = row.price == null ? 0 : Number(row.price);
    const groupPrice = customer.priceGroup === "B" ? row.price_b : row.price_a;
    prepared.push({
      productId: String(row.id), productName: String(row.name), unit: String(row.unit ?? ""), optionLabel: String(row.label),
      quantity: item.quantity, unitPrice: groupPrice == null ? base : Number(groupPrice), taxType: String(row.tax_type ?? "taxable"), warehouseZone: String(row.warehouse_zone ?? ""),
    });
  }
  return prepared;
}

export async function analyzeOrderQuantities(customerId: string, items: PreparedItem[]) {
  const warnings: OrderQuantityWarning[] = [];
  for (const item of items) {
    const result = await db().prepare(`
      SELECT oi.quantity FROM order_items oi
      JOIN orders o ON o.id=oi.order_id
      WHERE o.customer_id=? AND oi.product_id=? AND oi.option_label=? AND o.status!='cancelled'
      ORDER BY o.created_at DESC LIMIT 12
    `).bind(customerId, item.productId, item.optionLabel).all();
    const values = (result.results as Array<Record<string, unknown>>).map((r) => Number(r.quantity)).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
    if (values.length < 3) continue;
    const middle = Math.floor(values.length / 2);
    const median = values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
    const threshold = Math.max(median * 3, median + 3);
    if (item.quantity >= threshold) {
      warnings.push({
        productId: item.productId, productName: item.productName, optionLabel: item.optionLabel,
        quantity: item.quantity, typicalQuantity: Math.round(median * 100) / 100, historyCount: values.length,
        message: `${item.productName} ${item.quantity}${item.optionLabel} — 평소 약 ${Math.round(median * 100) / 100}${item.optionLabel}`,
      });
    }
  }
  return warnings;
}

function itemInsert(orderId: string, item: PreparedItem) {
  return db().prepare(`INSERT INTO order_items(order_id,product_id,product_name,unit,option_label,quantity,unit_price,tax_type,warehouse_zone) VALUES(?,?,?,?,?,?,?,?,?)`)
    .bind(orderId, item.productId, item.productName, item.unit, item.optionLabel, item.quantity, item.unitPrice, item.taxType, item.warehouseZone);
}

export async function createCustomerOrder(
  customer: CustomerSummary,
  items: OrderRequestItem[],
  note = "",
  source = "app",
  options: { deliveryDate?: string; staff?: StaffSession | null; confirmAnomaly?: boolean } = {},
) {
  await ensureDatabase();
  if (source === "app") {
    const availability = await orderAvailability();
    if (!availability.allowed) throw new Error(availability.reason);
  }
  const prepared = await prepareItems(customer, items);
  const warnings = await analyzeOrderQuantities(customer.id, prepared);
  if (warnings.length && !options.confirmAnomaly) throw new OrderWarningError(warnings);

  const deliveryDate = normalizeDeliveryDate(options.deliveryDate);
  const priorPrinted = await db().prepare(`
    SELECT id FROM orders WHERE customer_id=? AND delivery_date=? AND printed_at IS NOT NULL AND status!='cancelled' LIMIT 1
  `).bind(customer.id, deliveryDate).first();
  const isAdditional = Boolean(priorPrinted);
  const id = randomOrderId();
  const total = Math.round(prepared.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0));
  const staff = options.staff ?? null;
  await db().batch([
    db().prepare(`INSERT INTO orders(id,customer_id,source,status,region_snapshot,total_amount,note,delivery_date,created_by_staff_id,created_by_staff_name,is_additional)
                  VALUES(?,?,?,'received',?,?,?,?,?,?,?)`)
      .bind(id, customer.id, source, customer.region || "미지정", total, String(note || "").slice(0, 500), deliveryDate, staff?.id ?? "", staff?.displayName ?? "", isAdditional ? 1 : 0),
    ...prepared.map((item) => itemInsert(id, item)),
  ]);

  if (staff) {
    const itemText = prepared.slice(0, 4).map((i) => `${i.productName}${i.quantity}${i.optionLabel}`).join(", ");
    await writeAudit({
      actor: staffActor(staff), action: "field_order", entityType: "order", entityId: id,
      summary: `!현장발주 : ${staff.displayName} ${customer.code} ${itemText}${prepared.length > 4 ? ` 외 ${prepared.length - 4}건` : ""} · 배송 ${deliveryDate}`,
      metadata: { customerId: customer.id, customerCode: customer.code, deliveryDate, isAdditional },
    });
  }
  return { id, total, itemCount: prepared.length, deliveryDate, isAdditional, warnings };
}

export async function updateCustomerOrder(customer: CustomerSummary, orderId: string, items: OrderRequestItem[], note = "", confirmAnomaly = false) {
  await ensureDatabase();
  const settings = await readOrderSettings();
  const row = await db().prepare(`SELECT id,status,printed_at,created_at FROM orders WHERE id=? AND customer_id=? LIMIT 1`).bind(orderId, customer.id).first<Record<string, unknown>>();
  if (!row) throw new Error("수정할 주문을 찾을 수 없습니다.");
  if (String(row.status) !== "received" || row.printed_at) throw new Error("이미 출고 준비가 시작되어 앱에서 수정할 수 없습니다.");
  const created = new Date(String(row.created_at).replace(" ", "T") + "Z").getTime();
  if (!Number.isFinite(created) || Date.now() - created > settings.editMinutes * 60 * 1000) throw new Error(`주문 후 ${settings.editMinutes}분이 지나 앱에서 수정할 수 없습니다.`);
  const prepared = await prepareItems(customer, items);
  const warnings = await analyzeOrderQuantities(customer.id, prepared);
  if (warnings.length && !confirmAnomaly) throw new OrderWarningError(warnings);
  const total = Math.round(prepared.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0));
  await db().batch([
    db().prepare("DELETE FROM order_items WHERE order_id=?").bind(orderId),
    ...prepared.map((item) => itemInsert(orderId, item)),
    db().prepare("UPDATE orders SET total_amount=?,note=?,updated_at=datetime('now') WHERE id=? AND customer_id=?").bind(total, String(note || "").slice(0, 500), orderId, customer.id),
  ]);
  return { id: orderId, total, itemCount: prepared.length, warnings };
}

export async function customerDashboard(customerId: string) {
  await ensureDatabase();
  const recent = await db().prepare(`
    SELECT o.id,o.status,o.total_amount,o.created_at,o.printed_at,o.delivery_date,
           GROUP_CONCAT(oi.product_name || ' ' || CAST(oi.quantity AS TEXT) || oi.option_label, ' · ') AS summary
    FROM orders o LEFT JOIN order_items oi ON oi.order_id=o.id
    WHERE o.customer_id=? AND o.status!='cancelled'
    GROUP BY o.id ORDER BY o.created_at DESC LIMIT 5
  `).bind(customerId).all();
  const frequent = await db().prepare(`
    SELECT oi.product_id,COUNT(*) AS order_count,MAX(o.created_at) AS last_ordered
    FROM orders o JOIN order_items oi ON oi.order_id=o.id
    WHERE o.customer_id=? AND o.status!='cancelled' AND o.created_at>=datetime('now','-180 days')
    GROUP BY oi.product_id ORDER BY order_count DESC,last_ordered DESC LIMIT 12
  `).bind(customerId).all();
  const usual = await db().prepare(`
    SELECT oi.product_id,oi.product_name,oi.option_label,COUNT(*) AS order_count,AVG(oi.quantity) AS avg_qty,MAX(o.created_at) AS last_ordered
    FROM orders o JOIN order_items oi ON oi.order_id=o.id
    WHERE o.customer_id=? AND o.status!='cancelled' AND o.created_at>=datetime('now','-180 days')
    GROUP BY oi.product_id,oi.option_label
    ORDER BY order_count DESC,last_ordered DESC LIMIT 16
  `).bind(customerId).all();
  const lastOrder = await db().prepare(`SELECT id FROM orders WHERE customer_id=? AND status!='cancelled' ORDER BY created_at DESC LIMIT 1`).bind(customerId).first<{ id: string }>();
  let lastItems: Array<Record<string, unknown>> = [];
  if (lastOrder?.id) {
    const result = await db().prepare(`SELECT product_id,product_name,option_label,quantity FROM order_items WHERE order_id=? ORDER BY id`).bind(lastOrder.id).all();
    lastItems = result.results as Array<Record<string, unknown>>;
  }

  const weekdayTemplates: Array<{ weekday: number; label: string; orderId: string | null; orderedAt: string | null; items: Array<{ productId: string; productName: string; optionLabel: string; quantity: number }> }> = [];
  const labels = ["", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];
  for (let weekday = 1; weekday <= 6; weekday++) {
    const order = await db().prepare(`
      SELECT id,created_at FROM orders
      WHERE customer_id=? AND status!='cancelled' AND CAST(strftime('%w', datetime(created_at,'+9 hours')) AS INTEGER)=?
      ORDER BY created_at DESC LIMIT 1
    `).bind(customerId, weekday).first<{ id: string; created_at: string }>();
    let items: Array<{ productId: string; productName: string; optionLabel: string; quantity: number }> = [];
    if (order?.id) {
      const rows = await db().prepare("SELECT product_id,product_name,option_label,quantity FROM order_items WHERE order_id=? ORDER BY id").bind(order.id).all();
      items = (rows.results as Array<Record<string, unknown>>).map((r) => ({ productId: String(r.product_id), productName: String(r.product_name), optionLabel: String(r.option_label), quantity: Number(r.quantity) }));
    }
    weekdayTemplates.push({ weekday, label: labels[weekday], orderId: order?.id ?? null, orderedAt: order?.created_at ?? null, items });
  }

  return {
    recent: (recent.results as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id), status: String(r.status), total: Number(r.total_amount ?? 0), createdAt: String(r.created_at), deliveryDate: String(r.delivery_date ?? ""), summary: String(r.summary ?? ""), printed: Boolean(r.printed_at),
    })),
    frequentProductIds: (frequent.results as Array<Record<string, unknown>>).map((r) => String(r.product_id)),
    usualOrderItems: (usual.results as Array<Record<string, unknown>>).map((r) => ({ productId: String(r.product_id), productName: String(r.product_name), optionLabel: String(r.option_label), quantity: Math.max(0.001, Math.round(Number(r.avg_qty ?? 1) * 10) / 10), orderCount: Number(r.order_count ?? 0) })),
    lastOrderItems: lastItems.map((r) => ({ productId: String(r.product_id), productName: String(r.product_name), optionLabel: String(r.option_label), quantity: Number(r.quantity) })),
    weekdayTemplates,
  };
}
