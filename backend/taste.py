"""사진첩 + 유튜브 → 취향 분석. 숫자는 코드가, 문장은 LLM이 만든다.

1) 사진 읽기 (Vision): 사진마다 장소 종류·태그·동행 수 (detail=low → 1장 약 85토큰)
2) 가중 합산 (코드): 사진과 유튜브를 각각 항목별 0~1 비율로 바꾼 뒤
   사진 0.6 : 유튜브 0.4로 더해 값을 확정한다. 근거가 적은 쪽은 가중치를 그만큼 깎아서
   사진 2장이 유튜브 200개를 이기지 못하게 한다.
3) LLM: 확정된 값은 건드리지 않고, 이 사람에게만 맞춘 질문 주제와 설명 문장만 만든다.

사진 읽기가 실패해도 유튜브만으로 계속 간다 (두 갈래가 서로를 막지 않음).
양쪽 다 근거가 없을 때만 TasteError.
"""
import json, os, re
from collections import Counter

from pydantic import BaseModel, Field

from courses import COMPANIONS, PLANS, TAGS, TRAITS
from places import AREA_CENTERS, meters

MODEL = os.getenv("OPENAI_TASTE_MODEL", "gpt-5-mini")
PHOTO_LIMIT = 12  # 비용 상한 — 더 고르면 고르게 솎아서 이 장수만 본다
PHOTO_WEIGHT, YT_WEIGHT = 0.6, 0.4
# 근거가 이만큼 모여야 그 쪽 가중치를 100% 준다 — 사진 2장이 유튜브 200개를 이기지 않게
PHOTO_FULL, YT_FULL = 10, 20
N_TOPICS = 4  # 매번 새로 만드는 주제 수
AREA_MAX_M = 3000  # 이보다 멀면 동네를 특정하지 않음

# 사진에서 읽어낼 값 — 장소 종류는 기존 더미(PHOTOS.place)와 같은 어휘
PLACE_KINDS = ["식당", "카페", "바", "공원", "강변", "거리", "전시장", "실내", "기타"]
PHOTO_TAGS = [*TAGS, "음식", "운동"]
# 가중 합산으로 값을 정하는 항목. hour·crowd는 유튜브로 알 수 없어 사진 전용
AXES = {
    "mood": ["calm", "active", "new", "food"],
    "spend": ["meal", "cafe", "drink", "play"],
    "pace": ["low", "mid", "high", "very"],
    "crowd": ["busy", "mid", "quiet"],
    "hour": ["morning", "noon", "sunset", "night"],
}
AXIS_NAMES = {"mood": "관심사", "spend": "메인 코스", "pace": "활동성", "crowd": "분위기", "hour": "시간대"}
# 사진 장소 종류 → 각 항목에 주는 표 (한 장이 여러 칸에 들어갈 수 있음)
PLACE_TO_SPEND = {"식당": "meal", "카페": "cafe", "바": "drink", "전시장": "play"}
PLACE_TO_MOOD = {"전시장": "new", "공원": "calm", "강변": "calm", "식당": "food", "바": "food", "거리": "active"}
TAG_TO_MOOD = {"운동": "active", "자연": "calm", "음식": "food", "전시": "new"}
OUTDOOR = {"공원", "강변", "거리"}
BUSY_PLACES = {"식당", "바"}

# 고정 주제 — 사용자가 바꿀 수 있지만 주제 자체는 항상 이 6개 (예산·지역은 결과 화면 조건에서 직접 고름)
FIXED = {"crowd": TRAITS["crowd"], "hour": TRAITS["hour"], "pace": TRAITS["pace"],
         "plan": {k: v[0] for k, v in PLANS.items()}, "companion": COMPANIONS}
FIXED_NAMES = {"crowd": "분위기", "hour": "시간대", "pace": "활동성", "plan": "일정", "companion": "누구랑"}


class TasteError(Exception):
    pass


class PhotoIn(BaseModel):
    ts: str | None = None  # EXIF 촬영 시각 ISO (없으면 None)
    lat: float | None = None
    lng: float | None = None
    b64: str = Field(min_length=32)  # data:image/jpeg;base64,... (프론트에서 512px로 줄인 것)


class TasteRequest(BaseModel):
    yt_id: str | None = None
    photos: list[PhotoIn] = []


