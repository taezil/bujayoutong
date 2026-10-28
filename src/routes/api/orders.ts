import { createFileRoute } from "@tanstack/react-router";
import { getCustomer, validMutationOrigin } from "../../lib/auth.server";
import { createCustomerOrder, kstDate, orderAvailability, OrderWarningError, updateCustomerOrder } from "../../lib/orders.server";
import { db } from "../../lib/db.server";
import { writeAudit } from "../../lib/audit.server";

function warningResponse(error: unknown) {
  if (error instanceof OrderWarningError) {
    return Response.json({ warning: true, error: error.message, warnings: error.warnings }, { status: 409 });
  }
  return null;
}

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
        const row = await db().prepare("SELECT id,status,printed_at,created_at FROM orders WHERE id=? AND customer_id=?").bind(id, customer.id).first<Record<string, unknown>>();
        if (!row) throw new Error("주문을 찾을 수 없습니다.");
        if (String(row.status) !== "received" || row.printed_at) throw new Error("이미 출고 준비가 시작되어 앱에서 취소할 수 없습니다. 부자유통으로 연락해 주세요.");
        const availability = await orderAvailability();
        const created = new Date(String(row.created_at).replace(" ", "T") + "Z").getTime();
        if (Date.now() - created > availability.settings.cancelMinutes * 60 * 1000) throw new Error(`주문 후 ${availability.settings.cancelMinutes}분이 지나 앱에서 취소할 수 없습니다.`);
        await db().prepare("UPDATE orders SET status='cancelled',cancelled_at=datetime('now'),updated_at=datetime('now') WHERE id=? AND customer_id=?").bind(id, customer.id).run();
        await writeAudit({ actor: { type: "customer", id: customer.id, name: customer.loginName || customer.name }, action: "customer_cancel", entityType: "order", entityId: id, summary: `${customer.code} ${customer.name} 주문 취소` });
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
        const body = await request.json() as { orderId?: string; items?: Array<{ productId: string; optionLabel: string; quantity: number }>; note?: string; confirmAnomaly?: boolean };
        const order = await updateCustomerOrder(customer, String(body.orderId ?? ""), body.items ?? [], String(body.note ?? ""), body.confirmAnomaly === true);
        return Response.json({ ok: true, order });
      } catch (error) {
        const warning = warningResponse(error); if (warning) return warning;
        return Response.json({ error: error instanceof Error ? error.message : "주문을 수정하지 못했습니다." }, { status: 400 });
      }
    },
    POST: async ({ request }) => {
      if (!validMutationOrigin(request)) return Response.json({ error: "잘못된 요청입니다." }, { status: 403 });
      const customer = await getCustomer(request);
      if (!customer) return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });
      try {
        const body = await request.json() as {
          items?: Array<{ productId: string; optionLabel: string; quantity: number }>; note?: string; confirmAnomaly?: boolean;
          requestId?: string; deliveryDate?: string; deliveryLocationId?: string;
        };
        const requestId = String(body.requestId ?? "").trim();
        if (requestId && !/^[A-Za-z0-9_-]{8,64}$/.test(requestId)) throw new Error("주문 요청 정보가 올바르지 않습니다. 화면을 새로고침해 주세요.");
        const deliveryDate = String(body.deliveryDate ?? "").trim();
        if (deliveryDate && (!/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate) || deliveryDate < kstDate())) throw new Error("배송일은 오늘 이후 날짜로 선택해 주세요.");
        const deliveryLocationId = String(body.deliveryLocationId ?? "").trim();
        let deliveryLocation: { id: string; name: string; address: string; phone: string } | null = null;
        if (deliveryLocationId) {
          // 추가 배송처는 현재 거래처에 연결된 사용중 배송처만 허용
          const row = await db().prepare("SELECT id,name,address,phone FROM customer_delivery_locations WHERE id=? AND customer_id=? AND active=1 LIMIT 1")
            .bind(deliveryLocationId, customer.id).first<Record<string, unknown>>();
          if (!row) throw new Error("선택한 배송처를 사용할 수 없습니다. 배송처를 다시 선택해 주세요.");
          deliveryLocation = { id: String(row.id), name: String(row.name ?? ""), address: String(row.address ?? ""), phone: String(row.phone ?? "") };
        }
        const order = await createCustomerOrder(customer, body.items ?? [], String(body.note ?? ""), "app", {
          confirmAnomaly: body.confirmAnomaly === true, clientRequestId: requestId, deliveryDate: deliveryDate || undefined, deliveryLocation,
        });
        // 같은 요청을 다시 보낸 경우(네트워크 재시도 등): 이미 저장된 주문을 그대로 돌려주고 기록은 남기지 않음
        if (order.duplicate) return Response.json({ ok: true, order }, { headers: { "Cache-Control": "no-store" } });
        // 주문은 이미 저장됨: 기록 저장이 실패해도 거래처에는 접수 성공으로 응답해야 함 (재시도 시 중복 방지 키로 같은 주문 반환)
        await writeAudit({
          actor: { type: "customer", id: customer.id, name: customer.loginName || customer.name },
          action: "customer_order",
          entityType: "order",
          entityId: order.id,
          summary: `🚨 새 발주 · ${customer.code} ${customer.name}${deliveryLocation ? ` (${deliveryLocation.name})` : ""} · ${order.orderPeriod === "PM" ? "오후발주" : "오전발주"} · 배송 ${order.deliveryDate}`,
          metadata: { customerId: customer.id, customerCode: customer.code, deliveryDate: order.deliveryDate, orderPeriod: order.orderPeriod },
        }).catch((auditError) => console.error("order audit failed", auditError));
        return Response.json({ ok: true, order }, { headers: { "Cache-Control": "no-store" } });
      } catch (error) {
        const warning = warningResponse(error); if (warning) return warning;
        return Response.json({ error: error instanceof Error ? error.message : "주문을 접수하지 못했습니다." }, { status: 400 });
      }
    },
  } },
});
