import { db, ensureDatabase } from "./db.server";
import type { CustomerSummary, OrderSettings } from "./db.server";

function randomOrderId() {
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  const suffix = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  return `O${stamp}${suffix}`;
}

function kstTime() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${hour}:${minute}`;
}

function withinTimeRange(now: string, open: string, close: string) {
  if (open <= close) return now >= open && now <= close;
  return now >= open || now <= close;
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
  return {
    allowed,
    reason: allowed ? "" : `주문 가능시간은 ${settings.openTime} ~ ${settings.closeTime}입니다.`,
    settings,
  };
}

type OrderRequestItem = { productId: string; optionLabel: string; quantity: number };
type PreparedItem = {
  productId: string;
  productName: string;
  unit: string;
  optionLabel: string;
  quantity: number;
  unitPrice: number;
  taxType: string;
  warehouseZone: string;
};

async function prepareItems(customer: CustomerSummary, items: OrderRequestItem[]): Promise<PreparedItem[]> {
  if (!Array.isArray(items) || items.length === 0 || items.length > 100) throw new Error("주문상품을 확인해 주세요.");
  const normalized = items.map((item) => ({
    productId: String(item.productId || "").trim(),
    optionLabel: String(item.optionLabel || "").trim(),
    quantity: Number(item.quantity),
  })).filter((item) => item.productId && item.optionLabel && Number.isFinite(item.quantity) && item.quantity > 0);
  if (normalized.length !== items.length) throw new Error("주문 수량을 확인해 주세요.");

  const prepared: PreparedItem[] = [];
  for (const item of normalized) {
    const row = await db().prepare(`
      SELECT p.id, p.name, p.unit, p.soldout, p.tax_type, p.warehouse_zone,
             po.label, po.price, po.price_a, po.price_b, po.step
      FROM products p JOIN pack_options po ON po.product_id = p.id
      WHERE p.id = ? AND po.label = ? LIMIT 1
    `).bind(item.productId, item.optionLabel).first<Record<string, unknown>>();
    if (!row) throw new Error("판매중이지 않은 상품이 포함되어 있습니다.");
    if (Number(row.soldout ?? 0) === 1) throw new Error(`${String(row.name)}은(는) 현재 품절입니다.`);
    const step = Math.max(0.001, Number(row.step ?? 1));
    const ratio = item.quantity / step;
    if (Math.abs(ratio - Math.round(ratio)) > 0.0001) throw new Error(`${String(row.name)} 수량 단위를 확인해 주세요.`);
    const base = row.price == null ? 0 : Number(row.price);
    const groupPrice = customer.priceGroup === "B" ? row.price_b : row.price_a;
    prepared.push({
      productId: String(row.id),
      productName: String(row.name),
      unit: String(row.unit ?? ""),
      optionLabel: String(row.label),
      quantity: item.quantity,
      unitPrice: groupPrice == null ? base : Number(groupPrice),
      taxType: String(row.tax_type ?? "taxable"),
      warehouseZone: String(row.warehouse_zone ?? ""),
    });
  }
  return prepared;
}

function itemInsert(orderId: string, item: PreparedItem) {
  return db().prepare(`
    INSERT INTO order_items (order_id, product_id, product_name, unit, option_label, quantity, unit_price, tax_type, warehouse_zone)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(orderId, item.productId, item.productName, item.unit, item.optionLabel, item.quantity, item.unitPrice, item.taxType, item.warehouseZone);
}

export async function createCustomerOrder(customer: CustomerSummary, items: OrderRequestItem[], note = "", source = "app") {
  await ensureDatabase();
  if (source === "app") {
    const availability = await orderAvailability();
    if (!availability.allowed) throw new Error(availability.reason);
  }
  const prepared = await prepareItems(customer, items);
  const id = randomOrderId();
  const total = Math.round(prepared.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0));
  await db().batch([
    db().prepare(`INSERT INTO orders (id, customer_id, source, status, region_snapshot, total_amount, note)
                  VALUES (?, ?, ?, 'received', ?, ?, ?)`)
      .bind(id, customer.id, source, customer.region || "미지정", total, String(note || "").slice(0, 500)),
    ...prepared.map((item) => itemInsert(id, item)),
  ]);
  return { id, total, itemCount: prepared.length };
}

