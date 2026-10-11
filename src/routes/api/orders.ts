import { createFileRoute } from "@tanstack/react-router";
import { getCustomer, validMutationOrigin } from "../../lib/auth.server";
import { createCustomerOrder, orderAvailability, updateCustomerOrder } from "../../lib/orders.server";

export const Route = createFileRoute("/api/orders")({
  server: { handlers: {
    GET: async ({ request }) => {
      const customer = await getCustomer(request);
      if (!customer) return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });
      return Response.json(await orderAvailability(), { headers: { "Cache-Control": "no-store" } });
    },
    DELETE: async ({ request }) => {
      if (!validMutationOrigin(request)) return Response.json({ error: "잘못된 요청입니다." }, { status: 403 });
      const customer = await getCustomer(request);
      if (!customer) return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });
      try {
        const body = await request.json() as { orderId?: string };
        const id = String(body.orderId ?? "").trim();
        const row = await (await import("../../lib/db.server")).db().prepare(
          "SELECT id,status,printed_at,created_at FROM orders WHERE id=? AND customer_id=?",
        ).bind(id, customer.id).first<Record<string, unknown>>();
        if (!row) throw new Error("주문을 찾을 수 없습니다.");
        if (String(row.status) !== "received" || row.printed_at) throw new Error("이미 출고 준비가 시작되어 앱에서 취소할 수 없습니다. 부자유통으로 연락해 주세요.");
        const availability = await orderAvailability();
        const created = new Date(String(row.created_at).replace(" ", "T") + "Z").getTime();
        if (Date.now() - created > availability.settings.cancelMinutes * 60 * 1000) throw new Error(`주문 후 ${availability.settings.cancelMinutes}분이 지나 앱에서 취소할 수 없습니다.`);
        const database = (await import("../../lib/db.server")).db();
        await database.prepare("UPDATE orders SET status='cancelled',cancelled_at=datetime('now'),updated_at=datetime('now') WHERE id=? AND customer_id=?").bind(id, customer.id).run();
        return Response.json({ ok: true });
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "주문 취소에 실패했습니다." }, { status: 400 });
      }
    },
    PUT: async ({ request }) => {
      if (!validMutationOrigin(request)) return Response.json({ error: "잘못된 요청입니다." }, { status: 403 });
      const customer = await getCustomer(request);
      if (!customer) return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });
      try {
        const body = await request.json() as { orderId?: string; items?: Array<{ productId: string; optionLabel: string; quantity: number }>; note?: string };
        const order = await updateCustomerOrder(customer, String(body.orderId ?? ""), body.items ?? [], String(body.note ?? ""));
        return Response.json({ ok: true, order });
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "주문을 수정하지 못했습니다." }, { status: 400 });
      }
    },
    POST: async ({ request }) => {
      if (!validMutationOrigin(request)) return Response.json({ error: "잘못된 요청입니다." }, { status: 403 });
      const customer = await getCustomer(request);
      if (!customer) return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });
      try {
        const body = await request.json() as { items?: Array<{ productId: string; optionLabel: string; quantity: number }>; note?: string };
        const order = await createCustomerOrder(customer, body.items ?? [], String(body.note ?? ""), "app");
        return Response.json({ ok: true, order });
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "주문을 접수하지 못했습니다." }, { status: 400 });
      }
    },
  } },
});
