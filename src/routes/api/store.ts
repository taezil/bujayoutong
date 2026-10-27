import { createFileRoute } from "@tanstack/react-router";
import { getCustomer, getStaff, isAdmin } from "../../lib/auth.server";
import { readStore } from "../../lib/db.server";

export const Route = createFileRoute("/api/store")({
  server: { handlers: { GET: async ({ request }) => {
    try {
      const url = new URL(request.url);

      // 1) 인증 먼저: 거래처 로그인 OR 관리자 OR 직원. 완전 미인증은 어떤 상품정보도 받지 못함.
      const customer = await getCustomer(request);
      const admin = customer ? false : await isAdmin(request);
      const staff = customer || admin ? null : await getStaff(request);
      if (!customer && !admin && !staff) {
        return Response.json(
          { error: "거래처 로그인이 필요합니다.", code: "AUTH_REQUIRED" },
          { status: 401, headers: { "Cache-Control": "no-store, private" } },
        );
      }

      // 2) 사진 점검/보정용 쿼리(?photoStatus=1 등)는 관리자만. 거래처 화면은 파라미터 없이,
      //    관리자 화면은 ?all=1 로만 호출합니다.
      const adminViewer = admin || staff?.role === "ADMIN";
      const maintenanceQuery = [...url.searchParams.keys()].some((key) => key !== "all");
      if (maintenanceQuery && !adminViewer) {
        return Response.json({ error: "관리자 로그인이 필요합니다." }, { status: 403, headers: { "Cache-Control": "no-store" } });
      }

      if (adminViewer && (maintenanceQuery || url.searchParams.get("all") === "1")) {
        const maintenance = await import("../../lib/catalog-maintenance.server");
        await maintenance.ensureCatalogMaintenance();
        if (maintenanceQuery) {
          const handled = await maintenance.handleMaintenanceQuery(url);
          if (handled) return handled;
          return Response.json({ error: "지원하지 않는 요청입니다." }, { status: 400 });
        }
      }

      // 관리자 화면은 ?all=1 로 숨김 상품까지 받아감 (관리자 인증 필수)
      const wantsAll = url.searchParams.get("all") === "1";
      const includeHidden = wantsAll && (admin || staff?.role === "ADMIN");
      const store = await readStore(customer?.priceGroup, { includeHidden });
      return Response.json(store, { headers: { "Cache-Control": "no-store, private" } });
    } catch (error) {
      console.error(error);
      return Response.json({ error: "상품을 불러오지 못했습니다." }, { status: 500 });
    }
  } } },
});
