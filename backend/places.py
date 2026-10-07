"""코스 생성용 장소 후보 — Supabase `places` 테이블에서 읽음.

load_places_csv: 원본 CSV(data/places_jeju.csv + data/geocode_cache.json)에서 읽기. DB 적재 스크립트(scripts/load_places_to_db.py)용.
필터·분류·중복 제거 규칙은 scripts/build_places_geo.py와 같다.
"""
import csv, html, json, math
from pathlib import Path
from datetime import date
from functools import lru_cache

from scripts.build_places_geo import CACHE, SRC, address_queries, classify, norm, usable

# 프론트 지역 필터(COND area)와 같은 동네 이름 → 기준점
AREA_CENTERS = {
    "제주시내": (33.5130, 126.5270), "애월": (33.4630, 126.3100), "협재": (33.3940, 126.2400),
    "함덕": (33.5430, 126.6690), "월정": (33.5563, 126.7960), "성산": (33.4600, 126.9330),
    "서귀포": (33.2490, 126.5620), "중문": (33.2500, 126.4120),
}
AREA_RADIUS_M = {"중문": 2500, "성산": 2000}  # 관광단지·일출봉 주변이 넓게 퍼져 있음
DEFAULT_RADIUS_M = 1500  # 제주는 마포보다 장소 밀도가 낮음
# DB엔 예전 마포 장소도 남아 있어서 위도로 제주만 읽는다 (마포로 돌아가려면 (37.4, 37.7))
REGION_LAT = (33.0, 34.0)


def meters(a: tuple[float, float], b: tuple[float, float]) -> float:
    dy = (a[0] - b[0]) * 111_000
    dx = (a[1] - b[1]) * 111_000 * math.cos(math.radians((a[0] + b[0]) / 2))
    return math.hypot(dx, dy)


PAGE = 1000  # Supabase 한 번에 최대 1000행
# 업체 대표사진 (Supabase Storage images 버킷에 올린 결과, scripts/scrape_place_images.py).
# places.image_url 컬럼이 있으면 그 값을 먼저 쓰고, 없으면 이 목록으로 채움
IMAGES_CSV = Path(__file__).parent / "data" / "place_images.csv"


@lru_cache(maxsize=1)
def image_urls() -> dict[str, str]:
    out: dict[str, str] = {}
    # 비짓제주 장소는 수집할 때 받은 대표사진(repPhoto)을 그대로 쓴다
    if SRC.exists():
        with open(SRC, encoding="utf-8-sig", newline="") as f:
            for r in csv.DictReader(f):
                try:
                    img = ((json.loads(r.get("raw_json") or "{}").get("repPhoto") or {}).get("photoid") or {}).get("imgpath")
                except ValueError:
                    img = None
                if img:
                    out[r["id"]] = img
    if IMAGES_CSV.exists():
        with open(IMAGES_CSV, encoding="utf-8-sig", newline="") as f:
            out.update({r["pid"]: r["image_url"] for r in csv.DictReader(f) if r["status"] == "ok" and r["image_url"]})
    return out


# 인기도 0~1 (Tmap 내비 관광객 도착 수 백분위, scripts/build_popularity.py). 없는 곳은 0
POPULARITY_CSV = Path(__file__).parent / "data" / "place_popularity.csv"


@lru_cache(maxsize=1)
def popularity() -> dict[str, float]:
    if not POPULARITY_CSV.exists():
        return {}
    with open(POPULARITY_CSV, encoding="utf-8-sig", newline="") as f:
        return {r["pid"]: float(r["pop"]) for r in csv.DictReader(f)}


@lru_cache(maxsize=1)
def _venue_tags() -> dict[str, list[str]]:
    """places 테이블의 tags(가족동반/데이트/모임 같은 장소 특징) — id -> 태그 목록. DB 접속 실패해도 코스 생성은 계속돼야 하니 빈 dict로 넘어간다"""
    try:
        from db import get_client

        res = get_client().table("places").select("id,tags").execute()
        return {r["id"]: r["tags"] or [] for r in res.data}
    except Exception:
        return {}


@lru_cache(maxsize=1)
def load_places() -> tuple[dict, ...]:
    """DB의 장소 전체 (서버 켜진 동안 캐시)"""
    from db import get_client

    rows, start = [], 0
    while True:
        res = (get_client().table("places")
               .select("*")
               .gte("lat", REGION_LAT[0]).lt("lat", REGION_LAT[1])
               .order("id").range(start, start + PAGE - 1).execute())
        rows += res.data
        if len(res.data) < PAGE:
            break
        start += PAGE
    return tuple({
        "id": r["id"], "name": r["name"], "cat": r["category"] or "", "addr": r["address"] or "",
        "lat": float(r["lat"]), "lng": float(r["lng"]), "kind": r["kind"],
        "area": r["area"], "tags": r["tags"] or [], "hours": r["business_hours"], "price": r["price_per_person"],
        "img": r.get("image_url") or image_urls().get(r["id"]),
        "pop": popularity().get(r["id"], 0.0),
    } for r in rows if r["lat"] is not None and r["lng"] is not None and r["kind"])


@lru_cache(maxsize=1)
def load_places_csv() -> tuple[dict, ...]:
    cache = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}
    venue_tags = _venue_tags()
    today = date.today().isoformat()
    out, seen = [], set()
    with open(SRC, encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            r["name"] = html.unescape(r["name"])
            if r.get("event_end") and r["event_end"] < today:
                continue
            if not (r["lat"] and r["lng"]):
                hit = next((cache[q] for q in address_queries(r) if cache.get(q)), None)
                if not hit:
                    continue
                r["lat"], r["lng"] = str(hit[0]), str(hit[1])
            if not usable(r):
                continue
            key = (norm(r["name"]), round(float(r["lat"]), 4), round(float(r["lng"]), 4))
            if key in seen:
                continue
            seen.add(key)
            out.append({
                "id": r["id"], "name": r["name"], "cat": r["category"], "addr": r["road_address"] or r["address"],
                "lat": float(r["lat"]), "lng": float(r["lng"]), "kind": classify(r["name"], r["category"]),
                "venue_tags": venue_tags.get(r["id"], []),
            })
    return tuple(out)


@lru_cache(maxsize=None)
def candidates_by_area(area: str) -> dict[str, list[dict]]:
    """동네 기준점 반경 안의 장소를 종류별로, 가까운 순서대로"""
    center = AREA_CENTERS[area]
    radius = AREA_RADIUS_M.get(area, DEFAULT_RADIUS_M)
    out: dict[str, list[dict]] = {}
    for d, p in sorted(((meters(center, (p["lat"], p["lng"])), p) for p in load_places()), key=lambda x: x[0]):
        if d > radius:
            break
        out.setdefault(p["kind"], []).append(p)
    return out


DETAIL_FIELDS = "id,phone,business_hours,menu_summary,price_per_person,image_url"


def place_details(ids: list[str]) -> dict[str, dict]:
    """places 테이블(scripts/places_table.sql)에서 전화/영업시간/가격/대표사진 조회 — id 기준, 없는 곳은 결과에서 빠짐"""
    if not ids:
        return {}
    from db import get_client

    res = get_client().table("places").select(DETAIL_FIELDS).in_("id", ids).execute()
    return {r["id"]: r for r in res.data}
