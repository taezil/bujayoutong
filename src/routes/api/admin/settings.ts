import { createFileRoute } from "@tanstack/react-router";
import { isAdmin, validMutationOrigin } from "../../../lib/auth.server";
import { bumpVersion, db, ensureDatabase } from "../../../lib/db.server";
import { cleanText } from "../../../lib/admin-validation.server";

function cleanTime(value: unknown, fallback: string) {
  const text = cleanText(value, 5);
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(text) ? text : fallback;
}
function cleanMinutes(value: unknown, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1440, Math.round(n))) : fallback;
}

export const Route = createFileRoute("/api/admin/settings")({
  server: { handlers: { POST: async ({ request }) => {
    if (!validMutationOrigin(request) || !(await isAdmin(request))) return Response.json({ error: "관리자 로그인이 필요합니다." }, { status: 403 });
    try {
      await ensureDatabase();
      const body = await request.json() as Record<string, unknown>;
      const sms = cleanText(body.sms, 30).replace(/[^+0-9]/g, "");
      const promoCategory = cleanText(body.promoCategory, 80);
      if (!/^\+?\d{8,15}$/.test(sms)) throw new Error("문자 수신번호를 확인해 주세요.");
      const category = await db().prepare("SELECT 1 FROM categories WHERE name=?").bind(promoCategory).first();
      if (!category) throw new Error("행사 카테고리를 확인해 주세요.");

      const orderEnabled = body.orderEnabled === false || body.orderEnabled === 0 ? "0" : "1";
      const order24h = body.order24h === false || body.order24h === 0 ? "0" : "1";
      const orderOpenTime = cleanTime(body.orderOpenTime, "00:00");
      const orderCloseTime = cleanTime(body.orderCloseTime, "23:59");
      const editMinutes = String(cleanMinutes(body.editMinutes, 15));
      const cancelMinutes = String(cleanMinutes(body.cancelMinutes, 15));

      await db().batch([
        db().prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('sms',?)").bind(sms),
        db().prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('promoCategory',?)").bind(promoCategory),
        db().prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('orderEnabled',?)").bind(orderEnabled),
        db().prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('order24h',?)").bind(order24h),
        db().prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('orderOpenTime',?)").bind(orderOpenTime),
        db().prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('orderCloseTime',?)").bind(orderCloseTime),
        db().prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('editMinutes',?)").bind(editMinutes),
        db().prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('cancelMinutes',?)").bind(cancelMinutes),
        db().prepare("UPDATE categories SET is_promo=CASE WHEN name=? THEN 1 ELSE 0 END").bind(promoCategory),
      ]);
      await bumpVersion();
      return Response.json({ ok: true });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "설정 저장에 실패했습니다." }, { status: 400 });
    }
  } } },
});
