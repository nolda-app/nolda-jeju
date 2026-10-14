// 고른 사진 → 백엔드로 보낼 최소한의 데이터 (촬영 시각 · 좌표 · 512px로 줄인 이미지)
// 원본은 보내지 않는다. 줄인 이미지는 취향 분석 1회에만 쓰고 서버에 저장하지 않음.

export interface PhotoMeta {
  ts: string | null
  lat: number | null
  lng: number | null
  b64: string
}

const MAX_SIDE = 512 // 긴 변 기준 — Vision detail:low가 보는 해상도에 맞춤
const QUALITY = 0.7
export const PHOTO_LIMIT = 12 // 분석 비용 상한 (backend/taste.py와 같은 값)

/** PHOTO_LIMIT 장을 넘으면 앞뒤로 치우치지 않게 고르게 솎는다 */
export function thin<T>(items: T[]): T[] {
  if (items.length <= PHOTO_LIMIT) return items
  const step = items.length / PHOTO_LIMIT
  return Array.from({ length: PHOTO_LIMIT }, (_, i) => items[Math.floor(i * step)])
}

async function shrink(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()
  return canvas.toDataURL('image/jpeg', QUALITY)
}

/** 브라우저가 실제로 디코딩할 수 있는 사진만 남긴다.
 * 아이폰 HEIC는 크롬·파이어폭스가 못 읽어서 고르는 시점에 걸러야 한다
 * (분석 단계에서 조용히 빠지면 "12장 분석 중"이라고 해놓고 0장을 보내게 된다) */
export async function keepReadable(files: File[]): Promise<{ ok: File[]; bad: File[] }> {
  const checked = await Promise.all(files.map(async (f) => {
    try {
      const bmp = await createImageBitmap(f)
      bmp.close()
      return { f, ok: true }
    } catch {
      return { f, ok: false }
    }
  }))
  return { ok: checked.filter((c) => c.ok).map((c) => c.f), bad: checked.filter((c) => !c.ok).map((c) => c.f) }
}

/** EXIF 촬영 시각·GPS를 읽고 이미지를 줄인다. 한 장이 실패해도 나머지는 계속 */
export async function readPhotos(files: File[]): Promise<PhotoMeta[]> {
  const { default: exifr } = await import('exifr') // 사진을 고를 때만 받는다
  const out = await Promise.all(
    thin(files).map(async (f): Promise<PhotoMeta | null> => {
      try {
        const [exif, b64] = await Promise.all([
          exifr.parse(f, { pick: ['DateTimeOriginal', 'CreateDate', 'latitude', 'longitude'] }).catch(() => null),
          shrink(f),
        ])
        const taken: Date | undefined = exif?.DateTimeOriginal || exif?.CreateDate
        return {
          // EXIF에 촬영 시각이 없으면 파일 수정 시각으로 대신 (보통 내려받은 사진)
          ts: (taken instanceof Date ? taken : new Date(f.lastModified)).toISOString(),
          lat: typeof exif?.latitude === 'number' ? exif.latitude : null,
          lng: typeof exif?.longitude === 'number' ? exif.longitude : null,
          b64,
        }
      } catch {
        return null
      }
    }),
  )
  return out.filter((p): p is PhotoMeta => p !== null)
}
