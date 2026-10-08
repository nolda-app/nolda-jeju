// 로그인 후 돌아갈 경로 — 소셜 로그인은 페이지를 새로 열어서 화면 상태가 사라지므로 저장해 둔다
import { store } from '../app/storage'

export const rememberAfterLogin = (path: string) => store.afterLogin.set(path)

/** 기억해 둔 경로 (없으면 분석 시작 화면) */
export const afterLoginPath = () => {
  const p = store.afterLogin.get()
  return p?.startsWith('/') ? p : '/start'
}
