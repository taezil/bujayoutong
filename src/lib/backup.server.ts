// 매일 자동 백업: 데이터베이스(D1) 전체를 R2 에 gzip JSON 으로 저장, 30일 보관.
// 키에 '/' 가 들어가므로 /api/photo (키에서 '/' 제거) 로는 절대 열리지 않습니다. 관리자 API 로만 내려받기.
import { bindings } from "./bindings.server";
import { db, ensureDatabase } from "./db.server";

export const BACKUP_PREFIX = "_backup/db/";
const KEEP_DAYS = 30;
/** 로그인 세션(토큰)은 백업에서 제외: 복원 후 다시 로그인하면 됨 */
const SKIP_TABLE = /^(sqlite_|_cf_|d1_)|session/i;

function kstNow(date = new Date()) {
  const kst = new Date(date.getTime() + 9 * 3600 * 1000);
  return { day: kst.toISOString().slice(0, 10), hour: kst.getUTCHours(), stamp: kst.toISOString().slice(0, 19).replace("T", " ") };
}

async function gzip(text: string) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** 전체 테이블을 읽어 하나의 JSON 으로 */
async function dumpDatabase() {
  await ensureDatabase();
  const tables = (await db().prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all<{ name: string }>()).results
    .map((row) => String(row.name)).filter((name) => !SKIP_TABLE.test(name));
  const out: Record<string, { rows: unknown[] }> = {};
  const counts: Record<string, number> = {};
  for (const name of tables) {
    const rows: unknown[] = [];
    const quoted = `"${name.replace(/"/g, '""')}"`;
    for (let offset = 0; ; offset += 2000) {
      const page = (await db().prepare(`SELECT * FROM ${quoted} LIMIT 2000 OFFSET ?`).bind(offset).all()).results;
      rows.push(...page);
      if (page.length < 2000) break;
    }
    out[name] = { rows };
    counts[name] = rows.length;
  }
  return { tables: out, counts };
}

export type BackupInfo = { key: string; day: string; size: number; uploaded: string };

export async function createBackup(reason: "auto" | "manual" = "auto") {
  const storage = bindings().STORAGE;
  if (!storage) throw new Error("저장소(R2)를 사용할 수 없습니다.");
  const now = kstNow();
  const { tables, counts } = await dumpDatabase();
  const body = await gzip(JSON.stringify({ app: "bujafood-order", version: 1, createdAtKst: now.stamp, reason, counts, tables }));
  const key = reason === "auto" ? `${BACKUP_PREFIX}${now.day}.json.gz` : `${BACKUP_PREFIX}${now.day}-manual-${Date.now()}.json.gz`;
  await storage.put(key, body, {
    httpMetadata: { contentType: "application/gzip" },
    customMetadata: { createdAtKst: now.stamp, reason, rows: String(Object.values(counts).reduce((a, b) => a + b, 0)) },
  });
  await pruneBackups();
  return { key, size: body.byteLength, counts };
}

export async function listBackups(): Promise<BackupInfo[]> {
  const storage = bindings().STORAGE;
  if (!storage) return [];
  const items: BackupInfo[] = [];
  let cursor: string | undefined;
  do {
    const page = await storage.list({ prefix: BACKUP_PREFIX, cursor, limit: 1000 });
    for (const object of page.objects) {
      items.push({ key: object.key, day: object.key.slice(BACKUP_PREFIX.length, BACKUP_PREFIX.length + 10), size: object.size, uploaded: object.uploaded.toISOString() });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return items.sort((a, b) => b.key.localeCompare(a.key));
}

async function pruneBackups() {
  const storage = bindings().STORAGE;
  if (!storage) return;
  const cutoff = kstNow(new Date(Date.now() - KEEP_DAYS * 86400 * 1000)).day;
  const old = (await listBackups()).filter((item) => item.day < cutoff).map((item) => item.key);
  if (old.length) await storage.delete(old);
}

let lastCheckedDay = "";

/** 1분 cron 에서 호출: 한국시간 새벽 3시대에 오늘 백업이 없으면 만듦 (한 번 실패해도 다음 분에 다시) */
export async function runDailyBackup(scheduledTime = Date.now()) {
  const now = kstNow(new Date(scheduledTime));
  if (now.hour !== 3 || lastCheckedDay === now.day) return false;
  const storage = bindings().STORAGE;
  if (!storage) return false;
  const key = `${BACKUP_PREFIX}${now.day}.json.gz`;
  if (await storage.head(key)) { lastCheckedDay = now.day; return false; }
  // 여러 인스턴스가 동시에 돌지 않게 잠금
  const lock = await db().prepare(`INSERT INTO app_settings(key,value) VALUES('backup_lock', datetime('now','+10 minutes'))
    ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE app_settings.value < datetime('now')`).run();
  if (!lock.meta.changes) return false;
  try {
    await createBackup("auto");
    lastCheckedDay = now.day;
    return true;
  } finally {
    await db().prepare("UPDATE app_settings SET value=datetime('now') WHERE key='backup_lock'").run();
  }
}

export async function readBackup(key: string) {
  if (!key.startsWith(BACKUP_PREFIX) || key.includes("..")) return null;
  return bindings().STORAGE?.get(key) ?? null;
}
