/**
 * 사장님 휴대폰 알림: 앱 푸시(Web Push) + 텔레그램.
 *
 * - 새 발주가 저장되면 즉시 한 번 보냄 (notifyNewOrder)
 * - 사무실에서 [입력 시작]을 누르지 않고 오래 둔 발주는 정해진 간격으로 다시 보냄 (runEscalation, 1분마다 cron)
 * - 푸시는 내용 없이(빈 푸시) 보내고, 휴대폰의 서비스워커가 /api/push/summary 로 요약을 받아 표시
 *   → 알림 내용 암호화가 필요 없고, 요약은 구독할 때 받은 토큰이 있어야 읽을 수 있음
 * - 설정(봇 토큰 등)은 서버 DB(app_settings)에만 저장하고 화면에는 가려서 보여줌
 */
import * as workers from "cloudflare:workers";
import { db, ensureDatabase } from "./db.server";
import { sha256 } from "./password.server";
import { deliveryText } from "./delivery-rules";

export type AlertSettings = {
  instant: boolean;
  repeatMinutes: number;
  repeatMax: number;
  repeatFrom: string;
  repeatTo: string;
  telegramConfigured: boolean;
  telegramChatId: string;
  telegramMasked: string;
  pushCount: number;
};

const KEYS = ["alerts_instant", "alerts_repeat_minutes", "alerts_repeat_max", "alerts_repeat_from", "alerts_repeat_to", "telegram_bot_token", "telegram_chat_id"];

async function settingsMap() {
  await ensureDatabase();
  const rows = await db().prepare(`SELECT key,value FROM app_settings WHERE key IN (${KEYS.map(() => "?").join(",")})`).bind(...KEYS).all();
  return Object.fromEntries((rows.results as Array<Record<string, unknown>>).map((row) => [String(row.key), String(row.value)])) as Record<string, string>;
}

function time(value: string | undefined, fallback: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value ?? "")) ? String(value) : fallback;
}

export async function readAlertSettings(): Promise<AlertSettings & { telegramToken: string }> {
  const map = await settingsMap();
  const token = map.telegram_bot_token ?? "";
  const push = await db().prepare("SELECT COUNT(*) AS n FROM push_subscriptions").first<{ n: number }>();
  return {
    instant: map.alerts_instant !== "0",
    repeatMinutes: Math.min(120, Math.max(3, Number(map.alerts_repeat_minutes || 10))),
    repeatMax: Math.min(30, Math.max(0, Number(map.alerts_repeat_max ?? 6) || 0)),
    repeatFrom: time(map.alerts_repeat_from, "07:00"),
    repeatTo: time(map.alerts_repeat_to, "17:00"),
    telegramConfigured: Boolean(token && map.telegram_chat_id),
    telegramChatId: map.telegram_chat_id ?? "",
    telegramMasked: token ? `${token.slice(0, 6)}…${token.slice(-4)}` : "",
    telegramToken: token,
    pushCount: Number(push?.n ?? 0),
  };
}

export function publicAlertSettings(settings: AlertSettings & { telegramToken?: string }): AlertSettings {
  const { telegramToken: _hidden, ...rest } = settings;
  return rest;
}

export async function saveAlertSettings(input: Record<string, unknown>) {
  const set = (key: string, value: string) => db().prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES(?,?)").bind(key, value);
  const statements = [];
  if ("instant" in input) statements.push(set("alerts_instant", input.instant ? "1" : "0"));
  if ("repeatMinutes" in input) statements.push(set("alerts_repeat_minutes", String(Math.min(120, Math.max(3, Math.round(Number(input.repeatMinutes) || 10))))));
  if ("repeatMax" in input) statements.push(set("alerts_repeat_max", String(Math.min(30, Math.max(0, Math.round(Number(input.repeatMax) || 0))))));
  if ("repeatFrom" in input) statements.push(set("alerts_repeat_from", time(String(input.repeatFrom), "07:00")));
  if ("repeatTo" in input) statements.push(set("alerts_repeat_to", time(String(input.repeatTo), "17:00")));
  if ("telegramToken" in input) {
    const token = String(input.telegramToken ?? "").trim();
    if (token && !/^\d{5,15}:[A-Za-z0-9_-]{20,80}$/.test(token)) throw new Error("텔레그램 봇 토큰 형식이 아닙니다. BotFather 가 준 123456789:ABC… 전체를 붙여 넣어 주세요.");
    statements.push(set("telegram_bot_token", token));
    if (!token) statements.push(set("telegram_chat_id", ""));
  }
  if (statements.length) await db().batch(statements);
}

