import { createFileRoute } from "@tanstack/react-router";
import { getStaff, isAdmin, validMutationOrigin } from "../../../lib/auth.server";
import { db, ensureDatabase } from "../../../lib/db.server";
import { cleanText } from "../../../lib/admin-validation.server";
import { writeAudit, staffActor } from "../../../lib/audit.server";

export const Route=createFileRoute("/api/admin/suppliers")({server:{handlers:{
  GET:async({request})=>{
    if(!(await isAdmin(request))) return Response.json({error:"관리자 로그인이 필요합니다."},{status:403});
    await ensureDatabase();
    const rows=await db().prepare("SELECT id,name,phone,category_note,order_cutoff,memo,sort_order,active FROM suppliers WHERE active=1 ORDER BY sort_order,name").all();
    return Response.json({suppliers:rows.results},{headers:{"Cache-Control":"no-store"}});
  },
  POST:async({request})=>{
    if(!validMutationOrigin(request)||!(await isAdmin(request))) return Response.json({error:"관리자 로그인이 필요합니다."},{status:403});
    await ensureDatabase();
    try{
      const body=await request.json() as Record<string,unknown>; const action=cleanText(body.action,20);
      const staff=await getStaff(request); const actor=staff?staffActor(staff):{type:"admin" as const,id:"legacy-admin",name:"관리자"};
      if(action==="create"){
        const name=cleanText(body.name,100); if(!name) throw new Error("업체명을 입력해 주세요.");
        const id=`SUP-${crypto.randomUUID()}`;
        const next=await db().prepare("SELECT COALESCE(MAX(sort_order),-1)+1 AS n FROM suppliers").first<{n:number}>();
        await db().prepare("INSERT INTO suppliers(id,name,phone,category_note,order_cutoff,memo,sort_order) VALUES(?,?,?,?,?,?,?)").bind(id,name,cleanText(body.phone,40),cleanText(body.categoryNote,120),cleanText(body.orderCutoff,40),cleanText(body.memo,200),Number(next?.n??0)).run();
        await writeAudit({actor,action:"supplier_create",entityType:"supplier",entityId:id,summary:`매입처 ${name} 추가`});
        return Response.json({ok:true,id});
      }
      const id=cleanText(body.id,80); if(!id) throw new Error("업체를 선택해 주세요.");
      if(action==="update"){
        const name=cleanText(body.name,100); if(!name) throw new Error("업체명을 입력해 주세요.");
        await db().prepare("UPDATE suppliers SET name=?,phone=?,category_note=?,order_cutoff=?,memo=?,updated_at=datetime('now') WHERE id=?").bind(name,cleanText(body.phone,40),cleanText(body.categoryNote,120),cleanText(body.orderCutoff,40),cleanText(body.memo,200),id).run();
        await writeAudit({actor,action:"supplier_update",entityType:"supplier",entityId:id,summary:`매입처 ${name} 정보수정`}); return Response.json({ok:true});
      }
      if(action==="delete"){
        await db().prepare("UPDATE suppliers SET active=0,updated_at=datetime('now') WHERE id=?").bind(id).run();
        await writeAudit({actor,action:"supplier_delete",entityType:"supplier",entityId:id,summary:`매입처 비활성화`}); return Response.json({ok:true});
      }
      throw new Error("지원하지 않는 작업입니다.");
    }catch(error){return Response.json({error:error instanceof Error?error.message:"매입처 저장에 실패했습니다."},{status:400});}
  }
}}});
