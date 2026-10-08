import type { PhotoMeta } from './photoMeta'
import type { Cond, Course } from './data'
import type { Taste } from './logic'
import { store } from '../app/storage'

const BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '')

export interface AiCourseRequest {
  taste: Taste
  tags: string[]
  intent: string | null
  cond: Cond
  /** 동적 주제에서 고른 답 — 주제 이름·고른 라벨·반영 방법 */
  picked: { name: string; labels: string[]; hint: string }[]
  /** 시작·종료 시각(시) — 이 시간을 꽉 채우는 코스만 받음 */
  time_window: { start: number; end: number }
}

/** 백엔드 POST /courses — 취향·조건으로 AI 코스 생성 (수십 초 걸릴 수 있음) */
export async function fetchAiCourses(req: AiCourseRequest, signal?: AbortSignal): Promise<Course[]> {
  if (!BASE) throw new Error('VITE_API_BASE_URL이 설정되지 않았어요')
  let res: Response
  try {
    const token = store.loginToken.get() // 로그인했으면 만든 코스를 내 코스로 저장
    res = await fetch(`${BASE}/courses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(req),
      signal,
    })
  } catch (e) {
    if (signal?.aborted) throw e
    throw new Error('백엔드 서버에 연결하지 못했어요')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.detail || `코스 생성 실패 (HTTP ${res.status})`)
  return data.courses as Course[]
}

async function call<T>(path: string, init: RequestInit = {}, token?: string | null): Promise<T> {
  if (!BASE) throw new Error('VITE_API_BASE_URL이 설정되지 않았어요')
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, { ...init, headers: { ...init.headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) } })
  } catch {
    throw new Error('백엔드 서버에 연결하지 못했어요')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.detail || `요청 실패 (HTTP ${res.status})`)
  return data as T
}

/** 백엔드 GET /courses/{id} — 공유 링크로 코스 다시 열기 */
export const fetchCourse = (id: string) => call<Course>(`/courses/${encodeURIComponent(id)}`)

/** 로그인한 사용자의 저장한 코스 (DB) */
export const fetchSavedCourses = (token: string) => call<{ courses: Course[] }>('/me/saved', {}, token).then((d) => d.courses)
export const putSavedCourse = (token: string, id: string) => call(`/me/saved/${encodeURIComponent(id)}`, { method: 'PUT' }, token)
export const deleteSavedCourse = (token: string, id: string) => call(`/me/saved/${encodeURIComponent(id)}`, { method: 'DELETE' }, token)

export interface YoutubeTaste {
  likes: number
  subs: number
  categories: { name: string; ratio: number }[]
  channels: string[]
  sub_channels: string[]
  tags: string[]
  topics: string[]
  titles: string[]
  /** 키워드 규칙으로 뽑은 취향 힌트 (기록이 적으면 null) */
  hints: {
    mood: string | null
    spend: string | null
    pace: string | null
    tags: string[]
    evidence: { mood: string; spend: string; pace: string; tags: string }
  }
}

/** 백엔드 구글 계정 인가 주소 (로그인 아님) — 위임받은 권한으로 좋아요·구독을 집계하고 프론트로 ?yt=<id> 붙여 돌려보냄 */
export function youtubeAuthorizeUrl() {
  if (!BASE) throw new Error('VITE_API_BASE_URL이 설정되지 않았어요')
  return `${BASE}/auth/youtube/login`
}

/** 백엔드 카카오 로그인 주소 — 로그인 후 백엔드가 우리 JWT를 발급해 프론트로 ?login_token=<jwt> 붙여 돌려보냄 */
export function kakaoLoginUrl() {
  if (!BASE) throw new Error('VITE_API_BASE_URL이 설정되지 않았어요')
  return `${BASE}/auth/login/kakao`
}

/** 백엔드 구글 로그인 주소 — 유튜브 연동용과 별개 (동작 방식은 카카오 로그인과 동일) */
/** switchAccount=true면 구글 계정 선택 화면을 강제한다 (기본은 이미 로그인된 계정으로 바로 통과) */
export function googleLoginUrl(switchAccount = false) {
  if (!BASE) throw new Error('VITE_API_BASE_URL이 설정되지 않았어요')
  return `${BASE}/auth/login/google${switchAccount ? '?switch=1' : ''}`
}

export interface AuthUser {
  id: string
  provider: string
  email: string | null
  nickname: string
  avatar_url: string | null
}

/** 로그인 확인 실패. status가 있으면 서버가 답한 것, 없으면 네트워크 문제 */
export class AuthFailure extends Error {
  status?: number
}

/** 백엔드 GET /auth/me — 저장해둔 로그인 토큰이 아직 유효한지 확인·복원 */
export async function fetchMe(token: string): Promise<AuthUser> {
  if (!BASE) throw new Error('VITE_API_BASE_URL이 설정되지 않았어요')
  const res = await fetch(`${BASE}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    // 토큰이 정말 못 쓰는 건지(401·404) 서버가 잠깐 이상한 건지 부르는 쪽이 구분할 수 있게 status를 실어 보낸다
    const err = new AuthFailure(data.detail || `로그인 확인 실패 (HTTP ${res.status})`)
    err.status = res.status
    throw err
  }
  return data as AuthUser
}

/** 백엔드 GET /youtube/taste/{id} — 유튜브 좋아요·구독 집계 결과 */
export async function fetchYoutubeTaste(id: string): Promise<YoutubeTaste> {
  if (!BASE) throw new Error('VITE_API_BASE_URL이 설정되지 않았어요')
  let res: Response
  try {
    res = await fetch(`${BASE}/youtube/taste/${encodeURIComponent(id)}`)
  } catch {
    throw new Error('백엔드 서버에 연결하지 못했어요')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.detail || `유튜브 분석 결과를 가져오지 못했어요 (HTTP ${res.status})`)
  return data as YoutubeTaste
}

/** taste.py가 만든 동적 주제 1개 */
export interface TasteTopic {
  key: string
  name: string
  multi: boolean
  hint: string
  evidence: string
  opts: { v: string; l: string; mood: string | null; spend: string | null; tag: string | null }[]
}

/** 백엔드 POST /taste/analyze — 사진 0.6 : 유튜브 0.4로 가중 합산한 결과 */
export interface TasteProfile {
  source: 'llm'
  /** 서버가 계산해 확정한 값 (plan·companion만 LLM이 고름) */
  fixed: { crowd: string | null; hour: string | null; pace: string | null; plan: string; companion: string }
  /** 동적 주제에서 아무것도 안 골랐을 때 쓸 기본값 */
  base: { mood: string | null; spend: string | null }
  /** 항목별 합산 점수 0~1 — 근거를 숫자로 보여줄 때 씀 */
  scores: Record<string, Record<string, number>>
  /** 실제로 적용된 가중치 (근거가 적으면 깎인다) */
  weights: { photo: number; youtube: number }
  evidence: Record<string, string>
  tags: string[]
  highlights: string[]
  topics: TasteTopic[]
  /** error가 있으면 사진을 못 읽어 유튜브만으로 분석한 것 */
  photo: { total: number; days: number; party: number; error: string }
  youtube: { likes: number; subs: number }
}

export async function analyzeTaste(
  body: { yt_id: string | null; photos: PhotoMeta[] },
  signal?: AbortSignal,
): Promise<TasteProfile> {
  if (!BASE) throw new Error('VITE_API_BASE_URL이 설정되지 않았어요')
  let res: Response
  try {
    res = await fetch(`${BASE}/taste/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  } catch (e) {
    if (signal?.aborted) throw e
    throw new Error('백엔드 서버에 연결하지 못했어요')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.detail || `취향 분석 실패 (HTTP ${res.status})`)
  return data as TasteProfile
}

/** 백엔드 POST /walk — 내 위치 → 다음 목적지 보행자 경로 + 회전 안내 */
export interface WalkStep { mark: string; text: string; meters: number; lat: number; lng: number }
export interface WalkRoute {
  source: 'tmap' | 'straight'
  path: [number, number][]
  meters: number
  minutes: number
  steps: WalkStep[]
}

export async function fetchWalk(
  body: { start: [number, number]; end: [number, number]; end_name: string },
  signal?: AbortSignal,
): Promise<WalkRoute> {
  if (!BASE) throw new Error('VITE_API_BASE_URL이 설정되지 않았어요')
  const res = await fetch(`${BASE}/walk`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
  })
  if (!res.ok) throw new Error(`길안내를 불러오지 못했어요 (HTTP ${res.status})`)
  return (await res.json()) as WalkRoute
}

export interface PlaceDetail {
  id: string
  phone: string | null
  business_hours: string | null
  menu_summary: string | null
  price_per_person: number | null
  image_url: string | null
}

/** 백엔드 PATCH /auth/me — 마이페이지 프로필(이름·사진) 저장.
 * avatar는 넘기지 않으면 사진을 그대로 두고, 빈 문자열이면 기본 아바타로 되돌린다 */
export async function updateMe(token: string, nickname: string, avatar?: string): Promise<AuthUser> {
  if (!BASE) throw new Error('VITE_API_BASE_URL이 설정되지 않았어요')
  const res = await fetch(`${BASE}/auth/me`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(avatar === undefined ? { nickname } : { nickname, avatar_url: avatar }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.detail || `이름을 저장하지 못했어요 (HTTP ${res.status})`)
  return data as AuthUser
}

/** 백엔드 GET /places/details — 전화/영업시간/가격/대표사진 (Supabase places 테이블), id 기준 */
export async function fetchPlaceDetails(ids: string[], signal?: AbortSignal): Promise<Record<string, PlaceDetail>> {
  if (!BASE || !ids.length) return {}
  const res = await fetch(`${BASE}/places/details?ids=${ids.join(',')}`, { signal })
  if (!res.ok) return {}
  return (await res.json()) as Record<string, PlaceDetail>
}

/** 백엔드 POST /walk/legs — 코스 장소들을 이은 구간별 도보 경로선 */
export async function fetchWalkLegs(
  points: [number, number][],
  names: string[],
  signal?: AbortSignal,
): Promise<[number, number][][]> {
  if (!BASE) throw new Error('VITE_API_BASE_URL이 설정되지 않았어요')
  const res = await fetch(`${BASE}/walk/legs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ points, names }), signal,
  })
  if (!res.ok) throw new Error(`도보 경로를 불러오지 못했어요 (HTTP ${res.status})`)
  return ((await res.json()) as { paths: [number, number][][] }).paths
}
