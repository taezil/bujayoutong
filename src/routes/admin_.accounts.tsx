import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { BUJA_LOGO_DATA } from "../brand-assets";

export const Route = createFileRoute("/admin_/accounts")({
  head: () => ({ meta: [{ title: "부자유통 계정관리" }, { name: "robots", content: "noindex,nofollow" }] }),
  component: AccountsPage,
});

type AdminStatus={authenticated:boolean;staff?:{displayName:string}|null};
type StaffRow={id:string;username:string;display_name:string;role:"ADMIN"|"DRIVER";active:number|boolean};
type CustomerRow={id:string;code:string;name:string;active:boolean;businessNumber?:string;phone?:string;storePhone?:string;address?:string};
type CustomerUser={id:string;customer_id:string;username:string;display_name:string;active:number|boolean;customer_code:string;customer_name:string};
type CustomerUserLink={customer_user_id:string;customer_id:string;sort_order:number};
type PlanRow={customerId:string;code:string;name:string;loginId:string;rule:"block-lot"|"code"|"code-duplicate"};
type Plan={pending:PlanRow[];skipped:Array<{customerId:string;code:string;name:string;reason:string}>;alreadyLinked:number;totalActive:number};
const ruleLabel:Record<PlanRow["rule"],string>={"block-lot":"블록번호","code":"거래처코드","code-duplicate":"중복→거래처코드"};
function normalizeSearch(value:string){return value.toLowerCase().replace(/[\s\-–—]+/g,"");}

function parseCsv(text:string){
  const rows:string[][]=[];
  let row:string[]=[];
  let cell="";
  let quoted=false;
  for(let i=0;i<text.length;i+=1){
    const ch=text[i];
    if(quoted){
      if(ch==='"'&&text[i+1]==='"'){cell+='"';i+=1;}
      else if(ch==='"')quoted=false;
      else cell+=ch;
      continue;
    }
    if(ch==='"'){quoted=true;continue;}
    if(ch===","){row.push(cell);cell="";continue;}
    if(ch==="\n"){
      row.push(cell.replace(/\r$/,""));cell="";
      if(row.some(value=>value!==""))rows.push(row);
      row=[];
      continue;
    }
    cell+=ch;
  }
  row.push(cell.replace(/\r$/,""));
  if(row.some(value=>value!==""))rows.push(row);
  if(!rows.length)return [] as Array<Record<string,string>>;
  const headers=rows[0].map((value,index)=>index===0?value.replace(/^\uFEFF/,"").trim():value.trim());
  return rows.slice(1).map(values=>Object.fromEntries(headers.map((header,index)=>[header,(values[index]??"").trim()])));
}

