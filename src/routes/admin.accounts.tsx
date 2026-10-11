import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { BUJA_LOGO_DATA } from "../brand-assets";

export const Route = createFileRoute("/admin/accounts")({
  head: () => ({ meta: [{ title: "부자유통 계정관리" }, { name: "robots", content: "noindex,nofollow" }] }),
  component: AccountsPage,
});

type StaffRow = { id:string; username:string; display_name:string; role:"ADMIN"|"DRIVER"; active:number|boolean; updated_at:string };
type AdminStatus = { authenticated:boolean; staff?:{displayName:string}|null };

async function post(body:Record<string,unknown>) {
  const r = await fetch("/api/admin/staff",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  const j = await r.json() as {error?:string};
  if(!r.ok) throw new Error(j.error || "계정 작업에 실패했습니다.");
}

function AccountsPage(){
  const [status,setStatus]=useState<AdminStatus|null>(null);
  const [rows,setRows]=useState<StaffRow[]>([]);
  const [error,setError]=useState("");

  async function load(){
    const [sr,rr]=await Promise.all([
      fetch("/api/admin/status",{cache:"no-store"}),
      fetch("/api/admin/staff",{cache:"no-store"}),
    ]);
    const s=await sr.json() as AdminStatus;
    setStatus(s);
    if(rr.ok) setRows(((await rr.json()) as {staff:StaffRow[]}).staff);
  }
  useEffect(()=>{void load().catch(e=>setError(e instanceof Error?e.message:"불러오지 못했습니다."));},[]);

  async function action(body:Record<string,unknown>){
    try{setError("");await post(body);await load();}
    catch(e){setError(e instanceof Error?e.message:"계정 작업에 실패했습니다.");}
  }
  async function logout(){await fetch("/api/admin/logout",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});location.href="/admin";}

  if(status && !status.authenticated) return <div className="state-page"><h1>관리자 로그인이 필요합니다.</h1><a href="/admin">관리자 로그인으로 이동</a></div>;

  return <div className="accounts-page">
    <header className="admin-brandbar"><a href="/admin"><img src={BUJA_LOGO_DATA} alt="부자유통"/></a><div className="session-actions"><span><b>{status?.staff?.displayName || "관리자"}</b><small>관리자</small></span><button type="button" onClick={logout}>로그아웃</button></div></header>
    <main className="accounts-main">
      <div className="accounts-head"><div><p>부자유통 관리자</p><h1>계정관리</h1></div><a href="/admin">← 통합관리자로 돌아가기</a></div>
      {error&&<p className="admin-banner-error">{error}</p>}
      <div className="accounts-grid">
        {rows.map(row=><article className={`account-card ${!Boolean(row.active)?"disabled":""}`} key={row.id}>
          <div><span className={`role-${row.role.toLowerCase()}`}>{row.role==="ADMIN"?"관리자":"배송기사"}</span><h3>{row.display_name}</h3><p>아이디 {row.username}</p></div>
          <div className="account-card-actions">
            <button type="button" onClick={()=>{const v=window.prompt(`${row.display_name} 새 아이디`,row.username);if(v&&v.trim()!==row.username)void action({action:"update-username",id:row.id,username:v.trim()});}}>아이디 변경</button>
            <button type="button" onClick={()=>{const v=window.prompt(`${row.display_name} 새 6자리 PIN`);if(v)void action({action:"reset-pin",id:row.id,pin:v});}}>PIN 변경</button>
            <button type="button" onClick={()=>void action({action:"toggle",id:row.id,active:!Boolean(row.active)})}>{Boolean(row.active)?"계정중지":"계정사용"}</button>
          </div>
        </article>)}
      </div>
    </main>
  </div>;
}
