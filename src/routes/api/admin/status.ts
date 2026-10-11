import { createFileRoute } from "@tanstack/react-router";
import { adminSetupRequired, getStaff, isAdmin } from "../../../lib/auth.server";

export const Route = createFileRoute("/api/admin/status")({
  server: { handlers: { GET: async ({ request }) => {
    const staff = await getStaff(request);
    return Response.json({
      setupRequired: await adminSetupRequired(),
      authenticated: await isAdmin(request),
      staff: staff?.role === "ADMIN" ? staff : null,
    }, { headers: { "Cache-Control": "no-store" } });
  } } },
});
