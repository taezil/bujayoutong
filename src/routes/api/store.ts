import { createFileRoute } from "@tanstack/react-router";
import { getCustomer, isAdmin } from "../../lib/auth.server";
import { db, ensureDatabase, readStore } from "../../lib/db.server";
import { bindings } from "../../lib/bindings.server";
import { CATALOG_SQL_CHUNKS } from "../../catalog-sql.generated";
import { SAFE_CATALOG_PHOTOS } from "../../catalog-photo-safe.generated";



type PhotoImportEntry = { key: string; sourceUrl: string; productIds: string[] };

const PHOTO_IMPORT_GZIP_BASE64 = "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";
let photoManifestPromise: Promise<PhotoImportEntry[]> | null = null;

async function readPhotoManifest() {
  if (!photoManifestPromise) {
    photoManifestPromise = (async () => {
      const compressed = Uint8Array.from(atob(PHOTO_IMPORT_GZIP_BASE64), (char) => char.charCodeAt(0));
      const body = new Response(compressed).body;
      if (!body) throw new Error("Photo manifest could not be read");
      const json = await new Response(body.pipeThrough(new DecompressionStream("gzip"))).text();
      const parsed = JSON.parse(json) as PhotoImportEntry[];
      const replacementSources: Record<number, string> = {
        50: "https://fastmall.co.kr/web/product/small/202509/71dfd22915cc30bf857a281c62cc3f16.jpg",
        61: "https://asset.m-gs.kr/prod/1046672367/1/550",
        93: "https://sehyeon.s3.us-east-2.amazonaws.com/010714.jpg",
      };
      for (const [rawIndex, sourceUrl] of Object.entries(replacementSources)) {
        const entry = parsed[Number(rawIndex)];
        if (entry) entry.sourceUrl = sourceUrl;
      }
      return parsed;
    })();
  }
  return photoManifestPromise;
}

async function importPhotoEntry(entry: PhotoImportEntry) {
  const database = db();
  const storage = bindings().STORAGE;
  if (!storage) throw new Error("R2 storage binding unavailable");

  let object = await storage.head(entry.key);
  let transformed = false;
  let contentType = "image/webp";

  if (!object) {
    let response: Response | null = null;
    try {
      response = await fetch(entry.sourceUrl, {
        headers: {
          "Accept": "image/webp,image/*,*/*;q=0.8",
          "User-Agent": "Mozilla/5.0 (compatible; BujaFoodCatalog/1.0)",
        },
        cf: {
          image: {
            width: 1200,
            height: 1200,
            fit: "pad",
            background: "#ffffff",
            format: "webp",
            quality: 85,
            metadata: "none",
          },
        },
      } as any);
      transformed = response.ok && (response.headers.get("content-type") || "").includes("image/webp");
    } catch {
      response = null;
    }

    if (!response?.ok || !(response.headers.get("content-type") || "").startsWith("image/")) {
      response = await fetch(entry.sourceUrl, {
        headers: {
          "Accept": "image/*,*/*;q=0.8",
          "User-Agent": "Mozilla/5.0 (compatible; BujaFoodCatalog/1.0)",
        },
        redirect: "follow",
      });
      transformed = false;
    }

    if (!response.ok) throw new Error(`upstream ${response.status}`);
    contentType = response.headers.get("content-type")?.split(";")[0] || "image/jpeg";
    if (!contentType.startsWith("image/")) throw new Error(`not an image: ${contentType}`);
    const bytes = await response.arrayBuffer();
    if (!bytes.byteLength) throw new Error("empty image");
    if (bytes.byteLength > 20 * 1024 * 1024) throw new Error("image too large");

    await storage.put(entry.key, bytes, {
      httpMetadata: {
        contentType: transformed ? "image/webp" : contentType,
        cacheControl: "public, max-age=31536000, immutable",
      },
      customMetadata: {
        source: entry.sourceUrl.slice(0, 900),
        transformed: transformed ? "webp-1200-pad" : "original-fallback",
      },
    });
    object = await storage.head(entry.key);
  } else {
    transformed = object.httpMetadata?.contentType === "image/webp";
    contentType = object.httpMetadata?.contentType || "application/octet-stream";
  }

  if (!object) throw new Error("R2 write failed");
  const photoUrl = `/api/photo?id=${entry.key}`;
  await database.batch(
    entry.productIds.map((id) =>
      database.prepare("UPDATE products SET photo=? WHERE id=?").bind(photoUrl, id),
    ),
  );

  return { products: entry.productIds.length, transformed, contentType };
}

