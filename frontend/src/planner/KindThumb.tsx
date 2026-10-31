// 장소 썸네일 — 업체 대표사진이 있으면 사진, 없거나 못 불러오면 종류별 기본 아이콘
import { useState } from 'react'
import { placeInfo } from './geo'

const THUMBS: Record<string, { bg: string; fg: string; d: string }> = {
  식사: { bg: '#FCEBDD', fg: '#C0622B', d: 'M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 3c-1.7 1.3-2.5 3.3-2.5 6v4H17v8' },
  카페: { bg: '#F1E6D6', fg: '#8A5A2B', d: 'M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9ZM17 11h1.5a2.5 2.5 0 0 1 0 5H17M8 3.5c0 1.5 1 1.5 1 3M12 3.5c0 1.5 1 1.5 1 3' },
  한잔: { bg: '#E9E4F3', fg: '#5B4B8A', d: 'M7 3h10l-.6 5.2A4.4 4.4 0 0 1 12 12a4.4 4.4 0 0 1-4.4-3.8L7 3ZM12 12v8M8.5 21h7' },
  체험: { bg: '#F3F6D2', fg: '#6B7A12', d: 'M12 3l1.9 4.6 4.6 1.9-4.6 1.9L12 16l-1.9-4.6-4.6-1.9 4.6-1.9ZM18 15l.8 1.7 1.7.8-1.7.8L18 20l-.8-1.7-1.7-.8 1.7-.8Z' },
  문화: { bg: '#E3EEF7', fg: '#3D6E99', d: 'M4 5h16v14H4ZM4 16l5-5 4 4 2-2 5 5M16 9.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z' },
  산책: { bg: '#FFEEE2', fg: '#E66A1F', d: 'M12 21v-6M12 15c-3.9 0-6-2.5-6-5.5C6 6 8.7 3 12 3s6 3 6 6.5c0 3-2.1 5.5-6 5.5ZM9 21h6' },
  운동: { bg: '#FDE8E6', fg: '#C0443A', d: 'M6.5 7v10M4 9.5v5M17.5 7v10M20 9.5v5M6.5 12h11' },
}

export default function KindThumb({ kind, size = 74, pid }: { kind: string; size?: number; pid?: string }) {
  const t = THUMBS[kind]
  const small = size < 40
  const icon = Math.round(size * (small ? 0.6 : 0.41))
  const img = placeInfo(pid)?.img
  const [broken, setBroken] = useState<string | null>(null)
  if (img && broken !== img) {
    return (
      <img
        className="pl-thumb pl-thumb-img"
        src={img}
        alt=""
        loading="lazy"
        onError={() => setBroken(img)}
        style={{ width: size, height: size, borderRadius: small ? 99 : Math.round(size * 0.19) }}
      />
    )
  }
  return (
    <div
      className="pl-thumb"
      style={{ width: size, height: size, borderRadius: small ? 99 : Math.round(size * 0.19), ...(t && { background: t.bg, color: t.fg }) }}
      aria-hidden
    >
      {t && (
        <svg viewBox="0 0 24 24" width={icon} height={icon} fill="none" stroke="currentColor" strokeWidth={small ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d={t.d} />
        </svg>
      )}
    </div>
  )
}
