import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import type { ReactNode } from "react";

import appCss from "../styles.css?url";
import appMetaJson from "../app-meta.json";

type AppMeta = {
  og_title?: string | null;
  og_description?: string | null;
  og_image_url?: string | null;
  favicon_url?: string | null;
};

const meta = appMetaJson as AppMeta;
const canonical = "https://order.bujafood.kr/";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: meta.og_title ?? "부자유통" },
      { name: "description", content: meta.og_description ?? "부자유통 식자재 주문" },
      { name: "author", content: "부자유통" },
      { name: "theme-color", content: "#1677D2" },
      { property: "og:title", content: meta.og_title ?? "부자유통" },
      { property: "og:description", content: meta.og_description ?? "부자유통 식자재 주문" },
      { property: "og:type", content: "website" },
      { property: "og:image", content: meta.og_image_url ?? "/assets/hero.svg" },
      { property: "og:url", content: canonical },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: meta.og_image_url ?? "/assets/hero.svg" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "default" },
      { name: "apple-mobile-web-app-title", content: "부자유통" }
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "canonical", href: canonical },
      { rel: "icon", href: meta.favicon_url ?? "/favicon.svg" },
      { rel: "apple-touch-icon", href: "/assets/brand-icon.svg" },
      { rel: "manifest", href: "/site.webmanifest" }
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFound,
  errorComponent: RootError,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <head><HeadContent /></head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
    </QueryClientProvider>
  );
}

function NotFound() {
  return (
    <main className="state-page">
      <img src="/assets/brand-icon.svg" alt="" className="state-logo" />
      <h1>페이지를 찾을 수 없습니다</h1>
      <Link to="/">상품목록으로 돌아가기</Link>
    </main>
  );
}

function RootError() {
  return (
    <main className="state-page">
      <img src="/assets/brand-icon.svg" alt="" className="state-logo" />
      <h1>페이지를 불러오지 못했습니다</h1>
      <p>잠시 후 다시 시도해 주세요.</p>
      <a href="/">새로고침</a>
    </main>
  );
}
