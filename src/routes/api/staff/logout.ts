import { createFileRoute } from "@tanstack/react-router";
import { clearStaffSessionCookie, logoutStaff, validMutationOrigin } from "../../../lib/auth.server";

export const Route = createFileRoute("/api/staff/logout")({
  server: { handlers: { POST: async ({ request }) => {
    if (!validMutationOrigin(request)) return Response.json({ error: "잘못된 요청입니다." }, { status: 403 });
    await logoutStaff(request);
    return Response.json({ ok: true }, { headers: { "Set-Cookie": clearStaffSessionCookie(), "Cache-Control": "no-store" } });
  } } },
});
