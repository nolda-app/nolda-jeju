"""코스 추천 품질 점검 — 대표 조건 몇 가지로 코스를 만들어 지표를 출력.

지표: 코스 수(4개 보장), 걸린 시간, AI 검증 탈락 이유, 코스 구성(취향 맞춤·추가 추천·기본),
      시간 채움률, 영업시간 밖 방문, 같은 종류 과다, 유료 업종 0원, 함께 가는 사람 리뷰 태그 일치율

실행: python backend/scripts/eval_courses.py          (AI 사용 — 조건당 약 30~60초, OpenAI 비용 발생)
      python backend/scripts/eval_courses.py --no-llm (기본 코스만)
"""
import os, random, sys, time
from collections import Counter
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
load_dotenv(ROOT / "backend" / ".env")
if "--no-llm" in sys.argv:
    os.environ["OPENAI_API_KEY"] = ""

import courses as C  # noqa: E402
from places import load_places  # noqa: E402

CASES = [
    {"cond": {"area": "애월"}, "time_window": {"start": 12, "end": 18}, "taste": {"companion": "couple", "mood": "calm", "spend": "cafe"}},
    {"cond": {"area": "any"}, "time_window": {"start": 18, "end": 23}, "taste": {"companion": "friends", "spend": "drink"}},
    {"cond": {"area": "서귀포"}, "time_window": {"start": 10, "end": 15}, "taste": {"companion": "solo", "crowd": "quiet", "spend": "meal"}},
    {"cond": {"area": "중문"}, "time_window": {"start": 11, "end": 19}, "taste": {"companion": "family", "mood": "active", "plan": "relaxed"}},
]
PAID = {"식사", "카페", "한잔", "체험"}


def main() -> None:
    by_id = {p["id"]: p for p in load_places()}
    total = Counter()
    for case in CASES:
        req = C.CourseRequest(**case)
        t = time.time()
        res = C.generate_courses(req, random.Random(7))
        sec = time.time() - t
        want = set(C.COMPANION_TAGS.get(req.taste.companion or "", []))
        m = Counter()
        for c in res["courses"]:
            places = [by_id[i["pid"]] for i in c["items"]]
            kinds = [p["kind"] for p in places]
            used = sum(i["d"] for i in c["items"]) + sum(l["t"] for l in c["legs"])
            m["fill"] += min(used / req.time_window.minutes, 1.5)
            m["closed"] += 0 if C.visits_open(places, c["items"], c["legs"], req.time_window.start * 60) else 1
            m["overuse"] += any(kinds.count(k) > n for k, n in C.MAX_SAME_KIND.items())
            m["zero_cost"] += sum(1 for i in c["items"] if i["k"] in PAID and i["c"] == 0)
            m["tag_hit"] += sum(1 for p in places if want & set(p["tags"]))
            m["places"] += len(places)
        n = len(res["courses"]) or 1
        print(f"\n[{case['cond']['area']} {case['time_window']['start']}~{case['time_window']['end']}시 · {req.taste.companion}] "
              f"코스 {len(res['courses'])}개 · {sec:.0f}초 · AI 탈락 {res['rejected']} {res['reject_reasons']} · 순서 바꿔 살림 {res.get('reordered', 0)} · 구성 {res['sources']}"
              + (f" · AI 오류: {res['llm_error']}" if res.get("llm_error") else ""))
        print(f"  시간 채움 {m['fill'] / n:.0%} · 영업시간 밖 {m['closed']} · 같은 종류 과다 {m['overuse']} · 유료 0원 {m['zero_cost']} · 태그 일치 {m['tag_hit'] / max(m['places'], 1):.0%}")
        for c in res["courses"]:
            print("   -", c["title"], "|", " → ".join(f"{i['k']}:{i['n'][:10]}" for i in c["items"]))
        total.update({k: v for k, v in m.items()})
        total["courses"] += len(res["courses"])
        total["short"] += len(res["courses"]) < C.N_COURSES
        total["taste"] += res["sources"]["taste"]
        total["rejected"] += res["rejected"]
        total["sec"] += sec
    print(f"\n합계: 4개 미만 {total['short']}건 · 취향 맞춤 {total['taste']}/{total['courses']} · 평균 {total['sec'] / len(CASES):.0f}초 · 영업시간 밖 {total['closed']} · 같은 종류 과다 {total['overuse']} · "
          f"유료 0원 {total['zero_cost']} · 태그 일치 {total['tag_hit'] / max(total['places'], 1):.0%}")


if __name__ == "__main__":
    main()
