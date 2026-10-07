"""취향·조건 → LLM(GPT)이 후보 장소 안에서만 코스를 짜고, 서버가 검증해 프론트 Course 형태로 반환.

LLM은 장소를 지어내지 못하게 짧은 ref(p1, p2…)로만 고르고, 없는 ref·먼 구간·시간/예산 초과 코스는 서버가 버린다.
코스는 항상 N_COURSES개:
  ① 취향 맞춤(taste) — LLM이 사용자 취향으로 짜고, 서버가 엄격하게 검증(취향 종류가 빠진 코스도 탈락)
  ② 추가 추천(db) — ①이 모자란 개수만큼, ①에 안 쓴 DB 장소로 LLM이 무난한 코스를 다시 짬 (같은 엄격 검증)
  ③ 기본 코스(rule) — LLM 호출이 실패했거나 추가 추천을 두 번 받아도 모자랄 때만 규칙으로
"""
import hashlib, itertools, json, logging, math, os, random, re
from collections import Counter
from datetime import datetime, timedelta, timezone

from pydantic import BaseModel, Field

from places import AREA_CENTERS, candidates_by_area, meters

DEFAULT_MODEL = "gpt-5-mini"
N_COURSES = 4  # 응답으로 돌려줄 코스 수
N_REQUEST = 6  # GPT에 요청할 코스 수 — 서버 검증에서 일부 버려져도 4개를 채우기 위해 넉넉히
MAX_LEG_M = 2000  # 도보 한 구간 최대 (직선×1.3 추정)
KST = timezone(timedelta(hours=9))
log = logging.getLogger(__name__)
COURSE_KINDS = ["식사", "카페", "한잔", "체험", "문화", "산책"]
TINTS = ["#00A46E", "#8FBF2E", "#00795A", "#4FA3A5"]
TAGS = ["전시", "야경", "사진", "로컬", "기록", "자연"]
# 데이터로 확인할 수 없는 평가·혼잡도 표현 — 프롬프트로 막아도 새어 나와서 서버에서 한 번 더 거름
UNVERIFIED = re.compile(r"인기|유명|맛집|한적|붐비지|웨이팅")

# 프론트 data.ts Q 옵션과 같은 값·라벨
TRAITS = {
    "mood": {"calm": "힐링·휴식", "active": "운동·액티비티", "new": "새로운 경험", "food": "미식"},
    "crowd": {"busy": "활기찬", "mid": "편안한", "quiet": "조용한"},
    "hour": {"morning": "아침", "noon": "낮", "sunset": "노을 무렵", "night": "밤"},
    "spend": {"meal": "식사", "cafe": "카페·디저트", "drink": "술·바", "play": "전시·체험"},
    "pace": {"low": "적음", "mid": "중간", "high": "많음", "very": "매우 많음"},
}
TRAIT_NAMES = {"mood": "관심사", "crowd": "분위기", "hour": "시간대", "spend": "메인 코스", "pace": "활동성"}
# 일정 밀도 — 코스 성격(traits)이 아니라 코스 짜는 방식이라 따로 둠
# 값: (라벨, 장소 1곳당 평균 분(이동 포함), 장소 수 범위)
PLANS = {
    "tight": ("촘촘하게 여러 곳", 75, (3, 8)),
    "relaxed": ("여유롭게 한 곳에 오래", 120, (2, 5)),
}
COMPANIONS = {"solo": "혼자", "couple": "연인", "friends": "친구", "family": "가족", "coworkers": "동료"}
PLAN_DEFAULT = ("적당히", 95, (2, 6))
# 장소 종류별 현실적인 체류 시간(분). 시간을 꽉 채운다고 밥을 3시간 먹게 하면 안 된다.
STAY_RANGE = {
    "식사": (40, 70), "카페": (30, 120), "한잔": (50, 150),
    "체험": (45, 150), "문화": (30, 120), "산책": (20, 90),
}
STAY_DEFAULT = (30, 120)
# 연달아 두 번 오면 이상한 종류 — 밥 먹고 바로 또 밥, 카페 나와서 또 카페.
# 전시 두 곳 연달아 보기(문화)나 산책은 자연스러워서 뺐다
NO_REPEAT_ADJACENT = {"식사", "카페", "한잔"}
# 함께 가는 사람과 안 맞는 곳 (업종·이름) — 후보에서 아예 뺀다
NOT_FOR = {"family": re.compile(r"당구|PC방|피시방|노래|코인|오락실|술집|포차|이자카야|바|호프|펍|클럽|룸")}
MAX_SAME_KIND = {"카페": 2, "식사": 2, "한잔": 2, "산책": 1}  # 한 코스에 카페 3번, 공원·해변 두 번은 이상하다
# DB 가격도, LLM 추정도 없거나 0일 때 쓰는 1인 기본 금액 — 산책·문화(무료 전시 많음)만 0원 허용
DEFAULT_COST = {"식사": 15000, "카페": 7000, "한잔": 20000, "체험": 15000, "문화": 5000, "산책": 0}
# 동네를 고를 때 취향별로 많이 필요한 장소 종류
TASTE_KINDS = {
    "calm": ["산책", "카페"], "active": ["체험"], "new": ["문화", "체험"], "food": ["식사"],
    "cafe": ["카페"], "meal": ["식사"], "drink": ["한잔"], "play": ["체험", "문화"],
}

