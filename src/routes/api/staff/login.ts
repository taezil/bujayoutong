import { createFileRoute } from "@tanstack/react-router";
import { loginStaff, staffSessionCookie, validMutationOrigin } from "../../../lib/auth.server";

export const Route = createFileRoute("/api/staff/login")({
  server: { handlers: { POST: async ({ request }) => {
    if (!validMutationOrigin(request)) return Response.json({ error: "잘못된 요청입니다." }, { status: 403 });
    try {
      const body = await request.json() as { username?: string; pin?: string };
      const result = await loginStaff(String(body.username ?? ""), String(body.pin ?? ""));
      return Response.json({ ok: true, staff: result.staff }, { headers: { "Set-Cookie": staffSessionCookie(result.token), "Cache-Control": "no-store" } });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "로그인에 실패했습니다." }, { status: 401 });
    }
  } } },
});
