import type { D1Database } from "@cloudflare/workers-types";
import { blockLotFromName, normalizeLoginId, suggestedLoginId } from "./customer-login-id";
import { makeCustomerPasswordCredential } from "./password.server";

/*
 * 거래처 로그인 계정 생성 규칙
 *  - 거래처명 블록-로트("120-13") → 아이디 "12013"
 *  - 블록-로트가 없으면 거래처코드("00124")
 *  - 같은 숫자 아이디가 두 거래처 이상에서 나오면(예: 1-18 / 11-8 → 118) 해당 거래처들은 거래처코드 사용
 *  - 이미 다른 계정이 쓰는 아이디거나 다른 거래처코드와 같은 아이디면 거래처코드 사용
 *  - 비밀번호 기본값 = 아이디
 * 이미 로그인 계정에 연결된 거래처는 건너뜁니다(기존 계정/비밀번호를 덮어쓰지 않음).
 */

export const LOGIN_ID_PATTERN = /^[a-z0-9._]{2,40}$/;

export type AccountPlanRow = {
  customerId: string;
  code: string;
  name: string;
  loginId: string;
  rule: "block-lot" | "code" | "code-duplicate";
};

export type AccountPlanSkip = { customerId: string; code: string; name: string; reason: string };

export type AccountPlan = {
  pending: AccountPlanRow[];
  skipped: AccountPlanSkip[];
  alreadyLinked: number;
  totalActive: number;
};

export async function planCustomerAccounts(database: D1Database): Promise<AccountPlan> {
  const [customerRows, userRows, linkRows] = await Promise.all([
    database.prepare("SELECT id, code, name, active FROM customers ORDER BY code, name").all<Record<string, unknown>>(),
    database.prepare("SELECT id, customer_id, username FROM customer_users").all<Record<string, unknown>>(),
    database.prepare("SELECT customer_user_id, customer_id FROM customer_user_customers").all<Record<string, unknown>>(),
  ]);

  const customers = customerRows.results.map((row) => ({
    id: String(row.id),
    code: String(row.code ?? ""),
    name: String(row.name ?? ""),
    active: Number(row.active ?? 0) === 1,
  }));
  const linked = new Set<string>([
    ...linkRows.results.map((row) => String(row.customer_id)),
    ...userRows.results.map((row) => String(row.customer_id)),
  ]);
  const taken = new Set(userRows.results.map((row) => normalizeLoginId(String(row.username ?? ""))));
  const codeOwner = new Map(customers.map((customer) => [normalizeLoginId(customer.code), customer.id]));

  // 블록-로트 숫자 아이디가 몇 개 거래처에서 나오는지 (활성 거래처 기준)
  const blockLotCount = new Map<string, number>();
  for (const customer of customers) {
    if (!customer.active) continue;
    const blockLot = blockLotFromName(customer.name);
    if (!blockLot) continue;
    const id = blockLot.replace("-", "");
    blockLotCount.set(id, (blockLotCount.get(id) ?? 0) + 1);
  }

  const pending: AccountPlanRow[] = [];
  const skipped: AccountPlanSkip[] = [];
  let alreadyLinked = 0;
  let totalActive = 0;

  for (const customer of customers) {
    if (!customer.active) continue;
    totalActive += 1;
    if (linked.has(customer.id)) {
      alreadyLinked += 1;
      continue;
    }

    const codeId = normalizeLoginId(customer.code);
    const hasBlockLot = Boolean(blockLotFromName(customer.name));
    let loginId = suggestedLoginId(customer.name, customer.code);
    let rule: AccountPlanRow["rule"] = hasBlockLot ? "block-lot" : "code";

    const owner = codeOwner.get(loginId);
    const conflicts = (hasBlockLot && (blockLotCount.get(loginId) ?? 0) > 1)
      || taken.has(loginId)
      || (owner !== undefined && owner !== customer.id);
    if (conflicts) {
      loginId = codeId;
      rule = "code-duplicate";
    }

    const codeOwnerOfId = codeOwner.get(loginId);
    if (!LOGIN_ID_PATTERN.test(loginId)) {
      skipped.push({ customerId: customer.id, code: customer.code, name: customer.name, reason: "사용할 수 없는 아이디 형식" });
      continue;
    }
    if (taken.has(loginId) || (codeOwnerOfId !== undefined && codeOwnerOfId !== customer.id)) {
      skipped.push({ customerId: customer.id, code: customer.code, name: customer.name, reason: `아이디 ${loginId} 중복` });
      continue;
    }

    taken.add(loginId);
    pending.push({ customerId: customer.id, code: customer.code, name: customer.name, loginId, rule });
  }

  return { pending, skipped, alreadyLinked, totalActive };
}

