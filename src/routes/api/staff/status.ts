import { createFileRoute } from "@tanstack/react-router";
import { getStaff } from "../../../lib/auth.server";

export const Route = createFileRoute("/api/staff/status")({
  server: { handlers: { GET: async ({ request }) => {
    const staff = await getStaff(request);
    return Response.json({ authenticated: Boolean(staff), staff }, { headers: { "Cache-Control": "no-store" } });
  } } },
});
