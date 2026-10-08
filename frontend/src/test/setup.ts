// 테스트 공통 준비 — jsdom에 없는 브라우저 기능을 채우고, 테스트마다 저장소를 비운다
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

if (!window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {},
    dispatchEvent: () => false,
  })
}
window.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }
window.scrollTo = () => {}
Element.prototype.scrollTo = () => {}

afterEach(() => {
  cleanup()
  localStorage.clear()
  sessionStorage.clear()
  window.history.replaceState(null, '', '/')
})
