import { createFileRoute } from "@tanstack/react-router";
import { isAdmin, validMutationOrigin } from "../../../lib/auth.server";
import { addPushSubscription, removePushSubscription } from "../../../lib/alerts.server";
import { ensureDatabase } from "../../../lib/db.server";

/** 사장님 휴대폰 푸시 구독 (관리자 로그인 필요) */
export const Route = createFileRoute("/api/push/subscribe")({
  server: { handlers: {
    POST: async ({ request }) => {
      if (!validMutationOrigin(request) || !(await isAdmin(request))) return Response.json({ error: "관리자 로그인이 필요합니다." }, { status: 403 });
      await ensureDatabase();
      try {
        const body = await request.json() as { endpoint?: string; label?: string };
        const token = await addPushSubscription(String(body.endpoint ?? ""), String(body.label ?? "휴대폰"));
        return Response.json({ ok: true, token }, { headers: { "Cache-Control": "no-store" } });
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "알림 등록에 실패했습니다." }, { status: 400 });
      }
    },
    DELETE: async ({ request }) => {
      if (!validMutationOrigin(request) || !(await isAdmin(request))) return Response.json({ error: "관리자 로그인이 필요합니다." }, { status: 403 });
      await ensureDatabase();
      const body = await request.json().catch(() => ({})) as { endpoint?: string };
      await removePushSubscription(String(body.endpoint ?? ""));
      return Response.json({ ok: true });
    },
  } },
});
