import type { D1Database } from "@cloudflare/workers-types";
import { bindings } from "./bindings.server";

export type PackOption = {
  label: string;
  price: number | null;
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
  packOptions: PackOption[];
};

export type StoreData = {
  products: Product[];
  categories: Record<string, string[]>;
  promoCategory: string;
  sms: string;
  admin: boolean;
  version: number;
};

export function db(): D1Database {
  const value = bindings().DB;
  if (!value) throw new Error("Database is not configured");
  return value;
}

export async function readStore(): Promise<StoreData> {
  const database = db();
  const [categoryRows, subRows, productRows, optionRows, settingsRows] = await Promise.all([
    database.prepare("SELECT name, sort_order, is_promo FROM categories ORDER BY sort_order, name").all(),
    database.prepare("SELECT category_name, name, sort_order FROM subcategories ORDER BY category_name, sort_order, name").all(),
    database.prepare("SELECT id, name, category, sub, unit, price, soldout, photo, sort_order FROM products ORDER BY sort_order, name").all(),
    database.prepare("SELECT product_id, label, price, step, sort_order FROM pack_options ORDER BY product_id, sort_order, id").all(),
    database.prepare("SELECT key, value FROM app_settings").all(),
  ]);

  const categories: Record<string, string[]> = {};
  for (const row of categoryRows.results as Array<Record<string, unknown>>) {
    categories[String(row.name)] = [];
  }
  for (const row of subRows.results as Array<Record<string, unknown>>) {
    const category = String(row.category_name);
    if (!categories[category]) categories[category] = [];
    categories[category].push(String(row.name));
  }

  const optionsByProduct = new Map<string, PackOption[]>();
  for (const row of optionRows.results as Array<Record<string, unknown>>) {
    const id = String(row.product_id);
    const list = optionsByProduct.get(id) ?? [];
    list.push({
      label: String(row.label),
      price: row.price == null ? null : Number(row.price),
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
  };
}

export async function bumpVersion(database = db()) {
  await database
    .prepare("UPDATE app_settings SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'version'")
    .run();
}
