import { db, ensureDatabase } from "./db.server";
import type { CustomerSummary } from "./db.server";

const ADMIN_COOKIE_NAME = "buja_admin_session";
const CUSTOMER_COOKIE_NAME = "buja_customer_session";
const encoder = new TextEncoder();

function toHex(bytes: ArrayBuffer | Uint8Array) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(view, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomHex(bytes = 32) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return toHex(value);
}

async function sha256(value: string) {
  return toHex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

async function derivePassword(password: string, salt: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: encoder.encode(salt), iterations: 100000, hash: "SHA-256" },
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
  return `${ADMIN_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function clearSessionCookie() {
  return `${ADMIN_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function customerSessionCookie(token: string, maxAgeSeconds = 60 * 60 * 24 * 365 * 5) {
  return `${CUSTOMER_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function clearCustomerSessionCookie() {
  return `${CUSTOMER_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function adminSetupRequired() {
  await ensureDatabase();
  const row = await db().prepare("SELECT id FROM admin_credentials WHERE id = 1").first();
  return !row;
}

export async function isAdmin(request: Request) {
  await ensureDatabase();
  const token = parseCookie(request, ADMIN_COOKIE_NAME);
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
  const row = await db().prepare("SELECT value FROM app_settings WHERE key = 'bootstrap_key'").first<{ value: string }>();
  if (!row?.value || row.value !== bootstrapKey.trim()) throw new Error("초기 설정 코드가 올바르지 않습니다.");
  const salt = randomHex(16);
  const hash = await derivePassword(password, salt);
  await db().batch([
    db().prepare("INSERT INTO admin_credentials (id, salt, hash) VALUES (1, ?, ?)").bind(salt, hash),
    db().prepare("DELETE FROM app_settings WHERE key = 'bootstrap_key'"),
  ]);
  return createAdminSession();
}

export async function loginAdmin(password: string) {
  await ensureDatabase();
  const row = await db().prepare("SELECT salt, hash FROM admin_credentials WHERE id = 1").first<{ salt: string; hash: string }>();
  if (!row) throw new Error("관리자 설정이 필요합니다.");
  const hash = await derivePassword(password, row.salt);
  if (hash !== row.hash) throw new Error("비밀번호가 올바르지 않습니다.");
  return createAdminSession();
}

async function createAdminSession() {
  const token = randomHex(32);
  const hash = await sha256(token);
  await db().batch([
    db().prepare("DELETE FROM admin_sessions WHERE expires_at <= datetime('now')"),
    db().prepare("INSERT INTO admin_sessions (token_hash, expires_at) VALUES (?, datetime('now', '+30 days'))").bind(hash),
  ]);
  return token;
}

export async function logoutAdmin(request: Request) {
  const token = parseCookie(request, ADMIN_COOKIE_NAME);
  if (!token) return;
  const hash = await sha256(token);
  await db().prepare("DELETE FROM admin_sessions WHERE token_hash = ?").bind(hash).run();
}

export function normalizeCustomerCode(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

export async function makeCustomerPinCredential(pin: string) {
  if (!/^\d{6}$/.test(pin)) throw new Error("인증번호는 숫자 6자리로 입력해 주세요.");
  const salt = randomHex(16);
  const hash = await derivePassword(pin, salt);
  return { salt, hash };
}

export async function loginCustomer(code: string, pin: string) {
  await ensureDatabase();
  const normalized = normalizeCustomerCode(code);
  if (!normalized || !/^\d{6}$/.test(pin)) throw new Error("거래처번호와 인증번호를 확인해 주세요.");
  const customer = await db().prepare(
    "SELECT id, auth_salt, auth_hash, active FROM customers WHERE upper(code) = upper(?) LIMIT 1",
  ).bind(normalized).first<{ id: string; auth_salt: string; auth_hash: string; active: number }>();
  if (!customer || customer.active !== 1 || !customer.auth_hash) throw new Error("거래처번호와 인증번호를 확인해 주세요.");
  const hash = await derivePassword(pin, customer.auth_salt);
  if (hash !== customer.auth_hash) throw new Error("거래처번호와 인증번호를 확인해 주세요.");

  const token = randomHex(32);
  const tokenHash = await sha256(token);
  await db().batch([
    db().prepare("DELETE FROM customer_sessions WHERE expires_at <= datetime('now')"),
    db().prepare("INSERT INTO customer_sessions (token_hash, customer_id, expires_at) VALUES (?, ?, datetime('now', '+5 years'))")
      .bind(tokenHash, customer.id),
  ]);
  return token;
}

export async function getCustomer(request: Request): Promise<CustomerSummary | null> {
  await ensureDatabase();
  const token = parseCookie(request, CUSTOMER_COOKIE_NAME);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await db().prepare(`
    SELECT c.id, c.code, c.name, c.phone, c.business_number, c.address, c.store_phone,
           c.region, c.price_group, c.active,
           COALESCE((SELECT SUM(amount) FROM receivable_ledger r WHERE r.customer_id = c.id), 0) AS receivable
    FROM customer_sessions s
    JOIN customers c ON c.id = s.customer_id
    WHERE s.token_hash = ? AND s.expires_at > datetime('now') AND c.active = 1
    LIMIT 1
  `).bind(tokenHash).first<Record<string, unknown>>();
  if (!row) return null;

  return {
    id: String(row.id),
    code: String(row.code),
    name: String(row.name),
    phone: String(row.phone ?? ""),
    businessNumber: String(row.business_number ?? ""),
    address: String(row.address ?? ""),
    storePhone: String(row.store_phone ?? ""),
    region: String(row.region ?? ""),
    priceGroup: String(row.price_group ?? "A") === "B" ? "B" : "A",
    active: Number(row.active ?? 0) === 1,
    receivable: Number(row.receivable ?? 0),
  };
}

export async function logoutCustomer(request: Request) {
  const token = parseCookie(request, CUSTOMER_COOKIE_NAME);
  if (!token) return;
  const tokenHash = await sha256(token);
  await db().prepare("DELETE FROM customer_sessions WHERE token_hash = ?").bind(tokenHash).run();
}

export async function revokeCustomerSessions(customerId: string) {
  await ensureDatabase();
  await db().prepare("DELETE FROM customer_sessions WHERE customer_id = ?").bind(customerId).run();
}

export function validMutationOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return request.headers.get("sec-fetch-site") !== "cross-site";
  return origin === new URL(request.url).origin;
}
