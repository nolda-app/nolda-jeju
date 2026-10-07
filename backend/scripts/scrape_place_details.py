"""네이버 플레이스 상세페이지에서 phone/business_hours/menu 스크래핑.

공식 지역검색 API는 telephone 필드를 항상 비워서 내려주고(문서에 명시된 하위호환용 필드),
영업시간/메뉴 필드 자체가 없음 -> 상세페이지(pcmap.place.naver.com)를 Selenium으로 직접 열어서 수집.

대상: places.load_places()가 반환하는 코스 후보 전체(현재 약 1059곳, build_places_geo.py와
같은 usable() 필터 기준). pid는 임의 uuid라 상세페이지 URL을 바로 만들 수 없어서, 매번 지도
검색으로 진입해 실제 placeId(및 카테고리별 URL 경로)를 얻는다.

차단 문구("과도한 접근" 등)가 감지되면 그 즉시 전체 중단한다 — 재시도하거나
우회하지 않는다. 결과는 매 건마다 CSV에 append하므로 중간에 멈춰도 그때까지 결과는 남는다.
이미 CSV에 있는 pid(직전 실행에서 처리한 곳)는 다시 요청하지 않고 건너뛴다 — 여러 번
나눠 돌려서 전체를 채우는 걸 전제로 함.

실행: python backend/scripts/scrape_place_details.py
"""
import csv
import random
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from bs4 import BeautifulSoup
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
from places import load_places  # noqa: E402

OUT_CSV = ROOT / "backend" / "data" / "place_details_selenium.csv"
FIELDNAMES = ["pid", "name", "phone", "business_hours", "menu", "status", "scraped_at"]

BLOCK_PATTERNS = ["과도한 접근", "이용이 제한", "일시적으로 차단", "비정상적인 접근"]


def already_scraped() -> set[str]:
    """이미 CSV에 있는 pid 중 재시도 대상이 아닌 것만 — status=error(셀레니움 오류로 건너뜀)는 다음 실행 때 다시 시도"""
    if not OUT_CSV.exists():
        return set()
    with open(OUT_CSV, encoding="utf-8-sig", newline="") as f:
        return {r["pid"] for r in csv.DictReader(f) if r["status"] != "error"}


def places_to_scrape() -> list[dict]:
    done = already_scraped()
    return [{"pid": p["id"], "name": p["name"], "address": p["addr"]} for p in load_places() if p["id"] not in done]


class BlockedError(Exception):
    pass


def check_blocked(page_text: str) -> None:
    for pat in BLOCK_PATTERNS:
        if pat in page_text:
            raise BlockedError(f"차단 문구 감지: '{pat}'")


def road_token(addr: str) -> str | None:
    """'제주특별자치도 제주시 애월읍 애월해안로 272 ...' -> '애월해안로' (도로명까지만 비교용으로 추출)."""
    m = re.search(r"(제주시|서귀포시)\s+(?:\S+[읍면]\s+)?(\S+)", addr)
    return m.group(2) if m else None


def labeled_value(soup: BeautifulSoup, label: str) -> str | None:
    """'전화번호'/'영업시간' 같은 라벨(span.place_blind)의 부모 row 전체 텍스트에서 라벨을 뗀 값."""
    node = soup.find(string=lambda s: s and s.strip() == label)
    if not node:
        return None
    row = node.parent.parent.parent  # place_blind span -> strong -> row div
    text = row.get_text(" ", strip=True)
    return text[len(label):].strip() or None


def extract_menu(soup: BeautifulSoup) -> str:
    items = []
    for item in soup.find_all("div", class_="MXkFw"):
        name_el = item.select_one(".lPzHi")
        price_el = item.select_one(".p2H02")
        name = name_el.get_text(" ", strip=True) if name_el else None
        price = price_el.get_text(" ", strip=True) if price_el else None
        if name:
            items.append(f"{name} {price}".strip())
    return "; ".join(items)


def extract_fee_table(soup: BeautifulSoup) -> str:
    """체험/문화 등 '메뉴' 탭이 없는 업종은 홈 화면에 '가격표'라는 별도 라벨로 이용료가 나온다
    (클라이밍장 이용권, 보드카페 이용료, 만화카페 시간권 등). 구조는 메뉴와 달라서 별도 선택자 필요."""
    items = []
    for row in soup.find_all("div", class_="JLkY7"):
        name_el = row.select_one(".A_cdD") or row.select_one(".li2Pi")
        price_el = row.select_one(".CLSES")
        name = name_el.get_text(" ", strip=True) if name_el else None
        price = price_el.get_text(" ", strip=True) if price_el else None
        if name:
            items.append(f"{name} {price}".strip() if price else name)
    return "; ".join(items)


def find_place_id(driver, query: str) -> str | None:
    """지도 검색 진입 -> entryIframe(단일 매칭 시 자동 진입) 또는 searchIframe(목록)에서 첫 결과 클릭."""
    driver.get(f"https://map.naver.com/p/search/{query}")

    try:
        iframe = WebDriverWait(driver, 6).until(
            EC.presence_of_element_located((By.ID, "entryIframe"))
        )
    except Exception:
        iframe = None

    if iframe is None:
        # 단일 매칭이 아니라 후보 목록(searchIframe)이 뜬 경우 -> 첫 번째 결과 클릭
        try:
            search_iframe = driver.find_element(By.ID, "searchIframe")
        except Exception:
            return None
        driver.switch_to.frame(search_iframe)
        try:
            first_link = driver.find_element(By.CSS_SELECTOR, "li a")
            driver.execute_script("arguments[0].click();", first_link)
        except Exception:
            driver.switch_to.default_content()
            return None
        time.sleep(1.5)
        driver.switch_to.default_content()
        try:
            iframe = WebDriverWait(driver, 6).until(
                EC.presence_of_element_located((By.ID, "entryIframe"))
            )
        except Exception:
            return None

    src = iframe.get_attribute("src") or ""
    m = re.search(r"/(\d{6,})(?:/|\?|$)", src)
    return m.group(1) if m else None


