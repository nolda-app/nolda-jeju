"""places_jeju.csv의 repPhoto URL을 Supabase places.image_url에 일괄 업데이트.

실행: python backend/scripts/update_jeju_images.py
"""
import csv, json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from dotenv import load_dotenv
load_dotenv(ROOT / "backend" / ".env")

from db import get_client  # noqa: E402

SRC = ROOT / "backend" / "data" / "places_jeju.csv"

def main():
    updates: list[tuple[str, str]] = []
    with open(SRC, encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            try:
                img = ((json.loads(r.get("raw_json") or "{}").get("repPhoto") or {}).get("photoid") or {}).get("imgpath")
            except (ValueError, AttributeError):
                img = None
            if img:
                updates.append((r["id"], img))

    print(f"업데이트 대상: {len(updates)}곳")
    db = get_client()
    batch = 100
    for i in range(0, len(updates), batch):
        chunk = updates[i:i+batch]
        for pid, img_url in chunk:
            db.table("places").update({"image_url": img_url}).eq("id", pid).execute()
        print(f"  {min(i+batch, len(updates))}/{len(updates)} 완료")

    print("완료!")

if __name__ == "__main__":
    main()
