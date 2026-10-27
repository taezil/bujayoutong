import { db, ensureDatabase } from "./db.server";
import type { CustomerSummary } from "./db.server";
import { normalizeLoginId } from "./customer-login-id";
import {
  derivePassword,
  makeCustomerPasswordCredential as makePasswordCredential,
  randomHex as randomHexValue,
  sha256,
  verifyPassword,
} from "./password.server";

/*
 * 인증 구조 요약
 * - 관리자(기존 단일 admin 계정): buja_admin_session 쿠키 → admin_sessions
 * - 부자유통 직원(관리자/배송기사): buja_staff_session 쿠키 → staff_sessions
 * - 거래처: buja_customer_session_v2 쿠키 → customer_sessions
 *     로그인 계정(customer_users) 1개 ↔ 배송처(customers) 여러 곳 (customer_user_customers)
 *     세션의 customer_id 는 "현재 선택한 배송처"이며, 서버에서 항상 연결 테이블로 권한을 다시 확인합니다.
 */

const ADMIN_COOKIE_NAME = "buja_admin_session";
const CUSTOMER_COOKIE_NAME = "buja_customer_session_v2";
const STAFF_COOKIE_NAME = "buja_staff_session";

const LOGIN_WINDOW_MINUTES = 15;
const LOGIN_MAX_FAILURES_PER_ID = 10;
const LOGIN_MAX_FAILURES_PER_IP = 40;
const LOGIN_FAILED_MESSAGE = "아이디 또는 비밀번호를 확인해 주세요.";

export type StaffSession = {
  id: string;
  username: string;
  displayName: string;
  role: "ADMIN" | "DRIVER";
};

export const randomHex = randomHexValue;
export const makeCustomerPasswordCredential = makePasswordCredential;

function parseCookie(request: Request, name: string) {
  const raw = request.headers.get("cookie") ?? "";
  for (const piece of raw.split(";")) {
    const [key, ...rest] = piece.trim().split("=");
    if (key === name) {
      try {
        return decodeURIComponent(rest.join("="));
      } catch {
        return "";
      }
    }
  }
  return "";
}

/* ---------- 쿠키 ---------- */

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

/* ---------- 관리자 (기존 단일 계정) ---------- */

export async function adminSetupRequired() {
  await ensureDatabase();
  const row = await db().prepare("SELECT id FROM admin_credentials WHERE id = 1").first();
  return !row;
}

export async function isAdmin(request: Request) {
  const token = parseCookie(request, ADMIN_COOKIE_NAME);
  if (!token) return false;
  await ensureDatabase();
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
  const salt = randomHexValue(16);
  const hash = await derivePassword(password, salt);
  await db().batch([
    db().prepare("INSERT INTO admin_credentials (id, salt, hash) VALUES (1, ?, ?)").bind(salt, hash),
    db().prepare("DELETE FROM app_settings WHERE key = 'bootstrap_key'"),
  ]);
  return createAdminSession();
}

export async function loginAdmin(username: string, password: string) {
  await ensureDatabase();
  if (username.trim().toLowerCase() !== "admin") throw new Error("아이디 또는 비밀번호가 올바르지 않습니다.");
  const row = await db().prepare("SELECT salt, hash FROM admin_credentials WHERE id = 1").first<{ salt: string; hash: string }>();
  if (!row) throw new Error("관리자 계정이 준비되지 않았습니다.");
  if (!(await verifyPassword(password, row.salt, row.hash))) throw new Error("아이디 또는 비밀번호가 올바르지 않습니다.");
  return createAdminSession();
}

async function createAdminSession() {
  const token = randomHexValue(32);
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
  await ensureDatabase();
  const hash = await sha256(token);
  await db().prepare("DELETE FROM admin_sessions WHERE token_hash = ?").bind(hash).run();
}

/* ---------- 부자유통 직원 ---------- */

