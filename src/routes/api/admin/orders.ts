import { createFileRoute } from "@tanstack/react-router";
import { getStaff, isAdmin, validMutationOrigin } from "../../../lib/auth.server";
import { db, ensureDatabase } from "../../../lib/db.server";
import type { CustomerSummary } from "../../../lib/db.server";
import { createCustomerOrder, kstDate, OrderWarningError } from "../../../lib/orders.server";
import { cleanText } from "../../../lib/admin-validation.server";
import { writeAudit, staffActor } from "../../../lib/audit.server";

async function getCustomerById(id: string): Promise<CustomerSummary | null> {
  const r = await db().prepare(`SELECT id,code,name,phone,business_number,address,store_phone,region,price_group,active FROM customers WHERE id=?`).bind(id).first<Record<string,unknown>>();
  if (!r) return null;
  return {id:String(r.id),code:String(r.code),name:String(r.name),phone:String(r.phone??""),businessNumber:String(r.business_number??""),address:String(r.address??""),storePhone:String(r.store_phone??""),region:String(r.region??""),priceGroup:String(r.price_group)==="B"?"B":"A",active:Number(r.active)===1};
}

function adminActor(staff: Awaited<ReturnType<typeof getStaff>>) {
  return staff ? staffActor(staff) : { type: "admin" as const, id: "legacy-admin", name: "관리자" };
}

