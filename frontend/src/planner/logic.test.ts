import { describe, expect, it } from 'vitest'
import { COURSES, DEFAULT_COND } from './data'
import { analyzeYoutubeOnly, applyPicks, build, matchCond, scanSteps } from './logic'
import type { YoutubeTaste } from './api'

const ctx = { taste: {}, tags: [], intent: null, people: 1, booked: [] }

describe('matchCond', () => {
  const c = { area: '애월', minutes: 180, perPerson: 30000 }
  it('조건이 비어 있으면 통과', () => expect(matchCond(c, DEFAULT_COND)).toBe(true))
  it('다른 동네면 탈락', () => expect(matchCond(c, { ...DEFAULT_COND, area: '함덕' })).toBe(false))
  it('시간 초과면 탈락, 딱 맞으면 통과', () => {
    expect(matchCond(c, { ...DEFAULT_COND, hours: 2 })).toBe(false)
    expect(matchCond(c, { ...DEFAULT_COND, hours: 3 })).toBe(true)
  })
  it('1인 예산 초과면 탈락', () => expect(matchCond(c, { ...DEFAULT_COND, budget: 20000 })).toBe(false))
})

describe('build', () => {
  it('고정 코스 — 시작 시각부터 머문 시간·이동 시간을 이어 붙인다', () => {
    const c = COURSES[0]
    const b = build(c, ctx)
    expect(b.items[0].time).toBe(`${String(c.start).padStart(2, '0')}:00`)
    expect(b.items).toHaveLength(c.items.length)
    expect(b.minutes).toBe(c.items.reduce((s, it) => s + it.d, 0) + b.moveTotal)
    expect(b.perPerson).toBe(c.items.reduce((s, it) => s + it.c, 0))
  })
  it('인원이 둘 이상이면 총액, 혼자면 1인 금액', () => {
    expect(build(COURSES[0], ctx).costLabel).toMatch(/^1인 /)
    expect(build(COURSES[0], { ...ctx, people: 2 }).costLabel).toMatch(/^총 /)
  })
  it('취향을 하나도 모르면 점수 60', () => expect(build(COURSES[0], ctx).score).toBe(60))
  it('취향이 코스와 같을수록 점수가 높다', () => {
    const c = COURSES[0]
    const same = build(c, { ...ctx, taste: { ...c.traits } }).score
    const other = build(c, { ...ctx, taste: { ...c.traits, mood: c.traits.mood === 'calm' ? 'active' : 'calm' } }).score
    expect(same).toBeGreaterThan(other)
  })
})

describe('scanSteps', () => {
  const yt = { titles: Array(10).fill('t'), sub_channels: Array(10).fill('c') } as unknown as YoutubeTaste
  it('유튜브는 영상 6 + 채널 4줄까지만', () => expect(scanSteps({ youtube: true, photos: false }, yt)).toBe(10))
  it('끈 소스는 세지 않는다', () => expect(scanSteps({ youtube: false, photos: true }, yt, 3)).toBe(3))
})

describe('analyzeYoutubeOnly', () => {
  it('유튜브 기록이 없으면 기본값', () => {
    const r = analyzeYoutubeOnly(null, '안내')
    expect(r.taste.mood).toBe('food')
    expect(r.tags).toEqual(['로컬'])
    expect(r.notice).toBe('안내')
  })
})

describe('applyPicks', () => {
  const topics = [{
    key: 't1', name: '주제', hint: '힌트',
    opts: [{ v: 'a', l: '바다', mood: 'calm', tag: '자연' }, { v: 'b', l: '시장', spend: 'meal', tag: '로컬' }],
  }] as never
  it('고른 옵션의 값·태그를 모으고, 태그는 중복 없이 4개까지', () => {
    const r = applyPicks(topics, { t1: ['a', 'b'] }, ['자연', '사진', '기록', '전시'])
    expect(r.mood).toBe('calm')
    expect(r.spend).toBe('meal')
    expect(r.tags).toEqual(['자연', '로컬', '사진', '기록'])
    expect(r.picked).toEqual([{ name: '주제', labels: ['바다', '시장'], hint: '힌트' }])
  })
  it('아무것도 안 고르면 기본 태그만', () => {
    const r = applyPicks(topics, {}, ['사진'])
    expect(r.mood).toBeUndefined()
    expect(r.picked).toEqual([])
    expect(r.tags).toEqual(['사진'])
  })
})
