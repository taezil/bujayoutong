import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { BUJA_LOGO_DATA } from "../brand-assets";

export const Route = createFileRoute("/admin/accounts")({
  head: () => ({ meta: [{ title: "부자유통 계정관리" }, { name: "robots", content: "noindex,nofollow" }] }),
  component: AccountsPage,
});

type AdminStatus={authenticated:boolean;staff?:{displayName:string}|null};
type StaffRow={id:string;username:string;display_name:string;role:"ADMIN"|"DRIVER";active:number|boolean};
type CustomerRow={id:string;code:string;name:string;active:boolean};
type CustomerUser={id:string;customer_id:string;username:string;display_name:string;active:number|boolean;customer_code:string;customer_name:string};

async function post(path:string,body:Record<string,unknown>){
  const r=await fetch(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  const j=await r.json() as {error?:string};
  if(!r.ok) throw new Error(j.error||"계정 작업에 실패했습니다.");
}

function AccountsPage(){
  const[status,setStatus]=useState<AdminStatus|null>(null);
  const[staff,setStaff]=useState<StaffRow[]>([]);
  const[customers,setCustomers]=useState<CustomerRow[]>([]);
  const[customerUsers,setCustomerUsers]=useState<CustomerUser[]>([]);
  const[customerId,setCustomerId]=useState("");
  const[displayName,setDisplayName]=useState("");
  const[username,setUsername]=useState("");
  const[pin,setPin]=useState("");
  const[error,setError]=useState("");

  async function load(){
    const[sr,st,cr,ur]=await Promise.all([
      fetch("/api/admin/status",{cache:"no-store"}),
      fetch("/api/admin/staff",{cache:"no-store"}),
      fetch("/api/admin/customers",{cache:"no-store"}),
      fetch("/api/admin/customer-users",{cache:"no-store"}),
    ]);
    const s=await sr.json() as AdminStatus; setStatus(s);
    if(st.ok)setStaff(((await st.json()) as {staff:StaffRow[]}).staff);
    if(cr.ok){
      const rows=((await cr.json()) as {customers:CustomerRow[]}).customers;
      setCustomers(rows);
      if(!customerId&&rows[0])setCustomerId(rows[0].id);
    }
    if(ur.ok)setCustomerUsers(((await ur.json()) as {users:CustomerUser[]}).users);
  }
  useEffect(()=>{void load().catch(e=>setError(e instanceof Error?e.message:"계정정보를 불러오지 못했습니다."));},[]);

  async function act(path:string,body:Record<string,unknown>){
    try{setError("");await post(path,body);await load();}
    catch(e){setError(e instanceof Error?e.message:"계정 작업에 실패했습니다.");}
  }
  async function logout(){
    await Promise.allSettled([
      fetch("/api/admin/logout",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"}),
      fetch("/api/staff/logout",{method:"POST"}),
    ]);
    location.href="/admin";
  }

  if(status&&!status.authenticated)return <div className="state-page"><div><h1>관리자 로그인이 필요합니다.</h1><a href="/admin">관리자 로그인으로 이동</a></div></div>;

  return <div className="accounts-page">
    <header className="accounts-brandbar">
      <a href="/admin"><img src={BUJA_LOGO_DATA} alt="부자유통"/></a>
      <div className="session-actions"><span><b>{status?.staff?.displayName||"관리자"}</b><small>관리자</small></span><button type="button" onClick={logout}>로그아웃</button></div>
    </header>
    <main className="accounts-main">
      <div className="accounts-head"><div><p>부자유통 통합관리</p><h1>계정관리</h1><span>부자유통 직원과 거래처 직원을 분리해서 관리합니다.</span></div><a href="/admin">← 통합관리자로 돌아가기</a></div>
      {error&&<p className="admin-banner-error">{error}</p>}

      <section className="account-section">
        <div className="account-section-head"><div><p>INTERNAL</p><h2>부자유통 직원 계정</h2></div><span>{staff.length}명</span></div>
        <div className="accounts-grid">
          {staff.map(row=><article className={`account-card ${!Boolean(row.active)?"disabled":""}`} key={row.id}>
            <div><span className={`role-${row.role.toLowerCase()}`}>{row.role==="ADMIN"?"관리자":"배송기사"}</span><h3>{row.display_name}</h3><p>아이디 {row.username}</p></div>
            <div className="account-card-actions">
              <button onClick={()=>{const v=prompt("새 아이디",row.username);if(v&&v.trim()!==row.username)void act("/api/admin/staff",{action:"update-username",id:row.id,username:v.trim()});}}>아이디 변경</button>
              <button onClick={()=>{const v=prompt("새 6자리 PIN");if(v)void act("/api/admin/staff",{action:"reset-pin",id:row.id,pin:v});}}>PIN 변경</button>
              <button onClick={()=>void act("/api/admin/staff",{action:"toggle",id:row.id,active:!Boolean(row.active)})}>{Boolean(row.active)?"계정중지":"계정사용"}</button>
            </div>
          </article>)}
        </div>
      </section>

      <section className="account-section">
        <div className="account-section-head"><div><p>CUSTOMER</p><h2>거래처 직원 계정</h2></div><span>{customerUsers.length}명</span></div>
        <div className="customer-user-create">
          <select value={customerId} onChange={e=>setCustomerId(e.target.value)}>{customers.filter(c=>c.active).map(c=><option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select>
          <input value={displayName} onChange={e=>setDisplayName(e.target.value)} placeholder="직원 이름 예: 사장님 / 점장"/>
          <input value={username} onChange={e=>setUsername(e.target.value.toLowerCase())} placeholder="직원 아이디"/>
          <input value={pin} onChange={e=>setPin(e.target.value.replace(/\D/g,"").slice(0,6))} inputMode="numeric" placeholder="PIN 6자리"/>
          <button disabled={!customerId||!displayName.trim()||!username.trim()||pin.length!==6} onClick={()=>void act("/api/admin/customer-users",{action:"create",customerId,displayName,username,pin}).then(()=>{setDisplayName("");setUsername("");setPin("");})}>+ 거래처 직원 추가</button>
        </div>
        <div className="accounts-grid">
          {customerUsers.map(row=><article className={`account-card ${!Boolean(row.active)?"disabled":""}`} key={row.id}>
            <div><span className="role-customer">거래처</span><h3>{row.display_name}</h3><p>{row.customer_code} · {row.customer_name}</p><p>아이디 {row.username}</p></div>
            <div className="account-card-actions">
              <button onClick={()=>{const v=prompt("새 직원 이름",row.display_name);if(v)void act("/api/admin/customer-users",{action:"update",id:row.id,username:row.username,displayName:v});}}>이름 변경</button>
              <button onClick={()=>{const v=prompt("새 직원 아이디",row.username);if(v&&v.trim()!==row.username)void act("/api/admin/customer-users",{action:"update",id:row.id,username:v.trim(),displayName:row.display_name});}}>아이디 변경</button>
              <button onClick={()=>{const v=prompt("새 6자리 PIN");if(v)void act("/api/admin/customer-users",{action:"reset-pin",id:row.id,pin:v});}}>PIN 변경</button>
              <button onClick={()=>void act("/api/admin/customer-users",{action:"toggle",id:row.id,active:!Boolean(row.active)})}>{Boolean(row.active)?"계정중지":"계정사용"}</button>
            </div>
          </article>)}
        </div>
        {!customerUsers.length&&<p className="accounts-empty">아직 등록된 거래처 직원 계정이 없습니다.</p>}
      </section>
    </main>
  </div>;
}
