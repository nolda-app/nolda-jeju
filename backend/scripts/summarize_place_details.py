"""place_details_selenium.csv의 원문 business_hours/menu를 요약해서 컬럼으로 추가.

- business_hours_summary: 요일별 원문을 같은 시간대끼리 묶어 "월~금 11:30-22:00 / 토,일 ..." 형태로 요약
- price_per_person / price_shared: 인원수(n) 기준 예상 비용 계산용 단가.
  실제 인원수는 앱에서 입력받으므로 여기서는 고정하지 않고, 다음 공식의 재료만 저장한다.
      예상 비용(n인) = price_per_person × n + (price_shared 있으면 1회)
  카테고리별로 "개인용 1개" vs "나눠먹는 1개"를 다르게 판단한다:
    - 카페: 음료류 키워드 매칭 항목 -> 개인용(n잔), 나머지 -> 나눔(디저트 1개)
    - 한잔: 술/음료 키워드 매칭 항목 -> 개인용(n잔), 나머지 -> 나눔(안주 1개)
    - 식사: 메뉴명에 "단품"/"1인" 있으면 개인용, "세트"·"n인"(n>=2) 있으면 나눔, 그 외 개인용 기본
    - 위 키워드가 하나도 안 걸리는 메뉴(빵집처럼 품목이 다 비슷한 경우)는 이름 신호(단품/세트/n인)로 대체 분류
  체험/문화처럼 애초에 "메뉴" 개념이 없는 카테고리, 혹은 가격을 하나도 못 읽은 메뉴는 계산 대상에서 제외.
- menu_summary: 위 계산 결과를 사람이 읽을 문장으로 요약 (계산 불가 시 항목 수 + 가격대로 대체)

원문 컬럼(business_hours, menu)은 그대로 두고 요약 컬럼만 추가한다 — 원문은 이후
요일별 jsonb 정규화 등에 필요할 수 있어서 보존 (PLACE_DATA_PIPELINE.md 참고).

실행: python backend/scripts/summarize_place_details.py
"""
import csv
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CSV_PATH = ROOT / "backend" / "data" / "place_details_selenium.csv"
MAPO_CSV = ROOT / "backend" / "data" / "places_jeju.csv"

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_places_geo import classify  # noqa: E402

# 메뉴/가격 계산 대상 종류만 남김 — 체험/문화/산책/운동은 "메뉴" 개념이 없어 계산 제외
COST_KIND = {"식사": "식사", "카페": "카페", "한잔": "한잔"}


def load_category_by_pid() -> dict[str, str]:
    """place_details_selenium.csv의 pid -> places_jeju.csv 기준 분류(식사/카페/한잔/그 외)"""
    with open(MAPO_CSV, encoding="utf-8-sig", newline="") as f:
        return {r["id"]: COST_KIND.get(classify(r["name"], r["category"])) for r in csv.DictReader(f)}
DRINK_KEYWORDS = [
    "아메리카노", "라떼", "에이드", "커피", "콜드브루", "쉐이크", "스무디", "주스", "콜라", "사이다",
    "맥주", "하이볼", "막걸리", "소주", "와인", "사케", "생맥주", "칵테일", "위스키", "음료",
]  # "차"/"티"는 "말차"/"티케이크"처럼 디저트명에도 흔히 섞여서 오탐이 많아 제외
SHARED_NAME_RE = re.compile(r"[2-9]\d*\s*인분?|세트")

DAY_ORDER = ["월", "화", "수", "목", "금", "토", "일"]
DAY_TOKEN_RE = re.compile(r"(?:^|\s)([일월화수목금토])(?=\s*(?:\(|\d{1,2}:|정기휴무|휴무))")
TIME_RANGE_RE = re.compile(r"\d{1,2}:\d{2}(?:\s*-\s*(?:다음\s*날\s*)?\d{1,2}:\d{2})?")
BREAK_RE = re.compile(r"\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\s*브레이크타임")


def parse_day_segments(raw: str) -> dict | None:
    if "매일" in raw and not DAY_TOKEN_RE.search(raw):
        seg = raw.split("매일", 1)[1].strip()
        return {d: seg for d in DAY_ORDER}

    idxs = [(m.group(1), m.start() + m.group(0).index(m.group(1))) for m in DAY_TOKEN_RE.finditer(raw)]
    if not idxs:
        return None
    days = {}
    for i, (day, start) in enumerate(idxs):
        end = idxs[i + 1][1] if i + 1 < len(idxs) else len(raw)
        days[day] = raw[start:end].strip()[1:].strip()
    return days


def day_key(seg: str | None):
    if seg is None:
        return ("미상",)
    if "정기휴무" in seg or seg.startswith("휴무"):
        return ("휴무",)
    times = TIME_RANGE_RE.findall(seg)
    primary = times[0] if times else None
    return ("영업", primary, bool(BREAK_RE.search(seg)))


_UNSET = object()


def group_days(days: dict) -> list:
    groups, cur_key, cur_days = [], _UNSET, []
    for d in DAY_ORDER:
        k = day_key(days.get(d))
        if k == cur_key:
            cur_days.append(d)
        else:
            if cur_days:
                groups.append((cur_key, cur_days))
            cur_key, cur_days = k, [d]
    if cur_days:
        groups.append((cur_key, cur_days))
    return groups


def render_group_days(dlist: list) -> str:
    if len(dlist) == 1:
        return dlist[0]
    consecutive = all(DAY_ORDER.index(dlist[i + 1]) == DAY_ORDER.index(dlist[i]) + 1 for i in range(len(dlist) - 1))
    return f"{dlist[0]}~{dlist[-1]}" if (consecutive and len(dlist) > 2) else ",".join(dlist)