def _obj(props: dict) -> dict:
    """strict json_schema는 모든 키가 required + additionalProperties false여야 한다"""
    return {"type": "object", "properties": props, "required": list(props), "additionalProperties": False}


def _enum(values) -> dict:
    return {"type": "string", "enum": list(values)}


def _call_llm(messages: list[dict], schema: dict, name: str) -> dict:
    from openai import OpenAI, OpenAIError

    if not os.getenv("OPENAI_API_KEY"):
        raise TasteError("OPENAI_API_KEY가 설정되지 않았어요 (backend/.env)")
    effort = os.getenv("OPENAI_REASONING_EFFORT", "minimal" if MODEL.startswith(("gpt-5", "o")) else "")
    try:
        res = OpenAI().chat.completions.create(
            model=MODEL, messages=messages,
            response_format={"type": "json_schema", "json_schema": {"name": name, "strict": True, "schema": schema}},
            **({"reasoning_effort": effort} if effort else {}),
        )
    except OpenAIError as e:
        raise TasteError(f"취향 분석 LLM 호출 실패: {e}") from e
    msg = res.choices[0].message
    if getattr(msg, "refusal", None):
        raise TasteError(f"LLM이 응답을 거절했어요: {msg.refusal}")
    return json.loads(msg.content or "{}")


def pick_area(lat: float | None, lng: float | None) -> str | None:
    """EXIF 좌표 → 가장 가까운 동네 (역지오코딩 API 없이 기준점 거리로만, 무료)"""
    if lat is None or lng is None:
        return None
    area, dist = min(((k, meters((lat, lng), c)) for k, c in AREA_CENTERS.items()), key=lambda x: x[1])
    return area if dist <= AREA_MAX_M else None


def thin(photos: list[PhotoIn]) -> list[PhotoIn]:
    """PHOTO_LIMIT 장을 넘으면 앞뒤로 치우치지 않게 고르게 솎는다"""
    if len(photos) <= PHOTO_LIMIT:
        return photos
    step = len(photos) / PHOTO_LIMIT
    return [photos[int(i * step)] for i in range(PHOTO_LIMIT)]


def hour_bucket(h: int) -> str:
    return "morning" if h < 11 else "noon" if h < 16 else "sunset" if h < 19 else "night"


def exif_facts(p: PhotoIn) -> dict:
    """사진에서 LLM 없이 확실히 아는 것 (촬영 시각·동네)"""
    hour, day = None, None
    if p.ts:
        try:
            from datetime import datetime

            dt = datetime.fromisoformat(p.ts.replace("Z", "+00:00"))
            hour, day = dt.hour, "월화수목금토일"[dt.weekday()]
        except ValueError:
            pass
    return {"hour": hour, "day": day, "area": pick_area(p.lat, p.lng)}


READ_PROMPT = """너는 사진을 보고 '어떤 자리에서 찍었는지'만 읽는다. 사람 얼굴·신원은 절대 추측하지 않는다.
사진마다 장소 종류, 어울리는 태그, 함께 있는 사람 수(사진에 보이는 인원, 셀카 1명, 풍경만이면 1)를 고른다.
확신이 없으면 장소는 '기타'로 둔다. 입력 순서 그대로 i(0부터)를 붙여 전부 반환한다."""


def read_photos(photos: list[PhotoIn]) -> list[dict]:
    """1) Vision — 사진 내용 읽기. EXIF로 아는 시각·동네는 같이 알려줘서 판단을 돕는다"""
    if not photos:
        return []
    facts = [exif_facts(p) for p in photos]
    content: list[dict] = []
    for i, (p, f) in enumerate(zip(photos, facts)):
        when = f"{f['day']}요일 {f['hour']}시" if f["hour"] is not None else "촬영 시각 모름"
        content.append({"type": "text", "text": f"[{i}] {when} / 동네 {f['area'] or '모름'}"})
        content.append({"type": "image_url", "image_url": {"url": p.b64, "detail": "low"}})

    schema = _obj({"photos": {"type": "array", "items": _obj({
        "i": {"type": "integer"},
        "place": _enum(PLACE_KINDS),
        "tags": {"type": "array", "items": _enum(PHOTO_TAGS)},
        "people": {"type": "integer"},
        "note": {"type": "string"},  # 한 줄 설명 (통합 분석의 근거로 쓰임)
    })}})
    out = _call_llm([{"role": "system", "content": READ_PROMPT}, {"role": "user", "content": content}], schema, "photo_read")

    rows = []
    for r in out.get("photos", []):
        i = r.get("i", -1)
        if not 0 <= i < len(photos):
            continue
        rows.append({**r, **facts[i]})
    return rows


