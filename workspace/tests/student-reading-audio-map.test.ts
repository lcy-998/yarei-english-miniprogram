import { describe, expect, it } from 'vitest'
import type { ReadingAudioMapView, ReadingResource } from '../miniprogram/subpackages/student/domain/types'
import { audioPositionForPageProgress, chapterIdForPage, clampReadingAudioPosition, hotspotsForPage,
  nextPointreadPage, pageAudioStartMs, pageNumberAtAudioPosition, pageNumberAtAudioProgress,
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

  it('follows the page that the chapter audio is reading, including silent gaps between pages', () => {
    const chapter: ReadingAudioMapView = { ...map, durationMs: 30000, segments: [
      { ...map.segments[0]!, id: 's11', pageNumber: 1, pageId: 'page_1', startMs: 500, endMs: 2000 },
      { ...map.segments[0]!, id: 's12', pageNumber: 1, pageId: 'page_1', startMs: 2200, endMs: 4000 },
      { ...map.segments[0]!, id: 's2', pageNumber: 2, pageId: 'page_2', startMs: 5000, endMs: 8000 },
      { ...map.segments[0]!, id: 's3', pageNumber: 3, pageId: 'page_3', startMs: 9000, endMs: 12000 },
    ] }
    expect(pageNumberAtAudioPosition(chapter, 0)).toBe(1)
    expect(pageNumberAtAudioPosition(chapter, 1000)).toBe(1)
    expect(pageNumberAtAudioPosition(chapter, 4100)).toBe(1)
    expect(pageNumberAtAudioPosition(chapter, 4999)).toBe(1)
    expect(pageNumberAtAudioPosition(chapter, 5000)).toBe(2)
    expect(pageNumberAtAudioPosition(chapter, 8500)).toBe(2)
    expect(pageNumberAtAudioPosition(chapter, 9000)).toBe(3)
    expect(pageNumberAtAudioPosition(chapter, 29000)).toBe(3)
    expect(pageNumberAtAudioPosition(chapter, 4800, 250)).toBe(2)
    expect(pageNumberAtAudioPosition({ ...chapter, segments: [] }, 1000)).toBeNull()
  })

  it('reports the first reviewed audio cue of a page for manual page turns', () => {
    const chapter: ReadingAudioMapView = { ...map, segments: [
      { ...map.segments[0]!, id: 'later', pageNumber: 2, startMs: 6000, endMs: 7000 },
      { ...map.segments[0]!, id: 'earlier', pageNumber: 2, startMs: 4000, endMs: 5000 },
      { ...map.segments[0]!, id: 'other', pageNumber: 1, startMs: 1000, endMs: 2000 },
    ] }
    expect(pageAudioStartMs(chapter, 2)).toBe(4000)
    expect(pageAudioStartMs(chapter, 1)).toBe(1000)
    expect(pageAudioStartMs(chapter, 9)).toBeNull()
  })

  it('advances a continuous narration track page by page without reviewed segments', () => {
    expect(pageNumberAtAudioProgress([3, 1, 2], 0, 9000)).toBe(1)
    expect(pageNumberAtAudioProgress([1, 2, 3], 3000, 9000)).toBe(2)
    expect(pageNumberAtAudioProgress([1, 2, 3], 6000, 9000)).toBe(3)
    expect(pageNumberAtAudioProgress([1, 2, 3], 9000, 9000)).toBe(3)
    expect(pageNumberAtAudioProgress([1, 2, 3], 2999, 9000, 1)).toBe(2)
    expect(pageNumberAtAudioProgress([], 1000, 9000)).toBeNull()
    expect(pageNumberAtAudioProgress([1], 1000, 0)).toBeNull()
    expect(audioPositionForPageProgress([1, 2, 3], 2, 9000)).toBe(3000)
    expect(audioPositionForPageProgress([1, 2, 3], 3, 9000)).toBe(6000)
    expect(audioPositionForPageProgress([1, 2, 3], 9, 9000)).toBeNull()
  })
})
