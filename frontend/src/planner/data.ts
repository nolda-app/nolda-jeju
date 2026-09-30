export type CondKey = 'area' | 'hours' | 'people' | 'budget'
export type TasteKey = 'mood' | 'crowd' | 'hour' | 'spend' | 'pace'

export interface Cond {
  area: string
  hours: number
  people: number
  budget: number
}

export const DEFAULT_COND: Cond = { area: 'any', hours: 0, people: 2, budget: 0 }

export const COND: {
  key: CondKey
  name: string
  title: string
  hint: string
  opts: { v: string | number; l: string }[]
}[] = [
  {
    key: 'area', name: '지역', title: '어디에서 만나요?', hint: '고른 동네의 코스만 보여드려요',
    opts: [{ v: 'any', l: '어디든' }, ...['제주시내', '애월', '협재', '함덕', '월정', '성산', '서귀포', '중문'].map((a) => ({ v: a, l: a }))],
  },
  {
    key: 'hours', name: '시간', title: '얼마나 쓸 수 있어요?', hint: '이동 시간까지 포함해서 걸러요',
    opts: [{ v: 0, l: '상관없음' }, { v: 2, l: '2시간 이내' }, { v: 3, l: '3시간 이내' }, { v: 4, l: '4시간 이내' }, { v: 6, l: '반나절' }],
  },
  {
    key: 'people', name: '인원', title: '몇 명이 함께 가요?', hint: '총 예산을 인원수로 계산해요',
    opts: [{ v: 1, l: '혼자' }, { v: 2, l: '2명' }, { v: 3, l: '3명' }, { v: 4, l: '4명 이상' }],
  },
  {
    key: 'budget', name: '예산', title: '1인 예산은요?', hint: '1인 기준 총액으로 걸러요',
    opts: [{ v: 0, l: '상관없음' }, { v: 20000, l: '2만원 이하' }, { v: 35000, l: '3.5만원 이하' }, { v: 50000, l: '5만원 이하' }, { v: 80000, l: '8만원 이하' }],
  },
]

export const Q: {
  key: TasteKey | 'plan' | 'companion' | 'tags'
  name: string
  multi?: boolean
  opts: { v: string; l: string }[]
}[] = [
  { key: 'mood', name: '관심사', opts: [{ v: 'calm', l: '힐링·휴식' }, { v: 'active', l: '운동·액티비티' }, { v: 'new', l: '새로운 경험' }, { v: 'food', l: '미식' }] },
  { key: 'crowd', name: '분위기', opts: [{ v: 'busy', l: '활기찬' }, { v: 'mid', l: '편안한' }, { v: 'quiet', l: '조용한' }] },
  { key: 'hour', name: '시간대', opts: [{ v: 'morning', l: '아침' }, { v: 'noon', l: '낮' }, { v: 'sunset', l: '노을 무렵' }, { v: 'night', l: '밤' }] },
  { key: 'spend', name: '메인 코스', opts: [{ v: 'meal', l: '식사' }, { v: 'cafe', l: '카페·디저트' }, { v: 'drink', l: '술·바' }, { v: 'play', l: '전시·체험' }] },
  { key: 'pace', name: '활동성', opts: [{ v: 'low', l: '적음' }, { v: 'mid', l: '중간' }, { v: 'high', l: '많음' }, { v: 'very', l: '매우 많음' }] },
  { key: 'plan', name: '일정', opts: [{ v: 'tight', l: '촘촘하게 여러 곳' }, { v: 'relaxed', l: '여유롭게 한 곳에 오래' }] },
  { key: 'companion', name: '누구랑', opts: [{ v: 'solo', l: '혼자' }, { v: 'couple', l: '연인' }, { v: 'friends', l: '친구' }, { v: 'family', l: '가족' }, { v: 'coworkers', l: '동료' }] },
  { key: 'tags', multi: true, name: '이런 것들이 자주 보였어요', opts: [{ v: '전시', l: '전시' }, { v: '야경', l: '야경' }, { v: '사진', l: '사진 찍기' }, { v: '로컬', l: '동네 가게' }, { v: '기록', l: '기록·수집' }, { v: '자연', l: '초록·물가' }] },
]

/** 항상 물어보는 고정 주제 (예산·지역은 결과 화면 조건에서 직접 고름).
 * 나머지 주제는 backend/taste.py가 기록을 보고 매번 새로 만든다 */
export const FIXED_Q_KEYS = ['crowd', 'hour', 'pace', 'plan', 'companion']