SYSTEM_PROMPT = """너는 제주도 여가·여행 코스 플래너야. 사용자 취향과 조건에 맞는 코스를 JSON으로 만든다.

규칙
1. 장소는 반드시 [후보 장소]의 ref로만 고른다. 목록에 없는 장소를 만들지 않는다.
2. 코스 하나의 장소 수는 [조건]의 장소 수를 따른다. 한 코스 안에서 같은 장소를 반복하지 않고, 코스끼리도 가능하면 겹치지 않게 한다.
   식사·카페·한잔은 같은 종류를 연달아 두 곳 넣지 않는다 (밥 먹고 바로 또 밥은 안 된다).
   식사는 한 코스에 최대 2번이고, 두 번이면 점심과 저녁이라 최소 4시간은 떨어져야 한다. 카페·한잔도 한 코스에 최대 2번.
   산책(공원·해변·산책로)은 한 코스에 1번만 넣는다.
   메인 코스 취향(예: 카페·디저트)이어도 그 종류는 코스당 1~2곳이고, 나머지는 산책·문화·체험·식사 등 다른 종류로 섞는다.
3. 이동은 도보다. 좌표가 가까운 장소끼리(구간당 약 1km 이내) 묶는다.
4. 시간 흐름이 자연스러운 순서로 배치하고 start_hour(0~23)를 정한다. [조건]에 시작 시각이 있으면 start_hour는 그 값이다.
   식사는 점심(12~13시)·저녁(18~19시) 무렵, 한잔은 저녁 이후에 둔다.
5. 사용자 취향과 사진 태그에 최대한 맞춘다. traits와 tags에는 그 코스의 실제 성격을 적는다.
   후보의 리뷰 태그(데이트·혼밥·가족동반·모임·조용함·시끌벅적함 등 — 그 장소가 실제로 어떤 손님·상황에
   맞는지 나타낸다)를 함께 가는 사람·분위기 취향·오늘 하고 싶은 것과 맞춰 우선 고른다.
   영업시간이 적힌 곳은 방문 시각에 문을 연 곳만 넣고, 1인 가격이 적힌 곳은 cost에 그 값을 쓴다.
6. minutes는 그 장소에 머무는 시간(분), cost는 1인 추정 금액(원). 공원·거리·무료 전시는 0.
7. note는 그 장소에서 할 일 한 줄. 영업시간·웨이팅·메뉴·가격처럼 확인되지 않은 사실은 쓰지 않는다.
   '인기', '유명', '맛집', '한적한', '붐비지 않는'처럼 근거 없는 평가·혼잡도 표현은 title·note·why 어디에도 쓰지 않는다.
8. why는 이 사용자에게 왜 맞는지 한두 문장, title은 15자 안팎.
9. [조건]에 시작·종료 시각이 있으면 첫 장소 도착부터 마지막 장소를 떠날 때까지(머무는 시간 + 이동 시간) 그 시간을 채운다.
   시간이 남는다고 한 곳에 오래 머물게 늘리지 말고, [조건]의 장소 수 범위 안에서 장소를 한 곳 더 넣어 채운다.
   시각이 없으면 조건의 시간(이동 포함)을 넘지 않는다. 1인 예산은 넘지 않는다.
11. minutes는 그 장소에서 실제로 보낼 만한 시간이어야 한다. 아래를 넘기지 않는다.
   식사 40~70분 · 카페 30~120분 · 한잔 50~150분 · 체험 45~150분 · 문화(전시) 30~120분 · 산책 20~90분.
   일정이 '촘촘하게'면 이 범위의 아래쪽으로 여러 곳, '여유롭게'면 위쪽으로 적은 곳을 간다.
   밥 한 끼에 3시간, 카페에 3시간처럼 현실에서 하지 않는 시간은 절대 적지 않는다.
12. 함께 가는 사람에 맞춘다. 혼자: 혼자 머물기 편한 곳, 연인: 둘이 대화하기 좋은 곳(장소 특징에 "데이트" 있으면 우선),
    친구: 같이 즐길 거리(장소 특징에 "모임"·"시끌벅적함" 있으면 우선),
    가족: 아이·어른 모두 편하게 쉬어 갈 수 있는 곳(한잔은 빼거나 짧게, 장소 특징에 "가족동반" 있으면 우선),
    동료: 대화하며 식사·한잔하기 좋은 곳. why에도 이유를 적는다.
10. area에는 [만들 코스]에서 지정한 동네를 코스 순서대로 그대로 적는다."""


FILL_NOTE = """[이번 요청] 취향 맞춤 코스가 모자라 채우는 '추가 추천' 코스다.
사용자 취향에 억지로 맞추지 말고, 후보 장소 안에서 그 동네를 무난하게 즐길 수 있는 좋은 조합을 만든다.
조건(시간·장소 수·예산·함께 가는 사람)과 규칙은 똑같이 지킨다. why에는 취향 분석 결과라고 쓰지 않는다."""


class Taste(BaseModel):
    mood: str | None = None
    crowd: str | None = None
    hour: str | None = None
    spend: str | None = None
    pace: str | None = None
    plan: str | None = None  # PLANS 키 (일정 밀도)
    companion: str | None = None  # COMPANIONS 키 (함께 가는 사람)


class TimeWindow(BaseModel):
    start: int = Field(ge=0, le=23)  # 시작 시각(시)
    end: int = Field(ge=1, le=24)  # 종료 시각(시), start보다 커야 함

    @property
    def minutes(self) -> int:
        return (self.end - self.start) * 60


class Cond(BaseModel):
    area: str = "any"
    hours: int = 0  # 0 = 상관없음
    people: int = 2
    budget: int = 0  # 1인, 0 = 상관없음


class Picked(BaseModel):
    """taste.py가 만든 동적 주제에서 사용자가 고른 답 — 주제 이름 · 고른 라벨 · 반영 방법 한 줄"""
    name: str
    labels: list[str] = []
    hint: str = ""


class CourseRequest(BaseModel):
    taste: Taste = Field(default_factory=Taste)
    tags: list[str] = []
    intent: str | None = None
    picked: list[Picked] = []
    cond: Cond = Field(default_factory=Cond)
    time_window: TimeWindow | None = None  # 있으면 이 시간을 꽉 채우는 코스만


