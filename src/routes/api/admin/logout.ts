import { createFileRoute } from "@tanstack/react-router";
import { clearSessionCookie, logoutAdmin, validMutationOrigin } from "../../../lib/auth.server";

export const Route = createFileRoute("/api/admin/logout")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!validMutationOrigin(request)) {
          return Response.json({ error: "잘못된 요청입니다." }, { status: 403 });
        }
        await logoutAdmin(request);
        return Response.json(
          { ok: true },
          { headers: { "Set-Cookie": clearSessionCookie(), "Cache-Control": "no-store" } },
        );
      },
    },
  },
});
