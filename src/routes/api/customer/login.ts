import { createFileRoute } from "@tanstack/react-router";
import { customerSessionCookie, loginCustomer, validMutationOrigin } from "../../../lib/auth.server";

export const Route = createFileRoute("/api/customer/login")({
  server: { handlers: { POST: async ({ request }) => {
    if (!validMutationOrigin(request)) return Response.json({ error: "잘못된 요청입니다." }, { status: 403 });
    try {
      const body = await request.json() as { identifier?: string; code?: string; pin?: string; password?: string; username?: string };
      // identifier/password가 현재 로그인 방식이며 code/pin/username은 기존 캐시 클라이언트 호환용입니다.
      const identifier = String(body.identifier || body.username || body.code || "");
      const password = String(body.password ?? body.pin ?? "");
      const token = await loginCustomer(identifier, password);
      return Response.json({ ok: true }, { headers: { "Set-Cookie": customerSessionCookie(token), "Cache-Control": "no-store" } });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "로그인에 실패했습니다." }, { status: 401 });
    }
  } } },
});