def photo_stats(rows: list[dict]) -> dict:
    """사진에서 세어보면 바로 나오는 것 — LLM에 맡기지 않고 서버가 계산"""
    hours = [r["hour"] for r in rows if r.get("hour") is not None]
    people = [max(1, r.get("people", 1)) for r in rows]
    return {
        "total": len(rows),
        "days": len({r["day"] for r in rows if r.get("day")}),
        "party": round(sum(people) / len(people)) if people else 2,
        "hour_counts": dict(Counter(hour_bucket(h) for h in hours)),
        "place_counts": dict(Counter(r["place"] for r in rows)),
        "tag_counts": dict(Counter(t for r in rows for t in r.get("tags", []))),
        "area_counts": dict(Counter(r["area"] for r in rows if r.get("area"))),
    }


# ── 가중 합산 ─────────────────────────────────────────────
# 사진과 유튜브를 각각 "항목별 0~1 비율"로 바꾼 뒤 서버가 직접 더한다.
# LLM은 여기서 나온 값을 바꾸지 않고, 그 값을 설명하는 문장과 질문 주제만 만든다.

def ratios(counts: dict[str, float], values: list[str]) -> dict[str, float]:
    """세어둔 개수 → 합이 1인 비율. 근거가 하나도 없으면 빈 dict"""
    total = sum(max(0.0, counts.get(v, 0)) for v in values)
    if total <= 0:
        return {}
    return {v: round(max(0.0, counts.get(v, 0)) / total, 4) for v in values}


def photo_ratios(rows: list[dict]) -> dict[str, dict[str, float]]:
    """사진에서 읽은 것 → 항목별 비율"""
    if not rows:
        return {}
    spend, mood, hour = Counter(), Counter(), Counter()
    outdoor = busy = 0
    for r in rows:
        place, tags = r.get("place", "기타"), r.get("tags", [])
        if place in PLACE_TO_SPEND:
            spend[PLACE_TO_SPEND[place]] += 1
        if place in PLACE_TO_MOOD:
            mood[PLACE_TO_MOOD[place]] += 1
        for t in tags:
            if t in TAG_TO_MOOD:
                mood[TAG_TO_MOOD[t]] += 0.5  # 태그는 장소보다 약한 근거
        if r.get("hour") is not None:
            hour[hour_bucket(r["hour"])] += 1
        outdoor += place in OUTDOOR
        busy += place in BUSY_PLACES

    n = len(rows)
    out_r, busy_r = outdoor / n, busy / n
    return {k: v for k, v in {
        "spend": ratios(spend, AXES["spend"]),
        "mood": ratios(mood, AXES["mood"]),
        "hour": ratios(hour, AXES["hour"]),
        # 야외 비율·붐비는 곳 비율은 구간이라, 가까운 단계에 몰아주는 대신 인접 단계에도 나눠 준다
        "pace": band(out_r, AXES["pace"]),
        "crowd": band(busy_r, ["quiet", "mid", "busy"]),
    }.items() if v}


def band(ratio: float, steps: list[str]) -> dict[str, float]:
    """0~1 비율 → 단계별 점수. 딱 떨어지지 않는 값은 양옆 단계에 나눠 준다"""
    n = len(steps)
    pos = min(max(ratio, 0.0), 1.0) * (n - 1)
    lo = min(int(pos), n - 2)
    frac = pos - lo
    out = {s: 0.0 for s in steps}
    out[steps[lo]] += 1 - frac
    out[steps[lo + 1]] += frac
    return {k: round(v, 4) for k, v in out.items()}


