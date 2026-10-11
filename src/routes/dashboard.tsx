import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { BUJA_LOGO_DATA } from "../brand-assets";

export const Route=createFileRoute("/dashboard")({head:()=>({meta:[{title:"부자유통 대시보드"},{name:"robots",content:"noindex,nofollow"}]}),component:DashboardPage});

type DashboardData={today:string;cards:{additional:number;unprinted:number;lowStock:number;adjustments:number;overdue:number;fieldOrders:number};details:Record<string,Array<Record<string,unknown>>>};
const cards:[keyof DashboardData["cards"],string,string][]=[
  ["additional","🚨 추가발주","이미 출력 후 들어온 추가 주문"],
  ["unprinted","🖨 미출력 주문","아직 전표 출력하지 않은 주문"],
  ["lowStock","⚠ 재고부족","현재고 0 이하 품목"],
  ["overdue","💰 장기미수","90일 이상 미수 후보"],
  ["adjustments","↩ 반품·미배송","최근 14일 반품/미배송"],
  ["fieldOrders","🚚 현장발주","배송기사가 현장에서 입력한 주문"],
];
function won(v:unknown){return new Intl.NumberFormat("ko-KR").format(Number(v||0));}

function DashboardPage(){
  const[data,setData]=useState<DashboardData|null>(null);const[active,setActive]=useState<keyof DashboardData["cards"]>("additional");const[error,setError]=useState("");
  async function load(){const r=await fetch("/api/admin/dashboard",{cache:"no-store"});if(r.status===403){setError("관리자 로그인이 필요합니다.");return;}if(!r.ok){setError("대시보드를 불러오지 못했습니다.");return;}setData(await r.json() as DashboardData);}
  useEffect(()=>{void load();},[]);
  return <div className="dashboard-page"><header className="dashboard-header"><img src={BUJA_LOGO_DATA} alt="부자유통"/><div><a href="/admin">← 관리자</a><button type="button" onClick={()=>void load()}>새로고침</button></div></header><main className="dashboard-main"><div className="dashboard-title"><div><p>대표/관리자용</p><h1>예외 대시보드</h1><span>정상적인 건 숨기고 확인이 필요한 것만 먼저 봅니다.</span></div>{data&&<b>{data.today}</b>}</div>{error&&<div className="dashboard-error">{error} <a href="/admin">관리자 로그인</a></div>}{data&&<><div className="dashboard-cards">{cards.map(([key,title,desc])=><button type="button" key={key} className={active===key?"selected":""} onClick={()=>setActive(key)}><span>{title}</span><strong>{data.cards[key]}</strong><small>{desc}</small></button>)}</div><section className="dashboard-detail"><div className="dashboard-detail-head"><h2>{cards.find(c=>c[0]===active)?.[1]}</h2><span>{data.details[active]?.length??0}건</span></div><DashboardRows kind={active} rows={data.details[active]??[]}/></section></>}</main></div>;
}

function DashboardRows({kind,rows}:{kind:string;rows:Array<Record<string,unknown>>}){
  if(!rows.length)return <p className="dashboard-empty">현재 확인할 항목이 없습니다.</p>;
  return <div className="dashboard-row-list">{rows.map((r,i)=><div className="dashboard-row" key={String(r.id??i)}><div>{kind==="lowStock"?<><strong>{String(r.name??"")}</strong><span>{String(r.category??"")} · {String(r.warehouse_zone??"위치 미지정")}</span></>:kind==="adjustments"?<><strong>{String(r.code??"")} · {String(r.name??"")}</strong><span>{String(r.product_name??"")} {String(r.quantity??"")}{String(r.option_label??"")} · {String(r.adjustment_type)==="missing"?"미배송":"반품"}</span></>:kind==="overdue"?<><strong>{String(r.code??"")} · {String(r.name??"")}</strong><span>최초 미수 발생 {String(r.oldest_sale??"")}</span></>:<><strong>{String(r.code??"")} · {String(r.name??"")}</strong><span>{String(r.region_snapshot??"")} · 배송 {String(r.delivery_date??"")}</span></>}</div><div>{kind==="lowStock"?<b>{String(r.quantity??0)} {String(r.option_label??"")}</b>:kind==="overdue"?<b>{won(r.balance)}원</b>:kind==="adjustments"?<b>{won(r.amount)}원</b>:kind==="fieldOrders"?<b>{String(r.created_by_staff_name??"")}</b>:<a href="/admin">관리자에서 보기 →</a>}</div></div>)}</div>;
}
