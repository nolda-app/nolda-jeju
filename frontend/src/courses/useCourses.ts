// 코스 — 조건(지역·시간·인원·예산), AI 코스 생성, 받은 코스 보관, 저장·예약, 목록 계산.
import { useEffect, useMemo, useRef, useState } from 'react'
import { deleteSavedCourse, fetchAiCourses, fetchCourse, fetchSavedCourses, putSavedCourse } from '../planner/api'
import type { AiCourseRequest } from '../planner/api'
import { COURSES, DEFAULT_COND } from '../planner/data'
import type { Cond, Course } from '../planner/data'
import { build, matchCond } from '../planner/logic'
import type { BuiltCourse, Report, Taste } from '../planner/logic'
import { store } from '../app/storage'
import type { AiState } from './SearchTab'

const AI_IDLE: AiState = { status: 'idle', ids: [], error: '' }
const FIXED_IDS = new Set(COURSES.map((c) => c.id))

export interface CoursesSnapshot {
  cond: Cond
  aiIds: string[]
  pool: Course[]
}

export function useCourses({ snap, token, taste, toast }: {
  /** 새로고침 전 세션에 남겨 둔 조건·AI 코스 */
  snap: Partial<CoursesSnapshot>
  /** 로그인 토큰 — 있으면 저장한 코스를 서버(saved_courses)와 맞춘다 */
  token: string | null
  /** 취향 분석 결과 — 코스 점수 계산과 AI 코스 생성 요청에 쓴다 */
  taste: { effTaste: Taste; effTags: string[]; intent: string | null; picked: AiCourseRequest['picked']; range: [number, number] }
  toast: (msg: string) => void
}) {
  const [cond, setCond] = useState<Cond>(snap.cond ?? { ...DEFAULT_COND })
  // 저장한 코스: 이 기기(localStorage)에 보관하고, 로그인했으면 DB(saved_courses)와도 맞춤
  const [savedInit] = useState<Course[]>(() => store.savedCourses.get() ?? [])
  const [saved, setSaved] = useState<string[]>(() => savedInit.map((c) => c.id))
  const [booked, setBooked] = useState<string[]>([])
  const [ai, setAi] = useState<AiState>(() => (snap.aiIds?.length ? { status: 'done', ids: snap.aiIds, error: '' } : AI_IDLE))
  // 받은 AI 코스는 계속 보관 — 다시 만들어도 저장한 코스가 사라지지 않게
  const [aiPool, setAiPool] = useState<Record<string, Course>>(() => Object.fromEntries([...savedInit, ...(snap.pool ?? [])].map((c) => [c.id, c])))
  const aiAbort = useRef<AbortController | null>(null)

  // 저장한 코스 목록 — 이 기기에 기록하고 홈 '저장' 탭에도 보여준다
  const savedCourses = useMemo(
    () => saved.map((id) => aiPool[id] || COURSES.find((c) => c.id === id)).filter(Boolean) as Course[],
    [saved, aiPool],
  )
  useEffect(() => {
    store.savedCourses.set(savedCourses)
  }, [savedCourses])

  // 로그인하면 DB에 저장해 둔 코스를 가져와 합침
  useEffect(() => {
    if (!token) return
    fetchSavedCourses(token)
      .then((list) => {
        setAiPool((p) => ({ ...p, ...Object.fromEntries(list.map((c) => [c.id, c])) }))
        setSaved((s) => [...s, ...list.map((c) => c.id).filter((id) => !s.includes(id))])
      })
      .catch((e: Error) => console.error('[saved]', e.message))
  }, [token])

  const generateAi = () => {
    aiAbort.current?.abort()
    const ctrl = new AbortController()
    aiAbort.current = ctrl
    setAi((s) => ({ ...s, status: 'loading', error: '' }))
    fetchAiCourses(
      { taste: taste.effTaste, tags: taste.effTags, intent: taste.intent, picked: taste.picked, cond, time_window: { start: taste.range[0], end: taste.range[1] } },
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
  useEffect(() => () => aiAbort.current?.abort(), [])

  // 받은 AI 코스 전체 + 고정 코스 (저장 탭·상세 열기용 + AI 실패 시 fallback)
  const builtAll: BuiltCourse[] = useMemo(
    () => [...Object.values(aiPool), ...COURSES].map((c) => build(c, { taste: taste.effTaste, tags: taste.effTags, intent: taste.intent, people: cond.people, booked })),
    [aiPool, taste.effTaste, taste.effTags, taste.intent, cond.people, booked],
  )
  // 검색 목록: 이번에 만든 AI 코스 (만드는 중이거나 실패했으면 화면이 비어 보이지 않게 고정 코스로 대체)
  const built: BuiltCourse[] = useMemo(() => {
    if (ai.status === 'error' || ai.status === 'loading') return builtAll.filter((c) => FIXED_IDS.has(c.id))
    return ai.ids.map((id) => builtAll.find((c) => c.id === id)).filter(Boolean) as BuiltCourse[]
  }, [builtAll, ai.ids, ai.status])
  const byId = (id: string | null) => builtAll.find((c) => c.id === id) || null

  const toggleSave = (id: string) => {
    const on = saved.indexOf(id) < 0
    setSaved((s) => (on ? s.concat([id]) : s.filter((x) => x !== id)))
    toast(on ? '저장한 코스에 담았어요' : '저장을 취소했어요')
    const course = aiPool[id]
    if (token && course?.shareable) {
      (on ? putSavedCourse(token, id) : deleteSavedCourse(token, id))
        .catch((e: Error) => console.error('[saved]', e.message)) // 서버 저장이 안 돼도 이 기기엔 남아 있음
    }
  }

  const aiIds = ai.status === 'done' ? ai.ids : []
  const snapshot: CoursesSnapshot = { cond, aiIds, pool: aiIds.map((id) => aiPool[id]).filter(Boolean) }

  return {
    cond, setCond, ai, generateAi, built, filtered: built.filter((c) => matchCond(c, cond)),
    byId, savedCourses, saved,
    savedBuilt: saved.map((id) => builtAll.find((c) => c.id === id)).filter(Boolean) as BuiltCourse[],
    isSaved: (id: string) => saved.indexOf(id) > -1,
    toggleSave,
    booked,
    toggleBook: (key: string) => setBooked((b) => (b.indexOf(key) > -1 ? b.filter((x) => x !== key) : b.concat([key]))),
    /** 서버 저장된(공유 가능한) 코스면 공유 주소, 아니면 '' */
    shareUrl: (id: string) => (aiPool[id]?.shareable ? `${window.location.origin}/course/${encodeURIComponent(id)}` : ''),
    /** 가진 적 없는 코스(공유 링크·새로고침) — 서버에서 받아 보관. 실패하면 reject */
    fetchMissing: (id: string) => fetchCourse(id).then((c) => setAiPool((p) => ({ ...p, [c.id]: c }))),
    /** 분석 결과의 인원·예산을 조건에 반영 */
    applyReport: (r: Report) => setCond((c) => ({ ...c, people: r.party, budget: r.budgetBand })),
    /** 새로고침 대비 세션에 남길 값 */
    snapshot,
    /** 조건·AI 코스를 처음 상태로 (저장한 코스는 그대로) */
    reset: () => { aiAbort.current?.abort(); setAi(AI_IDLE); setCond({ ...DEFAULT_COND }) },
  }
}
