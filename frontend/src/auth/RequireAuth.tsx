// 로그인해야 들어가는 화면들을 감싼다 — 로그인 전이면 가려던 경로를 기억해 두고 /login으로 보낸다
import { Navigate, Outlet, useLocation } from 'react-router'
import { rememberAfterLogin } from './afterLogin'

export function RequireAuth({ authed }: { authed: boolean }) {
  const { pathname } = useLocation()
  if (authed) return <Outlet />
  rememberAfterLogin(pathname)
  return <Navigate to="/login" replace />
}
