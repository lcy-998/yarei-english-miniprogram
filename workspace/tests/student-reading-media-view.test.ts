import { describe, expect, it } from 'vitest'
import { segmentsForPage, validDemonstrationAudio } from '../miniprogram/shared/reading-media-view'
import type { ReadingPronunciationSegment } from '../miniprogram/subpackages/student/services/student-pronunciation-service'

const segments: ReadingPronunciationSegment[] = [
  { id: 'segment_1', text: 'Hello.', pageNumber: 1,
    demonstrationAudio: { temporaryUrl: 'https://example.invalid/one', expiresAt: '2026-10-02T12:00:00Z' } },
  { id: 'segment_2', text: 'Goodbye.', pageNumber: 2,
    demonstrationAudio: { temporaryUrl: 'https://example.invalid/two', expiresAt: '2026-10-02T12:00:00Z' } },
]

describe('S-04 authorized sentence projection', () => {
  it('shows only the current page sentence without changing its signed media', () => {
    expect(segmentsForPage(segments, 1)).toEqual([segments[0]])
    expect(segmentsForPage(segments, 3)).toEqual([])
  })

  it('requires a nonempty unexpired signed demonstration URL', () => {
    expect(validDemonstrationAudio(segments[0]!, Date.parse('2026-10-02T11:59:59Z'))).toBe(true)
    expect(validDemonstrationAudio(segments[0]!, Date.parse('2026-10-02T12:00:00Z'))).toBe(false)
    expect(validDemonstrationAudio({ ...segments[0]!, demonstrationAudio: { temporaryUrl: '', expiresAt: '2026-10-02T12:00:00Z' } }, 0)).toBe(false)
    expect(validDemonstrationAudio({ ...segments[0]!, demonstrationAudio: { temporaryUrl: 'cloud://private/file', expiresAt: '2026-10-02T12:00:00Z' } }, 0)).toBe(false)
  })
})