def yt_ratios(yt: dict | None) -> dict[str, dict[str, float]]:
    """유튜브 규칙 점수 → 항목별 비율. 시간대·분위기는 유튜브로 알 수 없어 뺀다"""
    sc = (yt or {}).get("scores") or {}
    if not sc:
        return {}
    pace = sc.get("pace", {})
    walk, sit = pace.get("walk", 0), pace.get("sit", 0)
    out = {
        "mood": ratios(sc.get("mood", {}), AXES["mood"]),
        "spend": ratios(sc.get("spend", {}), AXES["spend"]),
        "pace": band(walk / (walk + sit), AXES["pace"]) if walk + sit else {},
    }
    return {k: v for k, v in out.items() if v}


def blend(ph: dict, yt: dict, n_photo: int, n_yt: int) -> tuple[dict[str, dict[str, float]], dict[str, float]]:
    """항목마다 사진·유튜브 비율을 가중 합산.
    가중치는 근거가 적으면 그만큼 깎는다 — 사진 2장이 유튜브 200개를 이기지 않게."""
    w_p = PHOTO_WEIGHT * min(1.0, n_photo / PHOTO_FULL) if n_photo else 0.0
    w_y = YT_WEIGHT * min(1.0, n_yt / YT_FULL) if n_yt else 0.0
    scores: dict[str, dict[str, float]] = {}
    for axis, values in AXES.items():
        p, y = ph.get(axis, {}), yt.get(axis, {})
        wp = w_p if p else 0.0
        wy = w_y if y else 0.0
        if wp + wy <= 0:
            continue
        scores[axis] = {v: round((p.get(v, 0) * wp + y.get(v, 0) * wy) / (wp + wy), 4) for v in values}
    return scores, {"photo": round(w_p, 3), "youtube": round(w_y, 3)}


def pick_top(scores: dict[str, dict[str, float]]) -> dict[str, str | None]:
    return {axis: (max(vals, key=vals.get) if vals else None) for axis, vals in scores.items()}


def evidence_lines(scores: dict, ph: dict, yt: dict, weights: dict, n_photo: int, n_yt: int) -> dict[str, str]:
    """왜 그 값이 나왔는지 숫자로 — LLM이 지어내지 않게 서버가 만든다"""
    out = {}
    for axis, vals in scores.items():
        top = max(vals, key=vals.get)
        label = (TRAITS.get(axis) or {}).get(top, top)
        parts = []
        if axis in ph:
            parts.append(f"사진 {n_photo}장 {round(ph[axis].get(top, 0) * 100)}%")
        if axis in yt:
            parts.append(f"유튜브 {n_yt}개 {round(yt[axis].get(top, 0) * 100)}%")
        mix = " · ".join(parts) or "근거 부족"
        out[axis] = f"{label} {round(vals[top] * 100)}% ({mix}, 가중치 사진 {weights['photo']} / 유튜브 {weights['youtube']})"
    return out


def yt_brief(yt: dict | None) -> dict:
    """유튜브 집계에서 판단에 쓸 부분만 추린다 (토큰 절약)"""
    if not yt:
        return {}
    return {
        "likes": yt.get("likes", 0), "subs": yt.get("subs", 0),
        "categories": yt.get("categories", [])[:6],
        "channels": yt.get("channels", [])[:10],
        "sub_channels": yt.get("sub_channels", [])[:15],
        "tags": yt.get("tags", [])[:15],
        "topics": yt.get("topics", [])[:10],
        "titles": yt.get("titles", [])[:20],
    }


# 코스(밖에서 가는 장소)로 옮길 수 없는 선택지 — 프롬프트로 막아도 새어 나오면 서버가 뺀다
HOME_ONLY = re.compile(r"집에서|집밥|홈쿡|홈카페|홈트|레시피|배달|자취|방구석|침대|넷플릭스|정주행|직접 만들어 먹")


