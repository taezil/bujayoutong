import { createFileRoute } from "@tanstack/react-router";
import { getCustomerLocations } from "../../../lib/auth.server";

export const Route = createFileRoute("/api/customer/status")({
  server: { handlers: { GET: async ({ request }) => {
    // 현재 배송처가 첫 번째로 오도록 정렬되어 있음
    const locations = await getCustomerLocations(request);
    const customer = locations[0] ?? null;
    return Response.json(
      { authenticated: Boolean(customer), customer, locations },
      { headers: { "Cache-Control": "no-store, private" } },
    );
  } } },
});
