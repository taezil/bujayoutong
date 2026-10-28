import { createFileRoute } from "@tanstack/react-router";
import {
  DeskError, deskChangeState, deskErrorResponse, deskHistory, deskJson, deskOpenOrders, deskOrderById, deskPulse, requireDeskStaff,
} from "../../../lib/desk.server";
import type { DeskAction } from "../../../lib/desk.server";

const ACTIONS: DeskAction[] = ["start", "release", "done", "reopen"];

export const Route = createFileRoute("/api/desk/orders")({
  server: { handlers: {
    // ?scope=open (기본): 입력완료 전 전체 / ?scope=history&from=&to=&q=&dateField=created|delivery&state=done|all|open / ?id=주문번호
    GET: async ({ request }) => {
      try {
        await requireDeskStaff(request);
        const url = new URL(request.url);
        const id = (url.searchParams.get("id") ?? "").trim().slice(0, 80);
        if (id) {
          const order = await deskOrderById(id);
          if (!order) throw new DeskError("주문을 찾을 수 없습니다.", 404);
          return deskJson({ ok: true, order });
        }
        if (url.searchParams.get("scope") === "history") {
          const orders = await deskHistory({
            from: url.searchParams.get("from") ?? "", to: url.searchParams.get("to") ?? "", q: url.searchParams.get("q") ?? "",
            dateField: url.searchParams.get("dateField") ?? "created", state: url.searchParams.get("state") ?? "done",
            limit: Number(url.searchParams.get("limit") ?? 300),
          });
          return deskJson({ ok: true, orders });
        }
        const [orders, pulse] = await Promise.all([deskOpenOrders(), deskPulse()]);
        return deskJson({ ok: true, orders, marker: pulse.marker, serverTime: pulse.serverTime });
      } catch (error) {
        return deskErrorResponse(error, "주문 목록을 불러오지 못했습니다.");
      }
    },
    // { action: start|release|done|reopen, orderId, force? }
    POST: async ({ request }) => {
      try {
        const staff = await requireDeskStaff(request);
        const body = await request.json().catch(() => ({})) as { action?: string; orderId?: string; force?: boolean };
        const action = String(body.action ?? "") as DeskAction;
        if (!ACTIONS.includes(action)) throw new DeskError("지원하지 않는 작업입니다.");
        const orderId = String(body.orderId ?? "").trim().slice(0, 80);
        if (!orderId) throw new DeskError("주문을 선택해 주세요.");
        const result = await deskChangeState(staff, orderId, action, body.force === true);
        return deskJson(result);
      } catch (error) {
        return deskErrorResponse(error, "처리상태를 바꾸지 못했습니다.");
      }
    },
  } },
});
