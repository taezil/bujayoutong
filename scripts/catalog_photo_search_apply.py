import concurrent.futures
import html
import json
import re
import sys
import time
from urllib.parse import urlparse

import requests

BASE = "https://order.bujafood.kr/api/store"
TOKEN = "buja-photo-20261025-f6e3d9a4"

SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/156 Safari/537.36",
    "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.5",
})

# Long/specific terms first. Brand exactness is intentionally not required.
PRODUCT_TERMS = sorted({
    "절단고등어","절단갈치","절단가자미","절단아귀","갈치필렛","민어조기필렛",
    "손질오징어","솔방울오징어","오징어링","오징어몸채","오징어먹물","칵테일새우",
    "새우튀김","오징어튀김","치킨탕수육","순살돈까스","치킨까스","돈까스","볼카츠",
    "고로케","동그랑땡","군만두","야끼만두","왕만두","교자만두","만두","메밀전병",
    "감자떡","꿀떡","절편","웨지감자","감자","면사리","칼국수","냉면","막국수","쫄면",
    "런천미트","순대","어묵","오뎅","갈치","고등어","조기","민어","가자미","아귀",
    "낙지","문어","오징어","쭈꾸미","새우","골뱅이","해파리","해물모듬","해물완자",
    "낙지젓갈","오징어젓갈","조개젓갈","새우젓","밴댕이젓갈","젓갈",
    "김밥김","도시락김","김가루","구이김","파래김","건파래","다시마","미역줄기","미역",
    "진미채","북어채","명엽채","쥐어채","오징어채","가쓰오부시","표고버섯","목이버섯",
    "두절새우","보리새우","멸치","쥐포","갈비","등뼈","목뼈","민찌","제육","돼지머리",
    "우족","닭장각","닭정육","닭도리","통오리","오리","두부","순두부","연두부","팩두부",
    "곤약","청포묵","메추리알","계란","버터","마가린","단무지","짠지","우엉","땅콩조림",
    "마늘쫑","무말랭이","무쌈","피클","백김치","알타리김치","깍두기","배추김치","김치",
    "진간장","국간장","간장","식초","된장","쌈장","청국장","고추장","춘장","당면",
    "스파게티","국수","소스","육수","장국","액젓","마요네즈","케찹","드레싱",
    "다시다","설탕","전분","소금","후추","파인애플","황도","후르츠칵테일","참깨",
    "흑미","찰보리","라면","스프","커피","건포도","아몬드","도넛","꽈배기","찐빵",
    "꽃빵","세제","고무장갑","롤팩","비닐","크리너","식용유","참기름","들기름",
}, key=lambda x: (-len(x), x))

ORIGIN_WORDS = {
    "중국산","수입산","베트남","베트남산","칠레산","태국산","러시아","러시아산",
    "페루","페루산","포르투갈","국산",
}

SYNONYMS = {
    "오뎅": "어묵",
    "케찹": "케첩",
    "쭈꾸미": "주꾸미",
    "미후지": "돼지 뒷다리",
}

GOOD_DOMAINS = (
    "foodspring", "coupang", "danawa", "ssg", "emart", "lotte", "mall", "mart",
    "food", "naver", "11st", "gmarket", "auction", "kurly",
)

def normalize(value: str) -> str:
    return re.sub(r"[^0-9a-z가-힣]+", "", value.lower())

def clean_name(name: str) -> str:
    value = re.sub(r"\([^)]*\)", " ", name)
    value = value.replace("!", " ").replace("@", " ")
    parts = [p.strip() for p in re.split(r"[/|]", value) if p.strip()]
    kept = []
    for part in parts:
        if part in ORIGIN_WORDS:
            continue
        kept.append(part)
    value = " ".join(kept) if kept else value
    value = re.sub(r"\s+", " ", value).strip()
    return value

def search_query(product):
    name = clean_name(product["name"])
    extras = []
    for source, target in SYNONYMS.items():
        if source in name:
            extras.append(target)
    return " ".join([name, *extras, "업소용", "대용량", "식자재"]).strip()

def bing_candidates(query: str):
    response = SESSION.get(
        "https://www.bing.com/images/search",
        params={"q": query, "form": "HDRSC3", "first": "1"},
        timeout=30,
    )
    response.raise_for_status()
    attrs = re.findall(r'\sm="([^"]+)"', response.text)
    out = []
    seen = set()
    for attr in attrs:
        try:
            meta = json.loads(html.unescape(attr))
        except Exception:
            continue
        url = str(meta.get("murl") or "")
        title = str(meta.get("t") or "")
        page = str(meta.get("purl") or "")
        if not url.startswith(("http://", "https://")) or url in seen:
            continue
        seen.add(url)
        out.append({"url": url, "title": title, "page": page})
        if len(out) >= 25:
            break
    return out