def scrape_one(driver, place: dict) -> dict:
    row = {"pid": place["pid"], "name": place["name"], "phone": "", "business_hours": "",
           "menu": "", "status": "", "scraped_at": datetime.now(timezone.utc).isoformat()}

    place_id = find_place_id(driver, f"{place['name']} 제주")
    if place_id is None:
        row["status"] = "not_found"
        return row

    # entryIframe 안이 아니라 최상위 문서로 직접 진입 -> iframe 스위칭 불필요, Naver가
    # 카테고리별 실제 경로(restaurant/cafe/...)로 자동 리다이렉트해준다.
    driver.get(f"https://pcmap.place.naver.com/place/{place_id}/home")
    time.sleep(2)
    check_blocked(driver.execute_script("return document.body.innerText") or "")

    soup = BeautifulSoup(driver.page_source, "html.parser")

    addr_text = labeled_value(soup, "주소") or ""
    # "제주시/서귀포시"까지는 대부분 동일해서 도로명(예: "와우산로23길")까지 비교해야 다른 지점과의
    # 오매칭을 잡아낼 수 있다 (예: "츠케루"가 이름만 같은 다른 지점으로 매칭된 사례 있었음)
    expected_road = road_token(place["address"])
    actual_road = road_token(addr_text)
    if expected_road and expected_road != actual_road:
        row["status"] = "mismatch"
        # 그래도 얻을 수 있는 값은 채워서 사람이 나중에 눈으로 확인할 수 있게 남긴다
    else:
        row["status"] = "ok"

    phone_raw = labeled_value(soup, "전화번호") or ""
    phone_match = re.search(r"[\d][\d\-]{6,}\d", phone_raw)
    row["phone"] = phone_match.group(0) if phone_match else ""

    try:
        expand_btn = driver.find_element(
            By.XPATH, "//a[contains(., '펼쳐보기')] | //span[contains(., '펼쳐보기')]"
        )
        driver.execute_script("arguments[0].click();", expand_btn)
        time.sleep(1)
        soup = BeautifulSoup(driver.page_source, "html.parser")
    except Exception:
        pass
    hours_raw = labeled_value(soup, "영업시간") or ""
    # "접기"/"펼쳐보기"(토글 버튼) 및 "영업시간 수정 제안하기"(편집 제안 링크)는 UI 텍스트라 제거
    hours_raw = re.split(r"\s*(?:접기|펼쳐보기)\s*영업시간 수정 제안하기", hours_raw)[0]
    row["business_hours"] = hours_raw.strip()

    try:
        driver.get(f"https://pcmap.place.naver.com/place/{place_id}/menu/list")
        time.sleep(2)
        check_blocked(driver.execute_script("return document.body.innerText") or "")
        menu_soup = BeautifulSoup(driver.page_source, "html.parser")
        row["menu"] = extract_menu(menu_soup) or extract_fee_table(menu_soup)
    except BlockedError:
        raise
    except Exception:
        pass  # 메뉴 탭이 없는 업종(갤러리/전시관 등) -> 빈 값 유지

    return row


RECYCLE_EVERY = 60  # 이만큼 처리할 때마다 브라우저를 새로 띄움 — 오래 켜두면 세션이 맛가서 매 요청이 stale/timeout으로 실패함


def new_driver():
    d = webdriver.Chrome()
    d.maximize_window()
    return d


def main() -> None:
    OUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    is_new = not OUT_CSV.exists()
    todo = places_to_scrape()
    print(f"대상 {len(todo)}곳 (이미 처리한 곳 제외)")

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
                    row = scrape_one(driver, place)
                except BlockedError as e:
                    print(f"  차단 감지 -> 즉시 중단: {e}")
                    writer.writerow({"pid": place["pid"], "name": place["name"], "phone": "",
                                      "business_hours": "", "menu": "", "status": "blocked",
                                      "scraped_at": datetime.now(timezone.utc).isoformat()})
                    f.flush()
                    break
                except Exception as e:
                    # 차단이 아니라 셀레니움/브라우저 자체 오류(요소 stale, 타임아웃, 세션 끊김 등)
                    # -> 이 한 곳만 실패 처리하고 계속. 다음 곳부터는 무조건 새 브라우저로 (지금 세션이 맛갔을 수 있음)
                    print(f"  오류(건너뜀): {e!r}")
                    writer.writerow({"pid": place["pid"], "name": place["name"], "phone": "",
                                      "business_hours": "", "menu": "", "status": "error",
                                      "scraped_at": datetime.now(timezone.utc).isoformat()})
                    f.flush()
                    since_recycle = RECYCLE_EVERY
                    time.sleep(random.uniform(5, 15))
                    continue

                since_recycle += 1
                writer.writerow(row)
                f.flush()
                print(f"  -> {row['status']} | phone={row['phone']!r} | hours={row['business_hours'][:40]!r}")

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
