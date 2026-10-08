import {
  COND, LEGS, Q,
  durLabel, hhmm, moveTint, won,
} from './data'
import type { Cond, Course, TasteKey } from './data'
import type { TasteProfile, TasteTopic, YoutubeTaste } from './api'

export interface Taste {
  mood?: string
  crowd?: string
  hour?: string
  spend?: string
  pace?: string
  /** 일정 밀도 tight | relaxed — 코스 성격이 아니라 코스를 짜는 방식이라 점수 계산엔 안 씀 */
  plan?: string
  /** 함께 가는 사람 solo | couple | friends | family | coworkers — 점수 계산엔 안 쓰고 AI 코스 요청에만 */
  companion?: string
}

export interface Sources { youtube: boolean; photos: boolean }

export interface Report {
  repeatSpots: string[]
  party: number
  budgetBand: number
  ytLikes: number
  ytSubs: number
  taste: Taste
  tags: string[]
  /** LLM이 이번 분석에서 새로 만든 주제 — 규칙 기반 폴백이면 빈 배열 */
  topics: TasteTopic[]
  evidence: Record<string, string>
  /** 요약 화면 짧은 칩 (단골·인원) — 사진첩이 없으면 비어 있음 */
  highlights: string[]
  /** 분석이 온전하지 못했을 때 화면에 띄울 안내 (정상이면 빈 문자열) */
  notice: string
  total: number
  days: number
}

export function matchCond(c: { area: string; minutes: number; perPerson: number }, cond: Cond) {
  if (cond.area !== 'any' && c.area !== cond.area) return false
  if (cond.hours && c.minutes > cond.hours * 60) return false
  if (cond.budget && c.perPerson > cond.budget) return false
  return true
}

/** 분석 중 화면에 한 줄씩 켜지는 유튜브 기록 (좋아요 영상 6 + 구독 채널 4) */
export function ytScanRows(yt: YoutubeTaste | null) {
  if (!yt) return []
  return [
    ...yt.titles.slice(0, 6).map((t) => ({ mark: '좋', name: t, meta: '좋아요한 영상' })),
    ...yt.sub_channels.slice(0, 4).map((c) => ({ mark: '구', name: c, meta: '구독 채널' })),
  ]
}

export function scanSteps(sources: Sources, yt: YoutubeTaste | null, photoCount = 0) {
  return (sources.youtube ? ytScanRows(yt).length : 0) + (sources.photos ? photoCount : 0)
}

const PACE_LEVELS = ['low', 'mid', 'high', 'very']

// 카드내역이 없어져 예산은 추정하지 않음 — 결과 화면 조건에서 직접 고름
const NO_BUDGET = { budgetBand: 0 }

/** 백엔드 분석이 실패했을 때의 폴백 — 유튜브 키워드 규칙만 쓴다.
 * 사진은 여기서 다루지 않는다(예전에는 더미 사진으로 흉내 냈는데, 가본 적 없는 장소가 결과로 나왔다) */
export function analyzeYoutubeOnly(y: YoutubeTaste | null, notice = ''): Report {
  const h = y?.hints
  const fallback = '유튜브 기록이 적어 기본값'
  return {
    taste: { mood: h?.mood || 'food', crowd: 'mid', hour: 'noon', spend: h?.spend || 'cafe', pace: h?.pace || 'mid' },
    tags: h?.tags.length ? h.tags.slice(0, 3) : ['로컬'],
    evidence: {
      mood: h?.evidence.mood || fallback,
      spend: h?.evidence.spend || fallback,
      pace: h?.evidence.pace || fallback,
      hour: '기본값',
      crowd: '기본값',
      tags: h?.evidence.tags || fallback,
    },
    repeatSpots: [], party: 2, ...NO_BUDGET, ytLikes: y?.likes ?? 0, ytSubs: y?.subs ?? 0,
    topics: [], highlights: [], notice,
    total: 0, days: 0,
  }
}

/** 동적 주제에서 고른 옵션 값 — 주제 key → 고른 v들 */
export type Picks = Record<string, string[]>

/** 백엔드 LLM 분석 결과 → 화면이 쓰는 Report. 고정 5개 주제 값과 동적 주제를 그대로 옮긴다 */
export function reportFromProfile(p: TasteProfile): Report {
  return {
    repeatSpots: [], party: p.photo.party, ...NO_BUDGET,
    ytLikes: p.youtube.likes, ytSubs: p.youtube.subs,
    taste: {
      crowd: p.fixed.crowd ?? undefined, hour: p.fixed.hour ?? undefined, pace: p.fixed.pace ?? undefined,
      plan: p.fixed.plan, companion: p.fixed.companion,
      mood: p.base.mood ?? undefined, spend: p.base.spend ?? undefined,
    },
    tags: p.tags, topics: p.topics,
    evidence: p.evidence,
    highlights: p.highlights,
    notice: p.photo.error ? `사진을 읽지 못해 유튜브 기록만으로 분석했어요 (${p.photo.error})` : '',
    total: p.photo.total, days: p.photo.days,
  }
}

/** 동적 주제에서 고른 답 → 코스 생성에 넘길 값들.
 * 옵션마다 붙은 기본값(mood/spend/tag)으로 기존 점수 계산을 살리고, 라벨은 문장 그대로 LLM에 넘긴다 */
