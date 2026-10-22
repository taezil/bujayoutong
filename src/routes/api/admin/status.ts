import { createFileRoute } from "@tanstack/react-router";
import { adminSetupRequired, isAdmin } from "../../../lib/auth.server";

export const Route = createFileRoute("/api/admin/status")({
  server: { handlers: { GET: async ({ request }) => {
    return Response.json({
      setupRequired: await adminSetupRequired(),
      authenticated: await isAdmin(request),
    }, { headers: { "Cache-Control": "no-store" } });
  } } },
});
