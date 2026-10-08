import HomeScreen from './HomeScreen'
import BottomTabs from './BottomTabs'
import type { HomeTab } from './BottomTabs'
import SplashScreen from './SplashScreen'
import ShareSheet from './ShareSheet'
import LiveCourse from './LiveCourse'
import { loadPlaces } from './geo'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { deleteSavedCourse, fetchAiCourses, fetchCourse, fetchSavedCourses, putSavedCourse } from './api'
import { COND, COURSES, DEFAULT_COND } from './data'
import type { Course } from './data'
import { build, matchCond } from './logic'
import type { BuiltCourse } from './logic'
import { store } from '../app/storage'
import { AuthScreen, LoginErrorScreen } from '../auth/AuthScreen'
import { useAuth } from '../auth/useAuth'
import { DataSourceScreen } from '../taste/DataSourceScreen'
import { ScanningScreen } from '../taste/ScanningScreen'
import { SummaryScreen } from '../taste/SummaryScreen'
import { useTasteScan } from '../taste/useTasteScan'
import type { TasteSnapshot } from '../taste/useTasteScan'
import { SearchTab } from '../courses/SearchTab'
import type { AiState } from '../courses/SearchTab'
import { SavedTab } from '../courses/SavedTab'
import { CourseModal } from '../courses/CourseModal'
import './planner.css'

const AI_IDLE: AiState = { status: 'idle', ids: [], error: '' }
const MODAL_CLOSE_MS = 280 // planner.css pl-sheet-down 길이와 맞춤

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

/** 새로고침 대비 세션에 남기는 값 — 분석 결과 + 코스 조건·목록 */
export interface Session extends TasteSnapshot {
  cond: typeof DEFAULT_COND
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

  const { auth, setAuth, authed, loginError, clearLoginError, restore: restoreAuth, logout: signOut, rename } = useAuth(entry)
  const [cond, setCond] = useState(snap.cond ?? { ...DEFAULT_COND })
  const scan = useTasteScan({
    entry, snap, auth, restoreAuth,
    // 분석에서 나온 인원·예산을 코스 조건에 반영
    onReport: (a) => setCond((c) => ({ ...c, people: a.party, budget: a.budgetBand })),
  })
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
  // 분석을 끝냈거나 건너뛰어 코스 화면까지 간 적이 있는지 — 홈 '코스' 탭이 분석부터일지 목록일지 정한다
  const [done, setDone] = useState(!!snap.done)
  const [ai, setAi] = useState<AiState>(() => (snap.aiIds?.length ? { status: 'done', ids: snap.aiIds, error: '' } : AI_IDLE))
  // 받은 AI 코스는 계속 보관 — 다시 만들어도 저장한 코스가 사라지지 않게
  const [aiPool, setAiPool] = useState<Record<string, Course>>(() => Object.fromEntries([...savedInit, ...(snap.pool ?? [])].map((c) => [c.id, c])))
  const aiAbort = useRef<AbortController | null>(null)
  const [modalClosing, setModalClosing] = useState(false)
  const closeTimer = useRef<number | null>(null)

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
      ...scan.snapshot, cond, done,
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
  const generateAi = () => {
    aiAbort.current?.abort()
    const ctrl = new AbortController()
    aiAbort.current = ctrl
    setAi((s) => ({ ...s, status: 'loading', error: '' }))
    fetchAiCourses(
      { taste: scan.effTaste, tags: scan.effTags, intent: scan.intent, picked: scan.picked, cond, time_window: { start: scan.range[0], end: scan.range[1] } },
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
    scan.skip(); setDone(true)
    navigate('/courses')
  }
  // 분석을 처음부터 다시 — 로그인은 건드리지 않는다. 화면 이동은 부르는 쪽이 정한다
  const restart = () => {
    scan.reset()
    setDone(false); setCond({ ...DEFAULT_COND }); setSheetKey(null); resetAi()
  }
  const startOver = () => { restart(); navigate('/start') }

  // 로그아웃 — 분석 상태를 되돌리고 토큰·유튜브 연동까지 끊는다. 마이페이지에서만 부른다
  const logout = () => {
    restart()
    scan.disconnectYoutube() // 로그아웃하면 유튜브 연동도 함께 끊는다
    signOut()
  }

  // 이메일·비밀번호 로그인은 아직 구현 전이라 AuthScreen의 폼과 함께 임시로 주석 처리
  // const submitAuth = () => {
  //   if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(auth.email)) return setAuth({ error: '이메일 주소를 다시 확인해 주세요.' })
  //   if (auth.pw.length < 8) return setAuth({ error: '비밀번호는 8자 이상으로 입력해 주세요.' })
  //   setAuth({ user: { name: auth.name || auth.email.split('@')[0], email: auth.email }, error: '', pw: '' })
  // }

  // 받은 AI 코스 전체 + 고정 코스 (저장 탭·상세 열기용 + AI 실패 시 fallback)
  const builtAll: BuiltCourse[] = useMemo(
    () => [...Object.values(aiPool), ...COURSES].map((c) => build(c, { taste: scan.effTaste, tags: scan.effTags, intent: scan.intent, people: cond.people, booked })),
    [aiPool, scan.effTaste, scan.effTags, scan.intent, cond.people, booked],
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
      <LoginErrorScreen message={loginError} goHome={() => { clearLoginError(); navigate('/') }} />
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
        onRename={rename}
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
        sources={scan.sources} setSources={scan.setSources} goHome={() => { restart(); navigate('/') }} startScan={scan.startScan} skipScan={skipScan} error={scan.ytError}
        photoCount={scan.photoCount} onPickPhotos={scan.onPickPhotos} onClearPhotos={scan.onClearPhotos}
      />
    )
  }
  if (path === '/analyze') {
    // 분석 도중 새로고침하면 이어갈 수 없다 — 결과가 있으면 결과로, 없으면 데이터 고르기로
    if (!scan.scanning) return <Navigate to={scan.report ? '/result' : '/start'} replace />
    return (
      <ScanningScreen
        sources={scan.scanInput.src} yt={scan.scanInput.yt} loading={scan.ytLoading} scanN={scan.scanN} photoUrls={scan.photoUrls} ready={scan.scanReady} onResult={scan.showResult}
        swipes={scan.swipes} onSwipe={scan.onSwipe}
        cancelScan={scan.cancelScan}
      />
    )
  }
  if (path === '/result') {
    const { report, taste } = scan
    if (!report) return <Navigate to="/start" replace />
    return (
      <SummaryScreen
        report={report} taste={taste} setTaste={scan.setTaste} tags={scan.tags} setTags={scan.setTags}
        picks={scan.picks} setPicks={scan.setPicks}
        intent={scan.intent} setIntent={scan.setIntent} toStart={startOver} rescan={scan.rescan}
        finish={() => {
          // 혼자·연인이면 인원 조건도 맞춤 (친구·가족·동료는 인원이 제각각이라 그대로)
          const people = taste.companion === 'solo' ? 1 : taste.companion === 'couple' ? 2 : 0
          if (people) setCond((c) => ({ ...c, people }))
          setDone(true)
          navigate('/courses')
        }}
        hourRange={scan.range} setHourRange={scan.setHourRange}
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
          built={built} filtered={filtered} taste={scan.effTaste} tags={scan.effTags} restart={startOver}
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
