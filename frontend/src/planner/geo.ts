// 장소 데이터는 백엔드 GET /places(Supabase)에서 한 번 받아 둠
const BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '')
const placeIndex = new Map<string, Place>()
let loading: Promise<void> | null = null

/** 앱 시작 때 호출. 실패하면 다음 호출 때 다시 시도 */
export function loadPlaces(): Promise<void> {
  if (!loading) {
    loading = (async () => {
      if (!BASE) throw new Error('VITE_API_BASE_URL이 설정되지 않았어요')
      const res = await fetch(`${BASE}/places`)
      if (!res.ok) throw new Error(`장소 불러오기 실패 (HTTP ${res.status})`)
      for (const p of (await res.json()) as Place[])
        if (p.lat >= 33 && p.lat < 34) placeIndex.set(p.id, p)
    })().catch((e) => { loading = null; throw e })
  }
  return loading
}

/** 받아 둔 장소 전체 (아직 못 받았으면 빈 배열) */
export function allPlaces(): Place[] {
  return Array.from(placeIndex.values())
}

/** 장소 id → 장소 정보(업종·주소·좌표). 아직 못 받았거나 없으면 undefined */
export function placeInfo(id?: string): Place | undefined {
  return id ? placeIndex.get(id) : undefined
}

/** 장소 id → [위도, 경도]. 없으면 undefined */
export function placeGeo(id?: string): [number, number] | undefined {
  const p = placeInfo(id)
  return p ? [p.lat, p.lng] : undefined
}

// ── 장소 타입 (백엔드 GET /places 응답)
export type PlaceKind = '식사' | '카페' | '한잔' | '체험' | '문화' | '산책' | '운동'
export interface Place {
  id: string; name: string; cat: string; addr: string; lat: number; lng: number
  img?: string | null; kind?: string; area?: string | null; tags?: string[]
}
