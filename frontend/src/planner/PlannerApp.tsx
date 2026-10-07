import HomeScreen from './HomeScreen'
import BottomTabs from './BottomTabs'
import type { HomeTab } from './BottomTabs'
import SplashScreen from './SplashScreen'
import ShareSheet from './ShareSheet'
import LiveCourse from './LiveCourse'
import type { Swipe } from './tasteType'
import { stashPhotos, takePhotos } from './photoStash'
import { loadPlaces } from './geo'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { analyzeTaste, deleteSavedCourse, fetchAiCourses, fetchCourse, fetchMe, fetchSavedCourses, putSavedCourse, fetchYoutubeTaste, updateMe, youtubeAuthorizeUrl } from './api'
import type { AuthFailure, TasteProfile, YoutubeTaste } from './api'
import { keepReadable, readPhotos } from './photoMeta'
import { COND, COURSES, DEFAULT_COND } from './data'
import type { Course } from './data'
import { HOUR_DEFAULT, analyzeYoutubeOnly, applyPicks, build, hourBucket, matchCond, reportFromProfile, scanSteps } from './logic'
import type { Picks, Report, Taste, BuiltCourse, Sources } from './logic'
import { store } from '../app/storage'
import { AuthScreen, LoginErrorScreen } from '../auth/AuthScreen'
import type { AuthState } from '../auth/AuthScreen'
import { DataSourceScreen } from '../taste/DataSourceScreen'
import { ScanningScreen } from '../taste/ScanningScreen'
import type { ScanResult } from '../taste/ScanningScreen'
import { SummaryScreen } from '../taste/SummaryScreen'
import { SCAN_INTAKE_MS, SCAN_STEP_MS } from '../taste/motion'
import { SearchTab } from '../courses/SearchTab'
import type { AiState } from '../courses/SearchTab'
import { SavedTab } from '../courses/SavedTab'
import { CourseModal } from '../courses/CourseModal'
import './planner.css'


const AI_IDLE: AiState = { status: 'idle', ids: [], error: '' }
const MODAL_CLOSE_MS = 280 // planner.css pl-sheet-down 길이와 맞춤

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))


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

/** 유튜브 동의에서 돌아왔을 때 이어갈 선택 — 한 번 읽으면 지운다 */
function readPending() {
  const p = store.ytPending.get()
  store.ytPending.set(null)
  return p
}

// 소셜 로그인·유튜브 연동·옛 공유 링크(?course=)는 페이지를 새로 열고 '/?...'로 돌아온다 — 처음 한 번만 읽는다
function readEntry() {
  const q = new URLSearchParams(window.location.search)
  return { yt: q.get('yt'), ytError: q.get('yt_error'), loginToken: q.get('login_token'), loginError: q.get('login_error'), course: q.get('course') }
}

const rememberAfterLogin = (path: string) => store.afterLogin.set(path)
const afterLoginPath = () => {
  const p = store.afterLogin.get()
  return p?.startsWith('/') ? p : '/start'
}

export interface Session {
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
const readSession = (): Partial<Session> => store.session.get() ?? {}

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
    token: entry.loginToken || store.loginToken.get(),
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
  const [savedInit] = useState<Course[]>(() => store.savedCourses.get() ?? [])
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
  const [splash, setSplash] = useState(() => !window.location.search && window.location.pathname === '/' && !store.splashed.get())
  // 연동해 둔 유튜브 집계 결과. 있으면 분석을 다시 해도 구글 동의를 또 받지 않는다
  const [ytId, setYtIdState] = useState<string | null>(() => store.ytId.get())
  const setYtId = (id: string | null) => {
    setYtIdState(id)
    store.ytId.set(id)
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

  // 페이지를 새로 열고 돌아온 경우 — 주소의 ?값 대신 알맞은 화면 경로로 바꾼다 (아래 렌더에서 <Navigate>).
  // 첫 렌더의 effect에서 navigate()를 부르면 라우터가 아직 주소 변경을 구독하기 전이라 화면이 안 바뀐다
  const [entryTarget] = useState(() => {
    const { yt, ytError: ytErr, loginToken, loginError: loginErr, course } = entry
    if (course) return `/course/${encodeURIComponent(course)}`
    if (yt || ytErr) return yt ? '/analyze' : '/start'
    if (loginToken) return afterLoginPath()
    return loginErr ? '/' : null
  })

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
    store.savedCourses.set(savedCourses)
  }, [savedCourses])

  // 분석 결과·코스 목록을 세션에 남겨서 새로고침해도 같은 화면을 이어 그린다
  useEffect(() => {
    const aiIds = ai.status === 'done' ? ai.ids : []
    const s: Session = {
      report, taste, tags, picks, intent, hourRange, cond, swipes, done,
      aiIds, pool: aiIds.map((id) => aiPool[id]).filter(Boolean),
    }
    store.session.set(s)
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
      store.ytPending.set({ auth: { ...auth, pw: '' }, sources }) // 저장 불가면 돌아와서 로그인만 다시
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
    const token = fresh || store.loginToken.get()
    if (!token) return
    fetchMe(token)
      .then((me) => {
        store.loginToken.set(token)
        store.lastProvider.set(me.provider)
        setAuth({ user: { name: me.nickname || '게스트', email: me.email || '', avatar: me.avatar_url }, token, error: '' })
      })
      .catch((e: AuthFailure) => {
        // 토큰이 만료·폐기됐을 때(401·404)만 지운다.
        // 서버가 꺼져 있거나 네트워크가 끊긴 것뿐인데 지우면 멀쩡한 로그인이 날아간다
        if (e.status === 401 || e.status === 403 || e.status === 404) {
          store.loginToken.set(null)
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
    store.loginToken.set(null)
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
    if (ai.status === 'error' || ai.status === 'loading') return builtAll.filter((c) => fixedIds.has(c.id))
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

  // 복귀 주소(?login_token 등)가 아직 그대로면 먼저 경로를 바꾼다 — 바뀐 뒤엔 ?값이 없어 다시 오지 않는다
  if (entryTarget && location.search) return <Navigate to={entryTarget} replace />
  if (loginError) {
    return (
      <LoginErrorScreen message={loginError} goHome={() => { setLoginError(null); navigate('/') }} />
    )
  }
  if (splash) {
    return <SplashScreen onDone={() => { store.splashed.set('1'); setSplash(false) }} />
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
