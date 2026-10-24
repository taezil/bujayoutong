import type { D1Database } from "@cloudflare/workers-types";
import { bindings } from "./bindings.server";
import migrationSql from "../../migrations/0001_init.sql?raw";
import erpMigrationSql from "../../migrations/0002_erp.sql?raw";

const EXCEL_CATALOG_GZIP_BASE64 = "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QugI4XoM3fAbth3uvMmDuNUPdEhdYXuzLz7I4DsMbsmb4FAO2xAE+eDVqKzge5MGmcB6Xga4O40rNZeBtRMZQcgdkim10SkA2uSFK0O3JeiTr14IE/mvc5/ayqcCTWOqWLZ07ECptC0djihJjQsXD368D6J4iqhHnHzOnEww++ar2TLPyAE9nYu5EJ8lklRrW1UfRTingc6MpNxdrEn1lhc0n2bwT1d6GRkAkTVkuiO7Es5Nw2zX9m1ifOAqStT9m8m5gAWUDJzPJIrrcoBPxFaoFYRMATIvVigpe0rIqxnJFEhV0+V67awny8eCNWa/OEZNfjdDoejHVtudTsI7k+5VrIPP0gWaDKP4YWUZBNOixqieLeEQciiVbCHwagVmMADOhREi5fKQjb40JWUokVAZSoNNgO6F8tPPq5fK6046kvF5acyopOnh6cA49RjaUxSFthJj11UVJg1oHlK6qEQ7840FOpThhdq4SgRslSND13NBchFWidwS6gHMRmt2wvCKtCyDLWPyvpqSK3JgljOo+46VuSQZ72CT3714LOL7fnl5tH55nz7+cOz+9vNg88uH22evHz5+NX169fPvnr66ujL67989ObJ8z9dH2/+cPbwi+3F5uje9Z+vrp8/vnry+snzF08fP7t5+eLr14/f2PJRh8t+8flvzi633WU2F9vLTbnM5tPN/bOLy6P7j84ebi/ub49GJ/jgt0flP4fd7XjwoPeON2cX47Nsf7c9P978emM3f/z99ny7GR7m03tvrr9+9ezFV/c++T/9i6gL8oMCAA==";

async function readExcelCatalogSql() {
  const compressed = Uint8Array.from(atob(EXCEL_CATALOG_GZIP_BASE64), (char) => char.charCodeAt(0));
  const stream = new Response(compressed).body;
  if (!stream) throw new Error("Excel catalog payload could not be read");
  return new Response(stream.pipeThrough(new DecompressionStream("gzip"))).text();
}

function splitSqlStatements(sql: string) {
  const statements: string[] = [];
  let start = 0;
  let quoted = false;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    if (char === "'") {
      if (quoted && sql[index + 1] === "'") {
        index += 1;
        continue;
      }
      quoted = !quoted;
      continue;
    }
    if (char === ";" && !quoted) {
      const statement = sql.slice(start, index + 1).trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }
  }

  const tail = sql.slice(start).trim();
  if (tail) statements.push(tail);
  return statements;
}

function splitSqlValueRows(values: string) {
  const rows: string[] = [];
  let start = 0;
  let depth = 0;
  let quoted = false;

  for (let index = 0; index < values.length; index += 1) {
    const char = values[index];
    if (char === "'") {
      if (quoted && values[index + 1] === "'") {
        index += 1;
        continue;
      }
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (char === "," && depth === 0) {
      const row = values.slice(start, index).trim();
      if (row) rows.push(row);
      start = index + 1;
    }
  }

  const tail = values.slice(start).trim();
  if (tail) rows.push(tail);
  return rows;
}

async function execChunkedValuesStatement(database: D1Database, statement: string, chunkSize = 100) {
  const match = statement.match(/^([\s\S]*?\bVALUES\s*)([\s\S]*?);?\s*$/i);
  if (!match) throw new Error("Excel catalog VALUES statement is invalid");

  const header = match[1];
  const rows = splitSqlValueRows(match[2]);
  if (!rows.length) throw new Error("Excel catalog contains no rows");

  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    await database.exec(`${header}${chunk.join(",\n")};`);
  }
}

