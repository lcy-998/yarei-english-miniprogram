import { afterEach, describe, expect, it, vi } from 'vitest'

const getReadingResource = vi.fn()
const getReadingAudioMap = vi.fn()
const getReadingPronunciationSegments = vi.fn()
const setReadingPage = vi.fn()
const toggleReadingFavorite = vi.fn()
vi.mock('../../miniprogram/subpackages/student/services/app-service', async importOriginal => ({
  ...await importOriginal<typeof import('../../miniprogram/subpackages/student/services/app-service')>(),
  getReadingResource, getReadingAudioMap,
}))
vi.mock('../../miniprogram/subpackages/student/services/student-pronunciation-service', async importOriginal => ({
  ...await importOriginal<typeof import('../../miniprogram/subpackages/student/services/student-pronunciation-service')>(),
  getReadingPronunciationSegments,
}))
vi.mock('../../miniprogram/subpackages/student/services/m1-app-service', async importOriginal => ({
  ...await importOriginal<typeof import('../../miniprogram/subpackages/student/services/m1-app-service')>(),
  setReadingPage, toggleReadingFavorite,
}))

describe('S-04 teacher content preview', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); vi.clearAllMocks() })

  it('uses signed book pages and never saves student reading progress', async () => {
    let definition: { data: Record<string, unknown>; methods: Record<string, (...args: never[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    const audio = { play: vi.fn(), pause: vi.fn(), destroy: vi.fn(), seek: vi.fn(),
      onTimeUpdate: vi.fn(), onEnded: vi.fn(), onError: vi.fn(), onCanplay: vi.fn(),
      playbackRate: 1, src: '', currentTime: 0 }
    vi.stubGlobal('wx', { getStorageSync: () => ({ sessionId: 'teacher_session', activeRole: 'teacher',
      user: { id: 'teacher_demo', role: 'teacher' } }), createInnerAudioContext: () => audio })
    getReadingResource.mockResolvedValue({ ok: true, data: { id: 'book_demo', title: '虚构绘本',
      category: 'picture_book', grade: '三年级', difficulty: '基础', contentVersion: 'v1',
      chapters: [{ id: 'chapter_1', title: '第一章', order: 1, pages: [
        { id: 'page_1', pageNumber: 1, order: 1, imageAssetKey: 'https://example.test/1.jpg',
          thumbnailAssetKey: 'https://example.test/1-thumb.jpg' },
        { id: 'page_2', pageNumber: 2, order: 2, imageAssetKey: 'https://example.test/2.jpg',
          thumbnailAssetKey: 'https://example.test/2-thumb.jpg' },
      ] }] } })
    getReadingAudioMap.mockResolvedValue({ ok: true, data: {
      resourceId: 'book_demo', sourceVersion: 'v1', chapterId: 'chapter_1', durationMs: 20000,
      playback: { temporaryUrl: 'https://example.test/chapter.mp3', expiresAt: '2099-01-01T00:00:00Z' },
      segments: [1, 2].map(pageNumber => ({ id: `hotspot_${pageNumber}`,
        pageId: `page_${pageNumber}`, pageNumber, startMs: 0, endMs: 2000,
        clipDurationMs: 2000, clipPlayback: { temporaryUrl: `https://example.test/${pageNumber}.mp3`,
          expiresAt: '2099-01-01T00:00:00Z' },
        rect: { x: 0.1, y: 0.1, width: 0.3, height: 0.2 } })) } })
    getReadingPronunciationSegments.mockResolvedValue({ ok: true,
      data: { resourceId: 'book_demo', sourceVersion: 'v1', segments: [] } })
    await import('../../miniprogram/subpackages/student/reading-detail/reading-detail')
    if (!definition) throw new Error('S-04 page unavailable')
    const context = { data: { ...definition.data, teacherPreviewMode: true,
      teacherPreviewResourceId: 'book_demo' },
      setData(change: Record<string, unknown>, callback?: () => void) {
        Object.assign(this.data, change); callback?.()
      } }
    Object.assign(context, definition.methods)
    await context.loadTeacherPreview()
    expect(getReadingResource).toHaveBeenCalledWith('teacher_demo', 'book_demo')
    expect(context.data).toMatchObject({ teacherPreviewSessionId: 'teacher_session',
      displayPageNumber: 1, reading: { hasSavedProgress: false } })
    await vi.waitFor(() => expect(getReadingPronunciationSegments).toHaveBeenCalledWith('teacher_demo', 'book_demo'))
    await vi.waitFor(() => expect(getReadingAudioMap).toHaveBeenCalledWith('teacher_demo', 'book_demo', 'chapter_1'))
    await vi.waitFor(() => expect(context.data.pageHotspots).toMatchObject([{ id: 'hotspot_1' }]))
    await context.playPointread({ currentTarget: { dataset: { id: 'hotspot_1' } } })
    expect(audio.play).toHaveBeenCalled()
    expect(audio.src).toBe('https://example.test/1.mp3')
    await context.imageLoaded()
    await context.changePage(1)
    await vi.waitFor(() => expect(context.data.pageHotspots).toMatchObject([{ id: 'hotspot_2' }]))
    expect(audio.destroy).toHaveBeenCalled()
    await context.toggleFavorite()
    expect(context.data.displayPageNumber).toBe(2)
    expect(setReadingPage).not.toHaveBeenCalled()
    expect(toggleReadingFavorite).not.toHaveBeenCalled()
  })
})