MERGE_PROMPT = f"""너는 사용자의 여가 취향을 설명하고 물어볼 거리를 만드는 사람이다.
최종 목표는 제주도에서 **밖으로 나가서 즐기는 데이트 또는 여행 코스**를 추천하는 것이고, 지금은 그 준비 단계다.

[이미 정해진 값]은 서버가 사진과 유튜브를 가중 합산해서 계산한 결과다. **이 값을 바꾸거나 다시 판단하지 않는다.**
너는 이 값이 맞다고 보고, 아래 세 가지만 만든다.

할 일 1 — 동적 주제 {N_TOPICS}개
이 사람의 기록에서만 나올 수 있는 주제와 선택지를 매번 새로 만든다. 일반적인 설문 문항이 아니라
"이 사람 기록을 본 사람만 쓸 수 있는 문장"이어야 한다.
- name: 주제 이름 (12자 안팎). 예: "요즘 반복되는 저녁", "혼자 있고 싶을 때"
- opts: 선택지 3~5개. l(라벨)은 15자 안팎의 구체적인 장면. 예: "노포에서 조용히 한잔"
- 선택지마다 성격이 가까운 기본값을 붙인다 — mood(calm 힐링·휴식 / active 운동·액티비티 / new 새로운 경험 / food 미식),
  spend(meal 식사 / cafe 카페·디저트 / drink 술·바 / play 전시·체험), tag({" / ".join(TAGS)}). 해당 없으면 null.
- 주제 하나는 여러 개 고를 수 있게(multi=true) 만들어도 된다.
- hint: 코스를 짤 LLM에게 넘길 한 줄 설명. 사용자가 고른 답을 어떻게 반영할지 쓴다.
- evidence: 이 주제를 왜 물어보는지, 기록에서 찾은 근거 한 줄.
- 고정 주제({", ".join(FIXED_NAMES.values())})와 겹치는 주제는 만들지 않는다.
- **주제와 모든 선택지는 데이트·여행 코스에 넣을 수 있는 '밖에서 하는 장면'이어야 한다.** 답을 고르면 식당·카페·바·전시·공방·시장·공원 같은 장소가 떠올라야 한다.
  집에서 하는 일(요리·레시피·홈카페·홈트·게임·드라마 정주행 등)은 그대로 묻지 않고, 기록에 담긴 관심을 밖에서 즐기는 장면으로 바꾼다.
  예) 집밥·요리 영상이 많음 → 주제 "요리 좋아하는 두 사람의 외출": "쿠킹 클래스에서 같이 만들기", "시장에서 제철 재료 구경", "셰프 코스 요리 먹어보기"
  예) 홈트 영상이 많음 → "몸 쓰는 데이트": "클라이밍 체험", "한강 러닝 후 브런치"
  나쁜 예) "집에서 무슨 요리를 할까요?", "새 레시피 시도하기", "배달 음식 고르기" — 코스에 넣을 수 없어서 절대 만들지 않는다.
- 선택지마다 mood·spend 중 적어도 하나는 null이 아니게 붙인다 (코스를 짤 때 쓰이는 값).

할 일 2 — 일정(plan)과 누구랑(companion)
이 둘은 계산으로 알 수 없어 네가 고른다. [참고 자료]의 평균 동행 수와 기록 성격을 보고 하나씩 고른다.

할 일 3 — highlights
결과 화면에 띄울 짧은 칩 2~3개. 예: "저녁 7시 이후 사진이 절반", "평균 2명과 함께".
[참고 자료]에 실제로 있는 숫자와 이름만 쓴다.

데이터에 없는 장소명·수치를 지어내지 않는다. 사진을 읽지 못했다고 적혀 있으면 사진 이야기를 꺼내지 않는다."""


def merge_schema() -> dict:
    opt = _obj({
        "v": {"type": "string"},
        "l": {"type": "string"},
        "mood": {"type": ["string", "null"], "enum": [*TRAITS["mood"], None]},
        "spend": {"type": ["string", "null"], "enum": [*TRAITS["spend"], None]},
        "tag": {"type": ["string", "null"], "enum": [*TAGS, None]},
    })
    topic = _obj({
        "key": {"type": "string"},
        "name": {"type": "string"},
        "multi": {"type": "boolean"},
        "hint": {"type": "string"},
        "evidence": {"type": "string"},
        "opts": {"type": "array", "items": opt},
    })
    return _obj({
        "plan": _enum(PLANS),
        "companion": _enum(COMPANIONS),
        "highlights": {"type": "array", "items": {"type": "string"}},
        "topics": {"type": "array", "items": topic},
    })


