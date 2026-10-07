"""제주관광빅데이터플랫폼 '제주 지역별 인기 장소'(Tmap 내비 목적지 도착 수, 월별) → backend/data/place_popularity.csv

places_jeju.csv의 장소와 '지번 주소 + 이름'으로 맞추고, 안 되면 이름이 하나뿐일 때만 이름으로 맞춘다.
점수(pop)는 관광객 도착 수의 백분위(0~1) — 못 맞춘 곳(순례길·포구·해안도로처럼 내비 목적지로 잘 안 찍히는 곳)은 파일에 없음.

준비: data.ijto.or.kr 데이터 픽 > 제주 지역별 인기 장소 CSV(최근 12개월)를 backend/data/에 그대로 저장
실행: python backend/scripts/build_popularity.py
"""
import csv, re, sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_places_geo import norm  # noqa: E402

DATA = Path(__file__).resolve().parents[1] / "data"
SRC = DATA / "제주 지역별 인기 장소.csv"
PLACES = DATA / "places_jeju.csv"
OUT = DATA / "place_popularity.csv"


def jibun(addr: str) -> tuple[str, str] | None:
    """'제주 제주시 한경면 저지리 2055' → ('저지리', '2055') — 두 자료의 주소 앞부분 표기가 달라 리·동 + 번지만 비교"""
    m = re.search(r"(\S+[동리가])\s+(산?\d+(?:-\d+)?)", addr or "")
    return (m.group(1), m.group(2)) if m else None


def similar(a: str, b: str) -> bool:
    return a in b or b in a


def main() -> None:
    arrivals: dict[tuple[str, str], list[int]] = defaultdict(lambda: [0, 0])  # (이름, 주소) → [관광객, 도민]
    with open(SRC, encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            a = arrivals[(r["목적지명"], r["목적지주소"])]
            a[0] += int(r["관광객 도착 수"] or 0)
            a[1] += int(r["도민 도착 수"] or 0)
    by_addr: dict[tuple[str, str], list[tuple[str, str]]] = defaultdict(list)
    by_name: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for key in arrivals:
        by_name[norm(key[0])].append(key)
        if j := jibun(key[1]):
            by_addr[j].append(key)

    matched: dict[str, list[int]] = {}
    with open(PLACES, encoding="utf-8-sig", newline="") as f:
        for p in csv.DictReader(f):
            n = norm(p["name"])
            keys = [k for k in by_addr.get(jibun(p["address"]), []) if similar(norm(k[0]), n)] or (
                by_name[n] if len(by_name.get(n, [])) == 1 else [])
            if keys:  # 같은 곳이 이름 표기만 달리 여러 줄이면 합친다
                matched[p["id"]] = [sum(arrivals[k][i] for k in keys) for i in (0, 1)]

    ranked = sorted(matched, key=lambda pid: matched[pid][0])
    with open(OUT, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["pid", "tourist", "local", "pop"])
        for i, pid in enumerate(ranked):
            w.writerow([pid, *matched[pid], round((i + 1) / len(ranked), 3) if matched[pid][0] else 0])
    print(f"{len(arrivals)}개 목적지 → places {len(matched)}곳 매칭 → {OUT.name}")


if __name__ == "__main__":
    main()
