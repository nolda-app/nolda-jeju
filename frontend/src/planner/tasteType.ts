// 취향 유형 — 분석한 취향 값(관심사·메인 코스·시간대·분위기·태그) + 분석 중 스와이프로 고른 장소를 점수로 합쳐 8가지 중 하나
import type { Taste } from './logic'

export interface TasteType {
  key: string
  name: string
  emoji: string
  line: string // 한 줄 설명
  areas: string[] // 잘 맞는 동네 (스와이프로 고른 장소가 없을 때)
  kinds: string[] // 잘 맞는 장소 종류
  color: string
}

export const TASTE_TYPES: TasteType[] = [
  { key: 'sunset', name: '노을 산책가', emoji: '🌇', line: '해 질 무렵 강변을 걷다가 분위기 좋은 카페에 들르는 게 최고의 하루', areas: ['애월', '협재'], kinds: ['산책', '카페'], color: '#F29A5C' },
  { key: 'cafe', name: '카페 수집가', emoji: '☕', line: '새로 생긴 카페는 일단 저장, 디저트 지도는 이미 머릿속에', areas: ['애월', '월정'], kinds: ['카페'], color: '#B7835A' },
  { key: 'gourmet', name: '골목 미식가', emoji: '🍜', line: '큰길보다 골목 안에 숨은 한 그릇을 찾아내는 즐거움', areas: ['제주시내', '서귀포'], kinds: ['식사'], color: '#E0703F' },
  { key: 'night', name: '밤거리 한잔러', emoji: '🍷', line: '해가 지면 시작되는 사람, 좋은 음악 흐르는 바에서 하루를 마무리', areas: ['제주시내', '서귀포'], kinds: ['한잔'], color: '#7A5FC8' },
  { key: 'explorer', name: '전시 탐험가', emoji: '🖼️', line: '팝업·전시·새로운 공간은 남들보다 먼저 가 봐야 직성이 풀려요', areas: ['중문', '제주시내'], kinds: ['문화'], color: '#3F7CB8' },
  { key: 'active', name: '액티비티 러버', emoji: '🧗', line: '보는 것보다 직접 해 보는 게 좋아요, 몸으로 노는 하루', areas: ['성산', '중문'], kinds: ['체험'], color: '#2A9A66' },
  { key: 'healer', name: '여유 힐링러', emoji: '🌿', line: '사람 적은 곳에서 천천히, 쉬는 날은 제대로 쉬고 싶어요', areas: ['함덕', '성산'], kinds: ['산책', '카페'], color: '#5FA884' },
  { key: 'hip', name: '골목 트렌드세터', emoji: '✨', line: '사진 찍기 좋은 골목과 소품샵을 누비며 요즘 뜨는 곳을 찾아요', areas: ['월정', '애월'], kinds: ['체험', '카페'], color: '#DB5F92' },
]

/** 분석 중 스와이프한 장소 */
export interface Swipe {
  id: string
  name: string
  kind: string
  area?: string | null
  tags: string[]
  liked: boolean
}

type Scores = Record<string, number>

const TASTE_POINTS: Record<string, Record<string, Scores>> = {
  mood: { calm: { healer: 2, sunset: 1 }, active: { active: 3 }, new: { explorer: 2, hip: 1 }, food: { gourmet: 3 } },
  spend: { cafe: { cafe: 3 }, meal: { gourmet: 2 }, drink: { night: 3 }, play: { explorer: 2, active: 1 } },
  hour: { sunset: { sunset: 2 }, night: { night: 2 }, morning: { healer: 1 } },
  crowd: { quiet: { healer: 1 }, busy: { hip: 1, night: 1 } },
}
const TAG_POINTS: Record<string, Scores> = {
  야경: { night: 1, sunset: 1 }, 전시: { explorer: 1 }, 사진: { hip: 1 }, 자연: { healer: 1, sunset: 1 }, 로컬: { gourmet: 1 },
}
// 장소 리뷰 태그(places.tags) → 유형
const PLACE_TAG_POINTS: Record<string, Scores> = {
  감성적: { hip: 0.5, cafe: 0.3 }, 사진맛집: { hip: 0.5 }, 힙함: { hip: 0.5 }, 조용함: { healer: 0.5 },
  데이트: { sunset: 0.3 }, 시끌벅적함: { night: 0.3 }, 혼밥: { gourmet: 0.3 },
}

function add(scores: Scores, points: Scores | undefined, weight = 1) {
  for (const [k, v] of Object.entries(points || {})) scores[k] = (scores[k] || 0) + v * weight
}

export function pickTasteType(taste: Taste, tags: string[], swipes: Swipe[]) {
  const scores: Scores = {}
  for (const [axis, table] of Object.entries(TASTE_POINTS)) add(scores, table[(taste as Record<string, string | undefined>)[axis] || ''])
  tags.forEach((t) => add(scores, TAG_POINTS[t]))
  for (const s of swipes) {
    const w = s.liked ? 1 : -0.4 // 별로라고 한 곳은 조금 깎음
    TASTE_TYPES.forEach((t) => { if (t.kinds.includes(s.kind)) scores[t.key] = (scores[t.key] || 0) + 1.2 * w })
    if (s.liked) s.tags.forEach((tag) => add(scores, PLACE_TAG_POINTS[tag]))
  }
  const type = [...TASTE_TYPES].sort((a, b) => (scores[b.key] || 0) - (scores[a.key] || 0))[0]
  // 잘 맞는 동네: 좋아요한 장소의 동네가 있으면 그걸로, 없으면 유형 기본값
  const likedAreas = swipes.filter((s) => s.liked && s.area).map((s) => s.area as string)
  const areaCount = likedAreas.reduce<Record<string, number>>((m, a) => ({ ...m, [a]: (m[a] || 0) + 1 }), {})
  const areas = Object.keys(areaCount).sort((a, b) => areaCount[b] - areaCount[a]).slice(0, 2)
  return { type, areas: areas.length ? areas : type.areas, liked: swipes.filter((s) => s.liked).length }
}
