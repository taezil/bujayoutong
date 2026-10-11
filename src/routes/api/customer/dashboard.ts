import { createFileRoute } from "@tanstack/react-router";
import { getCustomer } from "../../../lib/auth.server";
import { customerDashboard } from "../../../lib/orders.server";

export const Route = createFileRoute("/api/customer/dashboard")({
  server: { handlers: { GET: async ({ request }) => {
    const customer = await getCustomer(request);
    if (!customer) return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });
    return Response.json(await customerDashboard(customer.id), { headers: { "Cache-Control": "no-store" } });
  } } },
});
