import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCourses } from './useCourses'
import { deleteSavedCourse, fetchAiCourses, fetchCourse, fetchSavedCourses, putSavedCourse } from '../planner/api'
import { COURSES } from '../planner/data'
import type { Course } from '../planner/data'
import { analyzeYoutubeOnly } from '../planner/logic'

vi.mock('../planner/api', async (orig) => ({
  ...(await orig<typeof import('../planner/api')>()),
  fetchAiCourses: vi.fn(),
  fetchCourse: vi.fn(),
  fetchSavedCourses: vi.fn(),
  putSavedCourse: vi.fn(),
  deleteSavedCourse: vi.fn(),
}))

const TASTE = { effTaste: {}, effTags: [], intent: null, picked: [], range: [12, 15] as [number, number] }
const ai = (id: string): Course => ({ ...COURSES[0], id, title: `AI ${id}`, shareable: true })

function setup(token: string | null = null, snap = {}) {
  const toast = vi.fn()
  const hook = renderHook(() => useCourses({ snap, token, taste: TASTE, toast }))
  return { ...hook, toast }
}

beforeEach(() => {
  vi.mocked(fetchAiCourses).mockReset()
  vi.mocked(fetchCourse).mockReset()
  vi.mocked(fetchSavedCourses).mockReset().mockResolvedValue([])
  vi.mocked(putSavedCourse).mockReset().mockResolvedValue(undefined as never)
  vi.mocked(deleteSavedCourse).mockReset().mockResolvedValue(undefined as never)
})

describe('useCourses', () => {
  it('AI 코스를 만드는 중·실패 시엔 고정 코스를, 끝나면 AI 코스만 보여준다', async () => {
    let done: (v: Course[]) => void = () => {}
    vi.mocked(fetchAiCourses).mockReturnValue(new Promise((r) => { done = r }))
    const { result } = setup()
    act(() => result.current.generateAi())
    expect(result.current.ai.status).toBe('loading')
    expect(result.current.built).toHaveLength(COURSES.length)

    await act(async () => done([ai('a1'), ai('a2')]))
    expect(result.current.ai.status).toBe('done')
    expect(result.current.built.map((c) => c.id)).toEqual(['a1', 'a2'])

    vi.mocked(fetchAiCourses).mockRejectedValue(new Error('서버 오류'))
    await act(async () => result.current.generateAi())
    expect(result.current.ai).toMatchObject({ status: 'error', error: '서버 오류' })
    expect(result.current.built).toHaveLength(COURSES.length)
  })

  it('조건에 안 맞는 코스는 filtered에서 빠진다', () => {
    vi.mocked(fetchAiCourses).mockReturnValue(new Promise(() => {}))
    const { result } = setup(null, { aiIds: [], pool: [] })
    act(() => result.current.setCond((c) => ({ ...c, area: '없는 동네' })))
    act(() => result.current.generateAi()) // 만드는 중 → 고정 코스 목록
    expect(result.current.filtered).toEqual([])
  })

  it('저장 — 이 기기에 남기고, 로그인했고 공유 가능한 코스면 서버에도', async () => {
    vi.mocked(fetchAiCourses).mockResolvedValue([ai('a1')])
    const { result, toast } = setup('tok')
    await act(async () => result.current.generateAi())

    act(() => result.current.toggleSave('a1'))
    expect(result.current.isSaved('a1')).toBe(true)
    expect(toast).toHaveBeenLastCalledWith('저장한 코스에 담았어요')
    expect(putSavedCourse).toHaveBeenCalledWith('tok', 'a1')
    await waitFor(() => expect(JSON.parse(localStorage.getItem('nolda:saved-courses')!)[0].id).toBe('a1'))

    act(() => result.current.toggleSave('a1'))
    expect(result.current.isSaved('a1')).toBe(false)
    expect(deleteSavedCourse).toHaveBeenCalledWith('tok', 'a1')
  })

  it('고정 코스는 저장해도 서버로 보내지 않는다 (공유 불가)', () => {
    const { result } = setup('tok')
    act(() => result.current.toggleSave(COURSES[0].id))
    expect(result.current.isSaved(COURSES[0].id)).toBe(true)
    expect(putSavedCourse).not.toHaveBeenCalled()
  })

  it('로그인하면 서버에 저장해 둔 코스를 합친다', async () => {
    vi.mocked(fetchSavedCourses).mockResolvedValue([ai('srv')])
    const { result } = setup('tok')
    await waitFor(() => expect(result.current.isSaved('srv')).toBe(true))
    expect(result.current.byId('srv')?.title).toBe('AI srv')
  })

  it('처음 보는 코스 id는 서버에서 받아 보관한다', async () => {
    vi.mocked(fetchCourse).mockResolvedValue(ai('shared'))
    const { result } = setup()
    expect(result.current.byId('shared')).toBeNull()
    await act(async () => result.current.fetchMissing('shared'))
    expect(result.current.byId('shared')?.id).toBe('shared')
    expect(result.current.shareUrl('shared')).toMatch(/\/course\/shared$/)
  })

  it('분석 결과의 인원·예산을 조건에 넣고, reset은 조건·AI 코스만 되돌린다', () => {
    const { result } = setup()
    act(() => result.current.applyReport({ ...analyzeYoutubeOnly(null), party: 3, budgetBand: 30000 }))
    expect(result.current.cond).toMatchObject({ people: 3, budget: 30000 })
    act(() => result.current.toggleSave(COURSES[1].id))
    act(() => result.current.reset())
    expect(result.current.cond.people).toBe(2)
    expect(result.current.ai.status).toBe('idle')
    expect(result.current.isSaved(COURSES[1].id)).toBe(true) // 저장한 코스는 그대로
  })
})
