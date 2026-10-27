// 배송처 관리 end-to-end 점검 (여러 거래처 계정, 관리자 API/화면을 통한 실제 흐름만 사용 — DB 직접 INSERT 없음)
// 사용: node tests/delivery-e2e.mjs http://localhost:4173 [api-only]
import { execFileSync } from "node:child_process";
import { pbkdf2Sync } from "node:crypto";
import { writeFileSync } from "node:fs";

const BASE = (process.argv[2] || "http://localhost:4173").replace(/\/$/, "");
const API_ONLY = process.argv[3] === "api-only";
const results = [];
let failed = 0;
function check(name, ok, detail = "") {
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failed += 1;
  console.log(results[results.length - 1]);
}

class Client {
  constructor() { this.cookies = new Map(); }
  async req(path, init = {}) {
    const headers = new Headers(init.headers || {});
    if (this.cookies.size) headers.set("cookie", [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "));
    if (init.method && init.method !== "GET") headers.set("origin", BASE);
    if (init.json !== undefined) { headers.set("content-type", "application/json"); init.body = JSON.stringify(init.json); }
    const res = await fetch(BASE + path, { ...init, headers, redirect: "manual" });
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair, ...attrs] = raw.split(";");
      const idx = pair.indexOf("=");
      const key = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (!value || attrs.some((a) => a.trim().toLowerCase() === "max-age=0")) this.cookies.delete(key);
      else this.cookies.set(key, value);
    }
    return res;
  }
  async json(path, init) {
    const res = await this.req(path, init);
    let body = null;
    try { body = await res.json(); } catch {}
    return { status: res.status, body };
  }
}

// 테스트 관리자 비밀번호만 CI 로컬 DB에 설정 (운영 관리자 비밀번호를 모르기 때문). 그 외 데이터는 모두 관리자 API로 생성.
function setCiAdminPassword() {
  const salt = "ci-admin-salt";
  const hash = pbkdf2Sync("ci-admin-password", salt, 100000, 32, "sha256").toString("hex");
  execFileSync("npx", ["wrangler", "d1", "execute", "bujafood-db", "--local", "--command",
    `INSERT OR REPLACE INTO admin_credentials (id, salt, hash) VALUES (1, '${salt}', '${hash}');`], { stdio: "ignore" });
}

