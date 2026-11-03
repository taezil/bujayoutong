// 추가 관리자 계정(buja1 등) 점검: 생성 → 로그인 → 전체 관리자 기능 → 기록 → 비밀번호 변경 → 중지 → 알림센터 로그인
import { execFileSync } from "node:child_process";
import { pbkdf2Sync } from "node:crypto";
import { writeFileSync } from "node:fs";

const BASE = (process.argv[2] || "http://localhost:4173").replace(/\/$/, "");
const results = [];
let failed = 0;
const check = (name, ok, detail = "") => { results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`); if (!ok) failed += 1; console.log(results.at(-1)); };

class Client {
  constructor() { this.cookies = new Map(); }
  async req(path, init = {}) {
    const headers = new Headers(init.headers || {});
    if (this.cookies.size) headers.set("cookie", [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "));
    if (init.method && init.method !== "GET") headers.set("origin", BASE);
    if (init.json !== undefined) { headers.set("content-type", "application/json"); init.body = JSON.stringify(init.json); }
    const res = await fetch(BASE + path, { ...init, headers, redirect: "manual" });
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair, ...attrs] = raw.split(";"); const i = pair.indexOf("=");
      const k = pair.slice(0, i).trim(); const v = pair.slice(i + 1).trim();
      if (!v || attrs.some((a) => a.trim().toLowerCase() === "max-age=0")) this.cookies.delete(k); else this.cookies.set(k, v);
    }
    return res;
  }
  async json(path, init) { const res = await this.req(path, init); let body = null; try { body = await res.json(); } catch {} return { status: res.status, body }; }
}

async function main() {
  const salt = "ci-admin-salt";
  const hash = pbkdf2Sync("ci-admin-password", salt, 100000, 32, "sha256").toString("hex");
  execFileSync("npx", ["wrangler", "d1", "execute", "bujafood-db", "--local", "--command", `INSERT OR REPLACE INTO admin_credentials (id, salt, hash) VALUES (1, '${salt}', '${hash}');`], { stdio: "ignore" });

  const admin = new Client();
  check("admin 로그인", (await admin.json("/api/admin/login", { method: "POST", json: { username: "admin", password: "ci-admin-password" } })).status === 200);
  const list = await admin.json("/api/admin/staff");
  const seeded = Object.fromEntries((list.body?.adminUsers ?? []).map((u) => [u.username, u]));
  check("buja1 사모님 · buja2 대리님 · buja3 주임님 생성",
    seeded.buja1?.display_name === "사모님" && seeded.buja2?.display_name === "대리님" && seeded.buja3?.display_name === "주임님",
    JSON.stringify(Object.values(seeded).map((u) => `${u.username}=${u.display_name}`)));
  check("처음엔 비밀번호 미설정 → 로그인 불가", !seeded.buja1?.has_password
    && (await new Client().json("/api/admin/login", { method: "POST", json: { username: "buja1", password: "987654" } })).status === 401);

  // admin 이 처음 비밀번호 987654 지정 → 로그인
  const setPw = await admin.json("/api/admin/staff", { method: "POST", json: { action: "admin-password", id: seeded.buja1?.id, password: "987654" } });
  check("admin 이 buja1 처음 비밀번호 987654 지정", setPw.status === 200, JSON.stringify(setPw.body));
  const samonim = new Client();
  check("buja1 / 987654 로그인", (await samonim.json("/api/admin/login", { method: "POST", json: { username: "buja1", password: "987654" } })).status === 200);
  const samSt = await samonim.json("/api/admin/status");
  check("화면에 '사모님' 표시", samSt.body?.admin?.displayName === "사모님", JSON.stringify(samSt.body?.admin));
  const deskSam = await new Client().json("/api/desk/login", { method: "POST", json: { username: "buja1", pin: "987654", deviceName: "CI" } });
  check("알림센터에서도 '사모님'으로 로그인", deskSam.status === 200 && deskSam.body?.staff?.displayName === "사모님", JSON.stringify(deskSam.body?.staff ?? deskSam.body));

  // 본인이 비밀번호 변경
  const badSelf = await samonim.json("/api/admin/staff", { method: "POST", json: { action: "my-password", currentPassword: "000000", password: "samonim-new" } });
  check("내 비밀번호 변경: 지금 비밀번호 틀리면 거절", badSelf.status === 400, JSON.stringify(badSelf.body));
  const self = await samonim.json("/api/admin/staff", { method: "POST", json: { action: "my-password", currentPassword: "987654", password: "samonim-new" } });
  check("내 비밀번호 변경 성공", self.status === 200, JSON.stringify(self.body));
  check("변경 후 지금 화면은 유지", (await samonim.req("/api/admin/customers")).status === 200);
  check("변경 후 예전 비밀번호 거절", (await new Client().json("/api/admin/login", { method: "POST", json: { username: "buja1", password: "987654" } })).status === 401);
  check("변경 후 새 비밀번호 로그인", (await new Client().json("/api/admin/login", { method: "POST", json: { username: "buja1", password: "samonim-new" } })).status === 200);
  const deskOld = await fetch(`${BASE}/api/desk/pulse`, { headers: { authorization: `Bearer ${deskSam.body?.token}` } });
  check("변경 후 알림센터 기존 로그인 해제", deskOld.status === 401, `${deskOld.status}`);

  // admin 도 본인 비밀번호 변경 가능 (원래대로 되돌려 다른 테스트 영향 없게)
  const adminSelf = await admin.json("/api/admin/staff", { method: "POST", json: { action: "my-password", currentPassword: "ci-admin-password", password: "ci-admin-temp" } });
  check("admin 내 비밀번호 변경", adminSelf.status === 200, JSON.stringify(adminSelf.body));
  check("admin 새 비밀번호 로그인", (await new Client().json("/api/admin/login", { method: "POST", json: { username: "admin", password: "ci-admin-temp" } })).status === 200);
  await admin.json("/api/admin/staff", { method: "POST", json: { action: "my-password", currentPassword: "ci-admin-temp", password: "ci-admin-password" } });

  // 호칭 변경
  const rename = await admin.json("/api/admin/staff", { method: "POST", json: { action: "admin-rename", id: seeded.buja3?.id, displayName: "주임님" } });
  check("호칭 변경", rename.status === 200);

  const created = await admin.json("/api/admin/staff", { method: "POST", json: { action: "admin-create", username: "cibuja", displayName: "cibuja", password: "ci-first-pass" } });
  check("관리자 계정 추가", created.status === 200, JSON.stringify(created.body));
  const id = created.body?.id;

  const sub = new Client();
  const login = await sub.json("/api/admin/login", { method: "POST", json: { username: "cibuja", password: "ci-first-pass" } });
  check("추가 관리자 로그인", login.status === 200, JSON.stringify(login.body));
  const st = await sub.json("/api/admin/status");
  check("로그인한 관리자 이름 표시", st.body?.authenticated === true && st.body?.admin?.username === "cibuja", JSON.stringify(st.body));
  for (const path of ["/api/store?all=1", "/api/admin/customers", "/api/admin/customer-users", "/api/admin/staff", "/api/admin/orders", "/api/admin/dashboard"]) {
    const r = await sub.req(path);
    check(`추가 관리자 ${path} 사용 가능`, r.status === 200, `${r.status}`);
  }
  const page = await sub.req("/admin/accounts");
  check("추가 관리자 /admin/accounts 페이지", page.status === 200);

  // 변경 기록에 누가 했는지 남음
  await sub.json("/api/admin/customers", { method: "POST", json: { action: "create", code: `CI${Date.now() % 100000}`, name: "기록테스트식당", pin: "123456" } });
  const audit = await admin.json("/api/admin/audit");
  const rows = JSON.stringify(audit.body ?? "");
  check("변경 기록에 cibuja 이름", rows.includes("cibuja"), `${audit.status}`);

  // 사무실 알림센터(PC 프로그램) 로그인
  const desk = await new Client().json("/api/desk/login", { method: "POST", json: { username: "cibuja", pin: "ci-first-pass", deviceName: "CI" } });
  check("추가 관리자 알림센터 로그인", desk.status === 200 && desk.body?.staff?.username === "cibuja" && desk.body?.staff?.role === "ADMIN", JSON.stringify(desk.body?.staff ?? desk.body));
  const staffList = await admin.json("/api/admin/staff");
  check("알림센터용 내부 계정은 직원 목록에 안 보임", !(staffList.body?.staff ?? []).some((s) => String(s.id).startsWith("S-ADMINUSER-")));

  // 비밀번호 변경 → 기존 로그인 해제, 새 비밀번호로만 로그인
  const pw = await admin.json("/api/admin/staff", { method: "POST", json: { action: "admin-password", id, password: "ci-second-pass" } });
  check("비밀번호 변경", pw.status === 200, JSON.stringify(pw.body));
  check("비밀번호 변경 후 기존 로그인 해제", (await sub.req("/api/admin/customers")).status === 403);
  const deskAfterPw = await fetch(`${BASE}/api/desk/pulse`, { headers: { authorization: `Bearer ${desk.body?.token}` } });
  check("비밀번호 변경 후 알림센터 로그인도 해제", deskAfterPw.status === 401, `${deskAfterPw.status}`);
  check("예전 비밀번호 거절", (await new Client().json("/api/admin/login", { method: "POST", json: { username: "cibuja", password: "ci-first-pass" } })).status === 401);
  const sub2 = new Client();
  check("새 비밀번호 로그인", (await sub2.json("/api/admin/login", { method: "POST", json: { username: "cibuja", password: "ci-second-pass" } })).status === 200);

  // 중지 → 즉시 차단
  const off = await admin.json("/api/admin/staff", { method: "POST", json: { action: "admin-toggle", id, active: false } });
  check("계정 중지", off.status === 200);
  check("중지 후 즉시 관리자 기능 차단", (await sub2.req("/api/admin/customers")).status === 403);
  check("중지된 계정 로그인 거절", (await new Client().json("/api/admin/login", { method: "POST", json: { username: "cibuja", password: "ci-second-pass" } })).status === 401);
  check("중지된 계정 알림센터 로그인 거절", (await new Client().json("/api/desk/login", { method: "POST", json: { username: "cibuja", pin: "ci-second-pass", deviceName: "CI" } })).status === 401);
  const selfOff = await sub2.json("/api/admin/staff", { method: "POST", json: { action: "admin-toggle", id, active: true } });
  check("중지된 계정은 스스로 다시 켤 수 없음", selfOff.status === 403);

  // admin 은 그대로
  check("admin 계속 정상", (await admin.req("/api/admin/customers")).status === 200);
  check("관리자 아이디 admin 으로 추가 불가", (await admin.json("/api/admin/staff", { method: "POST", json: { action: "admin-create", username: "admin", password: "whatever123" } })).status === 400);

  writeFileSync("admin-users-summary.txt", `${results.length - failed}/${results.length} passed\n${results.join("\n")}\n`);
  if (failed) process.exit(1);
}
main().catch((e) => { console.error(e); writeFileSync("admin-users-summary.txt", `CRASH ${String(e?.stack || e).slice(0, 1200)}\n${results.join("\n")}\n`); process.exit(1); });
