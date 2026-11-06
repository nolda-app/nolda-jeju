import { useEffect, useRef, useState } from 'react'

const KEY = import.meta.env.VITE_NAVER_MAP_CLIENT_ID as string | undefined
const SRC = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${KEY}`

let loading: Promise<void> | null = null

function loadNaver(): Promise<void> {
  if ((window as any).naver?.maps) return Promise.resolve()
  if (loading) return loading
  loading = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = SRC
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('naver maps script load failed'))
    document.head.appendChild(s)
  })
  return loading
}

export interface MapMarker { no: number; name: string; time: string; lat: number; lng: number }
export interface LatLng { lat: number; lng: number }

const GREY = '#A7ADB6'

function markerHtml(m: MapMarker, color: string, state: 'done' | 'next' | 'todo' | 'plain') {
  const bg = state === 'done' ? GREY : color
  const size = state === 'next' ? 32 : 24
  const ring = state === 'next' ? `box-shadow:0 0 0 6px ${color}33,0 3px 10px rgba(0,120,80,.35);` : 'box-shadow:0 3px 10px rgba(0,120,80,.35);'
  const label = state === 'done' ? '✓' : String(m.no)
  return (
    `<div style="display:flex;flex-direction:column;align-items:center;gap:3px;transform:translate(-50%,-100%)">` +
    `<div style="padding:5px 9px;border-radius:99px;background:#fff;box-shadow:0 3px 10px rgba(20,24,33,.16);font:700 10.5px/1 Pretendard,sans-serif;color:${state === 'done' ? GREY : '#141821'};white-space:nowrap">${m.time} ${m.name}</div>` +
    `<div style="width:${size}px;height:${size}px;border-radius:99px;background:${bg};border:2.5px solid #fff;${ring}color:#fff;font:700 ${state === 'next' ? 13 : 11}px/${size - 5}px Pretendard,sans-serif;text-align:center">${label}</div>` +
    `</div>`
  )
}

/**
 * paths: 구간별 실제 도보 경로 [위도, 경도][] — 없으면 장소끼리 직선 점선
 * arrived: 코스 진행 중이면 도착한 장소 수 (그만큼 회색 ✓, 다음 목적지는 크게). 없으면 일반 표시
 * me: 내 현재 위치 (파란 점) · focus: 바뀔 때마다 그 좌표로 지도 이동
 * fitPadding: 처음 코스 전체를 맞출 때 가장자리 여백 (지도 위에 패널이 덮이면 그만큼 크게)
 * live: 내 위치 → 다음 목적지 실시간 경로 [위도, 경도][] — 굵게 덧그린다
 * activeLeg: 고른 구간 번호 (0 = 1번째→2번째 장소)
 * legOnly: activeLeg가 있을 때 그 구간만 남기고 나머지 경로·핀을 감춘다 (코스 상세의 구간 보기)
 *          끄면 나머지를 회색 점선으로 흐리게만 한다 (코스 진행 중 — 전체 흐름이 보여야 함)
 */
const FIT_PADDING = { top: 48, right: 32, bottom: 32, left: 32 }

export default function NaverMap({ markers, color, paths, activeLeg, legOnly = false, arrived, me, focus, live, className = 'pl-routemap', fitPadding = FIT_PADDING }: {
  markers: MapMarker[]
  color: string
  paths?: [number, number][][]
  activeLeg?: number | null
  legOnly?: boolean
  arrived?: number
  me?: LatLng | null
  focus?: LatLng | null
  live?: [number, number][] | null
  className?: string
  fitPadding?: typeof FIT_PADDING
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [map, setMap] = useState<any>(null)
  const [err, setErr] = useState<string | null>(KEY ? null : 'VITE_NAVER_MAP_CLIENT_ID 없음')

  // 지도 + 경로선 (코스가 바뀔 때만 다시 그림)
  useEffect(() => {
    if (!KEY || !ref.current || !markers.length) return
    let m: any = null
    let dead = false

    loadNaver().then(() => {
      if (dead || !ref.current) return
      const nv = (window as any).naver
      const pts = markers.map((mk) => new nv.maps.LatLng(mk.lat, mk.lng))

      m = new nv.maps.Map(ref.current, {
        center: pts[0],
        zoom: 15,
        scaleControl: false,
        mapDataControl: false,
        logoControlOptions: { position: nv.maps.Position.BOTTOM_LEFT },
      })

      // 화면 맞춤은 아래 경로선 effect가 도맡는다 (고른 구간에 따라 달라지므로 두 곳에서 하면 깜빡인다)
      setMap(m)
    }).catch((e) => { console.error('[NaverMap]', e); if (!dead) setErr('지도를 불러오지 못했어요') })

    return () => { dead = true; setMap(null); try { m?.destroy?.() } catch { /* naver SDK bug */ } }
    // paths는 도보경로 fetch 후 변경되므로 의존성에서 제외 — 경로선은 아래 별도 effect가 처리
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markers])

  // 경로선 — 강조 구간이 바뀌면 선만 다시 그린다 (지도는 그대로)
  useEffect(() => {
    if (!map) return
    const nv = (window as any).naver
    if (!nv?.maps) return
    const pts = markers.map((mk) => new nv.maps.LatLng(mk.lat, mk.lng))
    const walk: any[][] | null = paths && paths.length === pts.length - 1
      ? paths.map((seg) => seg.map(([lat, lng]) => new nv.maps.LatLng(lat, lng)))
      : null

    // 고른 구간이 없으면 지금까지처럼 전부 똑같이 그린다
    const picked = activeLeg !== null && activeLeg !== undefined
    const lines: any[] = walk
      ? walk.flatMap((path, i) => {
        const on = !picked || i === activeLeg
        if (picked && legOnly && !on) return [] // 고른 구간만 보기 — 나머지는 아예 안 그린다
        return [new nv.maps.Polyline({
          map, path,
          strokeColor: on ? color : '#9AA1A9',
          strokeWeight: on ? (picked ? 6 : 4) : 3,
          strokeOpacity: on ? 0.95 : 0.5,
          strokeStyle: on ? 'solid' : 'shortdash',
          strokeLineCap: 'round', strokeLineJoin: 'round',
          zIndex: on ? 30 : 10,
        })]
      })
      : [new nv.maps.Polyline({
        map, path: pts, strokeColor: color, strokeWeight: 3,
        strokeStyle: 'shortdash', strokeOpacity: 0.9,
      })]

    // 고른 구간만 볼 땐 그 구간이 화면에 가득 차게 맞춘다 (다시 전체로 돌리면 코스 전체로)
    const fitTo = picked && legOnly && walk
      ? walk[activeLeg!].concat([pts[activeLeg!], pts[activeLeg! + 1]])
      : pts.concat(walk ? walk.flat() : [])
    if (fitTo.length) {
      const b = new nv.maps.LatLngBounds(fitTo[0], fitTo[0])
      fitTo.forEach((pt: any) => b.extend(pt))
      map.fitBounds(b, fitPadding)
    }

    return () => lines.forEach((l) => l.setMap(null))
  }, [map, markers, paths, color, activeLeg, legOnly, fitPadding])

  // 장소 핀 — 진행 상태(arrived)가 바뀌면 다시 그림
  useEffect(() => {
    if (!map) return
    const nv = (window as any).naver
    if (!nv?.maps) return
    const picked = activeLeg !== null && activeLeg !== undefined
    const shown = picked && legOnly
      ? markers.map((mk, i) => ({ mk, i })).filter(({ i }) => i === activeLeg || i === activeLeg! + 1)
      : markers.map((mk, i) => ({ mk, i }))
    const pins = shown.map(({ mk, i }) => new nv.maps.Marker({
      map, position: new nv.maps.LatLng(mk.lat, mk.lng), zIndex: arrived === i ? 50 : 10,
      icon: { content: markerHtml(mk, color, arrived === undefined ? 'plain' : i < arrived ? 'done' : i === arrived ? 'next' : 'todo') },
    }))
    return () => pins.forEach((p) => p.setMap(null))
  }, [map, markers, color, arrived, activeLeg, legOnly])

  // 내 위치 점
  useEffect(() => {
    if (!map || !me) return
    const nv = (window as any).naver
    if (!nv?.maps) return
    const dot = new nv.maps.Marker({
      map, position: new nv.maps.LatLng(me.lat, me.lng), zIndex: 100,
      icon: {
        content: '<div style="width:18px;height:18px;border-radius:99px;background:#2F80ED;border:3px solid #fff;box-shadow:0 0 0 8px rgba(47,128,237,.2),0 2px 6px rgba(20,24,33,.3);transform:translate(-50%,-50%)"></div>',
      },
    })
    return () => dot.setMap(null)
  }, [map, me])

  // 지금 걸어야 할 경로 (내 위치 → 다음 목적지)
  useEffect(() => {
    if (!map || !live || live.length < 2) return
    const nv = (window as any).naver
    if (!nv?.maps) return
    const path = live.map(([lat, lng]) => new nv.maps.LatLng(lat, lng))
    const under = new nv.maps.Polyline({
      map, path, strokeColor: '#fff', strokeWeight: 11, strokeOpacity: 0.95,
      strokeLineCap: 'round', strokeLineJoin: 'round', zIndex: 20,
    })
    const line = new nv.maps.Polyline({
      map, path, strokeColor: '#2F80ED', strokeWeight: 6, strokeOpacity: 1,
      strokeLineCap: 'round', strokeLineJoin: 'round', zIndex: 21,
    })
    return () => { under.setMap(null); line.setMap(null) }
  }, [map, live])

  useEffect(() => {
    if (!map || !focus) return
    const nv = (window as any).naver
    if (!nv?.maps) return
    map.panTo(new nv.maps.LatLng(focus.lat, focus.lng))
  }, [map, focus])

  if (err) return <div className={`${className} pl-routemap-fallback`}>{err}</div>
  if (!markers.length) return <div className={`${className} pl-routemap-fallback`}>실제 장소 연결 전이라 지도가 없어요</div>
  return <div ref={ref} className={className} />
}
