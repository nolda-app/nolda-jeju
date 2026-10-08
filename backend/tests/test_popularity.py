"""인기 장소(Tmap 내비 도착) ↔ 우리 장소 매칭"""
import csv

import pytest

from scripts import build_popularity as bp


def test_지번_추출():
    assert bp.jibun("제주 제주시 한경면 저지리 2055") == ("저지리", "2055")
    assert bp.jibun("제주특별자치도 서귀포시 호근동 479-5") == ("호근동", "479-5")
    assert bp.jibun("제주특별자치도 제주시 한림읍 귀덕리") is None  # 번지 없음


def write(path, header, rows):
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)


@pytest.fixture
def run(tmp_path, monkeypatch):
    src, places, out = tmp_path / "pop.csv", tmp_path / "places.csv", tmp_path / "out.csv"
    monkeypatch.setattr(bp, "SRC", src)
    monkeypatch.setattr(bp, "PLACES", places)
    monkeypatch.setattr(bp, "OUT", out)
    write(src, ["주행일자(YYYYMM)", "목적지명", "목적지주소", "읍면동코드", "읍면동명", "도착건수", "카테고리 3단계", "관광객 도착 수", "도민 도착 수"], [
        ["202607", "우진해장국", "제주 제주시 삼도이동 831", "", "", "", "", "100", "50"],
        ["202608", "우진해장국 본점", "제주 제주시 삼도이동 831", "", "", "", "", "200", "50"],  # 같은 곳 다른 표기 → 합침
        ["202608", "델문도", "제주 제주시 조천읍 함덕리 1008", "", "", "", "", "300", "0"],
        ["202608", "카페", "제주 제주시 이도이동 1", "", "", "", "", "10", "0"],  # 이름 '카페'가 두 곳 → 주소 없이는 못 맞춤
        ["202608", "카페", "제주 서귀포시 서귀동 2", "", "", "", "", "10", "0"],
        ["202608", "조용한곳", "제주 제주시 애월읍 애월리 5", "", "", "", "", "0", "7"],
    ])
    write(places, ["id", "name", "address"], [
        ["a", "우진해장국", "제주특별자치도 제주시 삼도이동 831"],
        ["b", "델문도", "다른 주소"],  # 주소는 다르지만 이름이 하나뿐 → 이름으로 매칭
        ["c", "카페", "주소 없음"],
        ["d", "조용한곳", "제주특별자치도 제주시 애월읍 애월리 5"],
    ])

    def go() -> dict[str, dict]:
        bp.main()
        with open(out, encoding="utf-8-sig", newline="") as f:
            return {r["pid"]: r for r in csv.DictReader(f)}

    return go


def test_주소_이름_매칭과_백분위(run):
    rows = run()
    assert set(rows) == {"a", "b", "d"}  # c는 이름이 겹쳐 못 맞춤
    assert (rows["a"]["tourist"], rows["a"]["local"]) == ("300", "100")
    assert float(rows["b"]["pop"]) == 1.0  # 관광객 300 — 가장 많음
    assert float(rows["d"]["pop"]) == 0  # 관광객 0명이면 순위와 상관없이 0
