import { createFileRoute } from "@tanstack/react-router";
import { clearSessionCookie, clearStaffSessionCookie, logoutAdmin, logoutStaff, validMutationOrigin } from "../../../lib/auth.server";

export const Route = createFileRoute("/api/admin/logout")({
  server: { handlers: { POST: async ({ request }) => {
    if (!validMutationOrigin(request)) return Response.json({ error: "잘못된 요청입니다." }, { status: 403 });
    await Promise.all([logoutAdmin(request), logoutStaff(request)]);
    const headers = new Headers({ "Cache-Control": "no-store" });
    headers.append("Set-Cookie", clearSessionCookie());
    headers.append("Set-Cookie", clearStaffSessionCookie());
    return Response.json({ ok: true }, { headers });
  } } },
});
