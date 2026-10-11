import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import type { Product } from "../lib/db.server";
import { BUJA_LOGO_DATA } from "../brand-assets";

export const Route=createFileRoute("/driver")({
  head:()=>({meta:[{title:"부자유통 배송"},{name:"robots",content:"noindex,nofollow"}]}),
  component:DriverPage,
});

type Staff={id:string;username:string;displayName:string;role:"ADMIN"|"DRIVER"};
type Customer={id:string;code:string;name:string;phone:string;storePhone:string;address:string;region:string;priceGroup:"A"|"B";receivable:number};
type DriverOrder={id:string;customerId:string;customerCode:string;customerName:string;address:string;storePhone:string;region:string;status:string;total:number;note:string;createdAt:string;deliveryDate:string;isAdditional:boolean;items:Array<{productName:string;optionLabel:string;quantity:number;unitPrice:number}>};
type DriverData={staff:Staff;date:string;customers:Customer[];products:Product[];orders:DriverOrder[]};
type CartLine={productId:string;productName:string;optionLabel:string;quantity:number;unitPrice:number;step:number};

function won(v:number){return new Intl.NumberFormat("ko-KR").format(Math.round(v));}
function localDate(offset:number){const d=new Date(Date.now()+offset*86400000);return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit"}).format(d);}
function groupPrice(option:Product["packOptions"][number],group:"A"|"B"){return group==="B"?(option.priceB??option.price??0):(option.priceA??option.price??0);}

function DriverPage(){
  const [staff,setStaff]=useState<Staff|null>(null);
  const [loading,setLoading]=useState(true);
  const [data,setData]=useState<DriverData|null>(null);
  const [date,setDate]=useState(localDate(0));
  const [customerQuery,setCustomerQuery]=useState("");
  const [productQuery,setProductQuery]=useState("");
  const [customer,setCustomer]=useState<Customer|null>(null);
  const [product,setProduct]=useState<Product|null>(null);
  const [optionLabel,setOptionLabel]=useState("");
  const [qty,setQty]=useState(1);
  const [cart,setCart]=useState<CartLine[]>([]);
  const [note,setNote]=useState("");
  const [message,setMessage]=useState("");

  async function status(){
    const r=await fetch("/api/staff/status",{cache:"no-store"}); const j=await r.json() as {authenticated:boolean;staff:Staff|null};
    setStaff(j.staff); setLoading(false); if(j.authenticated&&j.staff) await load(date);
  }
  async function load(nextDate=date){
    const r=await fetch(`/api/driver/data?date=${encodeURIComponent(nextDate)}`,{cache:"no-store"});
    if(r.status===401){setStaff(null);setData(null);return;}
    if(r.ok)setData(await r.json() as DriverData);
  }
  useEffect(()=>{void status();},[]);
  useEffect(()=>{if(staff)void load(date);},[date,staff?.id]);

  const customers=useMemo(()=>{
    const q=customerQuery.trim().toLowerCase().replace(/\s+/g,""); if(!data)return[];
    return data.customers.filter(c=>!q||`${c.code}${c.name}${c.region}${c.address}`.toLowerCase().replace(/\s+/g,"").includes(q)).slice(0,30);
  },[data,customerQuery]);
  const products=useMemo(()=>{
    const q=productQuery.trim().toLowerCase().replace(/\s+/g,""); if(!data||!q)return[];
    return data.products.filter(p=>`${p.name}${p.category}${p.sub}`.toLowerCase().replace(/\s+/g,"").includes(q)).slice(0,12);
  },[data,productQuery]);
  const regionGroups=useMemo(()=>{
    if(!data)return[] as Array<[string,DriverOrder[]]>;
    const map=new Map<string,DriverOrder[]>(); for(const o of data.orders){const k=o.region||"미지정";map.set(k,[...(map.get(k)??[]),o]);}
    return Array.from(map.entries());
  },[data]);

  function selectProduct(p:Product){setProduct(p);setProductQuery(p.name);setOptionLabel(p.packOptions[0]?.label??"");}
  function addItem(){
    if(!customer||!product||!optionLabel||qty<=0)return;
    const option=product.packOptions.find(o=>o.label===optionLabel); if(!option)return;
    const price=groupPrice(option,customer.priceGroup);
    setCart(cur=>{const i=cur.findIndex(x=>x.productId===product.id&&x.optionLabel===optionLabel);if(i<0)return[...cur,{productId:product.id,productName:product.name,optionLabel,quantity:qty,unitPrice:price,step:option.step||1}];const n=[...cur];n[i]={...n[i],quantity:Number((n[i].quantity+qty).toFixed(3))};return n;});
    setProduct(null);setProductQuery("");setQty(1);
  }
  async function submit(confirmAnomaly=false){
    if(!customer||!cart.length)return;
    const r=await fetch("/api/driver/order",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({customerId:customer.id,deliveryDate:date,items:cart.map(x=>({productId:x.productId,optionLabel:x.optionLabel,quantity:x.quantity})),note,confirmAnomaly})});
    const j=await r.json() as {error?:string;warning?:boolean;warnings?:Array<{message:string}>;order?:{id:string;isAdditional:boolean}};
    if(r.status===409&&j.warning){const text=(j.warnings??[]).map(x=>`• ${x.message}`).join("\n");if(window.confirm(`⚠ 평소 주문량보다 많습니다.\n\n${text}\n\n그래도 발주할까요?`))return submit(true);return;}
    if(!r.ok||!j.order){setMessage(j.error||"현장발주 접수에 실패했습니다.");return;}
    setMessage(`${j.order.isAdditional?"🚨 추가 현장발주":"현장발주"} 접수 완료 · ${customer.code}`);setCart([]);setNote("");await load(date);window.setTimeout(()=>setMessage(""),3500);
  }
  async function logout(){await fetch("/api/staff/logout",{method:"POST"});setStaff(null);setData(null);}

  if(loading)return <div className="driver-state">직원 정보를 확인하는 중입니다.</div>;
  if(!staff)return <StaffLogin onLogin={status}/>;
  return <div className="driver-page">
    <header className="driver-header"><img src={BUJA_LOGO_DATA} alt="부자유통"/><div><b>{staff.displayName}</b><span>배송기사</span><button type="button" onClick={logout}>로그아웃</button></div></header>
    <main className="driver-main">
      <section className="driver-date-panel"><div><p>배송일</p><h1>{date}</h1></div><div className="driver-date-buttons"><button onClick={()=>setDate(localDate(0))}>오늘</button><button onClick={()=>setDate(localDate(1))}>내일</button><button onClick={()=>setDate(localDate(2))}>모레</button><input type="date" value={date} min={localDate(0)} onChange={e=>setDate(e.target.value)}/></div></section>

      <section className="driver-order-form"><div className="driver-section-head"><div><p>식당에서 바로 입력</p><h2>현장발주</h2></div>{customer&&<span>{customer.region} · 가격 {customer.priceGroup}그룹</span>}</div>
        <div className="driver-search-block"><label>거래처 검색<input value={customerQuery} onChange={e=>setCustomerQuery(e.target.value)} placeholder="거래처번호·상호·지역 검색"/></label>{customerQuery&&<div className="driver-suggestions">{customers.map(c=><button type="button" key={c.id} onClick={()=>{setCustomer(c);setCustomerQuery(`${c.code} · ${c.name}`);}}><strong>{c.code} · {c.name}</strong><span>{c.region} · {c.address}</span></button>)}</div>}</div>
        {customer&&<div className="driver-customer-summary"><b>{customer.code} · {customer.name}</b><span>☎ {customer.storePhone||customer.phone||"전화번호 없음"}</span><span>{customer.address}</span><span className={customer.receivable>0?"warn":""}>미수 {won(customer.receivable)}원</span></div>}
        <div className="driver-product-line"><div className="driver-search-block"><input value={productQuery} onChange={e=>{setProductQuery(e.target.value);setProduct(null);}} placeholder="상품명 입력 예: 등심돈"/>{productQuery&&!product&&<div className="driver-suggestions product">{products.map(p=><button type="button" key={p.id} disabled={p.soldout} onClick={()=>selectProduct(p)}><strong>{p.name}{p.soldout?" · 품절":""}</strong><span>{p.category} · {p.unit}</span></button>)}</div>}</div>
          <select value={optionLabel} onChange={e=>setOptionLabel(e.target.value)} disabled={!product}>{(product?.packOptions??[]).map(o=><option key={o.label}>{o.label}</option>)}</select>
          <div className="driver-qty"><input type="number" min="0.001" step="0.001" value={qty} onChange={e=>setQty(Number(e.target.value||0))}/><b>{optionLabel||"단위"}</b></div>
          <button type="button" onClick={addItem} disabled={!customer||!product}>품목 추가</button>
        </div>
        {cart.length>0&&<div className="driver-cart">{cart.map((x,i)=><div key={`${x.productId}-${x.optionLabel}`}><span><b>{x.productName}</b> {x.quantity}{x.optionLabel}</span><strong>{won(x.unitPrice*x.quantity)}원</strong><button onClick={()=>setCart(c=>c.filter((_,j)=>j!==i))}>×</button></div>)}</div>}
        <label className="driver-note">요청사항<input value={note} onChange={e=>setNote(e.target.value)} placeholder="없으면 비워두세요"/></label>
        <button className="driver-submit" type="button" disabled={!customer||!cart.length} onClick={()=>void submit(false)}>{date===localDate(0)?"오늘":"선택한 날짜"} 현장발주 등록</button>
        {message&&<p className="driver-message">{message}</p>}
      </section>

      <section className="driver-orders"><div className="driver-section-head"><div><p>모든 지역</p><h2>{date} 발주목록</h2></div><span>{data?.orders.length??0}건</span></div>
        {regionGroups.map(([region,orders])=><div className="driver-region" key={region}><h3>{region} <span>{orders.length}건</span></h3>{orders.map(o=><article key={o.id} className={o.isAdditional?"additional":""}><div className="driver-order-title"><div><strong>{o.customerCode} · {o.customerName}</strong>{o.isAdditional&&<em>🚨 추가발주</em>}</div><span>{o.status==="shipped"?"출고완료":"발주"}</span></div><p>{o.address} · {o.storePhone}</p><ul>{o.items.map((x,i)=><li key={i}><span>{x.productName}</span><b>{x.quantity}{x.optionLabel}</b><small>{won(x.unitPrice)}원</small></li>)}</ul><div className="driver-order-total">합계 <b>{won(o.total)}원</b></div></article>)}</div>)}
        {!regionGroups.length&&<p className="driver-empty">이 날짜의 발주가 없습니다.</p>}
      </section>
    </main>
  </div>;
}

function StaffLogin({onLogin}:{onLogin:()=>Promise<void>}){
  const [username,setUsername]=useState("");const[pin,setPin]=useState("");const[error,setError]=useState("");const[busy,setBusy]=useState(false);
  async function submit(e:React.FormEvent){e.preventDefault();setBusy(true);setError("");const r=await fetch("/api/staff/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username,pin})});const j=await r.json() as {error?:string};if(!r.ok){setError(j.error||"로그인 실패");setBusy(false);return;}await onLogin();setBusy(false);}
  return <div className="driver-login"><img src={BUJA_LOGO_DATA} alt="부자유통"/><div><p>배송기사 전용</p><h1>직원 로그인</h1><form onSubmit={submit}><label>아이디<input value={username} onChange={e=>setUsername(e.target.value)} autoComplete="username"/></label><label>6자리 PIN<input value={pin} onChange={e=>setPin(e.target.value.replace(/\D/g,"").slice(0,6))} inputMode="numeric" type="password" autoComplete="current-password"/></label>{error&&<p className="form-error">{error}</p>}<button disabled={busy||!username||pin.length!==6}>{busy?"확인 중...":"로그인"}</button></form></div></div>;
}
