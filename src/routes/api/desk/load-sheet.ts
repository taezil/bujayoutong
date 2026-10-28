import { createFileRoute } from "@tanstack/react-router";
import { DeskError, deskErrorResponse, deskJson, requireDeskStaff } from "../../../lib/desk.server";
import { loadSheetData, markLoadPrinted } from "../../../lib/load-sheet.server";
import { writeAudit } from "../../../lib/audit.server";

// 상차준비표: 배송일 하루치 발주 + 구역·창고 위치 (PC 프로그램이 구역별로 묶어 인쇄)
export const Route = createFileRoute("/api/desk/load-sheet")({
  server: { handlers: {
    GET: async ({ request }) => {
      try {
        await requireDeskStaff(request);
        const date = new URL(request.url).searchParams.get("date") ?? "";
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new DeskError("배송일을 확인해 주세요.");
        return deskJson({ ok: true, ...(await loadSheetData(date)) });
      } catch (error) {
        return deskErrorResponse(error, "상차준비표를 불러오지 못했습니다.");
      }
    },
    POST: async ({ request }) => {
      try {
        const staff = await requireDeskStaff(request);
        const body = await request.json().catch(() => ({})) as { orderIds?: unknown[]; label?: string };
        const ids = Array.isArray(body.orderIds) ? body.orderIds.map(String) : [];
        if (!ids.length) throw new DeskError("출력한 발주가 없습니다.");
        const changed = await markLoadPrinted(ids);
        await writeAudit({
          actor: { type: "staff", id: staff.id, name: staff.displayName },
          action: "desk_load_sheet", entityType: "order", entityId: ids[0],
          summary: `상차준비표 출력 · ${String(body.label ?? "").slice(0, 80)} · 발주 ${ids.length}건 · ${staff.deviceName}`,
        }).catch(() => undefined);
        return deskJson({ ok: true, changed });
      } catch (error) {
        return deskErrorResponse(error, "출력 기록을 저장하지 못했습니다.");
      }
    },
  } },
});
