import { useEffect, useMemo, useState } from 'react'
import { SwipeDeck, TypeReveal } from '../planner/AnalysisGame'
import { pickTasteType } from '../planner/tasteType'
import type { Swipe } from '../planner/tasteType'
import { scanSteps } from '../planner/logic'
import type { Sources, Taste } from '../planner/logic'
import type { YoutubeTaste } from '../planner/api'

/* ── 분석 중(장소 카드 스와이프) · 분석 완료(취향 유형 발표) ─────────── */
export interface ScanResult { tags: string[]; taste: Taste }

export function ScanningScreen({ sources, yt, loading, scanN, photoUrls, ready, cancelScan, onResult, swipes, onSwipe }: {
  sources: Sources
  yt: YoutubeTaste | null
  loading: boolean
  scanN: number
  photoUrls: string[]
  ready: ScanResult | null
  cancelScan: () => void
  onResult: () => void
  swipes: Swipe[]
  onSwipe: (s: Swipe) => void
}) {
  const total = scanSteps(sources, yt, photoUrls.length)
  const read = Math.min(scanN, total)
  const analyzing = !loading && read >= total && !ready // 기록은 다 읽었고 AI 분석을 기다리는 중
  // 진행률: 기록을 읽으며 80%까지 → AI를 기다리는 동안 95%까지 천천히 → 끝나면 100%
  const target = ready ? 100 : loading ? 0 : analyzing ? 95 : (read / Math.max(1, total)) * 80
  const [pct, setPct] = useState(0)
  useEffect(() => {
    const id = requestAnimationFrame(() => setPct(target))
    return () => cancelAnimationFrame(id)
  }, [target])

  const [deckDone, setDeckDone] = useState(false)
  const [revealed, setRevealed] = useState(false)
  useEffect(() => { if (!ready) setRevealed(false) }, [ready])
  // 카드를 다 넘겼는데 분석도 끝났으면 바로 발표
  useEffect(() => {
    if (!ready || !deckDone) return
    const id = window.setTimeout(() => setRevealed(true), 700)
    return () => clearTimeout(id)
  }, [ready, deckDone])
  const result = useMemo(() => (ready ? pickTasteType(ready.taste, ready.tags, swipes) : null), [ready, swipes])
  const liked = swipes.filter((x) => x.liked).length

  if (revealed && ready && result) {
    return (
      <div className="pl-screen sg-page">
        <TypeReveal type={result.type} areas={result.areas} tags={ready.tags} liked={result.liked} onResult={onResult} />
      </div>
    )
  }
  return (
    <div className="pl-screen sg-page">
      <div className="sg-top">
        <button className="sg-top-btn" onClick={cancelScan}>‹ 분석 취소</button>
      </div>
      <div className="sg-head">
        <div className="sg-row">
          <span className="sg-status">
            {ready ? '분석 완료!' : loading ? '기록을 불러오는 중' : analyzing ? 'AI가 취향을 읽는 중' : '기록을 읽는 중'}
            {!ready && <span className="sg-ellipsis"><i>.</i><i>.</i><i>.</i></span>}
          </span>
          <span className="sg-pct">{Math.round(pct)}%</span>
        </div>
        <div className="sg-bar"><i className={analyzing ? 'is-waiting' : ''} style={{ width: `${pct}%` }} /></div>
        <div className="sg-title">기다리는 동안<br />끌리는 곳을 골라주세요</div>
        <div className="sg-sub">좋아요한 장소는 코스 추천에 반영돼요</div>
      </div>
      <div className="sg-stage">
        {deckDone
          ? <div className="sg-empty">{liked ? `좋아요 ${liked}곳!` : '다 골랐어요!'}<br />{ready ? '결과를 공개할게요' : '취향 유형을 정리하고 있어요'}</div>
          : <SwipeDeck onSwipe={onSwipe} onEmpty={() => setDeckDone(true)} />}
      </div>
      {ready && !deckDone && (
        <button type="button" className="sg-reveal-btn" onClick={() => setRevealed(true)}>✨ 내 취향 유형 공개하기</button>
      )}
    </div>
  )
}
