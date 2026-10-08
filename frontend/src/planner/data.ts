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
  { id: 'c1', title: '해장국 먹고 원도심 한 바퀴', area: '제주시내', tint: '#00A46E', start: 9,
    traits: { mood: 'food', crowd: 'mid', hour: 'morning', spend: 'meal', pace: 'low' }, tags: ['로컬', '기록'],
    why: '제주 사람들 아침인 고사리 해장국으로 시작해서, 조선시대 관아를 둘러보고 디저트로 마무리해요.',
    items: [{ k: '식사', n: '우진해장국', d: 50, c: 11000, note: '해장국 · 서사로 11 · 아침에도 줄이 있어요', pid: 'bff7211d-b360-52a0-8553-57183f1cccf5' },
            { k: '문화', n: '제주목 관아', d: 50, c: 1500, note: '사적지 · 관덕로 25', pid: 'c4eb6fd7-1fb3-5767-ba5c-9d77c0a82f9f' },
            { k: '카페', n: '화석과자 본점 센잇', d: 40, c: 8000, note: '디저트 카페 · 관덕로8길 13', pid: '7646e294-9050-50f4-ba1f-ca9d3fff1ff5' }] },
  { id: 'c2', title: '용두암 노을 보고 탑동 맥주', area: '제주시내', tint: '#8FBF2E', start: 17,
    traits: { mood: 'calm', crowd: 'mid', hour: 'sunset', spend: 'drink', pace: 'low' }, tags: ['야경', '자연', '사진'],
    why: '해 질 무렵 용두암 바다를 보고, 근처 카페에서 쉬었다가 탑동 수제맥주로 하루를 닫아요.',
    items: [{ k: '산책', n: '용두암', d: 30, c: 0, note: '해안 명소 · 용두암길 15 · 일몰 시간에 맞춰요', pid: '1a041dc5-e9b2-5d2c-b9b0-6a21b4ce6d3b' },
            { k: '카페', n: '휴즐리 제주본점', d: 50, c: 8000, note: '카페 · 흥운길 83', pid: 'c64c205b-25b9-55ab-a49a-03c8b017f941' },
            { k: '한잔', n: '맥파이 탑동점', d: 80, c: 20000, note: '수제맥주 · 탑동로2길 7 2층', pid: '04f695e0-8cd3-564f-9c43-fa1b74132fed' }] },
  { id: 'c3', title: '갈치 먹고 한담 해안 걷기', area: '애월', tint: '#00795A', start: 12,
    traits: { mood: 'calm', crowd: 'busy', hour: 'noon', spend: 'meal', pace: 'high' }, tags: ['자연', '사진', '로컬'],
    why: '갈치구이로 든든하게 먹고, 애월 바다를 끼고 한담 산책로를 걸은 뒤 바다 보이는 카페에서 쉬어요.',
    items: [{ k: '식사', n: '갈치바다 애월', d: 60, c: 25000, note: '갈치요리 · 애월로 15-1', pid: 'd321157c-13df-5f88-a6d5-9e0cae391c31' },
            { k: '산책', n: '한담해안산책로', d: 40, c: 0, note: '해안 산책로 · 애월~곽지 구간', pid: '3a65b08a-0290-53e3-8bd6-07797109cd1b' },
            { k: '카페', n: '해지개', d: 50, c: 9000, note: '오션뷰 카페 · 애월북서길 52', pid: '5c641efd-6b51-5fe6-919b-2c6b5063e916' }] },
  { id: 'c4', title: '협재 바다 보고 칼국수', area: '협재', tint: '#00A46E', start: 11,
    traits: { mood: 'calm', crowd: 'mid', hour: 'noon', spend: 'meal', pace: 'low' }, tags: ['자연', '사진'],
    why: '보말칼국수를 먹고 비양도가 보이는 협재 해변을 걸어요. 마지막은 해변 근처 카페에서 천천히.',
    items: [{ k: '식사', n: '협재칼국수', d: 50, c: 12000, note: '보말칼국수 · 협재로 3', pid: 'a6237d09-b5ec-57b0-8cf1-c72b092c9060' },
            { k: '산책', n: '협재해수욕장', d: 50, c: 0, note: '해변 · 비양도가 정면으로 보여요', pid: '470c7ebd-920b-56ac-9853-8e4c34458841' },
            { k: '카페', n: '쉼표', d: 50, c: 7000, note: '카페 · 한림로 359', pid: '712e62f1-7a99-574f-b5c0-87acca9af794' }] },
  { id: 'c5', title: '함덕 아침 바다 산책', area: '함덕', tint: '#8FBF2E', start: 9,
    traits: { mood: 'calm', crowd: 'busy', hour: 'morning', spend: 'cafe', pace: 'low' }, tags: ['자연', '사진'],
    why: '해녀김밥 한 줄 들고 함덕 해변을 걷고, 바다 바로 앞 카페에서 빵과 커피로 아침을 길게 보내요.',
    items: [{ k: '식사', n: '해녀김밥 본점', d: 30, c: 8000, note: '김밥 · 함덕로 40 3층', pid: 'd014fa96-2ff7-5556-ae80-d86b7cb883f6' },
            { k: '산책', n: '함덕해수욕장', d: 45, c: 0, note: '해변 · 서우봉 쪽으로 걸어요', pid: '612f257f-a156-5298-b48a-dac4063b3635' },
            { k: '카페', n: '델문도', d: 60, c: 9000, note: '오션뷰 카페 · 조함해안로 519-10', pid: '312c967e-4bdf-56f0-b421-6d5cc6bdb36b' }] },
  { id: 'c6', title: '월정리 서핑하고 타코', area: '월정', tint: '#00795A', start: 13,
    traits: { mood: 'active', crowd: 'busy', hour: 'noon', spend: 'play', pace: 'high' }, tags: ['자연', '기록'],
    why: '서핑 강습으로 몸을 쓰고, 해변 앞 타코와 커피로 회복하는 코스예요. 갈아입을 옷을 챙겨요.',
    items: [{ k: '체험', n: '월정퀵서프', d: 120, c: 50000, note: '서핑 강습 · 해맞이해안로 486 · 예약 확인', pid: '658e5366-4fd3-5c99-b4a9-3d5a2ebc9162' },
            { k: '식사', n: '월정타코마씸', d: 40, c: 13000, note: '흑돼지 타코 · 해맞이해안로 474', pid: '1ee1f381-72c7-5488-84c2-923a44666ae2' },
            { k: '카페', n: '모래비 커피로스터스 & 베이커리', d: 40, c: 7000, note: '로스터리 카페 · 해맞이해안로 462', pid: '7a677098-fc5c-546d-b698-bc739db8f8bc' }] },
  { id: 'c7', title: '광치기해변에서 일출봉 바라보기', area: '성산', tint: '#00A46E', start: 10,
    traits: { mood: 'calm', crowd: 'mid', hour: 'morning', spend: 'meal', pace: 'high' }, tags: ['자연', '사진'],
    why: '성산일출봉이 정면으로 보이는 광치기해변을 걷고, 고등어쌈밥을 먹은 뒤 카페에서 쉬어요.',
    items: [{ k: '산책', n: '광치기해변', d: 40, c: 0, note: '해변 · 썰물 때 이끼 바위가 드러나요', pid: 'f15cf5c7-6598-52d5-9758-91fa20e0e334' },
            { k: '식사', n: '성산 고등어쌈밥 김치찜', d: 60, c: 15000, note: '고등어쌈밥 · 섭지코지로25번길 122-5', pid: 'b489c8f8-d6c9-5ae4-9eb5-6967ff0cd71d' },
            { k: '카페', n: '성산카페 호랑호랑', d: 45, c: 7000, note: '카페 · 일출로 86', pid: '970301b5-3023-52e4-aa59-24ad9f9b9937' }] },
  { id: 'c8', title: '서귀포 미술관 두 곳 걷기', area: '서귀포', tint: '#8FBF2E', start: 13,
    traits: { mood: 'new', crowd: 'quiet', hour: 'noon', spend: 'cafe', pace: 'low' }, tags: ['전시', '기록'],
    why: '정방폭포 위 언덕의 작은 미술관과 전시관을 이어 보고, 서귀포 시내 카페에서 감상을 나눠요.',
    items: [{ k: '문화', n: '왈종 미술관', d: 50, c: 10000, note: '미술관 · 칠십리로214번길 30', pid: '971b80bc-4be9-57ac-8265-e6fd6b853caf' },
            { k: '문화', n: '서복전시관', d: 40, c: 500, note: '전시관 · 칠십리로 156-8', pid: 'd8bd845c-9bf8-5fcf-bc77-517a46056c92' },
            { k: '카페', n: '유동커피', d: 45, c: 6000, note: '카페 · 태평로 406-1', pid: 'd9c86483-a327-578b-8b41-c530e7781dd8' }] },
  { id: 'c9', title: '갈치조림 먹고 서귀포항 밤 산책', area: '서귀포', tint: '#00795A', start: 18,
    traits: { mood: 'food', crowd: 'mid', hour: 'night', spend: 'drink', pace: 'high' }, tags: ['야경', '로컬'],
    why: '갈치조림으로 저녁을 먹고 새연교 불빛이 보이는 서귀포항을 걸은 뒤, 회 한 접시로 마무리해요.',
    items: [{ k: '식사', n: '네거리식당', d: 60, c: 20000, note: '갈치조림 · 서문로29번길 20', pid: '96bafc5a-355c-5183-a4ef-7eb0f99464a0' },
            { k: '산책', n: '서귀포항', d: 40, c: 0, note: '항구 · 새연교 야경이 보여요', pid: 'a8d5d955-7790-58c1-88dd-d25ba158be51' },
            { k: '한잔', n: '나원회포차', d: 80, c: 25000, note: '회·포차 · 소암로 30', pid: '57974bdc-02b9-58f2-8875-b715ec1cc3c1' }] },
  { id: 'c10', title: '보말칼국수 먹고 천제연폭포까지', area: '중문', tint: '#8FBF2E', start: 11,
    traits: { mood: 'new', crowd: 'mid', hour: 'noon', spend: 'play', pace: 'high' }, tags: ['자연', '사진'],
    why: '보말칼국수로 점심을 먹고 천제연폭포 계곡을 걸은 뒤, 바로 옆 여미지식물원 온실을 둘러봐요.',
    items: [{ k: '식사', n: '중문수두리보말칼국수', d: 45, c: 12000, note: '보말칼국수 · 천제연로 192', pid: 'e60d3ee5-624c-512d-98c1-3a8fee6b6c6c' },
            { k: '산책', n: '천제연폭포', d: 50, c: 2500, note: '폭포 · 천제연로 132 · 계단이 많아요', pid: '1eed52c3-31e7-5e71-84d5-228b9621cacd' },
            { k: '문화', n: '여미지식물원', d: 60, c: 12000, note: '식물원 · 중문관광로 93', pid: '5a15058b-4c9f-5dab-8315-fa562afe3111' }] },
]

