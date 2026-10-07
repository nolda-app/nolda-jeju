// 홈 하단 탭에서 열리는 화면들 — 검색 / 카테고리 / 저장 / 마이페이지 + 장소 소개 팝업
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import KindThumb from './KindThumb'
import { fetchPlaceDetails } from './api'
import type { PlaceDetail } from './api'
import type { Place } from './geo'
import type { Course } from './data'

const RECENT_KEY = 'nolda:recent-search'
const RECENT_MAX = 8
const SUGGEST = ['애월', '함덕', '성산', '오름', '바다', '흑돼지']

export const KINDS = ['식사', '카페', '한잔', '체험', '문화', '산책', '운동']

function readRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') as string[] } catch { return [] }
}

function writeRecent(list: string[]) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)) } catch { /* 저장 공간 없음 — 이번 세션만 */ }
}

const Chevron = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="m9 5 7 7-7 7" />
  </svg>
)

/** 검색 결과·카테고리 결과에 공통으로 쓰는 한 줄 */
export function PlaceRow({ p, onPick }: { p: Place; onPick?: (p: Place) => void }) {
  return (
    <div className="pl-vrow" onClick={() => onPick?.(p)} role={onPick ? 'button' : undefined}>
      <div className="pl-vrow-thumb"><KindThumb kind={p.kind || ''} size={56} pid={p.id} /></div>
      <div className="pl-vrow-body">
        <div className="pl-vrow-name">{p.name}</div>
        <div className="pl-vrow-sub">{[p.kind, p.area].filter(Boolean).join(' · ')}</div>
        <div className="pl-vrow-addr">{p.addr.replace(/^제주(특별자치도)?\s*/, '')}</div>
      </div>
    </div>
  )
}

// ── 검색 ──────────────────────────────────────────────────
export function SearchView({ places, q, setQ, onPick }: {
  places: Place[]
  q: string
  setQ: (v: string) => void
  onPick: (p: Place) => void
}) {
  const [recent, setRecent] = useState<string[]>(readRecent)
  const query = q.trim()

  // 입력이 멈춘 뒤에 최근 검색어로 남긴다 — 글자마다 쌓이면 목록이 지저분해진다
  useEffect(() => {
    if (query.length < 2) return
    const t = setTimeout(() => {
      setRecent((prev) => {
        const next = [query, ...prev.filter((r) => r !== query)].slice(0, RECENT_MAX)
        writeRecent(next)
        return next
      })
    }, 900)
    return () => clearTimeout(t)
  }, [query])

  const results = useMemo(() => {
    if (!query) return []
    return places.filter((p) => p.name.includes(query) || (p.area || '').includes(query) || p.addr.includes(query)).slice(0, 40)
  }, [places, query])

  const drop = (r: string) => setRecent((prev) => {
    const next = prev.filter((x) => x !== r)
    writeRecent(next)
    return next
  })

  if (!query) {
    return (
      <div className="pl-home-pad">
        {!!recent.length && (
          <>
            <div className="pl-vhead">
              최근 검색어
              <button type="button" className="pl-home-reset" onClick={() => { setRecent([]); writeRecent([]) }}>전체 삭제</button>
            </div>
            <div className="pl-chips">
              {recent.map((r) => (
                <span key={r} className="pl-chip" onClick={() => setQ(r)}>
                  {r}
                  <button type="button" onClick={(e) => { e.stopPropagation(); drop(r) }} aria-label={`${r} 삭제`}>✕</button>
                </span>
              ))}
            </div>
          </>
        )}
        <div className="pl-vhead" style={{ marginTop: recent.length ? 24 : 4 }}>이런 건 어때요</div>
        <div className="pl-chips">
          {SUGGEST.map((w) => <span key={w} className="pl-chip" onClick={() => setQ(w)}>{w}</span>)}
        </div>
      </div>
    )
  }

  return (
    <div className="pl-home-pad">
      <div className="pl-vhead">검색 결과 <span className="pl-vcount">{results.length}</span></div>
      {results.length
        ? results.map((p) => <PlaceRow key={p.id} p={p} onPick={onPick} />)
        : <div className="pl-home-empty">‘{query}’와 맞는 장소가 없어요</div>}
    </div>
  )
}

