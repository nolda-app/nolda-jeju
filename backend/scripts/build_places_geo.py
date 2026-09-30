"""backend/data/places_mapo.csv(장소 수집 파이프라인 최종본) 좌표 채우기·필터·분류 점검.
  (장소 데이터는 Supabase `places`에 있음 — DB 반영은 scripts/load_places_to_db.py)

- 좌표 없는 행(주로 블로그 팝업)은 주소로 네이버 Geocoding 해서 채움 (결과는 geocode_cache.json에 저장, 재호출 안 함)
- 코스에 안 맞는 업종(병원·미용·학원·편의점 등), 기간 끝난 팝업, 좌표를 끝내 못 찾은 행은 제외
- 같은 이름 + 같은 위치로 중복된 행은 하나만 남김

준비: backend/.env 에 NCP Maps 앱 키 (NCP_CLIENT_ID / NCP_CLIENT_SECRET, 또는 기존 이름 'Client ID' / 'Client Secret')
      — 없으면 Geocoding 단계만 건너뜀
실행: python backend/scripts/build_places_geo.py
"""
import csv, html, json, os, re, urllib.error, urllib.parse, urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "backend" / "data" / "places_mapo.csv"
CACHE = ROOT / "backend" / "data" / "geocode_cache.json"
ENV = ROOT / "backend" / ".env"
GEOCODE_URL = "https://maps.apigw.ntruss.com/map-geocode/v2/geocode"

# 코스 후보로 남길 업종 (카테고리 부분 일치)
KEEP = re.compile(
    r"음식점|한식|양식|일식|중식|분식|이탈리아음식|육류|카페|디저트|베이커리|브런치|술집"
    r"|노래방|보드카페|볼링장|오락실|만화방|암벽등반|스크린야구|야구연습장|멀티방|방탈출|당구장|PC방|찜질|사우나|목욕|공방|꽃꽂이|캠핑|테마파크|레저,테마"
    r"|전시|갤러리|화랑|복합문화공간|영화관|박물관|팝업스토어|서점"
    r"|공원|전망대|유적지|거리,골목|도보코스|동물원|시장"
    r"|헬스장|요가원|필라테스|스포츠시설|배드민턴장|구민체육센터"
)
# KEEP에 걸려도 제외할 업종
DROP = re.compile(r"키즈카페|유흥주점|부속시설|관리|자동차|대행|광고|다이어트|교육|교습|협회|장소대여")
NAME_KEEP = re.compile(r"클라이밍|배팅센터|산악문화")

# 위에서부터 먼저 걸리는 종류로 분류 (예: '방탈출카페'는 카페가 아니라 체험)
RULES = [
    ("체험", r"방탈출|보드카페|고양이카페|노래방|볼링장|오락실|만화방|암벽등반|스크린야구|야구연습장|멀티방|당구장|PC방|찜질|사우나|목욕|공방|꽃꽂이|캠핑|테마파크|레저,테마"),
    ("운동", r"헬스장|요가원|필라테스|스포츠시설|배드민턴장|구민체육센터"),
    ("문화", r"전시|갤러리|화랑|복합문화공간|영화관|박물관|팝업스토어|서점"),
    ("산책", r"공원|전망대|유적지|거리,골목|도보코스|시장|동물원"),
    ("한잔", r"술집"),
    ("식사", r"브런치|음식점>(?!카페)|한식|양식|일식|중식|분식|이탈리아음식|육류"),
    ("카페", r"카페|디저트|베이커리"),
]
NAME_RULES = [("체험", r"클라이밍|배팅센터|산악문화")]
KINDS = ["식사", "카페", "한잔", "체험", "문화", "산책", "운동"]


def env(*names: str) -> str:
    for name in names:
        if os.getenv(name):
            return os.environ[name]
    if ENV.exists():
        pairs = dict(line.partition("=")[::2] for line in ENV.read_text(encoding="utf-8-sig").splitlines() if "=" in line)
        pairs = {k.strip(): v.strip().strip('"').strip("'") for k, v in pairs.items()}
        for name in names:
            if pairs.get(name):
                return pairs[name]
    return ""


