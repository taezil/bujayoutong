import { createFileRoute } from "@tanstack/react-router";
import { getCustomer } from "../../lib/auth.server";
import { readStore } from "../../lib/db.server";

export const Route = createFileRoute("/api/store")({
  server: { handlers: { GET: async ({ request }) => {
    try {
      const customer = await getCustomer(request);
      const store = await readStore(customer?.priceGroup);
      return Response.json(store, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      console.error(error);
      return Response.json({ error: "상품을 불러오지 못했습니다." }, { status: 500 });
    }
  } } },
});
