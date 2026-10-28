/**
 * 상차준비표 데이터 (사무실 PC 프로그램 전용).
 * 배송일 하루치 발주를 거래처 구역·창고 위치·보관 구분과 함께 돌려주고, 구역별 묶음·정렬·인쇄는 PC 프로그램이 함.
 * 창고 위치는 '지금' 상품에 저장된 위치를 씀 (주문 뒤에 위치를 정해도 바로 반영). 상품이 지워졌으면 주문 당시 위치.
 */
import { db, ensureDatabase } from "./db.server";
import { listLocations, listZones } from "./zones.server";

export async function loadSheetData(date: string) {
  await ensureDatabase();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("배송일을 확인해 주세요.");
  const [zones, locations, categories, orderRows] = await Promise.all([
    listZones(),
    listLocations(),
    db().prepare("SELECT name,storage,sort_order FROM categories ORDER BY sort_order,name").all(),
    db().prepare(`
      SELECT o.id,o.customer_id,o.delivery_slot,o.delivery_run,o.note,o.created_at,o.load_printed_at,o.source,o.created_by_staff_name,
             o.delivery_location_name,c.code AS customer_code,c.name AS customer_name,TRIM(c.region) AS zone,
             COALESCE(d.state,'new') AS desk_state
      FROM orders o
      JOIN customers c ON c.id=o.customer_id
      LEFT JOIN order_desk_status d ON d.order_id=o.id
      WHERE o.delivery_date=? AND o.status<>'cancelled' AND COALESCE(d.deleted,0)=0
      ORDER BY c.code,o.created_at,o.rowid
      LIMIT 600
    `).bind(date).all(),
  ]);
  const rows = orderRows.results as Array<Record<string, unknown>>;
  const itemsByOrder = new Map<string, Array<Record<string, unknown>>>();
  for (let index = 0; index < rows.length; index += 90) {
    const ids = rows.slice(index, index + 90).map((row) => String(row.id));
    if (!ids.length) continue;
    const items = await db().prepare(`
      SELECT oi.order_id,oi.product_id,oi.product_name,oi.option_label,oi.quantity,
             COALESCE(NULLIF(TRIM(p.warehouse_zone),''),TRIM(oi.warehouse_zone),'') AS location,
             COALESCE(p.category,'') AS category,
             COALESCE((SELECT po.spec FROM pack_options po WHERE po.product_id=oi.product_id AND po.label=oi.option_label ORDER BY po.sort_order,po.id LIMIT 1),'') AS option_spec,
             COALESCE(p.unit,oi.unit,'') AS unit,
             COALESCE(cat.sort_order,9999) AS cat_order,COALESCE(sc.sort_order,9999) AS sub_order,COALESCE(p.sort_order,999999) AS product_order,
             COALESCE((SELECT po2.sort_order FROM pack_options po2 WHERE po2.product_id=oi.product_id AND po2.label=oi.option_label LIMIT 1),99) AS option_order
      FROM order_items oi
      LEFT JOIN products p ON p.id=oi.product_id
      LEFT JOIN categories cat ON cat.name=p.category
      LEFT JOIN subcategories sc ON sc.category_name=p.category AND sc.name=p.sub
      WHERE oi.order_id IN (${ids.map(() => "?").join(",")})
      ORDER BY oi.order_id,cat_order,sub_order,product_order,option_order,oi.id
    `).bind(...ids).all();
    for (const item of items.results as Array<Record<string, unknown>>) {
      const key = String(item.order_id);
      const list = itemsByOrder.get(key) ?? [];
      list.push(item);
      itemsByOrder.set(key, list);
    }
  }
  return {
    date,
    zones: zones.map((zone) => zone.name),
    locations: locations.map((location) => ({ name: location.name, storage: location.storage, sortOrder: location.sortOrder })),
    categoryStorage: Object.fromEntries((categories.results as Array<Record<string, unknown>>).map((row) => [String(row.name), String(row.storage ?? "")])),
    orders: rows.map((row) => ({
      id: String(row.id),
      customerId: String(row.customer_id),
      customerCode: String(row.customer_code ?? ""),
      customerName: String(row.customer_name ?? ""),
      deliveryLocationName: String(row.delivery_location_name ?? ""),
      zone: String(row.zone ?? ""),
      deliverySlot: String(row.delivery_slot ?? ""),
      deliveryRun: String(row.delivery_slot ?? "") === "PM" ? Number(row.delivery_run ?? 0) : 0,
      note: String(row.note ?? ""),
      source: String(row.source ?? ""),
      createdByStaffName: String(row.created_by_staff_name ?? ""),
      createdAt: `${String(row.created_at ?? "").replace(" ", "T")}Z`,
      loadPrintedAt: String(row.load_printed_at ?? ""),
      deskState: String(row.desk_state ?? "new"),
      items: (itemsByOrder.get(String(row.id)) ?? []).map((item) => ({
        productId: String(item.product_id ?? ""),
        productName: String(item.product_name ?? ""),
        unit: String(item.option_label ?? ""),
        spec: String(item.option_spec || item.unit || ""),
        quantity: Number(item.quantity ?? 0),
        location: String(item.location ?? ""),
        category: String(item.category ?? ""),
        sortKey: [Number(item.cat_order ?? 9999), Number(item.sub_order ?? 9999), Number(item.product_order ?? 999999), Number(item.option_order ?? 99)],
      })),
    })),
  };
}

/** 상차준비표 출력 표시 (다음에 '새로 들어온 발주만' 출력할 때 기준) */
export async function markLoadPrinted(orderIds: string[]) {
  const ids = Array.from(new Set(orderIds.map(String).filter(Boolean))).slice(0, 600);
  let changed = 0;
  for (let index = 0; index < ids.length; index += 90) {
    const chunk = ids.slice(index, index + 90);
    const result = await db().prepare(`UPDATE orders SET load_printed_at=datetime('now') WHERE id IN (${chunk.map(() => "?").join(",")})`).bind(...chunk).run();
    changed += Number(result.meta?.changes ?? 0);
  }
  return changed;
}