async function post(path:string,body:Record<string,unknown>){
  const r=await fetch(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  const j=await r.json() as {error?:string};
  if(!r.ok) throw new Error(j.error||"계정 작업에 실패했습니다.");
  return j;
}

function AccountsPage(){
  const[status,setStatus]=useState<AdminStatus|null>(null);
  const[staff,setStaff]=useState<StaffRow[]>([]);
  const[customers,setCustomers]=useState<CustomerRow[]>([]);
  const[customerUsers,setCustomerUsers]=useState<CustomerUser[]>([]);
  const[customerLinks,setCustomerLinks]=useState<CustomerUserLink[]>([]);
  const[linkingUser,setLinkingUser]=useState<CustomerUser|null>(null);
  const[linkSearch,setLinkSearch]=useState("");
  const[linkIds,setLinkIds]=useState<string[]>([]);
  const[customerId,setCustomerId]=useState("");
  const[displayName,setDisplayName]=useState("");
  const[username,setUsername]=useState("");
  const[password,setPassword]=useState("");
  const[createdCredential,setCreatedCredential]=useState<{customerName:string;displayName:string;username:string;password:string}|null>(null);
  const[error,setError]=useState("");
  const[plan,setPlan]=useState<Plan|null>(null);
  const[provisioning,setProvisioning]=useState("");
  const[importRows,setImportRows]=useState<Array<Record<string,string>>>([]);
  const[importFileName,setImportFileName]=useState("");
  const[importing,setImporting]=useState("");
  const[accountSearch,setAccountSearch]=useState("");
  const[accountPage,setAccountPage]=useState(1);

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
    if(ur.ok){
      const data=await ur.json() as {users:CustomerUser[];links?:CustomerUserLink[]};
      setCustomerUsers(data.users);
      setCustomerLinks(data.links??[]);
    }
  }
  useEffect(()=>{void load().catch(e=>setError(e instanceof Error?e.message:"계정정보를 불러오지 못했습니다."));},[]);

  async function act(path:string,body:Record<string,unknown>){
    try{setError("");const result=await post(path,body);await load();return result;}
    catch(e){setError(e instanceof Error?e.message:"계정 작업에 실패했습니다.");return null;}
  }
  async function createCustomerUser(){
    const selected=customers.find(row=>row.id===customerId);
    const result=await act("/api/admin/customer-users",{action:"create",customerId,displayName,username,password});
    if(!result)return;
    setCreatedCredential({customerName:selected?.name||"",displayName:displayName.trim(),username:username.trim(),password});
    setDisplayName("");setUsername("");setPassword("");
  }
  function openLocationManager(row:CustomerUser){
    const current=customerLinks.filter(link=>link.customer_user_id===row.id).map(link=>link.customer_id);
    setLinkIds(current.length?current:[row.customer_id]);
    setLinkSearch("");
    setLinkingUser(row);
  }
  function toggleLinkedCustomer(id:string){
    setLinkIds(current=>current.includes(id)?current.filter(value=>value!==id):[...current,id]);
  }
  async function saveLinkedCustomers(){
    if(!linkingUser||!linkIds.length)return;
    const result=await act("/api/admin/customer-users",{action:"set-customers",id:linkingUser.id,customerIds:linkIds});
    if(result)setLinkingUser(null);
  }

  async function copyCreatedCredential(){
    if(!createdCredential)return;
    const message=`[부자유통 거래처 주문 로그인]\n주소: https://order.bujafood.kr/\n거래처: ${createdCredential.customerName}\n아이디: ${createdCredential.username}\n비밀번호: ${createdCredential.password}\n\n한 번 로그인하면 같은 휴대폰에서는 자동 로그인됩니다.`;
    try{await navigator.clipboard.writeText(message);}
    catch{window.prompt("아래 내용을 복사해 전달해 주세요.",message);}
  }
  async function chooseImportFile(file:File|null){
    if(!file){setImportRows([]);setImportFileName("");setImporting("");return;}
    try{
      setError("");
      const parsed=parseCsv(await file.text());
      const valid=parsed.filter(row=>row.code&&row.name);
      if(!valid.length)throw new Error("등록할 거래처가 없습니다. 부자유통 일괄등록 CSV 파일인지 확인해 주세요.");
      setImportRows(valid);
      setImportFileName(file.name);
      setImporting(String(valid.length)+"개 거래처 준비됨");
    }catch(e){
      setImportRows([]);setImportFileName("");setImporting("");
      setError(e instanceof Error?e.message:"파일을 읽지 못했습니다.");
    }
  }

  async function importCustomersAndProvision(){
    if(!importRows.length)return;
    const activeCount=importRows.filter(row=>row.active!=="0").length;
    const inactiveCount=importRows.length-activeCount;
    const ok=confirm("거래처 "+importRows.length+"곳을 등록합니다.\n활성 "+activeCount+"곳 / 비활성 "+inactiveCount+"곳\n\n등록 후 활성 거래처의 로그인 계정도 자동 생성합니다.\n비밀번호는 아이디와 같습니다. 진행할까요?");
    if(!ok)return;
    setError("");
    let imported=0;
    try{
      for(let i=0;i<importRows.length;i+=30){
        const chunk=importRows.slice(i,i+30).map(row=>({
          code:row.code,
          name:row.name,
          businessNumber:row.businessNumber||"",
          address:row.address||"",
          phone:row.phone||"",
          storePhone:row.storePhone||"",
          region:row.region||"",
          active:row.active!=="0",
        }));
        const result=await post("/api/admin/customers",{action:"import-batch",rows:chunk}) as unknown as {imported:number};
        imported+=result.imported||0;
        setImporting("거래처 등록 "+imported+"/"+importRows.length);
      }

      await load();
      const preview=await post("/api/admin/customer-users",{action:"provision-preview"}) as unknown as Plan;
      setPlan(preview);
      let created=0;
      let remaining=preview.pending.length;
      for(let round=0;round<80&&remaining>0;round+=1){
        const result=await post("/api/admin/customer-users",{action:"provision-run",limit:20}) as unknown as {created:PlanRow[];failed:Array<PlanRow&{error:string}>;remaining:number};
        created+=result.created.length;
        remaining=result.remaining;
        setImporting("거래처 "+imported+"곳 등록 완료 · 로그인 계정 "+created+"개 생성 · 남은 "+remaining+"개");
        if(result.failed.length)setError("일부 계정 생성 실패: "+result.failed.slice(0,3).map(item=>item.code+" "+item.name+"("+item.error+")").join(", "));
        if(!result.created.length&&remaining>0)break;
      }
      setImporting("완료: 거래처 "+imported+"곳 등록 · 로그인 계정 "+created+"개 생성");
      await load();
      await previewProvision();
    }catch(e){
      setError(e instanceof Error?e.message:"거래처 일괄등록에 실패했습니다.");
      setImporting(current=>current?current+" · 중단됨":"중단됨");
    }
  }

  async function previewProvision(){
    try{setError("");setPlan(await post("/api/admin/customer-users",{action:"provision-preview"}) as unknown as Plan);}
    catch(e){setError(e instanceof Error?e.message:"미리보기에 실패했습니다.");}
  }
  async function runProvision(){
    if(!plan||!plan.pending.length)return;
    if(!confirm(`${plan.pending.length}개 거래처 계정을 만듭니다.\n비밀번호는 아이디와 같게 설정됩니다. 진행할까요?`))return;
    setError("");let total=0;
    try{
      for(let round=0;round<60;round+=1){
        const r=await post("/api/admin/customer-users",{action:"provision-run",limit:20}) as unknown as {created:PlanRow[];failed:Array<PlanRow&{error:string}>;remaining:number};
        total+=r.created.length;
        setProvisioning(`${total}개 생성 · 남은 ${r.remaining}개`);
        if(r.failed.length)setError(`일부 실패: ${r.failed.slice(0,3).map(f=>`${f.name}(${f.error})`).join(", ")}`);
        if(!r.remaining||!r.created.length)break;
      }
    }catch(e){setError(e instanceof Error?e.message:"일괄 생성에 실패했습니다.");}
    setProvisioning(`완료: ${total}개 계정 생성`);
    await load();await previewProvision();
  }

  const accountQuery=normalizeSearch(accountSearch);
  const linkedCustomerIdsByUser=new Map<string,string[]>();
  for(const link of customerLinks){
    const current=linkedCustomerIdsByUser.get(link.customer_user_id)??[];
    current.push(link.customer_id);
    linkedCustomerIdsByUser.set(link.customer_user_id,current);
  }
  const filteredCustomerUsers=customerUsers.filter(row=>{
    if(!accountQuery)return true;
    const primary=customers.find(customer=>customer.id===row.customer_id);
    const linked=(linkedCustomerIdsByUser.get(row.id)??[])
      .map(id=>customers.find(customer=>customer.id===id))
      .filter((customer):customer is CustomerRow=>Boolean(customer));
    const haystack=[
      row.customer_name,row.customer_code,row.username,row.display_name,
      primary?.businessNumber??"",primary?.phone??"",primary?.storePhone??"",primary?.address??"",
      ...linked.flatMap(customer=>[customer.name,customer.code,customer.businessNumber??"",customer.phone??"",customer.storePhone??"",customer.address??""]),
    ].map(value=>normalizeSearch(String(value))).join("|");
    return haystack.includes(accountQuery);
  });
  const accountPageSize=10;
  const accountPageCount=Math.max(1,Math.ceil(filteredCustomerUsers.length/accountPageSize));
  const safeAccountPage=Math.min(accountPage,accountPageCount);
  const pagedCustomerUsers=filteredCustomerUsers.slice((safeAccountPage-1)*accountPageSize,safeAccountPage*accountPageSize);

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
      <div className="accounts-head"><div><p>부자유통 통합관리</p><h1>계정관리</h1><span>부자유통 직원과 거래처 계정을 분리해서 관리합니다.</span></div><a href="/admin">← 통합관리자로 돌아가기</a></div>
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
        <div className="account-section-head"><div><p>CUSTOMER</p><h2>거래처 계정</h2><small>거래처별 로그인 계정과 연결 배송처를 관리합니다. 아이디는 전체 거래처에서 중복 사용할 수 없습니다.</small></div><span>{customerUsers.length}개</span></div>
        <div className="customer-user-create">
          <select value={customerId} onChange={e=>setCustomerId(e.target.value)}>{customers.filter(c=>c.active).map(c=><option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select>
          <input value={displayName} onChange={e=>setDisplayName(e.target.value)} placeholder="직원 이름 예: 사장님 / 점장"/>
          <input value={username} onChange={e=>setUsername(e.target.value.toLowerCase().replace(/[\s\-–—]+/g,""))} placeholder="로그인 아이디 예: 12013"/>
          <input value={password} onChange={e=>setPassword(e.target.value.slice(0,64))} type="text" autoComplete="new-password" placeholder="비밀번호 2자 이상"/>
          <button disabled={!customerId||!displayName.trim()||!username.trim()||password.trim().length<2} onClick={()=>void createCustomerUser()}>+ 거래처 계정 추가</button>
        </div>
        {createdCredential&&<div className="customer-credential-card"><div><b>계정이 생성되었습니다.</b><span>{createdCredential.customerName} · {createdCredential.displayName}</span><code>아이디 {createdCredential.username} / 비밀번호 {createdCredential.password}</code></div><button type="button" onClick={()=>void copyCreatedCredential()}>로그인 정보 복사</button></div>}
        <div className="account-list-toolbar">
          <div className="account-search-box">
            <span>⌕</span>
            <input
              value={accountSearch}
              onChange={e=>{setAccountSearch(e.target.value);setAccountPage(1);}}
              placeholder="거래처 검색 · 상호명, 거래처번호, 로그인ID, 이름, 사업자번호, 전화번호"
            />
            {accountSearch&&<button type="button" onClick={()=>{setAccountSearch("");setAccountPage(1);}}>×</button>}
          </div>
          <small>{accountSearch?`검색결과 ${filteredCustomerUsers.length}개`:`전체 ${customerUsers.length}개`} · 10개씩 보기</small>
        </div>
        <div className="accounts-grid">
          {pagedCustomerUsers.map(row=><article className={`account-card ${!Boolean(row.active)?"disabled":""}`} key={row.id}>
            <div><span className="role-customer">거래처</span><h3>{row.display_name}</h3><p>{row.customer_code} · {row.customer_name}</p><p>아이디 {row.username}</p><p>배송처 {Math.max(1,customerLinks.filter(link=>link.customer_user_id===row.id).length)}곳</p></div>
            <div className="account-card-actions">
              <button onClick={()=>{const v=prompt("새 직원 이름",row.display_name);if(v)void act("/api/admin/customer-users",{action:"update",id:row.id,username:row.username,displayName:v});}}>이름 변경</button>
              <button onClick={()=>{const v=prompt("새 직원 아이디",row.username);if(v&&v.trim()!==row.username)void act("/api/admin/customer-users",{action:"update",id:row.id,username:v.trim(),displayName:row.display_name});}}>아이디 변경</button>
              <button className="primary" onClick={()=>openLocationManager(row)}>배송처 연결</button>
              <button onClick={()=>{const v=prompt("새 비밀번호 (2~64자)");if(v)void act("/api/admin/customer-users",{action:"reset-password",id:row.id,password:v});}}>비밀번호 변경</button>
              <button onClick={()=>void act("/api/admin/customer-users",{action:"toggle",id:row.id,active:!Boolean(row.active)})}>{Boolean(row.active)?"계정중지":"계정사용"}</button>
            </div>
          </article>)}
        </div>
        {!customerUsers.length&&<p className="accounts-empty">아직 등록된 거래처 계정이 없습니다.</p>}
        {customerUsers.length>0&&!filteredCustomerUsers.length&&<p className="accounts-empty">검색되는 거래처 계정이 없습니다.</p>}
        {filteredCustomerUsers.length>0&&<div className="account-pagination">
          <button type="button" disabled={safeAccountPage<=1} onClick={()=>setAccountPage(page=>Math.max(1,page-1))}>‹ 이전</button>
          <span><b>{safeAccountPage}</b> / {accountPageCount}</span>
          <button type="button" disabled={safeAccountPage>=accountPageCount} onClick={()=>setAccountPage(page=>Math.min(accountPageCount,page+1))}>다음 ›</button>
        </div>}
      </section>

      <section className="account-section">
        <div className="account-section-head">
          <div>
            <p>IMPORT</p><h2>거래처 명단 일괄등록</h2>
            <small>얼마에요 거래처 명단을 정리한 CSV를 올리면 거래처 정보가 D1에 등록되고, 활성 거래처의 로그인 계정까지 자동 생성됩니다. 업로드 데이터는 GitHub 소스에 저장되지 않습니다.</small>
          </div>
          <span>{importRows.length?importRows.length+"곳":"CSV"}</span>
        </div>
        <div className="customer-user-create accounts-import-controls">
          <label className="accounts-file-button">
            CSV 선택
            <input type="file" accept=".csv,text/csv" onChange={e=>void chooseImportFile(e.target.files?.[0]??null)}/>
          </label>
          <span>{importFileName||"파일을 선택해 주세요."}</span>
          <button type="button" disabled={!importRows.length||Boolean(importing&&importing.startsWith("거래처 등록 "))} onClick={()=>void importCustomersAndProvision()}>
            거래처 등록 + 로그인계정 생성
          </button>
        </div>
        {importRows.length>0&&<div className="accounts-provision">
          <p>등록 대상 {importRows.length}곳 · 활성 {importRows.filter(row=>row.active!=="0").length}곳 · 비활성 {importRows.filter(row=>row.active==="0").length}곳</p>
          {importing&&<p>{importing}</p>}
          <div className="account-link-list">
            {importRows.slice(0,20).map(row=><label key={row.code}><span><b>{row.code}</b><small>{row.name} · 로그인ID {row.loginId||"자동생성"}</small></span></label>)}
            {importRows.length>20&&<label><span><b>외 {importRows.length-20}곳</b><small>파일의 나머지 거래처도 함께 등록됩니다.</small></span></label>}
          </div>
        </div>}
      </section>

      <section className="account-section">
        <div className="account-section-head"><div><p>BULK</p><h2>거래처 계정 일괄 생성</h2><small>거래처명의 블록번호(120-13 → 12013), 없으면 거래처코드를 아이디로 만듭니다. 숫자 아이디가 겹치면 거래처코드를 씁니다. 비밀번호는 아이디와 같습니다. 이미 계정이 있는 거래처는 건드리지 않습니다.</small></div></div>
        <div className="customer-user-create">
          <button type="button" onClick={()=>void previewProvision()}>미리보기</button>
          <button type="button" disabled={!plan||!plan.pending.length||Boolean(provisioning&&!provisioning.startsWith("완료"))} onClick={()=>void runProvision()}>{plan?`${plan.pending.length}개 계정 생성`:"계정 생성"}</button>
          {provisioning&&<span>{provisioning}</span>}
        </div>
        {plan&&<div className="accounts-provision">
          <p>활성 거래처 {plan.totalActive}곳 · 이미 계정 있음 {plan.alreadyLinked}곳 · 생성 예정 {plan.pending.length}곳 · 제외 {plan.skipped.length}곳</p>
          <div className="account-link-list">
            {plan.pending.slice(0,300).map(row=><label key={row.customerId}><span><b>{row.loginId}</b><small>{row.code} · {row.name} · {ruleLabel[row.rule]}</small></span></label>)}
            {plan.skipped.map(row=><label key={`skip-${row.customerId}`} className="selected"><span><b>제외</b><small>{row.code} · {row.name} · {row.reason}</small></span></label>)}
          </div>
        </div>}
      </section>
    </main>

    {linkingUser&&<div className="account-link-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setLinkingUser(null);}}>
      <section className="account-link-modal" role="dialog" aria-modal="true" aria-label="배송처 연결">
        <div className="account-link-head">
          <div><small>{linkingUser.username}</small><h2>배송처 연결</h2><p>{linkingUser.display_name} 계정으로 주문할 식당을 선택하세요.</p></div>
          <button type="button" onClick={()=>setLinkingUser(null)}>×</button>
        </div>
        <input className="account-link-search" value={linkSearch} onChange={e=>setLinkSearch(e.target.value)} placeholder="거래처명 또는 코드 검색"/>
        <div className="account-link-selected">선택 {linkIds.length}곳</div>
        <div className="account-link-list">
          {customers.filter(row=>{
            if(!row.active&&!linkIds.includes(row.id))return false;
            const q=normalizeSearch(linkSearch);
            return !q||normalizeSearch(row.name).includes(q)||normalizeSearch(row.code).includes(q);
          }).sort((a,b)=>Number(linkIds.includes(b.id))-Number(linkIds.includes(a.id))).slice(0,100).map(row=><label key={row.id} className={linkIds.includes(row.id)?"selected":""}>
            <input type="checkbox" checked={linkIds.includes(row.id)} onChange={()=>toggleLinkedCustomer(row.id)}/>
            <span><b>{row.name}</b><small>{row.code}</small></span>
          </label>)}
        </div>
        <div className="account-link-actions">
          <button type="button" onClick={()=>setLinkingUser(null)}>취소</button>
          <button type="button" className="save" disabled={!linkIds.length} onClick={()=>void saveLinkedCustomers()}>{linkIds.length}곳 연결 저장</button>
        </div>
      </section>
    </div>}
  </div>;
}
