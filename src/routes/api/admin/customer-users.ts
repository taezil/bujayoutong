import { createFileRoute } from "@tanstack/react-router";
import { isAdmin, makeCustomerPasswordCredential, validMutationOrigin } from "../../../lib/auth.server";
import { db, ensureDatabase } from "../../../lib/db.server";
import { cleanText } from "../../../lib/admin-validation.server";
import { normalizeLoginId } from "../../../lib/customer-login-id";
import { LOGIN_ID_PATTERN, planCustomerAccounts, runCustomerAccountPlan } from "../../../lib/customer-accounts.server";

async function assertCustomerUsernameAvailable(username: string, customerId: string, excludeId = "") {
  const employee = await db().prepare(
    "SELECT id FROM customer_users WHERE replace(lower(username),'-','')=? AND id<>? LIMIT 1",
  ).bind(username, excludeId).first();
  if (employee) throw new Error("이미 사용 중인 거래처 아이디입니다.");

  const customer = await db().prepare(
    "SELECT id FROM customers WHERE replace(lower(code),'-','')=? AND id<>? LIMIT 1",
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
      const links = await db().prepare(
        "SELECT customer_user_id,customer_id,sort_order FROM customer_user_customers ORDER BY customer_user_id,sort_order,customer_id",
      ).all();
      const deliveryLocations = await db().prepare(`
        SELECT id,customer_id,name,address,phone,note,active,sort_order
        FROM customer_delivery_locations
        ORDER BY customer_id,sort_order,name,id
      `).all();
      return Response.json({ users: rows.results, links: links.results, deliveryLocations: deliveryLocations.results }, { headers: { "Cache-Control": "no-store" } });
    },
    POST: async ({ request }) => {
      if (!validMutationOrigin(request) || !(await isAdmin(request))) return Response.json({ error: "관리자 로그인이 필요합니다." }, { status: 403 });
      await ensureDatabase();
      try {
        const body = await request.json() as Record<string, unknown>;
        const action = cleanText(body.action, 30);
        // 거래처 계정 일괄 생성: 미리보기 → 실행(나눠서 반복 호출)
        if (action === "provision-preview") {
          const plan = await planCustomerAccounts(db());
          return Response.json({ ok: true, ...plan }, { headers: { "Cache-Control": "no-store" } });
        }
        if (action === "provision-run") {
          const limit = Math.max(1, Math.min(30, Math.floor(Number(body.limit) || 20)));
          const result = await runCustomerAccountPlan(db(), limit);
          return Response.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
        }
        if (action === "create-delivery-location") {
          const customerId = cleanText(body.customerId, 80);
          const name = cleanText(body.name, 80);
          const address = cleanText(body.address, 240);
          const phone = cleanText(body.phone, 30);
          const note = cleanText(body.note, 200);
          if (!customerId || !name) throw new Error("거래처와 배송처 이름을 입력해 주세요.");
          const customer = await db().prepare("SELECT id FROM customers WHERE id=? AND active=1 LIMIT 1").bind(customerId).first();
          if (!customer) throw new Error("사용할 수 없는 거래처입니다.");
          const id = `DL-${crypto.randomUUID()}`;
          const orderRow = await db().prepare("SELECT COALESCE(MAX(sort_order),-1)+1 AS next_sort FROM customer_delivery_locations WHERE customer_id=?").bind(customerId).first<{next_sort:number}>();
          await db().prepare(`
            INSERT INTO customer_delivery_locations(id,customer_id,name,address,phone,note,active,sort_order)
            VALUES(?,?,?,?,?,?,1,?)
          `).bind(id,customerId,name,address,phone,note,Number(orderRow?.next_sort ?? 0)).run();
          return Response.json({ ok: true, id });
        }
        if (action === "update-delivery-location") {
          const deliveryLocationId = cleanText(body.deliveryLocationId, 80);
          const name = cleanText(body.name, 80);
          if (!deliveryLocationId || !name) throw new Error("배송처와 배송처 이름을 확인해 주세요.");
          await db().prepare(`
            UPDATE customer_delivery_locations
            SET name=?,address=?,phone=?,note=?,updated_at=datetime('now')
            WHERE id=?
          `).bind(name,cleanText(body.address,240),cleanText(body.phone,30),cleanText(body.note,200),deliveryLocationId).run();
          return Response.json({ ok: true });
        }
        if (action === "toggle-delivery-location") {
          const deliveryLocationId = cleanText(body.deliveryLocationId, 80);
          const active = body.active === true || body.active === 1;
          if (!deliveryLocationId) throw new Error("배송처를 선택해 주세요.");
          await db().prepare("UPDATE customer_delivery_locations SET active=?,updated_at=datetime('now') WHERE id=?")
            .bind(active ? 1 : 0, deliveryLocationId).run();
          return Response.json({ ok: true });
        }
        if (action === "delete-delivery-location") {
          const deliveryLocationId = cleanText(body.deliveryLocationId, 80);
          if (!deliveryLocationId) throw new Error("배송처를 선택해 주세요.");
          const used = await db().prepare("SELECT id FROM orders WHERE delivery_location_id=? LIMIT 1").bind(deliveryLocationId).first();
          if (used) {
            await db().prepare("UPDATE customer_delivery_locations SET active=0,updated_at=datetime('now') WHERE id=?").bind(deliveryLocationId).run();
          } else {
            await db().prepare("DELETE FROM customer_delivery_locations WHERE id=?").bind(deliveryLocationId).run();
          }
          return Response.json({ ok: true, archived: Boolean(used) });
        }
        if (action === "create") {
          const customerId = cleanText(body.customerId, 80);
          const username = normalizeLoginId(cleanText(body.username, 40));
          const displayName = cleanText(body.displayName, 80);
          const password = cleanText(body.password ?? body.pin, 64);
          if (!customerId || !displayName || !LOGIN_ID_PATTERN.test(username)) throw new Error("거래처, 이름, 로그인 아이디를 확인해 주세요.");
          await assertCustomerUsernameAvailable(username, customerId);
          const credential = await makeCustomerPasswordCredential(password);
          const id = `CU-${crypto.randomUUID()}`;
          await db().batch([
            db().prepare("INSERT INTO customer_users(id,customer_id,username,display_name,auth_salt,auth_hash,active) VALUES(?,?,?,?,?,?,1)")
              .bind(id, customerId, username, displayName, credential.salt, credential.hash),
            db().prepare("INSERT OR IGNORE INTO customer_user_customers(customer_user_id,customer_id,sort_order) VALUES(?,?,0)")
              .bind(id, customerId),
          ]);
          return Response.json({ ok: true, id });
        }
        const id = cleanText(body.id, 80);
        if (!id) throw new Error("거래처 직원 계정을 선택해 주세요.");
        if (action === "set-customers") {
          const rawIds = Array.isArray(body.customerIds) ? body.customerIds : [];
          const customerIds = Array.from(new Set(rawIds.map((value) => cleanText(value, 80)).filter(Boolean)));
          if (!customerIds.length) throw new Error("배송처를 한 곳 이상 선택해 주세요.");

          const validRows = await db().prepare(
            `SELECT id FROM customers WHERE active=1 AND id IN (${customerIds.map(() => "?").join(",")})`,
          ).bind(...customerIds).all<{ id: string }>();
          const validIds = new Set(validRows.results.map((row) => String(row.id)));
          if (validIds.size !== customerIds.length) throw new Error("사용할 수 없는 거래처가 포함되어 있습니다.");

          const owner = await db().prepare("SELECT id FROM customer_users WHERE id=? LIMIT 1").bind(id).first();
          if (!owner) throw new Error("거래처 계정을 찾을 수 없습니다.");

          const statements = [
            db().prepare("DELETE FROM customer_user_customers WHERE customer_user_id=?").bind(id),
            ...customerIds.map((customerId, index) => db().prepare(
              "INSERT INTO customer_user_customers(customer_user_id,customer_id,sort_order) VALUES(?,?,?)",
            ).bind(id, customerId, index)),
            db().prepare("UPDATE customer_users SET customer_id=?,updated_at=datetime('now') WHERE id=?").bind(customerIds[0], id),
            db().prepare("UPDATE customer_sessions SET customer_id=? WHERE customer_user_id=?").bind(customerIds[0], id),
          ];
          await db().batch(statements);
          return Response.json({ ok: true });
        }
        if (action === "update") {
          const username = normalizeLoginId(cleanText(body.username, 40));
          const displayName = cleanText(body.displayName, 80);
          if (!displayName || !LOGIN_ID_PATTERN.test(username)) throw new Error("이름과 로그인 아이디를 확인해 주세요.");
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
