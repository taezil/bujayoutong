import { createFileRoute } from "@tanstack/react-router";
import { getStaff } from "../../../lib/auth.server";
import { db, ensureDatabase, readStore } from "../../../lib/db.server";
import { kstDate, normalizeDeliveryDate } from "../../../lib/orders.server";

export const Route=createFileRoute("/api/driver/data")({server:{handlers:{GET:async({request})=>{
  const staff=await getStaff(request); if(!staff) return Response.json({error:"직원 로그인이 필요합니다."},{status:401});
  await ensureDatabase();
  const url=new URL(request.url); const date=normalizeDeliveryDate(url.searchParams.get("date")||kstDate());
  const [customers,orders,store]=await Promise.all([
    db().prepare(`SELECT c.id,c.code,c.name,c.phone,c.business_number,c.address,c.store_phone,c.region,c.price_group,c.active,COALESCE((SELECT SUM(amount) FROM receivable_ledger r WHERE r.customer_id=c.id),0) AS receivable FROM customers c WHERE c.active=1 ORDER BY c.region,c.code`).all(),
    db().prepare(`SELECT o.id,o.customer_id,o.source,o.status,o.region_snapshot,o.total_amount,o.note,o.created_at,o.delivery_date,o.is_additional,c.code,c.name,c.address,c.store_phone FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.delivery_date=? AND o.status!='cancelled' ORDER BY o.region_snapshot,c.code,o.created_at`).bind(date).all(),
    readStore(),
  ]);
  const orderRows=orders.results as Array<Record<string,unknown>>; const ids=orderRows.map(r=>String(r.id)); const itemMap=new Map<string,Array<Record<string,unknown>>>();
  if(ids.length){const ph=ids.map(()=>'?').join(','); const items=await db().prepare(`SELECT order_id,product_name,option_label,quantity,unit_price FROM order_items WHERE order_id IN (${ph}) ORDER BY id`).bind(...ids).all(); for(const row of items.results as Array<Record<string,unknown>>){const k=String(row.order_id),list=itemMap.get(k)??[];list.push(row);itemMap.set(k,list);}}
  return Response.json({staff,date,customers:(customers.results as Array<Record<string,unknown>>).map(r=>({id:String(r.id),code:String(r.code),name:String(r.name),phone:String(r.phone??''),storePhone:String(r.store_phone??''),address:String(r.address??''),region:String(r.region??''),priceGroup:String(r.price_group)==='B'?'B':'A',receivable:Number(r.receivable??0)})),products:store.products,orders:orderRows.map(r=>({id:String(r.id),customerId:String(r.customer_id),customerCode:String(r.code),customerName:String(r.name),address:String(r.address??''),storePhone:String(r.store_phone??''),region:String(r.region_snapshot),status:String(r.status),total:Number(r.total_amount),note:String(r.note??''),createdAt:String(r.created_at),deliveryDate:String(r.delivery_date),isAdditional:Number(r.is_additional??0)===1,items:(itemMap.get(String(r.id))??[]).map(i=>({productName:String(i.product_name),optionLabel:String(i.option_label),quantity:Number(i.quantity),unitPrice:Number(i.unit_price)}))}))},{headers:{"Cache-Control":"no-store"}});
}}}});
