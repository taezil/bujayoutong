import { createFileRoute } from "@tanstack/react-router";
import { getStaff, isAdmin, resetStaffPin, validMutationOrigin } from "../../../lib/auth.server";
import { db, ensureDatabase } from "../../../lib/db.server";
import { cleanText } from "../../../lib/admin-validation.server";
import { writeAudit, staffActor } from "../../../lib/audit.server";

export const Route = createFileRoute("/api/admin/staff")({
  server:{handlers:{
    GET:async({request})=>{
      if(!(await isAdmin(request))) return Response.json({error:"관리자 로그인이 필요합니다."},{status:403});
      await ensureDatabase();
      const rows=await db().prepare("SELECT id,username,display_name,role,active,updated_at FROM staff_users ORDER BY CASE role WHEN 'ADMIN' THEN 0 ELSE 1 END, display_name").all();
      return Response.json({staff:rows.results},{headers:{"Cache-Control":"no-store"}});
    },
    POST:async({request})=>{
      if(!validMutationOrigin(request)||!(await isAdmin(request))) return Response.json({error:"관리자 로그인이 필요합니다."},{status:403});
      await ensureDatabase();
      try{
        const body=await request.json() as Record<string,unknown>; const action=cleanText(body.action,30); const id=cleanText(body.id,80);
        if(!id) throw new Error("직원을 선택해 주세요.");
        const current=await getStaff(request); const actor=current?staffActor(current):{type:"admin" as const,id:"legacy-admin",name:"관리자"};
        const row=await db().prepare("SELECT display_name,role FROM staff_users WHERE id=?").bind(id).first<{display_name:string;role:string}>();
        if(!row) throw new Error("직원을 찾을 수 없습니다.");
        if(action==="reset-pin"){
          const pin=cleanText(body.pin,6); await resetStaffPin(id,pin);
          await writeAudit({actor,action:"staff_pin_reset",entityType:"staff",entityId:id,summary:`${row.display_name} 로그인 PIN 초기화`});
          return Response.json({ok:true});
        }
        if(action==="toggle"){
          const active=body.active===true||body.active===1;
          await db().batch([
            db().prepare("UPDATE staff_users SET active=?,updated_at=datetime('now') WHERE id=?").bind(active?1:0,id),
            ...(active?[]:[db().prepare("DELETE FROM staff_sessions WHERE staff_id=?").bind(id)]),
          ]);
          await writeAudit({actor,action:"staff_toggle",entityType:"staff",entityId:id,summary:`${row.display_name} 계정 ${active?"사용":"중지"}`});
          return Response.json({ok:true});
        }
        throw new Error("지원하지 않는 작업입니다.");
      }catch(error){return Response.json({error:error instanceof Error?error.message:"직원 계정 작업에 실패했습니다."},{status:400});}
    },
  }}
});
