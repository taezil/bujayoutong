import { createFileRoute } from "@tanstack/react-router";
import { isAdmin } from "../../../lib/auth.server";
import { db, ensureDatabase } from "../../../lib/db.server";

function esc(v:unknown){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]||c));}
function qty(v:number){return Number.isInteger(v)?String(v):String(Math.round(v*1000)/1000);}

export const Route=createFileRoute("/api/admin/print-load-sheet")({server:{handlers:{GET:async({request})=>{
  if(!(await isAdmin(request))) return new Response("관리자 로그인이 필요합니다.",{status:403});
  await ensureDatabase();
  const url=new URL(request.url);
  const region=(url.searchParams.get("region")||"").trim();
  const deliveryDate=(url.searchParams.get("deliveryDate")||"").trim();
  const pending=url.searchParams.get("pending")!=="0";
  if(!region) return new Response("지역을 선택해 주세요.",{status:400});

  const orders=await db().prepare(`
    SELECT o.id,o.customer_id,o.order_period,o.created_at,c.code,c.name
    FROM orders o JOIN customers c ON c.id=o.customer_id
    WHERE o.region_snapshot=? ${deliveryDate?"AND o.delivery_date=?":""}
      AND o.status IN ('received','preparing')
      ${pending?"AND COALESCE(o.load_printed_at,'')=''":""}
    ORDER BY c.code,o.created_at
  `).bind(...(deliveryDate?[region,deliveryDate]:[region])).all();

  const list=orders.results as Array<Record<string,unknown>>;
  if(!list.length) return new Response(`<meta charset="utf-8"><div style="font-family:'Malgun Gothic',sans-serif;padding:40px"><h2>${esc(region)} 상차대기 주문이 없습니다.</h2></div>`,{headers:{"Content-Type":"text/html; charset=utf-8"}});

  const ids=list.map(o=>String(o.id)),ph=ids.map(()=>"?").join(",");
  const items=await db().prepare(`SELECT order_id,product_name,option_label,quantity,warehouse_zone FROM order_items WHERE order_id IN (${ph}) ORDER BY warehouse_zone,product_name`).bind(...ids).all();

  const summary=new Map<string,Map<string,{name:string;label:string;qty:number}>>();
  const byOrder=new Map<string,Array<Record<string,unknown>>>();
  for(const row of items.results as Array<Record<string,unknown>>){
    const oid=String(row.order_id),arr=byOrder.get(oid)??[];arr.push(row);byOrder.set(oid,arr);
    const zone=String(row.warehouse_zone||"미지정"),key=`${row.product_name}||${row.option_label}`,z=summary.get(zone)??new Map();
    const cur=z.get(key)??{name:String(row.product_name),label:String(row.option_label),qty:0};cur.qty+=Number(row.quantity);z.set(key,cur);summary.set(zone,z);
  }

  const customerIds=new Set(list.map(o=>String(o.customer_id)));
  const lineCount=(items.results as Array<Record<string,unknown>>).length;
  const recommended=customerIds.size>=10||lineCount>=30;
  let summaryHtml="";
  for(const [zone,rows] of summary){
    summaryHtml+=`<section class="zone"><h2>${esc(zone)}</h2><table><thead><tr><th>품목</th><th>합계수량</th></tr></thead><tbody>${Array.from(rows.values()).map(r=>`<tr><td>${esc(r.name)}</td><td class="q">${qty(r.qty)} ${esc(r.label)}</td></tr>`).join("")}</tbody></table></section>`;
  }

  const customerHtml=list.map(o=>{
    const rows=byOrder.get(String(o.id))??[];
    return `<article class="customer"><div><b>${esc(o.code)} · ${esc(o.name)}</b><span>${String(o.order_period)==="PM"?"오후발주":"오전발주"}</span></div><p>${rows.map(r=>`${esc(r.product_name)} ${qty(Number(r.quantity))}${esc(r.option_label)}`).join(" · ")}</p></article>`;
  }).join("");

  const html=`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(region)} 상차준비표</title><style>
    @page{size:A4;margin:10mm}*{box-sizing:border-box}body{font-family:Arial,'Malgun Gothic',sans-serif;color:#111;margin:0}.head{display:flex;justify-content:space-between;align-items:end;border-bottom:3px solid #111;padding-bottom:8px;margin-bottom:12px}.head h1{margin:0;font-size:27px}.head p{margin:3px 0 0;color:#555;font-size:11px}.badge{border:1px solid #111;padding:5px 8px;font-size:11px;font-weight:800}.zone{margin:14px 0}.zone h2{margin:0 0 5px;font-size:16px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #555;padding:6px;font-size:11px;text-align:left}.q{text-align:right;font-weight:800}.customers{page-break-before:auto;margin-top:18px}.customers>h2{border-bottom:2px solid #111;padding-bottom:5px;font-size:16px}.customer{padding:7px 0;border-bottom:1px solid #bbb}.customer>div{display:flex;justify-content:space-between;gap:12px}.customer b{font-size:12px}.customer span{font-size:10px;font-weight:800}.customer p{margin:4px 0 0;font-size:10px;line-height:1.45;color:#333}
  </style></head><body><div class="head"><div><h1>${esc(region)} 상차준비표</h1><p>${esc(deliveryDate)} · 현재 상차대기분만 집계</p></div><div class="badge">거래처 ${customerIds.size}곳 · 품목 ${lineCount}줄${recommended?" · 출력 권장":""}</div></div>${summaryHtml}<section class="customers"><h2>거래처별 확인</h2>${customerHtml}</section><script>window.addEventListener('load',()=>setTimeout(()=>window.print(),250));</script></body></html>`;
  return new Response(html,{headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"}});
}}}});
