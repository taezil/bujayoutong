// 부자유통 PWA 서비스워커.
// 홈 화면 설치용으로만 등록하며, 요청을 가로채지 않습니다.
// (예전처럼 모든 요청을 fetch 핸들러로 그대로 넘기면 캐시 이득은 없고 휴대폰에서 요청마다 지연만 생깁니다.)
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
