"""비짓제주 Open API(관광지·음식점) → backend/data/places_jeju.csv (places_mapo.csv와 같은 컬럼).

카테고리는 build_places_geo.py의 KEEP/RULES가 그대로 분류할 수 있는 문자열로 바꿔 넣는다
(관광지 → 문화/체험/산책, 음식점 → 식사/카페/한잔).

준비: backend/.env 에 VISITJEJU_API_KEY (비짓제주 또는 공공데이터포털 15076361에서 발급)
실행: python backend/scripts/collect_visitjeju.py
다음: build_places_geo.py(점검) → load_places_to_db.py(DB 적재) → build_walk_legs.py
"""
import csv, json, re, sys, urllib.parse, urllib.request, uuid
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_places_geo import env  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "backend" / "data" / "places_jeju.csv"
URL = "https://api.visitjeju.net/vsjApi/contents/searchList"
CATEGORIES = {"c1": "관광지", "c4": "음식점"}
COLUMNS = ["id", "name", "category", "address", "road_address", "lat", "lng", "link", "phone", "business_hours",
           "menu", "tags", "area", "event_start", "event_end", "source", "review_text", "raw_json", "fetched_at"]


def category(code: str, it: dict) -> str:
    text = f"{it.get('title') or ''} {it.get('alltag') or ''}"
    if code == "c4":
        if re.search(r"카페|디저트|베이커리|빵", text):
            return "카페,디저트>카페"
        if re.search(r"술집|주점|펍|이자카야|포차|와인", text):
            return "술집"
        return "음식점>" + ((it.get("tag") or "").split(",")[0].strip() or "음식점")
    if re.search(r"박물관|미술관|갤러리|전시|기념관", text):
        return "관광지>박물관"
    if re.search(r"체험|테마파크|승마|카트|서핑|요트|잠수함", text):
        return "관광지>레저,테마"
    return "관광지>" + ((it.get("tag") or "").split(",")[0].strip() or "명소")


def fetch(key: str, code: str, page: int) -> dict:
    q = urllib.parse.urlencode({"apiKey": key, "locale": "kr", "category": code, "page": page})
    req = urllib.request.Request(f"{URL}?{q}", headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as res:
        return json.load(res)


def row(code: str, it: dict, now: str) -> dict | None:
    if not (it.get("latitude") and it.get("longitude") and it.get("title")):
        return None
    tags = [t.strip() for t in (it.get("alltag") or it.get("tag") or "").split(",") if t.strip()]
    return {
        "id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"visitjeju:{it['contentsid']}")),
        "name": it["title"].strip(), "category": category(code, it),
        "address": it.get("address") or "", "road_address": it.get("roadaddress") or "",
        "lat": it["latitude"], "lng": it["longitude"],
        "link": f"https://www.visitjeju.net/kr/detail/view?contentsid={it['contentsid']}",
        "phone": it.get("phoneno") or "", "business_hours": "", "menu": "", "tags": str(tags[:10]),
        "area": (it.get("region2cd") or {}).get("label") or "", "event_start": "", "event_end": "",
        "source": "visitjeju", "review_text": it.get("introduction") or "",
        "raw_json": json.dumps(it, ensure_ascii=False), "fetched_at": now,
    }


def main() -> None:
    key = env("VISITJEJU_API_KEY")
    if not key:
        raise SystemExit("backend/.env 에 VISITJEJU_API_KEY 가 필요합니다")
    now = datetime.now(timezone.utc).isoformat()
    rows: dict[str, dict] = {}
    for code, label in CATEGORIES.items():
        page, pages = 1, 1
        while page <= pages:
            data = fetch(key, code, page)
            if data.get("result") not in (None, "00", "200"):
                raise SystemExit(f"API 오류 {data.get('result')}: {data.get('resultMessage')}")
            pages = data.get("pageCount") or 1
            for it in data.get("items") or []:
                if r := row(code, it, now):
                    rows[r["id"]] = r
            page += 1
        print(f"{label}: {pages}페이지 수집, 누적 {len(rows)}곳")

    with open(OUT, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS)
        w.writeheader()
        w.writerows(rows.values())
    print(f"→ {OUT.relative_to(ROOT)} {len(rows)}행")


if __name__ == "__main__":
    main()
