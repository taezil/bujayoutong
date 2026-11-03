import { createFileRoute } from "@tanstack/react-router";
import { ADMIN_PASSWORD_MIN, adminActorFor, changeOwnAdminPassword, getAdminIdentity, isAdmin, resetStaffPin, validMutationOrigin } from "../../../lib/auth.server";
import { makeCustomerPasswordCredential } from "../../../lib/password.server";
import { db, ensureDatabase } from "../../../lib/db.server";
import { cleanText } from "../../../lib/admin-validation.server";
import { writeAudit } from "../../../lib/audit.server";

export const Route = createFileRoute("/api/admin/staff")({
  server:{handlers:{
    GET:async({request})=>{
      if(!(await isAdmin(request))) return Response.json({error:"관리자 로그인이 필요합니다."},{status:403});
      await ensureDatabase();
      const rows=await db().prepare("SELECT id,username,display_name,role,active,updated_at FROM staff_users WHERE id<>'S-DESK-ADMIN' AND id NOT LIKE 'S-ADMINUSER-%' ORDER BY CASE role WHEN 'ADMIN' THEN 0 ELSE 1 END, display_name").all();
      // 관리자 계정(admin + 추가 관리자) 목록
      const admins=await db().prepare("SELECT id,username,display_name,active,updated_at,(auth_hash<>'') AS has_password FROM admin_users ORDER BY username").all();
      const me=await getAdminIdentity(request);
      return Response.json({staff:rows.results,adminUsers:admins.results,me},{headers:{"Cache-Control":"no-store"}});
    },
    POST:async({request})=>{
      if(!validMutationOrigin(request)||!(await isAdmin(request))) return Response.json({error:"관리자 로그인이 필요합니다."},{status:403});
      await ensureDatabase();
      try{
        const body=await request.json() as Record<string,unknown>; const action=cleanText(body.action,30); const id=cleanText(body.id,80);
        const actor=await adminActorFor(request);

        // ---- 내 비밀번호 변경 (admin 포함, 로그인한 본인) ----
        if(action==="my-password"){
          const me=await changeOwnAdminPassword(request,String(body.currentPassword??""),String(body.password??""));
          await writeAudit({actor,action:"admin_own_password",entityType:"admin_user",entityId:me.id,summary:`${me.displayName} 본인 비밀번호 변경`});
          return Response.json({ok:true});
        }

        // ---- 관리자 계정 (admin 외 추가 관리자: 모두 같은 전체 권한) ----
        if(action==="admin-create"){
          const username=cleanText(body.username,40).toLowerCase();
          const password=cleanText(body.password,64);
          const displayName=cleanText(body.displayName,40)||username;
          if(!/^[a-z0-9._-]{2,40}$/.test(username)||username==="admin") throw new Error("아이디는 영문 소문자·숫자로 2자 이상 입력해 주세요. (admin 은 사용할 수 없습니다)");
          if(password.length<ADMIN_PASSWORD_MIN) throw new Error(`비밀번호는 ${ADMIN_PASSWORD_MIN}자 이상으로 정해 주세요.`);
          if(await db().prepare("SELECT id FROM admin_users WHERE lower(username)=? LIMIT 1").bind(username).first()) throw new Error("이미 있는 관리자 아이디입니다.");
          const credential=await makeCustomerPasswordCredential(password);
          const newId=`A-${crypto.randomUUID()}`;
          await db().prepare("INSERT INTO admin_users(id,username,display_name,auth_salt,auth_hash,active) VALUES(?,?,?,?,?,1)").bind(newId,username,displayName,credential.salt,credential.hash).run();
          await writeAudit({actor,action:"admin_user_create",entityType:"admin_user",entityId:newId,summary:`관리자 계정 ${username} 추가`});
          return Response.json({ok:true,id:newId});
        }
        if(action==="admin-rename"){
          const displayName=cleanText(body.displayName,40);
          if(!displayName) throw new Error("이름(호칭)을 입력해 주세요.");
          const target=await db().prepare("SELECT id,username FROM admin_users WHERE id=?").bind(id).first<{id:string;username:string}>();
          if(!target) throw new Error("관리자 계정을 찾을 수 없습니다.");
          await db().batch([
            db().prepare("UPDATE admin_users SET display_name=?,updated_at=datetime('now') WHERE id=?").bind(displayName,id),
            db().prepare("UPDATE staff_users SET display_name=? WHERE id=?").bind(displayName,`S-ADMINUSER-${id}`),
          ]);
          await writeAudit({actor,action:"admin_user_rename",entityType:"admin_user",entityId:id,summary:`관리자 계정 ${target.username} 이름 → ${displayName}`});
          return Response.json({ok:true});
        }
        if(action==="admin-password"||action==="admin-toggle"){
          const target=await db().prepare("SELECT id,username FROM admin_users WHERE id=?").bind(id).first<{id:string;username:string}>();
          if(!target) throw new Error("관리자 계정을 찾을 수 없습니다.");
          if(action==="admin-password"){
            const password=cleanText(body.password,64);
            if(password.length<ADMIN_PASSWORD_MIN) throw new Error(`비밀번호는 ${ADMIN_PASSWORD_MIN}자 이상으로 정해 주세요.`);
            const credential=await makeCustomerPasswordCredential(password);
            const me=await getAdminIdentity(request);
            await db().batch([
              db().prepare("UPDATE admin_users SET auth_salt=?,auth_hash=?,updated_at=datetime('now') WHERE id=?").bind(credential.salt,credential.hash,id),
              // 비밀번호를 바꾸면 그 계정의 다른 로그인은 해제 (본인이 직접 바꾸는 경우는 지금 화면 유지)
              ...(me?.id===id?[]:[db().prepare("DELETE FROM admin_sessions WHERE admin_user_id=?").bind(id)]),
              db().prepare("DELETE FROM desk_sessions WHERE staff_id=?").bind(`S-ADMINUSER-${id}`),
            ]);
            await writeAudit({actor,action:"admin_user_password",entityType:"admin_user",entityId:id,summary:`관리자 계정 ${target.username} 비밀번호 변경`});
            return Response.json({ok:true});
          }
          const active=body.active===true||body.active===1;
          const me=await getAdminIdentity(request);
          if(!active&&me?.id===id) throw new Error("지금 로그인한 본인 계정은 중지할 수 없습니다.");
          await db().batch([
            db().prepare("UPDATE admin_users SET active=?,updated_at=datetime('now') WHERE id=?").bind(active?1:0,id),
            db().prepare("UPDATE staff_users SET active=? WHERE id=?").bind(active?1:0,`S-ADMINUSER-${id}`),
            ...(active?[]:[
              db().prepare("DELETE FROM admin_sessions WHERE admin_user_id=?").bind(id),
              db().prepare("DELETE FROM desk_sessions WHERE staff_id=?").bind(`S-ADMINUSER-${id}`),
            ]),
          ]);
          await writeAudit({actor,action:"admin_user_toggle",entityType:"admin_user",entityId:id,summary:`관리자 계정 ${target.username} ${active?"사용":"중지"}`});
          return Response.json({ok:true});
        }

        if(!id) throw new Error("직원을 선택해 주세요.");
        const row=await db().prepare("SELECT display_name,role FROM staff_users WHERE id=?").bind(id).first<{display_name:string;role:string}>();
        if(!row) throw new Error("직원을 찾을 수 없습니다.");
        if(action==="update-username"){
          const username=cleanText(body.username,40).toLowerCase();
          if(!/^[a-z0-9._-]{2,40}$/.test(username)) throw new Error("아이디는 영문 소문자·숫자·점·밑줄·하이픈으로 2~40자 입력해 주세요.");
          const duplicate=await db().prepare("SELECT id FROM staff_users WHERE username=? AND id<>? LIMIT 1").bind(username,id).first();
          if(duplicate) throw new Error("이미 사용 중인 아이디입니다.");
          await db().batch([
            db().prepare("UPDATE staff_users SET username=?,updated_at=datetime('now') WHERE id=?").bind(username,id),
            db().prepare("DELETE FROM staff_sessions WHERE staff_id=?").bind(id),
          ]);
          await writeAudit({actor,action:"staff_username_update",entityType:"staff",entityId:id,summary:`${row.display_name} 로그인 아이디 변경 → ${username}`});
          return Response.json({ok:true});
        }
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