def summarize_hours(raw: str) -> str:
    if not raw:
        return ""
    if "24시간" in raw:
        return "24시간 연중무휴"
    days = parse_day_segments(raw)
    if not days:
        m = re.match(r"^(영업\s?중|영업\s?전|운영\s?중|운영\s?전)", raw)
        return (m.group(0) + " (상세는 원문 참고)") if m else raw[:40]
    parts = []
    for key, dlist in group_days(days):
        if key[0] == "미상":
            continue  # 언급 안 된 요일 — 휴무로 단정하지 않고 건너뜀
        label = render_group_days(dlist)
        if key[0] == "휴무":
            parts.append(f"{label} 휴무")
        else:
            _, primary, has_break = key
            t = primary or "시간 미상"
            if has_break:
                t += " (브레이크타임 있음)"
            parts.append(f"{label} {t}")
    return " / ".join(parts) if parts else raw[:40]


def parse_priced_items(raw: str) -> list[tuple[str, int]]:
    items = []
    for it in [s.strip() for s in raw.split(";") if s.strip()]:
        if m := re.search(r"([\d,]+)\s*원\s*$", it):
            items.append((it, int(m.group(1).replace(",", ""))))
    return items


def avg(nums: list[int]) -> int | None:
    return int(round(sum(nums) / len(nums), -3)) if nums else None  # 천원 단위로 반올림


def split_by_name_signal(items: list[tuple[str, int]]) -> tuple[list[int], list[int]]:
    individual, shared = [], []
    for name, price in items:
        if "단품" in name or re.search(r"1\s*인(?!분)", name):
            individual.append(price)
        elif SHARED_NAME_RE.search(name):
            shared.append(price)
        else:
            individual.append(price)
    return individual, shared


def compute_cost_model(category: str | None, raw_menu: str) -> dict | None:
    """n인 기준 예상 비용 계산 재료. {per_person, shared, personal_label, shared_label} 또는 계산 불가 시 None."""
    items = parse_priced_items(raw_menu or "")
    if not items or category not in ("카페", "한잔", "식사"):
        return None

    if category in ("카페", "한잔"):
        drinks = [p for name, p in items if any(k in name for k in DRINK_KEYWORDS)]
        others = [p for name, p in items if not any(k in name for k in DRINK_KEYWORDS)]
        personal_label = "음료 1잔" if category == "카페" else "술/음료 1잔"
        shared_label = "디저트 1개(나눔)" if category == "카페" else "안주 1개(나눔)"
        if drinks:
            return {"per_person": avg(drinks), "shared": avg(others) if others else None,
                    "personal_label": personal_label, "shared_label": shared_label if others else None}
        individual, shared_items = split_by_name_signal(items)
        return {"per_person": avg(individual), "shared": avg(shared_items),
                "personal_label": "메뉴 1개", "shared_label": "나눔 메뉴 1개" if shared_items else None}

    individual, shared_items = split_by_name_signal(items)  # 식사
    return {"per_person": avg(individual), "shared": avg(shared_items),
            "personal_label": "메인 1인분", "shared_label": "세트/나눔 메뉴 1개" if shared_items else None}


def summarize_menu(category: str | None, raw: str) -> str:
    if not raw:
        return ""
    items = [s.strip() for s in raw.split(";") if s.strip()]
    n = len(items)

    model = compute_cost_model(category, raw)
    if model and model["per_person"] is not None:
        text = f"{model['personal_label']} 평균 {model['per_person']:,}원"
        if model["shared"] is not None:
            text += f" + {model['shared_label']} 평균 {model['shared']:,}원"
        return text

    prices = [p for _, p in parse_priced_items(raw)]
    free = sum(1 for it in items if re.search(r"무료\s*$", it))
    variable = sum(1 for it in items if re.search(r"변동\s*$", it))
    if not prices:
        return f"{n}개 메뉴 · 가격 변동/미표시" if (variable or free) else f"{n}개 메뉴"
    lo, hi = min(prices), max(prices)
    price_range = f"{lo:,}원" if lo == hi else f"{lo:,}~{hi:,}원"
    extras = [p for p in [f"무료 {free}개" if free else None, f"변동가 {variable}개" if variable else None] if p]
    extra_s = f" ({', '.join(extras)} 포함)" if extras else ""
    return f"{n}개 메뉴 · {price_range}{extra_s}"


def main() -> None:
    category_by_pid = load_category_by_pid()
    rows = list(csv.DictReader(open(CSV_PATH, encoding="utf-8-sig")))
    for r in rows:
        category = category_by_pid.get(r["pid"])
        r["business_hours_summary"] = summarize_hours(r["business_hours"])
        r["menu_summary"] = summarize_menu(category, r["menu"])

        model = compute_cost_model(category, r["menu"])
        r["price_per_person"] = model["per_person"] if model else ""
        r["price_shared"] = model["shared"] if model and model["shared"] is not None else ""
        r["price_personal_label"] = model["personal_label"] if model else ""
        r["price_shared_label"] = model["shared_label"] if model and model["shared_label"] else ""

    fieldnames = list(rows[0].keys())
    with open(CSV_PATH, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(rows)

    print(f"{len(rows)}곳에 business_hours_summary/menu_summary 컬럼 추가 -> {CSV_PATH}")


if __name__ == "__main__":
    main()
