import { createFileRoute } from "@tanstack/react-router";
import { deskErrorResponse, deskJson, deskPulse, requireDeskStaff } from "../../../lib/desk.server";

// 가벼운 변경 확인용 (PC 프로그램이 몇 초마다 호출). 값이 바뀌었을 때만 /api/desk/orders 를 다시 받음
export const Route = createFileRoute("/api/desk/pulse")({
  server: { handlers: { GET: async ({ request }) => {
    try {
      const staff = await requireDeskStaff(request);
      const pulse = await deskPulse();
      return deskJson({ ok: true, ...pulse, staff: { id: staff.id, username: staff.username, displayName: staff.displayName, role: staff.role, deviceName: staff.deviceName } });
    } catch (error) {
      return deskErrorResponse(error, "서버 상태를 확인하지 못했습니다.");
    }
  } } },
});
