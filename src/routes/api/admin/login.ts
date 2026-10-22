import { createFileRoute } from "@tanstack/react-router";
import { loginAdmin, sessionCookie, validMutationOrigin } from "../../../lib/auth.server";

export const Route = createFileRoute("/api/admin/login")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!validMutationOrigin(request)) {
          return Response.json({ error: "잘못된 요청입니다." }, { status: 403 });
        }
        try {
          const body = await request.json() as { username?: string; password?: string };
          const token = await loginAdmin(String(body.username ?? ""), String(body.password ?? ""));
          return Response.json(
            { ok: true },
            { headers: { "Set-Cookie": sessionCookie(token), "Cache-Control": "no-store" } },
          );
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : "로그인에 실패했습니다." },
            { status: 401 },
          );
        }
      },
    },
  },
});
