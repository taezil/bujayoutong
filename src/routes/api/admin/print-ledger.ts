import { createFileRoute } from "@tanstack/react-router";
import { isAdmin } from "../../../lib/auth.server";
import { db, ensureDatabase } from "../../../lib/db.server";

function esc(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] || char));
}
function won(value: number) { return new Intl.NumberFormat("ko-KR").format(Math.round(value)); }

export const Route = createFileRoute("/api/admin/print-ledger")({
  server: { handlers: { GET: async ({ request }) => {
    if (!(await isAdmin(request))) return new Response("관리자 로그인이 필요합니다.", { status: 403 });
    await ensureDatabase();
    const url = new URL(request.url);
    const customerId = String(url.searchParams.get("customerId") ?? "").trim();
    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const fallbackMonth = `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, "0")}`;
    const monthRaw = String(url.searchParams.get("month") ?? fallbackMonth).trim();
    const month = /^\d{4}-\d{2}$/.test(monthRaw) ? monthRaw : fallbackMonth;
    if (!customerId) return new Response("거래처를 선택해 주세요.", { status: 400 });

    const customer = await db().prepare(`
      SELECT id,code,name,business_number,address,store_phone,phone,region
      FROM customers WHERE id=? LIMIT 1
    `).bind(customerId).first<Record<string, unknown>>();
    if (!customer) return new Response("거래처를 찾을 수 없습니다.", { status: 404 });

    const opening = await db().prepare(`
      SELECT COALESCE(SUM(amount),0) AS balance FROM receivable_ledger
      WHERE customer_id=? AND substr(created_at,1,7) < ?
    `).bind(customerId, month).first<{ balance: number }>();
    const result = await db().prepare(`
      SELECT r.id,r.amount,r.event_type,r.reference_order_id,r.note,r.created_at,
             COALESCE(o.total_amount,0) AS order_total
      FROM receivable_ledger r
      LEFT JOIN orders o ON o.id=r.reference_order_id
      WHERE r.customer_id=? AND substr(r.created_at,1,7)=?
      ORDER BY r.created_at,r.id
    `).bind(customerId, month).all();

    let running = Number(opening?.balance ?? 0);
    let sales = 0;
    let payments = 0;
    const rows = (result.results as Array<Record<string, unknown>>).map((row) => {
      const amount = Number(row.amount ?? 0);
      const isSale = amount > 0;
      if (isSale) sales += amount; else payments += Math.abs(amount);
      running += amount;
      return {
        createdAt: String(row.created_at ?? ""),
        eventType: String(row.event_type ?? ""),
        referenceOrderId: String(row.reference_order_id ?? ""),
        note: String(row.note ?? ""),
        running,
        sale: isSale ? amount : 0,
        payment: isSale ? 0 : Math.abs(amount),
      };
    });

    const bodyRows = rows.length ? rows.map((row) => `<tr>
      <td>${esc(row.createdAt.slice(0, 10))}</td>
      <td>${esc(row.eventType === "payment" ? "입금" : row.referenceOrderId ? `출고 ${row.referenceOrderId}` : row.note || "거래")}</td>
      <td class="num">${row.sale ? won(Number(row.sale)) : ""}</td>
      <td class="num">${row.payment ? won(Number(row.payment)) : ""}</td>
      <td class="num strong">${won(Number(row.running))}</td>
    </tr>`).join("") : `<tr><td colspan="5" class="empty">해당 월의 거래가 없습니다.</td></tr>`;

    const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(customer.code)} ${esc(month)} 거래원장</title><style>
      @page{size:A4;margin:12mm}body{font-family:Arial,'Malgun Gothic',sans-serif;color:#111;margin:0}.head{display:flex;justify-content:space-between;gap:20px;align-items:end;border-bottom:3px solid #111;padding-bottom:10px}.head h1{margin:0;font-size:26px}.head p{margin:5px 0 0;color:#555;font-size:12px}.month{font-size:20px;font-weight:800}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:16px 0}.box{border:1px solid #bbb;padding:10px}.box span{display:block;color:#666;font-size:11px}.box b{display:block;margin-top:5px;font-size:17px;text-align:right}table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #bbb;padding:8px 6px;font-size:12px}th{background:#f5f5f2;text-align:left}.num{text-align:right}.strong{font-weight:800}.empty{text-align:center;padding:30px;color:#777}.foot{margin-top:14px;color:#666;font-size:10px;text-align:right}</style></head><body>
      <div class="head"><div><h1>${esc(customer.code)} · ${esc(customer.name)}</h1><p>${esc(customer.business_number)} · ${esc(customer.address)} · ${esc(customer.store_phone || customer.phone)}</p></div><div class="month">${esc(month)} 거래원장</div></div>
      <div class="summary"><div class="box"><span>전월 이월</span><b>${won(Number(opening?.balance ?? 0))}원</b></div><div class="box"><span>당월 매출</span><b>${won(sales)}원</b></div><div class="box"><span>당월 입금</span><b>${won(payments)}원</b></div><div class="box"><span>월말 잔액</span><b>${won(running)}원</b></div></div>
      <table><thead><tr><th>일자</th><th>내용</th><th class="num">매출</th><th class="num">입금</th><th class="num">잔액</th></tr></thead><tbody>${bodyRows}</tbody></table>
      <div class="foot">부자유통 전용 관리시스템</div><script>window.addEventListener('load',()=>setTimeout(()=>window.print(),250));</script>
    </body></html>`;
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  } } },
});
