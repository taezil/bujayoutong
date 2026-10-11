import { createFileRoute } from "@tanstack/react-router";
import { clearCustomerSessionCookie, logoutCustomer, validMutationOrigin } from "../../../lib/auth.server";

export const Route = createFileRoute("/api/customer/logout")({
  server: { handlers: { POST: async ({ request }) => {
    if (!validMutationOrigin(request)) return Response.json({ error: "잘못된 요청입니다." }, { status: 403 });
    await logoutCustomer(request);
    return Response.json({ ok: true }, { headers: { "Set-Cookie": clearCustomerSessionCookie(), "Cache-Control": "no-store" } });
  } } },
});
