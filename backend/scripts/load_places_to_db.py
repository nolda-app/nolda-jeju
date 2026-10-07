"""places_jeju.csv(장소) + places_jeju_with_inferred_tags.csv(블로그 리뷰로 추론한 태그)
+ place_details_selenium.csv(전화/영업시간/가격) + place_images.csv(대표사진 S3 URL)를 합쳐
Supabase `places` 테이블에 upsert. 테이블은 미리 scripts/places_table.sql로 만들어둬야 함.

실행: python backend/scripts/load_places_to_db.py
"""
import ast
import csv
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
load_dotenv(ROOT / "backend" / ".env")

from db import get_client  # noqa: E402
from places import image_urls, load_places_csv  # noqa: E402

MAPO_CSV = ROOT / "backend" / "data" / "places_jeju.csv"
TAGS_CSV = ROOT / "backend" / "data" / "places_jeju_with_inferred_tags.csv"  # 태그가 더 많이 채워진 파일 (없으면 MAPO_CSV)
DETAILS_CSV = ROOT / "backend" / "data" / "place_details_selenium.csv"
BATCH = 200


def load_tags_and_area() -> dict[str, dict]:
    with open(TAGS_CSV if TAGS_CSV.exists() else MAPO_CSV, encoding="utf-8-sig", newline="") as f:
        out = {}
        for r in csv.DictReader(f):
            try:
                tags = ast.literal_eval(r["tags"]) if r["tags"] else []
            except (ValueError, SyntaxError):
                tags = []
            out[r["id"]] = {"tags": tags, "area": r["area"] or None}
        return out


def load_details() -> dict[str, dict]:
    """뒤에 나온 행이 이김(이어하기로 재시도한 결과가 앞선 error를 덮어씀). status=ok인 것만 값 채움."""
    with open(DETAILS_CSV, encoding="utf-8-sig", newline="") as f:
        out = {}
        for r in csv.DictReader(f):
            if r["status"] != "ok":
                continue
            out[r["pid"]] = {
                "phone": r["phone"] or None,
                "business_hours": r["business_hours_summary"] or None,
                "menu_summary": r["menu_summary"] or None,
                "price_per_person": int(r["price_per_person"]) if r["price_per_person"] else None,
            }
        return out


def main() -> None:
    tags_map = load_tags_and_area()
    details_map = load_details()

    rows = []
    for p in load_places_csv():
        extra = tags_map.get(p["id"], {})
        detail = details_map.get(p["id"], {})
        rows.append({
            "id": p["id"], "name": p["name"], "category": p["cat"], "address": p["addr"],
            "lat": p["lat"], "lng": p["lng"], "kind": p["kind"],
            "area": extra.get("area"), "tags": extra.get("tags", []),
            "phone": detail.get("phone"), "business_hours": detail.get("business_hours"),
            "menu_summary": detail.get("menu_summary"), "price_per_person": detail.get("price_per_person"),
            "image_url": image_urls().get(p["id"]),
        })

    sb = get_client()
    try:
        sb.table("places").select("image_url").limit(1).execute()
    except Exception:  # noqa: BLE001 — 컬럼이 아직 없으면 사진만 빼고 적재
        print("places.image_url 컬럼이 없어 사진 URL은 건너뜀 (scripts/places_image_column.sql 실행 후 다시)")
        for r in rows:
            r.pop("image_url")
    with_detail = sum(1 for r in rows if r["phone"] or r["business_hours"])
    with_tags = sum(1 for r in rows if r["tags"])
    print(f"{len(rows)}곳 (상세정보 {with_detail}곳, 태그 {with_tags}곳) -> Supabase upsert")

    for i in range(0, len(rows), BATCH):
        chunk = rows[i:i + BATCH]
        sb.table("places").upsert(chunk, on_conflict="id").execute()
        print(f"  {i + len(chunk)}/{len(rows)}")

    print("완료")


if __name__ == "__main__":
    main()
