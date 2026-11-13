import { createFileRoute } from "@tanstack/react-router";
import { normalizePriceGroup } from "../../../lib/price-group";
import { getStaff, validMutationOrigin } from "../../../lib/auth.server";
import { db, ensureDatabase } from "../../../lib/db.server";
import type { CustomerSummary } from "../../../lib/db.server";
import { createCustomerOrder, OrderWarningError, kstDate } from "../../../lib/orders.server";
import { ruleForRegion } from "../../../lib/zones.server";
import { resolveSlot } from "../../../lib/delivery-rules";
import { notifyNewOrder } from "../../../lib/alerts.server";
import { findDuplicateOrders } from "../../../lib/sms-alias.server";

async function customerById(id:string):Promise<CustomerSummary|null>{
  const r=await db().prepare("SELECT id,code,name,phone,business_number,address,store_phone,region,price_group,active FROM customers WHERE id=? AND active=1").bind(id).first<Record<string,unknown>>(); if(!r)return null;
  return {id:String(r.id),code:String(r.code),name:String(r.name),phone:String(r.phone??''),businessNumber:String(r.business_number??''),address:String(r.address??''),storePhone:String(r.store_phone??''),region:String(r.region??''),priceGroup:normalizePriceGroup(r.price_group),active:true};
}

export const Route=createFileRoute("/api/driver/order")({server:{handlers:{POST:async({request})=>{
  if(!validMutationOrigin(request)) return Response.json({error:"잘못된 요청입니다."},{status:403});
  const staff=await getStaff(request); if(!staff) return Response.json({error:"직원 로그인이 필요합니다."},{status:401});
  await ensureDatabase();
  try{
    const body=await request.json() as {customerId?:string;deliveryDate?:string;orderPeriod?:string;deliverySlot?:string;requestId?:string;items?:Array<{productId:string;optionLabel:string;quantity:number}>;note?:string;confirmAnomaly?:boolean;confirmDuplicate?:boolean};
    const requestId=String(body.requestId??'').trim();
    if(requestId&&!/^[A-Za-z0-9_-]{8,64}$/.test(requestId)) throw new Error("요청 정보가 올바르지 않습니다. 화면을 새로고침해 주세요.");
    const deliverySlot=String(body.deliverySlot??'').trim();
    if(deliverySlot!=="AM"&&deliverySlot!=="PM") throw new Error("배송 시간(오전/오후)을 선택해 주세요.");
    const customer=await customerById(String(body.customerId??'')); if(!customer) throw new Error("거래처를 선택해 주세요.");
    // 기사 발주는 마감 시각이 지나도 받음(전화로 확인한 주문). 오후 차수만 구역 규칙으로 계산
    const rule=await ruleForRegion(customer.region);
    const date=String(body.deliveryDate??'').trim()||kstDate();
    const resolved=resolveSlot(rule,date,deliverySlot);
    const deliveryRun=deliverySlot==="PM"&&rule.pmRuns.length>1?(resolved.ok?resolved.run:date>kstDate()?1:rule.pmRuns.length):0;
    // 같은 날 같은 품목 주문이 이미 있으면 확인 (같은 요청 재전송은 requestId 로 걸러지므로 제외)
    if(body.confirmDuplicate!==true){
      const duplicates=(await findDuplicateOrders(customer.id,date,(body.items??[]).map(i=>String(i.productId))));
      const resend=requestId?await db().prepare("SELECT id FROM orders WHERE client_request_id=? LIMIT 1").bind(`drv-${staff.id}-${requestId}`.slice(0,64)).first():null;
      if(duplicates.length&&!resend) return Response.json({error:"같은 날 같은 품목 주문이 이미 있습니다.",duplicate:true,duplicates},{status:409});
    }
    const order=await createCustomerOrder(customer,body.items??[],String(body.note??''),'driver',{deliveryDate:String(body.deliveryDate??''),orderPeriod:String(body.orderPeriod??''),deliverySlot,deliveryRun,clientRequestId:requestId?`drv-${staff.id}-${requestId}`.slice(0,64):"",staff,confirmAnomaly:body.confirmAnomaly===true});
    if(!order.duplicate) notifyNewOrder(order.id);
    return Response.json({ok:true,order});
  }catch(error){if(error instanceof OrderWarningError)return Response.json({warning:true,error:error.message,warnings:error.warnings},{status:409}); return Response.json({error:error instanceof Error?error.message:"현장발주 접수에 실패했습니다."},{status:400});}
}}}});
