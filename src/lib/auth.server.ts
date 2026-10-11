import { db } from "./db.server";

const COOKIE_NAME = "buja_admin_session";
const encoder = new TextEncoder();

function toHex(bytes: ArrayBuffer | Uint8Array) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(view, (b) => b.toString(16).padStart(2, "0")).join("");
}

function randomHex(bytes = 32) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return toHex(value);
}

async function sha256(value: string) {
  return toHex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

async function derivePassword(password: string, salt: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: encoder.encode(salt),
      iterations: 100000,
      hash: "SHA-256",
    },
    key,
    256,
  );
  return toHex(bits);
}

function parseCookie(request: Request, name: string) {
  const raw = request.headers.get("cookie") ?? "";
  for (const piece of raw.split(";")) {
    const [key, ...rest] = piece.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

export function sessionCookie(token: string, maxAgeSeconds = 60 * 60 * 24 * 30) {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function adminSetupRequired() {
  const row = await db().prepare("SELECT id FROM admin_credentials WHERE id = 1").first();
  return !row;
}

export async function isAdmin(request: Request) {
  const token = parseCookie(request, COOKIE_NAME);
  if (!token) return false;
  const hash = await sha256(token);
  const row = await db()
    .prepare("SELECT token_hash FROM admin_sessions WHERE token_hash = ? AND expires_at > datetime('now')")
    .bind(hash)
    .first();
  return Boolean(row);
}

export async function createAdmin(password: string, bootstrapKey: string) {
  if (password.length < 10) throw new Error("비밀번호는 10자 이상으로 설정해 주세요.");
  if (!(await adminSetupRequired())) throw new Error("관리자 설정이 이미 완료되었습니다.");

  const row = await db()
    .prepare("SELECT value FROM app_settings WHERE key = 'bootstrap_key'")
    .first<{ value: string }>();
  if (!row?.value || row.value !== bootstrapKey.trim()) {
    throw new Error("초기 설정 코드가 올바르지 않습니다.");
  }

  const salt = randomHex(16);
  const hash = await derivePassword(password, salt);
  await db().batch([
    db().prepare("INSERT INTO admin_credentials (id, salt, hash) VALUES (1, ?, ?)").bind(salt, hash),
    db().prepare("DELETE FROM app_settings WHERE key = 'bootstrap_key'"),
  ]);
  return createSession();
}

export async function loginAdmin(password: string) {
  const row = await db()
    .prepare("SELECT salt, hash FROM admin_credentials WHERE id = 1")
    .first<{ salt: string; hash: string }>();
  if (!row) throw new Error("관리자 설정이 필요합니다.");
  const hash = await derivePassword(password, row.salt);
  if (hash !== row.hash) throw new Error("비밀번호가 올바르지 않습니다.");
  return createSession();
}

async function createSession() {
  const token = randomHex(32);
  const hash = await sha256(token);
  await db().batch([
    db().prepare("DELETE FROM admin_sessions WHERE expires_at <= datetime('now')"),
    db()
      .prepare("INSERT INTO admin_sessions (token_hash, expires_at) VALUES (?, datetime('now', '+30 days'))")
      .bind(hash),
  ]);
  return token;
}

export async function logoutAdmin(request: Request) {
  const token = parseCookie(request, COOKIE_NAME);
  if (!token) return;
  const hash = await sha256(token);
  await db().prepare("DELETE FROM admin_sessions WHERE token_hash = ?").bind(hash).run();
}

export function validMutationOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return request.headers.get("sec-fetch-site") !== "cross-site";
  return origin === new URL(request.url).origin;
}
