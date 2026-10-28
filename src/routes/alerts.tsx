import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { BUJA_LOGO_DATA } from "../brand-assets";

/**
 * 사장님 휴대폰 알림 설정 (/alerts).
 * - 이 휴대폰 앱 푸시 켜기 / 텔레그램 연결 / 오래 방치된 발주 다시 알림
 * - 발주 처리 기능은 없음 (처리는 사무실 PC 프로그램에서만)
 */
export const Route = createFileRoute("/alerts")({
  head: () => ({ meta: [{ title: "발주 알림 · 부자유통" }, { name: "robots", content: "noindex,nofollow" }] }),
  component: AlertsPage,
});

type Settings = {
  instant: boolean; repeatMinutes: number; repeatMax: number; repeatFrom: string; repeatTo: string;
  telegramConfigured: boolean; telegramChatId: string; telegramMasked: string; pushCount: number;
};
type Pending = { count: number; oldestMinutes: number; title: string; body: string };
type AlertsData = { settings: Settings; pending: Pending; publicKey: string };

async function post(path: string, body: Record<string, unknown>, method = "POST") {
  const response = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({})) as { error?: string; message?: string; token?: string };
  if (!response.ok) throw new Error(data.error || "처리하지 못했습니다.");
  return data;
}

function keyBytes(base64url: string) {
  const padded = base64url.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((base64url.length + 3) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

function saveToken(token: string) {
  return new Promise<void>((resolve, reject) => {
    const open = indexedDB.open("buja-alerts", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("kv");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction("kv", "readwrite");
      tx.objectStore("kv").put(token, "pushToken");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
  });
}

function isIos() {
  return typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent);
}

function isStandalone() {
  return typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
}

function AlertsPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [data, setData] = useState<AlertsData | null>(null);
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pushState, setPushState] = useState<"unknown" | "on" | "off" | "unsupported" | "denied">("unknown");
  const [token, setToken] = useState("");
  const [form, setForm] = useState({ repeatMinutes: "10", repeatMax: "6", repeatFrom: "07:00", repeatTo: "17:00", instant: true });

  // 홈 화면에 추가하면 이 페이지(/alerts)로 바로 열리게 전용 manifest 사용
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    const previous = link?.href;
    if (link) link.href = "/alerts.webmanifest";
    return () => { if (link && previous) link.href = previous; };
  }, []);

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/alerts", { cache: "no-store" });
    if (response.status === 403) { setAuthed(false); return; }
    if (!response.ok) throw new Error("알림 정보를 불러오지 못했습니다.");
    const next = await response.json() as AlertsData;
    setAuthed(true);
    setData(next);
    setForm({ repeatMinutes: String(next.settings.repeatMinutes), repeatMax: String(next.settings.repeatMax), repeatFrom: next.settings.repeatFrom, repeatTo: next.settings.repeatTo, instant: next.settings.instant });
  }, []);

  useEffect(() => { void load().catch((reason) => setError(reason instanceof Error ? reason.message : String(reason))); }, [load]);

  useEffect(() => {
    void (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) { setPushState("unsupported"); return; }
      if (Notification.permission === "denied") { setPushState("denied"); return; }
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      setPushState(subscription ? "on" : "off");
    })().catch(() => setPushState("unsupported"));
  }, []);

  async function act(task: () => Promise<string | void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const text = await task();
      if (text) setMessage(text);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "처리하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function login(event: React.FormEvent) {
    event.preventDefault();
    await act(async () => {
      await post("/api/admin/login", { username: "admin", password });
      setPassword("");
    });
  }

  async function enablePush() {
    await act(async () => {
      if (!data?.publicKey) throw new Error("알림 키를 불러오지 못했습니다.");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setPushState(permission === "denied" ? "denied" : "off"); throw new Error("알림 허용을 눌러야 받을 수 있습니다."); }
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(data.publicKey) });
      const result = await post("/api/push/subscribe", { endpoint: subscription.endpoint, label: isIos() ? "아이폰" : "휴대폰" });
      await saveToken(String(result.token ?? ""));
      setPushState("on");
      return "이 휴대폰에서 앱 알림을 받습니다. [테스트 알림]으로 확인해 보세요.";
    });
  }

  async function disablePush() {
    await act(async () => {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await post("/api/push/subscribe", { endpoint: subscription.endpoint }, "DELETE");
        await subscription.unsubscribe();
      }
      setPushState("off");
      return "이 휴대폰 앱 알림을 껐습니다.";
    });
  }

  if (authed === null) return <main className="alerts-page"><p>불러오는 중…</p></main>;

  if (!authed) return (
    <main className="alerts-page">
      <img src={BUJA_LOGO_DATA} alt="부자유통" className="alerts-logo" />
      <h1>발주 알림</h1>
      <p className="alerts-sub">사장님 휴대폰으로 새 발주 알림을 받습니다. 관리자 비밀번호로 로그인하세요.</p>
      <form className="alerts-card" onSubmit={login}>
        <label>관리자 비밀번호<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>
        <button type="submit" className="alerts-primary" disabled={busy || !password}>로그인</button>
      </form>
      {error && <p className="alerts-error" role="alert">{error}</p>}
    </main>
  );

  if (!data) return <main className="alerts-page"><p>불러오는 중…</p></main>;
  const { settings, pending } = data;
  const iosNeedsInstall = isIos() && !isStandalone();

  return (
    <main className="alerts-page">
      <img src={BUJA_LOGO_DATA} alt="부자유통" className="alerts-logo" />
      <h1>발주 알림</h1>
      <div className={`alerts-status ${pending.count ? "warn" : "ok"}`}>
        <strong>{pending.title}</strong>
        <span>{pending.body}</span>
      </div>

      {message && <p className="alerts-message" role="status">{message}</p>}
      {error && <p className="alerts-error" role="alert">{error}</p>}

      <section className="alerts-card">
        <h2>📱 앱 알림 (이 휴대폰)</h2>
        {pushState === "on" && <p className="alerts-on">✅ 이 휴대폰에서 받는 중</p>}
        {iosNeedsInstall && pushState !== "on" && (
          <p className="alerts-hint">아이폰은 먼저 <b>공유 버튼 → 홈 화면에 추가</b>로 ‘발주알림’ 앱을 만든 뒤, 그 앱을 열어 아래 버튼을 눌러 주세요.</p>
        )}
        {pushState === "unsupported" && <p className="alerts-hint">이 브라우저는 앱 알림을 지원하지 않습니다. {isIos() ? "홈 화면에 추가한 앱에서 열어 주세요." : "크롬으로 열어 주세요."} 텔레그램 알림은 그대로 쓸 수 있습니다.</p>}
        {pushState === "denied" && <p className="alerts-hint">알림이 차단되어 있습니다. 휴대폰 설정 → 알림에서 허용으로 바꿔 주세요.</p>}
        {pushState === "on"
          ? <button type="button" className="alerts-ghost" disabled={busy} onClick={() => void disablePush()}>이 휴대폰 알림 끄기</button>
          : <button type="button" className="alerts-primary" disabled={busy || pushState === "unsupported"} onClick={() => void enablePush()}>이 휴대폰으로 알림 받기</button>}
        <small>등록된 기기 {settings.pushCount}대</small>
      </section>

      <section className="alerts-card">
        <h2>✈️ 텔레그램</h2>
        {settings.telegramConfigured
          ? <p className="alerts-on">✅ 연결됨 · 봇 {settings.telegramMasked}</p>
          : <ol className="alerts-steps">
              <li>텔레그램에서 <b>@BotFather</b> 검색 → <b>/newbot</b> → 이름 아무거나 → 받은 <b>토큰</b> 복사</li>
              <li>아래 칸에 붙여 넣고 [토큰 저장]</li>
              <li>텔레그램에서 방금 만든 봇을 열어 <b>시작(/start)</b> 누르기</li>
              <li>[대화 연결] 누르기 → 텔레그램으로 확인 메시지가 옵니다</li>
            </ol>}
        <label>봇 토큰<input value={token} onChange={(e) => setToken(e.target.value)} placeholder={settings.telegramMasked || "123456789:ABC..."} autoComplete="off" /></label>
        <div className="alerts-row">
          <button type="button" className="alerts-ghost" disabled={busy || !token.trim()} onClick={() => void act(async () => { await post("/api/admin/alerts", { action: "save", telegramToken: token.trim() }); setToken(""); return "토큰을 저장했습니다. 봇에게 /start 를 보낸 뒤 [대화 연결]을 눌러 주세요."; })}>토큰 저장</button>
          <button type="button" className="alerts-ghost" disabled={busy || !settings.telegramMasked} onClick={() => void act(async () => (await post("/api/admin/alerts", { action: "telegram-connect" })).message)}>대화 연결</button>
          {settings.telegramMasked && <button type="button" className="alerts-ghost danger" disabled={busy} onClick={() => { if (window.confirm("텔레그램 알림 연결을 끊을까요?")) void act(async () => { await post("/api/admin/alerts", { action: "save", telegramToken: "" }); return "텔레그램 연결을 끊었습니다."; }); }}>연결 끊기</button>}
        </div>
      </section>

      <section className="alerts-card">
        <h2>⏰ 오래 방치된 발주 다시 알림</h2>
        <p className="alerts-hint">사무실 PC에서 아무도 [입력 시작]을 누르지 않은 발주를 정해진 간격으로 다시 알립니다. 새 발주는 들어오는 즉시 한 번 알립니다.</p>
        <label className="alerts-check"><input type="checkbox" checked={form.instant} onChange={(e) => setForm({ ...form, instant: e.target.checked })} /> 새 발주 즉시 알림</label>
        <div className="alerts-grid">
          <label>다시 알림 간격(분)<input inputMode="numeric" value={form.repeatMinutes} onChange={(e) => setForm({ ...form, repeatMinutes: e.target.value.replace(/\D/g, "") })} /></label>
          <label>최대 횟수 (0=끄기)<input inputMode="numeric" value={form.repeatMax} onChange={(e) => setForm({ ...form, repeatMax: e.target.value.replace(/\D/g, "") })} /></label>
          <label>다시 알림 시작<input value={form.repeatFrom} onChange={(e) => setForm({ ...form, repeatFrom: e.target.value })} placeholder="07:00" /></label>
          <label>다시 알림 끝<input value={form.repeatTo} onChange={(e) => setForm({ ...form, repeatTo: e.target.value })} placeholder="17:00" /></label>
        </div>
        <small>밤에는 사무실이 쉬니까 다시 알림은 이 시간 안에서만 울립니다. (새 발주 즉시 알림은 시간 제한 없음)</small>
        <button type="button" className="alerts-primary" disabled={busy} onClick={() => void act(async () => (await post("/api/admin/alerts", { action: "save", ...form, repeatMinutes: Number(form.repeatMinutes), repeatMax: Number(form.repeatMax) })).message)}>저장</button>
      </section>

      <button type="button" className="alerts-test" disabled={busy || (!settings.pushCount && !settings.telegramConfigured)} onClick={() => void act(async () => (await post("/api/admin/alerts", { action: "test" })).message)}>🔔 테스트 알림 보내기</button>
    </main>
  );
}
