import { createFileRoute } from "@tanstack/react-router";
import { bindings } from "../../lib/bindings.server";
import { getViewerKind, isAdmin, validMutationOrigin } from "../../lib/auth.server";
import { THUMB_PREFIX } from "../../lib/photo-url";

const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);

function cleanKey(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "");
}

export const Route = createFileRoute("/api/photo")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // 상품사진도 로그인한 거래처/직원/관리자에게만 제공
        if (!(await getViewerKind(request))) {
          return new Response("Login required", { status: 401, headers: { "Cache-Control": "no-store" } });
        }
        const storage = bindings().STORAGE;
        if (!storage) return new Response("Storage unavailable", { status: 503 });
        const params = new URL(request.url).searchParams;

        // 관리자: 이미 만들어진 썸네일 목록 (썸네일 일괄 생성 도구용)
        if (params.get("thumbList") === "1") {
          if (!(await isAdmin(request))) return Response.json({ error: "관리자 로그인이 필요합니다." }, { status: 403 });
          const keys: string[] = [];
          let cursor: string | undefined;
          do {
            const page = await storage.list({ prefix: THUMB_PREFIX, cursor, limit: 1000 });
            for (const item of page.objects) keys.push(item.key.slice(THUMB_PREFIX.length));
            cursor = page.truncated ? page.cursor : undefined;
          } while (cursor);
          return Response.json({ thumbs: keys }, { headers: { "Cache-Control": "no-store" } });
        }

        const id = cleanKey(params.get("id") ?? "");
        if (!id) return new Response("Not found", { status: 404 });
        const wantsThumb = params.get("size") === "thumb";
        // 브라우저가 이미 가진 사진이면 본문 없이 304, 아니면 R2에서 바로 스트리밍
        const ifNoneMatch = request.headers.get("if-none-match") ?? "";
        const conditional = ifNoneMatch ? { onlyIf: { etagDoesNotMatch: ifNoneMatch.replace(/^W\//, "").replace(/"/g, "") } } : undefined;
        let object = wantsThumb ? await storage.get(`${THUMB_PREFIX}${id}`, conditional) : null;
        // 썸네일이 아직 없으면 원본을 보내되, 나중에 썸네일이 생기면 바뀌도록 짧게만 캐시
        const fallback = wantsThumb && !object;
        if (!object) object = await storage.get(id, conditional);
        if (!object) return new Response("Not found", { status: 404 });
        const headers = new Headers({
          "Content-Type": object.httpMetadata?.contentType || "application/octet-stream",
          "Cache-Control": fallback ? "private, max-age=600" : "private, max-age=31536000, immutable",
          "ETag": object.httpEtag,
        });
        if (!("body" in object) || !object.body) return new Response(null, { status: 304, headers });
        return new Response(object.body as unknown as ReadableStream, { headers });
      },
      POST: async ({ request }) => {
        if (!validMutationOrigin(request) || !(await isAdmin(request))) {
          return Response.json({ error: "관리자 로그인이 필요합니다." }, { status: 403 });
        }
        const storage = bindings().STORAGE;
        if (!storage) return Response.json({ error: "사진 저장소가 준비되지 않았습니다." }, { status: 503 });
        try {
          const form = await request.formData();
          const file = form.get("file");
          // 썸네일 업로드: 이미 있는 원본(thumbOf)에 대한 작은 사진. 원본은 건드리지 않음
          const thumbOf = cleanKey(String(form.get("thumbOf") ?? ""));
          if (thumbOf) {
            if (!(file instanceof File)) throw new Error("썸네일 파일이 없습니다.");
            if (!allowed.has(file.type)) throw new Error("썸네일 형식을 확인해 주세요.");
            if (file.size > 1024 * 1024) throw new Error("썸네일이 너무 큽니다.");
            if (thumbOf.startsWith(THUMB_PREFIX) || !(await storage.head(thumbOf))) throw new Error("원본 사진을 찾을 수 없습니다.");
            await storage.put(`${THUMB_PREFIX}${thumbOf}`, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
            return Response.json({ ok: true, key: `${THUMB_PREFIX}${thumbOf}` });
          }
          if (!(file instanceof File)) throw new Error("사진 파일을 선택해 주세요.");
          if (!allowed.has(file.type)) throw new Error("JPG, PNG, WebP 사진만 업로드할 수 있습니다.");
          if (file.size > 5 * 1024 * 1024) throw new Error("사진은 최대 5MB까지 업로드할 수 있습니다.");
          const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
          const key = `${crypto.randomUUID()}.${ext}`;
          await storage.put(key, await file.arrayBuffer(), {
            httpMetadata: { contentType: file.type },
          });
          return Response.json({ ok: true, url: `/api/photo?id=${key}` });
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : "사진 업로드에 실패했습니다." },
            { status: 400 },
          );
        }
      },
    },
  },
});
