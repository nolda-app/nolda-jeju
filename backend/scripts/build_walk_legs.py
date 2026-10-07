"""도보 경로 API로 코스 구간별 실제 도보 거리·시간을 받아 data.ts의 LEGS를 갱신.

준비: backend/.env 에 둘 중 하나
  ORS_API_KEY=...   (OpenRouteService, 우선 사용)
  TMAP_APP_KEY=...  (TMAP 보행자 경로)
실행: python backend/scripts/build_walk_legs.py
      python backend/scripts/build_walk_legs.py --routes-only   (API 호출 없이 저장된 JSON으로 routes.ts만 재생성)
결과: frontend/src/planner/data.ts 의 LEGS 교체
      + frontend/src/planner/routes.ts (지도에 그릴 도보 경로)
      + backend/data/walk_legs.json (API 응답 원본)
"""
import csv, json, math, os, re, sys, time, urllib.error, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ENV = ROOT / "backend" / ".env"
PLACES = ROOT / "backend" / "data" / "places_jeju.csv"
DATA_TS = ROOT / "frontend" / "src" / "planner" / "data.ts"
OUT_JSON = ROOT / "backend" / "data" / "walk_legs.json"
ROUTES_TS = ROOT / "frontend" / "src" / "planner" / "routes.ts"
TMAP_URL = "https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1"
ORS_URL = "https://api.openrouteservice.org/v2/directions/foot-walking/geojson"


def env(name: str) -> str:
    val = os.getenv(name, "")
    if not val and ENV.exists():
        for line in ENV.read_text(encoding="utf-8-sig").splitlines():
            k, _, v = line.partition("=")
            if k.strip() == name:
                val = v.strip().strip('"').strip("'")
    return val


def provider() -> tuple[str, str]:
    for name, kind in [("ORS_API_KEY", "ors"), ("TMAP_APP_KEY", "tmap")]:
        if key := env(name):
            return kind, key
    raise SystemExit("backend/.env 에 ORS_API_KEY 또는 TMAP_APP_KEY 를 추가하세요")


def courses(ts: str) -> list[tuple[str, list[str]]]:
    out = []
    for m in re.finditer(r"\{ id: '(c\d+)'[\s\S]*?items: \[([\s\S]*?)\] \},", ts):
        pids = re.findall(r"pid: '([0-9a-f-]{36})'", m.group(2))
        out.append((m.group(1), pids))
    return out


def post(url: str, body: dict, headers: dict) -> dict:
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "Accept": "application/json", **headers})
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            return json.load(res)
    except urllib.error.HTTPError as e:
        raise SystemExit(f"API 오류 {e.code}: {e.read().decode(errors='replace')[:300]}")


def walk(kind: str, key: str, a: dict, b: dict) -> dict:
    start = [float(a["lng"]), float(a["lat"])]
    end = [float(b["lng"]), float(b["lat"])]

    if kind == "ors":
        geo = post(ORS_URL, {"coordinates": [start, end]}, {"Authorization": key})
        f = geo["features"][0]
        return {"meters": f["properties"]["summary"]["distance"],
                "seconds": f["properties"]["summary"]["duration"],
                "path": f["geometry"]["coordinates"]}

    geo = post(TMAP_URL, {
        "startX": start[0], "startY": start[1], "endX": end[0], "endY": end[1],
        "startName": a["name"], "endName": b["name"],
        "reqCoordType": "WGS84GEO", "resCoordType": "WGS84GEO",
    }, {"appKey": key})
    props = geo["features"][0]["properties"]
    path = [pt for f in geo["features"] if f["geometry"]["type"] == "LineString" for pt in f["geometry"]["coordinates"]]
    return {"meters": props["totalDistance"], "seconds": props["totalTime"], "path": path}


def label(meters: float) -> str:
    return f"{meters / 1000:.1f}km" if meters >= 1000 else f"{round(meters / 10) * 10}m"


def write_routes(raw: dict) -> None:
    """API 경로([경도, 위도])를 지도용 [위도, 경도]로 바꿔 routes.ts 생성 (연속 중복점 제거)"""
    lines = [
        "// 자동 생성: backend/scripts/build_walk_legs.py — 직접 수정 금지",
        "/** 코스별 구간 도보 경로. 구간마다 [위도, 경도] 점 목록 */",
        "export const WALK_PATHS: Record<string, [number, number][][]> = {",
    ]
    for cid, legs in raw.items():
        if cid == "provider":
            continue
        segs = []
        for leg in legs:
            pts, prev = [], None
            for pt in leg["path"]:
                p = (round(pt[1], 6), round(pt[0], 6))
                if p != prev:
                    pts.append(f"[{p[0]}, {p[1]}]")
                    prev = p
            segs.append("[" + ", ".join(pts) + "]")
        lines.append(f"  {cid}: [\n    " + ",\n    ".join(segs) + ",\n  ],")
    lines.append("}")
    ROUTES_TS.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    if "--routes-only" in sys.argv:
        write_routes(json.loads(OUT_JSON.read_text(encoding="utf-8")))
        print(f"routes.ts 생성 완료 → {ROUTES_TS.name}")
        return

    kind, key = provider()
    print(f"사용 API: {kind.upper()}\n")
    with open(PLACES, encoding="utf-8-sig", newline="") as f:
        by_id = {r["id"]: r for r in csv.DictReader(f)}

    ts = DATA_TS.read_text(encoding="utf-8")
    legs_ts, raw = [], {"provider": kind}
    for cid, pids in courses(ts):
        places = [by_id[p] for p in pids]
        legs = []
        for a, b in zip(places, places[1:]):
            r = walk(kind, key, a, b)
            minutes = max(1, math.ceil(r["seconds"] / 60))
            legs.append(f"{{ m: '도보', t: {minutes}, d: '{label(r['meters'])}' }}")
            raw.setdefault(cid, []).append({"from": a["name"], "to": b["name"], **r})
            print(f"{cid} {a['name']} → {b['name']}: {label(r['meters'])}, {minutes}분")
            time.sleep(1.6 if kind == "ors" else 0.3)  # ORS 무료: 분당 요청 제한 여유
        legs_ts.append(f"  {cid}: [{', '.join(legs)}],")

    block = "export const LEGS: Record<string, { m: string; t: number; d: string }[]> = {\n" + "\n".join(legs_ts) + "\n}"
    new_ts, n = re.subn(r"export const LEGS: Record<string, \{ m: string; t: number; d: string \}\[\]> = \{[\s\S]*?\n\}", block, ts)
    if n != 1:
        raise SystemExit("data.ts 에서 LEGS 블록을 찾지 못했어요")
    DATA_TS.write_text(new_ts, encoding="utf-8")
    OUT_JSON.write_text(json.dumps(raw, ensure_ascii=False, indent=1), encoding="utf-8")
    write_routes(raw)
    print(f"\nLEGS 갱신 완료 → {DATA_TS.name}, 지도 경로 → {ROUTES_TS.name}, 원본 → {OUT_JSON.name}")


if __name__ == "__main__":
    main()