def semantic_terms(name: str):
    n = normalize(clean_name(name))
    terms = []
    for term in PRODUCT_TERMS:
        nt = normalize(term)
        if nt and nt in n:
            # Synonymous 오뎅/어묵 are treated as one concept.
            terms.append(term)
    # Keep the longest few; generic nested terms should not dominate.
    picked = []
    for term in terms:
        nt = normalize(term)
        if any(nt in normalize(existing) or normalize(existing) in nt for existing in picked):
            if len(nt) > max((len(normalize(x)) for x in picked if nt in normalize(x) or normalize(x) in nt), default=0):
                picked = [x for x in picked if not (nt in normalize(x) or normalize(x) in nt)]
                picked.append(term)
            continue
        picked.append(term)
        if len(picked) >= 4:
            break
    return picked

def ngram_best(name: str, title: str):
    a = re.sub(r"\d+(?:\.\d+)?(?:kg|g|ml|l)?", "", normalize(clean_name(name)))
    b = normalize(title)
    for size in range(min(8, len(a)), 2, -1):
        for i in range(0, len(a) - size + 1):
            gram = a[i:i+size]
            if gram in b:
                return size
    return 0

def choose_candidate(product, candidates):
    if not candidates:
        return None
    name = product["name"]
    cleaned = clean_name(name)
    nname = normalize(cleaned)
    terms = semantic_terms(name)
    best = None

    for index, candidate in enumerate(candidates):
        title = candidate["title"]
        hay = normalize(title)
        score = max(0, 20 - index)
        if nname and nname in hay:
            score += 1200

        matched_terms = 0
        for term in terms:
            variants = {term}
            if term in SYNONYMS:
                variants.add(SYNONYMS[term])
            for src, dst in SYNONYMS.items():
                if term == dst:
                    variants.add(src)
            if any(normalize(v) in hay for v in variants):
                matched_terms += 1
                score += 160 + len(normalize(term)) * 8
                break

        gram = ngram_best(name, title)
        score += gram * 18

        domain = (urlparse(candidate["url"]).netloc + " " + urlparse(candidate["page"]).netloc).lower()
        if any(good in domain for good in GOOD_DOMAINS):
            score += 8

        # Important preparation/shape words should be preserved when present.
        for modifier in ("절단","필렛","링","채","손질","통","젓갈","튀김","군만두","왕만두","고로케","돈까스","김치"):
            if modifier in cleaned and normalize(modifier) not in hay:
                score -= 35

        item = {**candidate, "score": score, "matched_terms": matched_terms, "gram": gram}
        if best is None or score > best["score"]:
            best = item

    if best is None:
        return None

    # Strict enough to avoid random photos, but generic food items can still match by 3+ chars.
    if terms:
        if best["matched_terms"] == 0 and best["gram"] < 4:
            return None
    elif best["gram"] < 4:
        return None
    return best

def apply_photo(product, candidate):
    params = {
        "photoApply": "1",
        "token": TOKEN,
        "id": product["id"],
        "source": candidate["url"],
    }
    response = SESSION.get(BASE, params=params, timeout=90)
    response.raise_for_status()
    return response.json()

def process(product):
    query = search_query(product)
    try:
        candidates = bing_candidates(query)
        picked = choose_candidate(product, candidates)
        if not picked:
            # Second query without merchandising words can recover niche foods.
            candidates = bing_candidates(clean_name(product["name"]))
            picked = choose_candidate(product, candidates)
        if not picked:
            return {"id": product["id"], "name": product["name"], "ok": False, "reason": "no confident candidate", "query": query}
        applied = apply_photo(product, picked)
        return {
            "id": product["id"],
            "name": product["name"],
            "ok": bool(applied.get("ok")),
            "query": query,
            "candidate": picked,
            "apply": applied,
        }
    except Exception as exc:
        return {"id": product["id"], "name": product["name"], "ok": False, "reason": str(exc), "query": query}

def fetch_blanks():
    for _ in range(90):
        try:
            r = SESSION.get(BASE, params={"photoBlankList": "1", "token": TOKEN}, timeout=30)
            if r.ok:
                data = r.json()
                if isinstance(data.get("products"), list):
                    return data["products"]
        except Exception:
            pass
        time.sleep(5)
    raise RuntimeError("photoBlankList endpoint did not become ready")

def main():
    products = fetch_blanks()
    print(f"Starting with {len(products)} blank target products", flush=True)
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        futures = {pool.submit(process, p): p for p in products}
        for num, future in enumerate(concurrent.futures.as_completed(futures), 1):
            result = future.result()
            results.append(result)
            print(json.dumps(result, ensure_ascii=False), flush=True)
            if num % 25 == 0:
                ok = sum(1 for r in results if r.get("ok"))
                print(f"PROGRESS {num}/{len(products)} applied={ok}", flush=True)

    final = SESSION.get(BASE, params={"photoAutoStatus": "1", "token": TOKEN}, timeout=30).json()
    report = {
        "startedBlank": len(products),
        "applied": sum(1 for r in results if r.get("ok")),
        "failed": sum(1 for r in results if not r.get("ok")),
        "finalStatus": final,
        "results": sorted(results, key=lambda r: r["id"]),
    }
    with open("catalog-photo-search-report.json", "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print("FINAL", json.dumps({k:v for k,v in report.items() if k!="results"}, ensure_ascii=False), flush=True)

if __name__ == "__main__":
    main()
