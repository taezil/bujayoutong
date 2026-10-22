import { createFileRoute } from "@tanstack/react-router";
import { getCustomer, isAdmin } from "../../lib/auth.server";
import { readStore } from "../../lib/db.server";

export const Route = createFileRoute("/api/store")({
  server: { handlers: { GET: async ({ request }) => {
    try {
      const customer = await getCustomer(request);
      // 관리자 화면은 ?all=1 로 숨김 상품까지 받아감 (관리자 인증 필수)
      const wantsAll = new URL(request.url).searchParams.get("all") === "1";
      const includeHidden = wantsAll && await isAdmin(request);
      const store = await readStore(customer?.priceGroup, { includeHidden });
      return Response.json(store, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      console.error(error);
      return Response.json({ error: "상품을 불러오지 못했습니다." }, { status: 500 });
    }
  } } },
});
