// 코스 카드의 장소 아이콘을 누르면 화면 중앙에 뜨는 장소 미리보기 — 장소들을 가로로 이어 붙이고 좌우로 밀어 넘김
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PointerEvent as ReactPointerEvent } from 'react'
import KindThumb from './KindThumb'
import { placeInfo } from './geo'
import { fetchPlaceDetails } from './api'
import type { PlaceDetail } from './api'
import type { BuiltCourse } from './logic'

const DRAG_START_PX = 6 // 이만큼 움직여야 '밀기'로 판단 (그 전에는 버튼 탭으로 둠)
const SWIPE_PX = 40 // 이만큼 밀면 다음/이전으로
const FLICK_PX = 18 // 빠르게 튕길 때는 이만큼만 밀어도 넘어감
const FLICK_MS = 250
const EDGE_RESIST = 0.3 // 첫/마지막 장소에서 더 밀 때 끌려오는 비율

const shortAddr = (addr: string) => addr.replace(/^제주(특별자치도)?\s*/, '')
// 저장된 업체 URL이 없어서 '이름 + 시'로 네이버 지도 검색 결과로 보냄 (이름이 대부분 고유해서 상위 결과가 그 업체).
// 코스 동네 이름('제주시내'·'월정' 등)은 앱이 정한 이름이라 네이버 검색어로 붙이면 업체를 못 찾는다 → 주소의 행정구역을 쓴다.
// 이름의 '& …'·괄호는 비짓제주가 붙인 부가 설명이라 뗀다 (예: '천제연폭포 & 제주4.3중문면희생자위령비')
const naverMapSearchUrl = (name: string, addr?: string) => {
  const core = name.split(/\s*&\s*/)[0].replace(/\s*[(（[].*?[)）\]]\s*/g, ' ').trim()
  const city = addr?.match(/(제주시|서귀포시)/)?.[1] ?? '제주'
  return `https://map.naver.com/p/search/${encodeURIComponent(`${core} ${city}`)}`
}

function Slide({ course, item, detail }: { course: BuiltCourse; item: BuiltCourse['items'][number]; detail?: PlaceDetail }) {
  const info = placeInfo(item.pid)
  const cost = item.cost + (course.estimated && item.cost !== '무료' ? ' (추정)' : '')
  const sub = [item.kind, info?.cat.split('>').pop()].filter(Boolean).join(' · ')
  return (
    <div className="pl-preview-slide">
      {detail?.image_url && <img className="pl-preview-photo" src={detail.image_url} alt="" />}
      <div className="pl-preview-body">
        <KindThumb kind={item.kind} size={56} pid={item.pid} />
        <div className="pl-preview-info">
          <div className="pl-preview-name">{item.name}</div>
          <div className="pl-preview-cat">{sub}</div>
          <div className="pl-preview-facts">{item.time} 도착 · {item.dur} · {cost}</div>
        </div>
      </div>
      {item.note && <div className="pl-preview-note">{item.note}</div>}
      {info?.addr && (
        <div className="pl-preview-addr">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 21s-6-5.3-6-10.5A6 6 0 0 1 18 10.5C18 15.7 12 21 12 21ZM12 12.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
          </svg>
          {shortAddr(info.addr)}
        </div>
      )}
      {detail?.business_hours && <div className="pl-preview-addr">{detail.business_hours}</div>}
      {detail?.menu_summary && <div className="pl-preview-addr">{detail.menu_summary}</div>}
      {detail?.phone && <div className="pl-preview-addr">{detail.phone}</div>}
      <a className="pl-preview-link" href={naverMapSearchUrl(item.name, info?.addr)} target="_blank" rel="noopener noreferrer">
        링크 바로가기 ›
      </a>
    </div>
  )
}

export default function PlacePreview({ course, index, onMove, onClose, onOpenCourse, hideOpenCourse }: {
  course: BuiltCourse
  index: number
  onMove: (index: number) => void
  onClose: () => void
  onOpenCourse: () => void
  hideOpenCourse?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const gesture = useRef<{ x: number; t: number; dragging: boolean } | null>(null)
  const [dx, setDx] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [details, setDetails] = useState<Record<string, PlaceDetail>>({})

  const it = course.items[index]
  const last = course.items.length - 1
  const pidsKey = course.items.map((i) => i.pid).filter(Boolean).join(',')

  useEffect(() => { ref.current?.focus() }, [])
  useEffect(() => {
    const ids = course.items.map((i) => i.pid).filter(Boolean) as string[]
    if (!ids.length) return
    const ctrl = new AbortController()
    fetchPlaceDetails(ids, ctrl.signal).then(setDetails).catch(() => {})
    return () => ctrl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pidsKey])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft' && index > 0) onMove(index - 1)
      else if (e.key === 'ArrowRight' && index < last) onMove(index + 1)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [index, last, onMove, onClose])

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (last > 0) gesture.current = { x: e.clientX, t: performance.now(), dragging: false }
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current
    if (!g) return
    const d = e.clientX - g.x
    if (!g.dragging) {
      if (Math.abs(d) < DRAG_START_PX) return
      g.dragging = true
      e.currentTarget.setPointerCapture(e.pointerId)
      setDragging(true)
    }
    const atEdge = (d > 0 && index === 0) || (d < 0 && index === last)
    setDx(atEdge ? d * EDGE_RESIST : d)
  }
  const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current
    gesture.current = null
    if (!g?.dragging) return
    const d = e.clientX - g.x
    const flick = performance.now() - g.t < FLICK_MS && Math.abs(d) >= FLICK_PX
    setDragging(false)
    setDx(0)
    if ((d <= -SWIPE_PX || (flick && d < 0)) && index < last) onMove(index + 1)
    else if ((d >= SWIPE_PX || (flick && d > 0)) && index > 0) onMove(index - 1)
  }

  // body에 띄움 — 포털 안 클릭이 React 트리를 타고 코스 카드(상세 열기)로 올라가지 않게 레이어에서 막음
  return createPortal(
    <div className="pl-preview-layer" onClick={(e) => e.stopPropagation()}>
      <div className="pl-preview-dim" onClick={onClose} />
      <div
        ref={ref}
        tabIndex={-1}
        className={'pl-preview' + (dragging ? ' dragging' : '')}
        role="dialog"
        aria-modal="true"
        aria-label={`${it.name} 미리보기 (${index + 1}/${last + 1})`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
        <div className="pl-preview-head">
          <div className="pl-preview-dots" aria-hidden>
            {course.items.map((_, i) => <span key={i} className={i === index ? 'on' : ''} />)}
            {last > 0 && <span className="pl-preview-hint">밀어서 넘기기</span>}
          </div>
          <button type="button" className="pl-preview-close" onClick={onClose} aria-label="닫기">✕</button>
        </div>
        <div className="pl-preview-viewport">
          <div className="pl-preview-track" style={{ transform: `translateX(calc(${-index * 100}% + ${dx}px))` }}>
            {course.items.map((item, i) => <Slide key={i} course={course} item={item} detail={item.pid ? details[item.pid] : undefined} />)}
          </div>
        </div>
        {(it.bookable || !hideOpenCourse) && (
          <div className="pl-preview-foot">
            {it.bookable && <span className="pl-preview-book">{it.provider}</span>}
            {!hideOpenCourse && (
              <button type="button" className="pl-preview-cta" onClick={() => { onClose(); onOpenCourse() }}>코스 전체 보기</button>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