async function runPhotoImport(retryOnly = false) {
  const database = db();
  const manifest = await readPhotoManifest();
  const indexRow = await database
    .prepare("SELECT value FROM app_settings WHERE key='photo_import_v1_index'")
    .first<{ value: string }>();
  const failuresRow = await database
    .prepare("SELECT value FROM app_settings WHERE key='photo_import_v1_failures'")
    .first<{ value: string }>();

  let index = Math.max(0, Number(indexRow?.value || 0) || 0);
  const failures = new Set<number>(
    (failuresRow?.value || "")
      .split(",")
      .map((v) => Number(v))
      .filter((v) => Number.isInteger(v) && v >= 0 && v < manifest.length),
  );

  const batchSize = 8;
  const indexes = retryOnly
    ? [...failures].slice(0, batchSize)
    : Array.from({ length: Math.min(batchSize, manifest.length - index) }, (_, offset) => index + offset);

  const results = await Promise.all(indexes.map(async (entryIndex) => {
    try {
      const result = await importPhotoEntry(manifest[entryIndex]);
      failures.delete(entryIndex);
      return { index: entryIndex, ok: true, ...result };
    } catch (error) {
      failures.add(entryIndex);
      return {
        index: entryIndex,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }));

  if (!retryOnly && indexes.length) index = indexes[indexes.length - 1] + 1;

  await database.batch([
    database
      .prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('photo_import_v1_index',?)")
      .bind(String(index)),
    database
      .prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('photo_import_v1_failures',?)")
      .bind([...failures].sort((a, b) => a - b).join(",")),
    database
      .prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('photo_import_v1_done',?)")
      .bind(index >= manifest.length && failures.size === 0 ? "1" : "0"),
  ]);

  const linked = await database
    .prepare("SELECT COUNT(*) AS count FROM products WHERE id LIKE 'ERP-%' AND photo LIKE '/api/photo?id=catalog-%'")
    .first<{ count: number }>();

  return {
    totalSources: manifest.length,
    sourceIndex: index,
    remainingSources: Math.max(0, manifest.length - index),
    failures: [...failures].sort((a, b) => a - b),
    failedCount: failures.size,
    linkedProducts: Number(linked?.count ?? 0),
    results,
    done: index >= manifest.length && failures.size === 0,
  };
}

async function photoImportStatus() {
  const database = db();
  const manifest = await readPhotoManifest();
  const [indexRow, failuresRow, doneRow, linked, productRows] = await Promise.all([
    database.prepare("SELECT value FROM app_settings WHERE key='photo_import_v1_index'").first<{ value: string }>(),
    database.prepare("SELECT value FROM app_settings WHERE key='photo_import_v1_failures'").first<{ value: string }>(),
    database.prepare("SELECT value FROM app_settings WHERE key='photo_import_v1_done'").first<{ value: string }>(),
    database.prepare("SELECT COUNT(*) AS count FROM products WHERE id LIKE 'ERP-%' AND photo LIKE '/api/photo?id=catalog-%'").first<{ count: number }>(),
    database.prepare("SELECT id, name, photo FROM products WHERE id LIKE 'ERP-%'").all(),
  ]);
  const index = Number(indexRow?.value || 0) || 0;
  const failures = (failuresRow?.value || "").split(",").filter(Boolean);
  const productById = new Map(
    (productRows.results as Array<Record<string, unknown>>).map((row) => [
      String(row.id),
      { name: String(row.name ?? ""), photo: String(row.photo ?? "") },
    ]),
  );
  const targetIds = [...new Set(manifest.flatMap((entry) => entry.productIds))];
  const expectedById = new Map(
    manifest.flatMap((entry) => entry.productIds.map((id) => [id, `/api/photo?id=${entry.key}`] as const)),
  );
  const unlinkedProducts = targetIds.filter((id) => !productById.get(id)?.photo.startsWith("/api/photo?id=catalog-"));
  const unlinkedDetails = unlinkedProducts.map((id) => ({
    id,
    exists: productById.has(id),
    name: productById.get(id)?.name ?? "",
    photo: productById.get(id)?.photo ?? "",
    expected: expectedById.get(id) ?? "",
  }));

  const expectedCatalogIds = new Set<string>();
  for (const sql of CATALOG_SQL_CHUNKS) {
    if (!/^INSERT\s+(?:OR\s+REPLACE\s+)?INTO\s+products\b/i.test(sql.trimStart())) continue;
    for (const match of sql.matchAll(/\('(ERP-[^']+)'/g)) {
      const id = match[1];
      if (id) expectedCatalogIds.add(id);
    }
  }
  const liveErpIds = new Set(
    (productRows.results as Array<Record<string, unknown>>).map((row) => String(row.id)),
  );
  const catalogMissing = [...expectedCatalogIds].filter((id) => !liveErpIds.has(id));
  const catalogUnexpected = [...liveErpIds].filter((id) => !expectedCatalogIds.has(id));

  return {
    totalSources: manifest.length,
    sourceIndex: index,
    remainingSources: Math.max(0, manifest.length - index),
    failedCount: failures.length,
    failures,
    linkedProducts: Number(linked?.count ?? 0),
    targetProducts: targetIds.length,
    unlinkedProducts,
    unlinkedDetails,
    originalCatalogExpected: expectedCatalogIds.size,
    liveErpProducts: liveErpIds.size,
    catalogMissing,
    catalogUnexpected,
    done: doneRow?.value === "1",
  };
}

async function searchCatalogImageCandidates(query: string) {
  const searchUrl = "https://www.bing.com/images/search?q=" + encodeURIComponent(query) + "&form=HDRSC3&first=1";
  const response = await fetch(searchUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/156 Safari/537.36",
      "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.5",
    },
    redirect: "follow",
  });
  const html = await response.text();
  const candidates: Array<{ url: string; title: string }> = [];
  const seen = new Set<string>();

  const decoded = html
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

  for (const match of decoded.matchAll(/"murl":"([^"]+)"[^}]*"t":"([^"]*)"/g)) {
    const url = match[1]?.replaceAll("\\u002f", "/").replaceAll("\\/", "/");
    const title = match[2] || "";
    if (url?.startsWith("http") && !seen.has(url)) {
      seen.add(url);
      candidates.push({ url, title });
      if (candidates.length >= 12) break;
    }
  }
  if (!candidates.length) {
    for (const match of decoded.matchAll(/"murl":"([^"]+)"/g)) {
      const url = match[1]?.replaceAll("\\u002f", "/").replaceAll("\\/", "/");
      if (url?.startsWith("http") && !seen.has(url)) {
        seen.add(url);
        candidates.push({ url, title: "" });
        if (candidates.length >= 12) break;
      }
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    htmlLength: html.length,
    candidates,
  };
}


