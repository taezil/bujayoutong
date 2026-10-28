import { createFileRoute } from "@tanstack/react-router";
import { deskErrorResponse, deskJson, deskLogin } from "../../../lib/desk.server";

// 발주 알림센터(PC 프로그램) 로그인: 직원 아이디 + 6자리 PIN → PC 전용 토큰 발급
export const Route = createFileRoute("/api/desk/login")({
  server: { handlers: { POST: async ({ request }) => {
    try {
      const body = await request.json().catch(() => ({})) as { username?: string; pin?: string; deviceName?: string };
      const result = await deskLogin(request, String(body.username ?? ""), String(body.pin ?? ""), String(body.deviceName ?? ""));
      return deskJson({ ok: true, token: result.token, staff: result.staff });
    } catch (error) {
      return deskErrorResponse(error, "로그인에 실패했습니다.");
    }
  } } },
});
