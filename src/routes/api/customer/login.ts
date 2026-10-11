import { createFileRoute } from "@tanstack/react-router";
import { customerSessionCookie, loginCustomer, validMutationOrigin } from "../../../lib/auth.server";

export const Route = createFileRoute("/api/customer/login")({
  server: { handlers: { POST: async ({ request }) => {
    if (!validMutationOrigin(request)) return Response.json({ error: "잘못된 요청입니다." }, { status: 403 });
    try {
      const body = await request.json() as { code?: string; pin?: string; username?: string };
      const token = await loginCustomer(String(body.code ?? ""), String(body.pin ?? ""), String(body.username ?? ""));
      return Response.json({ ok: true }, { headers: { "Set-Cookie": customerSessionCookie(token), "Cache-Control": "no-store" } });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "로그인에 실패했습니다." }, { status: 401 });
    }
  } } },
});
