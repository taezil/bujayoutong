import { createFileRoute } from "@tanstack/react-router";
import { isAdmin } from "../../../lib/auth.server";
import { db, ensureDatabase } from "../../../lib/db.server";
import { cleanText } from "../../../lib/admin-validation.server";

export const Route = createFileRoute("/api/admin/ledger")({
  server:{handlers:{GET:async({request})=>{
    if(!(await isAdmin(request))) return Response.json({error:"관리자 로그인이 필요합니다."},{status:403});
    await ensureDatabase();
    const url=new URL(request.url), customerId=cleanText(url.searchParams.get("customerId"),80), month=cleanText(url.searchParams.get("month"),7);
    if(!customerId) return Response.json({error:"거래처를 선택해 주세요."},{status:400});
    const customer=await db().prepare("SELECT id,code,name,business_number,address,store_phone FROM customers WHERE id=?").bind(customerId).first<Record<string,unknown>>();
    if(!customer) return Response.json({error:"거래처를 찾을 수 없습니다."},{status:404});
    const whereMonth=/^\d{4}-\d{2}$/.test(month)?month:"";
    const rows=whereMonth
      ? await db().prepare("SELECT id,amount,event_type,reference_order_id,note,created_at FROM receivable_ledger WHERE customer_id=? AND substr(created_at,1,7)=? ORDER BY created_at,id").bind(customerId,whereMonth).all()
      : await db().prepare("SELECT id,amount,event_type,reference_order_id,note,created_at FROM receivable_ledger WHERE customer_id=? ORDER BY created_at DESC,id DESC LIMIT 500").bind(customerId).all();
    const balance=await db().prepare("SELECT COALESCE(SUM(amount),0) AS balance FROM receivable_ledger WHERE customer_id=?").bind(customerId).first<{balance:number}>();
    const monthSales=whereMonth?await db().prepare("SELECT COALESCE(SUM(CASE WHEN amount>0 THEN amount ELSE 0 END),0) AS total FROM receivable_ledger WHERE customer_id=? AND substr(created_at,1,7)=?").bind(customerId,whereMonth).first<{total:number}>():null;
    return Response.json({customer,balance:Number(balance?.balance??0),monthSales:Number(monthSales?.total??0),entries:rows.results},{headers:{"Cache-Control":"no-store"}});
  }}}});