// ── 카테고리 ──────────────────────────────────────────────
export function CategoryView({ places, kind, setKind, onPick }: {
  places: Place[]
  kind: string | null
  setKind: (k: string | null) => void
  onPick: (p: Place) => void
}) {
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of places) m.set(p.kind || '기타', (m.get(p.kind || '기타') || 0) + 1)
    return m
  }, [places])

  if (!kind) {
    return (
      <div className="pl-home-pad">
        <div className="pl-vhead">어떤 걸 찾으세요?</div>
        <div className="pl-catgrid">
          {KINDS.map((k) => (
            <button key={k} type="button" className="pl-cattile" onClick={() => setKind(k)}>
              <KindThumb kind={k} size={44} />
              <div className="pl-cattile-body">
                <div className="pl-cattile-name">{k}</div>
                <div className="pl-cattile-n">{counts.get(k) || 0}곳</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    )
  }

  const list = places.filter((p) => p.kind === kind).slice(0, 40)
  return (
    <div className="pl-home-pad">
      <div className="pl-vhead">
        <button type="button" className="pl-vback" onClick={() => setKind(null)} aria-label="카테고리 목록으로">‹</button>
        {kind} <span className="pl-vcount">{counts.get(kind) || 0}</span>
      </div>
      {list.length
        ? list.map((p) => <PlaceRow key={p.id} p={p} onPick={onPick} />)
        : <div className="pl-home-empty">아직 등록된 곳이 없어요</div>}
    </div>
  )
}

// ── 저장 ──────────────────────────────────────────────────
export function SavedView({ courses, onOpen, onStart }: {
  courses: Course[]
  onOpen: () => void
  onStart: () => void
}) {
  if (!courses.length) {
    return (
      <div className="pl-home-pad">
        <div className="pl-vempty">
          <div className="pl-vempty-mark" aria-hidden>
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
              <path d="M6.5 3.5h11v17l-5.5-4-5.5 4v-17Z" />
            </svg>
          </div>
          <div className="pl-vempty-t">저장한 코스가 없어요</div>
          <div className="pl-vempty-s">마음에 드는 코스를 저장하면 여기에 모여요</div>
          <button type="button" className="pl-home-cta" style={{ marginTop: 20 }} onClick={onStart}>코스 만들러 가기</button>
        </div>
      </div>
    )
  }

  return (
    <div className="pl-home-pad">
      <div className="pl-vhead">저장한 코스 <span className="pl-vcount">{courses.length}</span></div>
      {courses.map((c) => (
        <div key={c.id} className="pl-vrow" onClick={onOpen}>
          <div className="pl-vrow-thumb"><KindThumb kind={c.items[0]?.k || ''} size={56} pid={c.items[0]?.pid} /></div>
          <div className="pl-vrow-body">
            <div className="pl-vrow-name">{c.title}</div>
            <div className="pl-vrow-sub">{c.area} · 장소 {c.items.length}곳</div>
            <div className="pl-vrow-addr">{c.items.map((i) => i.n).join(' → ')}</div>
          </div>
          <span className="pl-vrow-go"><Chevron /></span>
        </div>
      ))}
    </div>
  )
}

// ── 마이페이지 ────────────────────────────────────────────
export function MyView({ authed, userName, avatar, savedCount, onLogin, onSaved, onStart, onRename, onLogout, soon }: {
  authed: boolean
  userName: string
  avatar: string | null
  savedCount: number
  onLogin: () => void
  onSaved: () => void
  onStart: () => void
  /** 이름·사진 저장 — 실패하면 문구를 돌려준다. 사진을 안 넘기면 그대로 둔다 */
  onRename: (name: string, avatar?: string) => Promise<string | null>
  onLogout: () => void
  soon: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [confirmOut, setConfirmOut] = useState(false)
  // undefined = 사진 안 건드림, '' = 기본 아바타로 되돌림, 그 외 = 새 사진
  const [draftAvatar, setDraftAvatar] = useState<string | undefined>(undefined)
  const fileRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(userName)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const name = authed ? (userName || '놀다 이용자') : '로그인이 필요해요'
  const shownAvatar = draftAvatar === undefined ? avatar : (draftAvatar || null)

  const open = () => { setDraft(userName); setDraftAvatar(undefined); setErr(''); setEditing(true) }
  const pick = async (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith('image/')) return setErr('이미지 파일만 올릴 수 있어요')
    try {
      setDraftAvatar(await toAvatarDataUrl(file))
      setErr('')
    } catch {
      setErr('이 사진은 읽지 못했어요. 다른 사진을 골라주세요')
    }
  }
  const save = async () => {
    setSaving(true)
    const msg = await onRename(draft, draftAvatar)
    setSaving(false)
    if (msg) return setErr(msg)
    setEditing(false)
  }
  const menu = [
    { l: '저장한 코스', v: `${savedCount}개`, go: onSaved },
    { l: '취향 다시 분석하기', v: '', go: onStart },
    { l: '알림 설정', v: '', go: soon },
    { l: '공지사항', v: '', go: soon },
    { l: '고객센터', v: '', go: soon },
  ]

  return (
    <div className="pl-home-pad">
      <div className="pl-my-head">
        <div className="pl-my-avatar" aria-hidden>
          {authed && avatar ? <img src={avatar} alt="" /> : (authed ? (userName || '놀')[0] : '?')}
        </div>
        <div className="pl-my-info">
          <div className="pl-my-name">{name}</div>
          <div className="pl-my-sub">{authed ? '제주에서 놀 준비 완료' : '로그인하면 저장한 코스가 기기 간에 따라와요'}</div>
        </div>
        {authed && !editing && (
          <button type="button" className="pl-my-edit" onClick={open}>편집</button>
        )}
      </div>

      {authed && editing && (
        <div className="pl-my-form">
          <div className="pl-my-pic">
            <div className="pl-my-picbox">
              {shownAvatar
                ? <img src={shownAvatar} alt="" />
                : <span>{(draft || '놀')[0]}</span>}
            </div>
            <div className="pl-my-picbtns">
              <button type="button" onClick={() => fileRef.current?.click()}>사진 바꾸기</button>
              {shownAvatar && <button type="button" onClick={() => setDraftAvatar('')}>기본으로</button>}
            </div>
            <input
              ref={fileRef} type="file" accept="image/*" hidden
              onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = '' }}
            />
          </div>
          <label htmlFor="pl-my-name-input">이름</label>
          <input
            id="pl-my-name-input" value={draft} maxLength={20} autoFocus
            onChange={(e) => { setDraft(e.target.value); setErr('') }}
            onKeyDown={(e) => { if (e.key === 'Enter') void save() }}
            placeholder="어떻게 부를까요?"
          />
          {err && <div className="pl-my-err">{err}</div>}
          <div className="pl-my-formbtns">
            <button type="button" className="pl-my-cancel" onClick={() => setEditing(false)}>취소</button>
            <button type="button" className="pl-my-save" onClick={() => void save()} disabled={saving || !draft.trim()}>
              {saving ? '저장 중…' : '저장'}
            </button>
          </div>
        </div>
      )}

      {!authed && (
        <button type="button" className="pl-home-cta" onClick={onLogin}>로그인 / 회원가입</button>
      )}

      <div className="pl-my-menu">
        {menu.map((m) => (
          <button key={m.l} type="button" className="pl-my-item" onClick={m.go}>
            <span>{m.l}</span>
            <span className="pl-my-val">{m.v}<Chevron /></span>
          </button>
        ))}
      </div>

      {authed && (confirmOut ? (
        <div className="pl-my-out">
          <div className="pl-my-out-t">로그아웃할까요?</div>
          <div className="pl-my-out-s">저장한 코스는 이 기기에 남지만, 유튜브 연동은 끊어져요</div>
          <div className="pl-my-formbtns">
            <button type="button" className="pl-my-cancel" onClick={() => setConfirmOut(false)}>취소</button>
            <button type="button" className="pl-my-out-go" onClick={onLogout}>로그아웃</button>
          </div>
        </div>
      ) : (
        <button type="button" className="pl-my-logout" onClick={() => setConfirmOut(true)}>로그아웃</button>
      ))}
    </div>
  )
}

