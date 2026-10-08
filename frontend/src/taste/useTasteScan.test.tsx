// 취향 분석 흐름 — 데이터 고르기 → 분석 → 결과, 취소·실패 처리
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTasteScan } from './useTasteScan'
import { analyzeTaste } from '../planner/api'
import type { AuthState } from '../auth/AuthScreen'
import type { Report } from '../planner/logic'

vi.mock('../planner/api', async (orig) => ({ ...(await orig<typeof import('../planner/api')>()), analyzeTaste: vi.fn() }))
vi.mock('../planner/photoMeta', () => ({
  keepReadable: async (files: File[]) => ({ ok: files, bad: [] }),
  readPhotos: async (files: File[]) => files.map(() => ({ ts: null, lat: null, lng: null, b64: '' })),
}))

let path = ''
function Probe() { path = useLocation().pathname; return null }
const wrapper = ({ children }: { children: ReactNode }) => (
  <MemoryRouter initialEntries={['/start']}>{children}<Probe /></MemoryRouter>
)
const AUTH = { mode: 'login', name: '', email: '', pw: '', error: '', user: null, token: 'tok', skipped: false } as AuthState
const photo = new File(['x'], 'a.jpg', { type: 'image/jpeg' })

function setup() {
  const onReport = vi.fn<(r: Report) => void>()
  const hook = renderHook(() => useTasteScan({
    entry: { yt: null, ytError: null }, snap: {}, auth: AUTH, restoreAuth: () => {}, onReport,
  }), { wrapper })
  return { ...hook, onReport }
}

/** 사진만 골라 분석 시작 (유튜브는 끔) */
async function startWithPhoto(r: ReturnType<typeof setup>['result']) {
  act(() => r.current.setSources({ youtube: false, photos: false }))
  act(() => r.current.onPickPhotos([photo]))
  await waitFor(() => expect(r.current.sources.photos).toBe(true))
  act(() => r.current.startScan())
}

beforeEach(() => {
  path = ''
  // 움직임 줄이기 — '분석 중' 화면 최소 노출 시간(1.3초)을 건너뛴다
  window.matchMedia = ((q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} })) as never
  vi.mocked(analyzeTaste).mockReset()
})

describe('useTasteScan', () => {
  it('아무 데이터도 안 고르면 시작하지 않는다', () => {
    const { result } = setup()
    act(() => result.current.setSources({ youtube: false, photos: false }))
    act(() => result.current.startScan())
    expect(result.current.scanning).toBe(false)
    expect(path).toBe('/start')
  })

  it('사진으로 분석 → 결과 보기 → 요약 화면 (인원·예산은 onReport로 넘긴다)', async () => {
    vi.mocked(analyzeTaste).mockRejectedValue(new Error('서버 잠듦'))
    const { result, onReport } = setup()
    await startWithPhoto(result)
    expect(path).toBe('/analyze')
    expect(result.current.scanning).toBe(true)

    await waitFor(() => expect(result.current.scanReady).not.toBeNull())
    act(() => result.current.showResult())
    await waitFor(() => expect(path).toBe('/result'))
    expect(result.current.scanning).toBe(false)
    expect(onReport).toHaveBeenCalledOnce()
    // 서버 분석 실패 + 유튜브 없음 → '유튜브로 맞췄다'고 하지 않는다
    expect(result.current.report?.notice).toContain('기본 취향')
  })

  it('분석 중 취소하면 늦게 끝난 분석이 화면을 넘기지 못한다', async () => {
    let finish: (v: null) => void = () => {}
    vi.mocked(analyzeTaste).mockReturnValue(new Promise((r) => { finish = r as never }) as never)
    const { result, onReport } = setup()
    await startWithPhoto(result)
    act(() => result.current.cancelScan())
    expect(path).toBe('/start')
    await act(async () => { finish(null); await new Promise((r) => setTimeout(r, 400)) })
    expect(result.current.scanReady).toBeNull()
    expect(onReport).not.toHaveBeenCalled()
    expect(path).toBe('/start')
  })

  it('시간대 막대를 움직이면 취향의 시간대도 바뀐다', () => {
    const { result } = setup()
    act(() => result.current.setHourRange([19, 22]))
    expect(result.current.range).toEqual([19, 22])
    expect(result.current.taste.hour).toBe('night')
  })

  it('skip은 기본 취향, reset은 분석 결과를 비운다', () => {
    const { result } = setup()
    act(() => result.current.skip())
    expect(result.current.taste.mood).toBe('calm')
    act(() => result.current.reset())
    expect(result.current.taste).toEqual({})
    expect(result.current.report).toBeNull()
  })
})
