import { createFileRoute } from "@tanstack/react-router";
import { getCustomerLocations, validMutationOrigin } from "../../../lib/auth.server";
import { db, ensureDatabase } from "../../../lib/db.server";

/**
 * 거래처 화면 '발주 확인' 알림. 사무실에서 [입력완료]를 누르면 생기고, 거래처가 [확인]을 눌러 닫을 때까지 계속 보임.
 * 로그인 계정에 연결된 모든 배송처의 알림을 보여줌.
 */
export const Route = createFileRoute("/api/customer/notices")({
  server: { handlers: {
    GET: async ({ request }) => {
      const locations = await getCustomerLocations(request);
      if (!locations.length) return Response.json({ notices: [] }, { status: 401 });
      await ensureDatabase();
      const ids = locations.map((location) => location.id);
      const rows = await db().prepare(`
        SELECT id,customer_id,order_id,kind,title,body,created_at FROM customer_notices
        WHERE customer_id IN (${ids.map(() => "?").join(",")}) AND dismissed_at=''
          AND created_at >= datetime('now','-14 days')
        ORDER BY created_at DESC LIMIT 20
      `).bind(...ids).all();
      return Response.json({
        notices: (rows.results as Array<Record<string, unknown>>).map((row) => ({
          id: Number(row.id), orderId: String(row.order_id ?? ""), kind: String(row.kind ?? ""), title: String(row.title ?? ""),
          body: String(row.body ?? ""), createdAt: `${String(row.created_at ?? "").replace(" ", "T")}Z`,
        })),
      }, { headers: { "Cache-Control": "no-store, private" } });
    },
    POST: async ({ request }) => {
      if (!validMutationOrigin(request)) return Response.json({ error: "잘못된 요청입니다." }, { status: 403 });
      const locations = await getCustomerLocations(request);
      if (!locations.length) return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });
      await ensureDatabase();
      const body = await request.json().catch(() => ({})) as { ids?: unknown[] };
      const noticeIds = (Array.isArray(body.ids) ? body.ids : []).map(Number).filter((id) => Number.isInteger(id) && id > 0).slice(0, 50);
      if (!noticeIds.length) return Response.json({ ok: true, dismissed: 0 });
      const customerIds = locations.map((location) => location.id);
      const result = await db().prepare(`
        UPDATE customer_notices SET dismissed_at=datetime('now')
        WHERE id IN (${noticeIds.map(() => "?").join(",")}) AND customer_id IN (${customerIds.map(() => "?").join(",")}) AND dismissed_at=''
      `).bind(...noticeIds, ...customerIds).run();
      return Response.json({ ok: true, dismissed: Number(result.meta?.changes ?? 0) });
    },
  } },
});
