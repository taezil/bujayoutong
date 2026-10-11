import { createFileRoute } from "@tanstack/react-router";
import { isAdmin, validMutationOrigin } from "../../../lib/auth.server";
import { bumpVersion, db } from "../../../lib/db.server";
import { cleanText } from "../../../lib/admin-validation.server";

type Body = {
  action?: string;
  category?: string;
  sub?: string;
  name?: string;
};

export const Route = createFileRoute("/api/admin/categories")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!validMutationOrigin(request) || !(await isAdmin(request))) {
          return Response.json({ error: "관리자 로그인이 필요합니다." }, { status: 403 });
        }
        try {
          const body = await request.json() as Body;
          const database = db();
          const category = cleanText(body.category, 80);
          const sub = cleanText(body.sub, 80);
          const name = cleanText(body.name, 80);

          if (body.action === "add-category") {
            if (!name) throw new Error("카테고리명을 입력해 주세요.");
            const row = await database.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM categories").first<{ n: number }>();
            await database.prepare("INSERT INTO categories (name,sort_order,is_promo) VALUES (?,?,0)").bind(name, Number(row?.n ?? 0)).run();
          } else if (body.action === "rename-category") {
            if (!category || !name) throw new Error("카테고리명이 필요합니다.");
            await database.batch([
              database.prepare("UPDATE categories SET name=? WHERE name=?").bind(name, category),
              database.prepare("UPDATE subcategories SET category_name=? WHERE category_name=?").bind(name, category),
              database.prepare("UPDATE products SET category=?,updated_at=datetime('now') WHERE category=?").bind(name, category),
              database.prepare("UPDATE app_settings SET value=? WHERE key='promoCategory' AND value=?").bind(name, category),
            ]);
          } else if (body.action === "delete-category") {
            const used = await database.prepare("SELECT COUNT(*) AS n FROM products WHERE category=?").bind(category).first<{ n: number }>();
            if (Number(used?.n ?? 0) > 0) throw new Error("상품이 들어 있는 카테고리는 삭제할 수 없습니다.");
            await database.batch([
              database.prepare("DELETE FROM subcategories WHERE category_name=?").bind(category),
              database.prepare("DELETE FROM categories WHERE name=?").bind(category),
            ]);
          } else if (body.action === "add-sub") {
            if (!category || !name) throw new Error("카테고리와 세부 카테고리명이 필요합니다.");
            const row = await database.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM subcategories WHERE category_name=?").bind(category).first<{ n: number }>();
            await database.prepare("INSERT INTO subcategories (category_name,name,sort_order) VALUES (?,?,?)").bind(category, name, Number(row?.n ?? 0)).run();
          } else if (body.action === "rename-sub") {
            if (!category || !sub || !name) throw new Error("세부 카테고리 정보가 필요합니다.");
            await database.batch([
              database.prepare("UPDATE subcategories SET name=? WHERE category_name=? AND name=?").bind(name, category, sub),
              database.prepare("UPDATE products SET sub=?,updated_at=datetime('now') WHERE category=? AND sub=?").bind(name, category, sub),
            ]);
          } else if (body.action === "delete-sub") {
            const used = await database.prepare("SELECT COUNT(*) AS n FROM products WHERE category=? AND sub=?").bind(category, sub).first<{ n: number }>();
            if (Number(used?.n ?? 0) > 0) throw new Error("상품이 들어 있는 세부 카테고리는 삭제할 수 없습니다.");
            await database.prepare("DELETE FROM subcategories WHERE category_name=? AND name=?").bind(category, sub).run();
          } else {
            throw new Error("지원하지 않는 작업입니다.");
          }

          await bumpVersion(database);
          return Response.json({ ok: true });
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : "카테고리 저장에 실패했습니다." },
            { status: 400 },
          );
        }
      },
    },
  },
});
