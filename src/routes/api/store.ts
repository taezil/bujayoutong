import { createFileRoute } from "@tanstack/react-router";
import { readStore } from "../../lib/db.server";

export const Route = createFileRoute("/api/store")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const store = await readStore();
          return Response.json(store, {
            headers: { "Cache-Control": "no-store" },
          });
        } catch (error) {
          console.error(error);
          return Response.json({ error: "상품을 불러오지 못했습니다." }, { status: 500 });
        }
      },
    },
  },
});