const PHOTO_AUTOFILL_TOKEN = "buja-photo-20261025-f6e3d9a4";
const PHOTO_MATCH_TERMS = [
  "김치왕만두","고기왕만두","군만두","교자만두","야끼만두","동그랑땡","새우튀김","오징어튀김",
  "치킨까스","돈까스","꿔바로우","탕수육","고로케","감자떡","꿀떡","절편","웨지감자","어묵","순대",
  "런천미트","갈치","고등어","조기","민어","가자미","아귀","낙지","문어","오징어","쭈꾸미","새우",
  "골뱅이","해파리","젓갈","김가루","김밥김","다시마","미역줄기","미역","진미채","북어채","명엽채",
  "쥐어채","가쓰오부시","표고버섯","목이버섯","멸치","갈비","등뼈","목뼈","민찌","제육","돼지머리",
  "우족","장각","닭도리","오리","두부","곤약","청포묵","메추리알","계란","버터","마가린","단무지",
  "우엉","땅콩조림","마늘쫑","무말랭이","무쌈","피클","진간장","국간장","간장","식초","된장","쌈장",
  "청국장","고추장","춘장","당면","칼국수","막국수","스파게티","쫄면","국수","냉면","소스","육수",
  "장국","액젓","마요네즈","케찹","드레싱","다시다","설탕","전분","소금","후추","파인애플","황도",
  "후르츠칵테일","참깨","흑미","찰보리","라면","스프","커피","건포도","아몬드","도넛","꽈배기",
  "찐빵","꽃빵","세제","고무장갑","롤팩","비닐","크리너"
] as const;

