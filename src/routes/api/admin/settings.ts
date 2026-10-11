import { createFileRoute } from "@tanstack/react-router";
import { isAdmin, validMutationOrigin } from "../../../lib/auth.server";
import { bumpVersion, db } from "../../../lib/db.server";
import { cleanText } from "../../../lib/admin-validation.server";

export const Route = createFileRoute("/api/admin/settings")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!validMutationOrigin(request) || !(await isAdmin(request))) {
          return Response.json({ error: "관리자 로그인이 필요합니다." }, { status: 403 });
        }
        try {
          const body = await request.json() as { sms?: string; promoCategory?: string };
          const sms = cleanText(body.sms, 30).replace(/[^+0-9]/g, "");
          const promoCategory = cleanText(body.promoCategory, 80);
          if (!/^\+?\d{8,15}$/.test(sms)) throw new Error("문자 수신번호를 확인해 주세요.");
          const category = await db().prepare("SELECT 1 FROM categories WHERE name=?").bind(promoCategory).first();
          if (!category) throw new Error("행사 카테고리를 확인해 주세요.");

          await db().batch([
            db().prepare("UPDATE app_settings SET value=? WHERE key='sms'").bind(sms),
            db().prepare("UPDATE app_settings SET value=? WHERE key='promoCategory'").bind(promoCategory),
            db().prepare("UPDATE categories SET is_promo=CASE WHEN name=? THEN 1 ELSE 0 END").bind(promoCategory),
          ]);
          await bumpVersion();
          return Response.json({ ok: true });
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : "설정 저장에 실패했습니다." },
            { status: 400 },
          );
        }
      },
    },
  },
});
