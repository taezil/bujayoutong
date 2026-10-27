import { createFileRoute } from "@tanstack/react-router";
import { getCustomer, switchCustomerLocation, validMutationOrigin } from "../../../lib/auth.server";

export const Route = createFileRoute("/api/customer/switch")({
  server: { handlers: { POST: async ({ request }) => {
    if (!validMutationOrigin(request)) return Response.json({ error: "잘못된 요청입니다." }, { status: 403 });
    try {
      const current = await getCustomer(request);
      if (!current) return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });
      const body = await request.json() as { customerId?: string };
      const customerId = String(body.customerId ?? "").trim();
      if (!customerId) throw new Error("배송처를 선택해 주세요.");
      await switchCustomerLocation(request, customerId);
      const customer = await getCustomer(request);
      return Response.json({ ok: true, customer }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "배송처 변경에 실패했습니다." }, { status: 400 });
    }
  } } },
});
