import type { D1Database } from "@cloudflare/workers-types";
import { bindings } from "./bindings.server";
import migrationSql from "../../migrations/0001_init.sql?raw";
import erpMigrationSql from "../../migrations/0002_erp.sql?raw";

export type PackOption = {
  label: string;
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
  promoCategory: string;
  sms: string;
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
  await ensureColumn(database, "pack_options", "price_a", "INTEGER");
  await ensureColumn(database, "pack_options", "price_b", "INTEGER");

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

export async function readStore(priceGroup?: "A" | "B"): Promise<StoreData> {
  const database = db();
  await ensureDatabase(database);
  const [categoryRows, subRows, productRows, optionRows, settingsRows] = await Promise.all([
    database.prepare("SELECT name, sort_order, is_promo FROM categories ORDER BY sort_order, name").all(),
    database.prepare("SELECT category_name, name, sort_order FROM subcategories ORDER BY category_name, sort_order, name").all(),
    database.prepare("SELECT id, name, category, sub, unit, price, soldout, photo, sort_order, tax_type, warehouse_zone FROM products ORDER BY sort_order, name").all(),
    database.prepare("SELECT product_id, label, price, price_a, price_b, step, sort_order FROM pack_options ORDER BY product_id, sort_order, id").all(),
    database.prepare("SELECT key, value FROM app_settings").all(),
  ]);

  const categories: Record<string, string[]> = {};
  for (const row of categoryRows.results as Array<Record<string, unknown>>) categories[String(row.name)] = [];
  for (const row of subRows.results as Array<Record<string, unknown>>) {
    const category = String(row.category_name);
    if (!categories[category]) categories[category] = [];
    categories[category].push(String(row.name));
  }

  const optionsByProduct = new Map<string, PackOption[]>();
  for (const row of optionRows.results as Array<Record<string, unknown>>) {
    const id = String(row.product_id);
    const base = row.price == null ? null : Number(row.price);
    const a = row.price_a == null ? null : Number(row.price_a);
    const b = row.price_b == null ? null : Number(row.price_b);
    const visiblePrice = priceGroup === "A" ? (a ?? base) : priceGroup === "B" ? (b ?? base) : base;
    const list = optionsByProduct.get(id) ?? [];
    list.push({
      label: String(row.label),
      price: visiblePrice,
      priceA: a,
      priceB: b,
      step: Number(row.step ?? 1),
    });
    optionsByProduct.set(id, list);
  }

  const settings = Object.fromEntries(
    (settingsRows.results as Array<Record<string, unknown>>).map((row) => [String(row.key), String(row.value)]),
  );

  const products: Product[] = (productRows.results as Array<Record<string, unknown>>).map((row) => ({
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
    packOptions: optionsByProduct.get(String(row.id)) ?? [],
  }));

  const promoFromTable = (categoryRows.results as Array<Record<string, unknown>>).find(
    (row) => Number(row.is_promo ?? 0) === 1,
  );

  return {
    products,
    categories,
    promoCategory: settings.promoCategory || String(promoFromTable?.name ?? ""),
    sms: settings.sms || "",
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
