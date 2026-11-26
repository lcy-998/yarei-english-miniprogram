import type { ReadingAudioMapView, ReadingResource } from '../../../domain/types'

export interface ReadingHotspotView {
  id: string
  pageNumber: number
  startMs: number
  endMs: number
  clipDurationMs?: number
  clipPlayback?: { temporaryUrl: string; expiresAt: string }
  style: string
}

export function chapterIdForPage(resource: ReadingResource, pageNumber: number): string | null {
  return resource.chapters.find(chapter => chapter.pages.some(page => page.pageNumber === pageNumber))?.id ?? null
}

export function nextPointreadPage(pages: readonly number[], currentPage: number): number | null {
  const ordered = [...new Set(pages.filter(page => Number.isSafeInteger(page) && page > 0))]
    .sort((left, right) => left - right)
  return ordered.find(page => page > currentPage) ?? ordered[0] ?? null
}

export function validReadingAudioMap(value: ReadingAudioMapView, resource: ReadingResource,
  chapterId: string): boolean {
  if (value.resourceId !== resource.id || value.sourceVersion !== resource.contentVersion
    || value.chapterId !== chapterId || !Number.isSafeInteger(value.durationMs)
    || (value.durationMs ?? 0) <= 0 || !value.playback?.temporaryUrl.startsWith('https://')
    || !Number.isFinite(Date.parse(value.playback.expiresAt))) return false
  const pages = new Map(resource.chapters.find(chapter => chapter.id === chapterId)?.pages
    .map(page => [page.id, page.pageNumber] as const) ?? [])
  return pages.size > 0 && value.segments.every(segment => pages.get(segment.pageId) === segment.pageNumber
    && Number.isSafeInteger(segment.startMs) && Number.isSafeInteger(segment.endMs)
    && segment.startMs >= 0 && segment.endMs > segment.startMs
    && (segment.clipPlayback
      ? Number.isSafeInteger(segment.clipDurationMs) && (segment.clipDurationMs ?? 0) >= 1000
        && segment.endMs <= (segment.clipDurationMs ?? 0)
        && segment.clipPlayback.temporaryUrl.startsWith('https://')
        && Number.isFinite(Date.parse(segment.clipPlayback.expiresAt))
      : segment.clipDurationMs === undefined && segment.endMs <= value.durationMs!)
    && [segment.rect.x, segment.rect.y, segment.rect.width, segment.rect.height]
      .every(part => Number.isFinite(part) && part >= 0 && part <= 1)
    && segment.rect.width > 0 && segment.rect.height > 0
    && segment.rect.x + segment.rect.width <= 1
    && segment.rect.y + segment.rect.height <= 1)
}

export function hotspotsForPage(map: ReadingAudioMapView, pageNumber: number): ReadingHotspotView[] {
  return map.segments.filter(segment => segment.pageNumber === pageNumber).map(segment => ({
    id: segment.id,
    pageNumber: segment.pageNumber,
    startMs: segment.startMs,
    endMs: segment.endMs,
    ...(segment.clipPlayback ? { clipDurationMs: segment.clipDurationMs,
      clipPlayback: segment.clipPlayback } : {}),
    style: `left:${(segment.rect.x * 100).toFixed(3)}%;top:${(segment.rect.y * 100).toFixed(3)}%;`
      + `width:${(segment.rect.width * 100).toFixed(3)}%;height:${(segment.rect.height * 100).toFixed(3)}%;`,
  }))
}

export function clampReadingAudioPosition(positionMs: number, durationMs: number): number {
  if (!Number.isFinite(positionMs) || !Number.isFinite(durationMs) || durationMs <= 0) return 0
  return Math.max(0, Math.min(Math.floor(positionMs), Math.floor(durationMs)))
}

/** Earliest reviewed segment time of one page, used to sync a manual page turn with chapter audio. */
export function pageAudioStartMs(map: ReadingAudioMapView, pageNumber: number): number | null {
  let startMs: number | null = null
  for (const segment of map.segments) {
    if (segment.pageNumber !== pageNumber || !Number.isSafeInteger(segment.startMs)) continue
    if (startMs === null || segment.startMs < startMs) startMs = segment.startMs
  }
  return startMs
}

/**
 * Page that the chapter audio is reading at `positionMs`. Segments are ordered by their own
 * start time, so pages without reviewed segments are skipped instead of stalling the follow.
 * `leadMs` lets the page image change just before its audio starts.
 */
export function pageNumberAtAudioPosition(map: ReadingAudioMapView, positionMs: number,
  leadMs = 0): number | null {
  const ordered = map.segments
    .filter(segment => Number.isSafeInteger(segment.pageNumber) && segment.pageNumber > 0
      && Number.isSafeInteger(segment.startMs))
    .slice().sort((left, right) => left.startMs - right.startMs || left.pageNumber - right.pageNumber)
  if (!ordered.length) return null
  const probeMs = Math.max(0, (Number.isFinite(positionMs) ? positionMs : 0) + leadMs)
  let pageNumber = ordered[0]!.pageNumber
  for (const segment of ordered) {
    if (segment.startMs > probeMs) break
    pageNumber = segment.pageNumber
  }
  return pageNumber
}

/**
 * Fallback for chapter tracks that were approved as continuous narration only (no per-page
 * segments, e.g. textbook units). Spreads the chapter pages evenly over the track duration so
 * the page image still advances with the audio instead of staying on the first page.
 */
export function pageNumberAtAudioProgress(pageNumbers: readonly number[], positionMs: number,
  durationMs: number | null, leadMs = 0): number | null {
  const ordered = orderedPageNumbers(pageNumbers)
  if (!ordered.length || !Number.isFinite(durationMs) || (durationMs ?? 0) <= 0) return null
  const progress = Math.max(0, Math.min(1, ((Number.isFinite(positionMs) ? positionMs : 0) + leadMs)
    / (durationMs as number)))
  const index = Math.min(ordered.length - 1, Math.floor(progress * ordered.length))
  return ordered[Math.max(0, index)]!
}

/** Inverse of the progress fallback, used when the student turns the page during continuous play. */
export function audioPositionForPageProgress(pageNumbers: readonly number[], pageNumber: number,
  durationMs: number | null): number | null {
  const ordered = orderedPageNumbers(pageNumbers)
  if (!ordered.length || !Number.isFinite(durationMs) || (durationMs ?? 0) <= 0) return null
  const index = ordered.indexOf(pageNumber)
  if (index < 0) return null
  return Math.floor((durationMs as number) * index / ordered.length)
}

function orderedPageNumbers(pageNumbers: readonly number[]): number[] {
  return [...new Set(pageNumbers.filter(page => Number.isSafeInteger(page) && page > 0))]
    .sort((left, right) => left - right)
}