/** pid: Supabase places 테이블의 장소 id (있으면 지도에 실제 좌표로 표시) */
export interface CourseItem { k: string; n: string; d: number; c: number; note: string; pid?: string }
export interface Course {
  id: string; title: string; area: string; tint: string; start: number
  traits: Record<TasteKey, string>
  tags: string[]
  why: string
  items: CourseItem[]
  /** AI 코스는 구간 이동을 직접 포함 (고정 코스는 LEGS 사용) */
  legs?: { m: string; t: number; d: string }[]
  /** AI 코스: 체류 시간·가격이 추정값 */
  estimated?: boolean
  /** DB에 저장된 코스 — 공유 링크(?course=id)로 다시 열 수 있음 */
  shareable?: boolean
  /** taste: 취향 분석으로 AI가 만든 코스 · db: 모자란 만큼 DB 장소로 AI가 채운 코스 · rule: AI 실패 시 규칙 기반 */
  source?: 'taste' | 'db' | 'rule'
}

export const COURSES: Course[] = [
  { id: 'c1', title: '노을까지 걷다가 한잔', area: '망원', tint: '#00A46E', start: 17,
    traits: { mood: 'calm', crowd: 'quiet', hour: 'sunset', spend: 'drink', pace: 'high' }, tags: ['야경', '자연', '사진'],
    why: '카페에서 쉬다가 해 질 무렵 한강공원을 걷고, 어두워지면 자리를 잡는 순서예요.',
    items: [{ k: '카페', n: '티노마드', d: 45, c: 7000, note: '카페·디저트 · 포은로 112 2층', pid: '42949cb5-be91-555d-a0c9-3e2837a24344' },
            { k: '산책', n: '망원한강공원', d: 50, c: 0, note: '해 지는 시간에 맞춰 강변을 걸어요', pid: '3bb1320b-ad28-5862-bb22-908a1883d1e8' },
            { k: '한잔', n: '로바타 우직', d: 80, c: 25000, note: '이자카야 · 포은로 86-1', pid: '1faa0faf-4c46-5d08-9552-9b3efcedc108' }] },
  { id: 'c2', title: '손으로 만드는 오후', area: '망원', tint: '#8FBF2E', start: 12,
    traits: { mood: 'new', crowd: 'mid', hour: 'noon', spend: 'play', pace: 'low' }, tags: ['기록', '사진'],
    why: '밥을 먹고 공방에서 손을 쓰다 보면 처음의 어색함이 풀려요. 끝나면 얘기할 게 생겨요.',
    items: [{ k: '식사', n: '오시 망원본점', d: 60, c: 15000, note: '일식당 · 월드컵로17길 48', pid: '11413571-3470-59bd-b260-e15073ffde6f' },
            { k: '체험', n: '륀느공방', d: 90, c: 35000, note: '공방 · 월드컵로23길 21 · 클래스 예약 확인', pid: '3d607cbf-39a9-51c1-a75f-dad3b631d215' },
            { k: '카페', n: '어글리베이커리', d: 40, c: 8000, note: '베이커리 · 월드컵로13길 73', pid: 'b6756f3d-90ae-50fd-834a-eb0ccdfc0189' }] },
  { id: 'c3', title: '맛부터 시작하는 연남', area: '연남', tint: '#00795A', start: 12,
    traits: { mood: 'food', crowd: 'busy', hour: 'noon', spend: 'meal', pace: 'high' }, tags: ['로컬', '사진'],
    why: '배를 먼저 채우고 걷는 순서라 뒤로 갈수록 편해져요.',
    items: [{ k: '식사', n: '연하동 연남본점', d: 60, c: 14000, note: '일식당 · 연남로 6', pid: '37851c6b-ea94-59b2-b162-01a9e14a3e5c' },
            { k: '산책', n: '경의선숲길', d: 35, c: 0, note: '연트럴파크 구간을 따라 걸어요', pid: 'c5588995-d36e-585f-b83b-ce1d9451520d' },
            { k: '카페', n: '버터앤쉘터 연남점', d: 45, c: 8000, note: '카페·디저트 · 성미산로 170', pid: 'ee8b3ed2-6f0e-5150-87ff-50727bcd11ed' }] },
  { id: 'c4', title: '홍대 밤 골목 한 바퀴', area: '홍대', tint: '#00A46E', start: 19,
    traits: { mood: 'food', crowd: 'busy', hour: 'night', spend: 'drink', pace: 'high' }, tags: ['야경', '로컬', '사진'],
    why: '저녁을 먹고 볼링으로 몸을 풀고, 마지막에 한잔으로 마무리하는 코스예요.',
    items: [{ k: '식사', n: '하와이조개 홍대점', d: 70, c: 25000, note: '조개요리 · 와우산로21길 19-8', pid: '29143361-bff5-56e7-9fe2-2cb86ebee036' },
            { k: '체험', n: '홍대볼링장', d: 60, c: 12000, note: '볼링장 · 양화로 156 3층', pid: 'ec724734-f482-5366-b591-8afbbf2c1b07' },
            { k: '한잔', n: '배터리88 홍대', d: 70, c: 18000, note: '요리주점 · 와우산로19길 6', pid: '0b6b45d0-3cba-50e2-817d-c94080b70aad' }] },
  { id: 'c5', title: '혼자 재충전하는 상수', area: '상수', tint: '#8FBF2E', start: 13,
    traits: { mood: 'calm', crowd: 'quiet', hour: 'noon', spend: 'cafe', pace: 'low' }, tags: ['전시', '기록'],
    why: '말 안 해도 되는 코스예요. 책과 만화 사이에서 앉는 시간을 가장 길게 뒀어요.',
    items: [{ k: '문화', n: '오늘애니', d: 40, c: 0, note: '서점 · 와우산로10길 3', pid: 'bee31df0-78db-537b-a4d4-05331544976b' },
            { k: '카페', n: '만화살롱 유어마나', d: 90, c: 10000, note: '북카페 · 와우산로 13 지하', pid: 'fa6c1365-28e3-5aae-868c-efd69cbc0811' },
            { k: '산책', n: '와우공원', d: 40, c: 0, note: '근린공원 · 창전동', pid: 'bde9874c-e32a-5ac3-a49e-f765e4cd3c0a' }] },
  { id: 'c6', title: '전시 두 개 붙여 보기', area: '합정', tint: '#00795A', start: 13,
    traits: { mood: 'new', crowd: 'quiet', hour: 'noon', spend: 'play', pace: 'high' }, tags: ['전시', '기록', '사진'],
    why: '합정의 작은 전시 공간 두 곳을 걸어서 잇습니다. 사이에 커피 한 잔이 들어가요.',
    items: [{ k: '문화', n: '아트스페이스 합정', d: 40, c: 5000, note: '전시관 · 포은로 24 · 전시 일정 확인', pid: '83eb7d55-4a7e-533a-ab25-7f2a8d919c4c' },
            { k: '카페', n: '앤트러사이트 합정점', d: 50, c: 7000, note: '카페 · 토정로5길 10', pid: '3c67d723-3960-5981-9070-9ddd168c9d35' },
            { k: '문화', n: '스페이스 아크', d: 40, c: 5000, note: '갤러리 · 토정로3길 16 · 전시 일정 확인', pid: '3b361e79-17bd-5aa2-9a53-262281b2f99f' }] },
  { id: 'c7', title: '땀 흘리고 먹기', area: '홍대', tint: '#00A46E', start: 15,
    traits: { mood: 'active', crowd: 'mid', hour: 'noon', spend: 'play', pace: 'high' }, tags: ['기록'],
    why: '몸을 먼저 쓰고 밥으로 마무리해요. 편한 옷만 있으면 됩니다.',
    items: [{ k: '체험', n: '더클라임 클라이밍 연남점', d: 90, c: 25000, note: '암벽등반 · 양화로 186 3층', pid: 'a146ba81-ace5-52d4-983d-c1f852e3a7c6' },
            { k: '식사', n: '츠케루', d: 50, c: 13000, note: '일본식라면 · 와우산로23길 9', pid: '62c29d0f-a1e8-5150-bbdc-25f7859c0e53' },
            { k: '한잔', n: '산울림1992', d: 70, c: 20000, note: '요리주점 · 서강로9길 60', pid: '874c9436-2eba-5cb5-8092-83132231cea4' }] },
  { id: 'c8', title: '양식 먹고 숲길 지나 빵집까지', area: '연남', tint: '#8FBF2E', start: 11,
    traits: { mood: 'food', crowd: 'quiet', hour: 'morning', spend: 'meal', pace: 'high' }, tags: ['로컬', '자연'],
    why: '늦은 아침을 먹고 숲길을 걸은 뒤 빵집에서 마무리하는 짧은 코스.',
    items: [{ k: '식사', n: '빌라 더 다이닝 홍대본점', d: 60, c: 16000, note: '양식 · 동교로30길 16', pid: 'e618ce89-a8d7-5cbb-a08b-b451f9f45537' },
            { k: '산책', n: '경의선숲길', d: 40, c: 0, note: '그늘 있는 쪽으로 걸어요', pid: 'c5588995-d36e-585f-b83b-ce1d9451520d' },
            { k: '카페', n: '코코로카라', d: 40, c: 6000, note: '베이커리 · 연남로1길 41', pid: 'c80529f8-d49e-5112-8454-da85ec876236' }] },
  { id: 'c9', title: '보드게임하고 야식', area: '연남', tint: '#00795A', start: 18,
    traits: { mood: 'active', crowd: 'busy', hour: 'night', spend: 'play', pace: 'low' }, tags: ['기록'],
    why: '앉아서 오래 노는 코스. 처음 만난 사람들과도 즐기기 좋은 코스.',
    items: [{ k: '체험', n: '홈즈앤루팡24 보드게임 연남점', d: 90, c: 12000, note: '짧은 2인용 게임부터 시작해요', pid: '26583c6d-dd58-5ded-9b02-40397e73d9cc' },
            { k: '식사', n: '평화연남', d: 50, c: 11000, note: '곱창·막창 · 동교로 254-1', pid: '43323b27-c9bc-53fb-aa74-c1cc984bdf03' },
            { k: '한잔', n: '야키토리 고꼬연남', d: 60, c: 20000, note: '이자카야 · 성미산로26길 41', pid: '5440c4e0-8ed3-59f4-9340-2f6124049fa4' }] },
  { id: 'c10', title: '전시 보고 하늘공원 오르기', area: '상암', tint: '#8FBF2E', start: 14,
    traits: { mood: 'active', crowd: 'quiet', hour: 'sunset', spend: 'play', pace: 'high' }, tags: ['자연', '전시', '사진'],
    why: '상암의 전시 공간 두 곳을 들른 뒤 하늘공원에 올라 해 지는 걸 보는 코스예요.',
    items: [{ k: '문화', n: '서울에너지드림센터', d: 50, c: 0, note: '전시관 · 증산로 14', pid: '6f2a216e-7783-57f5-9cb4-383b045e2e55' },
            { k: '문화', n: '문화비축기지', d: 60, c: 0, note: '복합문화공간 · 증산로 87', pid: 'd56e89e8-49ba-526b-862c-6d78c5d10379' },
            { k: '산책', n: '하늘공원', d: 60, c: 0, note: '생태공원 · 하늘공원로 95', pid: '6f7e9d77-03c5-57e3-be85-6906dcfbfc52' }] },
]

