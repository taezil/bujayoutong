import { createFileRoute } from "@tanstack/react-router";
import { getCustomerLocations, switchCustomerLocation, validMutationOrigin } from "../../../lib/auth.server";

export const Route = createFileRoute("/api/customer/switch")({
  server: { handlers: { POST: async ({ request }) => {
    if (!validMutationOrigin(request)) return Response.json({ error: "잘못된 요청입니다." }, { status: 403 });
    try {
      const body = await request.json().catch(() => ({})) as { customerId?: string };
      const customerId = String(body.customerId ?? "").trim();
      if (!customerId) throw new Error("배송처를 선택해 주세요.");
      // 권한 검증은 서버에서: 로그인 계정에 연결(customer_user_customers)된 배송처만 허용
      await switchCustomerLocation(request, customerId);
      const locations = await getCustomerLocations(request);
      return Response.json({ ok: true, customer: locations[0] ?? null, locations }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      const message = error instanceof Error ? error.message : "배송처 변경에 실패했습니다.";
      const status = message === "로그인이 필요합니다." ? 401 : message === "선택할 수 없는 배송처입니다." ? 403 : 400;
      return Response.json({ error: message }, { status });
    }
  } } },
});