/** 계정 1개 생성 + 배송처 연결. 비밀번호를 지정하지 않으면 아이디와 동일 */
export async function createCustomerAccount(
  database: D1Database,
  input: { customerId: string; loginId: string; displayName: string; password?: string; id?: string },
) {
  const loginId = normalizeLoginId(input.loginId);
  if (!LOGIN_ID_PATTERN.test(loginId)) throw new Error(`아이디 형식을 확인해 주세요: ${input.loginId}`);
  const credential = await makeCustomerPasswordCredential(input.password ?? loginId);
  const id = input.id ?? `CU-${crypto.randomUUID()}`;
  await database.batch([
    database.prepare("INSERT INTO customer_users(id,customer_id,username,display_name,auth_salt,auth_hash,active) VALUES(?,?,?,?,?,?,1)")
      .bind(id, input.customerId, loginId, input.displayName.slice(0, 80) || loginId, credential.salt, credential.hash),
    database.prepare("INSERT OR IGNORE INTO customer_user_customers(customer_user_id,customer_id,sort_order) VALUES(?,?,0)")
      .bind(id, input.customerId),
  ]);
  return id;
}

/** 계획(plan)대로 최대 limit 건 생성. PBKDF2 연산 때문에 한 번에 조금씩 나눠 실행합니다. */
export async function runCustomerAccountPlan(database: D1Database, limit = 20) {
  const plan = await planCustomerAccounts(database);
  const batch = plan.pending.slice(0, Math.max(1, Math.min(50, limit)));
  const created: AccountPlanRow[] = [];
  const failed: Array<AccountPlanRow & { error: string }> = [];
  for (const row of batch) {
    try {
      await createCustomerAccount(database, { customerId: row.customerId, loginId: row.loginId, displayName: row.name });
      created.push(row);
    } catch (error) {
      failed.push({ ...row, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { created, failed, remaining: Math.max(0, plan.pending.length - created.length) };
}

/**
 * 지정한 거래처 + 로그인 아이디가 실제로 로그인 가능하도록 맞춥니다 (테스트 계정 준비용).
 * 거래처가 없으면 기본 정보로 만들고, 아이디가 다른 거래처에 붙어 있으면 이 거래처로 옮깁니다.
 */
export async function ensureCustomerLogin(
  database: D1Database,
  input: {
    code: string;
    nameHint: string;
    loginId: string;
    password: string;
    displayName: string;
    defaults: { id: string; name: string; phone: string; businessNumber: string; address: string; region: string };
  },
) {
  let customer = await database.prepare("SELECT id FROM customers WHERE code=? LIMIT 1").bind(input.code).first<{ id: string }>();
  if (!customer) {
    // 코드가 앞자리 0 없이 저장된 경우 / 거래처명으로 찾기
    customer = await database.prepare(
      "SELECT id FROM customers WHERE ltrim(code,'0')=ltrim(?,'0') OR (name LIKE ? AND name LIKE ?) ORDER BY active DESC LIMIT 1",
    ).bind(input.code, `%${input.nameHint}%`, `%${blockLotFromName(input.defaults.name) || input.nameHint}%`).first<{ id: string }>();
  }
  if (!customer) {
    await database.prepare(`
      INSERT INTO customers (id,code,name,phone,business_number,address,store_phone,region,price_group,active)
      VALUES (?,?,?,?,?,?,'',?,'A',1)
    `).bind(
      input.defaults.id, input.code, input.defaults.name, input.defaults.phone,
      input.defaults.businessNumber, input.defaults.address, input.defaults.region,
    ).run();
    customer = { id: input.defaults.id };
  } else {
    await database.prepare("UPDATE customers SET active=1 WHERE id=?").bind(customer.id).run();
  }

  const loginId = normalizeLoginId(input.loginId);
  const existing = await database.prepare(
    "SELECT id FROM customer_users WHERE replace(lower(username),'-','')=? ORDER BY created_at LIMIT 1",
  ).bind(loginId).first<{ id: string }>();
  const credential = await makeCustomerPasswordCredential(input.password);

  if (existing) {
    await database.batch([
      database.prepare(
        "UPDATE customer_users SET customer_id=?,username=?,display_name=?,auth_salt=?,auth_hash=?,active=1,updated_at=datetime('now') WHERE id=?",
      ).bind(customer.id, loginId, input.displayName, credential.salt, credential.hash, existing.id),
      database.prepare("INSERT OR IGNORE INTO customer_user_customers(customer_user_id,customer_id,sort_order) VALUES(?,?,0)")
        .bind(existing.id, customer.id),
      database.prepare("UPDATE customer_user_customers SET sort_order=0 WHERE customer_user_id=? AND customer_id=?")
        .bind(existing.id, customer.id),
    ]);
    return { customerId: customer.id, customerUserId: existing.id, created: false };
  }

  const id = await createCustomerAccount(database, {
    customerId: customer.id,
    loginId,
    displayName: input.displayName,
    password: input.password,
  });
  return { customerId: customer.id, customerUserId: id, created: true };
}
