/*
 * 사무실 발주 알림센터(Windows 프로그램) 전용 서버 로직.
 *
 * 인증
 * - 직원 아이디 + 6자리 PIN 으로 로그인하면 PC 전용 토큰을 발급합니다. (EXE 에는 인증정보가 없음)
 * - 토큰 원문은 PC(Windows 자격 증명 관리자)에만 있고, 서버에는 SHA-256 해시만 저장합니다.
 * - 쿠키가 아닌 Authorization: Bearer 헤더로만 받으므로 브라우저를 통한 CSRF 대상이 아닙니다.
 * - 직원 계정이 중지되거나 PIN 이 초기화되면 해당 직원의 PC 토큰도 즉시 무효가 됩니다.
 *
 * 처리상태 (order_desk_status)
 * - 행이 없으면 '신규' → '입력 중'(누가, 언제) → '입력완료'(누가, 언제)
 * - 상태 변경은 조건부 UPDATE 한 번으로 처리해서 두 PC 가 동시에 눌러도 한 명만 성공합니다.
 */
import type { D1Result } from "@cloudflare/workers-types";
import { db, ensureDatabase } from "./db.server";
import { randomHex, sha256, verifyPassword } from "./password.server";
import { writeAudit } from "./audit.server";

export type DeskStaff = { id: string; username: string; displayName: string; role: "ADMIN" | "DRIVER"; deviceName: string };

const TOKEN_DAYS = 180;
const LOGIN_WINDOW_MINUTES = 15;
const LOGIN_MAX_FAILURES_PER_ID = 8;
const LOGIN_MAX_FAILURES_PER_IP = 30;

