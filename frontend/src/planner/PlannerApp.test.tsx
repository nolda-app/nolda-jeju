// 경로 → 화면, 로그인 가드, 토큰 처리 — 구조를 바꿔도 이 동작은 그대로여야 한다
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PlannerApp from './PlannerApp'
import { AuthFailure, fetchMe } from './api'
import { analyzeYoutubeOnly } from './logic'
import { COURSES } from './data'

vi.mock('./api', async (orig) => ({
  ...(await orig<typeof import('./api')>()),
  fetchMe: vi.fn(),
  fetchSavedCourses: vi.fn(() => Promise.resolve([])),
  fetchAiCourses: vi.fn(() => new Promise(() => {})), // 끝나지 않음 — 생성 중 화면을 본다
  fetchCourse: vi.fn(() => Promise.reject(new Error('없음'))),
}))
vi.mock('./geo', async (orig) => ({ ...(await orig<typeof import('./geo')>()), loadPlaces: () => Promise.resolve() }))

const TOKEN_KEY = 'nolda:login-token'
const ME = { nickname: '수빈', email: '', avatar_url: null, provider: 'kakao' }

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>
}

function open(path: string) {
  // 소셜 로그인 복귀처럼 페이지 주소(?login_token)를 읽는 경우가 있어 실제 주소도 맞춘다
  window.history.replaceState(null, '', path)
  return render(<MemoryRouter initialEntries={[path]}><PlannerApp /><Where /></MemoryRouter>)
}
const where = () => screen.getByTestId('where').textContent

beforeEach(() => {
  sessionStorage.setItem('nolda:splashed', '1') // 로고 화면은 건너뛴다
  vi.mocked(fetchMe).mockReset().mockResolvedValue(ME as never)
})
const login = () => localStorage.setItem(TOKEN_KEY, 'tok')

describe('경로별 화면', () => {
  it('홈', async () => {
    open('/')
    expect(await screen.findByText('오늘의 추천 코스')).toBeInTheDocument()
  })

  it('모르는 주소는 홈으로', async () => {
    login()
    open('/nope')
    await waitFor(() => expect(where()).toBe('/'))
  })

  it('/start — 데이터 고르기', async () => {
    login()
    open('/start')
    expect(await screen.findByText('취향 유형 테스트')).toBeInTheDocument()
  })

  it('/analyze 새로고침 — 분석이 안 돌고 있으면 결과가 없을 때 /start로', async () => {
    login()
    open('/analyze')
    await waitFor(() => expect(where()).toBe('/start'))
  })

  it('/result — 세션에 남은 분석 결과로 다시 그린다', async () => {
    login()
    sessionStorage.setItem('nolda:session', JSON.stringify({ report: analyzeYoutubeOnly(null), done: false }))
    open('/result')
    expect(await screen.findByText('이런 취향이 보여요')).toBeInTheDocument()
  })

  it('/result — 결과가 없으면 /start로', async () => {
    login()
    open('/result')
    await waitFor(() => expect(where()).toBe('/start'))
  })

  it('옛 공유 링크(?course=id)는 /course/:id로 바꿔 로그인 없이 코스를 연다', async () => {
    open(`/?course=${COURSES[1].id}`)
    await waitFor(() => expect(where()).toBe(`/course/${COURSES[1].id}`))
    expect(await screen.findByText(COURSES[1].title)).toBeInTheDocument()
  })

  it('/courses — AI 코스를 만드는 동안 기본 코스를 먼저 보여준다', async () => {
    login()
    open('/courses')
    expect(await screen.findByText('취향에 맞는 코스를 AI가 만들고 있어요')).toBeInTheDocument()
    expect(screen.getByText(COURSES[0].title)).toBeInTheDocument()
  })
})

describe('로그인', () => {
  it('로그인이 필요한 화면은 /login으로 보내고, 가려던 경로를 기억한다', async () => {
    open('/saved')
    expect(await screen.findByText('카카오로 계속하기')).toBeInTheDocument()
    expect(where()).toBe('/login')
    expect(sessionStorage.getItem('nolda:after-login')).toBe('/saved')
  })

  it('소셜 로그인 복귀(?login_token) — 기억해 둔 경로로 가고 토큰을 저장한다', async () => {
    sessionStorage.setItem('nolda:after-login', '/saved')
    open('/?login_token=fresh')
    await waitFor(() => expect(where()).toBe('/saved'))
    await waitFor(() => expect(localStorage.getItem(TOKEN_KEY)).toBe('fresh'))
    expect(fetchMe).toHaveBeenCalledWith('fresh')
  })

  it('토큰이 만료(401)됐으면 지우고 로그인 화면으로', async () => {
    login()
    vi.mocked(fetchMe).mockRejectedValue(Object.assign(new AuthFailure('만료'), { status: 401 }))
    open('/start')
    await waitFor(() => expect(where()).toBe('/login'))
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull()
  })

  it('서버가 꺼져 있을 뿐(네트워크 에러)이면 토큰을 지우지 않는다', async () => {
    login()
    vi.mocked(fetchMe).mockRejectedValue(new AuthFailure('Failed to fetch'))
    open('/start')
    expect(await screen.findByText('취향 유형 테스트')).toBeInTheDocument()
    await waitFor(() => expect(fetchMe).toHaveBeenCalled())
    expect(localStorage.getItem(TOKEN_KEY)).toBe('tok')
    expect(where()).toBe('/start')
  })
})