export function applyPicks(topics: TasteTopic[], picks: Picks, baseTags: string[]) {
  const chosen = topics.map((t) => ({ t, opts: t.opts.filter((o) => (picks[t.key] || []).indexOf(o.v) > -1) }))
  const first = (k: 'mood' | 'spend') => chosen.flatMap((c) => c.opts.map((o) => o[k])).find(Boolean) || undefined
  const pickTags = chosen.flatMap((c) => c.opts.map((o) => o.tag)).filter((x): x is string => !!x)
  return {
    mood: first('mood'),
    spend: first('spend'),
    tags: Array.from(new Set([...pickTags, ...baseTags])).slice(0, 4),
    picked: chosen.filter((c) => c.opts.length).map((c) => ({
      name: c.t.name, labels: c.opts.map((o) => o.l), hint: c.t.hint,
    })),
  }
}

export interface BuiltItem {
  time: string; name: string; kind: string; note: string; pid?: string
  bookable: boolean; provider: string
  bookKey: string
  dur: string; mins: number; cost: string
  hasMove: boolean; moveLabel: string; moveDetail: string; moveTint: string
}

export interface BuiltCourse extends Omit<Course, 'items'> {
  items: BuiltItem[]
  score: number
  kindChips: string[]
  minutes: number
  perPerson: number
  moveTotal: number
  markers: { key: number; no: number; name: string; time: string }[]
  bookLine: string
  moveLine: string
  span: string
  dur: string
  costLabel: string
  totalNote: string
  matchLabel: string
  tint: string
  tintBg: string
  tintFg: string
}

export function build(
  c: Course,
  ctx: { taste: Taste; tags: string[]; intent: string | null; people: number; booked: string[] },
): BuiltCourse {
  const t0 = c.start * 60
  const legs = c.legs || LEGS[c.id] || []
  let t = t0
  let moveTotal = 0
  const items: BuiltItem[] = c.items.map((it, i) => {
    const leg = i ? legs[i - 1] || { m: '도보', t: 10, d: '' } : null
    if (leg) { t += leg.t; moveTotal += leg.t }
    const prov = ['식사', '한잔'].indexOf(it.k) > -1 ? '캐치테이블 예약' : ['체험', '문화'].indexOf(it.k) > -1 ? '네이버 예약' : null
    const bookKey = c.id + '-' + i
    const row: BuiltItem = {
      time: hhmm(t), name: it.n, kind: it.k, note: it.note, pid: it.pid,
      bookable: !!prov, provider: prov || '', bookKey,
      dur: durLabel(it.d), mins: it.d, cost: it.c ? won(it.c) : '무료',
      hasMove: !!leg,
      moveLabel: leg ? leg.m + ' ' + leg.t + '분' : '',
      moveDetail: leg ? leg.d : '',
      moveTint: leg ? moveTint(leg.m) : 'transparent',
    }
    t += it.d
    return row
  })
  const total = c.items.reduce((s, i) => s + i.c, 0)
  const people = ctx.people
  const tw = ctx.taste
  const keys: TasteKey[] = ['mood', 'crowd', 'hour', 'spend', 'pace']
  const answered = keys.filter((k) => tw[k])
  let raw = 0
  answered.forEach((k) => {
    if (tw[k] === c.traits[k]) raw += 20
    // 활동성은 단계라 한 칸 차이면 절반 점수
    else if (k === 'pace' && Math.abs(PACE_LEVELS.indexOf(tw[k]!) - PACE_LEVELS.indexOf(c.traits[k])) === 1) raw += 10
  })
  const hit = c.tags.filter((t2) => ctx.tags.indexOf(t2) > -1)
  raw += hit.length * 12
  if (ctx.intent && c.traits.mood === ctx.intent) raw += 24
  const max = answered.length * 20 + ctx.tags.length * 12 + (ctx.intent ? 24 : 0)
  const score = max ? Math.round(38 + (raw / max) * 60) : 60
  const strong = score >= 80

  return {
    ...c, items, score,
    kindChips: Array.from(new Set(c.items.map((i) => i.k))),
    minutes: t - t0,
    perPerson: total,
    moveTotal,
    markers: items.map((it, i) => ({ key: i, no: i + 1, name: it.name, time: it.time })),
    bookLine: items.filter((x) => x.bookable).length
      ? '예약 연동 ' + items.filter((x) => x.bookable).length + '곳 · 캐치테이블/네이버'
      : '예약 없이 바로 갈 수 있어요',
    moveLine: '이동 ' + durLabel(moveTotal) + ' · ' + (legs.every((l) => l.m === '도보') ? '전부 도보' : legs.map((l) => l.m).join('→')),
    span: hhmm(t0) + '–' + hhmm(t),
    dur: durLabel(t - t0),
    costLabel: people > 1 ? '총 ' + won(total * people) : '1인 ' + won(total),
    totalNote: people > 1 ? people + '명 기준 · 1인 ' + won(total) + ' · 이동 시간 포함' : '1인 기준 · 이동 시간 포함',
    matchLabel: '취향 ' + score + '%',
    tint: c.tint,
    tintBg: strong ? '#E4F4EC' : 'rgba(20,24,33,.05)',
    tintFg: strong ? '#00734F' : 'rgba(20,24,33,.55)',
  }
}

export { COND, Q }

/** 시간대 4구간의 기본 시작·종료 시각 (취향 요약의 시간대 막대) */
export const HOUR_DEFAULT: Record<string, [number, number]> = { morning: [9, 11], noon: [12, 15], sunset: [16, 19], night: [19, 22] }
/** 시작 시각 → 시간대 구간 (analyze 기준과 같음) */
export const hourBucket = (h: number) => (h < 11 ? 'morning' : h < 16 ? 'noon' : h < 19 ? 'sunset' : 'night')