def address_queries(r: dict) -> list[str]:
    """'양화로 188 (동교동, 애경타워) AK PLAZA 4층' → '...양화로 188' 처럼 층·건물명을 떼어낸 검색어 후보"""
    out = []
    for addr in (r["road_address"], r["address"]):
        if not addr:
            continue
        # '홍익로6길 57'이 '홍익로6'에서 잘리지 않도록 번지 앞 공백 필수
        m = re.match(r"(.+?(?:로|길)\s+\d+(?:-\d+)?)", addr) or re.match(r"(.+?동\s+\d+(?:-\d+)?)", addr)
        for q in (m.group(1) if m else None, addr):
            if q and q not in out:
                out.append(q)
    return out


def fill_coords(rows: list[dict]) -> None:
    missing = [r for r in rows if not (r["lat"] and r["lng"]) and (r["road_address"] or r["address"])]
    if not missing:
        return
    cid, secret = env("NCP_CLIENT_ID", "Client ID"), env("NCP_CLIENT_SECRET", "Client Secret")
    cache = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}
    if not (cid and secret) and not cache:
        print(f"! NCP 키가 없어 Geocoding 건너뜀 (좌표 없는 {len(missing)}곳 제외)")
        return

    filled = calls = 0
    for r in missing:
        for q in address_queries(r):
            if q not in cache and cid and secret:
                req = urllib.request.Request(f"{GEOCODE_URL}?query={urllib.parse.quote(q)}", headers={
                    "x-ncp-apigw-api-key-id": cid, "x-ncp-apigw-api-key": secret, "Accept": "application/json"})
                try:
                    with urllib.request.urlopen(req, timeout=10) as res:
                        hits = json.load(res).get("addresses", [])
                except urllib.error.HTTPError as e:
                    raise SystemExit(f"Geocoding 오류 {e.code}: {e.read().decode(errors='replace')[:200]}")
                calls += 1
                # 제주 밖으로 잘못 잡힌 결과는 버림
                hit = next((h for h in hits if "제주" in (h.get("roadAddress", "") + h.get("jibunAddress", ""))), None)
                cache[q] = [float(hit["y"]), float(hit["x"])] if hit else None
            if cache.get(q):
                r["lat"], r["lng"] = str(cache[q][0]), str(cache[q][1])
                filled += 1
                break

    CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Geocoding: 좌표 없는 {len(missing)}곳 중 {filled}곳 채움 (API 호출 {calls}회, 나머지는 캐시)")


def norm(s: str) -> str:
    return re.sub(r"[\s()\[\]·,.\-_/]", "", s).lower()


def usable(r: dict) -> bool:
    cat = r["category"]
    if not (r["lat"] and r["lng"] and cat) or DROP.search(cat):
        return False
    return bool(KEEP.search(cat) or NAME_KEEP.search(r["name"]))


def classify(name: str, cat: str) -> str | None:
    for kind, pat in NAME_RULES:
        if re.search(pat, name):
            return kind
    for kind, pat in RULES:
        if re.search(pat, cat):
            return kind
    return None


def main() -> None:
    with open(SRC, encoding="utf-8-sig", newline="") as f:
        all_rows = list(csv.DictReader(f))
    for r in all_rows:
        r["name"] = html.unescape(r["name"])

    today = date.today().isoformat()
    active = [r for r in all_rows if not (r.get("event_end") and r["event_end"] < today)]
    fill_coords(active)

    rows, seen = [], set()
    for r in active:
        if not usable(r):
            continue
        key = (norm(r["name"]), round(float(r["lat"]), 4), round(float(r["lng"]), 4))
        if key in seen:
            continue
        seen.add(key)
        rows.append(r)

    groups: dict[str, list[dict]] = {k: [] for k in KINDS}
    unknown = []
    for r in rows:
        kind = classify(r["name"], r["category"])
        (groups[kind] if kind else unknown).append(r)
    if unknown:
        raise SystemExit("분류 안 된 장소: " + ", ".join(f"{r['name']}({r['category']})" for r in unknown))

    expired = len(all_rows) - len(active)
    print(f"{SRC.name} {len(all_rows)}행 (기간 끝난 팝업 {expired} 제외) → 코스 후보 {len(rows)}곳")
    for kind in KINDS:
        print(f"  {kind}: {len(groups[kind])}")


if __name__ == "__main__":
    main()
