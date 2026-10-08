// 로그인 화면 · 소셜 로그인 리디렉션 실패 화면
import { useState } from 'react'
import { googleLoginUrl, kakaoLoginUrl } from '../planner/api'
import { store } from '../app/storage'

export interface AuthState {
  mode: 'login' | 'signup'
  name: string
  email: string
  pw: string
  error: string
  user: { name: string; email: string; avatar?: string | null } | null
  token: string | null
  skipped: boolean
}

/* ── 로그인 / 회원가입 ─────────────────────────────────────── */
export function AuthScreen({ auth, setAuth, goHome }: {
  auth: AuthState
  setAuth: (o: Partial<AuthState>) => void
  goHome: () => void
}) {
  // 이메일·비밀번호 자체 로그인/회원가입 기능은 아직 백엔드가 없어 임시로 주석 처리.
  // 자세한 내용과 재활성화 방법은 docs/deferred-email-password-login.md 참고
  const signup = auth.mode === 'signup'
  // 지난번에 성공적으로 로그인했던 소셜 제공자 — 토큰이 만료돼 다시 로그인해야 할 때도 안내용으로 남아있음
  const [lastProvider] = useState(() => store.lastProvider.get())
  const socials = [
    { key: 'kakao', l: '카카오로 계속하기', mark: 'K', bg: '#FEE500', bd: '#FEE500', fg: '#191600', dot: 'rgba(0,0,0,.82)', dotFg: '#FEE500' },
    { key: 'google', l: 'Google로 계속하기', mark: 'G', bg: '#fff', bd: 'rgba(20,24,33,.12)', fg: '#2c3444', dot: 'rgba(20,24,33,.06)', dotFg: '#2c3444' },
  ]
  return (
    <div className="pl-screen">
      <button type="button" className="pl-backhome" onClick={goHome} aria-label="홈으로">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M3 10.5 12 3l9 7.5M5.5 9.5V20h13V9.5M9.5 20v-6h5v6" />
        </svg>
      </button>
      <div className="pl-scroll pl-authbody" style={{ padding: '24px 26px 20px' }}>
        <div className="pl-vfill" />
        <div className="pl-badge">
          <div className="pl-badge-t">NOLDA</div>
          <div className="pl-badge-s">놀다</div>
        </div>
        <div className="pl-h1" style={{ whiteSpace: 'pre-line' }}>
          {/* 이 기기를 처음 쓰는지로는 '이 사람이 처음인지'를 알 수 없다
              (기기를 같이 쓰거나 새 기기로 오면 틀린다) — 양쪽 다 맞는 인사로 둔다 */}
          {'반가워요!\n오늘은 뭐 하고 놀까요'}
        </div>
        <div className="pl-sub">
          {signup ? '가입하면 저장한 코스와 취향이 기기 간에 따라와요.' : '이메일로 로그인하면 저장한 코스가 그대로 있어요.'}
        </div>

        {/* 이메일·비밀번호 로그인은 아직 구현 전이라 임시로 주석 처리. 소셜 로그인·게스트 이용만 우선 제공 */}
        {/*
        <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 11 }}>
          {signup && (
            <Field label="이름" value={auth.name} onChange={(v) => setAuth({ name: v, error: '' })} placeholder="어떻게 부를까요?" />
          )}
          <Field label="이메일" value={auth.email} onChange={(v) => setAuth({ email: v, error: '' })} placeholder="you@example.com" borderColor={emailBd} type="email" />
          <Field label="비밀번호" value={auth.pw} onChange={(v) => setAuth({ pw: v, error: '' })} placeholder="8자 이상" borderColor={pwBd} type="password" />
          {auth.error && <div className="pl-error">{auth.error}</div>}
        </div>

        <div className="pl-cta" onClick={submitAuth}>{signup ? '가입하고 시작하기' : '로그인'}</div>
        */}
        {auth.error && <div className="pl-error" style={{ marginTop: 28 }}>{auth.error}</div>}

        <div className="pl-divider" style={{ marginTop: auth.error ? 22 : 40 }}><span /><span className="pl-divider-l">간편하게</span><span /></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {socials.map((p) => (
            <div key={p.key} className="pl-social" style={{ background: p.bg, border: `1px solid ${p.bd}`, position: 'relative' }}
              onClick={() => {
                try { window.location.href = p.key === 'kakao' ? kakaoLoginUrl() : googleLoginUrl() } catch (e) { setAuth({ error: (e as Error).message }) }
              }}>
              {p.key === lastProvider && <span className="pl-last-chip">마지막으로 로그인했어요</span>}
              <span className="pl-social-dot" style={{ background: p.dot, color: p.dotFg }}>{p.mark}</span>
              <span style={{ color: p.fg, fontWeight: 600, fontSize: 14.5 }}>{p.l}</span>
            </div>
          ))}
        </div>
        <div className="pl-switch-acct" onClick={() => {
          try { window.location.href = googleLoginUrl(true) } catch (e) { setAuth({ error: (e as Error).message }) }
        }}>다른 구글 계정으로 로그인</div>
        <div className="pl-skip" onClick={() => {
          setAuth({ skipped: true })
        }}>로그인 없이 둘러보기</div>
        <div className="pl-vfill" />
      </div>
      {/* 이메일 회원가입/로그인 전환 링크 — 위 폼과 함께 임시로 주석 처리 (지우지 않고 보존) */}
      {/*
      <div className="pl-authfoot">
        <span style={{ color: 'rgba(20,24,33,.5)' }}>{signup ? '이미 계정이 있나요? ' : '처음이신가요? '}</span>
        <span className="pl-link" onClick={() => setAuth({ mode: signup ? 'login' : 'signup', error: '' })}>{signup ? '로그인' : '회원가입'}</span>
      </div>
      */}
    </div>
  )
}

/* ── 소셜 로그인 리디렉션 실패 ─────────────────────────────── */
export function LoginErrorScreen({ message, goHome }: { message: string; goHome: () => void }) {
  return (
    <div className="pl-screen">
      <div className="pl-scroll" style={{ padding: '48px 26px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
        <div className="pl-badge">
          <div className="pl-badge-t">NOLDA</div>
          <div className="pl-badge-s">놀다</div>
        </div>
        <div style={{
          marginTop: 36, width: 56, height: 56, borderRadius: '50%', background: 'rgba(224,87,74,.12)', color: '#e0574a',
          display: 'flex', alignItems: 'center', justifyContent: 'center', font: '800 26px/1 Pretendard,sans-serif',
        }}>!</div>
        <div className="pl-h1" style={{ marginTop: 20, fontSize: 22 }}>로그인에 실패했어요</div>
        <div className="pl-sub" style={{ marginTop: 10 }}>{message}</div>
        <div className="pl-cta" style={{ marginTop: 28, width: '100%' }} onClick={goHome}>홈으로 돌아가기</div>
      </div>
    </div>
  )
}

// 이메일·비밀번호 로그인 폼(AuthScreen)에서만 쓰던 입력 컴포넌트. 폼을 임시로 주석 처리하면서 함께 비활성화
// function Field({ label, value, onChange, placeholder, borderColor, type = 'text' }: {
//   label: string; value: string; onChange: (v: string) => void; placeholder: string; borderColor?: string; type?: string
// }) {
//   return (
//     <div>
//       <div className="pl-field-label">{label}</div>
//       <input
//         type={type} value={value} placeholder={placeholder}
//         onChange={(e) => onChange(e.target.value)}
//         className="pl-input" style={{ borderColor: borderColor || 'rgba(20,24,33,.1)' }}
//       />
//     </div>
//   )
// }
