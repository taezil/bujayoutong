import { createFileRoute } from "@tanstack/react-router";
import { isAdmin, makeCustomerPasswordCredential, validMutationOrigin } from "../../../lib/auth.server";
import { db, ensureDatabase } from "../../../lib/db.server";
import { cleanText } from "../../../lib/admin-validation.server";

async function assertCustomerUsernameAvailable(username: string, customerId: string, excludeId = "") {
  const employee = await db().prepare(
    "SELECT id FROM customer_users WHERE lower(username)=lower(?) AND id<>? LIMIT 1",
  ).bind(username, excludeId).first();
  if (employee) throw new Error("이미 사용 중인 거래처 아이디입니다.");

  const customer = await db().prepare(
    "SELECT id FROM customers WHERE lower(code)=lower(?) AND id<>? LIMIT 1",
  ).bind(username, customerId).first();
  if (customer) throw new Error("다른 거래처번호와 같은 아이디는 사용할 수 없습니다.");
}

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
          const password = cleanText(body.password ?? body.pin, 64);
          if (!customerId || !displayName || !/^[a-z0-9._-]{2,40}$/.test(username)) throw new Error("거래처, 이름, 직원 아이디를 확인해 주세요.");
          await assertCustomerUsernameAvailable(username, customerId);
          const credential = await makeCustomerPasswordCredential(password);
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
          const owner = await db().prepare("SELECT customer_id FROM customer_users WHERE id=? LIMIT 1").bind(id).first<{ customer_id: string }>();
          if (!owner?.customer_id) throw new Error("거래처 계정을 찾을 수 없습니다.");
          await assertCustomerUsernameAvailable(username, owner.customer_id, id);
          await db().batch([
            db().prepare("UPDATE customer_users SET username=?,display_name=?,updated_at=datetime('now') WHERE id=?").bind(username, displayName, id),
            db().prepare("DELETE FROM customer_sessions WHERE customer_user_id=?").bind(id),
          ]);
          return Response.json({ ok: true });
        }
        if (action === "reset-password" || action === "reset-pin") {
          const credential = await makeCustomerPasswordCredential(cleanText(body.password ?? body.pin, 64));
          await db().batch([
            db().prepare("UPDATE customer_users SET auth_salt=?,auth_hash=?,updated_at=datetime('now') WHERE id=?").bind(credential.salt, credential.hash, id),
            db().prepare("DELETE FROM customer_sessions WHERE customer_user_id=?").bind(id),
          ]);
          return Response.json({ ok: true });
        }
        if (action === "toggle") {
          const active = body.active === true || body.active === 1;
          await db().batch([
            db().prepare("UPDATE customer_users SET active=?,updated_at=datetime('now') WHERE id=?").bind(active ? 1 : 0, id),
            ...(!active ? [db().prepare("DELETE FROM customer_sessions WHERE customer_user_id=?").bind(id)] : []),
          ]);
          return Response.json({ ok: true });
        }
        throw new Error("지원하지 않는 작업입니다.");
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "거래처 직원 계정 작업에 실패했습니다." }, { status: 400 });
      }
    },
  } },
});
