import { createFileRoute } from "@tanstack/react-router";
import { isAdmin } from "../../../lib/auth.server";
import { db, ensureDatabase } from "../../../lib/db.server";

export const Route=createFileRoute("/api/admin/audit")({server:{handlers:{GET:async({request})=>{
  if(!(await isAdmin(request))) return Response.json({error:"관리자 로그인이 필요합니다."},{status:403});
  await ensureDatabase();
  const rows=await db().prepare("SELECT id,actor_name,action,entity_type,entity_id,summary,created_at FROM audit_logs ORDER BY created_at DESC,id DESC LIMIT 80").all();
  return Response.json({logs:rows.results},{headers:{"Cache-Control":"no-store"}});
}}}});
