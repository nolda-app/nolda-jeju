import { FIXED_Q_KEYS, GREEN, Q, label as labelOf } from '../planner/data'
import { hourBucket } from '../planner/logic'
import type { Picks, Report, Taste } from '../planner/logic'
import type { TasteTopic } from '../planner/api'

/* ── 취향 요약 ─────────────────────────────────────────────── */
export function SummaryScreen({ report, taste, setTaste, tags, setTags, picks, setPicks, intent, setIntent, toStart, rescan, finish, hourRange, setHourRange, budget, setBudget }: {
  report: Report
  taste: Taste
  setTaste: (fn: (t: Taste) => Taste) => void
  tags: string[]
  setTags: (fn: (t: string[]) => string[]) => void
  picks: Picks
  setPicks: (fn: (p: Picks) => Picks) => void
  intent: string | null
  setIntent: (v: string | null) => void
  toStart: () => void
  rescan: () => void
  finish: () => void
  hourRange: [number, number]
  setHourRange: (r: [number, number]) => void
  budget: number
  setBudget: (v: number) => void
}) {
  const scanMeta = [
    report.ytLikes || report.ytSubs ? `유튜브 좋아요 ${report.ytLikes} · 구독 ${report.ytSubs}` : '',
    report.total ? `사진 ${report.total}장` : '',
  ].filter(Boolean).join(' · ') + ' 분석'
  // LLM이 주제를 만들어 줬으면 고정 6개만 남기고, 나머지 주제는 이번 분석에서 새로 만든 것으로 채운다
  const dynamic = report.topics.length > 0
  const shown = dynamic ? FIXED_Q_KEYS : (Q.filter((x) => !x.multi).map((x) => x.key) as string[])
  const traitCards = Q.filter((x) => !x.multi && shown.indexOf(x.key) > -1).map((x) => ({
    key: x.key, name: x.name, evidence: report.evidence[x.key] || '',
    opts: x.opts.map((o) => ({ key: o.v, l: o.l, on: (taste as any)[x.key] === o.v })),
  }))
  const tagChips = (Q.find((x) => x.key === 'tags')?.opts || []).map((o) => ({ key: o.v, l: o.l, on: tags.indexOf(o.v) > -1 }))
  const intentChips = [
    { v: null as string | null, l: '기록 그대로' }, { v: 'calm', l: '푹 쉬고 싶어' }, { v: 'active', l: '몸 좀 쓰고파' },
    { v: 'new', l: '새로운 거' }, { v: 'food', l: '맛있는 거' },
  ]
  const toggle = (t: TasteTopic, v: string) => setPicks((st) => {
    const cur = st[t.key] || []
    if (!t.multi) return { ...st, [t.key]: cur[0] === v ? [] : [v] }
    return { ...st, [t.key]: cur.indexOf(v) > -1 ? cur.filter((x) => x !== v) : cur.concat([v]) }
  })

  return (
    <div className="pl-screen">
      <div className="pl-scroll" style={{ padding: '22px 22px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <span style={{ font: '400 11.5px/1 var(--font)', color: 'var(--ink-45)' }}>{scanMeta}</span>
          <div className="pl-pillbtn" onClick={toStart}>처음으로</div>
        </div>
        <div className="pl-h1" style={{ marginTop: 9 }}>이런 취향이 보여요</div>
        <div className="pl-sub" style={{ marginTop: 9 }}>다르면 눌러서 바꿔주세요. 바꾼 값으로 다시 추천해요.</div>
        {report.notice && <div className="pl-notice" style={{ marginTop: 12 }}>{report.notice}</div>}

        {report.highlights.length > 0 && (
          <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {report.highlights.map((h) => <span key={h} className="pl-tag-mini" style={{ background: 'var(--green-soft)', color: '#0C5A42' }}>{h}</span>)}
          </div>
        )}

        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {traitCards.map((t) => (
            <div key={t.key} className="pl-traitcard">
              <div className="pl-trait-head">
                <span className="pl-trait-name">{t.name}</span>
                <span className="pl-trait-ev">{t.evidence}</span>
              </div>
              {t.key === 'hour' ? (
                <HourRange range={hourRange} onChange={setHourRange} />
              ) : (
                <div style={{ marginTop: 11, display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                  {t.opts.map((o) => (
                    <Chip key={o.key} label={o.l} on={o.on} onClick={() => setTaste((st) => ({ ...st, [t.key]: o.key }))} />
                  ))}
                </div>
              )}
            </div>
          ))}
          <div className="pl-traitcard">
            <div className="pl-trait-head"><span className="pl-trait-name">1인 예산</span></div>
            <BudgetSlider value={budget} onChange={setBudget} />
          </div>
          {!dynamic && (
            <div className="pl-traitcard">
              <div className="pl-trait-head">
                <span className="pl-trait-name">이런 것들이 자주 보였어요</span>
                <span className="pl-trait-ev">{report.evidence.tags}</span>
              </div>
              <div style={{ marginTop: 11, display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                {tagChips.map((c) => (
                  <Chip key={c.key} label={c.l} on={c.on} onClick={() => setTags((st) => (st.indexOf(c.key) > -1 ? st.filter((x) => x !== c.key) : st.concat([c.key])))} />
                ))}
              </div>
            </div>
          )}
          {/* 이번 분석에서 새로 만든 주제 — 기록이 달라지면 주제와 선택지도 달라진다 */}
          {report.topics.map((t) => (
            <div key={t.key} className="pl-traitcard">
              <div className="pl-trait-head">
                <span className="pl-trait-name">{t.name}</span>
                <span className="pl-trait-ev">{t.evidence}</span>
              </div>
              <div style={{ marginTop: 11, display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                {t.opts.map((o) => (
                  <Chip key={o.v} label={o.l} on={(picks[t.key] || []).indexOf(o.v) > -1} onClick={() => toggle(t, o.v)} />
                ))}
              </div>
            </div>
          ))}
        </div>

        {!dynamic && (
        <div className="pl-intentbox">
          <div style={{ font: '800 15.5px/1.35 var(--font)', color: 'var(--ink)' }}>오늘은 어떤 걸 해볼까요?</div>
          <div style={{ marginTop: 6, font: '400 12.5px/1.6 var(--font)', color: 'var(--ink-45)' }}>취향 분석은 예전 기록 기준이에요.<br />오늘 기분에 맞는 걸 고르면 그 코스를 위로 올려드려요.</div>
          <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {intentChips.map((c) => (
              <Chip key={String(c.v)} label={c.l} on={(intent || null) === c.v} onClick={() => setIntent(c.v)} />
            ))}
          </div>
        </div>
        )}
        <div className="pl-skip" onClick={rescan}>연결 항목 바꿔서 다시 분석</div>
      </div>
      <div className="pl-foot">
        <div className="pl-cta" onClick={finish}>AI 코스 추천 받기</div>
      </div>
    </div>
  )
}

/* 시간대 막대 — 6시~24시 1시간 눈금, 시작·끝 손잡이 2개. 취향값은 시작 시각의 4구간(아침·낮·노을 무렵·밤)으로 저장 */
const HOUR_MIN = 6, HOUR_MAX = 24
const HOUR_SPAN = HOUR_MAX - HOUR_MIN
const hourText = (h: number) => (h === 24 ? '자정' : h === 12 ? '낮 12시' : h < 12 ? `오전 ${h}시` : `오후 ${h - 12}시`)
// 손잡이 중심이 움직이는 구간(양끝 12px 안쪽)에 맞춘 위치 — ratio 0~1
const trackPos = (ratio: number) => `calc(12px + (100% - 24px) * ${ratio})`
const hourPos = (h: number) => trackPos((h - HOUR_MIN) / HOUR_SPAN)

function HourRange({ range: [start, end], onChange }: { range: [number, number]; onChange: (r: [number, number]) => void }) {
  const bucket = hourBucket(start)
  const update = (s: number, e: number) => onChange([s, e])
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <span style={{ font: '800 17px/1.2 var(--font)', letterSpacing: '-.02em', color: 'var(--ink)' }}>{hourText(start)} ~ {hourText(end)}</span>
        <span style={{ font: '600 12.5px/1 var(--font)', color: GREEN }}>{end - start}시간 · {labelOf(Q[2].opts, bucket)}</span>
      </div>
      <div className="pl-range">
        <div className="pl-range-track" />
        <div className="pl-range-fill" style={{ left: hourPos(start), width: `calc((100% - 24px) * ${(end - start) / HOUR_SPAN})` }} />
        <input
          type="range" min={HOUR_MIN} max={HOUR_MAX} step={1} value={start}
          aria-label="시작 시간" aria-valuetext={hourText(start)}
          style={{ zIndex: start >= HOUR_MAX - 1 ? 3 : 2 }} // 끝까지 밀었을 때 시작 손잡이가 아래에 깔리지 않게
          onChange={(e) => update(Math.min(Number(e.target.value), end - 1), end)}
        />
        <input
          type="range" min={HOUR_MIN} max={HOUR_MAX} step={1} value={end}
          aria-label="끝 시간" aria-valuetext={hourText(end)}
          onChange={(e) => update(start, Math.max(Number(e.target.value), start + 1))}
        />
      </div>
      <div className="pl-range-ticks" aria-hidden>
        {Array.from({ length: HOUR_SPAN + 1 }, (_, i) => HOUR_MIN + i).map((h) => (
          <span key={h} className={h % 3 === 0 ? 'major' : ''} style={{ left: hourPos(h) }}>
            {h % 3 === 0 && <em>{h}</em>}
          </span>
        ))}
      </div>
    </div>
  )
}

/* 1인 예산 막대 — 1만~20만원 5천원 단위, 1만원마다 눈금. 맨 오른쪽(20만원)은 '상관없음'(budget 0) */
const BUDGET_MIN = 10000, BUDGET_MAX = 200000, BUDGET_STEP = 5000
const manwon = (v: number) => `${v / 10000}만원`

function BudgetSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const at = value ? Math.min(Math.max(value, BUDGET_MIN), BUDGET_MAX) : BUDGET_MAX
  const unlimited = at >= BUDGET_MAX
  const ratio = (at - BUDGET_MIN) / (BUDGET_MAX - BUDGET_MIN)
  const text = unlimited ? '상관없음' : `${manwon(at)} 이하`
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <span style={{ font: '800 17px/1.2 var(--font)', letterSpacing: '-.02em', color: 'var(--ink)' }}>{text}</span>
        <span style={{ font: '600 12.5px/1 var(--font)', color: GREEN }}>{unlimited ? '끝까지 밀면 제한 없음' : '코스 전체 1인 기준'}</span>
      </div>
      <div className="pl-range">
        <div className="pl-range-track" />
        <div className="pl-range-fill" style={{ left: '12px', width: `calc((100% - 24px) * ${ratio})` }} />
        <input
          type="range" min={BUDGET_MIN} max={BUDGET_MAX} step={BUDGET_STEP} value={at}
          aria-label="1인 예산" aria-valuetext={text}
          onChange={(e) => {
            const v = Number(e.target.value)
            onChange(v >= BUDGET_MAX ? 0 : v)
          }}
        />
      </div>
      <div className="pl-range-ticks" aria-hidden>
        {Array.from({ length: (BUDGET_MAX - BUDGET_MIN) / 10000 + 1 }, (_, i) => BUDGET_MIN + i * 10000).map((v) => {
          const major = v === BUDGET_MIN || v % 50000 === 0
          return (
            <span key={v} className={major ? 'major' : ''} style={{ left: trackPos((v - BUDGET_MIN) / (BUDGET_MAX - BUDGET_MIN)) }}>
              {major && <em>{v === BUDGET_MAX ? '20만+' : v / 10000 + '만'}</em>}
            </span>
          )
        })}
      </div>
    </div>
  )
}

function Chip({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <div className="pl-chip" style={{ background: on ? GREEN : '#fff', borderColor: on ? GREEN : 'var(--ink-10)', color: on ? '#fff' : 'var(--ink-2)' }} onClick={onClick}>
      {label}
    </div>
  )
}
