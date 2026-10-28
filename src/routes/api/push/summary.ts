import { createFileRoute } from "@tanstack/react-router";
import { pendingSummary, pushTokenValid } from "../../../lib/alerts.server";

/** 휴대폰 서비스워커가 빈 푸시를 받으면 호출. 구독할 때 받은 토큰이 있어야 요약을 돌려줌 */
export const Route = createFileRoute("/api/push/summary")({
  server: { handlers: { GET: async ({ request }) => {
    const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!(await pushTokenValid(token))) return Response.json({ error: "알림 구독 정보가 없습니다." }, { status: 401 });
    const summary = await pendingSummary();
    return Response.json({ ...summary, url: "/alerts", tag: "buja-orders" }, { headers: { "Cache-Control": "no-store" } });
  } } },
});
