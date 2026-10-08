import { useEffect, useMemo, useState } from 'react'
import KindThumb from '../planner/KindThumb'
import NaverMap from '../planner/NaverMap'
import PlacePreview from '../planner/PlacePreview'
import { fetchPlaceDetails } from '../planner/api'
import type { PlaceDetail } from '../planner/api'
import { placeGeo } from '../planner/geo'
import { useWalkLegs } from '../planner/useWalkLegs'
import { GREEN } from '../planner/data'
import type { BuiltCourse } from '../planner/logic'

/* ── 코스 상세 모달 (타임라인 + 이동 동선) ─────────────────── */
export function CourseModal({ course, isSaved, booked, toggleBook, toggleSave, start, share, close, closing }: {
  course: BuiltCourse
  isSaved: boolean
  booked: string[]
  toggleBook: (key: string) => void
  toggleSave: () => void
  start: () => void
  share: () => void
  close: () => void
  closing: boolean
}) {
  const [details, setDetails] = useState<Record<string, PlaceDetail>>({})
  const [preview, setPreview] = useState<number | null>(null)
  const pidsKey = course.items.map((it) => it.pid).filter(Boolean).join(',')
  useEffect(() => {
    const ids = course.items.map((it) => it.pid).filter(Boolean) as string[]
    if (!ids.length) return
    const ctrl = new AbortController()
    fetchPlaceDetails(ids, ctrl.signal).then(setDetails).catch(() => {})
    return () => ctrl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pidsKey])

  return (
    <div className={'pl-modal-wrap' + (closing ? ' closing' : '')}>
      <div className="pl-sheet-backdrop" onClick={close} />
      <div className="pl-modal">
        <div style={{ flex: 'none', padding: '12px 22px 16px' }}>
          <div className="pl-sheet-handle" />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span className="pl-matchtag" style={{ background: course.tintBg, color: course.tintFg }}>{course.matchLabel}</span>
            <span style={{ flex: 1, minWidth: 0, font: '500 11.5px/1 var(--font)', color: 'var(--ink-45)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{course.area} · {course.span}</span>
            <div className="pl-closebtn" onClick={close}>✕</div>
          </div>
          <div className="pl-h1" style={{ fontSize: 24 }}>{course.title}</div>
          <div style={{ marginTop: 8, font: '400 13px/1.65 var(--font)', color: 'var(--ink-60)' }}>{course.why}</div>
          {course.estimated && (
            <div style={{ marginTop: 6, font: '500 11.5px/1.5 var(--font)', color: 'var(--ink-45)' }}>AI가 만든 코스예요 · 체류 시간·가격은 추정값이에요</div>
          )}
          <div style={{ marginTop: 10, display: 'inline-block', padding: '6px 11px', borderRadius: 99, background: 'var(--green-soft)', font: '600 11.5px/1 var(--font)', color: 'var(--green-deep)' }}>{course.moveLine} · 총 {course.dur}</div>
        </div>
        <div className="pl-scroll" style={{ padding: '6px 22px 20px', borderTop: '1px solid var(--ink-06)' }}>
          <RouteMap course={course} />
          <div style={{ paddingTop: 18 }}>
            {course.items.map((it, i) => (
              <div key={i}>
                {it.hasMove && (
                  <div style={{ display: 'flex', gap: 13, alignItems: 'center', margin: '-14px 0 12px' }}>
                    <div style={{ flex: 'none', width: 44 }} />
                    <div style={{ flex: 'none', width: 11, display: 'flex', justifyContent: 'center' }}>
                      <div style={{ width: 1, height: 34, background: 'repeating-linear-gradient(to bottom,var(--ink-15) 0 4px,transparent 4px 8px)' }} />
                    </div>
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ padding: '5px 10px', borderRadius: 99, background: it.moveTint, color: '#fff', font: '700 11px/1 var(--font)' }}>{it.moveLabel}</span>
                      <span style={{ font: '500 11.5px/1 var(--font)', color: 'var(--ink-45)' }}>{it.moveDetail}</span>
                    </div>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 13 }}>
                  <div style={{ flex: 'none', width: 44, paddingTop: 2, font: '700 12.5px/1.5 var(--font)', color: 'var(--ink-45)' }}>{it.time}</div>
                  <div style={{ flex: 'none', width: 11, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={{ width: 11, height: 11, borderRadius: 99, marginTop: 5, border: `2.5px solid ${course.tint}`, background: '#fff' }} />
                    <div style={{ flex: 1, width: 1, background: 'var(--ink-10)' }} />
                  </div>
                  <div style={{ flex: 1, paddingBottom: 22 }}>
                    <div style={{ display: 'flex', gap: 11, alignItems: 'flex-start', cursor: 'pointer' }} onClick={() => setPreview(i)}>
                      {it.pid && details[it.pid]?.image_url ? (
                        <img src={details[it.pid].image_url!} alt="" style={{ flex: 'none', width: 74, height: 74, borderRadius: 14, objectFit: 'cover' }} />
                      ) : (
                        <KindThumb kind={it.kind} pid={it.pid} />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ font: '700 15.5px/1.4 var(--font)', letterSpacing: '-.02em', color: 'var(--ink)' }}>{it.name}</div>
                        <div style={{ marginTop: 4, font: '400 12.5px/1.6 var(--font)', color: 'var(--ink-45)' }}>{it.note}</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 9 }}>
                          <span className="pl-kindchip">{it.kind}</span>
                          <span className="pl-kindchip">{it.dur}</span>
                          <span className="pl-kindchip">{it.cost}</span>
                        </div>
                      </div>
                    </div>
                    {it.bookable && (
                      <BookButton item={it} isBooked={booked.indexOf(it.bookKey) > -1} onClick={() => toggleBook(it.bookKey)} />
                    )}
                  </div>
                </div>
              </div>
            ))}
            <div style={{ padding: '15px 16px', borderRadius: 16, background: 'var(--green-soft)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, font: '600 12.5px/1.5 var(--font)', color: 'var(--ink-60)' }}>{course.totalNote}</div>
              <div style={{ font: '800 19px/1 var(--font)', color: 'var(--ink)' }}>{course.costLabel}</div>
            </div>
          </div>
        </div>
        <div style={{ flex: 'none', padding: '14px 22px 30px', display: 'flex', alignItems: 'stretch', gap: 9, borderTop: '1px solid var(--ink-06)' }}>
          <button type="button" className="pl-heartbtn" aria-pressed={isSaved} aria-label={isSaved ? '저장 취소' : '코스 저장'} title={isSaved ? '저장 취소' : '코스 저장'} onClick={toggleSave}>
            {isSaved ? '♥' : '♡'}
          </button>
          <div className="pl-cta" style={{ flex: 1, margin: 0, boxSizing: 'border-box', border: '1px solid transparent' }} onClick={start}>
            코스 시작
          </div>
          <div style={{ flex: 'none', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 18px', borderRadius: 'var(--r-md)', border: '1px solid var(--ink-10)', font: '600 15px/1 var(--font)', color: 'var(--ink-60)', cursor: 'pointer' }} onClick={share}>공유</div>
        </div>
      </div>
      {preview !== null && (
        <PlacePreview course={course} index={preview} onMove={setPreview} onClose={() => setPreview(null)} onOpenCourse={() => setPreview(null)} hideOpenCourse />
      )}
    </div>
  )
}

function BookButton({ item, isBooked, onClick }: { item: BuiltCourse['items'][number]; isBooked: boolean; onClick: () => void }) {
  const providerDot = item.provider === '캐치테이블 예약' ? '#E2452F' : '#03C75A'
  return (
    <div className="pl-bookbtn" style={{
      background: isBooked ? 'var(--green-soft)' : '#fff',
      borderColor: isBooked ? GREEN : 'var(--ink-15)',
      color: isBooked ? 'var(--green-deep)' : 'var(--ink)',
    }} onClick={onClick}>
      <span className="pl-bookdot" style={{ background: providerDot }} />
      {isBooked ? '예약 요청됨' : item.provider}
    </div>
  )
}

function RouteMap({ course }: { course: BuiltCourse }) {
  const markers = useMemo(
    // 실제 장소(pid)가 연결된 곳만 핀 표시
    () => course.markers.flatMap((mk, i) => {
      const g = placeGeo(course.items[i]?.pid)
      return g ? [{ no: mk.no, name: mk.name, time: mk.time, lat: g[0], lng: g[1] }] : []
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [course.id, course.markers.map((m) => m.name + m.time).join('|')],
  )

  // 핀이 하나라도 빠지면 구간 순서가 어긋나므로 직선으로 대체
  const paths = useWalkLegs(course.id, markers, markers.length === course.items.length)
  // 고른 구간만 진하게 — 경로가 겹칠 때 어디서 어디로 가는지 구분하려고
  const [leg, setLeg] = useState<number | null>(null)
  const legs = markers.length > 1 && paths ? markers.length - 1 : 0

  return (
    <>
    <div className="pl-mapwrap">
      <NaverMap markers={markers} color={GREEN} paths={paths} activeLeg={leg} legOnly />
      <div className="pl-mapbadges">
        <span className="pl-mapbadge">{course.area}</span>
        <span className="pl-mapbadge" style={{ color: 'var(--green-press)' }}>{course.moveLine}</span>
      </div>
    </div>
      {legs > 1 && (
        <div className="pl-legbar">
          <button type="button" className={'pl-legbtn' + (leg === null ? ' on' : '')} onClick={() => setLeg(null)}>전체</button>
          {Array.from({ length: legs }, (_, i) => (
            <button
              key={i} type="button" className={'pl-legbtn' + (leg === i ? ' on' : '')}
              onClick={() => setLeg(leg === i ? null : i)}
              aria-label={`${i + 1}번째에서 ${i + 2}번째 장소로 가는 길`}
            >
              {i + 1}<span>→</span>{i + 2}
            </button>
          ))}
        </div>
      )}
    </>
  )
}
