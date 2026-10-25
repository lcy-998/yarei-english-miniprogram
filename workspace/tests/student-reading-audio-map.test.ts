import { describe, expect, it } from 'vitest'
import type { ReadingAudioMapView, ReadingResource } from '../miniprogram/subpackages/student/domain/types'
import { chapterIdForPage, clampReadingAudioPosition, hotspotsForPage, nextPointreadPage,
  validReadingAudioMap } from '../miniprogram/subpackages/student/reading-detail/reading-audio-map'

const resource: ReadingResource = {
  id: 'book_demo', title: 'A Day at the Zoo', category: 'picture', grade: '3', difficulty: '初级',
  contentVersion: 'v1', presentation: 'page_images_only',
  textVisibility: { ocrExposed: false, standaloneBodyExposed: false },
  chapters: [{ id: 'chapter_1', title: 'Chapter 1', order: 1, pages: [{ id: 'page_1',
    pageNumber: 1, order: 1, thumbnailAssetKey: 'thumb', imageAssetKey: 'page',
    width: 1000, height: 800, assetVersion: 'v1' }] }],
}
const map: ReadingAudioMapView = {
  resourceId: 'book_demo', sourceVersion: 'v1', chapterId: 'chapter_1', durationMs: 10000,
  playback: { temporaryUrl: 'https://example.invalid/temporary', expiresAt: '2026-10-04T10:00:00Z' },
  segments: [{ id: 'sentence_1', pageId: 'page_1', pageNumber: 1, text: 'The lion sleeps.',
    rect: { x: 0.2, y: 0.3, width: 0.4, height: 0.1 }, startMs: 1000, endMs: 3000 }],
}

describe('S-04 reviewed reading audio map', () => {
  it('finds the next reviewed pointread page without changing task ranges', () => {
    expect(nextPointreadPage([30, 4, 30, -1], 1)).toBe(4)
    expect(nextPointreadPage([30, 4], 4)).toBe(30)
    expect(nextPointreadPage([30, 4], 30)).toBe(4)
    expect(nextPointreadPage([], 1)).toBeNull()
  })
  it('accepts chapter listening audio without exposing a false pointread hotspot', () => {
    const chapterOnly = { ...map, segments: [] }
    expect(validReadingAudioMap(chapterOnly, resource, 'chapter_1')).toBe(true)
    expect(hotspotsForPage(chapterOnly, 1)).toEqual([])
  })
  it('binds only the current authorized resource version and page', () => {
    expect(chapterIdForPage(resource, 1)).toBe('chapter_1')
    expect(chapterIdForPage(resource, 2)).toBeNull()
    expect(validReadingAudioMap(map, resource, 'chapter_1')).toBe(true)
    expect(validReadingAudioMap({ ...map, sourceVersion: 'v0' }, resource, 'chapter_1')).toBe(false)
    expect(validReadingAudioMap({ ...map, segments: [{ ...map.segments[0]!, pageNumber: 2 }] },
      resource, 'chapter_1')).toBe(false)
  })

  it('rejects unsafe audio and out-of-page or out-of-duration segments', () => {
    expect(validReadingAudioMap({ ...map, playback: { ...map.playback!, temporaryUrl: 'cloud://private' } },
      resource, 'chapter_1')).toBe(false)
    expect(validReadingAudioMap({ ...map, segments: [{ ...map.segments[0]!,
      rect: { x: 0.8, y: 0.3, width: 0.4, height: 0.1 } }] }, resource, 'chapter_1')).toBe(false)
    expect(validReadingAudioMap({ ...map, segments: [{ ...map.segments[0]!, endMs: 11000 }] },
      resource, 'chapter_1')).toBe(false)
  })

  it('accepts reviewed page clips with their own timing and rejects unsafe or oversized clip references', () => {
    const clip = { ...map.segments[0]!, startMs: 0, endMs: 3000, clipDurationMs: 3200,
      clipPlayback: { temporaryUrl: 'https://example.invalid/page-01.mp3', expiresAt: '2026-10-04T10:00:00Z' } }
    const withClip = { ...map, segments: [clip] }
    expect(validReadingAudioMap(withClip, resource, 'chapter_1')).toBe(true)
    expect(hotspotsForPage(withClip, 1)[0]).toMatchObject({ clipPlayback: clip.clipPlayback,
      clipDurationMs: 3200 })
    expect(validReadingAudioMap({ ...map, segments: [{ ...clip, endMs: 3300 }] }, resource, 'chapter_1'))
      .toBe(false)
    expect(validReadingAudioMap({ ...map, segments: [{ ...clip, clipPlayback: {
      ...clip.clipPlayback, temporaryUrl: 'cloud://private/page.mp3' } }] }, resource, 'chapter_1'))
      .toBe(false)
  })

  it('projects normalized page rectangles and bounded resume position', () => {
    expect(hotspotsForPage(map, 1)).toEqual([{ id: 'sentence_1', pageNumber: 1,
      startMs: 1000, endMs: 3000, style: 'left:20.000%;top:30.000%;width:40.000%;height:10.000%;' }])
    expect(hotspotsForPage(map, 2)).toEqual([])
    expect(clampReadingAudioPosition(12000, 10000)).toBe(10000)
    expect(clampReadingAudioPosition(-10, 10000)).toBe(0)
  })
})