function normalizeCatalogText(value: string) {
  return value.toLowerCase().replace(/[^0-9a-z가-힣]+/g, "");
}

function pickCatalogImageCandidate(name: string, candidates: Array<{ url: string; title: string }>) {
  if (!candidates.length) return null;
  const normalizedName = normalizeCatalogText(name.replace(/\([^)]*\)/g, " "));
  const terms = PHOTO_MATCH_TERMS.filter((term) => normalizedName.includes(normalizeCatalogText(term)));
  let best: { url: string; title: string; score: number } | null = null;

  for (const candidate of candidates) {
    const haystack = normalizeCatalogText(candidate.title + " " + candidate.url);
    let score = 0;
    if (normalizedName.length >= 3 && haystack.includes(normalizedName)) score += 1000;
    for (const term of terms) {
      const normalizedTerm = normalizeCatalogText(term);
      if (normalizedTerm && haystack.includes(normalizedTerm)) score += 50 + normalizedTerm.length;
    }
    if (/food|mart|mall|product|goods|shop|coupang|ssg|danawa|식자재|업소용/.test(candidate.title.toLowerCase() + " " + candidate.url.toLowerCase())) score += 4;
    if (!best || score > best.score) best = { ...candidate, score };
  }

  if (terms.length && (best?.score ?? 0) < 50) return null;
  return best;
}

async function catalogPhotoAutoFillStatus() {
  const database = db();
  const manifest = await readPhotoManifest();
  const targetIds = new Set(manifest.flatMap((entry) => entry.productIds));
  const [rows, skippedRow] = await Promise.all([
    database.prepare("SELECT id,name,category,sub,photo FROM products WHERE id LIKE 'ERP-%' ORDER BY sort_order,name").all(),
    database.prepare("SELECT value FROM app_settings WHERE key='photo_autofill_v1_skipped'").first<{ value: string }>(),
  ]);
  const targets = (rows.results as Array<Record<string, unknown>>).filter((row) => targetIds.has(String(row.id)));
  const withPhotos = targets.filter((row) => String(row.photo ?? "").trim()).length;
  const skipped = (skippedRow?.value || "").split(",").filter(Boolean);
  return {
    targetProducts: targets.length,
    withPhotos,
    blankProducts: targets.length - withPhotos,
    skippedCount: skipped.length,
    skipped,
  };
}