def blend_tags(rows: list[dict], yt: dict | None, weights: dict) -> list[str]:
    """태그도 같은 방식으로 합산 — 사진 태그 비율 × 사진 가중치 + 유튜브 태그 비율 × 유튜브 가중치"""
    ph = ratios(Counter(t for r in rows for t in r.get("tags", [])), TAGS)
    yt_scores = ((yt or {}).get("scores") or {}).get("tags", {})
    y = ratios(yt_scores, TAGS)
    wp, wy = (weights["photo"] if ph else 0), (weights["youtube"] if y else 0)
    if wp + wy <= 0:
        return []
    mixed = {t: (ph.get(t, 0) * wp + y.get(t, 0) * wy) / (wp + wy) for t in TAGS}
    return [t for t in sorted(mixed, key=mixed.get, reverse=True) if mixed[t] > 0][:3]


def analyze(req: TasteRequest, yt: dict | None) -> dict:
    """사진 분석 · 유튜브 집계를 각각 비율로 바꿔 가중 합산 → 값은 서버가 확정 → LLM은 설명과 주제만"""
    if not req.photos and not yt:
        raise TasteError("분석할 기록이 없어요")

    # 사진 읽기가 실패해도 유튜브만으로 계속 간다 (두 갈래가 서로를 막지 않게)
    photo_error = ""
    try:
        rows = read_photos(thin(req.photos))
    except TasteError as e:
        rows, photo_error = [], str(e)
    if req.photos and not rows and not photo_error:
        photo_error = "사진에서 읽어낸 게 없어요"

    stats = photo_stats(rows)
    ph, y = photo_ratios(rows), yt_ratios(yt)
    n_yt = ((yt or {}).get("scores") or {}).get("n", 0)
    scores, weights = blend(ph, y, len(rows), n_yt)
    if not scores:
        raise TasteError(photo_error or "취향을 판단할 근거가 부족해요")

    top = pick_top(scores)
    tags = blend_tags(rows, yt, weights)

    user = {
        "이미 정해진 값": {AXIS_NAMES[a]: (TRAITS.get(a) or {}).get(v, v) for a, v in top.items() if v},
        "항목별 점수": scores,
        "가중치": weights,
        "태그": tags,
        "참고 자료": {
            "사진": {"읽은 장수": len(rows), "집계": stats,
                   "한 장씩": [{k: r[k] for k in ("hour", "day", "area", "place", "tags", "people", "note")
                             if r.get(k) is not None} for r in rows]} if rows else f"사진 없음 ({photo_error or '연결 안 함'})",
            "유튜브": yt_brief(yt) or "유튜브 없음",
        },
        "선택지 라벨": {"plan": FIXED["plan"], "companion": FIXED["companion"]},
    }
    out = _call_llm(
        [{"role": "system", "content": MERGE_PROMPT},
         {"role": "user", "content": json.dumps(user, ensure_ascii=False)}],
        merge_schema(), "taste_profile",
    )

    topics = []
    for t in out.get("topics", []):
        if HOME_ONLY.search(t["name"]):
            continue
        # 코스로 옮길 수 없는 선택지(집에서 하는 일·코스 값이 없는 것)는 뺀다
        t["opts"] = [o for o in t.get("opts", []) if not HOME_ONLY.search(o["l"]) and (o.get("mood") or o.get("spend"))]
        if len(t["opts"]) >= 2:
            topics.append(t)
    topics = topics[:N_TOPICS]
    # 옵션 값(v)이 비거나 겹치면 프론트 선택이 꼬여서 서버가 다시 매긴다
    for ti, t in enumerate(topics):
        for oi, o in enumerate(t["opts"]):
            o["v"] = f"t{ti}o{oi}"
    return {
        "source": "llm",
        "fixed": {"crowd": top.get("crowd"), "hour": top.get("hour"), "pace": top.get("pace"),
                  "plan": out.get("plan"), "companion": out.get("companion")},
        "base": {"mood": top.get("mood"), "spend": top.get("spend")},  # 동적 주제에서 아무것도 안 골랐을 때의 기본값
        "scores": scores,
        "weights": weights,
        "evidence": evidence_lines(scores, ph, y, weights, len(rows), n_yt),
        "tags": tags,
        "highlights": out.get("highlights", [])[:3],
        "topics": topics,
        "photo": {"total": len(rows), "days": stats["days"], "party": stats["party"], "error": photo_error},
        "youtube": {"likes": (yt or {}).get("likes", 0), "subs": (yt or {}).get("subs", 0)},
    }
