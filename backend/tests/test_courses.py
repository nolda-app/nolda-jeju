"""코스 규칙 — 산책 1회, 식사 70분, 종류 연달아 금지, 인기도 가중. DB·LLM 없이 가짜 장소로 돈다."""
import random

import pytest

import courses
from courses import AREA_CENTERS, CourseRequest, fill_stays, pop_label, pop_weight, rule_course, to_course

AREA = "함덕"
LAT, LNG = AREA_CENTERS[AREA]


def place(pid: str, kind: str, n: int = 0, pop: float = 0.0) -> dict:
    """기준점에서 동쪽으로 n×100m 떨어진 장소"""
    return {"id": pid, "name": pid, "kind": kind, "cat": kind, "lat": LAT, "lng": LNG + n * 0.0011,
            "tags": [], "hours": None, "price": None, "pop": pop}


PLACES = [place(f"{k}{i}", k, i, pop=i / 10) for k in ("식사", "카페", "산책", "체험", "문화", "한잔") for i in range(6)]


@pytest.fixture(autouse=True)
def fake_places(monkeypatch):
    by_kind: dict[str, list[dict]] = {}
    for p in PLACES:
        by_kind.setdefault(p["kind"], []).append(p)
    monkeypatch.setattr(courses, "candidates_by_area", lambda area: by_kind)


def req(**kw) -> CourseRequest:
    return CourseRequest.model_validate(kw)


def raw(kinds_minutes: list[tuple[str, int]], title: str = "바다 보고 쉬기") -> tuple[dict, dict]:
    """LLM 응답 1개 + 후보(ref → 장소)"""
    refs = {f"p{i}": place(f"{k}-{i}", k, i) for i, (k, _) in enumerate(kinds_minutes)}
    return {
        "title": title, "why": "바다를 보며 쉬어 가요", "area": AREA, "start_hour": 12,
        "traits": {"mood": "calm", "crowd": "mid", "hour": "noon", "spend": "cafe", "pace": "low"}, "tags": ["자연"],
        "items": [{"ref": f"p{i}", "minutes": m, "cost": 10000, "note": "천천히 둘러보기"} for i, (_, m) in enumerate(kinds_minutes)],
    }, refs


class TestFillStays:
    def test_시간을_딱_채운다(self):
        assert sum(fill_stays([60, 60, 60], 200, ["카페", "산책", "체험"])) == 200

    def test_식사는_70분을_넘지_않는다(self):
        stays = fill_stays([60, 60], 400, ["식사", "카페"])
        assert stays[0] <= 70

    def test_장소가_너무_많아_시간에_못_넣으면_None(self):
        assert fill_stays([40] * 5, 100, ["식사"] * 5) is None


class TestCheckCourse:
    def test_정상_코스는_통과하고_식사_체류를_70분으로_자른다(self):
        r, refs = raw([("식사", 100), ("산책", 40), ("카페", 50)])
        c = to_course(0, r, refs, req())
        assert c is not None
        assert c["items"][0]["d"] == 70

    @pytest.mark.parametrize("kinds, why", [
        ([("산책", 40), ("카페", 50), ("산책", 40)], "같은 종류 과다"),  # 공원만 두 번
        ([("식사", 60), ("식사", 60)], "식사·카페·한잔 연달아"),  # 2곳이라 순서를 바꿔도 못 살림
    ])
    def test_규칙_위반은_탈락(self, kinds, why):
        r, refs = raw(kinds)
        reasons: list[str] = []
        assert to_course(0, r, refs, req(), reasons=reasons) is None
        assert why in reasons

    def test_근거_없는_평가_표현은_탈락(self):
        r, refs = raw([("식사", 60), ("산책", 40)], title="유명 맛집 코스")
        reasons: list[str] = []
        assert to_course(0, r, refs, req(), reasons=reasons) is None
        assert "근거 없는 표현" in reasons

    def test_순서만_문제면_순서를_바꿔_살린다(self):
        r, refs = raw([("식사", 60), ("카페", 40), ("카페", 40), ("체험", 60)])
        c = to_course(0, r, refs, req())
        assert c is not None and c.get("reordered")


class TestRuleCourse:
    @pytest.mark.parametrize("window", [(10, 16), (12, 18), (9, 21)])
    @pytest.mark.parametrize("crowd", [None, "quiet", "busy"])
    def test_산책은_1번_식사는_70분까지(self, window, crowd):
        r = req(taste={"crowd": crowd}, time_window={"start": window[0], "end": window[1]})
        for seed in range(5):
            c = rule_course(AREA, r, random.Random(seed), set())
            assert c is not None
            kinds = [i["k"] for i in c["items"]]
            assert kinds.count("산책") <= 1
            assert all(i["d"] <= 70 for i in c["items"] if i["k"] == "식사")

    def test_조용한_곳_취향이면_덜_붐비는_곳을_고른다(self):
        def avg_pop(crowd):
            r = req(taste={"crowd": crowd})
            items = [i for s in range(20) for i in rule_course(AREA, r, random.Random(s), set())["items"]]
            by_id = {p["id"]: p for p in PLACES}
            return sum(by_id[i["pid"]]["pop"] for i in items) / len(items)

        assert avg_pop("quiet") < avg_pop("busy")


def test_인기도_가중치와_표시():
    assert pop_weight(req(taste={"crowd": "busy"})) > 0 > pop_weight(req(taste={"crowd": "quiet"}))
    assert pop_weight(None) == 0.5
    assert [pop_label({"pop": v}) for v in (0.9, 0.5, 0.1, 0)] == ["붐빔", "보통", "한적", "-"]
