import { createFileRoute } from "@tanstack/react-router";
import { getStaff, isAdmin, makeCustomerPinCredential, normalizeCustomerCode, revokeCustomerSessions, validMutationOrigin } from "../../../lib/auth.server";
import { db, ensureDatabase } from "../../../lib/db.server";
import { cleanText } from "../../../lib/admin-validation.server";
import { writeAudit, staffActor } from "../../../lib/audit.server";

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
        const staff = await getStaff(request);
        const actor = staff ? staffActor(staff) : { type: "admin" as const, id: "legacy-admin", name: "관리자" };
        if (action === "import-batch") {
          const rawRows = Array.isArray(body.rows) ? body.rows : [];
          if (!rawRows.length || rawRows.length > 50) throw new Error("한 번에 1~50개 거래처만 등록할 수 있습니다.");

          const statements = [];
          let activeCount = 0;
          let inactiveCount = 0;
          const imported: Array<{code:string;name:string;active:boolean}> = [];

          for (const raw of rawRows) {
            if (!raw || typeof raw !== "object") continue;
            const row = raw as Record<string, unknown>;
            const code = normalizeCustomerCode(cleanText(row.code, 40));
            const name = cleanText(row.name, 120);
            if (!code || !name) continue;

            const phone = cleanText(row.phone, 30);
            const businessNumber = cleanText(row.businessNumber, 30);
            const address = cleanText(row.address, 240);
            const storePhone = cleanText(row.storePhone, 30);
            const region = cleanText(row.region, 80);
            const active = row.active === false || row.active === 0 || String(row.active) === "0" ? 0 : 1;
            if (active) activeCount += 1; else inactiveCount += 1;

            statements.push(
              db().prepare(`
                INSERT INTO customers
                  (id,code,name,phone,business_number,address,store_phone,region,price_group,active)
                VALUES (?,?,?,?,?,?,?,?, 'A', ?)
                ON CONFLICT(code) DO UPDATE SET
                  name=excluded.name,
                  phone=CASE WHEN excluded.phone<>'' THEN excluded.phone ELSE customers.phone END,
                  business_number=CASE WHEN excluded.business_number<>'' THEN excluded.business_number ELSE customers.business_number END,
                  address=CASE WHEN excluded.address<>'' THEN excluded.address ELSE customers.address END,
                  store_phone=CASE WHEN excluded.store_phone<>'' THEN excluded.store_phone ELSE customers.store_phone END,
                  region=CASE WHEN excluded.region<>'' THEN excluded.region ELSE customers.region END,
                  active=excluded.active,
                  updated_at=datetime('now')
              `).bind(
                `C-ERP-${code}`, code, name, phone, businessNumber, address, storePhone, region, active,
              ),
            );
            if (!active) {
              statements.push(
                db().prepare("DELETE FROM customer_sessions WHERE customer_id IN (SELECT id FROM customers WHERE code=?)").bind(code),
              );
            }
            imported.push({ code, name, active: active === 1 });
          }

          if (!statements.length) throw new Error("등록할 거래처 데이터가 없습니다.");
          await db().batch(statements);
          await writeAudit({
            actor,
            action:"customer_bulk_import",
            entityType:"customer",
            entityId:"bulk",
            summary:`거래처 일괄등록 ${imported.length}곳 (활성 ${activeCount}, 비활성 ${inactiveCount})`,
            metadata:{count:imported.length,activeCount,inactiveCount},
          });
          return Response.json({ ok:true, imported:imported.length, active:activeCount, inactive:inactiveCount });
        }
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
          await writeAudit({actor,action:"customer_create",entityType:"customer",entityId:id,summary:`거래처 ${code} ${name} 추가`});
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
          await writeAudit({actor,action:"customer_update",entityType:"customer",entityId:id,summary:`거래처 ${code} ${name} 정보수정`});
          return Response.json({ok:true});
        }
        if (action === "reset-pin") {
          const credential = await makeCustomerPinCredential(cleanText(body.pin,6));
          await db().prepare("UPDATE customers SET auth_salt=?,auth_hash=?,updated_at=datetime('now') WHERE id=?").bind(credential.salt,credential.hash,id).run();
          await revokeCustomerSessions(id);
          await writeAudit({actor,action:"customer_pin_reset",entityType:"customer",entityId:id,summary:`거래처 로그인 PIN 초기화`});
          return Response.json({ok:true});
        }
        if (action === "toggle") {
          const active = body.active === true || body.active === 1;
          await db().prepare("UPDATE customers SET active=?,updated_at=datetime('now') WHERE id=?").bind(active?1:0,id).run();
          if (!active) await revokeCustomerSessions(id);
          await writeAudit({actor,action:"customer_toggle",entityType:"customer",entityId:id,summary:`거래처 계정 ${active ? "사용" : "중지"}`});
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
          const c = await db().prepare("SELECT code,name FROM customers WHERE id=?").bind(id).first<{code:string;name:string}>();
          await writeAudit({actor,action:"payment",entityType:"customer",entityId:id,summary:`${c?.code ?? ""} ${c?.name ?? ""} 입금 ${amount.toLocaleString()}원 등록`});
          return Response.json({ok:true});
        }
        throw new Error("지원하지 않는 작업입니다.");
      } catch (error) {
        return Response.json({error:error instanceof Error?error.message:"거래처 작업에 실패했습니다."},{status:400});
      }
    },
  } },
});
