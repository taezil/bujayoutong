// 문자 주문 붙여넣기용 서버 코드: 연관어 저장·조회, 거래처 주문이력, 중복 주문 찾기
// 관리자(/api/admin/orders)와 배송기사(/api/driver/sms)가 같이 씀
import { db } from "./db.server";
import { cleanText } from "./admin-validation.server";

export type DuplicateOrder = { id: string; source: string; createdAt: string; by: string; orderPeriod: "AM" | "PM"; summary: string; overlap: number };

/** 같은 거래처·같은 배송일에 같은 품목이 든 주문 (취소 제외) */
export async function findDuplicateOrders(customerId: string, day: string, productIds: string[]): Promise<DuplicateOrder[]> {
  const wanted = new Set(productIds);
  const prev = (await db().prepare(`
    SELECT o.id,o.source,datetime(o.created_at,'+9 hours') AS created_at,o.created_by_staff_name,o.order_period,
           (SELECT GROUP_CONCAT(product_id, char(31)) FROM order_items WHERE order_id=o.id) AS pids,
           (SELECT GROUP_CONCAT(product_name||' '||(CASE WHEN quantity=CAST(quantity AS INTEGER) THEN CAST(quantity AS INTEGER) ELSE quantity END)||option_label, ', ') FROM order_items WHERE order_id=o.id) AS summary
    FROM orders o WHERE o.customer_id=? AND o.delivery_date=? AND o.status!='cancelled'
    ORDER BY o.created_at DESC LIMIT 5`).bind(customerId, day).all<Record<string, unknown>>()).results;
  return prev.map((r) => {
    const pids = String(r.pids ?? "").split(String.fromCharCode(31)).filter(Boolean);
    return { id: String(r.id), source: String(r.source), createdAt: String(r.created_at), by: String(r.created_by_staff_name || ""), orderPeriod: String(r.order_period) === "PM" ? "PM" as const : "AM" as const,
      summary: String(r.summary ?? "").slice(0, 200), overlap: pids.filter((p) => wanted.has(p)).length };
  }).filter((d) => d.overlap > 0);
}

/** sms-context / alias-save / alias-delete / alias-used. 해당 없으면 null */
export async function handleSmsAction(action: string, body: Record<string, unknown>): Promise<Response | null> {
        if(action==="sms-context"){
          const customerId=cleanText(body.customerId,80);
          const [aliases,history]=await Promise.all([
            db().prepare("SELECT alias,customer_id,product_id,option_label,use_count FROM product_aliases ORDER BY use_count DESC, alias").all(),
            customerId ? db().prepare(`
              SELECT oi.product_id, COUNT(*) AS n FROM order_items oi JOIN orders o ON o.id=oi.order_id
              WHERE o.customer_id=? AND o.status!='cancelled' AND o.created_at>=datetime('now','-180 days')
              GROUP BY oi.product_id
            `).bind(customerId).all() : Promise.resolve({results:[]}),
          ]);
          return Response.json({
            aliases:(aliases.results as Array<Record<string,unknown>>).map(r=>({alias:String(r.alias),customerId:String(r.customer_id??""),productId:String(r.product_id),optionLabel:String(r.option_label??""),useCount:Number(r.use_count??0)})),
            history:(history.results as Array<Record<string,unknown>>).map(r=>({productId:String(r.product_id),count:Number(r.n??0)})),
          },{headers:{"Cache-Control":"no-store"}});
        }
        if(action==="alias-save"){
          const alias=cleanText(body.alias,60).toLowerCase().replace(/\s+/g,"");
          const productId=cleanText(body.productId,80);
          const optionLabel=cleanText(body.optionLabel,40);
          const customerId=cleanText(body.customerId,80);
          if(!alias||!productId) throw new Error("연관어와 상품을 확인해 주세요.");
          const product=await db().prepare("SELECT id,name FROM products WHERE id=?").bind(productId).first<{id:string;name:string}>();
          if(!product) throw new Error("상품을 찾을 수 없습니다.");
          const upsert=(cid:string)=>db().prepare(`
            INSERT INTO product_aliases(alias,customer_id,product_id,option_label,use_count) VALUES(?,?,?,?,1)
            ON CONFLICT(alias,customer_id) DO UPDATE SET product_id=excluded.product_id, option_label=excluded.option_label, use_count=product_aliases.use_count+1, updated_at=datetime('now')
          `).bind(alias,cid,productId,optionLabel);
          // 이 거래처 연관어는 항상 저장. 공통 연관어는 아직 없을 때만 만들어 다른 식당에도 바로 쓰이게 함
          const statements=[...(customerId?[upsert(customerId)]:[]),
            db().prepare("INSERT OR IGNORE INTO product_aliases(alias,customer_id,product_id,option_label,use_count) VALUES(?,'',?,?,1)").bind(alias,productId,optionLabel)];
          if(!customerId) statements.splice(0,statements.length,upsert(""));
          await db().batch(statements);
          return Response.json({ok:true});
        }
        if(action==="alias-delete"){
          const alias=cleanText(body.alias,60);
          const customerId=cleanText(body.customerId,80);
          await db().prepare("DELETE FROM product_aliases WHERE alias=? AND customer_id=?").bind(alias,customerId).run();
          return Response.json({ok:true});
        }
        if(action==="alias-used"){
          const list=Array.isArray(body.aliases)?body.aliases as Array<{alias:string;customerId:string}>:[];
          const statements=list.slice(0,60).map(a=>db().prepare("UPDATE product_aliases SET use_count=use_count+1 WHERE alias=? AND customer_id=?").bind(cleanText(a.alias,60),cleanText(a.customerId,80)));
          if(statements.length) await db().batch(statements);
          return Response.json({ok:true});
        }

  return null;
}
