import { createFileRoute } from "@tanstack/react-router";
import { isAdmin, makeCustomerPinCredential, validMutationOrigin } from "../../../lib/auth.server";
import { db, ensureDatabase } from "../../../lib/db.server";
import { cleanText } from "../../../lib/admin-validation.server";

export const Route = createFileRoute("/api/admin/customer-users")({
  server: { handlers: {
    GET: async ({ request }) => {
      if (!(await isAdmin(request))) return Response.json({ error: "관리자 로그인이 필요합니다." }, { status: 403 });
      await ensureDatabase();
      const rows = await db().prepare(`
        SELECT u.id,u.customer_id,u.username,u.display_name,u.active,u.updated_at,
               c.code AS customer_code,c.name AS customer_name
        FROM customer_users u
        JOIN customers c ON c.id=u.customer_id
        ORDER BY c.region,c.code,u.display_name
      `).all();
      return Response.json({ users: rows.results }, { headers: { "Cache-Control": "no-store" } });
    },
    POST: async ({ request }) => {
      if (!validMutationOrigin(request) || !(await isAdmin(request))) return Response.json({ error: "관리자 로그인이 필요합니다." }, { status: 403 });
      await ensureDatabase();
      try {
        const body = await request.json() as Record<string, unknown>;
        const action = cleanText(body.action, 30);
        if (action === "create") {
          const customerId = cleanText(body.customerId, 80);
          const username = cleanText(body.username, 40).toLowerCase();
          const displayName = cleanText(body.displayName, 80);
          const pin = cleanText(body.pin, 6);
          if (!customerId || !displayName || !/^[a-z0-9._-]{2,40}$/.test(username)) throw new Error("거래처, 이름, 직원 아이디를 확인해 주세요.");
          const credential = await makeCustomerPinCredential(pin);
          const id = `CU-${crypto.randomUUID()}`;
          await db().prepare("INSERT INTO customer_users(id,customer_id,username,display_name,auth_salt,auth_hash,active) VALUES(?,?,?,?,?,?,1)")
            .bind(id, customerId, username, displayName, credential.salt, credential.hash).run();
          return Response.json({ ok: true, id });
        }
        const id = cleanText(body.id, 80);
        if (!id) throw new Error("거래처 직원 계정을 선택해 주세요.");
        if (action === "update") {
          const username = cleanText(body.username, 40).toLowerCase();
          const displayName = cleanText(body.displayName, 80);
          if (!displayName || !/^[a-z0-9._-]{2,40}$/.test(username)) throw new Error("이름과 직원 아이디를 확인해 주세요.");
          await db().prepare("UPDATE customer_users SET username=?,display_name=?,updated_at=datetime('now') WHERE id=?").bind(username, displayName, id).run();
          return Response.json({ ok: true });
        }
        if (action === "reset-pin") {
          const credential = await makeCustomerPinCredential(cleanText(body.pin, 6));
          await db().prepare("UPDATE customer_users SET auth_salt=?,auth_hash=?,updated_at=datetime('now') WHERE id=?").bind(credential.salt, credential.hash, id).run();
          return Response.json({ ok: true });
        }
        if (action === "toggle") {
          const active = body.active === true || body.active === 1;
          await db().prepare("UPDATE customer_users SET active=?,updated_at=datetime('now') WHERE id=?").bind(active ? 1 : 0, id).run();
          return Response.json({ ok: true });
        }
        throw new Error("지원하지 않는 작업입니다.");
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "거래처 직원 계정 작업에 실패했습니다." }, { status: 400 });
      }
    },
  } },
});
