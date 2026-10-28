import { createFileRoute } from "@tanstack/react-router";
import { getCustomerLocations } from "../../../lib/auth.server";
import { db, ensureDatabase } from "../../../lib/db.server";
import { ruleForRegion } from "../../../lib/zones.server";

export const Route = createFileRoute("/api/customer/status")({
  server: { handlers: { GET: async ({ request }) => {
    // 현재 배송처가 첫 번째로 오도록 정렬되어 있음
    const locations = await getCustomerLocations(request);
    const customer = locations[0] ?? null;
    await ensureDatabase();
    const customerIds = locations.map((location) => location.id);
    const deliveryRows = customerIds.length
      ? await db().prepare(`
          SELECT id,customer_id,name,address,phone,note,active,sort_order
          FROM customer_delivery_locations
          WHERE customer_id IN (${customerIds.map(() => "?").join(",")}) AND active=1
          ORDER BY customer_id,sort_order,name,id
        `).bind(...customerIds).all()
      : { results: [] };
    // 이 거래처 구역의 배송 마감 규칙 (달력·오전/오후 차수 표시용. 서버도 같은 규칙으로 다시 확인)
    const deliveryRule = customer ? await ruleForRegion(customer.region) : null;
    return Response.json(
      { authenticated: Boolean(customer), customer, locations, deliveryLocations: deliveryRows.results, deliveryRule, serverNow: Date.now() },
      { headers: { "Cache-Control": "no-store, private" } },
    );
  } } },
});