export async function updateCustomerOrder(customer: CustomerSummary, orderId: string, items: OrderRequestItem[], note = "") {
  await ensureDatabase();
  const settings = await readOrderSettings();
  const row = await db().prepare(`
    SELECT id,status,printed_at,created_at FROM orders
    WHERE id=? AND customer_id=? LIMIT 1
  `).bind(orderId, customer.id).first<Record<string, unknown>>();
  if (!row) throw new Error("수정할 주문을 찾을 수 없습니다.");
  if (String(row.status) !== "received" || row.printed_at) throw new Error("이미 출고 준비가 시작되어 앱에서 수정할 수 없습니다.");
  const created = new Date(String(row.created_at).replace(" ", "T") + "Z").getTime();
  if (!Number.isFinite(created) || Date.now() - created > settings.editMinutes * 60 * 1000) {
    throw new Error(`주문 후 ${settings.editMinutes}분이 지나 앱에서 수정할 수 없습니다.`);
  }

  const prepared = await prepareItems(customer, items);
  const total = Math.round(prepared.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0));
  await db().batch([
    db().prepare("DELETE FROM order_items WHERE order_id=?").bind(orderId),
    ...prepared.map((item) => itemInsert(orderId, item)),
    db().prepare("UPDATE orders SET total_amount=?,note=?,updated_at=datetime('now') WHERE id=? AND customer_id=?")
      .bind(total, String(note || "").slice(0, 500), orderId, customer.id),
  ]);
  return { id: orderId, total, itemCount: prepared.length };
}

export async function customerDashboard(customerId: string) {
  await ensureDatabase();
  const recent = await db().prepare(`
    SELECT o.id, o.status, o.total_amount, o.created_at, o.printed_at,
           GROUP_CONCAT(oi.product_name || ' ' || CAST(oi.quantity AS TEXT) || oi.option_label, ' · ') AS summary
    FROM orders o LEFT JOIN order_items oi ON oi.order_id = o.id
    WHERE o.customer_id = ? AND o.status != 'cancelled'
    GROUP BY o.id ORDER BY o.created_at DESC LIMIT 5
  `).bind(customerId).all();
  const frequent = await db().prepare(`
    SELECT oi.product_id, COUNT(*) AS order_count, SUM(oi.quantity) AS total_qty, MAX(o.created_at) AS last_ordered
    FROM orders o JOIN order_items oi ON oi.order_id = o.id
    WHERE o.customer_id = ? AND o.status != 'cancelled' AND o.created_at >= datetime('now', '-180 days')
    GROUP BY oi.product_id ORDER BY order_count DESC, last_ordered DESC LIMIT 12
  `).bind(customerId).all();
  const lastOrder = await db().prepare(`SELECT id FROM orders WHERE customer_id = ? AND status != 'cancelled' ORDER BY created_at DESC LIMIT 1`).bind(customerId).first<{ id: string }>();
  let lastItems: Array<Record<string, unknown>> = [];
  if (lastOrder?.id) {
    const result = await db().prepare(`SELECT product_id, product_name, option_label, quantity FROM order_items WHERE order_id = ? ORDER BY id`).bind(lastOrder.id).all();
    lastItems = result.results as Array<Record<string, unknown>>;
  }
  return {
    recent: (recent.results as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id), status: String(r.status), total: Number(r.total_amount ?? 0), createdAt: String(r.created_at), summary: String(r.summary ?? ""), printed: Boolean(r.printed_at),
    })),
    frequentProductIds: (frequent.results as Array<Record<string, unknown>>).map((r) => String(r.product_id)),
    lastOrderItems: lastItems.map((r) => ({ productId: String(r.product_id), productName: String(r.product_name), optionLabel: String(r.option_label), quantity: Number(r.quantity) })),
  };
}
