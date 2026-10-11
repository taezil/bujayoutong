import { createFileRoute } from "@tanstack/react-router";
import { isAdmin } from "../../../lib/auth.server";
import { db, ensureDatabase } from "../../../lib/db.server";

function esc(v: unknown) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c] || c));
}
function num(v: number) { return new Intl.NumberFormat("ko-KR").format(Math.round(v)); }
function qty(v: number) { return Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000); }

type Line = {
  productName: string;
  unit: string;
  optionLabel: string;
  quantity: number;
  unitPrice: number;
  taxType: string;
};

function statementCopy(args: {
  copyLabel: "공급자용" | "공급받는자용";
  date: string;
  periodLabel: string;
  customer: { code: string; name: string; businessNumber: string; address: string; phone: string; receivable: number };
  lines: Line[];
}) {
  const day = args.date?.slice(8, 10) || "";
  let supplyTotal = 0;
  let taxTotal = 0;
  let grandTotal = 0;
  const rows = args.lines.map((line, index) => {
    const amount = Math.round(line.quantity * line.unitPrice);
    const exempt = line.taxType === "exempt";
    const supply = exempt ? amount : Math.round(amount / 1.1);
    const tax = exempt ? 0 : amount - supply;
    supplyTotal += supply;
    taxTotal += tax;
    grandTotal += amount;
    return `<tr>
      <td class="center">${esc(day)}</td>
      <td class="center">${index + 1}</td>
      <td>${esc(line.productName)}</td>
      <td class="center">${esc(line.unit || line.optionLabel)}</td>
      <td class="num">${qty(line.quantity)}</td>
      <td class="num">${num(line.unitPrice)}</td>
      <td class="num">${num(supply)}</td>
      <td class="num">${tax ? num(tax) : ""}</td>
      <td></td>
    </tr>`;
  }).join("");

  const minRows = Math.max(0, 8 - args.lines.length);
  const blanks = Array.from({ length: minRows }, () => "<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>").join("");

  return `<section class="statement">
    <div class="statement-title">
      <span class="copy-label">${esc(args.copyLabel)}</span>
      <h1>거 래 명 세 표</h1>
      <span class="date">${esc(args.date)} · ${esc(args.periodLabel)}</span>
    </div>
    <div class="parties">
      <table class="party">
        <tr><th rowspan="4">공<br>급<br>자</th><th>등록번호</th><td colspan="3"></td></tr>
        <tr><th>상호</th><td>부자유통</td><th>성명</th><td></td></tr>
        <tr><th>사업장주소</th><td colspan="3"></td></tr>
        <tr><th>업태/종목</th><td colspan="3">식자재 유통</td></tr>
      </table>
      <table class="party">
        <tr><th rowspan="4">공<br>급<br>받<br>는<br>자</th><th>등록번호</th><td colspan="3">${esc(args.customer.businessNumber)}</td></tr>
        <tr><th>상호</th><td>${esc(args.customer.name)}</td><th>성명</th><td></td></tr>
        <tr><th>사업장주소</th><td colspan="3">${esc(args.customer.address)}</td></tr>
        <tr><th>전화</th><td colspan="3">${esc(args.customer.phone)}</td></tr>
      </table>
    </div>
    <div class="customer-code">거래처번호 <b>${esc(args.customer.code)}</b></div>
    <table class="items">
      <thead><tr><th>일</th><th>일련</th><th>품목</th><th>규격</th><th>수량</th><th>단가</th><th>공급가액</th><th>세액</th><th>비고</th></tr></thead>
      <tbody>${rows}${blanks}</tbody>
    </table>
    <table class="totals">
      <tr><th>공급가액</th><td class="num">${num(supplyTotal)}</td><th>세액</th><td class="num">${num(taxTotal)}</td><th>미수금</th><td class="num">${num(args.customer.receivable)}</td><th>합계금액</th><td class="num total">${num(grandTotal)}</td></tr>
    </table>
  </section>`;
}

