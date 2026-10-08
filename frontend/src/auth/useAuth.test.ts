import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuth } from './useAuth'
import { fetchMe, updateMe } from '../planner/api'

vi.mock('../planner/api', async (orig) => ({
  ...(await orig<typeof import('../planner/api')>()),
  fetchMe: vi.fn(),
  updateMe: vi.fn(),
}))

const NO_ENTRY = { loginToken: null, loginError: null }
const ME = { nickname: '수빈', email: 'a@b.c', avatar_url: null, provider: 'kakao' }

beforeEach(() => {
  vi.mocked(fetchMe).mockReset().mockResolvedValue(ME as never)
  vi.mocked(updateMe).mockReset()
})

describe('useAuth', () => {
  it('저장된 토큰이 없으면 로그아웃 상태로 시작하고 서버에 묻지 않는다', () => {
    const { result } = renderHook(() => useAuth(NO_ENTRY))
    expect(result.current.authed).toBe(false)
    expect(fetchMe).not.toHaveBeenCalled()
  })

  it('저장된 토큰으로 사용자 정보를 채우고 마지막 로그인 제공자를 기록한다', async () => {
    localStorage.setItem('nolda:login-token', 'tok')
    const { result } = renderHook(() => useAuth(NO_ENTRY))
    expect(result.current.authed).toBe(true) // 확인 전에도 로그인으로 친다
    await waitFor(() => expect(result.current.auth.user?.name).toBe('수빈'))
    expect(localStorage.getItem('nolda:last-login-provider')).toBe('kakao')
  })

  it('?login_error 코드는 사람이 읽을 문구로', () => {
    const { result } = renderHook(() => useAuth({ loginToken: null, loginError: 'cancelled' }))
    expect(result.current.loginError).toBe('카카오 로그인을 취소했어요.')
    act(() => result.current.clearLoginError())
    expect(result.current.loginError).toBeNull()
  })

  it('logout — 토큰을 지우고 로그아웃 상태로', async () => {
    localStorage.setItem('nolda:login-token', 'tok')
    const { result } = renderHook(() => useAuth(NO_ENTRY))
    await waitFor(() => expect(result.current.auth.user).not.toBeNull())
    act(() => result.current.logout())
    expect(result.current.authed).toBe(false)
    expect(localStorage.getItem('nolda:login-token')).toBeNull()
  })

  it('rename — 로그인 안 했으면 안내 문구, 실패하면 서버 메시지', async () => {
    const { result } = renderHook(() => useAuth(NO_ENTRY))
    expect(await result.current.rename('새 이름')).toBe('로그인이 필요해요')

    localStorage.setItem('nolda:login-token', 'tok')
    const { result: r2 } = renderHook(() => useAuth(NO_ENTRY))
    vi.mocked(updateMe).mockRejectedValue(new Error('이름이 너무 길어요'))
    expect(await r2.current.rename('새 이름')).toBe('이름이 너무 길어요')
  })
})