async function runCatalogPhotoAutoFill(limit = 8) {
  const database = db();
  const manifest = await readPhotoManifest();
  const targetIds = new Set(manifest.flatMap((entry) => entry.productIds));
  const [rows, skippedRow] = await Promise.all([
    database.prepare("SELECT id,name,category,sub,photo FROM products WHERE id LIKE 'ERP-%' ORDER BY sort_order,name").all(),
    database.prepare("SELECT value FROM app_settings WHERE key='photo_autofill_v1_skipped'").first<{ value: string }>(),
  ]);
  const skipped = new Set((skippedRow?.value || "").split(",").filter(Boolean));
  const targets = (rows.results as Array<Record<string, unknown>>)
    .filter((row) => targetIds.has(String(row.id)))
    .filter((row) => !String(row.photo ?? "").trim())
    .filter((row) => !skipped.has(String(row.id)))
    .slice(0, Math.max(1, Math.min(10, limit)));

  const results = await Promise.all(targets.map(async (row) => {
    const id = String(row.id);
    const name = String(row.name ?? "");
    const category = String(row.category ?? "");
    const sub = String(row.sub ?? "");
    const query = [name, sub, category, "업소용 대용량 식자재"].filter(Boolean).join(" ");
    try {
      const searched = await searchCatalogImageCandidates(query);
      const picked = pickCatalogImageCandidate(name, searched.candidates);
      if (!picked) throw new Error("matching image candidate not found");
      const key = `catalog-auto-${id.toLowerCase().replace(/[^a-z0-9-]/g, "")}.webp`;
      const imported = await importPhotoEntry({ key, sourceUrl: picked.url, productIds: [id] });
      return { id, name, ok: true, source: picked.url, title: picked.title, score: picked.score, ...imported };
    } catch (error) {
      skipped.add(id);
      return { id, name, ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }));

  await database
    .prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('photo_autofill_v1_skipped',?)")
    .bind([...skipped].join(","))
    .run();

  return {
    ...(await catalogPhotoAutoFillStatus()),
    processed: results.length,
    results,
  };
}

async function ensureCatalogImportV3() {
  const database = db();
  await ensureDatabase(database);

  const done = await database
    .prepare("SELECT value FROM app_settings WHERE key='excel_catalog_import_v3'")
    .first<{ value: string }>();
  if (done?.value !== "1") {
    try {
      for (const sql of CATALOG_SQL_CHUNKS) {
        if (!sql.trim()) continue;
        const normalized =
          /^INSERT\s+(?:OR\s+REPLACE\s+)?INTO\s+(?:products|pack_options)\b/i.test(sql.trimStart())
            ? sql.replace(/\n/g, " ")
            : sql;
        await database.exec(normalized);
      }
      await database.prepare("DELETE FROM app_settings WHERE key='excel_catalog_import_error'").run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Catalog v3 import failed", error);
      try {
        await database
          .prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('excel_catalog_import_error',?)")
          .bind(message.slice(0, 1000))
          .run();
      } catch {}
    }
  }

  const missingPhotoProducts = await database
    .prepare("SELECT id FROM products WHERE id IN ('ERP-31085','ERP-32576','ERP-31032','ERP-30544')")
    .all();
  const existingPhotoProductIds = new Set(
    (missingPhotoProducts.results as Array<Record<string, unknown>>).map((row) => String(row.id)),
  );
  if (existingPhotoProductIds.size < 4) {
    await database.batch([
      database.prepare("INSERT OR IGNORE INTO products (id,name,category,sub,unit,price,soldout,photo,sort_order,tax_type,warehouse_zone,description,servings_per_unit,box_contents,servings_per_box,storage_method,price_list_visible,price_display_mode,hidden,promo_price) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind("ERP-31085","갈비맛치킨꼬치","냉동식품","튀김·가스","0.5kg",0,0,"/api/photo?id=catalog-5b6813d8b08f39670d92.webp",1003,"taxable","","","","","","",1,"inquiry",0,null),
      database.prepare("INSERT OR IGNORE INTO products (id,name,category,sub,unit,price,soldout,photo,sort_order,tax_type,warehouse_zone,description,servings_per_unit,box_contents,servings_per_box,storage_method,price_list_visible,price_display_mode,hidden,promo_price) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind("ERP-32576","치즈돈까스 (면사랑)","냉동식품","튀김·가스","8kg",84000,0,"/api/photo?id=catalog-0e2dccd17b3c1e85728f.webp",1062,"taxable","","","","4","","",1,"fixed",0,null),
      database.prepare("INSERT OR IGNORE INTO products (id,name,category,sub,unit,price,soldout,photo,sort_order,tax_type,warehouse_zone,description,servings_per_unit,box_contents,servings_per_box,storage_method,price_list_visible,price_display_mode,hidden,promo_price) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind("ERP-31032","치킨너겟 (상도)","냉동식품","튀김·가스","10kg",49000,0,"/api/photo?id=catalog-2c99660f7797ecd82c01.webp",1067,"taxable","","","","10","","",1,"fixed",0,null),
      database.prepare("INSERT OR IGNORE INTO products (id,name,category,sub,unit,price,soldout,photo,sort_order,tax_type,warehouse_zone,description,servings_per_unit,box_contents,servings_per_box,storage_method,price_list_visible,price_display_mode,hidden,promo_price) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind("ERP-30544","치킨너겟(오양)","냉동식품","튀김·가스","10kg",59000,0,"/api/photo?id=catalog-47b62e79a081537bf0ae.webp",1070,"taxable","","","","10","","",1,"fixed",0,null),
    ]);
    await database.batch([
      database.prepare("INSERT INTO pack_options (product_id,label,spec,price,step,sort_order) SELECT ?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM pack_options WHERE product_id=?)")
        .bind("ERP-31085","봉지","0.5kg",null,1,0,"ERP-31085"),
      database.prepare("INSERT INTO pack_options (product_id,label,spec,price,step,sort_order) SELECT ?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM pack_options WHERE product_id=?)")
        .bind("ERP-32576","박스","8kg",84000,1,0,"ERP-32576"),
      database.prepare("INSERT INTO pack_options (product_id,label,spec,price,step,sort_order) SELECT ?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM pack_options WHERE product_id=?)")
        .bind("ERP-31032","박스","10kg",49000,1,0,"ERP-31032"),
      database.prepare("INSERT INTO pack_options (product_id,label,spec,price,step,sort_order) SELECT ?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM pack_options WHERE product_id=?)")
        .bind("ERP-30544","박스","10kg",59000,1,0,"ERP-30544"),
    ]);
  }

  await database.batch([
    database.prepare("UPDATE products SET photo=?, hidden=0, soldout=0, price_list_visible=1 WHERE id=?").bind("/api/photo?id=catalog-5b6813d8b08f39670d92.webp", "ERP-31085"),
    database.prepare("UPDATE products SET photo=?, hidden=0, soldout=0, price_list_visible=1 WHERE id=?").bind("/api/photo?id=catalog-0e2dccd17b3c1e85728f.webp", "ERP-32576"),
    database.prepare("UPDATE products SET photo=?, hidden=0, soldout=0, price_list_visible=1 WHERE id=?").bind("/api/photo?id=catalog-2c99660f7797ecd82c01.webp", "ERP-31032"),
    database.prepare("UPDATE products SET photo=?, hidden=0, soldout=0, price_list_visible=1 WHERE id=?").bind("/api/photo?id=catalog-47b62e79a081537bf0ae.webp", "ERP-30544"),
  ]);

  const photoPrecisionReset = await database
    .prepare("SELECT value FROM app_settings WHERE key='catalog_photo_precision_reset_v1'")
    .first<{ value: string }>();
  if (photoPrecisionReset?.value !== "1") {
    await database.batch([
      database.prepare(`UPDATE products
        SET photo=''
        WHERE id LIKE 'ERP-%'
          AND photo LIKE '/api/photo?id=catalog-%'
          AND id NOT IN ('ERP-30588','ERP-30579','ERP-32363','ERP-30365','ERP-30120','ERP-30024','ERP-32244','ERP-32374','ERP-32844','ERP-32845','ERP-32163','ERP-32401','ERP-30364','ERP-31032','ERP-32676','ERP-30544','ERP-32411','ERP-30352','ERP-30076','ERP-31039','ERP-30960','ERP-31019','ERP-32851','ERP-8097','ERP-32077','ERP-32072','ERP-32073','ERP-8047','ERP-8037','ERP-30369','ERP-32476','ERP-30234','ERP-31666')`),
      database.prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('catalog_photo_precision_reset_v1','1')"),
    ]);
  }

  const safePhotosRestored = await database
    .prepare("SELECT value FROM app_settings WHERE key='catalog_photo_safe_restore_v1'")
    .first<{ value: string }>();
  if (safePhotosRestored?.value !== "1") {
    const statements = SAFE_CATALOG_PHOTOS.map(([id, photo]) =>
      database.prepare("UPDATE products SET photo=? WHERE id=?").bind(photo, id),
    );
    for (let i = 0; i < statements.length; i += 80) {
      await database.batch(statements.slice(i, i + 80));
    }
    await database
      .prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('catalog_photo_safe_restore_v1','1')")
      .run();
  }

  const sellingFixed = await database
    .prepare("SELECT value FROM app_settings WHERE key='erp_products_selling_v1'")
    .first<{ value: string }>();
  if (sellingFixed?.value !== "1") {
    await database.batch([
      database.prepare("UPDATE products SET hidden=0, soldout=0, price_list_visible=1 WHERE id LIKE 'ERP-%'"),
      database.prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('erp_products_selling_v1','1')"),
    ]);
  }
}

export const Route = createFileRoute("/api/store")({
  server: { handlers: { GET: async ({ request }) => {
    try {
      const url = new URL(request.url);
      await ensureCatalogImportV3();

      if (url.searchParams.get("photoAutoFill") === "1") {
        if (url.searchParams.get("token") !== PHOTO_AUTOFILL_TOKEN) {
          return Response.json({ error: "forbidden" }, { status: 403 });
        }
        const limit = Number(url.searchParams.get("limit") || "8");
        return Response.json(await runCatalogPhotoAutoFill(limit), { headers: { "Cache-Control": "no-store" } });
      }
      if (url.searchParams.get("photoAutoStatus") === "1") {
        if (url.searchParams.get("token") !== PHOTO_AUTOFILL_TOKEN) {
          return Response.json({ error: "forbidden" }, { status: 403 });
        }
        return Response.json(await catalogPhotoAutoFillStatus(), { headers: { "Cache-Control": "no-store" } });
      }

      if (url.searchParams.get("photoSearchTest") === "1") {
        const query = (url.searchParams.get("q") || "갈비맛치킨꼬치 업소용 대용량 식자재").slice(0, 120);
        return Response.json(await searchCatalogImageCandidates(query), { headers: { "Cache-Control": "no-store" } });
      }

      if (url.searchParams.get("photoImport") === "1") {
        const retryOnly = url.searchParams.get("retry") === "1";
        return Response.json(await runPhotoImport(retryOnly), { headers: { "Cache-Control": "no-store" } });
      }
      if (url.searchParams.get("photoStatus") === "1") {
        return Response.json(await photoImportStatus(), { headers: { "Cache-Control": "no-store" } });
      }

      if (url.searchParams.get("health") === "1") {
        const database = db();
        const [total, erp, options, marker, importError] = await Promise.all([
          database.prepare("SELECT COUNT(*) AS count FROM products").first<{ count: number }>(),
          database.prepare("SELECT COUNT(*) AS count FROM products WHERE id LIKE 'ERP-%'").first<{ count: number }>(),
          database.prepare("SELECT COUNT(*) AS count FROM pack_options").first<{ count: number }>(),
          database.prepare("SELECT value FROM app_settings WHERE key='excel_catalog_import_v3'").first<{ value: string }>(),
          database.prepare("SELECT value FROM app_settings WHERE key='excel_catalog_import_error'").first<{ value: string }>(),
        ]);
        return Response.json({
          totalProducts: Number(total?.count ?? 0),
          erpProducts: Number(erp?.count ?? 0),
          packOptions: Number(options?.count ?? 0),
          imported: marker?.value === "1",
          error: importError?.value ?? "",
        }, { headers: { "Cache-Control": "no-store" } });
      }

      const customer = await getCustomer(request);
      // 관리자 화면은 ?all=1 로 숨김 상품까지 받아감 (관리자 인증 필수)
      const wantsAll = url.searchParams.get("all") === "1";
      const includeHidden = wantsAll && await isAdmin(request);
      const store = await readStore(customer?.priceGroup, { includeHidden });
      return Response.json(store, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      console.error(error);
      return Response.json({ error: "상품을 불러오지 못했습니다." }, { status: 500 });
    }
  } } },
});