async function importExcelCatalog(database: D1Database) {
  const sql = await readExcelCatalogSql();
  const statements = splitSqlStatements(sql);
  if (!statements.length) throw new Error("Excel catalog SQL is empty");

  let productsSeen = false;
  let optionsSeen = false;

  for (const statement of statements) {
    const normalized = statement.trimStart();
    if (/^INSERT\s+INTO\s+products\b/i.test(normalized)) {
      productsSeen = true;
      await execChunkedValuesStatement(database, statement, 100);
    } else if (/^INSERT\s+INTO\s+pack_options\b/i.test(normalized)) {
      optionsSeen = true;
      await execChunkedValuesStatement(database, statement, 100);
    } else {
      await database.exec(statement);
    }
  }

  if (!productsSeen || !optionsSeen) throw new Error("Excel catalog product statements were not found");
}

export type PackOption = {
  label: string;
  spec?: string;
  price: number | null;
  priceA?: number | null;
  priceB?: number | null;
  step: number;
};

export type Product = {
  id: string;
  name: string;
  category: string;
  sub: string;
  unit: string;
  price: number;
  soldout: boolean;
  photo: string;
  taxType?: "taxable" | "exempt";
  warehouseZone?: string;
  description?: string;
  servingsPerUnit?: string;
  boxContents?: string;
  servingsPerBox?: string;
  storageMethod?: string;
  priceListVisible?: boolean;
  priceDisplayMode?: "fixed" | "market" | "inquiry";
  /** 숨김: 거래처 화면·단가표에 보이지 않음 (관리자에서만 보임) */
  hidden?: boolean;
  /** 행사가격 (대표 가격, 원). 없으면 null */
  promoPrice?: number | null;
  packOptions: PackOption[];
};

export type CustomerSummary = {
  id: string;
  code: string;
  name: string;
  phone: string;
  businessNumber: string;
  address: string;
  storePhone: string;
  region: string;
  priceGroup: "A" | "B";
  active: boolean;
  receivable?: number;
  loginName?: string;
};

export type OrderSettings = {
  enabled: boolean;
  open24h: boolean;
  openTime: string;
  closeTime: string;
  editMinutes: number;
  cancelMinutes: number;
};

export type StoreData = {
  products: Product[];
  categories: Record<string, string[]>;
  /** 카테고리별 대표 사진 URL (없으면 빈 값) */
  categoryImages: Record<string, string>;
  promoCategory: string;
  sms: string;
  heroImage: string;
  heroKicker: string;
  heroTitle: string;
  heroDescription: string;
  admin: boolean;
  version: number;
  orderSettings: OrderSettings;
};

export function db(): D1Database {
  const value = bindings().DB;
  if (!value) throw new Error("Database is not configured");
  return value;
}

