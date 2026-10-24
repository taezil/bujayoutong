import { createFileRoute } from "@tanstack/react-router";
import { getCustomer, isAdmin } from "../../lib/auth.server";
import { db, ensureDatabase, readStore } from "../../lib/db.server";
import { CATALOG_SQL_CHUNKS } from "../../catalog-sql.generated";


async function ensureCatalogImportV3() {
  const database = db();
  await ensureDatabase(database);

  const done = await database
    .prepare("SELECT value FROM app_settings WHERE key='excel_catalog_import_v3'")
    .first<{ value: string }>();
  if (done?.value === "1") return;

  try {
    for (const sql of CATALOG_SQL_CHUNKS) {
      if (sql.trim()) await database.exec(sql);
    }
    await database.prepare("DELETE FROM app_settings WHERE key='excel_catalog_import_error'").run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Catalog v3 import failed", error);
    try {
      await database
        .prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('excel_catalog_import_error',?)")
        .bind(message.slice(0, 1000))
        .run();
    } catch {}
  }
}

export const Route = createFileRoute("/api/store")({
  server: { handlers: { GET: async ({ request }) => {
    try {
      const url = new URL(request.url);
      await ensureCatalogImportV3();
      if (url.searchParams.get("health") === "1") {
        const database = db();
        const [total, erp, options, marker, importError] = await Promise.all([
          database.prepare("SELECT COUNT(*) AS count FROM products").first<{ count: number }>(),
          database.prepare("SELECT COUNT(*) AS count FROM products WHERE id LIKE 'ERP-%'").first<{ count: number }>(),
          database.prepare("SELECT COUNT(*) AS count FROM pack_options").first<{ count: number }>(),
          database.prepare("SELECT value FROM app_settings WHERE key='excel_catalog_import_v3'").first<{ value: string }>(),
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
