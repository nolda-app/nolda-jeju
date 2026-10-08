import type { BuiltCourse } from '../planner/logic'

/* ── 저장한 코스 ───────────────────────────────────────────── */
export function SavedTab({ savedBuilt, people, openCourse, remove, goSearch }: {
  savedBuilt: BuiltCourse[]
  people: number
  openCourse: (id: string) => void
  remove: (id: string) => void
  goSearch: () => void
}) {
  const countLine = savedBuilt.length ? `${savedBuilt.length}개 · 인원 ${people}명 기준 금액` : '아직 비어 있어요'
  return (
    <div className="pl-screen">
      <div style={{ flex: 'none', padding: '22px 20px 16px' }}>
        <div style={{ font: '400 11.5px/1 var(--font)', color: 'var(--ink-45)' }}>{countLine}</div>
        <div className="pl-h1" style={{ marginTop: 8 }}>저장한 코스</div>
      </div>
      <div className="pl-scroll" style={{ padding: '0 20px 96px' }}>
        {savedBuilt.length === 0 && (
          <div style={{ marginTop: 60, textAlign: 'center', padding: '0 24px' }}>
            <div className="pl-emptyicon">♡</div>
            <div style={{ font: '800 18px/1.35 var(--font)', color: 'var(--ink)' }}>아직 저장한 코스가 없어요</div>
            <div style={{ marginTop: 8, font: '400 13px/1.7 var(--font)', color: 'var(--ink-45)' }}>마음에 드는 코스를 열어서<br />'이 코스로 저장'을 눌러두면 여기 모여요</div>
            <div className="pl-cta" style={{ display: 'inline-block', marginTop: 20, padding: '14px 22px' }} onClick={goSearch}>코스 찾아보기</div>
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {savedBuilt.map((s) => (
            <div key={s.id} className="pl-savedcard">
              <div style={{ cursor: 'pointer', padding: '18px 18px 14px' }} onClick={() => openCourse(s.id)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
                  <span className="pl-matchtag" style={{ background: s.tintBg, color: s.tintFg }}>{s.matchLabel}</span>
                  <span style={{ font: '500 11.5px/1 var(--font)', color: 'var(--ink-45)' }}>{s.area} · {s.moveLine}</span>
                  <span style={{ marginLeft: 'auto', font: '700 12.5px/1 var(--font)', color: 'var(--ink)' }}>{s.costLabel}</span>
                </div>
                <div className="pl-coursetitle">{s.title}</div>
                <div style={{ marginTop: 9, display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {s.items.slice(0, 3).map((it, i) => (
                    <div key={i} style={{ display: 'flex', gap: 9, alignItems: 'baseline' }}>
                      <span style={{ flex: 'none', width: 38, font: '700 11.5px/1.5 var(--font)', color: 'var(--ink-45)' }}>{it.time}</span>
                      <span style={{ font: '500 12.5px/1.5 var(--font)', color: 'var(--ink-60)' }}>{it.name}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', borderTop: '1px solid var(--ink-06)' }}>
                <div style={{ flex: 1, padding: 14, textAlign: 'center', font: '600 13px/1 var(--font)', color: 'var(--ink-60)', cursor: 'pointer' }} onClick={() => openCourse(s.id)}>전체 일정</div>
                <div style={{ width: 1, background: 'var(--ink-06)' }} />
                <div style={{ flex: 'none', padding: '14px 20px', textAlign: 'center', font: '600 13px/1 var(--font)', color: '#c3503f', cursor: 'pointer' }} onClick={() => remove(s.id)}>저장 취소</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