async function adminPost(admin, path, body) {
  const r = await admin.json(path, { method: "POST", json: body });
  if (r.status !== 200) throw new Error(`${path} ${body.action}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

async function login(id, pw = id) {
  const c = new Client();
  const r = await c.json("/api/customer/login", { method: "POST", json: { identifier: id, password: pw } });
  return { client: c, ok: r.status === 200, body: r.body };
}

async function main() {
  const anon = new Client();
  for (let i = 0; i < 30; i += 1) {
    if ((await anon.req("/api/customer/status")).status === 200) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  setCiAdminPassword();
  const admin = new Client();
  const al = await admin.json("/api/admin/login", { method: "POST", json: { username: "admin", password: "ci-admin-password" } });
  check("관리자 로그인", al.status === 200);

  // 1) 관리자 API로 정식 거래처 생성 (얼마에요 거래처에 해당)
  const tag = String(Date.now()).slice(-4);
  const specs = [
    { code: `7${tag}1`, name: `동해식당 118-13/1단지` },
    { code: `7${tag}2`, name: `서해급식 85-15/2단지` },
    { code: `7${tag}3`, name: `남해분식 73-2/3단지` },
    { code: `7${tag}4`, name: `북해한식 9-41/1단지` },
    { code: `7${tag}5`, name: `중앙식당 66-6/2단지` },
  ];
  for (const spec of specs) {
    await adminPost(admin, "/api/admin/customers", { action: "create", code: spec.code, name: spec.name, pin: "123456", phone: "010-1111-2222", address: `${spec.name} 주소`, region: "1단지" });
  }
  const customersList = (await admin.json("/api/admin/customers")).body.customers;
  const idOf = (code) => customersList.find((c) => c.code === code)?.id;
  check("관리자 API로 거래처 5곳 생성", specs.every((s) => idOf(s.code)));

  // 2) 서로 다른 거래처 계정 3개 (관리자 API)
  const accounts = [
    { username: `a${tag}`, primary: specs[0].code, link: [specs[1].code], extras: [{ name: "논현점", address: "논현동 1-2" }, { name: "118-14", address: "고잔동 3" }] },
    { username: `b${tag}`, primary: specs[2].code, link: [specs[3].code], extras: [{ name: "2호점", address: "구월동 9" }] },
    { username: `c${tag}`, primary: specs[4].code, link: [], extras: [{ name: "공장 식당", address: "남촌동 7" }] },
  ];
  for (const acc of accounts) {
    await adminPost(admin, "/api/admin/customer-users", { action: "create", customerId: idOf(acc.primary), displayName: acc.username, username: acc.username, password: acc.username });
  }
  const usersBody = (await admin.json("/api/admin/customer-users")).body;
  const userId = (username) => usersBody.users.find((u) => u.username === username)?.id;
  check("관리자 API로 거래처 계정 3개 생성", accounts.every((a) => userId(a.username)));

  globalThis.__ctx = { admin, accounts, specs, idOf, userId, tag };
  return { admin, accounts, specs, idOf, userId };
}

async function apiFlow({ admin, accounts, specs, idOf, userId }, mode) {
  // 3) 배송처 관리: 기존 거래처 연결 + 새 배송처 추가 (관리자 API)
  for (const acc of accounts) {
    const id = userId(acc.username);
    if (acc.link.length) {
      await adminPost(admin, "/api/admin/customer-users", { action: "set-customers", id, customerIds: [idOf(acc.primary), ...acc.link.map(idOf)] });
    }
    for (const extra of acc.extras) {
      const body = mode === "new"
        ? { action: "create-delivery-location", customerUserId: id, name: extra.name, address: extra.address, phone: "010-0000-0000", note: "" }
        : { action: "create-delivery-location", customerUserId: id, customerId: idOf(acc.primary), name: extra.name, address: extra.address, phone: "010-0000-0000", note: "" };
      await adminPost(admin, "/api/admin/customer-users", body);
    }
  }

  // 4) 각 계정 로그인 → 연결 거래처 + 추가 배송처 모두 조회
  for (const acc of accounts) {
    const { client, ok, body } = await login(acc.username);
    check(`[${acc.username}] 로그인`, ok, JSON.stringify(body));
    const st = (await client.json("/api/customer/status")).body;
    const names = [...(st?.locations ?? []).map((l) => l.name), ...(st?.deliveryLocations ?? []).map((d) => d.name)];
    const expected = [specs.find((s) => s.code === acc.primary).name, ...acc.link.map((code) => specs.find((s) => s.code === code).name), ...acc.extras.map((e) => e.name)];
    check(`[${acc.username}] 배송처 ${expected.length}곳 모두 조회`, expected.every((n) => names.includes(n)) && names.length === expected.length, JSON.stringify(names));
    // 다른 계정의 배송처가 섞이지 않음
    const others = accounts.filter((o) => o !== acc).flatMap((o) => o.extras.map((e) => e.name));
    check(`[${acc.username}] 다른 계정 배송처 섞이지 않음`, !names.some((n) => others.includes(n)), JSON.stringify(names));
  }
}

async function run() {
  const ctx = await main();
  await apiFlow(ctx, process.env.DELIVERY_MODE || "new");
  if (!API_ONLY) {
    const { browserFlow } = await import("./delivery-browser.mjs");
    await browserFlow(ctx, { BASE, check, login, Client });
  }
  console.log("\n================ SUMMARY ================");
  console.log(results.join("\n"));
  writeFileSync("delivery-summary.txt", `${results.length - failed}/${results.length} passed\n${results.join("\n")}\n`);
  if (failed) process.exit(1);
}

run().catch((error) => {
  console.error(error);
  writeFileSync("delivery-summary.txt", `CRASH ${String(error?.stack || error).slice(0, 1500)}\n${results.join("\n")}\n`);
  process.exit(1);
});
