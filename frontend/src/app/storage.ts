// 브라우저 저장소 — 앱이 쓰는 키를 전부 여기 모은다. 값을 어디서 읽고 쓰는지 이 파일만 보면 된다.
// 저장소가 막혀 있어도(사파리 사생활 보호·저장 공간 없음) 읽기는 null, 쓰기는 조용히 무시해서 앱이 죽지 않게 한다.
// (유튜브 연동 중 잠깐 보관하는 사진 파일은 크기 때문에 IndexedDB를 쓴다 — planner/photoStash.ts)
import type { Course } from '../planner/data'
import type { AuthState } from '../auth/AuthScreen'
import type { Session } from '../planner/PlannerApp'
import type { Sources } from '../planner/logic'

type Area = 'local' | 'session'

function area(a: Area): Storage | null {
  try { return a === 'local' ? window.localStorage : window.sessionStorage } catch { return null }
}

/** 문자열 값 하나 */
function text(a: Area, key: string) {
  return {
    get(): string | null {
      try { return area(a)?.getItem(key) ?? null } catch { return null }
    },
    set(v: string | null) {
      try { if (v === null) area(a)?.removeItem(key); else area(a)?.setItem(key, v) } catch { /* 이번 세션만 유지 */ }
    },
  }
}

/** JSON 값 하나 — 깨진 값은 없는 것으로 */
function json<T>(a: Area, key: string) {
  const t = text(a, key)
  return {
    get(): T | null {
      const raw = t.get()
      if (raw === null) return null
      try { return JSON.parse(raw) as T } catch { return null }
    },
    set(v: T | null) { t.set(v === null ? null : JSON.stringify(v)) },
  }
}

export const store = {
  // ── 이 기기에 계속 남는 값 (localStorage)
  /** 소셜 로그인 성공 시 백엔드가 발급한 JWT — 새로고침해도 로그인 유지 */
  loginToken: text('local', 'nolda:login-token'),
  /** 마지막으로 로그인한 소셜 제공자 — 토큰이 만료돼도 "마지막으로 OO로 로그인했어요" 안내에 씀 */
  lastProvider: text('local', 'nolda:last-login-provider'),
  /** 유튜브 집계 결과 id — 한 번 연동하면 로그아웃 전까지 다시 구글을 거치지 않는다 */
  ytId: text('local', 'nolda:yt-id'),
  /** 저장한 코스(Course 전체) — 로그인 없이도 유지 */
  savedCourses: json<Course[]>('local', 'nolda:saved-courses'),
  /** 홈 검색 탭의 최근 검색어 */
  recentSearch: json<string[]>('local', 'nolda:recent-search'),

  // ── 이 탭에서만 남는 값 (sessionStorage)
  /** 로그인하러 갈 때 '끝나면 어느 경로로 돌아갈지' — 소셜 로그인은 페이지를 새로 열어서 저장이 필요하다 */
  afterLogin: text('session', 'nolda:after-login'),
  /** 유튜브 구글 동의로 페이지를 떠났다 돌아올 때 이어갈 로그인·데이터 선택 */
  ytPending: json<{ auth: AuthState; sources: Sources }>('session', 'nolda:yt-pending'),
  /** 분석 결과·만든 코스 목록 — 새로고침해도 같은 화면을 이어 그린다 */
  session: json<Partial<Session>>('session', 'nolda:session'),
  /** 로고 화면을 이미 봤는지 — 탭당 한 번만 */
  splashed: text('session', 'nolda:splashed'),
}
