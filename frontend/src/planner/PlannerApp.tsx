import NaverMap from './NaverMap'
import KindThumb from './KindThumb'
import HomeScreen from './HomeScreen'
import BottomTabs from './BottomTabs'
import type { HomeTab } from './BottomTabs'
import SplashScreen from './SplashScreen'
import CourseCard, { CourseCardSkeleton } from './CourseCards'
import PlacePreview from './PlacePreview'
import ShareSheet from './ShareSheet'
import LiveCourse from './LiveCourse'
import { PhotoIcon, YoutubeIcon } from './Kiosk'
import { CardFan, SwipeDeck, TypeReveal } from './AnalysisGame'
import { pickTasteType } from './tasteType'
import type { Swipe } from './tasteType'
import { stashPhotos, takePhotos } from './photoStash'
import { loadPlaces, placeGeo } from './geo'
import { useWalkLegs } from './useWalkLegs'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { analyzeTaste, deleteSavedCourse, fetchAiCourses, fetchCourse, fetchMe, fetchPlaceDetails, fetchSavedCourses, putSavedCourse, fetchYoutubeTaste, googleLoginUrl, kakaoLoginUrl, updateMe, youtubeAuthorizeUrl } from './api'
import type { AuthFailure } from './api'
import type { PlaceDetail, TasteProfile, TasteTopic, YoutubeTaste } from './api'
import { keepReadable, readPhotos } from './photoMeta'
import { COND, COURSES, DEFAULT_COND, FIXED_Q_KEYS, Q, label as labelOf } from './data'
import type { Course } from './data'
import { analyzeYoutubeOnly, applyPicks, build, matchCond, reportFromProfile, scanSteps } from './logic'
import type { Picks, Report, Taste, BuiltCourse, Sources } from './logic'
import './planner.css'

interface AuthState {
  mode: 'login' | 'signup'
  name: string
  email: string
  pw: string
  error: string
  user: { name: string; email: string; avatar?: string | null } | null
  token: string | null
  skipped: boolean
}

interface AiState {
  status: 'idle' | 'loading' | 'done' | 'error'
  ids: string[]
  error: string
}
const AI_IDLE: AiState = { status: 'idle', ids: [], error: '' }
const MODAL_CLOSE_MS = 280 // planner.css pl-sheet-down 길이와 맞춤

// 분석 화면 모션 길이
export const SCAN_STEP_MS = 280 // 기록 하나를 읽는 간격 (진행률)
export const SCAN_INTAKE_MS = 1300 // 분석 중 화면을 최소한 보여주는 시간
export const SCENE_LAUNCH_MS = 700 // '취향 분석 시작'을 누른 뒤 카드가 모이는 장면 길이 (planner.css sg-fan.is-launch)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const GREEN = '#00A46E'
// 유튜브 구글 로그인으로 페이지를 떠났다 돌아올 때 로그인·연결 선택을 이어가기 위한 임시 저장 키
const PENDING_KEY = 'nolda:yt-pending'
// 카카오 로그인 성공 시 백엔드가 발급한 JWT — 브라우저에 남겨서 새로고침해도 로그인 유지
const LOGIN_TOKEN_KEY = 'nolda:login-token'
// 유튜브 집계 결과 id — 한 번 연동하면 로그아웃 전까지 다시 구글을 거치지 않는다
const YT_ID_KEY = 'nolda:yt-id'
// 로그인하러 갈 때 '끝나면 어느 경로로 돌아갈지'를 적어둔다.
// 소셜 로그인은 페이지를 통째로 새로 열어서 화면 상태가 사라지기 때문에 저장이 필요하다.
const AFTER_LOGIN_KEY = 'nolda:after-login'
const SAVED_KEY = 'nolda:saved-courses' // 저장한 코스(Course 전체) — 새로고침·로그인 없이도 유지
// 로그인 성공 때마다 갱신 — 토큰이 만료돼 다시 로그인해야 할 때도 남아있어서 "마지막으로 OO로 로그인했어요" 안내에 씀
const LAST_PROVIDER_KEY = 'nolda:last-login-provider'
// 분석 결과·만든 코스 목록 — 새로고침해도 그 화면을 그대로 이어 보이게 (탭을 닫으면 사라짐)
const SESSION_KEY = 'nolda:session'
const SPLASH_KEY = 'nolda:splashed' // 로고 화면은 탭(세션)당 한 번만

/*
 * 경로 = 화면. 새로고침·뒤로가기·주소 직접 입력 모두 경로만 보고 같은 화면을 그린다.
 *   /  /search  /bookmarks  /my     홈과 홈의 탭
 *   /login                          로그인
 *   /start  /analyze  /result       취향 분석 (데이터 고르기 → 분석 중 → 요약)
 *   /courses  /saved                코스 목록 · 저장한 코스
 *   /course/:id  /course/:id/live   코스 상세 · 코스 진행(전체 화면 지도) — 로그인 없이 공유 링크로도 열림
 */
const HOME_PATH: Record<Exclude<HomeTab, 'course'>, string> = { home: '/', search: '/search', saved: '/bookmarks', my: '/my' }
const AUTH_PATHS = ['/start', '/analyze', '/result', '/courses', '/saved'] // 로그인해야 들어가는 화면
const APP_TAB: Record<string, 'search' | 'saved'> = { '/courses': 'search', '/saved': 'saved' }

function readPending(): { auth: AuthState; sources: Sources } | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY)
    sessionStorage.removeItem(PENDING_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

// 소셜 로그인·유튜브 연동·옛 공유 링크(?course=)는 페이지를 새로 열고 '/?...'로 돌아온다 — 처음 한 번만 읽는다
function readEntry() {
  const q = new URLSearchParams(window.location.search)
  return { yt: q.get('yt'), ytError: q.get('yt_error'), loginToken: q.get('login_token'), loginError: q.get('login_error'), course: q.get('course') }
}

const rememberAfterLogin = (path: string) => { try { sessionStorage.setItem(AFTER_LOGIN_KEY, path) } catch { /* 기본 흐름대로 */ } }
const afterLoginPath = () => {
  try {
    const p = sessionStorage.getItem(AFTER_LOGIN_KEY)
    if (p?.startsWith('/')) return p
  } catch { /* 기본 흐름대로 */ }
  return '/start'
}

interface Session {
  report: Report | null
  taste: Taste
  tags: string[]
  picks: Picks
  intent: string | null
  hourRange: [number, number] | null
  cond: typeof DEFAULT_COND
  swipes: Swipe[]
  done: boolean
  aiIds: string[]
  pool: Course[]
}
function readSession(): Partial<Session> {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || '{}') } catch { return {} }
}