/* ---------------- 공통 ---------------- */

function schedule(task: Promise<unknown>) {
  const guarded = task.catch((error) => console.error("phone alert failed", error));
  try {
    const waitUntil = (workers as { waitUntil?: (promise: Promise<unknown>) => void }).waitUntil;
    if (typeof waitUntil === "function") { waitUntil(guarded); return; }
  } catch {
    // 아래처럼 그냥 진행
  }
  void guarded;
}

function kstClock(now = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(now));
  return `${parts.find((p) => p.type === "hour")?.value ?? "00"}:${parts.find((p) => p.type === "minute")?.value ?? "00"}`;
}

function inWindow(now: string, from: string, to: string) {
  if (from === to) return true;
  return from < to ? now >= from && now < to : now >= from || now < to;
}

function shortDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const weekday = ["일", "월", "화", "수", "목", "금", "토"][new Date(`${date}T00:00:00Z`).getUTCDay()];
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8))}(${weekday})`;
}

type OrderBrief = { id: string; customer: string; delivery: string; itemCount: number; source: string; staffName: string; minutes: number };

async function orderBriefs(where: string, binds: unknown[]): Promise<OrderBrief[]> {
  const rows = await db().prepare(`
    SELECT o.id,o.delivery_date,o.delivery_slot,o.delivery_run,o.source,o.created_by_staff_name,o.created_at,
           COALESCE(NULLIF(o.delivery_location_name,''),c.name) AS customer_name,
           (SELECT COUNT(*) FROM order_items i WHERE i.order_id=o.id) AS item_count,
           CAST((julianday('now')-julianday(o.created_at))*1440 AS INTEGER) AS minutes
    FROM orders o JOIN customers c ON c.id=o.customer_id
    LEFT JOIN order_desk_status d ON d.order_id=o.id
    WHERE ${where}
    ORDER BY o.created_at
  `).bind(...binds).all();
  return (rows.results as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    customer: String(row.customer_name ?? ""),
    delivery: `${shortDate(String(row.delivery_date ?? ""))} ${deliveryText(String(row.delivery_slot ?? ""), Number(row.delivery_run ?? 0))}`.trim(),
    itemCount: Number(row.item_count ?? 0),
    source: String(row.source ?? ""),
    staffName: String(row.created_by_staff_name ?? ""),
    minutes: Math.max(0, Number(row.minutes ?? 0)),
  }));
}

const PENDING_WHERE = "COALESCE(d.state,'new')='new' AND COALESCE(d.deleted,0)=0 AND o.status!='cancelled' AND o.created_at >= (SELECT value FROM app_settings WHERE key='desk_tracking_since')";

/** 아직 아무도 [입력 시작] 하지 않은 발주 요약 (푸시 알림 내용·알림 페이지용) */
export async function pendingSummary() {
  await ensureDatabase();
  const list = await orderBriefs(PENDING_WHERE, []);
  const oldest = list.reduce((max, item) => Math.max(max, item.minutes), 0);
  const names = Array.from(new Set(list.map((item) => item.customer)));
  return {
    count: list.length,
    oldestMinutes: oldest,
    title: list.length ? `🚨 처리 안 된 발주 ${list.length}건` : "✅ 처리할 발주가 없습니다",
    body: list.length ? `${names.slice(0, 3).join(", ")}${names.length > 3 ? ` 외 ${names.length - 3}곳` : ""} · 가장 오래된 발주 ${oldest}분 전` : "모든 발주를 사무실에서 확인했습니다.",
  };
}

/* ---------------- 텔레그램 ---------------- */

async function telegram(method: string, token: string, payload: Record<string, unknown>) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({})) as { ok?: boolean; description?: string; result?: unknown };
  if (!response.ok || !data.ok) throw new Error(data.description || `텔레그램 오류 ${response.status}`);
  return data.result;
}

async function sendTelegram(text: string) {
  const settings = await readAlertSettings();
  if (!settings.telegramConfigured) return false;
  await telegram("sendMessage", settings.telegramToken, { chat_id: settings.telegramChatId, text, disable_web_page_preview: true });
  return true;
}

/** 봇에게 /start 를 보낸 대화방을 찾아 연결 */
export async function connectTelegramChat() {
  const settings = await readAlertSettings();
  if (!settings.telegramToken) throw new Error("먼저 봇 토큰을 저장해 주세요.");
  const updates = await telegram("getUpdates", settings.telegramToken, { limit: 50, timeout: 0 }) as Array<Record<string, any>>;
  const chats = (updates ?? []).map((update) => (update.message ?? update.channel_post ?? update.my_chat_member)?.chat).filter(Boolean);
  const chat = chats[chats.length - 1];
  if (!chat?.id) throw new Error("봇과의 대화를 찾지 못했습니다. 텔레그램에서 봇을 열어 [시작] 또는 /start 를 보낸 뒤 다시 눌러 주세요.");
  await db().prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('telegram_chat_id',?)").bind(String(chat.id)).run();
  await telegram("sendMessage", settings.telegramToken, { chat_id: chat.id, text: "✅ 부자유통 발주 알림이 연결되었습니다." });
  return String(chat.first_name || chat.title || chat.username || chat.id);
}

/* ---------------- 앱 푸시 (Web Push, 빈 푸시 + VAPID) ---------------- */

function b64url(bytes: ArrayBuffer | Uint8Array) {
  const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let text = "";
  for (const byte of array) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function vapidKeys() {
  const row = await db().prepare("SELECT (SELECT value FROM app_settings WHERE key='vapid_public') AS pub, (SELECT value FROM app_settings WHERE key='vapid_private') AS priv").first<{ pub: string | null; priv: string | null }>();
  if (row?.pub && row?.priv) return { publicKey: row.pub, privateJwk: JSON.parse(row.priv) as JsonWebKey };
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  const raw = await crypto.subtle.exportKey("raw", pair.publicKey) as ArrayBuffer;
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey) as JsonWebKey;
  const publicKey = b64url(raw);
  // 동시에 두 번 만들어지면 먼저 저장된 키를 씀
  await db().batch([
    db().prepare("INSERT OR IGNORE INTO app_settings(key,value) VALUES('vapid_public',?)").bind(publicKey),
    db().prepare("INSERT OR IGNORE INTO app_settings(key,value) VALUES('vapid_private',?)").bind(JSON.stringify(jwk)),
  ]);
  const saved = await db().prepare("SELECT (SELECT value FROM app_settings WHERE key='vapid_public') AS pub, (SELECT value FROM app_settings WHERE key='vapid_private') AS priv").first<{ pub: string; priv: string }>();
  return { publicKey: saved?.pub ?? publicKey, privateJwk: saved?.priv ? JSON.parse(saved.priv) as JsonWebKey : jwk };
}

export async function vapidPublicKey() {
  await ensureDatabase();
  return (await vapidKeys()).publicKey;
}

async function vapidHeader(endpoint: string) {
  const { publicKey, privateJwk } = await vapidKeys();
  const key = await crypto.subtle.importKey("jwk", privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const encoder = new TextEncoder();
  const header = b64url(encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(encoder.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: "mailto:order@bujafood.kr" })));
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, encoder.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64url(signature)}, k=${publicKey}`;
}

