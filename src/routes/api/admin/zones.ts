import { createFileRoute } from "@tanstack/react-router";
import { getStaff, isAdmin, validMutationOrigin } from "../../../lib/auth.server";
import { bumpVersion, db, ensureDatabase } from "../../../lib/db.server";
import { writeAudit, staffActor } from "../../../lib/audit.server";
import { cleanTime, parseRuns } from "../../../lib/delivery-rules";
import { cleanName, cleanStorage, listLocations, listZones, readDeliveryDefaults, reorder, saveDeliveryDefaults } from "../../../lib/zones.server";

/**
 * 관리자: 구역(거래처 묶음 + 배송 마감 규칙), 창고 위치(상차준비표 순서), 카테고리 보관 구분.
 * 주문 처리 기능은 없음 (발주 처리는 사무실 PC 프로그램에서만)
 */
export const Route = createFileRoute("/api/admin/zones")({
  server: { handlers: {
    GET: async ({ request }) => {
      if (!(await isAdmin(request))) return Response.json({ error: "관리자 로그인이 필요합니다." }, { status: 403 });
      await ensureDatabase();
      const [zones, locations, defaults, customers] = await Promise.all([
        listZones(),
        listLocations(),
        readDeliveryDefaults(),
        db().prepare("SELECT id,code,name,region,active FROM customers ORDER BY code,name").all(),
      ]);
      return Response.json({
        zones, locations, defaults,
        customers: (customers.results as Array<Record<string, unknown>>).map((row) => ({
          id: String(row.id), code: String(row.code ?? ""), name: String(row.name ?? ""), region: String(row.region ?? "").trim(), active: Number(row.active ?? 0) === 1,
        })),
      }, { headers: { "Cache-Control": "no-store" } });
    },
    POST: async ({ request }) => {
      if (!validMutationOrigin(request) || !(await isAdmin(request))) return Response.json({ error: "관리자 로그인이 필요합니다." }, { status: 403 });
      await ensureDatabase();
      try {
        const body = await request.json() as Record<string, unknown>;
        const action = String(body.action ?? "");
        const database = db();
        const name = cleanName(body.name);
        const staff = await getStaff(request);
        const actor = staff ? staffActor(staff) : { type: "admin" as const, id: "admin", name: "관리자" };
        let summary = "";

        if (action === "zone-add") {
          if (!name) throw new Error("구역 이름을 입력해 주세요.");
          const row = await database.prepare("SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM delivery_zones").first<{ n: number }>();
          const result = await database.prepare("INSERT OR IGNORE INTO delivery_zones(name,sort_order) VALUES(?,?)").bind(name, Number(row?.n ?? 1)).run();
          if (!result.meta.changes) throw new Error("같은 이름의 구역이 있습니다.");
          summary = `구역 추가: ${name}`;
        } else if (action === "zone-rename") {
          const next = cleanName(body.newName);
          if (!name || !next) throw new Error("구역 이름을 입력해 주세요.");
          if (await database.prepare("SELECT 1 FROM delivery_zones WHERE name=?").bind(next).first()) throw new Error("같은 이름의 구역이 있습니다.");
          await database.batch([
            database.prepare("UPDATE delivery_zones SET name=? WHERE name=?").bind(next, name),
            database.prepare("UPDATE customers SET region=?,updated_at=datetime('now') WHERE TRIM(region)=?").bind(next, name),
          ]);
          summary = `구역 이름 변경: ${name} → ${next}`;
        } else if (action === "zone-delete") {
          if (!name) throw new Error("구역을 선택해 주세요.");
          await database.batch([
            database.prepare("DELETE FROM delivery_zones WHERE name=?").bind(name),
            database.prepare("UPDATE customers SET region='',updated_at=datetime('now') WHERE TRIM(region)=?").bind(name),
          ]);
          summary = `구역 삭제: ${name} (거래처는 구역 미지정으로)`;
        } else if (action === "zone-save") {
          if (!name) throw new Error("구역을 선택해 주세요.");
          const am = String(body.amUntil ?? "").trim() ? cleanTime(body.amUntil, "") : "";
          if (String(body.amUntil ?? "").trim() && !am) throw new Error("오전 배송 마감 시각을 10:00 처럼 입력해 주세요.");
          const runsText = String(body.pmRuns ?? "").trim();
          const runs = runsText ? parseRuns(runsText, []) : [];
          if (runsText && !runs.length) throw new Error("오후 차수 마감 시각을 13:00, 15:00 처럼 입력해 주세요.");
          await database.prepare("UPDATE delivery_zones SET am_until=?,pm_runs=? WHERE name=?").bind(am, runs.join(","), name).run();
          summary = `구역 배송 규칙: ${name} 오전 ${am || "기본"} · 오후 ${runs.join("/") || "기본"}`;
        } else if (action === "zone-order") {
          await reorder("delivery_zones", Array.isArray(body.names) ? body.names.map(String) : []);
          summary = "구역 순서 변경";
        } else if (action === "assign") {
          const ids = Array.isArray(body.customerIds) ? body.customerIds.map((id) => String(id)).filter(Boolean).slice(0, 500) : [];
          const zone = cleanName(body.zone);
          if (!ids.length) throw new Error("거래처를 선택해 주세요.");
          if (zone && !(await database.prepare("SELECT 1 FROM delivery_zones WHERE name=?").bind(zone).first())) throw new Error("없는 구역입니다.");
          for (let index = 0; index < ids.length; index += 90) {
            const chunk = ids.slice(index, index + 90);
            await database.prepare(`UPDATE customers SET region=?,updated_at=datetime('now') WHERE id IN (${chunk.map(() => "?").join(",")})`).bind(zone, ...chunk).run();
          }
          summary = `거래처 ${ids.length}곳 → ${zone || "구역 미지정"}`;
        } else if (action === "defaults-save") {
          const saved = await saveDeliveryDefaults({ openFrom: body.openFrom, sameDayCutoff: body.sameDayCutoff, amUntil: body.amUntil, pmRuns: body.pmRuns });
          summary = `배송 마감 기본값: 오늘배송 ${saved.openFrom}~${saved.sameDayCutoff} · 오전 ${saved.amUntil} · 오후 ${saved.pmRuns.join("/")}`;
        } else if (action === "location-add") {
          if (!name) throw new Error("창고 위치 이름을 입력해 주세요.");
          const row = await database.prepare("SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM warehouse_locations").first<{ n: number }>();
          const result = await database.prepare("INSERT OR IGNORE INTO warehouse_locations(name,sort_order,storage) VALUES(?,?,?)").bind(name, Number(row?.n ?? 1), cleanStorage(body.storage)).run();
          if (!result.meta.changes) throw new Error("같은 이름의 위치가 있습니다.");
          summary = `창고 위치 추가: ${name}`;
        } else if (action === "location-rename") {
          const next = cleanName(body.newName);
          if (!name || !next) throw new Error("위치 이름을 입력해 주세요.");
          if (await database.prepare("SELECT 1 FROM warehouse_locations WHERE name=?").bind(next).first()) throw new Error("같은 이름의 위치가 있습니다.");
          await database.batch([
            database.prepare("UPDATE warehouse_locations SET name=? WHERE name=?").bind(next, name),
            database.prepare("UPDATE products SET warehouse_zone=?,updated_at=datetime('now') WHERE TRIM(warehouse_zone)=?").bind(next, name),
          ]);
          await bumpVersion(database);
          summary = `창고 위치 이름 변경: ${name} → ${next}`;
        } else if (action === "location-delete") {
          await database.batch([
            database.prepare("DELETE FROM warehouse_locations WHERE name=?").bind(name),
            database.prepare("UPDATE products SET warehouse_zone='',updated_at=datetime('now') WHERE TRIM(warehouse_zone)=?").bind(name),
          ]);
          await bumpVersion(database);
          summary = `창고 위치 삭제: ${name}`;
        } else if (action === "location-save") {
          await database.prepare("UPDATE warehouse_locations SET storage=? WHERE name=?").bind(cleanStorage(body.storage), name).run();
          summary = `창고 위치 구분: ${name}`;
        } else if (action === "location-order") {
          await reorder("warehouse_locations", Array.isArray(body.names) ? body.names.map(String) : []);
          summary = "창고 위치 순서 변경";
        } else if (action === "products-location") {
          const ids = Array.isArray(body.productIds) ? body.productIds.map((id) => String(id)).filter(Boolean).slice(0, 1000) : [];
          const location = cleanName(body.location);
          if (!ids.length) throw new Error("상품을 선택해 주세요.");
          if (location && !(await database.prepare("SELECT 1 FROM warehouse_locations WHERE name=?").bind(location).first())) throw new Error("없는 창고 위치입니다.");
          for (let index = 0; index < ids.length; index += 90) {
            const chunk = ids.slice(index, index + 90);
            await database.prepare(`UPDATE products SET warehouse_zone=?,updated_at=datetime('now') WHERE id IN (${chunk.map(() => "?").join(",")})`).bind(location, ...chunk).run();
          }
          await bumpVersion(database);
          summary = `상품 ${ids.length}개 창고 위치 → ${location || "미지정"}`;
        } else if (action === "category-storage") {
          const category = cleanName(body.category, 80);
          await database.prepare("UPDATE categories SET storage=? WHERE name=?").bind(cleanStorage(body.storage), category).run();
          await bumpVersion(database);
          summary = `카테고리 보관 구분: ${category}`;
        } else {
          throw new Error("알 수 없는 작업입니다.");
        }
        await writeAudit({ actor, action: `zones_${action}`, entityType: "settings", entityId: name || action, summary }).catch(() => undefined);
        return Response.json({ ok: true, message: summary });
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "저장하지 못했습니다." }, { status: 400 });
      }
    },
  } },
});
