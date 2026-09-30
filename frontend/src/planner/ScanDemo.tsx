// 개발용 — 취향 지도 분석 화면만 가짜 데이터로 보기 (API 호출 없음)
// http://localhost:5173/?scan-demo  (?scan-demo=analyze|done 으로 장면 바로 열기)
import { useEffect, useState } from 'react'
import type { YoutubeTaste } from './api'
import type { Sources } from './logic'
import type { Swipe } from './tasteType'
import { scanSteps } from './logic'
import { DataSourceScreen, SCAN_INTAKE_MS, SCAN_STEP_MS, ScanningScreen } from './PlannerApp'

const FAKE_YT = {
  likes: 128, subs: 42, categories: [], channels: [], tags: [], topics: [],
  titles: ['애월 숨은 카페 투어 브이로그', '제주 소품샵 5곳 털기', '혼자 가기 좋은 전시 추천', '제주시 LP바에서 보낸 저녁', '서귀포 올레길 산책 코스', '성산 일출 보고 왔어요'],
  sub_channels: ['침착맨', '빵집지도', '전시왕', '동네산책'],
  hints: { mood: null, spend: null, pace: null, tags: ['LP바', '빈티지'], evidence: { mood: '', spend: '', pace: '', tags: '' } },
} as YoutubeTaste

// 네트워크 없이 쓰는 색깔 사진
const COLORS = [['#f2b9a0', '#8a5a4a'], ['#9ec9d9', '#f6d58e'], ['#e8c39a', '#b0643f'], ['#e9e2d6', '#c9a27e']]
const FAKE_PHOTOS = COLORS.map(([bg, fg]) =>
  'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="${bg}"/><circle cx="40" cy="44" r="18" fill="${fg}"/></svg>`))
const FAKE_TAGS = ['감성적인', '카페', '여행', '음악', '맛있는 거']
const FAKE_TASTE = { mood: 'calm', spend: 'cafe', hour: 'sunset', crowd: 'quiet', pace: 'mid' }
const ANALYZE_MS = 3000 // 실제로는 AI 분석이 끝날 때까지

type Stage = 'select' | 'analyze' | 'done'

export default function ScanDemo() {
  const [stage, setStage] = useState<Stage>(() => (new URLSearchParams(window.location.search).get('scan-demo') as Stage) || 'select')
  const [sources, setSources] = useState<Sources>({ youtube: true, photos: true })
  const [scanN, setScanN] = useState(0)
  const [swipes, setSwipes] = useState<Swipe[]>([])
  const total = scanSteps(sources, FAKE_YT, FAKE_PHOTOS.length)
  // 장면을 바꿀 때 진행률을 0부터 다시 (이전 값이 남아 게이지가 찬 채로 시작하지 않게)
  const go = (s: Stage) => { setScanN(s === 'done' ? total : 0); setStage(s) }

  // 분석 중: 기록을 하나씩 읽고 → 잠깐 분석 → 완료
  useEffect(() => {
    if (stage !== 'analyze') return
    const timers: number[] = []
    for (let i = 1; i <= total; i++) timers.push(window.setTimeout(() => setScanN(i), i * SCAN_STEP_MS))
    timers.push(window.setTimeout(() => setStage('done'), total * SCAN_STEP_MS + Math.max(ANALYZE_MS, SCAN_INTAKE_MS)))
    return () => timers.forEach(clearTimeout)
  }, [stage, total])

  return (
    <>
      {stage === 'select' ? (
        <DataSourceScreen
          sources={sources} setSources={setSources} goHome={() => {}} skipScan={() => {}} error=""
          startScan={() => go('analyze')}
          photoCount={sources.photos ? FAKE_PHOTOS.length : 0}
          onPickPhotos={() => setSources((s) => ({ ...s, photos: true }))}
          onClearPhotos={() => setSources((s) => ({ ...s, photos: false }))}
        />
      ) : (
        <ScanningScreen
          sources={sources} yt={FAKE_YT} loading={false} scanN={scanN} photoUrls={FAKE_PHOTOS}
          ready={stage === 'done' ? { tags: FAKE_TAGS, taste: FAKE_TASTE } : null}
          swipes={swipes} onSwipe={(x) => setSwipes((l) => [...l.filter((y) => y.id !== x.id), x])}
          cancelScan={() => go('select')} onResult={() => go('select')}
        />
      )}
      {/* 화면 버튼(아래 ✕·♥, 위 좌우 버튼)을 가리지 않게 위쪽 가운데에 작게 */}
      <div style={{ position: 'fixed', top: 10, left: '50%', transform: 'translateX(-50%)', zIndex: 99, display: 'flex', gap: 4, padding: 4, borderRadius: 99, background: 'rgba(255,255,255,.92)', boxShadow: '0 4px 16px rgba(0,0,0,.15)' }}>
        {(['select', 'analyze', 'done'] as Stage[]).map((s) => (
          <button key={s} onClick={() => go(s)} title={{ select: '데이터 선택', analyze: '분석 중', done: '분석 완료' }[s]} style={{ padding: '7px 10px', borderRadius: 99, border: 0, cursor: 'pointer', font: '700 11.5px/1 Pretendard,sans-serif', background: stage === s ? '#00A46E' : '#eee', color: stage === s ? '#fff' : '#333' }}>
            {{ select: '①선택', analyze: '②분석', done: '③완료' }[s]}
          </button>
        ))}
      </div>
    </>
  )
}