/** 코스별 구간 이동 (items 사이) */
export const LEGS: Record<string, { m: string; t: number; d: string }[]> = {
  c1: [{ m: '도보', t: 20, d: '1.4km' }, { m: '도보', t: 17, d: '1.1km' }],
  c2: [{ m: '도보', t: 3, d: '230m' }, { m: '도보', t: 4, d: '270m' }],
  c3: [{ m: '도보', t: 4, d: '280m' }, { m: '도보', t: 6, d: '420m' }],
  c4: [{ m: '도보', t: 9, d: '650m' }, { m: '도보', t: 10, d: '680m' }],
  c5: [{ m: '도보', t: 5, d: '300m' }, { m: '도보', t: 20, d: '1.4km' }],
  c6: [{ m: '도보', t: 20, d: '1.4km' }, { m: '도보', t: 7, d: '520m' }],
  c7: [{ m: '도보', t: 10, d: '730m' }, { m: '도보', t: 8, d: '620m' }],
  c8: [{ m: '도보', t: 5, d: '320m' }, { m: '도보', t: 9, d: '600m' }],
  c9: [{ m: '도보', t: 3, d: '220m' }, { m: '도보', t: 3, d: '150m' }],
  c10: [{ m: '도보', t: 17, d: '1.2km' }, { m: '도보', t: 26, d: '1.8km' }],
}

export function moveTint(m: string) {
  return m === '도보' ? '#00A46E' : m === '택시' ? '#C08A1E' : '#4A7FB5'
}

export function hhmm(m: number) {
  const h = Math.floor(m / 60) % 24
  const mm = m % 60
  return String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0')
}

export function durLabel(m: number) {
  const rounded = Math.ceil(m / 10) * 10
  const h = Math.floor(rounded / 60)
  const mm = rounded % 60
  return h ? (mm ? `${h}시간 ${mm}분` : `${h}시간`) : `${mm}분`
}

export function won(n: number) {
  return n.toLocaleString('ko-KR') + '원'
}

export function label(opts: { v: string | number; l: string }[], v: string | number | undefined) {
  const f = opts.find((o) => o.v === v)
  return f ? f.l : ''
}