export default function PlannerApp() {
  const location = useLocation()
  const navigate = useNavigate()
  const [entry] = useState(readEntry)
  const [snap] = useState(readSession)

  // 지금 경로가 어떤 화면인지
  const path = location.pathname.replace(/(.)\/+$/, '$1')
  const courseMatch = path.match(/^\/course\/([^/]+)(\/live)?$/)
  const openId = courseMatch ? decodeURIComponent(courseMatch[1]) : null
  const liveId = courseMatch?.[2] ? openId : null
  const homeTab = (Object.keys(HOME_PATH) as (keyof typeof HOME_PATH)[]).find((k) => HOME_PATH[k] === path) || null

  const [auth, setAuthState] = useState<AuthState>(() => ({
    mode: 'login', name: '', email: '', pw: '', error: '', user: null, skipped: false,
    // 저장된 토큰을 처음부터 들고 시작한다. 서버 확인(fetchMe)이 늦거나 실패해도
    // 그동안 로그인 화면이 뜨지 않게 하려는 것 — 확인되면 user가 채워진다
    token: entry.loginToken || (() => { try { return localStorage.getItem(LOGIN_TOKEN_KEY) } catch { return null } })(),
  }))
  // 소셜 로그인에서 리디렉션으로 돌아왔는데 실패했을 때 보여줄 전용 화면 (폼 안 작은 에러 문구랑 별개)
  const [loginError, setLoginError] = useState<string | null>(null)
  const [sources, setSources] = useState<Sources>({ youtube: true, photos: false })
  const [photoFiles, setPhotoFiles] = useState<File[]>([])
  const [ytError, setYtError] = useState('')
  const [ytLoading, setYtLoading] = useState(false)
  // 분석이 돌고 있는지 — 새로고침하면 분석은 이어갈 수 없어 /analyze가 /start로 돌아간다
  const [scanning, setScanning] = useState(!!entry.yt)
  const [scanN, setScanN] = useState(0)
  const [report, setReport] = useState<Report | null>(snap.report ?? null)
  const [taste, setTaste] = useState<Taste>(snap.taste ?? {})
  const [tags, setTags] = useState<string[]>(snap.tags ?? [])
  // 동적 주제에서 고른 답 (주제 key → 고른 옵션 값들)
  const [picks, setPicks] = useState<Picks>(snap.picks ?? {})
  const [intent, setIntent] = useState<string | null>(snap.intent ?? null)
  // 시간대 막대에서 고른 시작·종료 시각 (안 건드렸으면 시간대 구간 기본값)
  const [hourRange, setHourRangeState] = useState<[number, number] | null>(snap.hourRange ?? null)
  const [cond, setCond] = useState(snap.cond ?? { ...DEFAULT_COND })
  const [sheetKey, setSheetKey] = useState<string | null>(null)
  // 저장한 코스: 이 기기(localStorage)에 보관하고, 로그인했으면 DB(saved_courses)와도 맞춤
  const [savedInit] = useState<Course[]>(() => {
    try { return JSON.parse(localStorage.getItem(SAVED_KEY) || '[]') as Course[] } catch { return [] }
  })
  const [saved, setSaved] = useState<string[]>(() => savedInit.map((c) => c.id))
  const [toast, setToast] = useState('')
  const toastTimer = useRef<number | null>(null)
  const showToast = (msg: string) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), 2200)
  }
  const [booked, setBooked] = useState<string[]>([])
  // 앱 실행 직후 로고 — 홈으로 처음 들어왔을 때만 (다른 경로·리디렉션 복귀·새로고침은 건너뜀)
  const [splash, setSplash] = useState(() => {
    try { return !window.location.search && window.location.pathname === '/' && !sessionStorage.getItem(SPLASH_KEY) } catch { return false }
  })
  // 연동해 둔 유튜브 집계 결과. 있으면 분석을 다시 해도 구글 동의를 또 받지 않는다
  const [ytId, setYtIdState] = useState<string | null>(() => {
    try { return localStorage.getItem(YT_ID_KEY) } catch { return null }
  })
  const setYtId = (id: string | null) => {
    setYtIdState(id)
    try { id ? localStorage.setItem(YT_ID_KEY, id) : localStorage.removeItem(YT_ID_KEY) } catch { /* 이번 세션만 유지 */ }
  }
  // 분석을 끝냈거나 건너뛰어 코스 화면까지 간 적이 있는지 — 홈 '코스' 탭이 분석부터일지 목록일지 정한다
  const [done, setDone] = useState(!!snap.done)
  const [ai, setAi] = useState<AiState>(() => (snap.aiIds?.length ? { status: 'done', ids: snap.aiIds, error: '' } : AI_IDLE))
  // 받은 AI 코스는 계속 보관 — 다시 만들어도 저장한 코스가 사라지지 않게
  const [aiPool, setAiPool] = useState<Record<string, Course>>(() => Object.fromEntries([...savedInit, ...(snap.pool ?? [])].map((c) => [c.id, c])))
  const aiAbort = useRef<AbortController | null>(null)
  const [modalClosing, setModalClosing] = useState(false)
  const closeTimer = useRef<number | null>(null)

  const setAuth = (o: Partial<AuthState>) => setAuthState((st) => ({ ...st, ...o }))
  // 토큰이 있으면 로그인한 사람이다. 서버가 자고 있어(무료 플랜은 15분 뒤 잠든다)
  // 확인이 늦어도 로그인 화면으로 튕기지 않는다. 토큰이 실제로 죽었을 때만 아래에서 지운다
  const authed = !!auth.user || auth.skipped || !!auth.token

  // 코스 상세 뒤에 깔릴 목록 — 목록에서 열었으면 그 목록, 주소로 바로 들어왔으면 코스 목록(분석을 끝낸 사람만)
  const bg = (location.state as { bg?: string } | null)?.bg ?? (done && authed ? '/courses' : null)
  const tab = APP_TAB[path] ?? (openId && bg ? APP_TAB[bg] : undefined)

  // 앱 안에서 넘어온 화면이면 브라우저 뒤로가기와 같게, 주소로 바로 들어왔으면 fallback 경로로
  const back = (fallback: string) => {
    if (((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0) navigate(-1)
    else navigate(fallback, { replace: true, state: location.state })
  }
  const openCourseFrom = (id: string) => navigate(`/course/${encodeURIComponent(id)}`, { state: { bg: path } })

  // 코스 상세 닫기 — 내려가는 모션이 끝난 뒤 이전 화면으로 (움직임 줄이기 설정이면 바로)
  const closeModal = () => {
    if (closeTimer.current) return
    const finish = () => { closeTimer.current = null; setModalClosing(false); back(bg ?? '/') }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return finish()
    setModalClosing(true)
    closeTimer.current = window.setTimeout(finish, MODAL_CLOSE_MS)
  }

  // 페이지를 새로 열고 돌아온 경우 — 주소의 ?값 대신 알맞은 화면 경로로 바꾼다.
  // 그려지기 전에(useLayoutEffect) 옮겨야 홈이 잠깐 비치지 않는다
  useLayoutEffect(() => {
    const { yt, ytError: ytErr, loginToken, loginError: loginErr, course } = entry
    if (course) navigate(`/course/${encodeURIComponent(course)}`, { replace: true })
    else if (yt || ytErr) navigate(yt ? '/analyze' : '/start', { replace: true })
    else if (loginToken) navigate(afterLoginPath(), { replace: true })
    else if (loginErr) navigate('/', { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 코스 화면까지 오면 분석을 끝낸 것으로 친다 (주소로 바로 들어온 경우 포함)
  useEffect(() => { if (tab && authed) setDone(true) }, [tab, authed])

  const timerRef = useRef<number | null>(null)
  const t0Ref = useRef(0)

  const photoUrls = useMemo(() => photoFiles.map((f) => URL.createObjectURL(f)), [photoFiles])
  useEffect(() => () => { photoUrls.forEach((u) => URL.revokeObjectURL(u)) }, [photoUrls])

  // 저장한 코스 목록 — 이 기기에 기록하고 홈 '저장' 탭에도 보여준다
  const savedCourses = useMemo(
    () => saved.map((id) => aiPool[id] || COURSES.find((c) => c.id === id)).filter(Boolean) as Course[],
    [saved, aiPool],
  )
  useEffect(() => {
    try { localStorage.setItem(SAVED_KEY, JSON.stringify(savedCourses)) } catch { /* 저장 공간 없음 — 이번 세션만 유지 */ }
  }, [savedCourses])

  // 분석 결과·코스 목록을 세션에 남겨서 새로고침해도 같은 화면을 이어 그린다
  useEffect(() => {
    const aiIds = ai.status === 'done' ? ai.ids : []
    const s: Session = {
      report, taste, tags, picks, intent, hourRange, cond, swipes, done,
      aiIds, pool: aiIds.map((id) => aiPool[id]).filter(Boolean),
    }
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)) } catch { /* 저장 공간 없음 — 새로고침하면 처음부터 */ }
  })

  // 로그인하면 DB에 저장해 둔 코스를 가져와 합침
  useEffect(() => {
    if (!auth.token) return
    fetchSavedCourses(auth.token)
      .then((list) => {
        setAiPool((p) => ({ ...p, ...Object.fromEntries(list.map((c) => [c.id, c])) }))
        setSaved((s) => [...s, ...list.map((c) => c.id).filter((id) => !s.includes(id))])
      })
      .catch((e: Error) => console.error('[saved]', e.message))
  }, [auth.token])

  // 장소 데이터(Supabase)를 앱 시작 때 받아 둠 — 받은 뒤 한 번 다시 그려서 지도 핀·장소 정보가 보이게
  const [, setPlacesReady] = useState(false)
  useEffect(() => {
    loadPlaces().then(() => setPlacesReady(true)).catch((e: Error) => console.error('[places]', e.message))
  }, [])
  // 브라우저가 못 읽는 형식(HEIC 등)은 여기서 걸러서, 분석 단계에서 조용히 사라지지 않게 한다
  const onPickPhotos = (files: File[]) => {
    setYtError('')
    void keepReadable(files).then(({ ok, bad }) => {
      if (bad.length) setYtError(`${bad.length}장은 이 브라우저가 열 수 없는 형식이라 제외했어요 (아이폰 HEIC는 JPG로 저장해 주세요)`)
      if (!ok.length) return setSources((st) => ({ ...st, photos: false }))
      setPhotoFiles(ok)
      setSources((st) => ({ ...st, photos: true }))
    })
  }
  const onClearPhotos = () => { setPhotoFiles([]); setSources((st) => ({ ...st, photos: false })) }

  // 타이머 콜백이 옛 state를 보지 않도록 이번 분석에 쓰는 값은 ref로 넘김
  const scanRef = useRef<{ src: Sources; yt: YoutubeTaste | null }>({ src: sources, yt: null })
  // 백엔드 LLM 분석 — 타일 애니메이션과 동시에 돌리고, 둘 다 끝나면 요약 화면으로
  const profileRef = useRef<Promise<TasteProfile | null> | null>(null)
  const finishedRef = useRef(false)
  // 분석을 취소·재시작하면 값이 바뀜 — 늦게 끝난 이전 분석이 화면을 넘기지 못하게
  const scanTokenRef = useRef(0)
  // 분석이 끝나면 태그·취향 값 (분석 화면이 취향 유형을 발표하는 데 씀)
  const [scanReady, setScanReady] = useState<ScanResult | null>(null)
  // 분석 중 미니 게임에서 스와이프한 장소 — 코스 추천에 '마음에 든/별로인 장소'로 넘김
  const [swipes, setSwipes] = useState<Swipe[]>(snap.swipes ?? [])
  const resultGoRef = useRef<(() => void) | null>(null) // '결과 보기'를 누르면 요약 화면으로

  const finishScan = async () => {
    if (finishedRef.current) return
    finishedRef.current = true
    if (timerRef.current) clearInterval(timerRef.current)
    const token = scanTokenRef.current
    const still = () => token === scanTokenRef.current
    const motion = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    // 분석이 빨리 끝나도 '분석 중' 화면은 잠깐 보여줌
    const [prof] = await Promise.all([profileRef.current, motion ? sleep(SCAN_INTAKE_MS) : null])
    if (!still()) return
    // LLM 분석이 실패하면 유튜브 키워드 규칙만으로 (사진은 흉내 내지 않는다 — 가짜 결과가 되므로).
    // 연동은 됐어도 기록이 적어 키워드가 하나도 안 잡혔으면 전부 기본값이라 '유튜브로 맞췄다'고 하지 않는다
    const h = scanRef.current.yt?.hints
    const fromYt = !!h && !!(h.mood || h.spend || h.pace || h.tags.length)
    const a = prof
      ? reportFromProfile(prof)
      : analyzeYoutubeOnly(scanRef.current.yt, fromYt
          ? '취향 분석이 잠시 안 돼서 유튜브 기록만으로 대략 맞췄어요'
          : '취향 분석이 잠시 안 돼서 기본 취향으로 보여드려요. 아래에서 직접 고칠 수 있어요')
    setScanReady({ tags: a.tags, taste: a.taste })
    await new Promise<void>((r) => { resultGoRef.current = r })
    resultGoRef.current = null
    if (!still()) return
    setScanReady(null)
    setReport(a)
    setTaste(a.taste)
    setTags(a.tags)
    setPicks({})
    setCond((c) => ({ ...c, people: a.party, budget: a.budgetBand }))
    setScanning(false)
    navigate('/result', { replace: true }) // 뒤로가기하면 분석 중 화면이 아니라 데이터 고르기로
  }

  /** 사진을 읽어(EXIF·축소) 유튜브 집계와 함께 백엔드로 — 실패하면 null이라 폴백으로 넘어간다 */
  const startProfile = (src: Sources, ytId: string | null, files: File[]) => {
    profileRef.current = (src.photos && files.length ? readPhotos(files) : Promise.resolve([]))
      .then((photos) => (photos.length || ytId ? analyzeTaste({ yt_id: ytId, photos }) : null))
      .catch((e: Error) => { console.error('[taste]', e.message); setYtError(e.message); return null })
  }

  const runScan = (src: Sources, ytData: YoutubeTaste | null, photoCount = photoFiles.length) => {
    scanRef.current = { src, yt: ytData }
    finishedRef.current = false
    scanTokenRef.current++
    setScanReady(null)
    setSwipes([])
    setScanning(true)
    setScanN(0)
    if (timerRef.current) clearInterval(timerRef.current)
    const total = scanSteps(src, ytData, photoCount)
    if (!total) { void finishScan(); return }
    t0Ref.current = Date.now()
    timerRef.current = window.setInterval(() => {
      setScanN((n) => {
        const next = Math.max(n + 1, Math.min(total, Math.floor((Date.now() - t0Ref.current) / SCAN_STEP_MS)))
        if (next >= total) {
          if (timerRef.current) clearInterval(timerRef.current)
          void finishScan()
        }
        return next
      })
    }, SCAN_STEP_MS)
  }

  // 분석을 멈추고 데이터 고르기로 (늦게 끝난 분석이 화면을 넘기지 못하게 토큰도 바꾼다)
  const stopScan = () => {
    if (timerRef.current) clearInterval(timerRef.current)
    scanTokenRef.current++
    setScanReady(null); setScanning(false); setScanN(0)
  }

  const startScan = () => {
    if (!sources.youtube && !sources.photos) return
    setYtError('')
    if (!sources.youtube) {
      startProfile(sources, null, photoFiles)
      runScan(sources, null)
      return navigate('/analyze')
    }
    // 전에 연동해 둔 결과가 있으면 구글을 다시 거치지 않는다
    if (ytId) {
      setScanning(true)
      setYtLoading(true)
      navigate('/analyze')
      fetchYoutubeTaste(ytId)
        .then((data) => { startProfile(sources, ytId, photoFiles); runScan(sources, data, photoFiles.length) })
        .catch(() => { setYtId(null); stopScan(); navigate('/start', { replace: true }); setYtError('유튜브 연동이 만료됐어요. 다시 연결해 주세요') })
        .finally(() => setYtLoading(false))
      return
    }
    // 처음이면 구글 로그인 페이지로 이동 → 백엔드가 집계 후 /?yt=<id>로 돌려보냄
    try {
      const url = youtubeAuthorizeUrl()
      try { sessionStorage.setItem(PENDING_KEY, JSON.stringify({ auth: { ...auth, pw: '' }, sources })) } catch { /* 저장 불가 시 돌아와서 로그인만 다시 */ }
      // 고른 사진은 페이지 이동 전에 기기 안(IndexedDB)에 보관했다가 돌아와서 복원
      void (sources.photos ? stashPhotos(photoFiles) : Promise.resolve()).then(() => { window.location.href = url })
    } catch (e) {
      setYtError((e as Error).message)
    }
  }

  // 구글 로그인에서 돌아왔을 때: 로그인·선택 복원 → 집계 결과 받아서 분석 시작.
  // StrictMode가 effect를 두 번 돌려도 한 번만 (readPending이 저장값을 지우므로)
  const ytHandled = useRef(false)
  useEffect(() => {
    const { yt: id, ytError: err } = entry
    if ((!id && !err) || ytHandled.current) return
    ytHandled.current = true
    const pending = readPending()
    const src = pending?.sources || { youtube: true, photos: false }
    if (pending) { setAuthState(pending.auth); setSources(src) }
    if (err) return setYtError(err === 'access_denied' ? '유튜브 연결을 취소했어요' : '유튜브 연결에 실패했어요')
    setYtId(id!)
    setYtLoading(true)
    Promise.all([fetchYoutubeTaste(id!), src.photos ? takePhotos() : Promise.resolve([] as File[])])
      .then(([data, files]) => {
        const s = { ...src, photos: src.photos && files.length > 0 } // 사진 복원에 실패하면 유튜브만으로
        setPhotoFiles(files); setSources(s)
        startProfile(s, id!, files)
        runScan(s, data, files.length)
      })
      .catch((e: Error) => { stopScan(); navigate('/start', { replace: true }); setYtError(e.message) })
      .finally(() => setYtLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 소셜 로그인에서 돌아왔을 때(?login_token=) 또는 새로고침 시 저장해둔 토큰으로 로그인 상태 복원
  const loginHandled = useRef(false)
  useEffect(() => {
    if (loginHandled.current) return
    loginHandled.current = true
    const fresh = entry.loginToken, err = entry.loginError
    if (err) {
      // 'cancelled'·'access_denied'는 카카오가 주는 짧은 코드, 그 외엔 백엔드가 보낸 실제 에러 문장
      const known: Record<string, string> = { cancelled: '카카오 로그인을 취소했어요.', access_denied: '카카오 로그인을 취소했어요.' }
      setLoginError(known[err] || err)
      return
    }
    const token = fresh || localStorage.getItem(LOGIN_TOKEN_KEY)
    if (!token) return
    fetchMe(token)
      .then((me) => {
        localStorage.setItem(LOGIN_TOKEN_KEY, token)
        localStorage.setItem(LAST_PROVIDER_KEY, me.provider)
        setAuth({ user: { name: me.nickname || '게스트', email: me.email || '', avatar: me.avatar_url }, token, error: '' })
      })
      .catch((e: AuthFailure) => {
        // 토큰이 만료·폐기됐을 때(401·404)만 지운다.
        // 서버가 꺼져 있거나 네트워크가 끊긴 것뿐인데 지우면 멀쩡한 로그인이 날아간다
        if (e.status === 401 || e.status === 403 || e.status === 404) {
          localStorage.removeItem(LOGIN_TOKEN_KEY)
          setAuth({ token: null }) // 상태에서도 빼야 로그인 화면이 다시 나온다
        }
        if (fresh) setLoginError('로그인 확인에 실패했어요. 다시 시도해 주세요.') // 방금 막 돌아왔는데 토큰이 안 먹히면 서버 쪽 문제
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible' && scanning && !ytLoading) void finishScan()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanning, ytLoading])

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current) }, [])

  const range: [number, number] = hourRange ?? HOUR_DEFAULT[taste.hour || 'noon'] ?? [12, 15]
  const setHourRange = (r: [number, number]) => {
    setHourRangeState(r)
    setTaste((st) => ({ ...st, hour: hourBucket(r[0]) }))
  }

  // 동적 주제에서 고른 답 → 코스 점수·프롬프트에 쓸 값 (고른 게 없으면 분석값 그대로)
  const derived = useMemo(() => applyPicks(report?.topics || [], picks, tags), [report, picks, tags])
  // useMemo 필수 — 매 렌더 새 객체를 만들면 builtAll이 계속 재계산돼 코스 시작 지도가 다시 그려진다
  const effTaste: Taste = useMemo(
    () => ({ ...taste, mood: derived.mood ?? taste.mood, spend: derived.spend ?? taste.spend }),
    [taste, derived.mood, derived.spend],
  )
  const effTags = derived.tags
  const swipePicked = useMemo(() => {
    const liked = swipes.filter((x) => x.liked)
    const nope = swipes.filter((x) => !x.liked)
    const label = (x: Swipe) => `${x.name}(${x.kind})`
    return [
      ...(liked.length ? [{ name: '분석 중 마음에 든 장소', labels: liked.map(label), hint: '이 장소들과 종류·분위기가 비슷한 곳을 우선한다' }] : []),
      ...(nope.length ? [{ name: '분석 중 별로라고 한 장소', labels: nope.map(label), hint: '이 장소들과 비슷한 곳은 되도록 피한다' }] : []),
    ]
  }, [swipes])

  const generateAi = () => {
    aiAbort.current?.abort()
    const ctrl = new AbortController()
    aiAbort.current = ctrl
    setAi((s) => ({ ...s, status: 'loading', error: '' }))
    fetchAiCourses(
      { taste: effTaste, tags: effTags, intent, picked: [...derived.picked, ...swipePicked], cond, time_window: { start: range[0], end: range[1] } },
      ctrl.signal,
    )
      .then((list) => {
        setAiPool((p) => ({ ...p, ...Object.fromEntries(list.map((c) => [c.id, c])) }))
        setAi({ status: 'done', ids: list.map((c) => c.id), error: '' })
      })
      .catch((e: Error) => {
        if (!ctrl.signal.aborted) setAi((s) => ({ ...s, status: 'error', error: e.message }))
      })
  }
  const resetAi = () => { aiAbort.current?.abort(); setAi(AI_IDLE) }

  // 코스 목록이 보이면 AI 코스 생성 (실패해도 고정 코스는 그대로 보임 · 새로고침이면 세션에 남은 목록을 그대로 씀)
  useEffect(() => {
    if (tab === 'search' && authed && ai.status === 'idle') generateAi()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, authed, ai.status])
  useEffect(() => () => aiAbort.current?.abort(), [])

  const skipScan = () => {
    setTaste({ mood: 'calm', crowd: 'mid', hour: 'noon', spend: 'cafe', pace: 'mid' })
    setTags([]); setDone(true)
    navigate('/courses')
  }
  const rescan = () => { setScanN(0); setReport(null); navigate('/start', { replace: true }) }
  // 분석을 처음부터 다시 — 로그인은 건드리지 않는다. 화면 이동은 부르는 쪽이 정한다
  const restart = () => {
    stopScan()
    setReport(null); setIntent(null); setTaste({}); setTags([]); setPicks({}); setSwipes([]); setDone(false); setHourRangeState(null)
    setCond({ ...DEFAULT_COND }); setSheetKey(null); resetAi(); setYtError('')
  }
  const startOver = () => { restart(); navigate('/start') }

  // 로그아웃 — 분석 상태를 되돌리고 토큰·유튜브 연동까지 끊는다.
  // 화면 안의 '뒤로/처음으로' 버튼이 이걸 부르면 안 된다 (멀쩡한 로그인이 풀린다)
  const logout = () => {
    restart()
    localStorage.removeItem(LOGIN_TOKEN_KEY)
    setYtId(null) // 로그아웃하면 유튜브 연동도 함께 끊는다
    setAuthState({ mode: 'login', name: '', email: '', pw: '', error: '', user: null, token: null, skipped: false })
  }

  // 이메일·비밀번호 로그인은 아직 구현 전이라 AuthScreen의 폼과 함께 임시로 주석 처리
  // const submitAuth = () => {
  //   if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(auth.email)) return setAuth({ error: '이메일 주소를 다시 확인해 주세요.' })
  //   if (auth.pw.length < 8) return setAuth({ error: '비밀번호는 8자 이상으로 입력해 주세요.' })
  //   setAuth({ user: { name: auth.name || auth.email.split('@')[0], email: auth.email }, error: '', pw: '' })
  // }

  // 받은 AI 코스 전체 + 고정 코스 (저장 탭·상세 열기용 + AI 실패 시 fallback)
  const builtAll: BuiltCourse[] = useMemo(
    () => [...Object.values(aiPool), ...COURSES].map((c) => build(c, { taste: effTaste, tags: effTags, intent, people: cond.people, booked })),
    [aiPool, effTaste, effTags, intent, cond.people, booked],
  )
  const fixedIds = useMemo(() => new Set(COURSES.map((c) => c.id)), [])
  // 검색 목록: 이번에 만든 AI 코스 (AI가 실패했으면 화면이 완전히 비어 보이지 않게 고정 코스로 대체)
  const built: BuiltCourse[] = useMemo(() => {
    if (ai.status === 'error') return builtAll.filter((c) => fixedIds.has(c.id))
    return ai.ids.map((id) => builtAll.find((c) => c.id === id)).filter(Boolean) as BuiltCourse[]
  }, [builtAll, ai.ids, ai.status, fixedIds])
  const filtered = built.filter((c) => matchCond(c, cond))
  const openCourse = builtAll.find((c) => c.id === openId) || null
  const liveCourse = builtAll.find((c) => c.id === liveId) || null

  // 가진 적 없는 코스 주소(공유 링크·새로고침)면 서버에서 받아온다
  useEffect(() => {
    if (!openId || openCourse) return
    let alive = true
    fetchCourse(openId)
      .then((c) => { if (alive) setAiPool((p) => ({ ...p, [c.id]: c })) })
      .catch((e: Error) => {
        if (!alive) return
        showToast(`코스를 열지 못했어요 · ${e.message}`)
        navigate(bg ?? '/', { replace: true })
      })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId])

  const toggleSave = (id: string) => {
    const on = saved.indexOf(id) < 0
    setSaved((s) => (on ? s.concat([id]) : s.filter((x) => x !== id)))
    showToast(on ? '저장한 코스에 담았어요' : '저장을 취소했어요')
    const course = aiPool[id]
    if (auth.token && course?.shareable) {
      (on ? putSavedCourse(auth.token, id) : deleteSavedCourse(auth.token, id))
        .catch((e: Error) => console.error('[saved]', e.message)) // 서버 저장이 안 돼도 이 기기엔 남아 있음
    }
  }
  // 공유 창 (카카오톡·문자·링크 복사·더보기)
  const [shareOf, setShareOf] = useState<BuiltCourse | null>(null)
  const share = (c: BuiltCourse) => setShareOf(c)
  const shareEl = shareOf && (
    <ShareSheet
      course={shareOf}
      url={aiPool[shareOf.id]?.shareable ? `${window.location.origin}/course/${encodeURIComponent(shareOf.id)}` : ''}
      onClose={() => setShareOf(null)}
      toast={showToast}
    />
  )


  const toastEl = toast && <div className="pl-toast" role="status">{toast}</div>
  const sheet = COND.find((c) => c.key === sheetKey) || null

  if (loginError) {
    return (
      <LoginErrorScreen message={loginError} goHome={() => { setLoginError(null); navigate('/') }} />
    )
  }
  if (splash) {
    return <SplashScreen onDone={() => { try { sessionStorage.setItem(SPLASH_KEY, '1') } catch { /* 다음에 또 보여도 무방 */ } setSplash(false) }} />
  }
  if (homeTab) {
    return (
      <HomeScreen
        authed={authed}
        userName={auth.user?.name || ''}
        avatar={auth.user?.avatar || null}
        savedCourses={savedCourses}
        tab={homeTab}
        onRename={async (nickname, avatar) => {
          if (!auth.token) return '로그인이 필요해요'
          try {
            const me = await updateMe(auth.token, nickname, avatar)
            setAuth({ user: { name: me.nickname || '게스트', email: me.email || '', avatar: me.avatar_url } })
            return null
          } catch (e) {
            return (e as Error).message
          }
        }}
        // logout이 토큰·유튜브 연동·분석 상태를 모두 되돌린다. 화면만 홈으로 붙잡아 둔다
        onLogout={() => { logout(); navigate('/') }}
        // 로그인만 하러 감 — 끝나면 홈으로
        onLogin={() => { rememberAfterLogin('/'); navigate('/login') }}
        setTab={(t) => {
          // '코스'는 홈 안의 화면이 아니라 코스 목록으로 나간다 (아직 분석 전이면 사진·유튜브 고르기부터)
          if (t !== 'course') return navigate(HOME_PATH[t])
          if (done) return navigate('/courses')
          startOver()
        }}
        // 분석을 이미 끝냈어도 홈에서 다시 시작하면 사진·유튜브 화면부터 보여준다
        onStart={startOver}
        // 저장한 코스는 분석을 건너뛰고 앱 안쪽 '저장' 탭에서 바로 연다
        onOpenSaved={() => navigate('/saved')}
        // 홈의 추천 코스 — 분석을 건너뛰고 코스 상세를 바로 연다 (닫으면 홈으로 돌아온다)
        onOpenCourse={(id) => navigate(`/course/${encodeURIComponent(id)}`)}
      />
    )
  }
  if (path === '/login') {
    // 이미 로그인했으면(게스트로 둘러보기 포함) 로그인하러 오기 전에 가려던 곳으로
    if (authed) return <Navigate to={afterLoginPath()} replace />
    return <AuthScreen auth={auth} setAuth={setAuth} goHome={() => navigate('/')} />
  }
  if (AUTH_PATHS.includes(path) && !authed) {
    rememberAfterLogin(path)
    return <Navigate to="/login" replace />
  }
  if (path === '/start') {
    return (
      <DataSourceScreen
        sources={sources} setSources={setSources} goHome={() => { restart(); navigate('/') }} startScan={startScan} skipScan={skipScan} error={ytError}
        photoCount={photoFiles.length} onPickPhotos={onPickPhotos} onClearPhotos={onClearPhotos}
      />
    )
  }
  if (path === '/analyze') {
    // 분석 도중 새로고침하면 이어갈 수 없다 — 결과가 있으면 결과로, 없으면 데이터 고르기로
    if (!scanning) return <Navigate to={report ? '/result' : '/start'} replace />
    return (
      <ScanningScreen
        sources={scanRef.current.src} yt={scanRef.current.yt} loading={ytLoading} scanN={scanN} photoUrls={photoUrls} ready={scanReady} onResult={() => resultGoRef.current?.()}
        swipes={swipes} onSwipe={(x) => setSwipes((l) => [...l.filter((y) => y.id !== x.id), x])}
        cancelScan={() => { stopScan(); navigate('/start', { replace: true }) }}
      />
    )
  }
  if (path === '/result') {
    if (!report) return <Navigate to="/start" replace />
    return (
      <SummaryScreen
        report={report} taste={taste} setTaste={setTaste} tags={tags} setTags={setTags}
        picks={picks} setPicks={setPicks}
        intent={intent} setIntent={setIntent} toStart={startOver} rescan={rescan}
        finish={() => {
          // 혼자·연인이면 인원 조건도 맞춤 (친구·가족·동료는 인원이 제각각이라 그대로)
          const people = taste.companion === 'solo' ? 1 : taste.companion === 'couple' ? 2 : 0
          if (people) setCond((c) => ({ ...c, people }))
          setDone(true)
          navigate('/courses')
        }}
        hourRange={range} setHourRange={setHourRange}
        budget={cond.budget} setBudget={(budget) => setCond((c) => ({ ...c, budget }))}
      />
    )
  }
  // 모르는 주소는 홈으로
  if (!tab && !openId) return <Navigate to="/" replace />

  return (
    <div className="pl-app">
      {tab === 'search' && (
        <SearchTab
          cond={cond} setCond={setCond} sheet={sheet} setSheetKey={setSheetKey}
          built={built} filtered={filtered} taste={effTaste} tags={effTags} restart={startOver}
          openCourse={openCourseFrom} ai={ai} generateAi={generateAi}
        />
      )}
      {tab === 'saved' && (
        <SavedTab
          savedBuilt={saved.map((id) => builtAll.find((c) => c.id === id)).filter(Boolean) as BuiltCourse[]}
          people={cond.people}
          openCourse={openCourseFrom}
          remove={(id) => toggleSave(id)}
          goSearch={() => navigate('/courses')}
        />
      )}
      {tab && (
        <BottomTabs
          active={tab === 'saved' ? 'saved' : 'course'}
          savedCount={saved.length}
          onSelect={(t) => {
            // '저장'과 '코스'는 이 화면 안에서 오가고, 나머지는 홈의 해당 탭으로
            if (t === 'saved') return navigate('/saved')
            if (t === 'course') return navigate('/courses')
            navigate(HOME_PATH[t])
          }}
        />
      )}
      {openCourse ? (
        <CourseModal
          course={openCourse}
          isSaved={saved.indexOf(openCourse.id) > -1}
          booked={booked}
          toggleBook={(key) => setBooked((b) => (b.indexOf(key) > -1 ? b.filter((x) => x !== key) : b.concat([key])))}
          toggleSave={() => toggleSave(openCourse.id)}
          start={() => navigate(`/course/${encodeURIComponent(openCourse.id)}/live`, { state: location.state })}
          share={() => share(openCourse)}
          close={closeModal}
          closing={modalClosing}
        />
      ) : openId && !tab && (
        <div style={{ padding: '120px 24px', textAlign: 'center', font: '600 14px/1.6 Pretendard,sans-serif', color: 'rgba(20,24,33,.5)' }}>코스를 불러오고 있어요</div>
      )}
      {liveCourse && (
        <LiveCourse
          course={liveCourse}
          isSaved={saved.indexOf(liveCourse.id) > -1}
          toggleSave={() => toggleSave(liveCourse.id)}
          onClose={() => back(`/course/${encodeURIComponent(liveCourse.id)}`)}
        />
      )}
      {shareEl}
      {toastEl}
    </div>
  )
}


/* ── 로그인 / 회원가입 ─────────────────────────────────────── */
function AuthScreen({ auth, setAuth, goHome }: {
  auth: AuthState
  setAuth: (o: Partial<AuthState>) => void
  goHome: () => void
}) {
  // 이메일·비밀번호 자체 로그인/회원가입 기능은 아직 백엔드가 없어 임시로 주석 처리.
  // 자세한 내용과 재활성화 방법은 docs/deferred-email-password-login.md 참고
  const signup = auth.mode === 'signup'
  // 지난번에 성공적으로 로그인했던 소셜 제공자 — 토큰이 만료돼 다시 로그인해야 할 때도 안내용으로 남아있음
  const [lastProvider] = useState(() => {
    try { return localStorage.getItem(LAST_PROVIDER_KEY) } catch { return null }
  })
  const socials = [
    { key: 'kakao', l: '카카오로 계속하기', mark: 'K', bg: '#FEE500', bd: '#FEE500', fg: '#191600', dot: 'rgba(0,0,0,.82)', dotFg: '#FEE500' },
    { key: 'google', l: 'Google로 계속하기', mark: 'G', bg: '#fff', bd: 'rgba(20,24,33,.12)', fg: '#2c3444', dot: 'rgba(20,24,33,.06)', dotFg: '#2c3444' },
  ]
  return (
    <div className="pl-screen">
      <button type="button" className="pl-backhome" onClick={goHome} aria-label="홈으로">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M3 10.5 12 3l9 7.5M5.5 9.5V20h13V9.5M9.5 20v-6h5v6" />
        </svg>
      </button>
      <div className="pl-scroll pl-authbody" style={{ padding: '24px 26px 20px' }}>
        <div className="pl-vfill" />
        <div className="pl-badge">
          <div className="pl-badge-t">NOLDA</div>
          <div className="pl-badge-s">놀다</div>
        </div>
        <div className="pl-h1" style={{ whiteSpace: 'pre-line' }}>
          {/* 이 기기를 처음 쓰는지로는 '이 사람이 처음인지'를 알 수 없다
              (기기를 같이 쓰거나 새 기기로 오면 틀린다) — 양쪽 다 맞는 인사로 둔다 */}
          {'반가워요!\n오늘은 뭐 하고 놀까요'}
        </div>
        <div className="pl-sub">
          {signup ? '가입하면 저장한 코스와 취향이 기기 간에 따라와요.' : '이메일로 로그인하면 저장한 코스가 그대로 있어요.'}
        </div>

        {/* 이메일·비밀번호 로그인은 아직 구현 전이라 임시로 주석 처리. 소셜 로그인·게스트 이용만 우선 제공 */}
        {/*
        <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 11 }}>
          {signup && (
            <Field label="이름" value={auth.name} onChange={(v) => setAuth({ name: v, error: '' })} placeholder="어떻게 부를까요?" />
          )}
          <Field label="이메일" value={auth.email} onChange={(v) => setAuth({ email: v, error: '' })} placeholder="you@example.com" borderColor={emailBd} type="email" />
          <Field label="비밀번호" value={auth.pw} onChange={(v) => setAuth({ pw: v, error: '' })} placeholder="8자 이상" borderColor={pwBd} type="password" />
          {auth.error && <div className="pl-error">{auth.error}</div>}
        </div>

        <div className="pl-cta" onClick={submitAuth}>{signup ? '가입하고 시작하기' : '로그인'}</div>
        */}
        {auth.error && <div className="pl-error" style={{ marginTop: 28 }}>{auth.error}</div>}

        <div className="pl-divider" style={{ marginTop: auth.error ? 22 : 40 }}><span /><span className="pl-divider-l">간편하게</span><span /></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {socials.map((p) => (
            <div key={p.key} className="pl-social" style={{ background: p.bg, border: `1px solid ${p.bd}`, position: 'relative' }}
              onClick={() => {
                try { window.location.href = p.key === 'kakao' ? kakaoLoginUrl() : googleLoginUrl() } catch (e) { setAuth({ error: (e as Error).message }) }
              }}>
              {p.key === lastProvider && <span className="pl-last-chip">마지막으로 로그인했어요</span>}
              <span className="pl-social-dot" style={{ background: p.dot, color: p.dotFg }}>{p.mark}</span>
              <span style={{ color: p.fg, fontWeight: 600, fontSize: 14.5 }}>{p.l}</span>
            </div>
          ))}
        </div>
        <div className="pl-switch-acct" onClick={() => {
          try { window.location.href = googleLoginUrl(true) } catch (e) { setAuth({ error: (e as Error).message }) }
        }}>다른 구글 계정으로 로그인</div>
        <div className="pl-skip" onClick={() => {
          setAuth({ skipped: true })
        }}>로그인 없이 둘러보기</div>
        <div className="pl-vfill" />
      </div>
      {/* 이메일 회원가입/로그인 전환 링크 — 위 폼과 함께 임시로 주석 처리 (지우지 않고 보존) */}
      {/*
      <div className="pl-authfoot">
        <span style={{ color: 'rgba(20,24,33,.5)' }}>{signup ? '이미 계정이 있나요? ' : '처음이신가요? '}</span>
        <span className="pl-link" onClick={() => setAuth({ mode: signup ? 'login' : 'signup', error: '' })}>{signup ? '로그인' : '회원가입'}</span>
      </div>
      */}
    </div>
  )
}

/* ── 소셜 로그인 리디렉션 실패 ─────────────────────────────── */
function LoginErrorScreen({ message, goHome }: { message: string; goHome: () => void }) {
  return (
    <div className="pl-screen">
      <div className="pl-scroll" style={{ padding: '48px 26px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
        <div className="pl-badge">
          <div className="pl-badge-t">NOLDA</div>
          <div className="pl-badge-s">놀다</div>
        </div>
        <div style={{
          marginTop: 36, width: 56, height: 56, borderRadius: '50%', background: 'rgba(224,87,74,.12)', color: '#e0574a',
          display: 'flex', alignItems: 'center', justifyContent: 'center', font: '800 26px/1 Pretendard,sans-serif',
        }}>!</div>
        <div className="pl-h1" style={{ marginTop: 20, fontSize: 22 }}>로그인에 실패했어요</div>
        <div className="pl-sub" style={{ marginTop: 10 }}>{message}</div>
        <div className="pl-cta" style={{ marginTop: 28, width: '100%' }} onClick={goHome}>홈으로 돌아가기</div>
      </div>
    </div>
  )
}

// 이메일·비밀번호 로그인 폼(AuthScreen)에서만 쓰던 입력 컴포넌트. 폼을 임시로 주석 처리하면서 함께 비활성화
// function Field({ label, value, onChange, placeholder, borderColor, type = 'text' }: {
//   label: string; value: string; onChange: (v: string) => void; placeholder: string; borderColor?: string; type?: string
// }) {
//   return (
//     <div>
//       <div className="pl-field-label">{label}</div>
//       <input
//         type={type} value={value} placeholder={placeholder}
//         onChange={(e) => onChange(e.target.value)}
//         className="pl-input" style={{ borderColor: borderColor || 'rgba(20,24,33,.1)' }}
//       />
//     </div>
//   )
// }

/* ── 데이터 소스 연결 (취향 유형 테스트 시작) ───────────────────── */
export function DataSourceScreen({ sources, setSources, goHome, startScan, skipScan, error, photoCount, onPickPhotos, onClearPhotos }: {
  sources: Sources
  setSources: (fn: (s: Sources) => Sources) => void
  goHome: () => void
  startScan: () => void
  skipScan: () => void
  error: string
  photoCount: number
  onPickPhotos: (files: File[]) => void
  onClearPhotos: () => void
}) {
  const photoInputRef = useRef<HTMLInputElement | null>(null)
  const [launching, setLaunching] = useState(false)
  const [nudge, setNudge] = useState(0) // 아무것도 안 고르고 누르면 안내를 흔듦
  const nSrc = (sources.youtube ? 1 : 0) + (sources.photos ? 1 : 0)

  // 연결에 실패해 돌아오면 다시 고를 수 있게
  useEffect(() => { if (error) setLaunching(false) }, [error])

  const launch = () => {
    if (launching) return
    if (!nSrc) return setNudge((n) => n + 1)
    setLaunching(true)
    const ms = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : SCENE_LAUNCH_MS
    window.setTimeout(startScan, ms)
  }
  const tiles = [
    { key: 'youtube' as const, label: '유튜브', icon: <YoutubeIcon size={34} />, sub: sources.youtube ? '좋아요·구독' : '연결 안 함' },
    { key: 'photos' as const, label: '사진첩', icon: <PhotoIcon size={34} />, sub: sources.photos ? `${photoCount}장` : '사진 고르기' },
  ]

  return (
    <div className={'pl-screen sg-page sg-select' + (launching ? ' is-launch' : '')}>
      <div className="sg-toprow">
        <button className="sg-top-btn" onClick={goHome}>‹ 홈</button>
        <button className="sg-top-btn" onClick={skipScan}>연결 없이 둘러보기</button>
      </div>
      <CardFan launching={launching} />
      <div className="sg-select-body">
        <div className="sg-eyebrow">내 기록으로 알아보는</div>
        <div className="sg-title sg-title--lg">취향 유형 테스트</div>
        <div className="sg-sub">분석하는 동안 끌리는 장소를 고르면<br />마지막에 나만의 취향 유형과 코스를 알려드려요</div>
        <div className="sg-tiles">
          {tiles.map((c) => {
            const on = sources[c.key]
            return (
              <button key={c.key} className={'sg-tile' + (on ? ' is-on' : '')} disabled={launching}
                onClick={() => {
                  if (c.key !== 'photos') return setSources((st) => ({ ...st, youtube: !st.youtube }))
                  if (on) onClearPhotos()
                  else photoInputRef.current?.click()
                }}>
                {c.icon}
                <span className="sg-tile-text">
                  <span className="sg-tile-label">{c.label}</span>
                  <span className="sg-tile-sub">{c.sub}</span>
                </span>
                <span className="sg-check" aria-hidden>{on ? '✓' : ''}</span>
              </button>
            )
          })}
        </div>
        {error && <div className="sg-error">{error}</div>}
        <button key={nudge} className={'sg-start' + (nudge ? ' is-nudge' : '')} onClick={launch} disabled={launching}>
          {launching ? '분석을 준비하는 중…' : nSrc ? '취향 분석 시작' : '하나 이상 골라주세요'}
        </button>
        <details className="sg-privacy">
          <summary>기록은 이렇게만 써요</summary>
          유튜브는 읽기 전용 권한으로 좋아요·구독 목록만 보고, 로그인 정보는 저장하지 않아요. 고른 사진은 기기 안에서 작게 줄인 뒤(최대 12장) 취향 분석에 한 번만 쓰이고, 원본과 줄인 사진 모두 저장하지 않습니다.
        </details>
      </div>
      <input
        ref={photoInputRef} type="file" accept="image/*" multiple hidden
        onChange={(e) => {
          const files = Array.from(e.target.files || [])
          e.target.value = ''
          if (files.length) onPickPhotos(files)
        }}
      />
    </div>
  )
}

/* ── 분석 중(장소 카드 스와이프) · 분석 완료(취향 유형 발표) ─────────── */
export interface ScanResult { tags: string[]; taste: Taste }

export function ScanningScreen({ sources, yt, loading, scanN, photoUrls, ready, cancelScan, onResult, swipes, onSwipe }: {
  sources: Sources
  yt: YoutubeTaste | null
  loading: boolean
  scanN: number
  photoUrls: string[]
  ready: ScanResult | null
  cancelScan: () => void
  onResult: () => void
  swipes: Swipe[]
  onSwipe: (s: Swipe) => void
}) {
  const total = scanSteps(sources, yt, photoUrls.length)
  const read = Math.min(scanN, total)
  const analyzing = !loading && read >= total && !ready // 기록은 다 읽었고 AI 분석을 기다리는 중
  // 진행률: 기록을 읽으며 80%까지 → AI를 기다리는 동안 95%까지 천천히 → 끝나면 100%
  const target = ready ? 100 : loading ? 0 : analyzing ? 95 : (read / Math.max(1, total)) * 80
  const [pct, setPct] = useState(0)
  useEffect(() => {
    const id = requestAnimationFrame(() => setPct(target))
    return () => cancelAnimationFrame(id)
  }, [target])

  const [deckDone, setDeckDone] = useState(false)
  const [revealed, setRevealed] = useState(false)
  useEffect(() => { if (!ready) setRevealed(false) }, [ready])
  // 카드를 다 넘겼는데 분석도 끝났으면 바로 발표
  useEffect(() => {
    if (!ready || !deckDone) return
    const id = window.setTimeout(() => setRevealed(true), 700)
    return () => clearTimeout(id)
  }, [ready, deckDone])
  const result = useMemo(() => (ready ? pickTasteType(ready.taste, ready.tags, swipes) : null), [ready, swipes])
  const liked = swipes.filter((x) => x.liked).length

  if (revealed && ready && result) {
    return (
      <div className="pl-screen sg-page">
        <TypeReveal type={result.type} areas={result.areas} tags={ready.tags} liked={result.liked} onResult={onResult} />
      </div>
    )
  }
  return (
    <div className="pl-screen sg-page">
      <div className="sg-top">
        <button className="sg-top-btn" onClick={cancelScan}>‹ 분석 취소</button>
      </div>
      <div className="sg-head">
        <div className="sg-row">
          <span className="sg-status">
            {ready ? '분석 완료!' : loading ? '기록을 불러오는 중' : analyzing ? 'AI가 취향을 읽는 중' : '기록을 읽는 중'}
            {!ready && <span className="sg-ellipsis"><i>.</i><i>.</i><i>.</i></span>}
          </span>
          <span className="sg-pct">{Math.round(pct)}%</span>
        </div>
        <div className="sg-bar"><i className={analyzing ? 'is-waiting' : ''} style={{ width: `${pct}%` }} /></div>
        <div className="sg-title">기다리는 동안<br />끌리는 곳을 골라주세요</div>
        <div className="sg-sub">좋아요한 장소는 코스 추천에 반영돼요</div>
      </div>
      <div className="sg-stage">
        {deckDone
          ? <div className="sg-empty">{liked ? `좋아요 ${liked}곳!` : '다 골랐어요!'}<br />{ready ? '결과를 공개할게요' : '취향 유형을 정리하고 있어요'}</div>
          : <SwipeDeck onSwipe={onSwipe} onEmpty={() => setDeckDone(true)} />}
      </div>
      {ready && !deckDone && (
        <button type="button" className="sg-reveal-btn" onClick={() => setRevealed(true)}>✨ 내 취향 유형 공개하기</button>
      )}
    </div>
  )
}

/* ── 취향 요약 ─────────────────────────────────────────────── */
function SummaryScreen({ report, taste, setTaste, tags, setTags, picks, setPicks, intent, setIntent, toStart, rescan, finish, hourRange, setHourRange, budget, setBudget }: {
  report: Report
  taste: Taste
  setTaste: (fn: (t: Taste) => Taste) => void
  tags: string[]
  setTags: (fn: (t: string[]) => string[]) => void
  picks: Picks
  setPicks: (fn: (p: Picks) => Picks) => void
  intent: string | null
  setIntent: (v: string | null) => void
  toStart: () => void
  rescan: () => void
  finish: () => void
  hourRange: [number, number]
  setHourRange: (r: [number, number]) => void
  budget: number
  setBudget: (v: number) => void
}) {
  const scanMeta = [
    report.ytLikes || report.ytSubs ? `유튜브 좋아요 ${report.ytLikes} · 구독 ${report.ytSubs}` : '',
    report.total ? `사진 ${report.total}장` : '',
  ].filter(Boolean).join(' · ') + ' 분석'
  // LLM이 주제를 만들어 줬으면 고정 6개만 남기고, 나머지 주제는 이번 분석에서 새로 만든 것으로 채운다
  const dynamic = report.topics.length > 0
  const shown = dynamic ? FIXED_Q_KEYS : (Q.filter((x) => !x.multi).map((x) => x.key) as string[])
  const traitCards = Q.filter((x) => !x.multi && shown.indexOf(x.key) > -1).map((x) => ({
    key: x.key, name: x.name, evidence: report.evidence[x.key] || '',
    opts: x.opts.map((o) => ({ key: o.v, l: o.l, on: (taste as any)[x.key] === o.v })),
  }))
  const tagChips = (Q.find((x) => x.key === 'tags')?.opts || []).map((o) => ({ key: o.v, l: o.l, on: tags.indexOf(o.v) > -1 }))
  const intentChips = [
    { v: null as string | null, l: '기록 그대로' }, { v: 'calm', l: '푹 쉬고 싶어' }, { v: 'active', l: '몸 좀 쓰고파' },
    { v: 'new', l: '새로운 거' }, { v: 'food', l: '맛있는 거' },
  ]
  const toggle = (t: TasteTopic, v: string) => setPicks((st) => {
    const cur = st[t.key] || []
    if (!t.multi) return { ...st, [t.key]: cur[0] === v ? [] : [v] }
    return { ...st, [t.key]: cur.indexOf(v) > -1 ? cur.filter((x) => x !== v) : cur.concat([v]) }
  })

  return (
    <div className="pl-screen">
      <div className="pl-scroll" style={{ padding: '22px 22px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <span style={{ font: '400 11.5px/1 Pretendard,sans-serif', color: 'rgba(20,24,33,.45)' }}>{scanMeta}</span>
          <div className="pl-pillbtn" onClick={toStart}>처음으로</div>
        </div>
        <div className="pl-h1" style={{ marginTop: 9, fontSize: 26 }}>이런 취향이 보여요</div>
        <div className="pl-sub" style={{ marginTop: 9 }}>다르면 눌러서 바꿔주세요. 바꾼 값으로 다시 추천해요.</div>
        {report.notice && <div className="pl-notice" style={{ marginTop: 12 }}>{report.notice}</div>}

        {report.highlights.length > 0 && (
          <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {report.highlights.map((h) => <span key={h} className="pl-tag-mini" style={{ background: '#E4F4EC', color: '#0C5A42' }}>{h}</span>)}
          </div>
        )}

        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {traitCards.map((t) => (
            <div key={t.key} className="pl-traitcard">
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ font: '600 11.5px/1 Pretendard,sans-serif', color: 'rgba(20,24,33,.42)' }}>{t.name}</span>
                <span style={{ marginLeft: 'auto', font: '600 11px/1 Pretendard,sans-serif', color: '#00845A' }}>{t.evidence}</span>
              </div>
              {t.key === 'hour' ? (
                <HourRange range={hourRange} onChange={setHourRange} />
              ) : (
                <div style={{ marginTop: 11, display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                  {t.opts.map((o) => (
                    <Chip key={o.key} label={o.l} on={o.on} onClick={() => setTaste((st) => ({ ...st, [t.key]: o.key }))} />
                  ))}
                </div>
              )}
            </div>
          ))}
          <div className="pl-traitcard">
            <span style={{ font: '600 11.5px/1 Pretendard,sans-serif', color: 'rgba(20,24,33,.42)' }}>1인 예산</span>
            <BudgetSlider value={budget} onChange={setBudget} />
          </div>
          {!dynamic && (
            <div className="pl-traitcard">
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ font: '600 11.5px/1 Pretendard,sans-serif', color: 'rgba(20,24,33,.42)' }}>이런 것들이 자주 보였어요</span>
                <span style={{ marginLeft: 'auto', font: '600 11px/1 Pretendard,sans-serif', color: '#00845A' }}>{report.evidence.tags}</span>
              </div>
              <div style={{ marginTop: 11, display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                {tagChips.map((c) => (
                  <Chip key={c.key} label={c.l} on={c.on} onClick={() => setTags((st) => (st.indexOf(c.key) > -1 ? st.filter((x) => x !== c.key) : st.concat([c.key])))} />
                ))}
              </div>
            </div>
          )}
          {/* 이번 분석에서 새로 만든 주제 — 기록이 달라지면 주제와 선택지도 달라진다 */}
          {report.topics.map((t) => (
            <div key={t.key} className="pl-traitcard">
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ font: '600 11.5px/1 Pretendard,sans-serif', color: 'rgba(20,24,33,.42)' }}>{t.name}</span>
                <span style={{ marginLeft: 'auto', font: '600 11px/1 Pretendard,sans-serif', color: '#00845A' }}>{t.evidence}</span>
              </div>
              <div style={{ marginTop: 11, display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                {t.opts.map((o) => (
                  <Chip key={o.v} label={o.l} on={(picks[t.key] || []).indexOf(o.v) > -1} onClick={() => toggle(t, o.v)} />
                ))}
              </div>
            </div>
          ))}
        </div>

        {!dynamic && (
        <div className="pl-intentbox">
          <div style={{ font: '800 15.5px/1.35 Pretendard,sans-serif', color: '#141821' }}>오늘은 어떤 걸 해볼까요?</div>
          <div style={{ marginTop: 6, font: '400 12.5px/1.6 Pretendard,sans-serif', color: 'rgba(20,24,33,.5)' }}>취향 분석은 예전 기록 기준이에요.<br />오늘 기분에 맞는 걸 고르면 그 코스를 위로 올려드려요.</div>
          <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {intentChips.map((c) => (
              <Chip key={String(c.v)} label={c.l} on={(intent || null) === c.v} onClick={() => setIntent(c.v)} />
            ))}
          </div>
        </div>
        )}
        <div className="pl-skip" onClick={rescan}>연결 항목 바꿔서 다시 분석</div>
      </div>
      <div className="pl-foot">
        <div className="pl-cta" onClick={finish}>AI 코스 추천 받기</div>
      </div>
    </div>
  )
}

/* 시간대 막대 — 6시~24시 1시간 눈금, 시작·끝 손잡이 2개. 취향값은 시작 시각의 4구간(아침·낮·노을 무렵·밤)으로 저장 */
const HOUR_MIN = 6, HOUR_MAX = 24
const HOUR_SPAN = HOUR_MAX - HOUR_MIN
const HOUR_DEFAULT: Record<string, [number, number]> = { morning: [9, 11], noon: [12, 15], sunset: [16, 19], night: [19, 22] }
const hourBucket = (h: number) => (h < 11 ? 'morning' : h < 16 ? 'noon' : h < 19 ? 'sunset' : 'night') // logic.ts analyze 기준과 같음
const hourText = (h: number) => (h === 24 ? '자정' : h === 12 ? '낮 12시' : h < 12 ? `오전 ${h}시` : `오후 ${h - 12}시`)
// 손잡이 중심이 움직이는 구간(양끝 12px 안쪽)에 맞춘 위치 — ratio 0~1
const trackPos = (ratio: number) => `calc(12px + (100% - 24px) * ${ratio})`
const hourPos = (h: number) => trackPos((h - HOUR_MIN) / HOUR_SPAN)

function HourRange({ range: [start, end], onChange }: { range: [number, number]; onChange: (r: [number, number]) => void }) {
  const bucket = hourBucket(start)
  const update = (s: number, e: number) => onChange([s, e])
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <span style={{ font: '800 17px/1.2 Pretendard,sans-serif', letterSpacing: '-.02em', color: '#141821' }}>{hourText(start)} ~ {hourText(end)}</span>
        <span style={{ font: '600 12.5px/1 Pretendard,sans-serif', color: GREEN }}>{end - start}시간 · {labelOf(Q[2].opts, bucket)}</span>
      </div>
      <div className="pl-range">
        <div className="pl-range-track" />
        <div className="pl-range-fill" style={{ left: hourPos(start), width: `calc((100% - 24px) * ${(end - start) / HOUR_SPAN})` }} />
        <input
          type="range" min={HOUR_MIN} max={HOUR_MAX} step={1} value={start}
          aria-label="시작 시간" aria-valuetext={hourText(start)}
          style={{ zIndex: start >= HOUR_MAX - 1 ? 3 : 2 }} // 끝까지 밀었을 때 시작 손잡이가 아래에 깔리지 않게
          onChange={(e) => update(Math.min(Number(e.target.value), end - 1), end)}
        />
        <input
          type="range" min={HOUR_MIN} max={HOUR_MAX} step={1} value={end}
          aria-label="끝 시간" aria-valuetext={hourText(end)}
          onChange={(e) => update(start, Math.max(Number(e.target.value), start + 1))}
        />
      </div>
      <div className="pl-range-ticks" aria-hidden>
        {Array.from({ length: HOUR_SPAN + 1 }, (_, i) => HOUR_MIN + i).map((h) => (
          <span key={h} className={h % 3 === 0 ? 'major' : ''} style={{ left: hourPos(h) }}>
            {h % 3 === 0 && <em>{h}</em>}
          </span>
        ))}
      </div>
    </div>
  )
}

/* 1인 예산 막대 — 1만~20만원 5천원 단위, 1만원마다 눈금. 맨 오른쪽(20만원)은 '상관없음'(budget 0) */
const BUDGET_MIN = 10000, BUDGET_MAX = 200000, BUDGET_STEP = 5000
const manwon = (v: number) => `${v / 10000}만원`

function BudgetSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const at = value ? Math.min(Math.max(value, BUDGET_MIN), BUDGET_MAX) : BUDGET_MAX
  const unlimited = at >= BUDGET_MAX
  const ratio = (at - BUDGET_MIN) / (BUDGET_MAX - BUDGET_MIN)
  const text = unlimited ? '상관없음' : `${manwon(at)} 이하`
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <span style={{ font: '800 17px/1.2 Pretendard,sans-serif', letterSpacing: '-.02em', color: '#141821' }}>{text}</span>
        <span style={{ font: '600 12.5px/1 Pretendard,sans-serif', color: GREEN }}>{unlimited ? '끝까지 밀면 제한 없음' : '코스 전체 1인 기준'}</span>
      </div>
      <div className="pl-range">
        <div className="pl-range-track" />
        <div className="pl-range-fill" style={{ left: '12px', width: `calc((100% - 24px) * ${ratio})` }} />
        <input
          type="range" min={BUDGET_MIN} max={BUDGET_MAX} step={BUDGET_STEP} value={at}
          aria-label="1인 예산" aria-valuetext={text}
          onChange={(e) => {
            const v = Number(e.target.value)
            onChange(v >= BUDGET_MAX ? 0 : v)
          }}
        />
      </div>
      <div className="pl-range-ticks" aria-hidden>
        {Array.from({ length: (BUDGET_MAX - BUDGET_MIN) / 10000 + 1 }, (_, i) => BUDGET_MIN + i * 10000).map((v) => {
          const major = v === BUDGET_MIN || v % 50000 === 0
          return (
            <span key={v} className={major ? 'major' : ''} style={{ left: trackPos((v - BUDGET_MIN) / (BUDGET_MAX - BUDGET_MIN)) }}>
              {major && <em>{v === BUDGET_MAX ? '20만+' : v / 10000 + '만'}</em>}
            </span>
          )
        })}
      </div>
    </div>
  )
}

function Chip({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <div className="pl-chip" style={{ background: on ? GREEN : '#fff', borderColor: on ? GREEN : 'rgba(20,24,33,.12)', color: on ? '#fff' : '#2c3444' }} onClick={onClick}>
      {label}
    </div>
  )
}

/* ── 코스 찾기 (조건 칩 + 목록) ────────────────────────────── */
function SearchTab({ cond, setCond, sheet, setSheetKey, built, filtered, taste, tags, restart, openCourse, ai, generateAi }: {
  cond: typeof DEFAULT_COND
  setCond: (fn: (c: typeof DEFAULT_COND) => typeof DEFAULT_COND) => void
  sheet: (typeof COND)[number] | null
  setSheetKey: (k: string | null) => void
  built: BuiltCourse[]
  filtered: BuiltCourse[]
  taste: Taste
  tags: string[]
  restart: () => void
  openCourse: (id: string) => void
  ai: AiState
  generateAi: () => void
}) {
  const profileLine = '기록에서 읽은 취향 · ' + [labelOf(Q[2].opts, taste.hour), labelOf(Q[3].opts, taste.spend)].filter(Boolean).join(' · ') + (tags.length ? ' · ' + tags.join('·') : '')
  const resultHead = ai.status === 'loading' || ai.status === 'idle' ? '코스를 만들고 있어요' : filtered.length ? `추천 코스 ${filtered.length}개` : '조건에 맞는 코스가 없어요'
  // 시간·예산은 요약 화면 막대에서 정하므로 코스 화면 칩·초기화 대상에서 뺌
  const condChips = COND.filter((c) => c.key !== 'hours' && c.key !== 'budget')
  const resetCond = () => setCond((c) => ({ ...DEFAULT_COND, budget: c.budget }))
  const condDirty = condChips.some((c) => (cond as any)[c.key] !== (DEFAULT_COND as any)[c.key])
  const emptyHint = cond.budget && built.filter((c) => matchCond(c, { ...cond, budget: 0 })).length
    ? '예산을 조금 올리면 볼 수 있는 코스가 있어요'
    : cond.hours && built.filter((c) => matchCond(c, { ...cond, hours: 0 })).length
      ? '시간을 조금 늘리면 볼 수 있는 코스가 있어요'
      : '지역이나 시간 조건을 넓혀보세요'

  return (
    <div className="pl-screen">
      <div style={{ flex: 'none', padding: '22px 20px 0' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <div className="pl-pillbtn" onClick={restart}>다시 분석</div>
        </div>
        <div style={{ marginTop: 6, textAlign: 'center' }}>
          <div style={{ font: '400 11.5px/1.4 Pretendard,sans-serif', color: 'rgba(20,24,33,.45)' }}>{profileLine}</div>
          <div className="pl-h1" style={{ marginTop: 8, fontSize: 25 }}>{resultHead}</div>
        </div>
        <div className="pl-chipbar">
          {condChips.map((c) => {
            const on = (cond as any)[c.key] !== (DEFAULT_COND as any)[c.key]
            return (
              <div key={c.key} className="pl-condchip" style={{ background: on ? '#141821' : '#fff', borderColor: on ? '#141821' : 'rgba(20,24,33,.1)', color: on ? '#fff' : 'rgba(20,24,33,.7)' }} onClick={() => setSheetKey(c.key)}>
                <span style={{ opacity: 0.5, fontWeight: 500 }}>{c.name}</span>{labelOf(c.opts, (cond as any)[c.key])}<span style={{ opacity: 0.55 }}>▾</span>
              </div>
            )
          })}
          {condDirty && <div className="pl-condchip pl-condchip-reset" onClick={resetCond}>초기화</div>}
        </div>
      </div>
      <div className="pl-scroll" style={{ padding: '16px 20px 96px', borderTop: '1px solid rgba(20,24,33,.06)' }}>
        <AiBanner ai={ai} generateAi={generateAi} courses={built} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {ai.status === 'loading'
            ? [0, 1, 2, 3].map((i) => <CourseCardSkeleton key={i} />)
            : filtered.map((s) => (
              <CourseCard key={s.id} s={s} onOpen={() => openCourse(s.id)} />
            ))}
        </div>
        {filtered.length === 0 && (ai.status === 'done' || ai.status === 'error') && (
          <div style={{ padding: '40px 22px', textAlign: 'center' }}>
            <div style={{ font: '700 15.5px/1.5 Pretendard,sans-serif', color: '#141821' }}>이 조건에 맞는 코스가 없어요</div>
            <div style={{ marginTop: 7, font: '400 13px/1.6 Pretendard,sans-serif', color: 'rgba(20,24,33,.5)' }}>{emptyHint}</div>
            <div className="pl-cta" style={{ display: 'inline-block', marginTop: 16, padding: '13px 20px', borderRadius: 99 }} onClick={resetCond}>조건 초기화</div>
          </div>
        )}
      </div>

      {sheet && (
        <div className="pl-sheet-wrap">
          <div className="pl-sheet-backdrop" onClick={() => setSheetKey(null)} />
          <div className="pl-sheet">
            <div className="pl-sheet-handle" />
            <div className="pl-h1" style={{ fontSize: 19 }}>{sheet.title}</div>
            <div className="pl-sub" style={{ marginTop: 6 }}>{sheet.hint}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
              {sheet.opts.map((o) => {
                const on = (cond as any)[sheet.key] === o.v
                const n = sheet.key === 'people' ? '' : built.filter((c) => matchCond(c, { ...cond, [sheet.key]: o.v } as any)).length
                return (
                  <div key={String(o.v)} className="pl-sheetopt" style={{ background: on ? GREEN : '#fff', borderColor: on ? GREEN : 'rgba(20,24,33,.12)', color: on ? '#fff' : '#2c3444' }}
                    onClick={() => { setCond((st) => ({ ...st, [sheet.key]: o.v })); setSheetKey(null) }}>
                    {o.l}{n !== '' && <span style={{ marginLeft: 7, opacity: 0.55, fontWeight: 500 }}>{n}</span>}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function AiBanner({ ai, generateAi, courses }: { ai: AiState; generateAi: () => void; courses: BuiltCourse[] }) {
  const taste = courses.filter((c) => (c.source || 'taste') === 'taste').length
  if (ai.status === 'idle') return null
  if (ai.status === 'loading') {
    return (
      <div className="pl-aibanner">
        <span className="pl-spinner" />
        <div style={{ flex: 1 }}>
          <div className="pl-aibanner-t">취향에 맞는 코스를 AI가 만들고 있어요</div>
          <div className="pl-aibanner-s">고른 시간을 꽉 채우는 코스 4개를 짜는 중 · 30초~1분 정도 걸려요</div>
        </div>
      </div>
    )
  }
  const failed = ai.status === 'error'
  return (
    <div className={failed ? 'pl-aibanner pl-aibanner-err' : 'pl-aibanner'}>
      <div style={{ flex: 1 }}>
        <div className="pl-aibanner-t">{failed ? 'AI 코스를 만들지 못해 기본 코스를 보여드려요' : taste === courses.length ? `취향 맞춤 코스 ${taste}개` : `취향 맞춤 ${taste}개 · 추가 추천 ${courses.length - taste}개`}</div>
        <div className="pl-aibanner-s">
          {failed ? ai.error : '체류 시간·가격은 추정이에요 · 조건을 바꿨다면 다시 만들어 보세요'}
        </div>
      </div>
      <div className="pl-pillbtn" onClick={generateAi}>{failed ? '다시 시도' : '다시 만들기'}</div>
    </div>
  )
}

/* ── 저장한 코스 ───────────────────────────────────────────── */
function SavedTab({ savedBuilt, people, openCourse, remove, goSearch }: {
  savedBuilt: BuiltCourse[]
  people: number
  openCourse: (id: string) => void
  remove: (id: string) => void
  goSearch: () => void
}) {
  const countLine = savedBuilt.length ? `${savedBuilt.length}개 · 인원 ${people}명 기준 금액` : '아직 비어 있어요'
  return (
    <div className="pl-screen">
      <div style={{ flex: 'none', padding: '22px 20px 16px' }}>
        <div style={{ font: '400 11.5px/1 Pretendard,sans-serif', color: 'rgba(20,24,33,.45)' }}>{countLine}</div>
        <div className="pl-h1" style={{ marginTop: 8, fontSize: 25 }}>저장한 코스</div>
      </div>
      <div className="pl-scroll" style={{ padding: '0 20px 96px' }}>
        {savedBuilt.length === 0 && (
          <div style={{ marginTop: 60, textAlign: 'center', padding: '0 24px' }}>
            <div className="pl-emptyicon">♡</div>
            <div style={{ font: '800 18px/1.35 Pretendard,sans-serif', color: '#141821' }}>아직 저장한 코스가 없어요</div>
            <div style={{ marginTop: 8, font: '400 13px/1.7 Pretendard,sans-serif', color: 'rgba(20,24,33,.5)' }}>마음에 드는 코스를 열어서<br />'이 코스로 저장'을 눌러두면 여기 모여요</div>
            <div className="pl-cta" style={{ display: 'inline-block', marginTop: 20, padding: '14px 22px', borderRadius: 99 }} onClick={goSearch}>코스 찾아보기</div>
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {savedBuilt.map((s) => (
            <div key={s.id} className="pl-savedcard">
              <div style={{ cursor: 'pointer', padding: '18px 18px 14px' }} onClick={() => openCourse(s.id)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
                  <span className="pl-matchtag" style={{ background: s.tintBg, color: s.tintFg }}>{s.matchLabel}</span>
                  <span style={{ font: '500 11.5px/1 Pretendard,sans-serif', color: 'rgba(20,24,33,.45)' }}>{s.area} · {s.moveLine}</span>
                  <span style={{ marginLeft: 'auto', font: '700 12.5px/1 Pretendard,sans-serif', color: '#141821' }}>{s.costLabel}</span>
                </div>
                <div className="pl-coursetitle">{s.title}</div>
                <div style={{ marginTop: 9, display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {s.items.slice(0, 3).map((it, i) => (
                    <div key={i} style={{ display: 'flex', gap: 9, alignItems: 'baseline' }}>
                      <span style={{ flex: 'none', width: 38, font: '700 11.5px/1.5 Pretendard,sans-serif', color: 'rgba(20,24,33,.4)' }}>{it.time}</span>
                      <span style={{ font: '500 12.5px/1.5 Pretendard,sans-serif', color: 'rgba(20,24,33,.62)' }}>{it.name}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', borderTop: '1px solid rgba(20,24,33,.06)' }}>
                <div style={{ flex: 1, padding: 14, textAlign: 'center', font: '600 13px/1 Pretendard,sans-serif', color: 'rgba(20,24,33,.7)', cursor: 'pointer' }} onClick={() => openCourse(s.id)}>전체 일정</div>
                <div style={{ width: 1, background: 'rgba(20,24,33,.06)' }} />
                <div style={{ flex: 'none', padding: '14px 20px', textAlign: 'center', font: '600 13px/1 Pretendard,sans-serif', color: '#c3503f', cursor: 'pointer' }} onClick={() => remove(s.id)}>저장 취소</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ── 하단 탭바 ─────────────────────────────────────────────── */

/* ── 코스 상세 모달 (타임라인 + 이동 동선) ─────────────────── */
function CourseModal({ course, isSaved, booked, toggleBook, toggleSave, start, share, close, closing }: {
  course: BuiltCourse
  isSaved: boolean
  booked: string[]
  toggleBook: (key: string) => void
  toggleSave: () => void
  start: () => void
  share: () => void
  close: () => void
  closing: boolean
}) {
  const [details, setDetails] = useState<Record<string, PlaceDetail>>({})
  const [preview, setPreview] = useState<number | null>(null)
  const pidsKey = course.items.map((it) => it.pid).filter(Boolean).join(',')
  useEffect(() => {
    const ids = course.items.map((it) => it.pid).filter(Boolean) as string[]
    if (!ids.length) return
    const ctrl = new AbortController()
    fetchPlaceDetails(ids, ctrl.signal).then(setDetails).catch(() => {})
    return () => ctrl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pidsKey])

  return (
    <div className={'pl-modal-wrap' + (closing ? ' closing' : '')}>
      <div className="pl-sheet-backdrop" onClick={close} />
      <div className="pl-modal">
        <div style={{ flex: 'none', padding: '12px 22px 16px' }}>
          <div className="pl-sheet-handle" />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span className="pl-matchtag" style={{ background: course.tintBg, color: course.tintFg }}>{course.matchLabel}</span>
            <span style={{ flex: 1, minWidth: 0, font: '500 11.5px/1 Pretendard,sans-serif', color: 'rgba(20,24,33,.45)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{course.area} · {course.span}</span>
            <div className="pl-closebtn" onClick={close}>✕</div>
          </div>
          <div className="pl-h1" style={{ fontSize: 24 }}>{course.title}</div>
          <div style={{ marginTop: 8, font: '400 13px/1.65 Pretendard,sans-serif', color: 'rgba(20,24,33,.58)' }}>{course.why}</div>
          {course.estimated && (
            <div style={{ marginTop: 6, font: '500 11.5px/1.5 Pretendard,sans-serif', color: 'rgba(20,24,33,.42)' }}>AI가 만든 코스예요 · 체류 시간·가격은 추정값이에요</div>
          )}
          <div style={{ marginTop: 10, display: 'inline-block', padding: '6px 11px', borderRadius: 99, background: '#E4F4EC', font: '600 11.5px/1 Pretendard,sans-serif', color: '#00734F' }}>{course.moveLine} · 총 {course.dur}</div>
        </div>
        <div className="pl-scroll" style={{ padding: '6px 22px 20px', borderTop: '1px solid rgba(20,24,33,.06)' }}>
          <RouteMap course={course} />
          <div style={{ paddingTop: 18 }}>
            {course.items.map((it, i) => (
              <div key={i}>
                {it.hasMove && (
                  <div style={{ display: 'flex', gap: 13, alignItems: 'center', margin: '-14px 0 12px' }}>
                    <div style={{ flex: 'none', width: 44 }} />
                    <div style={{ flex: 'none', width: 11, display: 'flex', justifyContent: 'center' }}>
                      <div style={{ width: 1, height: 34, background: 'repeating-linear-gradient(to bottom,rgba(20,24,33,.22) 0 4px,transparent 4px 8px)' }} />
                    </div>
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ padding: '5px 10px', borderRadius: 99, background: it.moveTint, color: '#fff', font: '700 11px/1 Pretendard,sans-serif' }}>{it.moveLabel}</span>
                      <span style={{ font: '500 11.5px/1 Pretendard,sans-serif', color: 'rgba(20,24,33,.45)' }}>{it.moveDetail}</span>
                    </div>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 13 }}>
                  <div style={{ flex: 'none', width: 44, paddingTop: 2, font: '700 12.5px/1.5 Pretendard,sans-serif', color: 'rgba(20,24,33,.42)' }}>{it.time}</div>
                  <div style={{ flex: 'none', width: 11, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={{ width: 11, height: 11, borderRadius: 99, marginTop: 5, border: `2.5px solid ${course.tint}`, background: '#fff' }} />
                    <div style={{ flex: 1, width: 1, background: 'rgba(20,24,33,.12)' }} />
                  </div>
                  <div style={{ flex: 1, paddingBottom: 22 }}>
                    <div style={{ display: 'flex', gap: 11, alignItems: 'flex-start', cursor: 'pointer' }} onClick={() => setPreview(i)}>
                      {it.pid && details[it.pid]?.image_url ? (
                        <img src={details[it.pid].image_url!} alt="" style={{ flex: 'none', width: 74, height: 74, borderRadius: 14, objectFit: 'cover' }} />
                      ) : (
                        <KindThumb kind={it.kind} pid={it.pid} />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ font: '700 15.5px/1.4 Pretendard,sans-serif', letterSpacing: '-.02em', color: '#141821' }}>{it.name}</div>
                        <div style={{ marginTop: 4, font: '400 12.5px/1.6 Pretendard,sans-serif', color: 'rgba(20,24,33,.5)' }}>{it.note}</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 9 }}>
                          <span className="pl-kindchip">{it.kind}</span>
                          <span className="pl-kindchip">{it.dur}</span>
                          <span className="pl-kindchip">{it.cost}</span>
                        </div>
                      </div>
                    </div>
                    {it.bookable && (
                      <BookButton item={it} isBooked={booked.indexOf(it.bookKey) > -1} onClick={() => toggleBook(it.bookKey)} />
                    )}
                  </div>
                </div>
              </div>
            ))}
            <div style={{ padding: '15px 16px', borderRadius: 16, background: '#E4F4EC', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, font: '600 12.5px/1.5 Pretendard,sans-serif', color: 'rgba(20,24,33,.62)' }}>{course.totalNote}</div>
              <div style={{ font: '800 19px/1 Pretendard,sans-serif', color: '#141821' }}>{course.costLabel}</div>
            </div>
          </div>
        </div>
        <div style={{ flex: 'none', padding: '14px 22px 30px', display: 'flex', alignItems: 'stretch', gap: 9, borderTop: '1px solid rgba(20,24,33,.06)' }}>
          <button type="button" className="pl-heartbtn" aria-pressed={isSaved} aria-label={isSaved ? '저장 취소' : '코스 저장'} title={isSaved ? '저장 취소' : '코스 저장'} onClick={toggleSave}>
            {isSaved ? '♥' : '♡'}
          </button>
          <div className="pl-cta" style={{ flex: 1, margin: 0, boxSizing: 'border-box', border: '1px solid transparent' }} onClick={start}>
            코스 시작
          </div>
          <div style={{ flex: 'none', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 18px', borderRadius: 17, border: '1px solid rgba(20,24,33,.12)', font: '600 15px/1 Pretendard,sans-serif', color: 'rgba(20,24,33,.65)', cursor: 'pointer' }} onClick={share}>공유</div>
        </div>
      </div>
      {preview !== null && (
        <PlacePreview course={course} index={preview} onMove={setPreview} onClose={() => setPreview(null)} onOpenCourse={() => setPreview(null)} hideOpenCourse />
      )}
    </div>
  )
}

function BookButton({ item, isBooked, onClick }: { item: BuiltCourse['items'][number]; isBooked: boolean; onClick: () => void }) {
  const providerDot = item.provider === '캐치테이블 예약' ? '#E2452F' : '#03C75A'
  return (
    <div className="pl-bookbtn" style={{
      background: isBooked ? '#E4F4EC' : '#fff',
      borderColor: isBooked ? GREEN : 'rgba(20,24,33,.14)',
      color: isBooked ? '#00734F' : '#141821',
    }} onClick={onClick}>
      <span className="pl-bookdot" style={{ background: providerDot }} />
      {isBooked ? '예약 요청됨' : item.provider}
    </div>
  )
}

function RouteMap({ course }: { course: BuiltCourse }) {
  const markers = useMemo(
    // 실제 장소(pid)가 연결된 곳만 핀 표시
    () => course.markers.flatMap((mk, i) => {
      const g = placeGeo(course.items[i]?.pid)
      return g ? [{ no: mk.no, name: mk.name, time: mk.time, lat: g[0], lng: g[1] }] : []
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [course.id, course.markers.map((m) => m.name + m.time).join('|')],
  )

  // 핀이 하나라도 빠지면 구간 순서가 어긋나므로 직선으로 대체
  const paths = useWalkLegs(course.id, markers, markers.length === course.items.length)
  // 고른 구간만 진하게 — 경로가 겹칠 때 어디서 어디로 가는지 구분하려고
  const [leg, setLeg] = useState<number | null>(null)
  const legs = markers.length > 1 && paths ? markers.length - 1 : 0

  return (
    <>
    <div className="pl-mapwrap">
      <NaverMap markers={markers} color={GREEN} paths={paths} activeLeg={leg} legOnly />
      <div className="pl-mapbadges">
        <span className="pl-mapbadge">{course.area}</span>
        <span className="pl-mapbadge" style={{ color: '#00845A' }}>{course.moveLine}</span>
      </div>
    </div>
      {legs > 1 && (
        <div className="pl-legbar">
          <button type="button" className={'pl-legbtn' + (leg === null ? ' on' : '')} onClick={() => setLeg(null)}>전체</button>
          {Array.from({ length: legs }, (_, i) => (
            <button
              key={i} type="button" className={'pl-legbtn' + (leg === i ? ' on' : '')}
              onClick={() => setLeg(leg === i ? null : i)}
              aria-label={`${i + 1}번째에서 ${i + 2}번째 장소로 가는 길`}
            >
              {i + 1}<span>→</span>{i + 2}
            </button>
          ))}
        </div>
      )}
    </>
  )
}
