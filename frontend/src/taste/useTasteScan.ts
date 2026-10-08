// 취향 분석 — 데이터 고르기(유튜브·사진) → 분석 진행 → 결과(취향·태그·고른 답)까지의 상태.
// 화면 이동(/analyze → /result, 실패 시 /start)도 분석 흐름의 일부라 여기서 한다.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { analyzeTaste, fetchYoutubeTaste, youtubeAuthorizeUrl } from '../planner/api'
import type { TasteProfile, YoutubeTaste } from '../planner/api'
import { keepReadable, readPhotos } from '../planner/photoMeta'
import { stashPhotos, takePhotos } from '../planner/photoStash'
import { HOUR_DEFAULT, analyzeYoutubeOnly, applyPicks, hourBucket, reportFromProfile, scanSteps } from '../planner/logic'
import type { Picks, Report, Sources, Taste } from '../planner/logic'
import type { Swipe } from '../planner/tasteType'
import type { AuthState } from '../auth/AuthScreen'
import { store } from '../app/storage'
import type { ScanResult } from './ScanningScreen'
import { SCAN_INTAKE_MS, SCAN_STEP_MS } from './motion'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const SKIP_TASTE: Taste = { mood: 'calm', crowd: 'mid', hour: 'noon', spend: 'cafe', pace: 'mid' }

/** 유튜브 동의에서 돌아왔을 때 이어갈 선택 — 한 번 읽으면 지운다 */
function readPending() {
  const p = store.ytPending.get()
  store.ytPending.set(null)
  return p
}

export interface TasteSnapshot {
  report: Report | null
  taste: Taste
  tags: string[]
  picks: Picks
  intent: string | null
  hourRange: [number, number] | null
  swipes: Swipe[]
}

export function useTasteScan({ entry, snap, auth, restoreAuth, onReport }: {
  /** 유튜브 동의에서 돌아온 주소의 값 (?yt / ?yt_error) */
  entry: { yt: string | null; ytError: string | null }
  /** 새로고침 전 세션에 남겨 둔 분석 결과 */
  snap: Partial<TasteSnapshot>
  /** 유튜브 동의로 페이지를 떠나기 전 로그인 상태를 남겨 두려고 받는다 */
  auth: AuthState
  restoreAuth: (a: AuthState) => void
  /** 분석이 끝났을 때 — 분석에서 나온 인원·예산을 코스 조건에 반영하는 데 쓴다 */
  onReport: (r: Report) => void
}) {
  const navigate = useNavigate()
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
  // 연동해 둔 유튜브 집계 결과. 있으면 분석을 다시 해도 구글 동의를 또 받지 않는다
  const [ytId, setYtIdState] = useState<string | null>(() => store.ytId.get())
  const setYtId = (id: string | null) => {
    setYtIdState(id)
    store.ytId.set(id)
  }

  const timerRef = useRef<number | null>(null)
  const t0Ref = useRef(0)

  const photoUrls = useMemo(() => photoFiles.map((f) => URL.createObjectURL(f)), [photoFiles])
  useEffect(() => () => { photoUrls.forEach((u) => URL.revokeObjectURL(u)) }, [photoUrls])

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
    onReport(a)
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

  // 분석을 멈춘다 (늦게 끝난 분석이 화면을 넘기지 못하게 토큰도 바꾼다)
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
    if (pending) { restoreAuth(pending.auth); setSources(src) }
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
  const swipePicked = useMemo(() => {
    const liked = swipes.filter((x) => x.liked)
    const nope = swipes.filter((x) => !x.liked)
    const label = (x: Swipe) => `${x.name}(${x.kind})`
    return [
      ...(liked.length ? [{ name: '분석 중 마음에 든 장소', labels: liked.map(label), hint: '이 장소들과 종류·분위기가 비슷한 곳을 우선한다' }] : []),
      ...(nope.length ? [{ name: '분석 중 별로라고 한 장소', labels: nope.map(label), hint: '이 장소들과 비슷한 곳은 되도록 피한다' }] : []),
    ]
  }, [swipes])

  const snapshot: TasteSnapshot = { report, taste, tags, picks, intent, hourRange, swipes }

  return {
    // 데이터 고르기
    sources, setSources, photoCount: photoFiles.length, onPickPhotos, onClearPhotos, ytError, startScan,
    // 분석 중
    scanning, scanN, ytLoading, photoUrls, scanReady, swipes,
    /** 이번 분석에 쓴 데이터 (타이머가 옛 값을 보지 않게 ref에 둔 것) */
    scanInput: scanRef.current,
    onSwipe: (x: Swipe) => setSwipes((l) => [...l.filter((y) => y.id !== x.id), x]),
    showResult: () => resultGoRef.current?.(),
    cancelScan: () => { stopScan(); navigate('/start', { replace: true }) },
    // 결과
    report, taste, setTaste, tags, setTags, picks, setPicks, intent, setIntent, range, setHourRange,
    rescan: () => { setScanN(0); setReport(null); navigate('/start', { replace: true }) },
    // 코스 생성에 넘길 값
    effTaste, effTags: derived.tags, picked: [...derived.picked, ...swipePicked],
    /** 새로고침 대비 세션에 남길 값 */
    snapshot,
    /** 분석 없이 둘러보기 — 무난한 기본 취향으로 */
    skip: () => { setTaste(SKIP_TASTE); setTags([]) },
    /** 분석을 처음부터 다시 — 로그인·유튜브 연동은 건드리지 않는다 */
    reset: () => {
      stopScan()
      setReport(null); setIntent(null); setTaste({}); setTags([]); setPicks({}); setSwipes([]); setHourRangeState(null); setYtError('')
    },
    /** 유튜브 연동을 끊는다 (로그아웃할 때) */
    disconnectYoutube: () => setYtId(null),
  }
}
