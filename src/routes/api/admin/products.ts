import { createFileRoute } from "@tanstack/react-router";
import { getStaff, isAdmin, validMutationOrigin } from "../../../lib/auth.server";
import { bumpVersion, db, ensureDatabase } from "../../../lib/db.server";
import { cleanOptions, cleanPrice, cleanText } from "../../../lib/admin-validation.server";
import { writeAudit, staffActor } from "../../../lib/audit.server";

type ProductBody = { action?: "create" | "update" | "delete"; product?: Record<string, unknown>; id?: string };

export const Route = createFileRoute("/api/admin/products")({
  server: { handlers: { POST: async ({ request }) => {
    if (!validMutationOrigin(request) || !(await isAdmin(request))) return Response.json({ error: "관리자 로그인이 필요합니다." }, { status: 403 });
    try {
      await ensureDatabase();
      const body = await request.json() as ProductBody;
      const database = db();
      const staff = await getStaff(request);
      const actor = staff ? staffActor(staff) : { type: "admin" as const, id: "legacy-admin", name: "관리자" };
      if (body.action === "delete") {
        const id = cleanText(body.id, 80);
        if (!id) throw new Error("상품 ID가 없습니다.");
        const used = await database.prepare("SELECT 1 FROM order_items WHERE product_id = ? LIMIT 1").bind(id).first();
        if (used) throw new Error("주문 이력이 있는 상품은 삭제 대신 품절 처리해 주세요.");
        await database.batch([
          database.prepare("DELETE FROM pack_options WHERE product_id = ?").bind(id),
          database.prepare("DELETE FROM inventory_stock WHERE product_id = ?").bind(id),
          database.prepare("DELETE FROM products WHERE id = ?").bind(id),
        ]);
        await bumpVersion(database);
        await writeAudit({actor,action:"product_delete",entityType:"product",entityId:id,summary:`상품 ${id} 삭제`});
        return Response.json({ ok: true });
      }

      const input = body.product ?? {};
      const id = cleanText(input.id, 80) || `P-${crypto.randomUUID()}`;
      const name = cleanText(input.name, 120);
      const category = cleanText(input.category, 80);
      const sub = cleanText(input.sub, 80);
      const unit = cleanText(input.unit, 50);
      const photo = cleanText(input.photo, 500);
      const price = cleanPrice(input.price);
      const soldout = input.soldout === true || input.soldout === 1;
      const taxType = input.taxType === "exempt" ? "exempt" : "taxable";
      const warehouseZone = cleanText(input.warehouseZone, 80);
      const description = cleanText(input.description, 1200);
      const servingsPerUnit = cleanText(input.servingsPerUnit, 120);
      const boxContents = cleanText(input.boxContents, 120);
      const servingsPerBox = cleanText(input.servingsPerBox, 120);
      const storageMethod = cleanText(input.storageMethod, 80);
      const priceListVisible = input.priceListVisible !== false && input.priceListVisible !== 0;
      const priceDisplayMode = input.priceDisplayMode === "market" ? "market" : input.priceDisplayMode === "inquiry" ? "inquiry" : "fixed";
      const hidden = input.hidden === true || input.hidden === 1;
      const promoPrice = input.promoPrice === null || input.promoPrice === undefined || input.promoPrice === "" ? null : cleanPrice(input.promoPrice);
      const options = cleanOptions(input.packOptions);
      if (!name || !category) throw new Error("상품명과 카테고리는 필수입니다.");
      if (!options.length) throw new Error("판매 단위를 하나 이상 입력해 주세요.");

      const categoryExists = await database.prepare("SELECT 1 FROM categories WHERE name = ?").bind(category).first();
      if (!categoryExists) throw new Error("존재하지 않는 카테고리입니다.");
      if (sub) {
        const subExists = await database.prepare("SELECT 1 FROM subcategories WHERE category_name = ? AND name = ?").bind(category, sub).first();
        if (!subExists) throw new Error("존재하지 않는 세부 카테고리입니다.");
      }

      if (body.action === "create") {
        const sortRow = await database.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM products").first<{ n: number }>();
        await database.prepare("INSERT INTO products (id,name,category,sub,unit,price,soldout,photo,sort_order,tax_type,warehouse_zone,description,servings_per_unit,box_contents,servings_per_box,storage_method,price_list_visible,price_display_mode,hidden,promo_price) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
          .bind(id, name, category, sub, unit, price, soldout ? 1 : 0, photo, Number(sortRow?.n ?? 0), taxType, warehouseZone, description, servingsPerUnit, boxContents, servingsPerBox, storageMethod, priceListVisible ? 1 : 0, priceDisplayMode, hidden ? 1 : 0, promoPrice).run();
      } else if (body.action === "update") {
        const existing = await database.prepare("SELECT id FROM products WHERE id = ?").bind(id).first();
        if (!existing) throw new Error("수정할 상품을 찾을 수 없습니다.");
        await database.prepare("UPDATE products SET name=?,category=?,sub=?,unit=?,price=?,soldout=?,photo=?,tax_type=?,warehouse_zone=?,description=?,servings_per_unit=?,box_contents=?,servings_per_box=?,storage_method=?,price_list_visible=?,price_display_mode=?,hidden=?,promo_price=?,updated_at=datetime('now') WHERE id=?")
          .bind(name, category, sub, unit, price, soldout ? 1 : 0, photo, taxType, warehouseZone, description, servingsPerUnit, boxContents, servingsPerBox, storageMethod, priceListVisible ? 1 : 0, priceDisplayMode, hidden ? 1 : 0, promoPrice, id).run();
      } else throw new Error("지원하지 않는 작업입니다.");

      await database.prepare("DELETE FROM pack_options WHERE product_id = ?").bind(id).run();
      const statements = options.map((option, index) => database.prepare(
        "INSERT INTO pack_options (product_id,label,spec,price,step,sort_order) VALUES (?,?,?,?,?,?)",
      ).bind(id, option.label, option.spec ?? "", option.price, option.step, index));
      if (statements.length) await database.batch(statements);
      await bumpVersion(database);
      await writeAudit({actor,action:body.action === "create" ? "product_create" : "product_update",entityType:"product",entityId:id,summary:`상품 ${name} ${body.action === "create" ? "추가" : "수정"}`});
      return Response.json({ ok: true, id });
    } catch (error) {
      console.error(error);
      return Response.json({ error: error instanceof Error ? error.message : "상품 저장에 실패했습니다." }, { status: 400 });
    }
  } } },
});