export class DeskError extends Error {
  status: number;
  extra: Record<string, unknown>;
  constructor(message: string, status = 400, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export function deskJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store, private" } });
}

export function deskErrorResponse(error: unknown, fallback: string) {
  if (error instanceof DeskError) return deskJson({ error: error.message, ...error.extra }, error.status);
  console.error(error);
  return deskJson({ error: fallback }, 500);
}

function clientIp(request: Request) {
  return (request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown").trim().slice(0, 64);
}

function cleanDeviceName(value: unknown) {
  return String(value ?? "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 60) || "사무실 PC";
}

/* ---------- 로그인 / 토큰 ---------- */

export async function deskLogin(request: Request, username: string, pin: string, deviceName: string) {
  await ensureDatabase();
  const normalized = String(username ?? "").trim().toLowerCase().slice(0, 40);
  const ip = clientIp(request);
  const throttle = await db().prepare(`
    SELECT
      SUM(CASE WHEN scope='desk-id' AND attempt_key=? THEN 1 ELSE 0 END) AS by_id,
      SUM(CASE WHEN scope='desk-ip' AND attempt_key=? THEN 1 ELSE 0 END) AS by_ip
    FROM auth_login_attempts WHERE created_at > datetime('now', ?)
  `).bind(normalized, ip, `-${LOGIN_WINDOW_MINUTES} minutes`).first<{ by_id: number | null; by_ip: number | null }>();
  if (Number(throttle?.by_id ?? 0) >= LOGIN_MAX_FAILURES_PER_ID || Number(throttle?.by_ip ?? 0) >= LOGIN_MAX_FAILURES_PER_IP) {
    throw new DeskError(`로그인 시도가 너무 많습니다. ${LOGIN_WINDOW_MINUTES}분 후 다시 시도해 주세요.`, 429);
  }

  const fail = async () => {
    try {
      await db().batch([
        db().prepare("DELETE FROM auth_login_attempts WHERE created_at < datetime('now','-1 day')"),
        db().prepare("INSERT INTO auth_login_attempts(scope,attempt_key) VALUES('desk-id',?)").bind(normalized),
        db().prepare("INSERT INTO auth_login_attempts(scope,attempt_key) VALUES('desk-ip',?)").bind(ip),
      ]);
    } catch (error) {
      console.error("desk login attempt log failed", error);
    }
    return new DeskError("아이디와 PIN을 확인해 주세요.", 401);
  };

  if (!normalized || !/^\d{6}$/.test(String(pin ?? ""))) throw await fail();
  const row = await db().prepare(
    "SELECT id,username,display_name,role,auth_salt,auth_hash,active FROM staff_users WHERE lower(username)=lower(?) LIMIT 1",
  ).bind(normalized).first<Record<string, unknown>>();
  if (!row || Number(row.active ?? 0) !== 1) throw await fail();
  if (!(await verifyPassword(String(pin), String(row.auth_salt), String(row.auth_hash)))) throw await fail();

  const token = randomHex(32);
  const tokenHash = await sha256(token);
  const device = cleanDeviceName(deviceName);
  await db().batch([
    db().prepare("DELETE FROM desk_sessions WHERE expires_at <= datetime('now')"),
    db().prepare("DELETE FROM auth_login_attempts WHERE scope='desk-id' AND attempt_key=?").bind(normalized),
    db().prepare(`INSERT INTO desk_sessions(token_hash,staff_id,device_name,expires_at) VALUES(?,?,?,datetime('now','+${TOKEN_DAYS} days'))`)
      .bind(tokenHash, String(row.id), device),
  ]);
  const staff: DeskStaff = {
    id: String(row.id), username: String(row.username), displayName: String(row.display_name),
    role: String(row.role) === "ADMIN" ? "ADMIN" : "DRIVER", deviceName: device,
  };
  await writeAudit({ actor: { type: "staff", id: staff.id, name: staff.displayName }, action: "desk_login", entityType: "desk", summary: `발주 알림센터 로그인 · ${device}` })
    .catch((error) => console.error("desk audit failed", error));
  return { token, staff };
}

function bearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+([0-9a-f]{64})$/i.exec(header.trim());
  return match ? match[1].toLowerCase() : "";
}

/** 알림센터 API 공통 인증. 실패하면 DeskError(401) */
export async function requireDeskStaff(request: Request): Promise<DeskStaff & { tokenHash: string }> {
  const token = bearerToken(request);
  if (!token) throw new DeskError("로그인이 필요합니다.", 401);
  await ensureDatabase();
  const tokenHash = await sha256(token);
  const row = await db().prepare(`
    SELECT u.id,u.username,u.display_name,u.role,s.device_name,
           (s.last_seen_at < datetime('now','-10 minutes')) AS stale
    FROM desk_sessions s JOIN staff_users u ON u.id=s.staff_id
    WHERE s.token_hash=? AND s.expires_at>datetime('now') AND u.active=1
    LIMIT 1
  `).bind(tokenHash).first<Record<string, unknown>>();
  if (!row) throw new DeskError("로그인이 만료되었습니다. 다시 로그인해 주세요.", 401);
  if (Number(row.stale ?? 0) === 1) {
    // 사용 중인 PC 는 만료일을 자동 연장 (쓰기는 10분에 한 번만)
    await db().prepare(`UPDATE desk_sessions SET last_seen_at=datetime('now'),expires_at=datetime('now','+${TOKEN_DAYS} days') WHERE token_hash=?`).bind(tokenHash).run();
  }
  return {
    id: String(row.id), username: String(row.username), displayName: String(row.display_name),
    role: String(row.role) === "ADMIN" ? "ADMIN" : "DRIVER", deviceName: String(row.device_name ?? ""), tokenHash,
  };
}

export async function deskLogout(request: Request) {
  const token = bearerToken(request);
  if (!token) return;
  await ensureDatabase();
  await db().prepare("DELETE FROM desk_sessions WHERE token_hash=?").bind(await sha256(token)).run();
}

/* ---------- 주문 조회 ---------- */

async function trackingSince() {
  const row = await db().prepare("SELECT value FROM app_settings WHERE key='desk_tracking_since'").first<{ value: string }>();
  return row?.value || "1970-01-01 00:00:00";
}

/**
 * 변경 감지용 값. 주문/처리상태가 바뀌면 달라집니다. (PC 는 이 값이 바뀔 때만 전체 목록을 다시 받음)
 * PC 여러 대가 수 초마다 부르므로 인덱스로 행 몇 개만 읽도록 구성 (주문이 쌓여도 읽기량이 늘지 않음)
 */
export async function deskPulse() {
  const row = await db().prepare(`
    SELECT
      (SELECT MAX(rowid) FROM orders) AS last_rowid,
      (SELECT MAX(updated_at) FROM orders) AS last_updated,
      (SELECT value FROM app_settings WHERE key='desk_rev') AS desk_rev,
      (SELECT COUNT(*) FROM order_desk_status WHERE state IN ('new','entering')) AS open_count
  `).first<Record<string, unknown>>();
  const marker = [row?.last_rowid, row?.last_updated, row?.desk_rev].map((v) => String(v ?? "")).join("|");
  return { marker: await sha256(marker), openCount: Number(row?.open_count ?? 0), serverTime: new Date().toISOString(), trackingSince: await trackingSince() };
}

const SOURCE_LABELS: Record<string, string> = { app: "거래처 주문", driver: "현장발주", admin: "관리자 입력" };

type OrderRow = Record<string, unknown>;

async function loadOrders(where: string, params: unknown[], orderBy: string, limit: number) {
  const orders = await db().prepare(`
    SELECT o.id,o.customer_id,o.source,o.status,o.region_snapshot,o.total_amount,o.note,o.created_at,o.updated_at,
           o.delivery_date,o.order_period,o.is_additional,o.created_by_staff_name,o.cancelled_at,
           o.delivery_location_name,o.delivery_location_address,o.delivery_location_phone,
           c.code AS customer_code,c.name AS customer_name,c.phone AS customer_phone,c.address AS customer_address,
           COALESCE(d.state,'new') AS desk_state,COALESCE(d.revision,0) AS desk_revision,
           COALESCE(d.entering_by_id,'') AS entering_by_id,COALESCE(d.entering_by_name,'') AS entering_by_name,
           COALESCE(d.entering_device,'') AS entering_device,COALESCE(d.entering_at,'') AS entering_at,
           COALESCE(d.done_by_id,'') AS done_by_id,COALESCE(d.done_by_name,'') AS done_by_name,COALESCE(d.done_at,'') AS done_at,
           (SELECT p.id FROM orders p
             WHERE p.customer_id=o.customer_id AND p.delivery_date=o.delivery_date AND p.id<>o.id
               AND p.status<>'cancelled' AND COALESCE(p.delivery_location_id,'')=COALESCE(o.delivery_location_id,'')
               AND (p.created_at<o.created_at OR (p.created_at=o.created_at AND p.rowid<o.rowid))
             ORDER BY p.created_at DESC, p.rowid DESC LIMIT 1) AS previous_order_id
    FROM orders o
    JOIN customers c ON c.id=o.customer_id
    LEFT JOIN order_desk_status d ON d.order_id=o.id
    ${where}
    ORDER BY ${orderBy}
    LIMIT ${limit}
  `).bind(...params).all<OrderRow>();
  const rows = orders.results;
  const itemMap = new Map<string, OrderRow[]>();
  // D1 바인딩 개수 제한(100)을 넘지 않도록 나눠서 조회
  for (let index = 0; index < rows.length; index += 90) {
    const ids = rows.slice(index, index + 90).map((r) => String(r.id));
    if (!ids.length) continue;
    const items = await db().prepare(`
      SELECT oi.id,oi.order_id,oi.product_id,oi.product_name,oi.unit,oi.option_label,oi.quantity,oi.unit_price,
             COALESCE((SELECT po.spec FROM pack_options po WHERE po.product_id=oi.product_id AND po.label=oi.option_label ORDER BY po.sort_order,po.id LIMIT 1),'') AS option_spec
      FROM order_items oi WHERE oi.order_id IN (${ids.map(() => "?").join(",")}) ORDER BY oi.id
    `).bind(...ids).all<OrderRow>();
    for (const item of items.results) {
      const key = String(item.order_id);
      const list = itemMap.get(key) ?? [];
      list.push(item);
      itemMap.set(key, list);
    }
  }
  return rows.map((r) => toDeskOrder(r, itemMap.get(String(r.id)) ?? []));
}

function utcIso(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return /Z$|[+-]\d{2}:?\d{2}$/.test(text) ? text : `${text.replace(" ", "T")}Z`;
}

function toDeskOrder(r: OrderRow, items: OrderRow[]) {
  const status = String(r.status ?? "received");
  const additionalBySystem = Number(r.is_additional ?? 0) === 1;
  const previousOrderId = r.previous_order_id ? String(r.previous_order_id) : "";
  const deskState = String(r.desk_state) === "entering" ? "entering" : String(r.desk_state) === "done" ? "done" : "new";
  const updatedAt = utcIso(r.updated_at);
  return {
    id: String(r.id),
    customerId: String(r.customer_id),
    customerCode: String(r.customer_code ?? ""),
    customerName: String(r.customer_name ?? ""),
    customerPhone: String(r.customer_phone ?? ""),
    customerAddress: String(r.customer_address ?? ""),
    region: String(r.region_snapshot ?? ""),
    source: String(r.source ?? "app"),
    sourceLabel: SOURCE_LABELS[String(r.source ?? "app")] ?? String(r.source ?? ""),
    createdByStaffName: String(r.created_by_staff_name ?? ""),
    status,
    cancelled: status === "cancelled",
    createdAt: utcIso(r.created_at),
    updatedAt,
    deliveryDate: String(r.delivery_date ?? ""),
    orderPeriod: String(r.order_period) === "PM" ? "PM" : "AM",
    isAdditional: additionalBySystem || Boolean(previousOrderId),
    previousOrderId,
    note: String(r.note ?? ""),
    deliveryLocation: r.delivery_location_name
      ? { name: String(r.delivery_location_name), address: String(r.delivery_location_address ?? ""), phone: String(r.delivery_location_phone ?? "") }
      : null,
    total: Number(r.total_amount ?? 0),
    items: items.map((i) => ({
      id: Number(i.id),
      productId: String(i.product_id),
      productName: String(i.product_name),
      spec: String(i.option_spec || i.unit || ""),
      unit: String(i.option_label ?? ""),
      quantity: Number(i.quantity),
      unitPrice: Number(i.unit_price ?? 0),
    })),
    desk: {
      state: deskState,
      revision: Number(r.desk_revision ?? 0),
      enteringById: String(r.entering_by_id ?? ""),
      enteringBy: String(r.entering_by_name ?? ""),
      enteringDevice: String(r.entering_device ?? ""),
      enteringAt: utcIso(r.entering_at),
      doneById: String(r.done_by_id ?? ""),
      doneBy: String(r.done_by_name ?? ""),
      doneAt: utcIso(r.done_at),
    },
    // 주문 내용/취소/처리상태가 바뀌면 달라지는 값 (PC 는 이 값으로 변경 알림 여부를 판단)
    contentVersion: `${updatedAt}|${status}`,
  };
}

export type DeskOrder = ReturnType<typeof toDeskOrder>;

/** 입력완료 전 주문 전체 (기간 제한 없음 → 입력완료 전에는 목록에서 사라지지 않음) */
export async function deskOpenOrders() {
  const since = await trackingSince();
  // 1) 처리상태가 신규/입력 중인 주문 (인덱스로 열린 주문만 읽음)
  const open = await db().prepare("SELECT order_id FROM order_desk_status WHERE state IN ('new','entering')").all<{ order_id: string }>();
  // 2) 안전장치: 최근 3일 주문 중 처리상태 행이 없는 주문
  const missing = await db().prepare(`
    SELECT o.id FROM orders o
    WHERE o.created_at >= MAX(?, datetime('now','-3 days'))
      AND NOT EXISTS (SELECT 1 FROM order_desk_status d WHERE d.order_id=o.id)
  `).bind(since).all<{ id: string }>();
  const ids = Array.from(new Set([...open.results.map((r) => String(r.order_id)), ...missing.results.map((r) => String(r.id))]));
  const orders: DeskOrder[] = [];
  for (let index = 0; index < ids.length; index += 90) {
    const chunk = ids.slice(index, index + 90);
    orders.push(...await loadOrders(`WHERE o.id IN (${chunk.map(() => "?").join(",")})`, chunk, "o.created_at ASC, o.id ASC", 90));
  }
  return orders.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id.localeCompare(b.id)));
}

