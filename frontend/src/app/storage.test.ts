import { afterEach, describe, expect, it, vi } from 'vitest'
import { store } from './storage'

afterEach(() => vi.restoreAllMocks())

describe('store', () => {
  it('문자열 — 쓰고 읽고 null로 지운다', () => {
    store.loginToken.set('tok')
    expect(localStorage.getItem('nolda:login-token')).toBe('tok')
    expect(store.loginToken.get()).toBe('tok')
    store.loginToken.set(null)
    expect(store.loginToken.get()).toBeNull()
  })

  it('JSON — 깨진 값은 없는 것으로', () => {
    store.recentSearch.set(['애월'])
    expect(store.recentSearch.get()).toEqual(['애월'])
    localStorage.setItem('nolda:recent-search', '{깨짐')
    expect(store.recentSearch.get()).toBeNull()
  })

  it('local과 session을 섞지 않는다', () => {
    store.afterLogin.set('/saved')
    expect(sessionStorage.getItem('nolda:after-login')).toBe('/saved')
    expect(localStorage.getItem('nolda:after-login')).toBeNull()
  })

  it('저장소가 막혀 있어도(사파리 사생활 보호 등) 앱이 죽지 않는다', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError') })
    expect(store.loginToken.get()).toBeNull()
    expect(store.session.get()).toBeNull()
    expect(() => store.savedCourses.set([])).not.toThrow()
  })
})
