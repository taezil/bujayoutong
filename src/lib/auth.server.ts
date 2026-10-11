import { db, ensureDatabase } from "./db.server";
import type { CustomerSummary } from "./db.server";

const ADMIN_COOKIE_NAME = "buja_admin_session";
const CUSTOMER_COOKIE_NAME = "buja_customer_session";
const STAFF_COOKIE_NAME = "buja_staff_session";
const encoder = new TextEncoder();

export type StaffSession = {
  id: string;
  username: string;
  displayName: string;
  role: "ADMIN" | "DRIVER";
};

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

export function staffSessionCookie(token: string, maxAgeSeconds = 60 * 60 * 24 * 180) {
  return `${STAFF_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function clearStaffSessionCookie() {
  return `${STAFF_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function adminSetupRequired() {
  await ensureDatabase();
  const row = await db().prepare("SELECT id FROM admin_credentials WHERE id = 1").first();
  return !row;
}

export async function isAdmin(request: Request) {
  await ensureDatabase();
  const token = parseCookie(request, ADMIN_COOKIE_NAME);
  if (token) {
    const hash = await sha256(token);
    const row = await db()
      .prepare("SELECT token_hash FROM admin_sessions WHERE token_hash = ? AND expires_at > datetime('now')")
      .bind(hash)
      .first();
    if (row) return true;
  }
  const staff = await getStaff(request);
  return staff?.role === "ADMIN";
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

export async function loginStaff(username: string, pin: string) {
  await ensureDatabase();
  const normalized = username.trim().toLowerCase();
  if (!normalized || !/^\d{6}$/.test(pin)) throw new Error("아이디와 6자리 PIN을 확인해 주세요.");
  const row = await db().prepare(
    "SELECT id, username, display_name, role, auth_salt, auth_hash, active FROM staff_users WHERE lower(username)=lower(?) LIMIT 1",
  ).bind(normalized).first<Record<string, unknown>>();
  if (!row || Number(row.active ?? 0) !== 1) throw new Error("아이디와 PIN을 확인해 주세요.");
  const hash = await derivePassword(pin, String(row.auth_salt));
  if (hash !== String(row.auth_hash)) throw new Error("아이디와 PIN을 확인해 주세요.");
  const token = randomHex(32);
  const tokenHash = await sha256(token);
  await db().batch([
    db().prepare("DELETE FROM staff_sessions WHERE expires_at <= datetime('now')"),
    db().prepare("INSERT INTO staff_sessions(token_hash,staff_id,expires_at) VALUES(?,?,datetime('now','+180 days'))").bind(tokenHash, String(row.id)),
  ]);
  return {
    token,
    staff: { id: String(row.id), username: String(row.username), displayName: String(row.display_name), role: String(row.role) === "ADMIN" ? "ADMIN" : "DRIVER" } as StaffSession,
  };
}

export async function getStaff(request: Request): Promise<StaffSession | null> {
  await ensureDatabase();
  const token = parseCookie(request, STAFF_COOKIE_NAME);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await db().prepare(`
    SELECT u.id,u.username,u.display_name,u.role,u.active
    FROM staff_sessions s JOIN staff_users u ON u.id=s.staff_id
    WHERE s.token_hash=? AND s.expires_at>datetime('now') AND u.active=1
    LIMIT 1
  `).bind(tokenHash).first<Record<string, unknown>>();
  if (!row) return null;
  return {
    id: String(row.id), username: String(row.username), displayName: String(row.display_name),
    role: String(row.role) === "ADMIN" ? "ADMIN" : "DRIVER",
  };
}

export async function logoutStaff(request: Request) {
  const token = parseCookie(request, STAFF_COOKIE_NAME);
  if (!token) return;
  const tokenHash = await sha256(token);
  await db().prepare("DELETE FROM staff_sessions WHERE token_hash=?").bind(tokenHash).run();
}

export async function resetStaffPin(staffId: string, pin: string) {
  if (!/^\d{6}$/.test(pin)) throw new Error("PIN은 숫자 6자리로 입력해 주세요.");
  const salt = randomHex(16);
  const hash = await derivePassword(pin, salt);
  await db().batch([
    db().prepare("UPDATE staff_users SET auth_salt=?,auth_hash=?,updated_at=datetime('now') WHERE id=?").bind(salt, hash, staffId),
    db().prepare("DELETE FROM staff_sessions WHERE staff_id=?").bind(staffId),
  ]);
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

export async function loginCustomer(code: string, pin: string, username = "") {
  await ensureDatabase();
  const normalized = normalizeCustomerCode(code);
  if (!normalized || !/^\d{6}$/.test(pin)) throw new Error("거래처번호와 인증번호를 확인해 주세요.");
  const customer = await db().prepare(
    "SELECT id, auth_salt, auth_hash, active FROM customers WHERE upper(code) = upper(?) LIMIT 1",
  ).bind(normalized).first<{ id: string; auth_salt: string; auth_hash: string; active: number }>();
  if (!customer || customer.active !== 1) throw new Error("거래처번호와 인증번호를 확인해 주세요.");

  let customerUserId = "";
  const employeeUsername = username.trim().toLowerCase();
  if (employeeUsername) {
    const user = await db().prepare(
      "SELECT id,auth_salt,auth_hash,active FROM customer_users WHERE customer_id=? AND lower(username)=lower(?) LIMIT 1",
    ).bind(customer.id, employeeUsername).first<{ id: string; auth_salt: string; auth_hash: string; active: number }>();
    if (!user || user.active !== 1) throw new Error("거래처 직원 아이디와 PIN을 확인해 주세요.");
    const hash = await derivePassword(pin, user.auth_salt);
    if (hash !== user.auth_hash) throw new Error("거래처 직원 아이디와 PIN을 확인해 주세요.");
    customerUserId = user.id;
  } else {
    if (!customer.auth_hash) throw new Error("거래처번호와 인증번호를 확인해 주세요.");
    const hash = await derivePassword(pin, customer.auth_salt);
    if (hash !== customer.auth_hash) throw new Error("거래처번호와 인증번호를 확인해 주세요.");
  }

  const token = randomHex(32);
  const tokenHash = await sha256(token);
  await db().batch([
    db().prepare("DELETE FROM customer_sessions WHERE expires_at <= datetime('now')"),
    db().prepare("INSERT INTO customer_sessions (token_hash, customer_id, customer_user_id, expires_at) VALUES (?, ?, ?, datetime('now', '+5 years'))")
      .bind(tokenHash, customer.id, customerUserId),
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
           c.region, c.price_group, c.active, COALESCE(u.display_name,'') AS login_name,
           COALESCE((SELECT SUM(amount) FROM receivable_ledger r WHERE r.customer_id = c.id), 0) AS receivable
    FROM customer_sessions s
    JOIN customers c ON c.id = s.customer_id
    LEFT JOIN customer_users u ON u.id = s.customer_user_id AND u.active=1
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
    loginName: String(row.login_name ?? ""),
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
