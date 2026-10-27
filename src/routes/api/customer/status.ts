import { createFileRoute } from "@tanstack/react-router";
import { getCustomerLocations } from "../../../lib/auth.server";
import { db, ensureDatabase } from "../../../lib/db.server";

export const Route = createFileRoute("/api/customer/status")({
  server: { handlers: { GET: async ({ request }) => {
    // 현재 배송처가 첫 번째로 오도록 정렬되어 있음
    const locations = await getCustomerLocations(request);
    const customer = locations[0] ?? null;
    await ensureDatabase();
    const deliveryRows = customer
      ? await db().prepare(`
          SELECT id,customer_id,name,address,phone,note,active,sort_order
          FROM customer_delivery_locations
          WHERE customer_id=? AND active=1
          ORDER BY sort_order,name,id
        `).bind(customer.id).all()
      : { results: [] };
    return Response.json(
      { authenticated: Boolean(customer), customer, locations, deliveryLocations: deliveryRows.results },
      { headers: { "Cache-Control": "no-store, private" } },
    );
  } } },
});
