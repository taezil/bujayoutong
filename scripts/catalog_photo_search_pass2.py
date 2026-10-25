import concurrent.futures
import html
import json
import re
from urllib.parse import urlparse

import requests

BASE = "https://order.bujafood.kr/api/store"
TOKEN = "buja-photo-20261025-f6e3d9a4"

OVERRIDES = {
    "ERP-1027": ("냉동 오징어 다리 오족 업소용", ["오징어", "오족", "다리"]),
    "ERP-2001": ("청우 월남초 건고추 1kg", ["월남초", "건고추"]),
    "ERP-2014": ("고추씨 2kg 식자재", ["고추씨"]),
    "ERP-3003": ("연근 1kg 식자재", ["연근"]),
    "ERP-30081": ("냉동 꽃빵 화권 1.5kg", ["꽃빵", "화권"]),
    "ERP-30227": ("냉동 돼지고기 잡육 5kg 업소용", ["잡육", "돼지고기"]),
    "ERP-30272": ("화미 빙초산 1.5L", ["빙초산"]),
    "ERP-30287": ("냉동 빵가루 2kg 업소용", ["빵가루"]),
    "ERP-30471": ("화미 파슬리 30g", ["파슬리"]),
    "ERP-30597": ("유자청 2kg 업소용", ["유자청"]),
    "ERP-30612": ("PB-1 피비원 20L 다목적 세정제", ["피비원", "pb1", "세정제"]),
    "ERP-30636": ("지마구 단팥깨떡 7kg", ["지마구", "단팥깨떡", "떡"]),
    "ERP-30653": ("푸드올 식용유 18L 업소용", ["식용유"]),
    "ERP-30666": ("우림 딸기잼 3kg 업소용", ["딸기잼", "딸기쨈"]),
    "ERP-30676": ("LG 하이퐁 12kg 주방세제 업소용", ["하이퐁"]),
    "ERP-30911": ("오뚜기 미향 18L", ["미향"]),
    "ERP-31040": ("돼지고기 돈채 잡채용 1kg", ["돈채", "돼지고기", "잡채"]),
    "ERP-31045": ("오뚜기 우지 20kg 식자재", ["우지"]),
    "ERP-31203": ("오뚜기 미향 1.8L", ["미향"]),
    "ERP-31487": ("화미 참치액 2kg 업소용", ["참치액"]),
    "ERP-31517": ("화유 불맛기름 500ml", ["화유", "불맛기름"]),
    "ERP-31578": ("죽순채 통조림 2.84kg", ["죽순"]),
    "ERP-31579": ("죽순홀 통조림 3kg", ["죽순"]),
    "ERP-31724": ("냉동 돼지고기 삼겹 목살 잡육 업소용", ["삼겹", "목살", "잡육"]),
    "ERP-31845": ("꽁치 통조림 캔 1.88kg 업소용", ["꽁치"]),
    "ERP-32028": ("신진 뉴슈가 60g", ["뉴슈가"]),
    "ERP-32167": ("화미 식용유 18L 업소용", ["식용유"]),
    "ERP-32199": ("냉동 돼지고기 목전지 잡육 5kg", ["목전지", "잡육"]),
    "ERP-32407": ("신진 신화당 50g", ["신화당"]),
    "ERP-32441": ("우림 사과잼 3kg 업소용", ["사과잼", "사과쨈"]),
    "ERP-32510": ("알도넛츠 먼치킨 미니도넛 100개", ["먼치킨", "도넛"]),
    "ERP-32818": ("오양 분식왕 야끼만두 1.12kg", ["야끼만두", "분식왕"]),
    "ERP-33001": ("오뚜기 투움바 파스타소스 1kg", ["투움바"]),
    "ERP-33004": ("냉동 보리멸 활복 4kg 업소용", ["보리멸"]),
    "ERP-6010": ("냉동 돼지고기 토시살 장조림 잡채용", ["토시", "돼지"]),
    "ERP-7001": ("검정깨 흑임자 1kg 업소용", ["검정깨", "흑임자"]),
    "ERP-7010": ("들깨가루 개피 1kg 업소용", ["들깨"]),
    "ERP-8002": ("솔표 겨자분 200g", ["겨자분"]),
    "ERP-8003": ("건메밀 메밀 1kg 식자재", ["메밀"]),
    "ERP-8048": ("참이슬 오리지널 1.8L 페트", ["참이슬", "소주"]),
    "ERP-8057": ("참다음 매실 1.5L", ["참다음", "매실"]),
    "ERP-8132": ("화미 엿기름 15kg 업소용", ["엿기름"]),
    "ERP-9027": ("오복채 반찬 4kg 업소용", ["오복채"]),
}

SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/156 Safari/537.36",
    "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.5",
})

def norm(v):
    return re.sub(r"[^0-9a-z가-힣]+", "", v.lower())

def candidates(query):
    r = SESSION.get("https://www.bing.com/images/search", params={"q": query, "form": "HDRSC3", "first": "1"}, timeout=30)
    r.raise_for_status()
    out, seen = [], set()
    for attr in re.findall(r'\sm="([^"]+)"', r.text):
        try:
            meta = json.loads(html.unescape(attr))
        except Exception:
            continue
        url = str(meta.get("murl") or "")
        if not url.startswith(("http://", "https://")) or url in seen:
            continue
        seen.add(url)
        out.append({
            "url": url,
            "title": str(meta.get("t") or ""),
            "page": str(meta.get("purl") or ""),
        })
        if len(out) >= 30:
            break
    return out

def rank(items, required):
    req = [norm(x) for x in required]
    scored = []
    for idx, c in enumerate(items):
        h = norm(c["title"])
        matches = sum(1 for term in req if term and term in h)
        domain = (urlparse(c["url"]).netloc + " " + urlparse(c["page"]).netloc).lower()
        domain_bonus = 1 if any(x in domain for x in ("food","mart","mall","coupang","danawa","ssg","gmarket","auction","11st")) else 0
        scored.append((matches * 100 + domain_bonus * 5 - idx, c))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [c for _, c in scored]

def apply(product_id, url):
    r = SESSION.get(BASE, params={
        "photoApply": "1",
        "token": TOKEN,
        "id": product_id,
        "source": url,
    }, timeout=90)
    if not r.ok:
        raise RuntimeError(f"apply HTTP {r.status_code}")
    data = r.json()
    if not data.get("ok"):
        raise RuntimeError(str(data))
    return data

def process(product_id, product):
    query, required = OVERRIDES[product_id]
    try:
        items = rank(candidates(query), required)
        if not items:
            return {"id": product_id, "name": product["name"], "ok": False, "reason": "no Bing candidates", "query": query}
        # Prefer matching titles, but exact override queries are specific enough to allow fallback candidates.
        matching = [c for c in items if any(norm(t) in norm(c["title"]) for t in required)]
        attempt_items = (matching + [c for c in items if c not in matching])[:8]
        errors = []
        for c in attempt_items:
            try:
                result = apply(product_id, c["url"])
                return {"id": product_id, "name": product["name"], "ok": True, "query": query, "candidate": c, "apply": result}
            except Exception as exc:
                errors.append(str(exc))
        return {"id": product_id, "name": product["name"], "ok": False, "reason": "; ".join(errors[-3:]), "query": query}
    except Exception as exc:
        return {"id": product_id, "name": product["name"], "ok": False, "reason": str(exc), "query": query}

def main():
    blank = SESSION.get(BASE, params={"photoBlankList":"1","token":TOKEN}, timeout=30).json()["products"]
    blank_by_id = {p["id"]: p for p in blank}
    targets = [(pid, blank_by_id[pid]) for pid in OVERRIDES if pid in blank_by_id]
    print("pass2 targets", len(targets), flush=True)

    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        futures = [pool.submit(process, pid, p) for pid, p in targets]
        for f in concurrent.futures.as_completed(futures):
            r = f.result()
            results.append(r)
            print(json.dumps(r, ensure_ascii=False), flush=True)

    final = SESSION.get(BASE, params={"photoAutoStatus":"1","token":TOKEN}, timeout=30).json()
    report = {
        "targets": len(targets),
        "applied": sum(1 for r in results if r.get("ok")),
        "failed": sum(1 for r in results if not r.get("ok")),
        "finalStatus": final,
        "results": sorted(results, key=lambda x:x["id"]),
    }
    with open("catalog-photo-pass2-report.json","w",encoding="utf-8") as f:
        json.dump(report,f,ensure_ascii=False,indent=2)
    print("FINAL", json.dumps({k:v for k,v in report.items() if k!="results"},ensure_ascii=False), flush=True)

if __name__ == "__main__":
    main()
