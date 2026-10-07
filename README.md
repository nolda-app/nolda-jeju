# NOLDA (놀다)

세상에 놀거리는 다양하니까 — AI 여가 코스 설계 서비스

사용자가 조건을 직접 입력하는 대신, AI가 사용자 데이터를 분석해 취향·소비패턴을 파악하고 실행 가능한 여가 코스 타임라인(2~3개 시나리오)을 자동으로 설계해주는 서비스.

MVP 지역: 제주도 한정 (2026-09-30 마포구에서 전환 — 장소 데이터 재수집 필요). 상세 방향은 [2026-09-04 회의 정리](docs/meeting-2026-09-04.md), 데이터 수집·분석 전략은 [2026-09-07 정리](docs/data-strategy-2026-09-07.md) 참고.

## 구조

- `frontend/` — 웹앱 프론트엔드 (React + Vite, PWA)
- `backend/` — FastAPI 백엔드 (추천 시스템, GPT API 연동)
  - `backend/scripts/` — 장소·도보 경로 데이터를 프론트엔드용 파일로 생성하는 스크립트 ([지도·코스 데이터](#지도코스-데이터) 참고)
  - 장소 데이터 수집 파이프라인은 [PLACE_DATA_PIPELINE.md](backend/PLACE_DATA_PIPELINE.md) 참고

## 기술 스택

| 영역 | 기술 |
|---|---|
| 언어 | Python 3.11+ / TypeScript |
| 백엔드 | FastAPI |
| 프론트엔드 | React + Vite, PWA (vite-plugin-pwa) |
| DB | Supabase (Postgres) |
| AI/LLM | GPT API (이미지 분석, 블로그 리뷰 분석, 코스 조합을 AI에 위임) |
| 추천 | scikit-learn — 카드/사진 업로드 기반 이탈도(anomaly) 분석 (루틴 소비 제외, 특이 소비를 취향 신호로) |
| 장소 데이터 | 네이버 검색 API — 지역 검색 (제주, 업체 상세정보 우선) |
| 지도 | 네이버 지도 API (지도·핀 표시) + TMAP 보행자 경로 API (구간별 도보 거리·시간·경로선) |
| 데이터 수집 | 카드 내역: 앱 스크린샷 업로드 → GPT Vision OCR / 사진첩: `<input type="file">` 직접 선택 → EXIF + GPT Vision |
| 인증 | OAuth2(카카오·구글 구현 완료 · 네이버 예정) + 자체 발급 JWT(30일) |
| 배포 | Vercel/Netlify(프론트) + Render(백엔드) |

## 브랜드 컬러

| 용도 | 값 |
|---|---|
| 키 컬러 | `#00A46E` |
| 서브 컬러 | `#D8E64A` |
| 배경색 | `#FAF8F3` |

## 로컬 실행

```bash
# backend
cd backend
python -m venv .venv && .venv\Scripts\activate  # (Windows)
pip install -r requirements.txt
cp .env.example .env  # OPENAI_API_KEY 등 채우기
uvicorn main:app --reload

# frontend (별도 터미널) — 반드시 frontend 폴더에서 실행 (루트에는 package.json 없음)
cd frontend
npm install
cp .env.example .env  # VITE_NAVER_MAP_CLIENT_ID 채우기
npm run dev           # http://localhost:5173
```

- 지도가 안 뜨면 네이버 클라우드 콘솔 → Maps Application → **Web 서비스 URL**에 `http://localhost:5173` 등록 여부 확인

## AI 코스 생성 API

`POST /courses` — 취향·조건을 받아 GPT가 **후보 장소 목록 안에서만** 코스 4개를 짜고, 서버가 검증해 프론트 `Course` 형태로 반환 ([backend/courses.py](backend/courses.py))

```json
// 요청 (프론트 planner 상태 그대로)
{ "taste": { "mood": "calm", "crowd": "mid", "hour": "noon", "spend": "cafe", "pace": "mid", "plan": "relaxed", "companion": "couple" },
  "tags": ["자연"], "intent": null,
  "cond": { "area": "망원", "hours": 0, "people": 2, "budget": 50000 },
  "time_window": { "start": 14, "end": 23 } }
```

1. 동네 선택 — `area`를 골랐으면 그 동네로 4개, `any`면 취향에 필요한 장소가 많은 동네 4곳에 1개씩
   - 장소 수 — `time_window` 총 시간 ÷ 1곳당 평균(`plan` tight 75분 · relaxed 150분 · 없음 105분) ±1
2. 후보 추출 — 동네 반경 안에서 종류별로 가까운 곳 위주 샘플링(약 60~125곳), GPT에는 `p1, p2…` ref로만 전달
3. 검증 — 없는 ref·장소 반복·같은 종류 3연속·도보 2km 초과 구간·시간/예산 초과·근거 없는 평가 표현(인기·맛집·한적 등) 코스는 버림, 통과가 4개 미만이면 1회 재요청
   - `time_window`가 있으면 시작 시각을 고정하고, 체류 시간을 비율대로 늘리거나 줄여 **머무는 시간 + 이동 = 선택한 시간**으로 정확히 맞춤 (1곳 30~240분 안에서 못 맞추면 버림)
4. 응답 — GPT에 6개를 요청해 검증 통과분 중 최대 4개(여러 동네면 동네별 1개 우선) · `courses[]`(`items[].pid`, `legs`, `estimated: true`) · 실패 시 HTTP 502 + `detail`

- 필요: `backend/.env`의 `OPENAI_API_KEY` (모델 `OPENAI_MODEL`, 기본 `gpt-5-mini` · `OPENAI_REASONING_EFFORT` 기본 `minimal`)
- 응답 시간: 약 10~15초 (reasoning_effort `minimal` 기준, `low`는 약 30초)
- 프론트는 결과 화면 진입 시 자동 호출 → 받는 동안·실패 시 기본 코스 10개 표시, AI 코스는 목록 맨 위에 `AI 추천` 배지로 표시
- 체류 시간·가격은 GPT 추정값, 도보 구간은 직선거리×1.3 추정 (TMAP 미적용)

## 지도·코스 데이터

플래너의 코스 10개(`frontend/src/planner/data.ts` `COURSES`)는 전부 마포구 실제 장소로 구성되며, 각 장소는 `pid`로 장소 데이터와 연결된다.

| 파일 | 내용 | 생성 방법 |
|---|---|---|
| `frontend/src/planner/geo.ts` | 코스 후보 장소를 종류별(식사/카페/한잔/체험/문화/산책/운동)로 정리한 `PLACES` + `placeGeo(id)` | `python backend/scripts/build_places_geo.py` |
| `frontend/src/planner/data.ts` `LEGS` | 코스 구간별 실제 도보 거리·시간 | `python backend/scripts/build_walk_legs.py` |
| `frontend/src/planner/routes.ts` | 고정 코스(`c1`~`c10`)의 도보 경로선 좌표 — AI·DB 코스는 `POST /walk/legs`로 실시간 조회 | 위와 같음 (API 재호출 없이 선만 다시 만들 땐 `--routes-only`) |

- 입력 데이터는 [장소 수집 파이프라인](backend/PLACE_DATA_PIPELINE.md)의 최종본 `backend/data/places_mapo.csv` (git 미포함 — 팀 내 별도 공유). 코스에 안 맞는 업종(병원·미용·학원 등)과 기간 끝난 팝업은 스크립트가 제외
- 좌표 없는 행(주로 블로그 팝업)은 주소로 네이버 Geocoding 해서 채움 — `backend/.env`에 NCP Maps 앱 키(`NCP_CLIENT_ID`/`NCP_CLIENT_SECRET`, Geocoding 사용 설정 필요). 결과는 `backend/data/geocode_cache.json`에 저장돼 재실행 시 재호출 안 함
- 장소 데이터가 갱신되면 `build_places_geo.py` → `build_walk_legs.py` 순서로 재실행 (코스에 쓰인 장소가 새 데이터에서 빠지면 `data.ts`의 해당 `pid`를 교체해야 함)
- 도보 경로 스크립트는 `backend/.env`의 `TMAP_APP_KEY`(SK open API에서 NOLDA 앱에 **TMAP 상품 연결 필수**) 또는 `ORS_API_KEY`(OpenRouteService, 우선 사용) 필요
- `geo.ts`, `routes.ts`의 자동 생성 구간은 직접 수정하지 말고 스크립트로 재생성

## 문서

- [서비스 흐름](docs/service-flow.md) — 기능 시나리오. 사용자가 무엇을 보고 무엇을 하는지 순서대로
- [구현 지침서 — 취향 분석](docs/feature-guide-taste-and-navigation.md) — 취향 분석·코스 생성·길안내를 고칠 때 볼 것
- [구현 지침서 — 홈·앱 껍데기](docs/feature-guide-home-and-shell.md) — 홈 화면, 화면 이동, 하단 탭바, 로그인·유튜브 연동 유지
- [DB 스키마](docs/db-schema.md) · [장소 데이터 파이프라인](backend/PLACE_DATA_PIPELINE.md)
- [이메일·비밀번호 자체 로그인 (임시 비활성화)](docs/deferred-email-password-login.md) — 재활성화 체크리스트와 주석 처리된 코드 원본

## 로드맵

- Phase 1 (MVP): 로그인(카카오·구글 구현 완료, 네이버 예정), 마포구 네이버 장소 데이터 수집, 최소 조건 입력(체류시간 포함) + 사용자 데이터 기반 자동 추천, 결과 화면(지도 핀·사진·예약 연동 검토), 로그 수집
- Phase 2: 카드/사진 데이터 기반 추천 고도화(개인정보 동의 체계 필요), 유저 기반 협업 필터링, 코스 저장/즐겨찾기, 피드백
- Phase 3: 동행자 추천(관계 데이터 기반), 소셜 기능, B2B 광고 모델, 모바일 전환

## 상태

기획 v1.1(2026-09-01) 이후 [2026-09-04 회의](docs/meeting-2026-09-04.md)에서 추천 방향(조건 선택 → 사용자 데이터 자동 분석)과 로그인 재도입 등 방향 전환.

- 프론트엔드 플래너(v4, 취향 대화) 구현
- 홈 화면(배너·카테고리·추천 장소·검색·저장·마이페이지) + 하단 탭바 5개(홈·코스·검색·마이페이지·저장)
- 마포구 실제 장소 기반 코스 + 네이버 지도 핀 + TMAP 실제 도보 경로 (AI 코스도 구간별 실시간 조회)
- 지도에서 구간(1→2, 2→3) 하나만 골라 보기 — 경로가 겹칠 때 구분
- 소셜 로그인(카카오·구글, 30일 유지) + 유튜브 연동 유지(로그아웃 전까지 재연동 불필요)
- 마이페이지 — 프로필 편집(이름·사진), 로그아웃
- 모든 화면 모바일 프레임 430px 기준
- 미구현: 알림, 마이페이지 설정 메뉴, 행사·광고 배너 데이터, 장소 상세 페이지. 유튜브 집계 결과·도보 경로 캐시가 서버 메모리에만 있어 재시작 시 사라짐