async function ensureColumn(database: D1Database, table: string, column: string, definition: string) {
  const rows = await database.prepare(`PRAGMA table_info(${table})`).all();
  const exists = (rows.results as Array<Record<string, unknown>>).some((row) => String(row.name) === column);
  if (!exists) await database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

let schemaReady = false;

async function ensureOperationsSchema(database: D1Database) {
  await ensureColumn(database, "orders", "delivery_date", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(database, "orders", "created_by_staff_id", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(database, "orders", "created_by_staff_name", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(database, "orders", "is_additional", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn(database, "orders", "order_period", "TEXT NOT NULL DEFAULT 'AM'");
  await ensureColumn(database, "orders", "load_printed_at", "TEXT NOT NULL DEFAULT ''");

  await database.exec("CREATE TABLE IF NOT EXISTS staff_users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('ADMIN','DRIVER')), auth_salt TEXT NOT NULL, auth_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))");
  await database.exec("CREATE TABLE IF NOT EXISTS staff_sessions (token_hash TEXT PRIMARY KEY, staff_id TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), last_seen_at TEXT NOT NULL DEFAULT (datetime('now')), FOREIGN KEY(staff_id) REFERENCES staff_users(id) ON DELETE CASCADE)");
  await database.exec("CREATE INDEX IF NOT EXISTS idx_staff_sessions_staff ON staff_sessions(staff_id, expires_at)");

  await database.exec("CREATE TABLE IF NOT EXISTS customer_users (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, auth_salt TEXT NOT NULL, auth_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE CASCADE)");
  await database.exec("CREATE INDEX IF NOT EXISTS idx_customer_users_customer ON customer_users(customer_id, active, display_name)");
  const duplicateCustomerUsername = await database.prepare(
    "SELECT lower(username) AS username FROM customer_users GROUP BY lower(username) HAVING COUNT(*) > 1 LIMIT 1",
  ).first();
  if (!duplicateCustomerUsername) {
    await database.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_users_username_unique ON customer_users(username COLLATE NOCASE)");
  } else {
    // 기존 데이터에 중복이 있더라도 서비스 전체가 멈추지는 않게 하고, 로그인 단계에서 중복을 차단합니다.
    await database.exec("CREATE INDEX IF NOT EXISTS idx_customer_users_username_lookup ON customer_users(username COLLATE NOCASE)");
  }
  await ensureColumn(database, "customer_sessions", "customer_user_id", "TEXT NOT NULL DEFAULT ''");

  await database.exec("CREATE TABLE IF NOT EXISTS audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_type TEXT NOT NULL DEFAULT 'system', actor_id TEXT NOT NULL DEFAULT '', actor_name TEXT NOT NULL DEFAULT '', action TEXT NOT NULL, entity_type TEXT NOT NULL DEFAULT '', entity_id TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT (datetime('now')))");
  await database.exec("CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC, id DESC)");
  await database.exec("CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id, created_at DESC)");

  await database.exec("CREATE TABLE IF NOT EXISTS suppliers (id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', category_note TEXT NOT NULL DEFAULT '', order_cutoff TEXT NOT NULL DEFAULT '', memo TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))");
  await database.exec("CREATE INDEX IF NOT EXISTS idx_suppliers_sort ON suppliers(active, sort_order, name)");

  await database.exec("CREATE TABLE IF NOT EXISTS order_adjustments (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL, order_item_id INTEGER NOT NULL, adjustment_type TEXT NOT NULL CHECK(adjustment_type IN ('return','missing')), quantity REAL NOT NULL, amount INTEGER NOT NULL, actor_type TEXT NOT NULL DEFAULT 'admin', actor_id TEXT NOT NULL DEFAULT '', actor_name TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')), FOREIGN KEY(order_id) REFERENCES orders(id), FOREIGN KEY(order_item_id) REFERENCES order_items(id))");
  await database.exec("CREATE INDEX IF NOT EXISTS idx_order_adjustments_order ON order_adjustments(order_id, created_at DESC)");

  const seeded = await database.prepare("SELECT id FROM staff_users LIMIT 1").first();
  if (!seeded) {
    await database.batch([
      database.prepare("INSERT INTO staff_users(id,username,display_name,role,auth_salt,auth_hash) VALUES(?,?,?,?,?,?)").bind("S-OWNER","owner","사장님","DRIVER","65214b472127bd9b43bec376b3d1be9e","bd51fe683bfd3d7bde2d96f251d6a1c0ea6a07936f7ed96113492432ef1f6019"),
      database.prepare("INSERT INTO staff_users(id,username,display_name,role,auth_salt,auth_hash) VALUES(?,?,?,?,?,?)").bind("S-CHA","cha","채한옥 실장","DRIVER","6e917fbf0bf8897284ebea8bbab46cd9","584b1731cd674b1681dc63994fd0b1c3aa04308d6e38e9865715fc8356d9f1b4"),
      database.prepare("INSERT INTO staff_users(id,username,display_name,role,auth_salt,auth_hash) VALUES(?,?,?,?,?,?)").bind("S-AN","an","안상진 부장","DRIVER","8bed94e715b2bb2ca5a35cd57dcf76cf","7b488aa7c04fee8fb7c7d5d7fded45f32e464618fa4fb801a057b454bc1d5dee"),
      database.prepare("INSERT INTO staff_users(id,username,display_name,role,auth_salt,auth_hash) VALUES(?,?,?,?,?,?)").bind("S-MINSU","minsu","김민수 과장","DRIVER","8a76a1f879ea3b1ca326bb5d77a35072","9d1c97eb9239562708401117c2e82ec944d9899c8d3308040184ee6ec08bd1cd"),
      database.prepare("INSERT INTO staff_users(id,username,display_name,role,auth_salt,auth_hash) VALUES(?,?,?,?,?,?)").bind("S-JANG","jang","장윤진 기사","DRIVER","6f24cf853d724572aa44148d3219015c","c7195ee07f241055376a77a2e54561f8fc2c2255456fcb18969015164f64279c"),
      database.prepare("INSERT INTO staff_users(id,username,display_name,role,auth_salt,auth_hash) VALUES(?,?,?,?,?,?)").bind("S-LEE","lee","이혜선 대리님","ADMIN","099c14c103deafe56f3a4031aeb5681b","47444c75236720e86adcd3438fde0d6d2923e5fd98d9096c6b8b1140d0b2dca7"),
      database.prepare("INSERT INTO staff_users(id,username,display_name,role,auth_salt,auth_hash) VALUES(?,?,?,?,?,?)").bind("S-JUNG","jung","정승영 주임님","ADMIN","b6206057321bb7ba5bc11c6fab1d35f3","8edf4d410de5530db8f75247740d470acc69b80cccde98757eff8674d3cbc4df"),
      database.prepare("INSERT INTO staff_users(id,username,display_name,role,auth_salt,auth_hash) VALUES(?,?,?,?,?,?)").bind("S-MADAM","madam","사모님","ADMIN","a1451ba10afa85a316c7ea6cf9da2289","f0f84d536d0589eb67baca0dd7c5e2e9cadd81d4b41e1bbc379507ac9dcf5777")
    ]);
  }
}

export async function ensureDatabase(database: D1Database = db()) {
  if (schemaReady) return;
  const ready = await database
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='products'")
    .first();
  if (!ready) await database.exec(migrationSql);

  const erpReady = await database
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='customers'")
    .first();
  if (!erpReady) await database.exec(erpMigrationSql);
  await ensureColumn(database, "products", "tax_type", "TEXT NOT NULL DEFAULT 'taxable'");
  await ensureColumn(database, "products", "warehouse_zone", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(database, "products", "description", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(database, "products", "servings_per_unit", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(database, "products", "box_contents", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(database, "products", "servings_per_box", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(database, "products", "storage_method", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(database, "products", "price_list_visible", "INTEGER NOT NULL DEFAULT 1");
  await ensureColumn(database, "products", "price_display_mode", "TEXT NOT NULL DEFAULT 'fixed'");
  await ensureColumn(database, "products", "hidden", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn(database, "products", "promo_price", "INTEGER");
  await ensureColumn(database, "categories", "image", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(database, "pack_options", "price_a", "INTEGER");
  await ensureColumn(database, "pack_options", "price_b", "INTEGER");
  await ensureColumn(database, "pack_options", "spec", "TEXT NOT NULL DEFAULT ''");
  await ensureOperationsSchema(database);

  const excelCatalogImported = await database
    .prepare("SELECT value FROM app_settings WHERE key = 'excel_catalog_import_v1'")
    .first<{ value: string }>();
  if (!excelCatalogImported) {
    try {
      await importExcelCatalog(database);
    } catch (error) {
      console.error("Excel catalog import failed", error);
    }
  }

  const excelCatalogClassificationFixed = await database
    .prepare("SELECT value FROM app_settings WHERE key = 'excel_catalog_classification_fix_v1'")
    .first<{ value: string }>();
  if (!excelCatalogClassificationFixed) {
    await database.batch([
      database.prepare("UPDATE products SET category='냉동수산', sub='생선' WHERE id='ERP-31928'"),
      database.prepare("UPDATE products SET category='냉동축산', sub='소고기' WHERE id='ERP-32802'"),
      database.prepare("UPDATE products SET category='냉동축산', sub='돼지고기' WHERE id='ERP-32690'"),
      database.prepare("UPDATE products SET category='냉동수산', sub='젓갈·알류' WHERE id='ERP-32477'"),
      database.prepare("UPDATE products SET category='냉동수산', sub='젓갈·알류' WHERE id='ERP-32472'"),
      database.prepare("UPDATE products SET category='냉동수산', sub='생선' WHERE id='ERP-31928'"),
      database.prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('excel_catalog_classification_fix_v1','1')"),
    ]);
  }

  const excelCatalogClassificationFixed2 = await database
    .prepare("SELECT value FROM app_settings WHERE key = 'excel_catalog_classification_fix_v2'")
    .first<{ value: string }>();
  if (!excelCatalogClassificationFixed2) {
    await database.batch([
      database.prepare("UPDATE products SET category='냉동수산', sub='생선' WHERE id='ERP-33004'"),
      database.prepare("UPDATE products SET category='냉동식품', sub='떡·간편식' WHERE id IN ('ERP-30215','ERP-30084','ERP-30636','ERP-30622','ERP-30639')"),
      database.prepare("UPDATE products SET category='신선식품', sub='두부·묵' WHERE id='ERP-32174'"),
      database.prepare("UPDATE products SET category='냉동축산', sub='돼지고기' WHERE id='ERP-32354'"),
      database.prepare("UPDATE products SET category='공산품', sub='음료·차·잼' WHERE id IN ('ERP-30597','ERP-33013')"),
      database.prepare("UPDATE products SET category='냉동식품', sub='튀김·가스' WHERE id IN ('ERP-33011','ERP-30057','ERP-30056','ERP-31964','ERP-32775','ERP-31966','ERP-32786')"),
      database.prepare("UPDATE products SET category='신선식품', sub='반찬·절임' WHERE id IN ('ERP-9013','ERP-9014','ERP-9028','ERP-31721')"),
      database.prepare("UPDATE products SET category='공산품', sub='기타 공산품' WHERE id IN ('ERP-32969','ERP-32878','ERP-31687','ERP-8048')"),
      database.prepare("UPDATE products SET category='공산품', sub='통조림' WHERE id IN ('ERP-8063','ERP-31030')"),
      database.prepare("UPDATE products SET category='공산품', sub='면·스파게티' WHERE id='ERP-31323'"),
      database.prepare("UPDATE products SET category='공산품', sub='소스·드레싱' WHERE id='ERP-32294'"),
      database.prepare("UPDATE products SET category='공산품', sub='분말·양념' WHERE id='ERP-30690'"),
      database.prepare("UPDATE products SET category='냉동수산', sub='젓갈·알류' WHERE id='ERP-9012'"),
      database.prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('excel_catalog_classification_fix_v2','1')"),
    ]);
  }

  const singleAdminSeeded = await database
    .prepare("SELECT value FROM app_settings WHERE key = 'single_admin_login_v1'")
    .first<{ value: string }>();
  if (!singleAdminSeeded) {
    await database.batch([
      database.prepare("DELETE FROM admin_sessions"),
      database.prepare("DELETE FROM staff_sessions WHERE staff_id IN (SELECT id FROM staff_users WHERE role='ADMIN')"),
      database.prepare("DELETE FROM staff_users WHERE role='ADMIN'"),
      database.prepare("INSERT OR REPLACE INTO admin_credentials (id, salt, hash) VALUES (1, ?, ?)").bind(
        "bujadmin20261023",
        "d037839d879bf478ecde1e4d8eacca623e6f94f2c50d3bf0e50f1c91d3a4e7b0",
      ),
      database.prepare("DELETE FROM app_settings WHERE key = 'bootstrap_key'"),
      database.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('single_admin_login_v1', '1')"),
    ]);
  }

  const demoSeeded = await database
    .prepare("SELECT value FROM app_settings WHERE key = 'demo_customer_seeded'")
    .first<{ value: string }>();
  if (!demoSeeded) {
    await database.batch([
      database.prepare(`
        INSERT OR IGNORE INTO customers
          (id, code, name, phone, business_number, address, store_phone, region, price_group, auth_salt, auth_hash, active)
        VALUES
          ('C-DEMO-001', 'TEST-01', '테스트식당', '', '', '테스트용 거래처', '', '1단지', 'A', ?, ?, 1)
      `).bind(
        "b3e4136af443d765d26815d6c5979e3b",
        "86675eeae56d8a50cc8b1de885b489b2eac516281c147880f2cb9e6490b4a458",
      ),
      database.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('demo_customer_seeded', '1')"),
    ]);
  }

  const temporary = await database
    .prepare("SELECT hash FROM admin_credentials WHERE id = 1")
    .first<{ hash: string }>();
  if (temporary?.hash === "feec86898d5d72f592cfe375e965b00acbcf1ed49b3f8c102980df331833d462") {
    await database.batch([
      database.prepare("DELETE FROM admin_sessions"),
      database.prepare("DELETE FROM admin_credentials WHERE id = 1"),
      database
        .prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('bootstrap_key', ?)")
        .bind("efd90651ff15762beb4a9416f6fc83c8"),
    ]);
  }

  schemaReady = true;
}

function boolSetting(settings: Record<string, string>, key: string, fallback: boolean) {
  if (!(key in settings)) return fallback;
  return settings[key] === "1";
}

export async function readStore(_priceGroup?: "A" | "B", options: { includeHidden?: boolean } = {}): Promise<StoreData> {
  const database = db();
  await ensureDatabase(database);
  const [categoryRows, subRows, productRows, optionRows, settingsRows] = await Promise.all([
    database.prepare("SELECT name, sort_order, is_promo, image FROM categories ORDER BY sort_order, name").all(),
    database.prepare("SELECT category_name, name, sort_order FROM subcategories ORDER BY category_name, sort_order, name").all(),
    database.prepare("SELECT id, name, category, sub, unit, price, soldout, photo, sort_order, tax_type, warehouse_zone, description, servings_per_unit, box_contents, servings_per_box, storage_method, price_list_visible, price_display_mode, hidden, promo_price FROM products ORDER BY sort_order, name").all(),
    database.prepare("SELECT product_id, label, spec, price, price_a, price_b, step, sort_order FROM pack_options ORDER BY product_id, sort_order, id").all(),
    database.prepare("SELECT key, value FROM app_settings").all(),
  ]);

  const categories: Record<string, string[]> = {};
  const categoryImages: Record<string, string> = {};
  for (const row of categoryRows.results as Array<Record<string, unknown>>) {
    categories[String(row.name)] = [];
    categoryImages[String(row.name)] = String(row.image ?? "");
  }
  for (const row of subRows.results as Array<Record<string, unknown>>) {
    const category = String(row.category_name);
    if (!categories[category]) categories[category] = [];
    categories[category].push(String(row.name));
  }

  const optionsByProduct = new Map<string, PackOption[]>();
  for (const row of optionRows.results as Array<Record<string, unknown>>) {
    const id = String(row.product_id);
    const base = row.price == null ? null : Number(row.price);
    const list = optionsByProduct.get(id) ?? [];
    list.push({
      label: String(row.label),
      spec: String(row.spec ?? ""),
      price: base,
      step: Number(row.step ?? 1),
    });
    optionsByProduct.set(id, list);
  }

  const settings = Object.fromEntries(
    (settingsRows.results as Array<Record<string, unknown>>).map((row) => [String(row.key), String(row.value)]),
  );

  const productList = (productRows.results as Array<Record<string, unknown>>)
    .filter((row) => options.includeHidden || Number(row.hidden ?? 0) !== 1);
  const products: Product[] = productList.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    category: String(row.category),
    sub: String(row.sub),
    unit: String(row.unit),
    price: Number(row.price ?? 0),
    soldout: Number(row.soldout ?? 0) === 1,
    photo: String(row.photo ?? ""),
    taxType: String(row.tax_type ?? "taxable") === "exempt" ? "exempt" : "taxable",
    warehouseZone: String(row.warehouse_zone ?? ""),
    description: String(row.description ?? ""),
    servingsPerUnit: String(row.servings_per_unit ?? ""),
    boxContents: String(row.box_contents ?? ""),
    servingsPerBox: String(row.servings_per_box ?? ""),
    storageMethod: String(row.storage_method ?? ""),
    priceListVisible: Number(row.price_list_visible ?? 1) === 1,
    priceDisplayMode: String(row.price_display_mode ?? "fixed") === "market" ? "market" : String(row.price_display_mode ?? "fixed") === "inquiry" ? "inquiry" : "fixed",
    hidden: Number(row.hidden ?? 0) === 1,
    promoPrice: row.promo_price == null ? null : Number(row.promo_price),
    packOptions: optionsByProduct.get(String(row.id)) ?? [],
  }));

  const promoFromTable = (categoryRows.results as Array<Record<string, unknown>>).find(
    (row) => Number(row.is_promo ?? 0) === 1,
  );

  return {
    products,
    categories,
    categoryImages,
    promoCategory: settings.promoCategory || String(promoFromTable?.name ?? ""),
    sms: settings.sms || "",
    heroImage: settings.heroImage || "",
    heroKicker: settings.heroKicker || "프리미엄 식자재몰",
    heroTitle: settings.heroTitle || "좋은 식재료가\n사장님의 경쟁력입니다.",
    heroDescription: settings.heroDescription || "신선한 식재료를 더 빠르고,\n더 편리하게 주문하세요.",
    admin: false,
    version: Number(settings.version || 1),
    orderSettings: {
      enabled: boolSetting(settings, "orderEnabled", true),
      open24h: boolSetting(settings, "order24h", true),
      openTime: settings.orderOpenTime || "00:00",
      closeTime: settings.orderCloseTime || "23:59",
      editMinutes: Number(settings.editMinutes || 15),
      cancelMinutes: Number(settings.cancelMinutes || 15),
    },
  };
}

export async function bumpVersion(database = db()) {
  await database
    .prepare("UPDATE app_settings SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'version'")
    .run();
}
