import { describe, expect, it } from 'vitest'
import { hasUnreleasedMediaItem } from '../miniprogram/shared/task-detail-view'

describe('S-09 media release gate', () => {
  it('keeps missing snapshots and unknown task types read only', () => {
    expect(hasUnreleasedMediaItem({ items: [{ type: 'reading' }, { type: 'recording' }] })).toBe(false)
    expect(hasUnreleasedMediaItem({ items: [{ type: 'listening' }] })).toBe(true)
    expect(hasUnreleasedMediaItem({ items: [{ type: 'video' }] })).toBe(true)
    expect(hasUnreleasedMediaItem({ items: [{ type: 'video_dubbing' }] })).toBe(true)
  })

  it('permits only a frozen cloud media snapshot to reach the server evidence checks', () => {
    const snapshot = { kind: 'listening' as const, mediaId: 'media_1', mediaVersion: 2,
      reviewVersion: 1, durationMs: 1000, questionIds: [], questions: [], clips: [],
      subtitleAvailable: false, continuousPlaybackEnforced: true as const }
    expect(hasUnreleasedMediaItem({ items: [{ type: 'listening', mediaSnapshot: snapshot }] }, true)).toBe(false)
    expect(hasUnreleasedMediaItem({ items: [{ type: 'listening', mediaSnapshot: snapshot }] })).toBe(true)
    expect(hasUnreleasedMediaItem({ items: [{ type: 'video', mediaSnapshot: snapshot }] }, true)).toBe(true)
  })
})