/** 코스별 구간 이동 (items 사이) */
export const LEGS: Record<string, { m: string; t: number; d: string }[]> = {
  c1: [{ m: '도보', t: 7, d: '490m' }, { m: '도보', t: 7, d: '460m' }],
  c2: [{ m: '도보', t: 6, d: '390m' }, { m: '도보', t: 18, d: '1.3km' }],
  c3: [{ m: '도보', t: 3, d: '170m' }, { m: '도보', t: 10, d: '710m' }],
  c4: [{ m: '도보', t: 10, d: '750m' }, { m: '도보', t: 6, d: '420m' }],
  c5: [{ m: '도보', t: 5, d: '340m' }, { m: '도보', t: 3, d: '190m' }],
  c6: [{ m: '도보', t: 3, d: '170m' }, { m: '도보', t: 2, d: '110m' }],
  c7: [{ m: '도보', t: 8, d: '560m' }, { m: '도보', t: 3, d: '200m' }],
  c8: [{ m: '도보', t: 5, d: '310m' }, { m: '도보', t: 10, d: '700m' }],
  c9: [{ m: '도보', t: 22, d: '1.5km' }, { m: '도보', t: 13, d: '970m' }],
  c10: [{ m: '도보', t: 11, d: '750m' }, { m: '도보', t: 8, d: '530m' }],
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

/** 브랜드 초록 */
export const GREEN = '#00A46E'