export async function loginStaff(username: string, pin: string) {
  await ensureDatabase();
  const normalized = username.trim().toLowerCase();
  if (!normalized || !/^\d{6}$/.test(pin)) throw new Error("아이디와 6자리 PIN을 확인해 주세요.");
  const row = await db().prepare(
    "SELECT id, username, display_name, role, auth_salt, auth_hash, active FROM staff_users WHERE lower(username)=lower(?) LIMIT 1",
  ).bind(normalized).first<Record<string, unknown>>();
  if (!row || Number(row.active ?? 0) !== 1) throw new Error("아이디와 PIN을 확인해 주세요.");
  if (!(await verifyPassword(pin, String(row.auth_salt), String(row.auth_hash)))) throw new Error("아이디와 PIN을 확인해 주세요.");
  const token = randomHexValue(32);
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
  const token = parseCookie(request, STAFF_COOKIE_NAME);
  if (!token) return null;
  await ensureDatabase();
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
  await ensureDatabase();
  const tokenHash = await sha256(token);
  await db().prepare("DELETE FROM staff_sessions WHERE token_hash=?").bind(tokenHash).run();
}

export async function resetStaffPin(staffId: string, pin: string) {
  if (!/^\d{6}$/.test(pin)) throw new Error("PIN은 숫자 6자리로 입력해 주세요.");
  const salt = randomHexValue(16);
  const hash = await derivePassword(pin, salt);
  await db().batch([
    db().prepare("UPDATE staff_users SET auth_salt=?,auth_hash=?,updated_at=datetime('now') WHERE id=?").bind(salt, hash, staffId),
    db().prepare("DELETE FROM staff_sessions WHERE staff_id=?").bind(staffId),
  ]);
}

/** 관리자 화면 권한: 기존 관리자 로그인 또는 관리자 권한 직원 */
export async function isAdminViewer(request: Request) {
  if (await isAdmin(request)) return true;
  const staff = await getStaff(request);
  return staff?.role === "ADMIN";
}

/* ---------- 거래처 ---------- */

