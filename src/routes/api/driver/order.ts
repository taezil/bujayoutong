import { createFileRoute } from "@tanstack/react-router";
import { getStaff, validMutationOrigin } from "../../../lib/auth.server";
import { db, ensureDatabase } from "../../../lib/db.server";
import type { CustomerSummary } from "../../../lib/db.server";
import { createCustomerOrder, OrderWarningError } from "../../../lib/orders.server";

async function customerById(id:string):Promise<CustomerSummary|null>{
  const r=await db().prepare("SELECT id,code,name,phone,business_number,address,store_phone,region,price_group,active FROM customers WHERE id=? AND active=1").bind(id).first<Record<string,unknown>>(); if(!r)return null;
  return {id:String(r.id),code:String(r.code),name:String(r.name),phone:String(r.phone??''),businessNumber:String(r.business_number??''),address:String(r.address??''),storePhone:String(r.store_phone??''),region:String(r.region??''),priceGroup:String(r.price_group)==='B'?'B':'A',active:true};
}

export const Route=createFileRoute("/api/driver/order")({server:{handlers:{POST:async({request})=>{
  if(!validMutationOrigin(request)) return Response.json({error:"잘못된 요청입니다."},{status:403});
  const staff=await getStaff(request); if(!staff) return Response.json({error:"직원 로그인이 필요합니다."},{status:401});
  await ensureDatabase();
  try{
    const body=await request.json() as {customerId?:string;deliveryDate?:string;orderPeriod?:string;items?:Array<{productId:string;optionLabel:string;quantity:number}>;note?:string;confirmAnomaly?:boolean};
    const customer=await customerById(String(body.customerId??'')); if(!customer) throw new Error("거래처를 선택해 주세요.");
    const order=await createCustomerOrder(customer,body.items??[],String(body.note??''),'driver',{deliveryDate:String(body.deliveryDate??''),orderPeriod:String(body.orderPeriod??''),staff,confirmAnomaly:body.confirmAnomaly===true});
    return Response.json({ok:true,order});
  }catch(error){if(error instanceof OrderWarningError)return Response.json({warning:true,error:error.message,warnings:error.warnings},{status:409}); return Response.json({error:error instanceof Error?error.message:"현장발주 접수에 실패했습니다."},{status:400});}
}}}});