export const Route = createFileRoute("/api/admin/orders")({
  server: { handlers: {
    GET: async ({ request }) => {
      if (!(await isAdmin(request))) return Response.json({error:"관리자 로그인이 필요합니다."},{status:403});
      await ensureDatabase();
      const url = new URL(request.url);
      const region = cleanText(url.searchParams.get("region"),80);
      const deliveryDate = cleanText(url.searchParams.get("deliveryDate"),10);
      const params: unknown[] = [];
      let where = "WHERE o.created_at >= datetime('now','-30 days')";
      if (region) { where += " AND o.region_snapshot=?"; params.push(region); }
      if (deliveryDate) { where += " AND o.delivery_date=?"; params.push(deliveryDate); }
      const orders = await db().prepare(`
        SELECT o.id,o.customer_id,o.source,o.status,o.region_snapshot,o.total_amount,o.note,o.created_at,o.printed_at,o.shipped_at,
               o.delivery_date,o.is_additional,o.created_by_staff_id,o.created_by_staff_name,o.order_period,o.load_printed_at,
               c.code AS customer_code,c.name AS customer_name
        FROM orders o JOIN customers c ON c.id=o.customer_id
        ${where} ORDER BY o.created_at DESC LIMIT 600
      `).bind(...params).all();
      const ids=(orders.results as Array<Record<string,unknown>>).map(r=>String(r.id));
      const itemMap=new Map<string,Array<Record<string,unknown>>>();
      const adjustmentMap=new Map<string,Array<Record<string,unknown>>>();
      if(ids.length){
        const placeholders=ids.map(()=>"?").join(",");
        const items=await db().prepare(`SELECT id,order_id,product_id,product_name,unit,option_label,quantity,unit_price,tax_type,warehouse_zone FROM order_items WHERE order_id IN (${placeholders}) ORDER BY id`).bind(...ids).all();
        for(const row of items.results as Array<Record<string,unknown>>){const k=String(row.order_id);const list=itemMap.get(k)??[];list.push(row);itemMap.set(k,list);}
        const adj=await db().prepare(`SELECT id,order_id,order_item_id,adjustment_type,quantity,amount,actor_name,note,created_at FROM order_adjustments WHERE order_id IN (${placeholders}) ORDER BY created_at DESC,id DESC`).bind(...ids).all();
        for(const row of adj.results as Array<Record<string,unknown>>){const k=String(row.order_id);const list=adjustmentMap.get(k)??[];list.push(row);adjustmentMap.set(k,list);}
      }
      return Response.json({orders:(orders.results as Array<Record<string,unknown>>).map(r=>({
        id:String(r.id),customerId:String(r.customer_id),customerCode:String(r.customer_code),customerName:String(r.customer_name),source:String(r.source),status:String(r.status),region:String(r.region_snapshot),total:Number(r.total_amount),note:String(r.note??""),createdAt:String(r.created_at),printedAt:r.printed_at?String(r.printed_at):null,shippedAt:r.shipped_at?String(r.shipped_at):null,
        deliveryDate:String(r.delivery_date||""),isAdditional:Number(r.is_additional||0)===1,createdByStaffName:String(r.created_by_staff_name||""),orderPeriod:String(r.order_period||"AM")==="PM"?"PM":"AM",loadPrintedAt:r.load_printed_at?String(r.load_printed_at):null,
        items:(itemMap.get(String(r.id))??[]).map(i=>({id:Number(i.id),productId:String(i.product_id),productName:String(i.product_name),unit:String(i.unit??""),optionLabel:String(i.option_label),quantity:Number(i.quantity),unitPrice:Number(i.unit_price),taxType:String(i.tax_type),warehouseZone:String(i.warehouse_zone??"")})),
        adjustments:(adjustmentMap.get(String(r.id))??[]).map(a=>({id:Number(a.id),itemId:Number(a.order_item_id),type:String(a.adjustment_type),quantity:Number(a.quantity),amount:Number(a.amount),actorName:String(a.actor_name||""),note:String(a.note||""),createdAt:String(a.created_at)})),
      }))},{headers:{"Cache-Control":"no-store"}});
    },
    POST: async ({ request }) => {
      if (!validMutationOrigin(request) || !(await isAdmin(request))) return Response.json({error:"관리자 로그인이 필요합니다."},{status:403});
      await ensureDatabase();
      const staff = await getStaff(request);
      const actor = adminActor(staff);
      try {
        const body=await request.json() as Record<string,unknown>;
        const action=cleanText(body.action,40);
        if(action==="create-order"){
          const customer=await getCustomerById(cleanText(body.customerId,80));
          if(!customer||!customer.active) throw new Error("거래처를 확인해 주세요.");
          const items=Array.isArray(body.items)?body.items as Array<{productId:string;optionLabel:string;quantity:number}>:[];
          const source="admin";
          const order=await createCustomerOrder(customer,items,cleanText(body.note,500),source,{deliveryDate:cleanText(body.deliveryDate,10)||kstDate(),orderPeriod:cleanText(body.orderPeriod,2),confirmAnomaly:body.confirmAnomaly===true});
          await writeAudit({actor,action:"admin_order",entityType:"order",entityId:order.id,summary:`${customer.code} ${customer.name} 주문발주 입력 · ${order.orderPeriod==="PM"?"오후발주":"오전발주"} · ${order.deliveryDate}`});
          return Response.json({ok:true,order});
        }
        const id=cleanText(body.id,80);
        if(action==="mark-load-printed"){
          const region=cleanText(body.region,80); const deliveryDate=cleanText(body.deliveryDate,10)||kstDate();
          if(!region) throw new Error("지역을 선택해 주세요.");
          await db().prepare("UPDATE orders SET load_printed_at=datetime('now') WHERE region_snapshot=? AND delivery_date=? AND status IN ('received','preparing') AND COALESCE(load_printed_at,'')=''").bind(region,deliveryDate).run();
          await writeAudit({actor,action:"print_load_sheet",entityType:"order",summary:`${deliveryDate} ${region} 상차준비표 출력완료`});
          return Response.json({ok:true});
        }
        if(action==="mark-region-printed"){
          const region=cleanText(body.region,80); const deliveryDate=cleanText(body.deliveryDate,10)||kstDate();
          if(!region) throw new Error("지역을 선택해 주세요.");
          await db().prepare("UPDATE orders SET printed_at=datetime('now') WHERE region_snapshot=? AND delivery_date=? AND status IN ('received','preparing') AND printed_at IS NULL").bind(region,deliveryDate).run();
          await writeAudit({actor,action:"print_region",entityType:"order",summary:`${deliveryDate} ${region} 신규 주문 출력완료`});
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
          await writeAudit({actor,action:"ship",entityType:"order",entityId:id,summary:`주문 ${id} 출고확정 · 재고/미수 반영`});
          return Response.json({ok:true});
        }
        if(action==="cancel"){
          if(String(order.status)==="shipped") throw new Error("이미 출고된 주문은 취소할 수 없습니다. 반품/미배송으로 처리해 주세요.");
          await db().prepare("UPDATE orders SET status='cancelled',cancelled_at=datetime('now'),updated_at=datetime('now') WHERE id=?").bind(id).run();
          await writeAudit({actor,action:"cancel_order",entityType:"order",entityId:id,summary:`주문 ${id} 취소`});
          return Response.json({ok:true});
        }
        if(action==="mark-printed"){
          await db().prepare("UPDATE orders SET printed_at=datetime('now') WHERE id=?").bind(id).run();
          await writeAudit({actor,action:"print_order",entityType:"order",entityId:id,summary:`주문 ${id} 출력완료`});
          return Response.json({ok:true});
        }
        if(action==="update-price"){
          if(String(order.status)==="shipped"||String(order.status)==="cancelled") throw new Error("출고/취소된 주문은 단가를 수정할 수 없습니다.");
          const itemId=Math.round(Number(body.itemId)); const unitPrice=Math.max(0,Math.round(Number(body.unitPrice)));
          if(!Number.isFinite(itemId)||!Number.isFinite(unitPrice)) throw new Error("단가를 확인해 주세요.");
          const before=await db().prepare("SELECT product_name,unit_price FROM order_items WHERE id=? AND order_id=?").bind(itemId,id).first<{product_name:string;unit_price:number}>();
          if(!before) throw new Error("주문 품목을 찾을 수 없습니다.");
          await db().prepare("UPDATE order_items SET unit_price=? WHERE id=? AND order_id=?").bind(unitPrice,itemId,id).run();
          await db().prepare("UPDATE orders SET total_amount=(SELECT CAST(ROUND(COALESCE(SUM(quantity*unit_price),0)) AS INTEGER) FROM order_items WHERE order_id=?),updated_at=datetime('now') WHERE id=?").bind(id,id).run();
          await writeAudit({actor,action:"price_change",entityType:"order",entityId:id,summary:`${before.product_name} 단가 ${before.unit_price.toLocaleString()} → ${unitPrice.toLocaleString()}원`});
          return Response.json({ok:true});
        }
        if(action==="adjust-shipment"){
          if(String(order.status)!=="shipped") throw new Error("출고완료 주문만 반품/미배송 처리할 수 있습니다.");
          const itemId=Math.round(Number(body.itemId)); const quantity=Number(body.quantity); const type=body.adjustmentType==="missing"?"missing":"return";
          if(!Number.isFinite(itemId)||!Number.isFinite(quantity)||quantity<=0) throw new Error("수량을 확인해 주세요.");
          const item=await db().prepare("SELECT id,product_id,product_name,option_label,quantity,unit_price FROM order_items WHERE id=? AND order_id=?").bind(itemId,id).first<Record<string,unknown>>();
          if(!item) throw new Error("주문 품목을 찾을 수 없습니다.");
          const used=await db().prepare("SELECT COALESCE(SUM(quantity),0) AS qty FROM order_adjustments WHERE order_item_id=?").bind(itemId).first<{qty:number}>();
          if(Number(used?.qty??0)+quantity>Number(item.quantity)+0.0001) throw new Error("출고 수량보다 많이 처리할 수 없습니다.");
          const amount=Math.round(quantity*Number(item.unit_price)); const note=cleanText(body.note,200);
          await db().batch([
            db().prepare("INSERT INTO order_adjustments(order_id,order_item_id,adjustment_type,quantity,amount,actor_type,actor_id,actor_name,note) VALUES(?,?,?,?,?,?,?,?,?)").bind(id,itemId,type,quantity,amount,actor.type,actor.id??"",actor.name??"",note),
            db().prepare(`INSERT INTO inventory_stock(product_id,option_label,quantity,updated_at) VALUES(?,?,?,datetime('now')) ON CONFLICT(product_id,option_label) DO UPDATE SET quantity=quantity+excluded.quantity,updated_at=datetime('now')`).bind(String(item.product_id),String(item.option_label),quantity),
            db().prepare("INSERT INTO inventory_ledger(product_id,option_label,quantity_change,event_type,reference_order_id,note) VALUES(?,?,?,?,?,?)").bind(String(item.product_id),String(item.option_label),quantity,type,id,note|| (type==="missing"?"미배송 복원":"반품 복원")),
            db().prepare("INSERT INTO receivable_ledger(customer_id,amount,event_type,reference_order_id,note) VALUES(?,?,?,?,?)").bind(String(order.customer_id),-amount,type,id,note|| (type==="missing"?"미배송 차감":"반품 차감")),
          ]);
          await writeAudit({actor,action:type,entityType:"order",entityId:id,summary:`${type==="missing"?"미배송":"반품"} · ${String(item.product_name)} ${quantity}${String(item.option_label)} · ${amount.toLocaleString()}원 차감`});
          return Response.json({ok:true,amount});
        }
        throw new Error("지원하지 않는 작업입니다.");
      } catch(error){
        if(error instanceof OrderWarningError) return Response.json({warning:true,error:error.message,warnings:error.warnings},{status:409});
        return Response.json({error:error instanceof Error?error.message:"주문 작업에 실패했습니다."},{status:400});
      }
    }
  } },
});
