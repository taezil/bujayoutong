import { createFileRoute } from "@tanstack/react-router";
import { getCustomer, getStaff, isAdmin } from "../../lib/auth.server";
import { readStore } from "../../lib/db.server";

export const Route = createFileRoute("/api/price-list")({
  server: { handlers: { GET: async ({ request }) => {
    try {
      const customer = await getCustomer(request);
      const staff = customer ? null : await getStaff(request);
      const legacyAdmin = !customer && !staff ? await isAdmin(request) : false;

      if (!customer && !staff && !legacyAdmin) {
        return Response.json(
          { error: "거래처 로그인이 필요합니다.", code: "AUTH_REQUIRED" },
          { status: 401, headers: { "Cache-Control": "no-store" } },
        );
      }

      const viewer = customer
        ? { type: "customer" as const, name: customer.loginName || customer.name, customerName: customer.name, priceGroup: customer.priceGroup }
        : staff
          ? { type: staff.role === "ADMIN" ? "admin" as const : "driver" as const, name: staff.displayName, priceGroup: null }
          : { type: "admin" as const, name: "관리자", priceGroup: null };

      const store = await readStore(customer?.priceGroup);
      const internal = viewer.type === "admin" || viewer.type === "driver";
      const products = store.products
        .filter((product) => product.priceListVisible !== false)
        .map((product) => ({
          id: product.id,
          name: product.name,
          category: product.category,
          sub: product.sub,
          unit: product.unit,
          photo: product.photo,
          soldout: product.soldout,
          description: product.description ?? "",
          servingsPerUnit: product.servingsPerUnit ?? "",
          boxContents: product.boxContents ?? "",
          servingsPerBox: product.servingsPerBox ?? "",
          storageMethod: product.storageMethod ?? "",
          priceDisplayMode: product.priceDisplayMode ?? "fixed",
          isPromo: product.category === store.promoCategory,
          packOptions: product.packOptions.map((option) => ({
            label: option.label,
            price: option.price,
            ...(internal ? { priceA: option.priceA ?? null, priceB: option.priceB ?? null } : {}),
          })),
        }));

      return Response.json({
        viewer,
        promoCategory: store.promoCategory,
        version: store.version,
        updatedLabel: "관리자 상품정보와 실시간 연동",
        products,
      }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      console.error(error);
      return Response.json({ error: "단가표를 불러오지 못했습니다." }, { status: 500 });
    }
  } } },
});
