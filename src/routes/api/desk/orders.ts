import { createFileRoute } from "@tanstack/react-router";
import {
  DeskError, deskChangeState, deskDeleteOrder, deskErrorResponse, deskHistory, deskJson, deskOpenOrders, deskOrderById, deskPulse, requireDeskStaff,
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
        const body = await request.json().catch(() => ({})) as { action?: string; orderId?: string; force?: boolean; reason?: string };
        // 합친 발주: 여러 주문을 한 번에 처리 (각 주문마다 결과를 돌려줌)
        const many = (body as { orderIds?: unknown }).orderIds;
        if (Array.isArray(many)) {
          const ids = Array.from(new Set(many.map((v) => String(v ?? "").trim().slice(0, 80)).filter(Boolean))).slice(0, 50);
          if (!ids.length) throw new DeskError("주문을 선택해 주세요.");
          const action = String(body.action ?? "");
          if (action !== "delete" && !ACTIONS.includes(action as DeskAction)) throw new DeskError("지원하지 않는 작업입니다.");
          const results: Array<Record<string, unknown>> = [];
          for (const id of ids) {
            try {
              const result = action === "delete"
                ? await deskDeleteOrder(staff, id, String(body.reason ?? ""))
                : await deskChangeState(staff, id, action as DeskAction, body.force === true);
              results.push({ id, ok: true, order: result.order, alreadyDone: (result as { alreadyDone?: boolean }).alreadyDone ?? false });
            } catch (error) {
              if (error instanceof DeskError && error.status < 500) {
                results.push({ id, ok: false, error: error.message, status: error.status, order: (error.extra as { order?: unknown }).order });
                continue;
              }
              throw error;
            }
          }
          return deskJson({ ok: true, results });
        }
        if (body.action === "delete") {
          const orderId = String(body.orderId ?? "").trim().slice(0, 80);
          if (!orderId) throw new DeskError("주문을 선택해 주세요.");
          return deskJson(await deskDeleteOrder(staff, orderId, String(body.reason ?? "")));
        }
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
