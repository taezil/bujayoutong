import { createFileRoute } from "@tanstack/react-router";
import { deskErrorResponse, deskJson, deskLogout } from "../../../lib/desk.server";

export const Route = createFileRoute("/api/desk/logout")({
  server: { handlers: { POST: async ({ request }) => {
    try {
      await deskLogout(request);
      return deskJson({ ok: true });
    } catch (error) {
      return deskErrorResponse(error, "로그아웃에 실패했습니다.");
    }
  } } },
});
