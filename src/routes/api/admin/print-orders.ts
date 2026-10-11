import { createFileRoute } from "@tanstack/react-router";
import { isAdmin } from "../../../lib/auth.server";
import { db, ensureDatabase } from "../../../lib/db.server";

function esc(v:unknown){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]||c));}
function qty(v:number){return Number.isInteger(v)?String(v):String(Math.round(v*1000)/1000);}

export const Route=createFileRoute("/api/admin/print-orders")({server:{handlers:{GET:async({request})=>{
  if(!(await isAdmin(request))) return new Response("관리자 로그인이 필요합니다.",{status:403});
  await ensureDatabase();
  const url=new URL(request.url), region=(url.searchParams.get("region")||"").trim(), deliveryDate=(url.searchParams.get("deliveryDate")||"").trim(), unprinted=url.searchParams.get("unprinted")!=="0";
  if(!region) return new Response("지역을 선택해 주세요.",{status:400});
  const orders=await db().prepare(`SELECT o.id,o.customer_id,o.created_at,o.note,o.delivery_date,o.is_additional,c.code,c.name,c.address,c.store_phone FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.region_snapshot=? ${deliveryDate?"AND o.delivery_date=?":""} AND o.status IN ('received','preparing') ${unprinted?"AND o.printed_at IS NULL":""} ORDER BY c.code,o.created_at`).bind(...(deliveryDate?[region,deliveryDate]:[region])).all();
  const list=orders.results as Array<Record<string,unknown>>;
  if(!list.length) return new Response(`<meta charset="utf-8"><div style="font-family:sans-serif;padding:40px"><h2>${esc(region)} 출력할 신규 주문이 없습니다.</h2></div>`,{headers:{"Content-Type":"text/html; charset=utf-8"}});
  const ids=list.map(o=>String(o.id)), placeholders=ids.map(()=>"?").join(",");
  const items=await db().prepare(`SELECT order_id,product_name,option_label,quantity,warehouse_zone FROM order_items WHERE order_id IN (${placeholders}) ORDER BY warehouse_zone,product_name`).bind(...ids).all();
  const byOrder=new Map<string,Array<Record<string,unknown>>>(), summary=new Map<string,Map<string,{name:string,label:string,qty:number}>>();
  for(const i of items.results as Array<Record<string,unknown>>){
    const oid=String(i.order_id), arr=byOrder.get(oid)??[];arr.push(i);byOrder.set(oid,arr);
    const zone=String(i.warehouse_zone||"미지정"), key=`${i.product_name}||${i.option_label}`, z=summary.get(zone)??new Map();
    const cur=z.get(key)??{name:String(i.product_name),label:String(i.option_label),qty:0};cur.qty+=Number(i.quantity);z.set(key,cur);summary.set(zone,z);
  }
  let summaryHtml="";for(const [zone,rows] of summary){summaryHtml+=`<h3>${esc(zone)}</h3><table><tbody>${Array.from(rows.values()).map(r=>`<tr><td>${esc(r.name)}</td><td class="q">${qty(r.qty)} ${esc(r.label)}</td></tr>`).join("")}</tbody></table>`;}
  const grouped=new Map<string,{code:string;name:string;address:string;phone:string;orders:Array<Record<string,unknown>>}>();
  for(const o of list){const cid=String(o.customer_id),g=grouped.get(cid)??{code:String(o.code),name:String(o.name),address:String(o.address??""),phone:String(o.store_phone??""),orders:[]};g.orders.push(o);grouped.set(cid,g);}
  let pages="";for(const g of grouped.values()){
    const lines:Array<Record<string,unknown>>=[];for(const o of g.orders) lines.push(...(byOrder.get(String(o.id))??[]));
    const hasAdditional=g.orders.some(o=>Number(o.is_additional??0)===1);
    pages+=`<section class="page"><div class="head"><div><b>${esc(g.code)} · ${esc(g.name)} ${hasAdditional?'<em>🚨 추가발주</em>':''}</b><small>${esc(g.address)} ${esc(g.phone)}</small></div><span>${esc(region)}${deliveryDate?` · ${esc(deliveryDate)}`:''}</span></div><table><thead><tr><th>품목</th><th>수량</th></tr></thead><tbody>${lines.map(i=>`<tr><td>${esc(i.product_name)}</td><td class="q">${qty(Number(i.quantity))} ${esc(i.option_label)}</td></tr>`).join("")}</tbody></table></section>`;
  }
  const html=`<!doctype html><html><head><meta charset="utf-8"><title>${esc(region)} 발주 출력</title><style>@page{size:A4;margin:12mm}body{font-family:Arial,'Malgun Gothic',sans-serif;color:#111;margin:0}.page{page-break-after:always}.summary{page-break-after:always}.title{display:flex;justify-content:space-between;align-items:end;border-bottom:3px solid #111;padding-bottom:8px}.title h1{margin:0;font-size:28px}.title p{margin:0;color:#555}h3{margin:20px 0 6px}table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #bbb;padding:9px 6px;text-align:left;font-size:14px}.q{text-align:right;font-weight:700}.head{display:flex;justify-content:space-between;align-items:start;border-bottom:3px solid #111;padding-bottom:10px;margin-bottom:8px}.head b{display:block;font-size:24px}.head em{font-size:14px;color:#c9341d;font-style:normal}.head small{display:block;margin-top:5px;color:#555}.head span{font-size:18px;font-weight:700}</style></head><body><section class="summary"><div class="title"><div><h1>${esc(region)}${deliveryDate?` ${esc(deliveryDate)}`:''} 상차 준비표</h1><p>동일 품목은 합산 · 창고 위치별 정리</p></div><b>${new Date().toLocaleDateString("ko-KR",{timeZone:"Asia/Seoul"})}</b></div>${summaryHtml}</section>${pages}<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),300));</script></body></html>`;
  return new Response(html,{headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"}});
}}}});
