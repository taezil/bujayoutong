PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS staff_users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('ADMIN','DRIVER')),
  auth_salt TEXT NOT NULL,
  auth_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS staff_sessions (
  token_hash TEXT PRIMARY KEY,
  staff_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(staff_id) REFERENCES staff_users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_staff_sessions_staff ON staff_sessions(staff_id, expires_at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_type TEXT NOT NULL DEFAULT 'system',
  actor_id TEXT NOT NULL DEFAULT '',
  actor_name TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL DEFAULT '',
  entity_id TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id, created_at DESC);

CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  category_note TEXT NOT NULL DEFAULT '',
  order_cutoff TEXT NOT NULL DEFAULT '',
  memo TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_suppliers_sort ON suppliers(active, sort_order, name);

CREATE TABLE IF NOT EXISTS order_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL,
  order_item_id INTEGER NOT NULL,
  adjustment_type TEXT NOT NULL CHECK(adjustment_type IN ('return','missing')),
  quantity REAL NOT NULL,
  amount INTEGER NOT NULL,
  actor_type TEXT NOT NULL DEFAULT 'admin',
  actor_id TEXT NOT NULL DEFAULT '',
  actor_name TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(order_id) REFERENCES orders(id),
  FOREIGN KEY(order_item_id) REFERENCES order_items(id)
);
CREATE INDEX IF NOT EXISTS idx_order_adjustments_order ON order_adjustments(order_id, created_at DESC);

INSERT OR IGNORE INTO staff_users(id, username, display_name, role, auth_salt, auth_hash) VALUES
('S-OWNER','owner','사장님','DRIVER','ac5cfd2c71042ebcd5ff6257af76aea6','d091b40909a46f2af12b2b15ae2f71f1f72867d82a663c645afeedaecc889c77'),
('S-CHA','cha','채한옥 실장','DRIVER','cd9b201e6db1bc951ba4d6cdca5b4046','ba7b4bcc5d47a115dd1d475fc99c39a4795f7bc94bd2a9800ec424fce69dcd9b'),
('S-AN','an','안상진 부장','DRIVER','e70e02a9198aad2d24251cfb4c3022e0','344303cf703d68c8feda72011a2e3090c18283006aaa8230f813422a9e3e6d26'),
('S-MINSU','minsu','김민수 과장','DRIVER','57c2d1344b6e44ef0b39706d237c88d1','f6a06c613362d9c17d53641c1798e2093a817681de6676a1d0f82afa62c0b3e2'),
('S-JANG','jang','장윤진 기사','DRIVER','95469df0eb03599c5d14dd82d37acdb1','d41734b6c2830581567a22cc7e0139abbf44f14b55dfd39dc8d29f4e6784dce6'),
('S-LEE','lee','이혜선 대리님','ADMIN','f3b139cfd45c441105e77357caa9ea43','b15d778b70c45da77b9b689c0596dd20f874b5132c26e7dee7feba43a7121f44'),
('S-JUNG','jung','정승영 주임님','ADMIN','daf0b489e0c94f612e2d1cd36ad6375e','b58353123f472f11f5f61b76463038ff9a496d1c41e36629866266d4188c0825'),
('S-MADAM','madam','사모님','ADMIN','125ef8aa7d5ca09da8ff04655546c190','6431e16a5403ee6be6786e85f192d49365e0557abe45f7eb56edd4f5d1faa327');
