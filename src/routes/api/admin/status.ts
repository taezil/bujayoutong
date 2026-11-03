import { createFileRoute } from "@tanstack/react-router";
import { adminSetupRequired, getAdminIdentity } from "../../../lib/auth.server";

export const Route = createFileRoute("/api/admin/status")({
  server: { handlers: { GET: async ({ request }) => {
    const admin = await getAdminIdentity(request);
    return Response.json({
      setupRequired: await adminSetupRequired(),
      authenticated: Boolean(admin),
      admin: admin ? { username: admin.username, displayName: admin.displayName } : null,
    }, { headers: { "Cache-Control": "no-store" } });
  } } },
});
