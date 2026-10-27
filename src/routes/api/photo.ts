import { createFileRoute } from "@tanstack/react-router";
import { bindings } from "../../lib/bindings.server";
import { getViewerKind, isAdmin, validMutationOrigin } from "../../lib/auth.server";

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
        const id = cleanKey(new URL(request.url).searchParams.get("id") ?? "");
        if (!id) return new Response("Not found", { status: 404 });
        // 브라우저가 이미 가진 사진이면 본문 없이 304, 아니면 R2에서 바로 스트리밍
        const ifNoneMatch = request.headers.get("if-none-match") ?? "";
        const object = await storage.get(id, ifNoneMatch ? { onlyIf: { etagDoesNotMatch: ifNoneMatch.replace(/^W\//, "").replace(/"/g, "") } } : undefined);
        if (!object) return new Response("Not found", { status: 404 });
        const headers = new Headers({
          "Content-Type": object.httpMetadata?.contentType || "application/octet-stream",
          "Cache-Control": "private, max-age=31536000, immutable",
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
