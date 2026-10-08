import { useEffect, useRef, useState } from 'react'
import { CardFan } from '../planner/AnalysisGame'
import { PhotoIcon, YoutubeIcon } from '../planner/Kiosk'
import type { Sources } from '../planner/logic'
import { SCENE_LAUNCH_MS } from './motion'

/* ── 데이터 소스 연결 (취향 유형 테스트 시작) ───────────────────── */
export function DataSourceScreen({ sources, setSources, goHome, startScan, skipScan, error, photoCount, onPickPhotos, onClearPhotos }: {
  sources: Sources
  setSources: (fn: (s: Sources) => Sources) => void
  goHome: () => void
  startScan: () => void
  skipScan: () => void
  error: string
  photoCount: number
  onPickPhotos: (files: File[]) => void
  onClearPhotos: () => void
}) {
  const photoInputRef = useRef<HTMLInputElement | null>(null)
  const [launching, setLaunching] = useState(false)
  const [nudge, setNudge] = useState(0) // 아무것도 안 고르고 누르면 안내를 흔듦
  const nSrc = (sources.youtube ? 1 : 0) + (sources.photos ? 1 : 0)

  // 연결에 실패해 돌아오면 다시 고를 수 있게
  useEffect(() => { if (error) setLaunching(false) }, [error])

  const launch = () => {
    if (launching) return
    if (!nSrc) return setNudge((n) => n + 1)
    setLaunching(true)
    const ms = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : SCENE_LAUNCH_MS
    window.setTimeout(startScan, ms)
  }
  const tiles = [
    { key: 'youtube' as const, label: '유튜브', icon: <YoutubeIcon size={34} />, sub: sources.youtube ? '좋아요·구독' : '연결 안 함' },
    { key: 'photos' as const, label: '사진첩', icon: <PhotoIcon size={34} />, sub: sources.photos ? `${photoCount}장` : '사진 고르기' },
  ]

  return (
    <div className={'pl-screen sg-page sg-select' + (launching ? ' is-launch' : '')}>
      <div className="sg-toprow">
        <button className="sg-top-btn" onClick={goHome}>‹ 홈</button>
        <button className="sg-top-btn" onClick={skipScan}>연결 없이 둘러보기</button>
      </div>
      <CardFan launching={launching} />
      <div className="sg-select-body">
        <div className="sg-eyebrow">내 기록으로 알아보는</div>
        <div className="sg-title sg-title--lg">취향 유형 테스트</div>
        <div className="sg-sub">분석하는 동안 끌리는 장소를 고르면<br />마지막에 나만의 취향 유형과 코스를 알려드려요</div>
        <div className="sg-tiles">
          {tiles.map((c) => {
            const on = sources[c.key]
            return (
              <button key={c.key} className={'sg-tile' + (on ? ' is-on' : '')} disabled={launching}
                onClick={() => {
                  if (c.key !== 'photos') return setSources((st) => ({ ...st, youtube: !st.youtube }))
                  if (on) onClearPhotos()
                  else photoInputRef.current?.click()
                }}>
                {c.icon}
                <span className="sg-tile-text">
                  <span className="sg-tile-label">{c.label}</span>
                  <span className="sg-tile-sub">{c.sub}</span>
                </span>
                <span className="sg-check" aria-hidden>{on ? '✓' : ''}</span>
              </button>
            )
          })}
        </div>
        {error && <div className="sg-error">{error}</div>}
        <button key={nudge} className={'sg-start' + (nudge ? ' is-nudge' : '')} onClick={launch} disabled={launching}>
          {launching ? '분석을 준비하는 중…' : nSrc ? '취향 분석 시작' : '하나 이상 골라주세요'}
        </button>
        <details className="sg-privacy">
          <summary>기록은 이렇게만 써요</summary>
          유튜브는 읽기 전용 권한으로 좋아요·구독 목록만 보고, 로그인 정보는 저장하지 않아요. 고른 사진은 기기 안에서 작게 줄인 뒤(최대 12장) 취향 분석에 한 번만 쓰이고, 원본과 줄인 사진 모두 저장하지 않습니다.
        </details>
      </div>
      <input
        ref={photoInputRef} type="file" accept="image/*" multiple hidden
        onChange={(e) => {
          const files = Array.from(e.target.files || [])
          e.target.value = ''
          if (files.length) onPickPhotos(files)
        }}
      />
    </div>
  )
}
