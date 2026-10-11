import { createFileRoute } from "@tanstack/react-router";
import { createAdmin, sessionCookie, validMutationOrigin } from "../../../lib/auth.server";

export const Route = createFileRoute("/api/admin/setup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!validMutationOrigin(request)) {
          return Response.json({ error: "잘못된 요청입니다." }, { status: 403 });
        }
        try {
          const body = await request.json() as { key?: string; password?: string };
          const token = await createAdmin(String(body.password ?? ""), String(body.key ?? ""));
          return Response.json(
            { ok: true },
            { headers: { "Set-Cookie": sessionCookie(token), "Cache-Control": "no-store" } },
          );
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : "관리자 설정에 실패했습니다." },
            { status: 400 },
          );
        }
      },
    },
  },
});