async function sendPushAll(urgency: "high" | "normal" = "high") {
  const rows = await db().prepare("SELECT id,endpoint FROM push_subscriptions ORDER BY created_at").all();
  let sent = 0;
  for (const row of rows.results as Array<Record<string, unknown>>) {
    const endpoint = String(row.endpoint);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: await vapidHeader(endpoint), TTL: "3600", Urgency: urgency, "Content-Length": "0" },
      });
      if (response.status === 404 || response.status === 410) {
        await db().prepare("DELETE FROM push_subscriptions WHERE id=?").bind(row.id).run();
      } else if (response.ok) {
        sent += 1;
        await db().prepare("UPDATE push_subscriptions SET last_ok_at=datetime('now'),fail_count=0 WHERE id=?").bind(row.id).run();
      } else {
        await db().prepare("UPDATE push_subscriptions SET fail_count=fail_count+1 WHERE id=?").bind(row.id).run();
      }
    } catch (error) {
      console.error("push send failed", error);
    }
  }
  return sent;
}

export async function addPushSubscription(endpoint: string, label: string) {
  const url = new URL(endpoint);
  if (url.protocol !== "https:") throw new Error("푸시 주소가 올바르지 않습니다.");
  const token = b64url(crypto.getRandomValues(new Uint8Array(24)));
  const id = `PS-${b64url(crypto.getRandomValues(new Uint8Array(9)))}`;
  await db().prepare(`INSERT INTO push_subscriptions(id,endpoint,token_hash,label) VALUES(?,?,?,?)
    ON CONFLICT(endpoint) DO UPDATE SET token_hash=excluded.token_hash,label=excluded.label,fail_count=0`)
    .bind(id, endpoint, await sha256(token), label.slice(0, 60)).run();
  return token;
}