class CoursePlanError(Exception):
    pass


def plan_of(req: CourseRequest) -> tuple[str, int, tuple[int, int]]:
    return PLANS.get(req.taste.plan or "", PLAN_DEFAULT)


# 체류 시간 상한의 평균 + 구간 이동 — "한 곳에서 최대한 오래 있어도 이만큼"의 기준
PER_PLACE_MAX = sum(hi for _, hi in STAY_RANGE.values()) // len(STAY_RANGE) + 15


def place_range(req: CourseRequest) -> tuple[int, int]:
    """코스 1개의 장소 수 범위 — 시간 창이 있으면 (총 시간 ÷ 1곳당 평균) ±1, 없으면 기존처럼 2~4"""
    if not req.time_window:
        return 2, 4
    _, per, (lo, hi) = plan_of(req)
    n = min(max(round(req.time_window.minutes / per), lo), hi)
    lo, hi = max(lo, n - 1), min(hi, n + 1)
    # 한 곳에 오래 머무는 데도 한도가 있어서, 장소가 적으면 시간을 채울 수가 없다.
    # 체류를 비현실적으로 늘리는 대신 최소 장소 수를 올린다 (밥 한 끼 3시간 방지)
    need = -(-req.time_window.minutes // PER_PLACE_MAX)  # 올림
    return min(max(lo, need), hi), hi


def pick_areas(req: CourseRequest) -> list[str]:
    """동네를 골랐으면 그 동네로 3개, '어디든'이면 취향에 필요한 장소가 많은 동네 3곳에 하나씩"""
    if req.cond.area in AREA_CENTERS:
        return [req.cond.area] * N_COURSES
    want = [k for v in (req.intent, req.taste.mood, req.taste.spend) if v for k in TASTE_KINDS.get(v, [])] or COURSE_KINDS
    score = {a: sum(len(candidates_by_area(a).get(k, [])) for k in want) for a in AREA_CENTERS}
    return sorted(AREA_CENTERS, key=lambda a: -score[a])[:N_COURSES]


# ── 영업시간 ("월~금 11:30 - 22:00 (브레이크타임 있음) / 토,일 휴무" 형태의 요약 문장)
DAYS = "월화수목금토일"
HOURS_SEG = re.compile(r"^([월화수목금토일~,]+)\s+(.+)$")
HOURS_TIME = re.compile(r"(\d{1,2}):(\d{2})\s*-\s*(다음 날\s*)?(\d{1,2}):(\d{2})")


def parse_hours(summary: str | None) -> dict[int, tuple[int, int] | None] | None:
    """요일(0=월) → (여는 분, 닫는 분 — 자정 넘기면 1440 초과) 또는 None(휴무). 읽을 수 없으면 None"""
    if not summary:
        return None
    if "24시간" in summary:
        return {d: (0, 1440) for d in range(7)}
    out: dict[int, tuple[int, int] | None] = {}
    for seg in summary.split(" / "):
        m = HOURS_SEG.match(seg.strip())
        if not m:
            continue
        days: list[int] = []
        for part in m.group(1).split(","):
            a, _, b = part.partition("~")
            if a not in DAYS or (b and b not in DAYS):
                continue
            i, j = DAYS.index(a), DAYS.index(b or a)
            days += list(range(i, j + 1)) if i <= j else [*range(i, 7), *range(0, j + 1)]
        if "휴무" in m.group(2):
            span = None
        elif t := HOURS_TIME.search(m.group(2)):
            op, cl = int(t.group(1)) * 60 + int(t.group(2)), int(t.group(4)) * 60 + int(t.group(5))
            if t.group(3) or cl <= op:
                cl += 1440
            span = (op, cl)
        else:
            continue
        for d in days:
            out[d] = span
    return out or None


def open_minutes(p: dict, weekday: int, start: int, end: int) -> int | None:
    """[start, end)분 중 영업하는 시간(분). 영업시간 정보가 없으면 None(모름)"""
    hours = parse_hours(p.get("hours"))
    if hours is None or weekday not in hours:
        return None
    span = hours[weekday]
    return 0 if span is None else max(0, min(end, span[1]) - max(start, span[0]))


def is_open(p: dict, weekday: int, start: int, end: int) -> bool:
    """머무는 동안(최대 1시간 기준) 열려 있으면, 또는 모르면 True"""
    m = open_minutes(p, weekday, start, end)
    return m is None or m >= min(end - start, 60)


def place_cost(p: dict) -> int:
    """1인 금액 — DB 가격, 없으면 종류별 기본 금액 (서버 예산 검사와 같은 기준)"""
    return p.get("price") or DEFAULT_COST.get(p["kind"], 0)


def suits(p: dict, req: "CourseRequest") -> bool:
    bad = NOT_FOR.get(req.taste.companion or "")
    return not (bad and bad.search(f"{p['name']} {p['cat']}"))


def today_weekday() -> int:
    return datetime.now(KST).weekday()


# 분위기 취향 → 인기도(pop) 가중치: 활기찬 곳을 좋아하면 붐비는 곳, 조용한 곳을 좋아하면 한적한 곳, 그 외엔 많이 가는 곳을 살짝 우선
POP_WEIGHT = {"busy": 1.0, "quiet": -1.0}


def pop_weight(req: "CourseRequest | None") -> float:
    return POP_WEIGHT.get(req.taste.crowd or "", 0.5) if req else 0.5


def pop_label(p: dict) -> str:
    pop = p.get("pop") or 0
    return "붐빔" if pop >= 0.8 else "보통" if pop >= 0.4 else "한적" if pop else "-"


def sample_candidates(areas: list[str], rng: random.Random, req: "CourseRequest | None" = None, exclude: set[str] | None = None) -> dict[str, dict]:
    """동네·종류별로 가까운 곳 위주로 뽑되 매번 조금씩 섞어 코스가 반복되지 않게.
    시간 창이 있으면 그 시간에 문 닫는 곳(영업시간을 아는 곳만)은 뺀다"""
    uniq = list(dict.fromkeys(areas))
    per_kind = 14 if len(uniq) == 1 else 8
    refs: dict[str, dict] = {}
    used = set()
    w = req.time_window if req else None
    wd = today_weekday()
    for area in uniq:
        by_kind = candidates_by_area(area)
        for kind in COURSE_KINDS:
            pool = [p for p in by_kind.get(kind, []) if (not req or suits(p, req)) and p["id"] not in (exclude or ())]
            if req and req.cond.budget:  # 한 곳이 예산 절반을 넘으면 코스를 짤 수 없어서 미리 뺌
                pool = [p for p in pool if place_cost(p) <= req.cond.budget / 2]
            if w:
                pool = [p for p in pool if is_open(p, wd, w.start * 60, w.end * 60)]
            # 가까운 곳들 안에서 인기도 취향에 맞는 쪽을 앞으로
            near, wt = pool[: per_kind * 3], pop_weight(req)
            pool = [p for _, p in sorted(enumerate(near), key=lambda x: x[0] / len(near) - wt * x[1].get("pop", 0))][: per_kind * 2]
            for p in rng.sample(pool, min(per_kind, len(pool))):
                if p["id"] not in used:
                    used.add(p["id"])
                    refs[f"p{len(refs) + 1}"] = {**p, "area": area}
    return refs


def build_messages(req: CourseRequest, areas: list[str], refs: dict[str, dict], fill: bool = False) -> list[dict]:
    taste = [f"- {TRAIT_NAMES[k]}: {TRAITS[k][v]}" for k, v in req.taste.model_dump().items() if k in TRAITS and v in TRAITS[k]]
    if want := wanted_kinds(req):
        taste.append(f"- 코스마다 꼭 넣을 종류: {'·'.join(sorted(want))} 중 1곳 이상 (같은 종류는 최대 2곳)")
    if req.intent in TRAITS["mood"]:
        taste.append(f"- 오늘 하고 싶은 것: {TRAITS['mood'][req.intent]}")
    if req.tags:
        taste.append(f"- 자주 보인 관심사: {', '.join(t for t in req.tags if t in TAGS)}")
    # 기록에서 만든 맞춤 주제 — 사용자가 고른 답을 그대로 넘긴다 (선택지 문구 자체가 이 사람의 취향 설명)
    for p in req.picked:
        if p.labels:
            taste.append(f"- {p.name}: {', '.join(p.labels)}" + (f" ({p.hint})" if p.hint else ""))
    c, w = req.cond, req.time_window
    lo, hi = place_range(req)
    cond = [
        f"- 인원: {c.people}명",
        f"- 시간: {w.start}시 시작 ~ {w.end}시 종료, 총 {w.minutes}분을 꽉 채움 — 코스마다 minutes 합계를 약 {w.minutes - 15 * (lo + hi) // 2}분으로 (이동 제외)" if w
        else f"- 시간: {c.hours}시간 이내 (이동 포함)" if c.hours else "- 시간: 상관없음",
        f"- 일정: {plan_of(req)[0]}",
        f"- 함께 가는 사람: {COMPANIONS.get(req.taste.companion or '', '정보 없음')}",
        *([f"- 우선할 리뷰 태그: {', '.join(prefer)}"] if (prefer := list(dict.fromkeys(
            COMPANION_TAGS.get(req.taste.companion or "", []) + CROWD_TAGS.get(req.taste.crowd or "", [])))) else []),
        f"- 장소 수: 코스마다 {lo}~{hi}곳",
        f"- 1인 예산: {c.budget:,}원 이하 — 후보의 1인 가격 합계가 넘으면 버려진다. cost에는 후보의 1인 가격을 그대로 쓴다" if c.budget else "- 1인 예산: 상관없음",
    ]
    places = [
        f"{ref} | {p['area']} | {p['kind']} | {p['name']} | {p['cat']} | {p['lat']:.4f},{p['lng']:.4f}"
        f" | {','.join(p.get('tags') or []) or '-'} | {pop_label(p)} | {p.get('hours') or '-'} | {place_cost(p)}{'' if p.get('price') else '(추정)'}"
        for ref, p in refs.items()
    ]
    user = "\n".join([
        *([FILL_NOTE, ""] if fill else []),
        "[사용자 취향]", *(["- 참고하지 않음 (추가 추천)"] if fill else taste or ["- 정보 없음 (무난한 코스)"]),
        "", "[조건]", *cond,
        "", f"[만들 코스] {len(areas)}개 — area 순서: {', '.join(areas)}",
        f"코스마다 items는 반드시 {lo}곳 이상 {hi}곳 이하 (이보다 적거나 많으면 버려진다). 장소가 모자라 보여도 다른 종류로 채운다.",
        "", "[후보 장소] ref | 동네 | 종류 | 이름 | 업종 | 좌표 | 리뷰 태그 | 방문 인기(내비 도착 기준) | 영업시간 | 1인 가격(원)", *places,
    ])
    return [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": user}]


def plan_schema(areas: list[str]) -> dict:
    def obj(props: dict) -> dict:
        return {"type": "object", "additionalProperties": False, "required": list(props), "properties": props}

    item = obj({"ref": {"type": "string"}, "minutes": {"type": "integer"}, "cost": {"type": "integer"}, "note": {"type": "string"}})
    course = obj({
        "area": {"type": "string", "enum": sorted(set(areas))},
        "title": {"type": "string"},
        "why": {"type": "string"},
        "start_hour": {"type": "integer"},
        "traits": obj({k: {"type": "string", "enum": list(v)} for k, v in TRAITS.items()}),
        "tags": {"type": "array", "items": {"type": "string", "enum": TAGS}},
        "items": {"type": "array", "items": item},
    })
    return obj({"courses": {"type": "array", "items": course}})


def _call_llm(model: str, messages: list[dict], schema: dict) -> dict:
    from openai import OpenAI, OpenAIError

    if not os.getenv("OPENAI_API_KEY"):
        raise CoursePlanError("OPENAI_API_KEY가 설정되지 않았어요 (backend/.env)")
    # gpt-5 계열(추론 모델)은 minimal이 가장 빠름: 망원 테스트 기준 minimal 14.5초 / low 32.5초 / 기본 약 50초, 결과 품질 비슷
    effort = os.getenv("OPENAI_REASONING_EFFORT", "minimal" if model.startswith(("gpt-5", "o")) else "")
    try:
        res = OpenAI().chat.completions.create(
            model=model, messages=messages,
            response_format={"type": "json_schema", "json_schema": {"name": "course_plan", "strict": True, "schema": schema}},
            **({"reasoning_effort": effort} if effort else {}),
        )
    except OpenAIError as e:
        raise CoursePlanError(f"LLM 호출 실패: {e}") from e
    msg = res.choices[0].message
    if getattr(msg, "refusal", None):
        raise CoursePlanError(f"LLM이 응답을 거절했어요: {msg.refusal}")
    return json.loads(msg.content or "{}")


def leg(a: dict, b: dict, max_m: int = MAX_LEG_M) -> dict | None:
    m = meters((a["lat"], a["lng"]), (b["lat"], b["lng"])) * 1.3  # 직선거리 → 골목 우회 반영 추정
    if m > max_m:
        return None
    return {"m": "도보", "t": max(1, math.ceil(m / 75)), "d": f"{m / 1000:.1f}km" if m >= 1000 else f"{round(m / 50) * 50 or 50}m"}


def fill_stays(stays: list[int], target: int, kinds: list[str]) -> list[int] | None:
    """체류 시간 합이 target(분)과 같도록 비례 조정 (GPT는 총 시간을 자주 짧게 잡아서 서버가 맞춤).
    한도는 장소 종류마다 다르다 — 식당 100분, 산책 90분처럼.
    장소가 너무 많아 시간 안에 안 들어가면 None,
    반대로 한도까지 늘려도 시간이 남으면 늘리지 않고 남겨 둔다(코스가 일찍 끝날 뿐)."""
    n = len(stays)
    bounds = [STAY_RANGE.get(k, STAY_DEFAULT) for k in kinds]
    lo_sum, hi_sum = sum(b[0] for b in bounds), sum(b[1] for b in bounds)
    if target < lo_sum:
        return None
    if target >= hi_sum:
        return [b[1] for b in bounds]

    out = [float(min(max(d, bounds[i][0]), bounds[i][1])) for i, d in enumerate(stays)]
    for _ in range(10):  # 한도에 걸린 곳은 고정하고 나머지로 다시 나눔
        free = [i for i, d in enumerate(out) if bounds[i][0] < d < bounds[i][1]]
        if not free:
            break
        fixed = sum(out[i] for i in range(n) if i not in free)
        scale = (target - fixed) / sum(out[i] for i in free)
        for i in free:
            out[i] = min(max(out[i] * scale, bounds[i][0]), bounds[i][1])
        if abs(sum(out) - target) < 1:
            break
    res = [int(round(d / 5) * 5) for d in out]  # 5분 단위
    # 반올림 오차는 한도 여유가 가장 큰 곳에서 흡수
    diff = target - sum(res)
    if diff:
        i = max(range(n), key=lambda j: bounds[j][1] - res[j] if diff > 0 else res[j] - bounds[j][0])
        res[i] = min(max(res[i] + diff, bounds[i][0]), bounds[i][1])
    return res if all(bounds[i][0] <= res[i] <= bounds[i][1] for i in range(n)) else None


def _reject(reasons: list[str] | None, why: str) -> None:
    if reasons is not None:
        reasons.append(why)
    return None


# 장소는 괜찮은데 순서만 문제인 탈락 이유 — 순서를 바꿔 다시 검증해 본다
ORDER_REASONS = {"같은 종류 3연속", "식사·카페·한잔 연달아", "구간 거리 초과", "영업시간 밖 방문"}
MAX_REORDER_PLACES = 7  # 7곳이면 순열 5040개 — 그 이상은 시도하지 않음


def other_orders(raw: dict, refs: dict[str, dict], limit: int = 30) -> list[list[dict]]:
    """같은 장소들의 다른 방문 순서 — 종류 규칙을 지키는 것만, 걷는 거리가 짧은 순으로"""
    items = raw["items"]
    places = [refs.get(it["ref"]) for it in items]
    if None in places or not 2 < len(items) <= MAX_REORDER_PLACES:
        return []
    dist = [[meters((a["lat"], a["lng"]), (b["lat"], b["lng"])) for b in places] for a in places]
    found = []
    for perm in itertools.permutations(range(len(items))):
        if list(perm) == sorted(perm):
            continue
        ks = [places[i]["kind"] for i in perm]
        if any(ks[i] == ks[i + 1] and ks[i] in NO_REPEAT_ADJACENT for i in range(len(ks) - 1)):
            continue
        if any(ks[i] == ks[i + 1] == ks[i + 2] for i in range(len(ks) - 2)):
            continue
        # 걷는 거리 + 식사·한잔이 원래 자리(AI가 시간대를 보고 정한 자리)에서 멀어지면 벌점
        moved = sum(abs(pos - i) for pos, i in enumerate(perm) if places[i]["kind"] in ("식사", "한잔"))
        found.append((sum(dist[a][b] for a, b in zip(perm, perm[1:])) + moved * 800, perm))
    return [[items[i] for i in perm] for _, perm in sorted(found)[:limit]]


def to_course(index: int, raw: dict, refs: dict[str, dict], req: CourseRequest, source: str = "taste", reasons: list[str] | None = None) -> dict | None:
    """검증 + 순서 문제로 떨어지면 방문 순서를 바꿔 한 번 더 (좋은 장소 조합을 버리지 않게)"""
    why: list[str] = []
    course = _check_course(index, raw, refs, req, source, why)
    if course is None and why and why[0] in ORDER_REASONS:
        for items in other_orders(raw, refs):
            course = _check_course(index, {**raw, "items": items}, refs, req, source, [])
            if course:
                course["reordered"] = True
                break
    if course is None and reasons is not None:
        reasons.extend(why)
    return course


def wanted_kinds(req: CourseRequest) -> set[str]:
    """취향(오늘 하고 싶은 것·관심사·메인 코스)으로 코스에 꼭 있어야 할 장소 종류"""
    return {k for v in (req.intent, req.taste.mood, req.taste.spend) if v for k in TASTE_KINDS.get(v, [])}


def _check_course(index: int, raw: dict, refs: dict[str, dict], req: CourseRequest, source: str = "taste", reasons: list[str] | None = None) -> dict | None:
    """LLM 코스 1개 검증 → 프론트 Course 형태. 규칙 위반이면 None.
    source: taste(취향 맞춤 — 취향 종류가 하나도 없으면 탈락) | db(추가 추천 — 취향 검사 안 함)"""
    cond, w = req.cond, req.time_window
    lo, hi = place_range(req)
    places = [refs.get(it["ref"]) for it in raw["items"]]
    if not lo <= len(places) <= hi or None in places or len({p["id"] for p in places}) != len(places):
        return _reject(reasons, "장소 수·없는 장소·중복")
    kinds = [p["kind"] for p in places]
    if any(kinds[i] == kinds[i + 1] == kinds[i + 2] for i in range(len(kinds) - 2)):
        return _reject(reasons, "같은 종류 3연속")
    # 밥 먹고 바로 또 밥, 카페 나와서 또 카페 — 프롬프트로 막아도 새어 나와서 서버가 거른다
    if any(kinds[i] == kinds[i + 1] and kinds[i] in NO_REPEAT_ADJACENT for i in range(len(kinds) - 1)):
        return _reject(reasons, "식사·카페·한잔 연달아")
    if any(kinds.count(k) > n for k, n in MAX_SAME_KIND.items()):
        return _reject(reasons, "같은 종류 과다")
    if source == "taste" and (want := wanted_kinds(req)) and not want & set(kinds):
        return _reject(reasons, "취향 종류 없음")
    if UNVERIFIED.search(" ".join([raw["title"], raw["why"], *(it["note"] for it in raw["items"])])):
        return _reject(reasons, "근거 없는 표현")
    legs = [leg(a, b) for a, b in zip(places, places[1:])]
    if None in legs:
        return _reject(reasons, "구간 거리 초과")

    items = [{
        "k": p["kind"], "n": p["name"], "pid": p["id"],
        "d": min(max(it["minutes"], STAY_RANGE.get(p["kind"], STAY_DEFAULT)[0]), STAY_RANGE.get(p["kind"], STAY_DEFAULT)[1]),
        # DB에 1인 가격이 있으면 LLM 추정 대신 그 값
        "c": min(max(p.get("price") or it["cost"] or place_cost(p), 0), 150_000), "note": it["note"].strip()[:60],
    } for p, it in zip(places, raw["items"])]
    move = sum(l["t"] for l in legs)
    if w:  # 시작~종료 시간을 정확히 채우도록 체류 시간 조정
        stays = fill_stays([it["minutes"] for it in raw["items"]], w.minutes - move, kinds)
        if stays is None:
            return _reject(reasons, "시간 채우기 실패")
        for item, d in zip(items, stays):
            item["d"] = d
        if not visits_open(places, items, legs, w.start * 60):
            return _reject(reasons, "영업시간 밖 방문")
    elif cond.hours and sum(i["d"] for i in items) + move > cond.hours * 60:
        return _reject(reasons, "시간 초과")
    if cond.budget and sum(i["c"] for i in items) > cond.budget:  # 프론트가 예산 넘는 코스를 숨김
        return _reject(reasons, "예산 초과")

    return {
        "id": ("ai-" if source == "taste" else "db-") + hashlib.sha1("|".join(i["pid"] for i in items).encode()).hexdigest()[:8],
        "title": raw["title"].strip()[:30], "area": raw["area"], "tint": TINTS[index % len(TINTS)],
        "start": w.start if w else min(max(raw["start_hour"], 7), 22),
        "traits": {k: raw["traits"][k] for k in TRAITS},
        "tags": list(dict.fromkeys(t for t in raw["tags"] if t in TAGS))[:3],
        "why": raw["why"].strip()[:140],
        "items": items, "legs": legs, "estimated": True, "source": source,
    }


def visits_open(places: list[dict], items: list[dict], legs: list[dict], start_min: int) -> bool:
    """각 장소에 머무는 시각에 영업 중인지 (영업시간을 모르는 곳은 통과)"""
    wd, t = today_weekday(), start_min
    for i, (p, it) in enumerate(zip(places, items)):
        if not is_open(p, wd, t, t + it["d"]):
            return False
        t += it["d"] + (legs[i]["t"] if i < len(legs) else 0)
    return True


# ── 규칙 기반 기본 코스 (LLM 코스가 모자라거나 LLM 호출이 실패했을 때)
DEFAULT_STAY = {"식사": 70, "카페": 60, "한잔": 90, "체험": 90, "문화": 60, "산책": 45}
DEFAULT_NOTE = {
    "식사": "식사하며 쉬어 가기", "카페": "음료 한 잔과 함께 쉬어 가기", "한잔": "가볍게 한잔하며 하루 마무리",
    "체험": "직접 해 보며 즐기기", "문화": "천천히 둘러보기", "산책": "주변을 걸으며 동네 구경",
}
# 함께 가는 사람·분위기 취향 → 우선할 리뷰 태그 (places.tags)
COMPANION_TAGS = {"solo": ["혼밥", "조용함"], "couple": ["데이트", "감성적"], "friends": ["모임", "힙함"],
                  "family": ["가족동반"], "coworkers": ["모임"]}
CROWD_TAGS = {"quiet": ["조용함"], "busy": ["시끌벅적함", "힙함"], "mid": ["감성적"]}


def slot_kind(minute: int, prev: list[str], req: CourseRequest, rng: random.Random) -> str:
    """이 시각에 어울리는 장소 종류 — 밥때는 식사, 저녁 이후는 한잔, 그 외엔 취향 종류 위주로 번갈아"""
    h = minute / 60
    last = prev[-1] if prev else None
    if (11.5 <= h < 13.5 or 17.5 <= h < 19.5) and last != "식사" and prev.count("식사") < 2:
        return "식사"
    if h >= 19.5 and req.taste.companion != "family" and "한잔" not in prev:
        return "한잔"
    liked = [k for v in (req.intent, req.taste.mood, req.taste.spend) if v for k in TASTE_KINDS.get(v, [])]
    pool = [k for k in dict.fromkeys(liked + ["카페", "산책", "문화", "체험"]) if k not in ("식사", "한잔")]
    pool = [k for k in pool if not (k == last and k in NO_REPEAT_ADJACENT) and prev[-2:] != [k, k]] or ["산책"]
    # 덜 들어간 종류 → 취향 종류 → 무작위 순
    pool.sort(key=lambda k: (prev.count(k), 0 if k in liked else 1, rng.random()))
    return pool[0]


def rule_course(area: str, req: CourseRequest, rng: random.Random, avoid: set[str]) -> dict | None:
    """동네 기준점에서 시작해 시간 흐름대로 종류를 정하고, 가깝고·열려 있고·취향 태그가 맞는 곳을 차례로 고름"""
    w = req.time_window
    start = (w.start if w else 12) * 60
    total = w.minutes if w else (req.cond.hours * 60 if req.cond.hours else 240)
    lo, hi = place_range(req)
    n = min(max(round(total / plan_of(req)[1]), lo), hi)
    by_kind = candidates_by_area(area)
    want_tags = set(COMPANION_TAGS.get(req.taste.companion or "", []) + CROWD_TAGS.get(req.taste.crowd or "", []))
    wt = pop_weight(req)
    wd = today_weekday()
    budget = req.cond.budget

    def cost(p: dict) -> int:
        return p.get("price") or DEFAULT_COST[p["kind"]]

    places: list[dict] = []
    kinds: list[str] = []
    t = start
    while len(places) < n and t < start + total - 20:
        first = slot_kind(t, kinds, req, rng)
        last = kinds[-1] if kinds else None
        # 이 시각에 어울리는 종류부터, 없으면 연달아 오면 이상하지 않은 다른 종류로
        options = [first] + [k for k in COURSE_KINDS if k != first and not (k == last and k in NO_REPEAT_ADJACENT)
                             and not (k == "식사" and "식사" in kinds[-2:]) and not (k == "한잔" and t < 17 * 60)]
        options = [k for k in options if kinds.count(k) < MAX_SAME_KIND.get(k, 3) and kinds[-2:] != [k, k]]
        here = places[-1] if places else {"lat": AREA_CENTERS[area][0], "lng": AREA_CENTERS[area][1]}
        picked = None
        for kind in options:
            stay = DEFAULT_STAY[kind]
            pool = []
            for p in by_kind.get(kind, []):
                if p["id"] in avoid or any(p["id"] == q["id"] for q in places) or not suits(p, req) or not is_open(p, wd, t, t + stay):
                    continue
                if budget and sum(cost(q) for q in places) + cost(p) > budget:  # 1인 예산 안에서만
                    continue
                d = meters((here["lat"], here["lng"]), (p["lat"], p["lng"])) * 1.3
                if places and d > MAX_LEG_M:
                    continue
                match = len(want_tags & set(p.get("tags") or []))
                pool.append((d / 400 - match * 1.5 - wt * p.get("pop", 0) * 2 + rng.random() * 2, p))  # 가까움 + 태그 일치 + 인기도 취향 + 약간의 무작위
            if pool:
                picked = (kind, min(pool, key=lambda x: x[0])[1])
                break
        if not picked:
            t += 30  # 이 시각엔 갈 곳이 없으면 30분 뒤로
            continue
        kind, p = picked
        if places:
            t += leg(places[-1], p)["t"]
        places.append(p)
        kinds.append(kind)
        t += DEFAULT_STAY[kind]
    if len(places) < 2:
        return None

    legs = [leg(a, b) for a, b in zip(places, places[1:])]
    move = sum(l["t"] for l in legs)
    stays = (fill_stays([DEFAULT_STAY[k] for k in kinds], total - move, kinds) if w else None) or [DEFAULT_STAY[k] for k in kinds]
    items = [{
        "k": p["kind"], "n": p["name"], "pid": p["id"], "d": d,
        "c": cost(p), "note": DEFAULT_NOTE[p["kind"]],
    } for p, d in zip(places, stays)]
    names = "·".join(dict.fromkeys(kinds))
    who = req.taste.companion
    why_who = {"solo": " 혼자 머물기 편한 곳", "couple": " 둘이 가기 좋은 곳", "friends": " 여럿이 즐기기 좋은 곳",
               "family": " 가족과 편하게 쉬어 갈 곳", "coworkers": " 대화하며 머물기 좋은 곳"}.get(who or "")
    return {
        "id": "rule-" + hashlib.sha1("|".join(i["pid"] for i in items).encode()).hexdigest()[:8],
        "title": f"{area} {names} 코스"[:30], "area": area, "tint": TINTS[0],
        "start": start // 60,
        "traits": {k: (getattr(req.taste, k) if getattr(req.taste, k) in v else next(iter(v))) for k, v in TRAITS.items()},
        "tags": [],
        "why": f"{area}에서 걸어서 이동할 수 있는 곳들을 시간 흐름에 맞춰 {names} 순서로 묶었어요."
               + (f" 리뷰 기준으로{why_who}을 먼저 골랐어요." if why_who else ""),
        "items": items, "legs": legs, "estimated": True, "fallback": True, "source": "rule",
    }


def rule_courses(req: CourseRequest, areas: list[str], need: int, have: list[dict], rng: random.Random) -> list[dict]:
    """have와 겹치지 않는 기본 코스 need개 — 동네를 돌아가며, 앞 코스에 쓴 장소는 되도록 피해서"""
    out: list[dict] = []
    avoid = {i["pid"] for c in have for i in c["items"]}
    order = list(dict.fromkeys(areas)) or list(AREA_CENTERS)
    for attempt in range(need * 4):
        if len(out) >= need:
            break
        area = order[attempt % len(order)]
        c = rule_course(area, req, rng, avoid if attempt < need * 2 else set())
        if c and all(c["id"] != x["id"] for x in have + out):
            out.append(c)
            avoid |= {i["pid"] for i in c["items"]}
    return out


def choose(courses: list[dict]) -> list[dict]:
    """검증 통과 코스 중 최대 N_COURSES개 — 동네가 여러 곳이면 동네마다 하나씩 먼저"""
    seen: set[str] = set()
    first, rest = [], []
    for c in courses:
        (rest if c["area"] in seen else first).append(c)
        seen.add(c["area"])
    rank = {"taste": 0, "db": 1, "rule": 2}
    chosen = sorted((first + rest)[:N_COURSES], key=lambda c: rank.get(c.get("source", "taste"), 0))
    for i, c in enumerate(chosen):
        c["tint"] = TINTS[i % len(TINTS)]
    return chosen


def _llm_courses(model: str, req: CourseRequest, areas: list[str], refs: dict[str, dict], source: str,
                 start_index: int, have: list[dict], reasons: list[str]) -> tuple[list[dict], int]:
    """LLM 한 번 호출 → 검증 통과 코스들 (have와 id가 겹치지 않는 것만), 탈락 수"""
    messages = build_messages(req, areas, refs, fill=source == "db")
    out, rejected = [], 0
    for raw in _call_llm(model, messages, plan_schema(areas)).get("courses", []):
        course = to_course(start_index + len(out), raw, refs, req, source, reasons)
        if course is None:
            rejected += 1
        elif all(course["id"] != c["id"] for c in have + out):
            out.append(course)
    return out, rejected


def generate_courses(req: CourseRequest, rng: random.Random | None = None) -> dict:
    rng = rng or random.Random()
    w = req.time_window
    if w and w.end <= w.start:
        raise CoursePlanError("종료 시각은 시작 시각보다 늦어야 해요")
    areas = pick_areas(req)
    model = os.getenv("OPENAI_MODEL", DEFAULT_MODEL)
    reasons: list[str] = []  # 검증에서 떨어진 이유 — 추천 품질 점검용
    rejected, llm_error = 0, None
    courses: list[dict] = []
    stats = {"taste": 0, "db": 0, "rule": 0}

    # ① 취향 맞춤
    refs = sample_candidates(areas, rng, req)
    try:
        if len(refs) >= 6:
            got, rej = _llm_courses(model, req, [areas[i % len(areas)] for i in range(N_REQUEST)], refs, "taste", 0, courses, reasons)
            courses += got[:N_COURSES]
            rejected += rej
        # ② 모자란 개수만큼 추가 추천 — ①에 쓴 장소는 빼고 새 후보로
        for _ in range(2):  # 추가 추천도 모자라면 한 번 더
            need = N_COURSES - len(courses)
            if need <= 0:
                break
            used = {i["pid"] for c in courses for i in c["items"]}
            fill_refs = sample_candidates(areas, rng, req, exclude=used)
            if len(fill_refs) < 6:
                break
            fill_areas = [areas[(len(courses) + i) % len(areas)] for i in range(need + 2)]  # 검증 탈락 대비 2개 더
            got, rej = _llm_courses(model, req, fill_areas, fill_refs, "db", len(courses), courses, reasons)
            courses += got[:need]
            rejected += rej
    except CoursePlanError as e:  # LLM이 안 되면 ③으로
        llm_error = str(e)
        log.warning("LLM 코스 생성 실패 → 기본 코스로 채움: %s", e)
    # ③ 그래도 모자라면 규칙 기반 기본 코스
    if len(courses) < N_COURSES:
        courses += rule_courses(req, areas, N_COURSES - len(courses), courses, rng)
    if not courses:
        raise CoursePlanError(llm_error or "이 동네에는 코스를 짤 만큼 장소가 없어요")
    for c in courses:
        stats[c.get("source", "taste")] += 1
    return {"courses": choose(courses), "model": model, "rejected": rejected,
            "reordered": sum(1 for c in courses if c.get("reordered")), "sources": stats,
            "reject_reasons": dict(Counter(reasons)), **({"llm_error": llm_error} if llm_error else {})}
