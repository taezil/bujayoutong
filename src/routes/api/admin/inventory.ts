import { createFileRoute } from "@tanstack/react-router";
import { getStaff, isAdmin, validMutationOrigin } from "../../../lib/auth.server";
import { db, ensureDatabase } from "../../../lib/db.server";
import { cleanText } from "../../../lib/admin-validation.server";
import { writeAudit, staffActor } from "../../../lib/audit.server";

export const Route = createFileRoute("/api/admin/inventory")({
  server: { handlers: {
    GET: async ({ request }) => {
      if (!(await isAdmin(request))) return Response.json({error:"관리자 로그인이 필요합니다."},{status:403});
      await ensureDatabase();
      const rows=await db().prepare(`
        SELECT p.id,p.name,p.category,p.warehouse_zone,po.label,
               COALESCE(s.quantity,0) AS quantity
        FROM products p JOIN pack_options po ON po.product_id=p.id
        LEFT JOIN inventory_stock s ON s.product_id=p.id AND s.option_label=po.label
        ORDER BY p.warehouse_zone,p.category,p.name,po.sort_order
      `).all();
      return Response.json({inventory:(rows.results as Array<Record<string,unknown>>).map(r=>({productId:String(r.id),productName:String(r.name),category:String(r.category),warehouseZone:String(r.warehouse_zone??""),optionLabel:String(r.label),quantity:Number(r.quantity??0)}))},{headers:{"Cache-Control":"no-store"}});
    },
    POST: async ({ request }) => {
      if (!validMutationOrigin(request) || !(await isAdmin(request))) return Response.json({error:"관리자 로그인이 필요합니다."},{status:403});
      await ensureDatabase();
      try{
        const body=await request.json() as Record<string,unknown>;
        const productId=cleanText(body.productId,80), optionLabel=cleanText(body.optionLabel,30);
        const next=Number(body.quantity);
        if(!productId||!optionLabel||!Number.isFinite(next)) throw new Error("재고값을 확인해 주세요.");
        const current=await db().prepare("SELECT quantity FROM inventory_stock WHERE product_id=? AND option_label=?").bind(productId,optionLabel).first<{quantity:number}>();
        const product=await db().prepare("SELECT name FROM products WHERE id=?").bind(productId).first<{name:string}>();
        const before=Number(current?.quantity??0), delta=next-before;
        await db().batch([
          db().prepare(`INSERT INTO inventory_stock(product_id,option_label,quantity,updated_at) VALUES(?,?,?,datetime('now')) ON CONFLICT(product_id,option_label) DO UPDATE SET quantity=excluded.quantity,updated_at=datetime('now')`).bind(productId,optionLabel,next),
          db().prepare("INSERT INTO inventory_ledger(product_id,option_label,quantity_change,event_type,note) VALUES(?,?,?,'adjustment',?)").bind(productId,optionLabel,delta,cleanText(body.note,200)||`재고조정 ${before} → ${next}`),
        ]);
        const staff=await getStaff(request); const actor=staff?staffActor(staff):{type:"admin" as const,id:"legacy-admin",name:"관리자"};
        await writeAudit({actor,action:"inventory_adjust",entityType:"product",entityId:productId,summary:`${product?.name ?? productId} ${optionLabel} 재고 ${before} → ${next}`});
        return Response.json({ok:true});
      }catch(error){return Response.json({error:error instanceof Error?error.message:"재고 조정에 실패했습니다."},{status:400});}
    },
  } },
});
