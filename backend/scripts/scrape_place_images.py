"""네이버 플레이스 상세페이지의 대표사진(og:image)을 가져와 Supabase Storage(S3 호환)에 올리고,
결과(pid, S3 공개 URL)를 CSV에 남긴다.

scrape_place_details.py와 같은 방식(지도 검색 -> placeId 진입, 차단 감지 시 즉시 중단,
이어하기, 60곳마다 브라우저 재시작)을 그대로 따름 — 두 스크립트가 각자 페이지를 열기 때문에
따로 돈다(합치면 한쪽 실패가 다른 쪽까지 막음).

실행: python backend/scripts/scrape_place_images.py
"""
import csv
import random
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import boto3
import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
load_dotenv(ROOT / "backend" / ".env")

from places import load_places  # noqa: E402
from scrape_place_details import BlockedError, RECYCLE_EVERY, check_blocked, find_place_id, new_driver  # noqa: E402

OUT_CSV = ROOT / "backend" / "data" / "place_images.csv"
FIELDNAMES = ["pid", "name", "image_url", "status", "scraped_at"]


def s3_client():
    import os
    return boto3.client(
        "s3",
        endpoint_url=os.environ["SUPABASE_S3_ENDPOINT"],
        aws_access_key_id=os.environ["SUPABASE_S3_ACCESS_KEY"],
        aws_secret_access_key=os.environ["SUPABASE_S3_SECRET_KEY"],
        region_name=os.environ["SUPABASE_S3_REGION"],
    )


def public_url(bucket: str, key: str) -> str:
    import os
    return f"{os.environ['SUPABASE_URL']}/storage/v1/object/public/{bucket}/{key}"


def already_scraped() -> set[str]:
    if not OUT_CSV.exists():
        return set()
    with open(OUT_CSV, encoding="utf-8-sig", newline="") as f:
        return {r["pid"] for r in csv.DictReader(f) if r["status"] != "error"}


def places_to_scrape() -> list[dict]:
    done = already_scraped()
    return [{"pid": p["id"], "name": p["name"], "address": p["addr"]} for p in load_places() if p["id"] not in done]


def extract_og_image(driver) -> str | None:
    soup = BeautifulSoup(driver.page_source, "html.parser")
    og = soup.find("meta", property="og:image")
    return og.get("content") if og else None


def upload_image(s3, bucket: str, pid: str, image_url: str) -> str:
    res = requests.get(image_url, timeout=15)
    res.raise_for_status()
    ext = "png" if "png" in res.headers.get("Content-Type", "") else "jpg"
    key = f"places/{pid}.{ext}"
    s3.put_object(Bucket=bucket, Key=key, Body=res.content, ContentType=res.headers.get("Content-Type", "image/jpeg"))
    return public_url(bucket, key)


def scrape_one(driver, s3, bucket: str, place: dict) -> dict:
    row = {"pid": place["pid"], "name": place["name"], "image_url": "", "status": "",
           "scraped_at": datetime.now(timezone.utc).isoformat()}
    place_id = find_place_id(driver, f"{place['name']} 제주")
    if place_id is None:
        row["status"] = "not_found"
        return row

    driver.get(f"https://pcmap.place.naver.com/place/{place_id}/home")
    time.sleep(2)
    check_blocked(driver.execute_script("return document.body.innerText") or "")

    naver_image_url = extract_og_image(driver)
    if not naver_image_url:
        row["status"] = "no_image"
        return row

    row["image_url"] = upload_image(s3, bucket, place["pid"], naver_image_url)
    row["status"] = "ok"
    return row


def main() -> None:
    import os
    OUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    is_new = not OUT_CSV.exists()
    todo = places_to_scrape()
    print(f"대상 {len(todo)}곳 (이미 처리한 곳 제외)")

    s3 = s3_client()
    bucket = os.environ["SUPABASE_S3_BUCKET"]
    driver = new_driver()
    since_recycle = 0

    with open(OUT_CSV, "a", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        if is_new:
            writer.writeheader()
            f.flush()

        try:
            for i, place in enumerate(todo, 1):
                print(f"[{i}/{len(todo)}] {place['name']}")
                try:
                    if since_recycle >= RECYCLE_EVERY:
                        print("  브라우저 재시작 (세션 새로고침)")
                        try:
                            driver.quit()
                        except Exception:
                            pass
                        driver = new_driver()
                        since_recycle = 0
                    row = scrape_one(driver, s3, bucket, place)
                except BlockedError as e:
                    print(f"  차단 감지 -> 즉시 중단: {e}")
                    writer.writerow({"pid": place["pid"], "name": place["name"], "image_url": "",
                                      "status": "blocked", "scraped_at": datetime.now(timezone.utc).isoformat()})
                    f.flush()
                    break
                except Exception as e:
                    print(f"  오류(건너뜀): {e!r}")
                    writer.writerow({"pid": place["pid"], "name": place["name"], "image_url": "",
                                      "status": "error", "scraped_at": datetime.now(timezone.utc).isoformat()})
                    f.flush()
                    since_recycle = RECYCLE_EVERY
                    time.sleep(random.uniform(5, 15))
                    continue

                since_recycle += 1
                writer.writerow(row)
                f.flush()
                print(f"  -> {row['status']} | {row['image_url']}")

                if i < len(todo):
                    time.sleep(random.uniform(5, 15))
        finally:
            try:
                driver.quit()
            except Exception:
                pass

    print(f"완료. 결과: {OUT_CSV}")


if __name__ == "__main__":
    main()
