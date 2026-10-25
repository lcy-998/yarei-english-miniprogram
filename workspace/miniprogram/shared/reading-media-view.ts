import type { ReadingPronunciationSegment } from '../services/student-pronunciation-service'

export function segmentsForPage(segments: readonly ReadingPronunciationSegment[],
  pageNumber: number): ReadingPronunciationSegment[] {
  return segments.filter(segment => segment.pageNumber === pageNumber)
}

export function validDemonstrationAudio(segment: ReadingPronunciationSegment, nowMs: number): boolean {
  return segment.demonstrationAudio.temporaryUrl.startsWith('https://')
    && Number.isFinite(Date.parse(segment.demonstrationAudio.expiresAt))
    && Date.parse(segment.demonstrationAudio.expiresAt) > nowMs
}
