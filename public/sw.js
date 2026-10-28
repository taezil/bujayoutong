// 부자유통 PWA 서비스워커.
// 홈 화면 설치 + 사장님 휴대폰 발주 알림(앱 푸시)만 처리하며, 일반 요청은 가로채지 않습니다.
// (예전처럼 모든 요청을 fetch 핸들러로 그대로 넘기면 캐시 이득은 없고 휴대폰에서 요청마다 지연만 생깁니다.)
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

const DB_NAME = "buja-alerts";

function readToken() {
  return new Promise((resolve) => {
    try {
      const open = indexedDB.open(DB_NAME, 1);
      open.onupgradeneeded = () => open.result.createObjectStore("kv");
      open.onerror = () => resolve("");
      open.onsuccess = () => {
        try {
          const request = open.result.transaction("kv", "readonly").objectStore("kv").get("pushToken");
          request.onsuccess = () => resolve(request.result || "");
          request.onerror = () => resolve("");
        } catch {
          resolve("");
        }
      };
    } catch {
      resolve("");
    }
  });
}

// 서버는 내용 없는 푸시만 보냄 → 여기서 요약을 받아 알림 표시 (받지 못해도 알림은 꼭 띄움)
self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    let title = "🚨 부자유통 새 발주";
    let body = "사무실에서 확인이 필요한 발주가 있습니다.";
    let tag = "buja-orders";
    try {
      const token = await readToken();
      if (token) {
        const response = await fetch("/api/push/summary", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
        if (response.ok) {
          const data = await response.json();
          if (data.count === 0) {
            title = data.title;
            body = data.body;
          } else if (data.title) {
            title = data.title;
            body = data.body || body;
          }
          tag = data.tag || tag;
        }
      }
    } catch {
      // 기본 문구로 표시
    }
    await self.registration.showNotification(title, {
      body,
      tag,
      renotify: true,
      requireInteraction: true,
      icon: "/buja-mark.png",
      badge: "/buja-mark.png",
      vibrate: [300, 120, 300, 120, 300],
      data: { url: "/alerts" },
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/alerts";
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (client.url.includes(url) && "focus" in client) return client.focus();
    }
    return self.clients.openWindow(url);
  })());
});
