"""places_jeju.csv의 phoneno를 Supabase places.phone에 일괄 업데이트.

실행: python backend/scripts/update_jeju_phone.py
"""
import csv, json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from dotenv import load_dotenv
load_dotenv(ROOT / "backend" / ".env")

from db import get_client

SRC = ROOT / "backend" / "data" / "places_jeju.csv"

def main():
    updates: list[tuple[str, str]] = []
    with open(SRC, encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            raw = json.loads(r.get("raw_json") or "{}")
            phone = (raw.get("phoneno") or "").strip()
            if phone:
                updates.append((r["id"], phone))

    print(f"전화번호 업데이트 대상: {len(updates)}곳")
    db = get_client()
    batch = 100
    for i in range(0, len(updates), batch):
        for pid, phone in updates[i:i+batch]:
            db.table("places").update({"phone": phone}).eq("id", pid).execute()
        print(f"  {min(i+batch, len(updates))}/{len(updates)} 완료")
    print("완료!")

if __name__ == "__main__":
    main()
