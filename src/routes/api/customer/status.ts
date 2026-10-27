import { createFileRoute } from "@tanstack/react-router";
import { getCustomer, getCustomerLocations } from "../../../lib/auth.server";

export const Route = createFileRoute("/api/customer/status")({
  server: { handlers: { GET: async ({ request }) => {
    const customer = await getCustomer(request);
    const locations = customer ? await getCustomerLocations(request) : [];
    return Response.json({ authenticated: Boolean(customer), customer, locations }, { headers: { "Cache-Control": "no-store" } });
  } } },
});
