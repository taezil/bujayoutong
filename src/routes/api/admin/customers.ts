import { createFileRoute } from "@tanstack/react-router";
import { isAdmin, makeCustomerPinCredential, normalizeCustomerCode, revokeCustomerSessions, validMutationOrigin } from "../../../lib/auth.server";
import { db, ensureDatabase } from "../../../lib/db.server";
import { cleanText } from "../../../lib/admin-validation.server";

function cleanPriceGroup(value: unknown) { return value === "B" ? "B" : "A"; }

export const Route = createFileRoute("/api/admin/customers")({
  server: { handlers: {
    GET: async ({ request }) => {
      if (!(await isAdmin(request))) return Response.json({ error: "관리자 로그인이 필요합니다." }, { status: 403 });
      await ensureDatabase();
      const rows = await db().prepare(`
        SELECT c.id,c.code,c.name,c.phone,c.business_number,c.address,c.store_phone,c.region,c.price_group,c.active,c.updated_at,
               COALESCE((SELECT SUM(amount) FROM receivable_ledger r WHERE r.customer_id=c.id),0) AS receivable,
               (SELECT MAX(created_at) FROM orders o WHERE o.customer_id=c.id) AS last_order_at
        FROM customers c ORDER BY c.region, c.code, c.name
      `).all();
      return Response.json({ customers: (rows.results as Array<Record<string, unknown>>).map((r) => ({
        id:String(r.id),code:String(r.code),name:String(r.name),phone:String(r.phone??""),businessNumber:String(r.business_number??""),
        address:String(r.address??""),storePhone:String(r.store_phone??""),region:String(r.region??""),priceGroup:String(r.price_group??"A"),
        active:Number(r.active??0)===1,receivable:Number(r.receivable??0),lastOrderAt:r.last_order_at?String(r.last_order_at):null,
      })) }, { headers: { "Cache-Control": "no-store" } });
    },
    POST: async ({ request }) => {
      if (!validMutationOrigin(request) || !(await isAdmin(request))) return Response.json({ error: "관리자 로그인이 필요합니다." }, { status: 403 });
      await ensureDatabase();
      try {
        const body = await request.json() as Record<string, unknown>;
        const action = cleanText(body.action, 30);
        if (action === "create") {
          const code = normalizeCustomerCode(cleanText(body.code, 40));
          const name = cleanText(body.name, 120);
          const pin = cleanText(body.pin, 6);
          if (!code || !name) throw new Error("거래처번호와 거래처명을 입력해 주세요.");
          const credential = await makeCustomerPinCredential(pin);
          const id = `C-${crypto.randomUUID()}`;
          await db().prepare(`INSERT INTO customers
            (id,code,name,phone,business_number,address,store_phone,region,price_group,auth_salt,auth_hash,active)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,1)`)
            .bind(id,code,name,cleanText(body.phone,30),cleanText(body.businessNumber,30),cleanText(body.address,240),cleanText(body.storePhone,30),cleanText(body.region,80),cleanPriceGroup(body.priceGroup),credential.salt,credential.hash).run();
          return Response.json({ ok:true,id });
        }
        const id = cleanText(body.id, 80);
        if (!id) throw new Error("거래처를 선택해 주세요.");
        if (action === "update") {
          const code = normalizeCustomerCode(cleanText(body.code, 40));
          const name = cleanText(body.name, 120);
          if (!code || !name) throw new Error("거래처번호와 거래처명을 입력해 주세요.");
          await db().prepare(`UPDATE customers SET code=?,name=?,phone=?,business_number=?,address=?,store_phone=?,region=?,price_group=?,updated_at=datetime('now') WHERE id=?`)
            .bind(code,name,cleanText(body.phone,30),cleanText(body.businessNumber,30),cleanText(body.address,240),cleanText(body.storePhone,30),cleanText(body.region,80),cleanPriceGroup(body.priceGroup),id).run();
          return Response.json({ok:true});
        }
        if (action === "reset-pin") {
          const credential = await makeCustomerPinCredential(cleanText(body.pin,6));
          await db().prepare("UPDATE customers SET auth_salt=?,auth_hash=?,updated_at=datetime('now') WHERE id=?").bind(credential.salt,credential.hash,id).run();
          await revokeCustomerSessions(id);
          return Response.json({ok:true});
        }
        if (action === "toggle") {
          const active = body.active === true || body.active === 1;
          await db().prepare("UPDATE customers SET active=?,updated_at=datetime('now') WHERE id=?").bind(active?1:0,id).run();
          if (!active) await revokeCustomerSessions(id);
          return Response.json({ok:true});
        }
        if (action === "logout-all") {
          await revokeCustomerSessions(id);
          return Response.json({ok:true});
        }
        if (action === "payment") {
          const amount = Math.round(Number(body.amount));
          if (!Number.isFinite(amount) || amount <= 0) throw new Error("입금액을 확인해 주세요.");
          const method = cleanText(body.method,30) || "bank";
          const note = cleanText(body.note,200);
          await db().batch([
            db().prepare("INSERT INTO payments(customer_id,amount,method,note) VALUES(?,?,?,?)").bind(id,amount,method,note),
            db().prepare("INSERT INTO receivable_ledger(customer_id,amount,event_type,note) VALUES(?,?,'payment',?)").bind(id,-amount,note || "입금"),
          ]);
          return Response.json({ok:true});
        }
        throw new Error("지원하지 않는 작업입니다.");
      } catch (error) {
        return Response.json({error:error instanceof Error?error.message:"거래처 작업에 실패했습니다."},{status:400});
      }
    },
  } },
});
