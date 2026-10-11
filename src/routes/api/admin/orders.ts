import { createFileRoute } from "@tanstack/react-router";
import { isAdmin, validMutationOrigin } from "../../../lib/auth.server";
import { db, ensureDatabase } from "../../../lib/db.server";
import type { CustomerSummary } from "../../../lib/db.server";
import { createCustomerOrder } from "../../../lib/orders.server";
import { cleanText } from "../../../lib/admin-validation.server";

async function getCustomerById(id: string): Promise<CustomerSummary | null> {
  const r = await db().prepare(`SELECT id,code,name,phone,business_number,address,store_phone,region,price_group,active FROM customers WHERE id=?`).bind(id).first<Record<string,unknown>>();
  if (!r) return null;
  return {id:String(r.id),code:String(r.code),name:String(r.name),phone:String(r.phone??""),businessNumber:String(r.business_number??""),address:String(r.address??""),storePhone:String(r.store_phone??""),region:String(r.region??""),priceGroup:String(r.price_group)==="B"?"B":"A",active:Number(r.active)===1};
}

export const Route = createFileRoute("/api/admin/orders")({
  server: { handlers: {
    GET: async ({ request }) => {
      if (!(await isAdmin(request))) return Response.json({error:"관리자 로그인이 필요합니다."},{status:403});
      await ensureDatabase();
      const url = new URL(request.url);
      const region = cleanText(url.searchParams.get("region"),80);
      const params: unknown[] = [];
      let where = "WHERE o.created_at >= datetime('now','-14 days')";
      if (region) { where += " AND o.region_snapshot=?"; params.push(region); }
      const orders = await db().prepare(`
        SELECT o.id,o.customer_id,o.source,o.status,o.region_snapshot,o.total_amount,o.note,o.created_at,o.printed_at,o.shipped_at,
               c.code AS customer_code,c.name AS customer_name
        FROM orders o JOIN customers c ON c.id=o.customer_id
        ${where} ORDER BY o.created_at DESC LIMIT 500
      `).bind(...params).all();
      const ids=(orders.results as Array<Record<string,unknown>>).map(r=>String(r.id));
      const itemMap=new Map<string,Array<Record<string,unknown>>>();
      if(ids.length){
        const placeholders=ids.map(()=>"?").join(",");
        const items=await db().prepare(`SELECT id,order_id,product_id,product_name,unit,option_label,quantity,unit_price,tax_type,warehouse_zone FROM order_items WHERE order_id IN (${placeholders}) ORDER BY id`).bind(...ids).all();
        for(const row of items.results as Array<Record<string,unknown>>){const k=String(row.order_id);const list=itemMap.get(k)??[];list.push(row);itemMap.set(k,list);}
      }
      return Response.json({orders:(orders.results as Array<Record<string,unknown>>).map(r=>({
        id:String(r.id),customerId:String(r.customer_id),customerCode:String(r.customer_code),customerName:String(r.customer_name),source:String(r.source),status:String(r.status),region:String(r.region_snapshot),total:Number(r.total_amount),note:String(r.note??""),createdAt:String(r.created_at),printedAt:r.printed_at?String(r.printed_at):null,shippedAt:r.shipped_at?String(r.shipped_at):null,
        items:(itemMap.get(String(r.id))??[]).map(i=>({id:Number(i.id),productId:String(i.product_id),productName:String(i.product_name),unit:String(i.unit??""),optionLabel:String(i.option_label),quantity:Number(i.quantity),unitPrice:Number(i.unit_price),taxType:String(i.tax_type),warehouseZone:String(i.warehouse_zone??"")})),
      }))},{headers:{"Cache-Control":"no-store"}});
    },
    POST: async ({ request }) => {
      if (!validMutationOrigin(request) || !(await isAdmin(request))) return Response.json({error:"관리자 로그인이 필요합니다."},{status:403});
      await ensureDatabase();
      try {
        const body=await request.json() as Record<string,unknown>;
        const action=cleanText(body.action,40);
        if(action==="create-order"){
          const customer=await getCustomerById(cleanText(body.customerId,80));
          if(!customer||!customer.active) throw new Error("거래처를 확인해 주세요.");
          const items=Array.isArray(body.items)?body.items as Array<{productId:string;optionLabel:string;quantity:number}>:[];
          const order=await createCustomerOrder(customer,items,cleanText(body.note,500),cleanText(body.source,20)||"phone");
          return Response.json({ok:true,order});
        }
        const id=cleanText(body.id,80);
        if(action==="mark-region-printed"){
          const region=cleanText(body.region,80);
          if(!region) throw new Error("지역을 선택해 주세요.");
          await db().prepare("UPDATE orders SET printed_at=datetime('now') WHERE region_snapshot=? AND status IN ('received','preparing') AND printed_at IS NULL").bind(region).run();
          return Response.json({ok:true});
        }
        if(!id) throw new Error("주문을 선택해 주세요.");
        const order=await db().prepare("SELECT id,customer_id,status,total_amount FROM orders WHERE id=?").bind(id).first<Record<string,unknown>>();
        if(!order) throw new Error("주문을 찾을 수 없습니다.");
        if(action==="ship"){
          if(String(order.status)==="shipped") return Response.json({ok:true});
          if(String(order.status)==="cancelled") throw new Error("취소된 주문입니다.");
          const rows=await db().prepare("SELECT product_id,option_label,quantity FROM order_items WHERE order_id=?").bind(id).all();
          const statements=[
            db().prepare("UPDATE orders SET status='shipped',shipped_at=datetime('now'),updated_at=datetime('now') WHERE id=?").bind(id),
            db().prepare("INSERT INTO receivable_ledger(customer_id,amount,event_type,reference_order_id,note) VALUES(?,?,'sale',?,'출고 매출')").bind(String(order.customer_id),Number(order.total_amount),id),
          ];
          for(const row of rows.results as Array<Record<string,unknown>>){
            statements.push(db().prepare(`INSERT INTO inventory_stock(product_id,option_label,quantity,updated_at) VALUES(?,?,?,datetime('now')) ON CONFLICT(product_id,option_label) DO UPDATE SET quantity=quantity+excluded.quantity,updated_at=datetime('now')`).bind(String(row.product_id),String(row.option_label),-Number(row.quantity)));
            statements.push(db().prepare("INSERT INTO inventory_ledger(product_id,option_label,quantity_change,event_type,reference_order_id,note) VALUES(?,?,?,'shipment',?,'출고')").bind(String(row.product_id),String(row.option_label),-Number(row.quantity),id));
          }
          await db().batch(statements);
          return Response.json({ok:true});
        }
        if(action==="cancel"){
          if(String(order.status)==="shipped") throw new Error("이미 출고된 주문은 취소할 수 없습니다. 반품/조정으로 처리해야 합니다.");
          await db().prepare("UPDATE orders SET status='cancelled',cancelled_at=datetime('now'),updated_at=datetime('now') WHERE id=?").bind(id).run();
          return Response.json({ok:true});
        }
        if(action==="mark-printed"){
          await db().prepare("UPDATE orders SET printed_at=datetime('now') WHERE id=?").bind(id).run();
          return Response.json({ok:true});
        }
        if(action==="update-price"){
          if(String(order.status)==="shipped"||String(order.status)==="cancelled") throw new Error("출고/취소된 주문은 단가를 수정할 수 없습니다.");
          const itemId=Math.round(Number(body.itemId)); const unitPrice=Math.max(0,Math.round(Number(body.unitPrice)));
          if(!Number.isFinite(itemId)||!Number.isFinite(unitPrice)) throw new Error("단가를 확인해 주세요.");
          await db().prepare("UPDATE order_items SET unit_price=? WHERE id=? AND order_id=?").bind(unitPrice,itemId,id).run();
          await db().prepare("UPDATE orders SET total_amount=(SELECT CAST(ROUND(COALESCE(SUM(quantity*unit_price),0)) AS INTEGER) FROM order_items WHERE order_id=?),updated_at=datetime('now') WHERE id=?").bind(id,id).run();
          return Response.json({ok:true});
        }
        throw new Error("지원하지 않는 작업입니다.");
      } catch(error){return Response.json({error:error instanceof Error?error.message:"주문 작업에 실패했습니다."},{status:400});}
    }
  } },
});