/** 처리내역 / 검색 */
export async function deskHistory(options: { from?: string; to?: string; q?: string; dateField?: string; state?: string; limit?: number }) {
  const since = await trackingSince();
  const params: unknown[] = [since];
  let where = "WHERE o.created_at>=?";
  const state = options.state === "all" ? "all" : options.state === "open" ? "open" : "done";
  if (state === "done") where += " AND d.state='done'";
  if (state === "open") where += " AND COALESCE(d.state,'new')<>'done'";
  const dateOk = (v?: string) => Boolean(v && /^\d{4}-\d{2}-\d{2}$/.test(v));
  if (options.dateField === "delivery") {
    if (dateOk(options.from)) { where += " AND o.delivery_date>=?"; params.push(options.from); }
    if (dateOk(options.to)) { where += " AND o.delivery_date<=?"; params.push(options.to); }
  } else {
    // 접수일(한국시간) 기준
    if (dateOk(options.from)) { where += " AND date(o.created_at,'+9 hours')>=?"; params.push(options.from); }
    if (dateOk(options.to)) { where += " AND date(o.created_at,'+9 hours')<=?"; params.push(options.to); }
  }
  const q = String(options.q ?? "").trim().slice(0, 40);
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    where += ` AND (c.name LIKE ? ESCAPE '\\' OR c.code LIKE ? ESCAPE '\\' OR o.id LIKE ? ESCAPE '\\' OR o.delivery_location_name LIKE ? ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM order_items si WHERE si.order_id=o.id AND si.product_name LIKE ? ESCAPE '\\'))`;
    params.push(like, like, like, like, like);
  }
  const limit = Math.max(1, Math.min(500, Math.round(Number(options.limit) || 300)));
  return loadOrders(where, params, "o.created_at DESC, o.id DESC", limit);
}

