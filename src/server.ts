import { applySecurityHeaders } from "./lib/security-headers.server";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let entryPromise: Promise<ServerEntry> | undefined;

async function getEntry(): Promise<ServerEntry> {
  if (!entryPromise) {
    entryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return entryPromise;
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const url = new URL(request.url);
      // 단가표는 사용 중지: 단가표/로그인 화면을 보여주지 않고 첫 화면으로 보냄
      if (url.pathname === "/price-list" || url.pathname.startsWith("/price-list/")) {
        return applySecurityHeaders(new Response(null, {
          status: 302,
          headers: { Location: new URL("/", url).toString(), "Cache-Control": "no-store" },
        }));
      }
      if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
        url.pathname = url.pathname.slice(0, -1);
        return applySecurityHeaders(Response.redirect(url.toString(), 301));
      }
      const handler = await getEntry();
      const response = await handler.fetch(request, env, ctx);
      return applySecurityHeaders(response);
    } catch (error) {
      console.error(error);
      return applySecurityHeaders(
        new Response(
          "<!doctype html><html lang='ko'><meta charset='utf-8'><title>부자유통</title><body><h1>페이지를 불러오지 못했습니다.</h1><p>잠시 후 다시 시도해 주세요.</p></body></html>",
          { status: 500, headers: { "content-type": "text/html; charset=utf-8" } },
        ),
      );
    }
  },
};