export const Route = createFileRoute("/api/admin/print-orders")({
  server: { handlers: { GET: async ({ request }) => {
    if (!(await isAdmin(request))) return new Response("관리자 로그인이 필요합니다.", { status: 403 });
    await ensureDatabase();

    const url = new URL(request.url);
    const region = (url.searchParams.get("region") || "").trim();
    const deliveryDate = (url.searchParams.get("deliveryDate") || "").trim();
    const unprinted = url.searchParams.get("unprinted") !== "0";
    if (!region) return new Response("지역을 선택해 주세요.", { status: 400 });

    const orders = await db().prepare(`
      SELECT o.id,o.customer_id,o.created_at,o.delivery_date,o.is_additional,o.order_period,
             c.code,c.name,c.business_number,c.address,c.store_phone,c.phone,
             COALESCE((SELECT SUM(amount) FROM receivable_ledger r WHERE r.customer_id=c.id),0) AS receivable
      FROM orders o JOIN customers c ON c.id=o.customer_id
      WHERE o.region_snapshot=? ${deliveryDate ? "AND o.delivery_date=?" : ""}
        AND o.status IN ('received','preparing')
        ${unprinted ? "AND o.printed_at IS NULL" : ""}
      ORDER BY c.code,o.created_at
    `).bind(...(deliveryDate ? [region, deliveryDate] : [region])).all();

    const list = orders.results as Array<Record<string, unknown>>;
    if (!list.length) {
      return new Response(`<meta charset="utf-8"><div style="font-family:'Malgun Gothic',sans-serif;padding:40px"><h2>${esc(region)} 출력할 신규 주문이 없습니다.</h2></div>`, { headers: { "Content-Type":"text/html; charset=utf-8" } });
    }

    const ids = list.map((o) => String(o.id));
    const placeholders = ids.map(() => "?").join(",");
    const items = await db().prepare(`
      SELECT order_id,product_name,unit,option_label,quantity,unit_price,tax_type
      FROM order_items WHERE order_id IN (${placeholders}) ORDER BY id
    `).bind(...ids).all();

    const byOrder = new Map<string, Line[]>();
    for (const row of items.results as Array<Record<string, unknown>>) {
      const key = String(row.order_id);
      const arr = byOrder.get(key) ?? [];
      arr.push({
        productName: String(row.product_name ?? ""),
        unit: String(row.unit ?? ""),
        optionLabel: String(row.option_label ?? ""),
        quantity: Number(row.quantity ?? 0),
        unitPrice: Number(row.unit_price ?? 0),
        taxType: String(row.tax_type ?? "taxable"),
      });
      byOrder.set(key, arr);
    }

    const grouped = new Map<string, {
      code: string; name: string; businessNumber: string; address: string; phone: string; receivable: number;
      date: string; orders: Array<Record<string, unknown>>;
    }>();
    for (const order of list) {
      const customerId = String(order.customer_id);
      const group = grouped.get(customerId) ?? {
        code: String(order.code ?? ""),
        name: String(order.name ?? ""),
        businessNumber: String(order.business_number ?? ""),
        address: String(order.address ?? ""),
        phone: String(order.store_phone || order.phone || ""),
        receivable: Number(order.receivable ?? 0),
        date: String(order.delivery_date || deliveryDate || ""),
        orders: [],
      };
      group.orders.push(order);
      grouped.set(customerId, group);
    }

    let pages = "";
    for (const group of grouped.values()) {
      const lines: Line[] = [];
      for (const order of group.orders) lines.push(...(byOrder.get(String(order.id)) ?? []));
      const customer = {
        code: group.code, name: group.name, businessNumber: group.businessNumber,
        address: group.address, phone: group.phone, receivable: group.receivable,
      };
      const periods = Array.from(new Set(group.orders.map((row) => String(row.order_period || "AM"))));
      const periodLabel = periods.length === 1 ? (periods[0] === "PM" ? "오후발주" : "오전발주") : "오전·오후발주";
      pages += `<article class="page">${statementCopy({copyLabel:"공급자용",date:group.date,periodLabel,customer,lines})}${statementCopy({copyLabel:"공급받는자용",date:group.date,periodLabel,customer,lines})}</article>`;
    }

    const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(region)} 거래명세표</title><style>
      @page{size:A4;margin:7mm}*{box-sizing:border-box}body{margin:0;color:#111;font-family:Arial,'Malgun Gothic',sans-serif}.page{height:283mm;display:grid;grid-template-rows:1fr 1fr;page-break-after:always}.statement{padding:3mm 1mm 2mm;overflow:hidden}.statement-title{display:grid;grid-template-columns:1fr auto 1fr;align-items:end;margin-bottom:2mm}.statement-title h1{margin:0;font-size:22px;letter-spacing:6px;text-align:center}.copy-label{font-size:11px;font-weight:700}.date{text-align:right;font-size:11px;font-weight:700}.parties{display:grid;grid-template-columns:1fr 1fr;gap:2mm}.party,.items,.totals{width:100%;border-collapse:collapse}.party th,.party td,.items th,.items td,.totals th,.totals td{border:1px solid #222}.party th{width:14%;padding:2px 4px;font-size:9px;font-weight:700;text-align:center}.party td{padding:2px 4px;font-size:9px;height:18px}.customer-code{margin:2mm 0 1mm;font-size:9px;text-align:right}.items{table-layout:fixed}.items th{height:18px;padding:2px;font-size:9px;background:#fff}.items td{height:18px;padding:2px 4px;font-size:9px}.items th:nth-child(1){width:5%}.items th:nth-child(2){width:5%}.items th:nth-child(3){width:29%}.items th:nth-child(4){width:11%}.items th:nth-child(5){width:8%}.items th:nth-child(6){width:10%}.items th:nth-child(7){width:12%}.items th:nth-child(8){width:9%}.items th:nth-child(9){width:11%}.center{text-align:center}.num{text-align:right}.totals{margin-top:1.5mm}.totals th{padding:3px;font-size:9px;background:#fff}.totals td{padding:3px 5px;font-size:10px}.totals .total{font-weight:800;font-size:11px}@media print{body{-webkit-print-color-adjust:exact}.page:last-child{page-break-after:auto}}
    </style></head><body>${pages}<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),250));</script></body></html>`;
    return new Response(html, { headers: { "Content-Type":"text/html; charset=utf-8", "Cache-Control":"no-store" } });
  } } },
});