export async function deskOrderById(orderId: string) {
  const [order] = await loadOrders("WHERE o.id=?", [orderId], "o.id", 1);
  return order ?? null;
}

/* ---------- 처리상태 변경 ---------- */

export type DeskAction = "start" | "release" | "done" | "reopen";

export async function deskChangeState(staff: DeskStaff, orderId: string, action: DeskAction, force: boolean) {
  const order = await db().prepare("SELECT o.id,o.status,c.code,c.name FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.id=? LIMIT 1")
    .bind(orderId).first<Record<string, unknown>>();
  if (!order) throw new DeskError("주문을 찾을 수 없습니다.", 404);
  await db().prepare("INSERT OR IGNORE INTO order_desk_status(order_id,state) VALUES(?,'new')").bind(orderId).run();

  const takeover = force ? 1 : 0;
  let result: D1Result;
  if (action === "start") {
    result = await db().prepare(`
      UPDATE order_desk_status
      SET state='entering',entering_by_id=?,entering_by_name=?,entering_device=?,entering_at=datetime('now'),
          revision=revision+1,updated_at=datetime('now')
      WHERE order_id=? AND (state='new' OR (state='entering' AND (entering_by_id=? OR ?=1)))
    `).bind(staff.id, staff.displayName, staff.deviceName, orderId, staff.id, takeover).run();
  } else if (action === "release") {
    result = await db().prepare(`
      UPDATE order_desk_status
      SET state='new',entering_by_id='',entering_by_name='',entering_device='',entering_at='',revision=revision+1,updated_at=datetime('now')
      WHERE order_id=? AND state='entering' AND (entering_by_id=? OR ?=1)
    `).bind(orderId, staff.id, takeover).run();
  } else if (action === "done") {
    result = await db().prepare(`
      UPDATE order_desk_status
      SET state='done',done_by_id=?,done_by_name=?,done_at=datetime('now'),revision=revision+1,updated_at=datetime('now')
      WHERE order_id=? AND (state='new' OR (state='entering' AND (entering_by_id=? OR ?=1)))
    `).bind(staff.id, staff.displayName, orderId, staff.id, takeover).run();
  } else if (action === "reopen") {
    result = await db().prepare(`
      UPDATE order_desk_status
      SET state='new',entering_by_id='',entering_by_name='',entering_device='',entering_at='',done_by_id='',done_by_name='',done_at='',
          revision=revision+1,updated_at=datetime('now')
      WHERE order_id=? AND state='done'
    `).bind(orderId).run();
  } else {
    throw new DeskError("지원하지 않는 작업입니다.");
  }

  const current = await deskOrderById(orderId);
  if (!current) throw new DeskError("주문을 찾을 수 없습니다.", 404);
  const changed = Number(result.meta?.changes ?? 0) > 0;
  if (!changed) {
    const desk = current.desk;
    if (action === "done" && desk.state === "done") {
      return { ok: true, alreadyDone: true, order: current };
    }
    let message = "다른 직원이 먼저 처리상태를 바꿨습니다. 목록을 새로고침했습니다.";
    if (desk.state === "entering") message = `${desk.enteringBy || "다른 직원"}님이 입력 중인 주문입니다.`;
    if (desk.state === "done") message = `${desk.doneBy || "다른 직원"}님이 이미 입력완료한 주문입니다.`;
    if (action === "reopen" && desk.state !== "done") message = "입력완료 상태가 아닌 주문입니다.";
    throw new DeskError(message, 409, { conflict: true, order: current });
  }

  // 다른 PC 들이 다음 pulse 에서 바로 알아채도록 변경 카운터 증가
  await db().prepare("UPDATE app_settings SET value=CAST(CAST(value AS INTEGER)+1 AS TEXT) WHERE key='desk_rev'").run();

  const labels: Record<DeskAction, string> = { start: "입력 시작", release: "입력 중 해제", done: "입력완료", reopen: "입력완료 취소" };
  await writeAudit({
    actor: { type: "staff", id: staff.id, name: staff.displayName },
    action: `desk_${action}`,
    entityType: "order",
    entityId: orderId,
    summary: `알림센터 ${labels[action]}${force ? "(이어받기)" : ""} · ${String(order.code)} ${String(order.name)} · ${staff.deviceName}`,
  }).catch((error) => console.error("desk audit failed", error));
  return { ok: true, alreadyDone: false, order: current };
}

/** PIN 초기화/계정 중지 시 PC 토큰 무효화 */
export async function revokeDeskSessions(staffId: string) {
  await db().prepare("DELETE FROM desk_sessions WHERE staff_id=?").bind(staffId).run();
}