export function normalizeCustomerCode(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

export async function makeCustomerPinCredential(pin: string) {
  if (!/^\d{6}$/.test(pin)) throw new Error("인증번호는 숫자 6자리로 입력해 주세요.");
  return makePasswordCredential(pin);
}

function clientIp(request: Request) {
  return (request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown").trim().slice(0, 64);
}

async function assertLoginNotThrottled(loginId: string, ip: string) {
  const row = await db().prepare(`
    SELECT
      SUM(CASE WHEN scope='id' AND attempt_key=? THEN 1 ELSE 0 END) AS by_id,
      SUM(CASE WHEN scope='ip' AND attempt_key=? THEN 1 ELSE 0 END) AS by_ip
    FROM auth_login_attempts
    WHERE created_at > datetime('now', ?)
  `).bind(loginId, ip, `-${LOGIN_WINDOW_MINUTES} minutes`).first<{ by_id: number | null; by_ip: number | null }>();
  if (Number(row?.by_id ?? 0) >= LOGIN_MAX_FAILURES_PER_ID || Number(row?.by_ip ?? 0) >= LOGIN_MAX_FAILURES_PER_IP) {
    throw new Error(`로그인 시도가 너무 많습니다. ${LOGIN_WINDOW_MINUTES}분 후 다시 시도해 주세요.`);
  }
}

async function recordLoginFailure(loginId: string, ip: string) {
  try {
    await db().batch([
      db().prepare("DELETE FROM auth_login_attempts WHERE created_at < datetime('now','-1 day')"),
      db().prepare("INSERT INTO auth_login_attempts(scope,attempt_key) VALUES('id',?)").bind(loginId),
      db().prepare("INSERT INTO auth_login_attempts(scope,attempt_key) VALUES('ip',?)").bind(ip),
    ]);
  } catch (error) {
    console.error("login attempt log failed", error);
  }
}

/** 로그인 계정에 연결된 사용 가능한 배송처 id 목록 (정렬 순서대로) */
async function allowedCustomerIds(customerUserId: string) {
  const rows = await db().prepare(`
    SELECT c.id
    FROM customer_user_customers m
    JOIN customers c ON c.id=m.customer_id
    WHERE m.customer_user_id=? AND c.active=1
    ORDER BY m.sort_order, c.code
  `).bind(customerUserId).all<{ id: string }>();
  return rows.results.map((row) => String(row.id));
}

async function passwordMatches(password: string, salt: string, hash: string) {
  if (await verifyPassword(password, salt, hash)) return true;
  // "120-13" 처럼 하이픈을 넣어 입력한 경우 한 번 더 확인
  const stripped = password.replace(/[\s\-–—]+/g, "");
  return stripped !== password && stripped.length >= 2 && verifyPassword(stripped, salt, hash);
}

/**
 * 거래처 로그인.
 * 1) customer_users (숫자 아이디 + 비밀번호) — 기본 방식
 * 2) 예전 대표계정: 거래처코드 + 6자리 PIN (customers.auth_hash 가 설정된 경우에만)
 */
export async function loginCustomer(identifier: string, password: string, request?: Request) {
  await ensureDatabase();
  const loginId = normalizeLoginId(identifier);
  const credential = String(password ?? "").trim();
  if (!loginId || credential.length < 2 || credential.length > 64) throw new Error(LOGIN_FAILED_MESSAGE);

  const ip = request ? clientIp(request) : "unknown";
  await assertLoginNotThrottled(loginId, ip);

  let customerId = "";
  let customerUserId = "";

  const users = await db().prepare(`
    SELECT id, customer_id, auth_salt, auth_hash, active
    FROM customer_users
    WHERE replace(lower(username),'-','')=?
    LIMIT 2
  `).bind(loginId).all<Record<string, unknown>>();

  if (users.results.length > 1) {
    throw new Error("같은 아이디가 중복 등록되어 있습니다. 부자유통으로 문의해 주세요.");
  }

  const user = users.results[0];
  if (user) {
    const ok = Number(user.active ?? 0) === 1
      && await passwordMatches(credential, String(user.auth_salt ?? ""), String(user.auth_hash ?? ""));
    if (!ok) {
      await recordLoginFailure(loginId, ip);
      throw new Error(LOGIN_FAILED_MESSAGE);
    }
    customerUserId = String(user.id);
    const allowed = await allowedCustomerIds(customerUserId);
    if (!allowed.length) throw new Error("연결된 거래처가 없습니다. 부자유통으로 문의해 주세요.");
    const primary = String(user.customer_id ?? "");
    customerId = allowed.includes(primary) ? primary : allowed[0];
  } else {
    const customer = await db().prepare(
      "SELECT id,auth_salt,auth_hash,active FROM customers WHERE replace(lower(code),'-','')=? LIMIT 1",
    ).bind(loginId).first<{ id: string; auth_salt: string; auth_hash: string; active: number }>();
    const ok = Boolean(customer)
      && Number(customer?.active) === 1
      && Boolean(customer?.auth_hash)
      && /^\d{6}$/.test(credential)
      && await verifyPassword(credential, String(customer?.auth_salt ?? ""), String(customer?.auth_hash ?? ""));
    if (!ok || !customer) {
      await recordLoginFailure(loginId, ip);
      throw new Error(LOGIN_FAILED_MESSAGE);
    }
    customerId = customer.id;
  }

  const token = randomHexValue(32);
  const tokenHash = await sha256(token);
  await db().batch([
    db().prepare("DELETE FROM customer_sessions WHERE expires_at <= datetime('now')"),
    db().prepare("DELETE FROM auth_login_attempts WHERE scope='id' AND attempt_key=?").bind(loginId),
    db().prepare("INSERT INTO customer_sessions (token_hash, customer_id, customer_user_id, expires_at) VALUES (?, ?, ?, datetime('now', '+5 years'))")
      .bind(tokenHash, customerId, customerUserId),
  ]);
  return token;
}

type CustomerSessionState = {
  tokenHash: string;
  customerId: string;
  customerUserId: string;
  allowedIds: string[];
};

/**
 * 거래처 세션을 읽고 서버 기준으로 다시 검증합니다.
 * - 만료/삭제된 세션, 중지된 로그인 계정, 중지된 거래처 → null
 * - 관리자가 배송처 연결을 해제한 경우 → 남아 있는 첫 배송처로 자동 전환
 */
async function readCustomerSession(request: Request): Promise<CustomerSessionState | null> {
  const token = parseCookie(request, CUSTOMER_COOKIE_NAME);
  if (!token) return null;
  await ensureDatabase();
  const tokenHash = await sha256(token);
  const session = await db().prepare(`
    SELECT s.customer_id, s.customer_user_id, u.active AS user_active
    FROM customer_sessions s
    LEFT JOIN customer_users u ON u.id = s.customer_user_id
    WHERE s.token_hash = ? AND s.expires_at > datetime('now')
    LIMIT 1
  `).bind(tokenHash).first<{ customer_id: string; customer_user_id: string; user_active: number | null }>();
  if (!session) return null;

  const customerUserId = String(session.customer_user_id ?? "");
  let customerId = String(session.customer_id ?? "");

  if (customerUserId) {
    if (Number(session.user_active ?? 0) !== 1) return null;
    const allowedIds = await allowedCustomerIds(customerUserId);
    if (!allowedIds.length) return null;
    if (!allowedIds.includes(customerId)) {
      customerId = allowedIds[0];
      await db().prepare("UPDATE customer_sessions SET customer_id=?,last_seen_at=datetime('now') WHERE token_hash=?")
        .bind(customerId, tokenHash).run();
    }
    return { tokenHash, customerId, customerUserId, allowedIds };
  }

  const legacy = await db().prepare("SELECT id FROM customers WHERE id=? AND active=1 LIMIT 1").bind(customerId).first();
  if (!legacy) return null;
  return { tokenHash, customerId, customerUserId: "", allowedIds: [customerId] };
}

function toCustomerSummary(row: Record<string, unknown>): CustomerSummary {
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

async function readCustomerRows(ids: string[], customerUserId: string) {
  if (!ids.length) return [];
  const rows = await db().prepare(`
    SELECT c.id, c.code, c.name, c.phone, c.business_number, c.address, c.store_phone,
           c.region, c.price_group, c.active,
           COALESCE((SELECT display_name FROM customer_users WHERE id=?),'') AS login_name,
           COALESCE((SELECT SUM(amount) FROM receivable_ledger r WHERE r.customer_id = c.id), 0) AS receivable
    FROM customers c
    WHERE c.id IN (${ids.map(() => "?").join(",")}) AND c.active = 1
  `).bind(customerUserId, ...ids).all<Record<string, unknown>>();
  const byId = new Map(rows.results.map((row) => [String(row.id), toCustomerSummary(row)]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}

/** 현재 선택된 배송처 (로그인 안 됐으면 null) */
export async function getCustomer(request: Request): Promise<CustomerSummary | null> {
  const session = await readCustomerSession(request);
  if (!session) return null;
  const [customer] = await readCustomerRows([session.customerId], session.customerUserId);
  return customer ?? null;
}

/** 로그인 계정에 연결된 모든 배송처 (현재 배송처가 첫 번째) */
export async function getCustomerLocations(request: Request): Promise<CustomerSummary[]> {
  const session = await readCustomerSession(request);
  if (!session) return [];
  const ordered = [session.customerId, ...session.allowedIds.filter((id) => id !== session.customerId)];
  return readCustomerRows(ordered, session.customerUserId);
}

/** 배송처 전환: 연결 테이블에 있는 배송처만 허용 */
export async function switchCustomerLocation(request: Request, customerId: string) {
  const session = await readCustomerSession(request);
  if (!session) throw new Error("로그인이 필요합니다.");
  if (!session.allowedIds.includes(customerId)) throw new Error("선택할 수 없는 배송처입니다.");
  if (session.customerId === customerId) return;
  await db().prepare(
    "UPDATE customer_sessions SET customer_id=?,last_seen_at=datetime('now') WHERE token_hash=?",
  ).bind(customerId, session.tokenHash).run();
}

export async function logoutCustomer(request: Request) {
  const token = parseCookie(request, CUSTOMER_COOKIE_NAME);
  if (!token) return;
  await ensureDatabase();
  const tokenHash = await sha256(token);
  await db().prepare("DELETE FROM customer_sessions WHERE token_hash = ?").bind(tokenHash).run();
}

export async function revokeCustomerSessions(customerId: string) {
  await ensureDatabase();
  await db().prepare("DELETE FROM customer_sessions WHERE customer_id = ?").bind(customerId).run();
}

/**
 * 상품/사진 데이터 열람 권한: 거래처 로그인 · 직원 로그인 · 관리자 로그인 중 하나.
 * 완전 미인증이면 null.
 */
export async function getViewerKind(request: Request): Promise<"customer" | "staff" | "admin" | null> {
  if (await readCustomerSession(request)) return "customer";
  if (await isAdmin(request)) return "admin";
  if (await getStaff(request)) return "staff";
  return null;
}

export function validMutationOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return request.headers.get("sec-fetch-site") !== "cross-site";
  return origin === new URL(request.url).origin;
}
