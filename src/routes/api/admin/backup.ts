import { createFileRoute } from "@tanstack/react-router";
import { isAdmin, validMutationOrigin, adminActorFor } from "../../../lib/auth.server";
import { createBackup, listBackups, readBackup } from "../../../lib/backup.server";
import { writeAudit } from "../../../lib/audit.server";

export const Route = createFileRoute("/api/admin/backup")({
  server: { handlers: {
    // 목록, 또는 ?key=... 로 내려받기
    GET: async ({ request }) => {
      if (!(await isAdmin(request))) return Response.json({ error: "관리자 로그인이 필요합니다." }, { status: 403 });
      const key = new URL(request.url).searchParams.get("key");
      if (!key) return Response.json({ backups: await listBackups() }, { headers: { "Cache-Control": "no-store" } });
      const object = await readBackup(key);
      if (!object || !("body" in object) || !object.body) return Response.json({ error: "백업을 찾지 못했습니다." }, { status: 404 });
      const name = `부자유통_백업_${key.split("/").pop()}`;
      return new Response(object.body as unknown as ReadableStream, { headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
        "Cache-Control": "no-store",
      } });
    },
    // 지금 백업 만들기
    POST: async ({ request }) => {
      if (!validMutationOrigin(request) || !(await isAdmin(request))) return Response.json({ error: "관리자 로그인이 필요합니다." }, { status: 403 });
      try {
        const result = await createBackup("manual");
        await writeAudit({ actor: await adminActorFor(request), action: "backup", entityType: "backup", entityId: result.key, summary: `데이터 백업 (${Math.round(result.size / 1024)}KB)` });
        return Response.json({ ok: true, ...result });
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "백업에 실패했습니다." }, { status: 500 });
      }
    },
  } },
});