export async function removePushSubscription(endpoint: string) {
  await db().prepare("DELETE FROM push_subscriptions WHERE endpoint=?").bind(endpoint).run();
}

export async function pushTokenValid(token: string) {
  if (!token || token.length > 100) return false;
  await ensureDatabase();
  return Boolean(await db().prepare("SELECT 1 FROM push_subscriptions WHERE token_hash=?").bind(await sha256(token)).first());
}

/* ---------------- 보내기 ---------------- */

function briefLine(item: OrderBrief) {
  const who = item.source === "driver" ? ` · 🚚 ${item.staffName || "기사"} 발주` : "";
  return `${item.customer} · 배송 ${item.delivery} · ${item.itemCount}품목${who}`;
}

async function sendNewOrderAlerts(orderId: string) {
  const settings = await readAlertSettings();
  if (!settings.instant || (!settings.telegramConfigured && !settings.pushCount)) return;
  const [order] = await orderBriefs("o.id=?", [orderId]);
  if (!order) return;
  await db().prepare("UPDATE order_desk_status SET alert_count=1,last_alert_at=datetime('now') WHERE order_id=? AND alert_count=0").bind(orderId).run();
  await Promise.allSettled([
    sendTelegram(`🚨 새 발주\n${briefLine(order)}`),
    settings.pushCount ? sendPushAll("high") : Promise.resolve(0),
  ]);
}

export function notifyNewOrder(orderId: string) {
  schedule(sendNewOrderAlerts(orderId));
}

/**
 * 오래 방치된 발주 다시 알림. cron(1분마다)에서 호출. 여러 번 겹쳐 불려도 1분에 한 번만 실제로 보냄
 * 반환: 다시 알린 발주 수
 */
export async function runEscalation(force = false) {
  await ensureDatabase();
  const settings = await readAlertSettings();
  if (!settings.telegramConfigured && !settings.pushCount) return 0;
  if (!force && (!settings.repeatMax || !inWindow(kstClock(), settings.repeatFrom, settings.repeatTo))) return 0;
  const lock = await db().prepare(`INSERT INTO app_settings(key,value) VALUES('alerts_escalation_lock', datetime('now','+50 seconds'))
    ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE app_settings.value < datetime('now')`).run();
  if (!lock.meta.changes && !force) return 0;
  const minutes = settings.repeatMinutes;
  const due = await orderBriefs(
    `${PENDING_WHERE} AND o.created_at <= datetime('now', ?) AND COALESCE(d.alert_count,0) <= ?
     AND (COALESCE(d.last_alert_at,'')='' OR d.last_alert_at <= datetime('now', ?))`,
    [`-${minutes} minutes`, settings.repeatMax, `-${minutes} minutes`],
  );
  if (!due.length) return 0;
  const ids = due.map((item) => item.id);
  await db().prepare(`UPDATE order_desk_status SET alert_count=alert_count+1,last_alert_at=datetime('now') WHERE order_id IN (${ids.map(() => "?").join(",")})`).bind(...ids).run();
  const oldest = due.reduce((max, item) => Math.max(max, item.minutes), 0);
  const lines = due.slice(0, 8).map((item) => `· ${item.minutes}분 전 ${briefLine(item)}`);
  await Promise.allSettled([
    sendTelegram(`⏰ 아직 처리 안 된 발주 ${due.length}건 (가장 오래된 ${oldest}분)\n${lines.join("\n")}${due.length > 8 ? `\n외 ${due.length - 8}건` : ""}\n사무실 PC에서 [입력 시작]을 누르면 그만 울립니다.`),
    settings.pushCount ? sendPushAll("high") : Promise.resolve(0),
  ]);
  return due.length;
}

export async function sendTestAlert() {
  const settings = await readAlertSettings();
  const [telegramResult, pushResult] = await Promise.allSettled([
    sendTelegram("🔔 부자유통 알림 테스트입니다. 이 메시지가 보이면 텔레그램 알림이 정상입니다."),
    sendPushAll("high"),
  ]);
  return {
    telegram: telegramResult.status === "fulfilled" ? (telegramResult.value ? "보냄" : "설정 안 됨") : `실패: ${(telegramResult.reason as Error)?.message ?? ""}`,
    push: pushResult.status === "fulfilled" ? `${pushResult.value}/${settings.pushCount}대 보냄` : "실패",
  };
}