// ── 장소 소개 팝업 ────────────────────────────────────────
/** 카드·목록을 누르면 아래에서 올라오는 간략 소개. 전화·영업시간은 열고 나서 받아온다 */
export function PlaceSheet({ p, onClose }: { p: Place; onClose: () => void }) {
  const [detail, setDetail] = useState<PlaceDetail | null>(null)

  useEffect(() => {
    const ctrl = new AbortController()
    fetchPlaceDetails([p.id], ctrl.signal)
      .then((m) => setDetail(m[p.id] || null))
      .catch(() => { /* 상세가 없어도 기본 정보는 보여준다 */ })
    return () => ctrl.abort()
  }, [p.id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const facts = [
    detail?.business_hours && { l: '영업시간', v: detail.business_hours },
    detail?.phone && { l: '전화', v: detail.phone },
    detail?.menu_summary && { l: '메뉴', v: detail.menu_summary },
    detail?.price_per_person && { l: '1인 예상', v: `${detail.price_per_person.toLocaleString()}원` },
  ].filter(Boolean) as { l: string; v: string }[]

  return createPortal(
    <div className="pl-psheet-layer">
      <div className="pl-psheet-dim" onClick={onClose} />
      <div className="pl-psheet" role="dialog" aria-modal="true" aria-label={`${p.name} 소개`}>
        <div className="pl-psheet-handle" aria-hidden />
        <div className="pl-psheet-hero"><KindThumb kind={p.kind || ''} size={200} pid={p.id} /></div>
        <div className="pl-psheet-body">
          <div className="pl-psheet-name">{p.name}</div>
          <div className="pl-psheet-sub">{[p.kind, p.cat.split('>').pop()?.trim(), p.area].filter(Boolean).join(' · ')}</div>
          <div className="pl-psheet-addr">{p.addr.replace(/^제주(특별자치도)?\s*/, '')}</div>

          {!!p.tags?.length && (
            <div className="pl-chips" style={{ marginTop: 14 }}>
              {p.tags.slice(0, 6).map((t) => <span key={t} className="pl-chip pl-chip-plain">{t}</span>)}
            </div>
          )}

          {facts.map((f) => (
            <div key={f.l} className="pl-psheet-fact"><span>{f.l}</span>{f.v}</div>
          ))}
        </div>
        <button type="button" className="pl-psheet-close" onClick={onClose}>닫기</button>
      </div>
    </div>,
    document.body,
  )
}

// ── 프로필 사진 ───────────────────────────────────────────
const AVATAR_PX = 160

/** 고른 사진을 160px 정사각으로 잘라 줄인 뒤 data URL로 만든다.
 * 스토리지 버킷 없이 DB(users.avatar_url)에 그대로 넣기 때문에 작게 만드는 게 중요하다. */
export async function toAvatarDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)
  // 짧은 변에 맞춰 가운데를 정사각으로 자른다 — 얼굴이 잘려나가지 않게
  const side = Math.min(bitmap.width, bitmap.height)
  const sx = (bitmap.width - side) / 2
  const sy = (bitmap.height - side) / 2

  const canvas = document.createElement('canvas')
  canvas.width = AVATAR_PX
  canvas.height = AVATAR_PX
  canvas.getContext('2d')!.drawImage(bitmap, sx, sy, side, side, 0, 0, AVATAR_PX, AVATAR_PX)
  bitmap.close()
  return canvas.toDataURL('image/jpeg', 0.82)
}
