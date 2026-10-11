import { createFileRoute } from "@tanstack/react-router";
import { isAdmin } from "../../../lib/auth.server";
import { db, ensureDatabase } from "../../../lib/db.server";
import { kstDate } from "../../../lib/orders.server";

export const Route=createFileRoute("/api/admin/dashboard")({server:{handlers:{GET:async({request})=>{
  if(!(await isAdmin(request))) return Response.json({error:"관리자 로그인이 필요합니다."},{status:403});
  await ensureDatabase();
  const today=kstDate();
  const [additional,unprinted,lowStock,adjustments,receivables,fieldOrders]=await Promise.all([
    db().prepare(`SELECT o.id,o.delivery_date,o.created_at,c.code,c.name,o.region_snapshot FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.is_additional=1 AND o.status!='cancelled' AND o.delivery_date>=? ORDER BY o.created_at DESC LIMIT 50`).bind(today).all(),
    db().prepare(`SELECT o.id,o.delivery_date,o.created_at,c.code,c.name,o.region_snapshot FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.printed_at IS NULL AND o.status IN ('received','preparing') AND o.delivery_date>=? ORDER BY o.delivery_date,o.created_at LIMIT 100`).bind(today).all(),
    db().prepare(`SELECT p.id,p.name,p.category,p.warehouse_zone,s.option_label,s.quantity FROM inventory_stock s JOIN products p ON p.id=s.product_id WHERE s.quantity<=0 ORDER BY s.quantity,p.name LIMIT 100`).all(),
    db().prepare(`SELECT a.id,a.adjustment_type,a.quantity,a.amount,a.created_at,a.actor_name,c.code,c.name,oi.product_name,oi.option_label FROM order_adjustments a JOIN orders o ON o.id=a.order_id JOIN customers c ON c.id=o.customer_id JOIN order_items oi ON oi.id=a.order_item_id WHERE a.created_at>=datetime('now','-14 days') ORDER BY a.created_at DESC LIMIT 50`).all(),
    db().prepare(`SELECT c.id,c.code,c.name,COALESCE(SUM(r.amount),0) AS balance,MIN(CASE WHEN r.amount>0 THEN r.created_at END) AS oldest_sale FROM customers c LEFT JOIN receivable_ledger r ON r.customer_id=c.id GROUP BY c.id HAVING balance>0 ORDER BY balance DESC LIMIT 100`).all(),
    db().prepare(`SELECT o.id,o.delivery_date,o.created_at,o.created_by_staff_name,c.code,c.name,o.region_snapshot FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.source='driver' AND o.created_at>=datetime('now','-14 days') ORDER BY o.created_at DESC LIMIT 50`).all(),
  ]);
  const overdue=(receivables.results as Array<Record<string,unknown>>).filter(r=>{
    if(!r.oldest_sale) return false; const t=new Date(String(r.oldest_sale).replace(' ','T')+'Z').getTime(); return Number.isFinite(t)&&Date.now()-t>=90*86400000;
  });
  return Response.json({
    today,
    cards:{additional:Number(additional.results.length),unprinted:Number(unprinted.results.length),lowStock:Number(lowStock.results.length),adjustments:Number(adjustments.results.length),overdue:Number(overdue.length),fieldOrders:Number(fieldOrders.results.length)},
    details:{additional:additional.results,unprinted:unprinted.results,lowStock:lowStock.results,adjustments:adjustments.results,overdue,fieldOrders:fieldOrders.results},
  },{headers:{"Cache-Control":"no-store"}});
}}}});
