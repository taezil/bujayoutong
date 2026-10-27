import { createFileRoute, redirect } from "@tanstack/react-router";

// 단가표 페이지는 당분간 사용하지 않습니다. 어떤 경우에도 첫 화면("/")으로 보냅니다.
// (서버 진입점 src/server.ts 에서도 /price-list 요청을 "/"로 리다이렉트합니다.)
export const Route = createFileRoute("/price-list")({
  beforeLoad: () => {
    throw redirect({ to: "/", replace: true });
  },
  component: () => null,
});
