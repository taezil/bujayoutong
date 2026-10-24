import { createFileRoute } from "@tanstack/react-router";
import { db, ensureDatabase } from "../../lib/db.server";

export const Route = createFileRoute("/api/catalog-health")({
  server: { handlers: { GET: async () => {
    const database = db();
    await ensureDatabase(database);
    const [total, erp, options, marker, error] = await Promise.all([
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
      error: error?.value ?? "",
    }, { headers: { "Cache-Control": "no-store" } });
  } } },
});
