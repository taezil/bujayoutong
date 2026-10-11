import { createFileRoute } from "@tanstack/react-router";
import { getCustomer } from "../../../lib/auth.server";

export const Route = createFileRoute("/api/customer/status")({
  server: { handlers: { GET: async ({ request }) => {
    const customer = await getCustomer(request);
    return Response.json({ authenticated: Boolean(customer), customer }, { headers: { "Cache-Control": "no-store" } });
  } } },
});
