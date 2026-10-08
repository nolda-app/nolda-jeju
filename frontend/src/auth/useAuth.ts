// 로그인 상태 — 토큰·사용자 정보는 이 hook 안에서만 바뀐다.
// 화면은 필요한 함수만 받는다: 분석·코스 화면은 logout을 받지 않으므로 '뒤로' 버튼이 로그인을 풀 수 없다.
import { useEffect, useRef, useState } from 'react'
import { fetchMe, updateMe } from '../planner/api'
import type { AuthFailure } from '../planner/api'
import { store } from '../app/storage'
import type { AuthState } from './AuthScreen'

const LOGGED_OUT: AuthState = { mode: 'login', name: '', email: '', pw: '', error: '', user: null, token: null, skipped: false }
// 'cancelled'·'access_denied'는 카카오가 주는 짧은 코드, 그 외엔 백엔드가 보낸 실제 에러 문장
const KNOWN_ERRORS: Record<string, string> = { cancelled: '카카오 로그인을 취소했어요.', access_denied: '카카오 로그인을 취소했어요.' }

/** entry: 소셜 로그인 리디렉션으로 돌아온 주소의 값 (?login_token / ?login_error) */
export function useAuth(entry: { loginToken: string | null; loginError: string | null }) {
  const [auth, setAuthState] = useState<AuthState>(() => ({
    ...LOGGED_OUT,
    // 저장된 토큰을 처음부터 들고 시작한다. 서버 확인(fetchMe)이 늦거나 실패해도
    // 그동안 로그인 화면이 뜨지 않게 하려는 것 — 확인되면 user가 채워진다
    token: entry.loginToken || store.loginToken.get(),
  }))
  // 소셜 로그인에서 리디렉션으로 돌아왔는데 실패했을 때 보여줄 전용 화면 (폼 안 작은 에러 문구랑 별개)
  const [loginError, setLoginError] = useState<string | null>(null)
  const setAuth = (o: Partial<AuthState>) => setAuthState((st) => ({ ...st, ...o }))

  // 소셜 로그인에서 돌아왔을 때(?login_token=) 또는 새로고침 시 저장해둔 토큰으로 로그인 상태 복원.
  // StrictMode가 effect를 두 번 돌려도 한 번만
  const handled = useRef(false)
  useEffect(() => {
    if (handled.current) return
    handled.current = true
    const fresh = entry.loginToken, err = entry.loginError
    if (err) {
      setLoginError(KNOWN_ERRORS[err] || err)
      return
    }
    const token = fresh || store.loginToken.get()
    if (!token) return
    fetchMe(token)
      .then((me) => {
        store.loginToken.set(token)
        store.lastProvider.set(me.provider)
        setAuth({ user: { name: me.nickname || '게스트', email: me.email || '', avatar: me.avatar_url }, token, error: '' })
      })
      .catch((e: AuthFailure) => {
        // 토큰이 만료·폐기됐을 때(401·404)만 지운다.
        // 서버가 꺼져 있거나 네트워크가 끊긴 것뿐인데 지우면 멀쩡한 로그인이 날아간다
        if (e.status === 401 || e.status === 403 || e.status === 404) {
          store.loginToken.set(null)
          setAuth({ token: null }) // 상태에서도 빼야 로그인 화면이 다시 나온다
        }
        if (fresh) setLoginError('로그인 확인에 실패했어요. 다시 시도해 주세요.') // 방금 막 돌아왔는데 토큰이 안 먹히면 서버 쪽 문제
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    auth,
    /** 로그인 화면 폼 입력용 (모드·에러 문구 등) */
    setAuth,
    // 토큰이 있으면 로그인한 사람이다. 서버가 자고 있어(무료 플랜은 15분 뒤 잠든다)
    // 확인이 늦어도 로그인 화면으로 튕기지 않는다. 토큰이 실제로 죽었을 때만 위에서 지운다
    authed: !!auth.user || auth.skipped || !!auth.token,
    loginError,
    clearLoginError: () => setLoginError(null),
    /** 유튜브 동의로 페이지를 떠났다 돌아왔을 때, 떠나기 전 로그인 상태를 되살린다 */
    restore: (a: AuthState) => setAuthState(a),
    /** 토큰을 지우고 로그아웃 상태로 — 분석 상태·유튜브 연동 정리는 부르는 쪽이 함께 한다 */
    logout: () => {
      store.loginToken.set(null)
      setAuthState(LOGGED_OUT)
    },
    /** 마이페이지 이름·사진 저장 — 실패하면 문구를 돌려준다 */
    rename: async (nickname: string, avatar?: string): Promise<string | null> => {
      if (!auth.token) return '로그인이 필요해요'
      try {
        const me = await updateMe(auth.token, nickname, avatar)
        setAuth({ user: { name: me.nickname || '게스트', email: me.email || '', avatar: me.avatar_url } })
        return null
      } catch (e) {
        return (e as Error).message
      }
    },
  }
}
