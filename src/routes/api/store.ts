import { createFileRoute } from "@tanstack/react-router";
import { getCustomer, isAdmin } from "../../lib/auth.server";
import { db, ensureDatabase, readStore } from "../../lib/db.server";

export const Route = createFileRoute("/api/store")({
  server: { handlers: { GET: async ({ request }) => {
    try {
      const url = new URL(request.url);
      if (url.searchParams.get("health") === "1") {
        const database = db();
        await ensureDatabase(database);
        const [total, erp, options, marker, importError] = await Promise.all([
          database.prepare("SELECT COUNT(*) AS count FROM products").first<{ count: number }>(),
          database.prepare("SELECT COUNT(*) AS count FROM products WHERE id LIKE 'ERP-%'").first<{ count: number }>(),
          database.prepare("SELECT COUNT(*) AS count FROM pack_options").first<{ count: number }>(),
          database.prepare("SELECT value FROM app_settings WHERE key='excel_catalog_import_v1'").first<{ value: string }>(),
          database.prepare("SELECT value FROM app_settings WHERE key='excel_catalog_import_error'").first<{ value: string }>(),
        ]);
        return Response.json({
          totalProducts: Number(total?.count ?? 0),
          erpProducts: Number(erp?.count ?? 0),
          packOptions: Number(options?.count ?? 0),
          imported: marker?.value === "1",
          error: importError?.value ?? "",
        }, { headers: { "Cache-Control": "no-store" } });
      }

      const customer = await getCustomer(request);
      // 관리자 화면은 ?all=1 로 숨김 상품까지 받아감 (관리자 인증 필수)
      const wantsAll = url.searchParams.get("all") === "1";
      const includeHidden = wantsAll && await isAdmin(request);
      const store = await readStore(customer?.priceGroup, { includeHidden });
      return Response.json(store, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      console.error(error);
      return Response.json({ error: "상품을 불러오지 못했습니다." }, { status: 500 });
    }
  } } },
});
