import { createFileRoute } from "@tanstack/react-router";
import { isAdmin, validMutationOrigin } from "../../../lib/auth.server";
import { connectTelegramChat, pendingSummary, publicAlertSettings, readAlertSettings, runEscalation, saveAlertSettings, sendTestAlert, vapidPublicKey } from "../../../lib/alerts.server";
import { ensureDatabase } from "../../../lib/db.server";

/** 휴대폰 알림 설정 (앱 푸시·텔레그램·반복 알림). 발주 처리 기능은 없음 */
export const Route = createFileRoute("/api/admin/alerts")({
  server: { handlers: {
    GET: async ({ request }) => {
      if (!(await isAdmin(request))) return Response.json({ error: "관리자 로그인이 필요합니다." }, { status: 403 });
      await ensureDatabase();
      const [settings, pending, publicKey] = await Promise.all([readAlertSettings(), pendingSummary(), vapidPublicKey()]);
      return Response.json({ settings: publicAlertSettings(settings), pending, publicKey }, { headers: { "Cache-Control": "no-store" } });
    },
    POST: async ({ request }) => {
      if (!validMutationOrigin(request) || !(await isAdmin(request))) return Response.json({ error: "관리자 로그인이 필요합니다." }, { status: 403 });
      await ensureDatabase();
      try {
        const body = await request.json() as Record<string, unknown>;
        const action = String(body.action ?? "");
        if (action === "save") {
          await saveAlertSettings(body);
          return Response.json({ ok: true, message: "저장했습니다." });
        }
        if (action === "telegram-connect") {
          const name = await connectTelegramChat();
          return Response.json({ ok: true, message: `텔레그램 '${name}' 대화방에 연결했습니다.` });
        }
        if (action === "test") {
          const result = await sendTestAlert();
          return Response.json({ ok: true, message: `테스트 알림 · 텔레그램 ${result.telegram} · 앱 푸시 ${result.push}` });
        }
        if (action === "run-escalation") {
          const count = await runEscalation(body.force === true);
          return Response.json({ ok: true, count, message: `다시 알림 ${count}건` });
        }
        throw new Error("알 수 없는 작업입니다.");
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "처리하지 못했습니다." }, { status: 400 });
      }
    },
  } },
});
