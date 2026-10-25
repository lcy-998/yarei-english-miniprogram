import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReadingAudioMapView, ReadingResource } from '../../miniprogram/subpackages/student/domain/types'
const getReadingAudioMap = vi.fn()
const getHistoricalTaskLearning = vi.fn()
const getReadingPronunciationSegments = vi.fn()

const resource: ReadingResource = {
  id: 'book_demo', title: 'A Day at the Zoo', category: 'picture', grade: '3', difficulty: '初级',
  contentVersion: 'v1', presentation: 'page_images_only',
  textVisibility: { ocrExposed: false, standaloneBodyExposed: false },
  chapters: [{ id: 'chapter_1', title: 'Chapter 1', order: 1, pages: [{ id: 'page_1',
    pageNumber: 1, order: 1, thumbnailAssetKey: 'thumb', imageAssetKey: 'page',
    width: 1000, height: 800, assetVersion: 'v1' }, { id: 'page_2',
    pageNumber: 2, order: 2, thumbnailAssetKey: 'thumb2', imageAssetKey: 'page2',
    width: 1000, height: 800, assetVersion: 'v1' }] }],
}
const audioMap: ReadingAudioMapView = {
  resourceId: 'book_demo', sourceVersion: 'v1', chapterId: 'chapter_1', durationMs: 10000,
  playback: { temporaryUrl: 'https://example.invalid/signed', expiresAt: '2099-01-01T00:00:00Z' },
  segments: [{ id: 'segment_1', pageId: 'page_1', pageNumber: 1, text: 'The lion sleeps.',
    rect: { x: 0.2, y: 0.3, width: 0.4, height: 0.1 }, startMs: 1000, endMs: 3000 }],
}

vi.mock('../../miniprogram/subpackages/student/services/app-service', () => ({
  getReadingResource: vi.fn(async () => ({ ok: true, data: resource })),
  getReadingAudioMap,
  getHistoricalTaskLearning,
}))
vi.mock('../../miniprogram/subpackages/student/services/m1-app-service', () => ({
  getReadingProgress: vi.fn(), setReadingPage: vi.fn(), toggleReadingFavorite: vi.fn(),
}))
vi.mock('../../miniprogram/subpackages/student/services/student-pronunciation-service', () => ({
  getReadingPronunciationSegments,
}))
vi.mock('../../miniprogram/subpackages/student/session/session', () => ({
  getSession: () => ({ sessionId: 'session_demo', user: { id: 'student_demo', role: 'student' } }),
  getCurrentBookId: () => 'book_demo', setCurrentTaskId: vi.fn(),
}))

describe('S-04 reviewed chapter audio', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); getReadingAudioMap.mockReset();
    getHistoricalTaskLearning.mockReset(); getReadingPronunciationSegments.mockReset() })

  it('protects every visible follow-reading recording before leaving the page', async () => {
    let definition: { data: Record<string, unknown>; methods: Record<string, (...args: never[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    const showToast = vi.fn(), showActionSheet = vi.fn()
    vi.stubGlobal('wx', { showToast, showActionSheet })
    await import('../../miniprogram/subpackages/student/reading-detail/reading-detail')
    if (!definition) throw new Error('Reading detail was not registered')
    const saveFirst = vi.fn(), saveSecond = vi.fn(), discardFirst = vi.fn(), discardSecond = vi.fn()
    const first = { hasActiveRecording: vi.fn(() => false), hasUnsubmittedRecording: vi.fn(() => true),
      rememberDraft: saveFirst, discardLocalDraft: discardFirst }
    const second = { hasActiveRecording: vi.fn(() => false), hasUnsubmittedRecording: vi.fn(() => true),
      rememberDraft: saveSecond, discardLocalDraft: discardSecond }
    const context = { data: { ...definition.data }, selectAllComponents: vi.fn(() => [first, second]),
      setData(change: Record<string, unknown>) { Object.assign(this.data, change) } }
    Object.assign(context, definition.methods)
    const leave = vi.fn()
    first.hasActiveRecording.mockReturnValue(true)
    context.confirmFollowReadingLeave(leave)
    expect(showToast).toHaveBeenCalledOnce()
    expect(showActionSheet).not.toHaveBeenCalled()
    first.hasActiveRecording.mockReturnValue(false)
    showActionSheet.mockImplementationOnce(({ success }) => success({ tapIndex: 0 }))
    context.confirmFollowReadingLeave(leave)
    expect(saveFirst).toHaveBeenCalledOnce()
    expect(saveSecond).toHaveBeenCalledOnce()
    expect(leave).toHaveBeenCalledOnce()
    showActionSheet.mockImplementationOnce(({ success }) => success({ tapIndex: 1 }))
    context.confirmFollowReadingLeave(leave)
    expect(discardFirst).toHaveBeenCalledOnce()
    expect(discardSecond).toHaveBeenCalledOnce()
  })

  it('shows only mapped page hotspots and stops point-read at the signed clip end', async () => {
    getReadingAudioMap.mockResolvedValue({ ok: true, data: audioMap })
    let definition: { data: Record<string, unknown>; methods: Record<string, (...args: never[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    const seek = vi.fn(), play = vi.fn(), pause = vi.fn(), destroy = vi.fn()
    let onTimeUpdate: (() => void) | null = null
    const audio = { src: '', playbackRate: 1, currentTime: 0, duration: 10, seek, play, pause, destroy,
      onCanplay: vi.fn(), onTimeUpdate: (listener: () => void) => { onTimeUpdate = listener },
      onEnded: vi.fn(), onError: vi.fn() }
    const setStorageSync = vi.fn()
    vi.stubGlobal('wx', { createInnerAudioContext: () => audio,
      getStorageSync: vi.fn(() => 0), setStorageSync,
      showActionSheet: ({ success }: { success: (result: { tapIndex: number }) => void }) =>
        success({ tapIndex: 0 }) })
    await import('../../miniprogram/subpackages/student/reading-detail/reading-detail')
    if (!definition) throw new Error('Reading detail was not registered')
    const context = { data: { ...definition.data, reading: { book: { id: 'book_demo' } } },
      setData(change: Record<string, unknown>, callback?: () => void) { Object.assign(this.data, change); callback?.() } }
    Object.assign(context, definition.methods)

    await context.loadReadingAudioMap('book_demo', 1)
    expect(context.data.audioMapReady).toBe(true)
    expect(context.data.pageHotspots).toMatchObject([{ id: 'segment_1', startMs: 1000, endMs: 3000 }])
    await context.playPointread({ currentTarget: { dataset: { id: 'segment_1' } } })
    expect(seek).toHaveBeenCalledWith(1)
    expect(play).toHaveBeenCalledOnce()
    expect(context.data.activeHotspotId).toBe('segment_1')
    audio.currentTime = 3.1
    onTimeUpdate?.()
    expect(pause).toHaveBeenCalledOnce()
    expect(context.data.activeHotspotId).toBe('')
    await context.enterEarMode()
    expect(context.data.mediaPlaying).toBe(true)
    expect(context.data.earMode).toBe(true)
    context.exitEarMode()
    expect(context.data.earMode).toBe(false)
    expect(context.data.mediaPlaying).toBe(true)
    await context.toggleChapterPlayback()
    expect(context.data.mediaPlaying).toBe(false)
    await context.enterEarMode()
    expect(context.data.earMode).toBe(true)
    expect(context.data.mediaPlaying).toBe(true)
    await context.toggleChapterPlayback()
    context.data.chapterPositionMs = 10000
    await context.toggleChapterPlayback()
    expect(context.data.chapterPositionMs).toBe(0)
    expect(seek).toHaveBeenLastCalledWith(0)
    context.cycleMediaSpeed()
    expect(audio.playbackRate).toBe(0.75)
    expect(setStorageSync).toHaveBeenCalledWith('learning_audio_speed_student_demo', 0.75)
    context.data.reading = { book: { id: 'book_demo' }, pages: [{ pageNumber: 1, chapterNumber: 1,
      imageUrl: 'one', thumbnailUrl: 'one-thumb' }, { pageNumber: 2, chapterNumber: 1,
      imageUrl: 'two', thumbnailUrl: 'two-thumb' }] }
    context.data.imageLoading = false
    await context.changePage(1)
    expect(context.data.displayPageNumber).toBe(2)
    expect(context.data.mediaPlaying).toBe(true)
    expect(destroy).not.toHaveBeenCalled()
  })

  it('starts chapter audio directly on a page without point-read hotspots', async () => {
    getReadingAudioMap.mockResolvedValue({ ok: true, data: audioMap })
    let definition: { data: Record<string, unknown>; methods: Record<string, (...args: never[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    const play = vi.fn(), pause = vi.fn()
    vi.stubGlobal('wx', { createInnerAudioContext: () => ({ src: '', playbackRate: 1,
      seek: vi.fn(), play, pause, destroy: vi.fn(), onCanplay: vi.fn(), onTimeUpdate: vi.fn(),
      onEnded: vi.fn(), onError: vi.fn() }), getStorageSync: vi.fn(() => 0),
      setStorageSync: vi.fn() })
    await import('../../miniprogram/subpackages/student/reading-detail/reading-detail')
    if (!definition) throw new Error('Reading detail was not registered')
    const context = { data: { ...definition.data, reading: { book: { id: 'book_demo' } } },
      setData(change: Record<string, unknown>, callback?: () => void) { Object.assign(this.data, change); callback?.() } }
    Object.assign(context, definition.methods)
    await context.loadReadingAudioMap('book_demo', 1)
    context.data.pageHotspots = []
    expect(context.data.audioMode).toBe('none')
    await context.toggleChapterPlayback()
    expect(context.data).toMatchObject({ audioMode: 'chapter', mediaPlaying: true })
    expect(play).toHaveBeenCalledOnce()
    await context.toggleChapterPlayback()
    expect(context.data.mediaPlaying).toBe(false)
    expect(pause).toHaveBeenCalledOnce()
  })

  it('updates task ear-mode progress from playback and only seeks within already played audio', async () => {
    let definition: { data: Record<string, unknown>; methods: Record<string, (...args: never[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    let onTimeUpdate: (() => void) | undefined
    const seek = vi.fn(), play = vi.fn(), pause = vi.fn(), showToast = vi.fn()
    const audio = { src: '', currentTime: 0, duration: 10, playbackRate: 1, seek, play, pause,
      destroy: vi.fn(), onCanplay: vi.fn(), onTimeUpdate: (handler: () => void) => { onTimeUpdate = handler },
      onEnded: vi.fn(), onError: vi.fn() }
    vi.stubGlobal('wx', { createInnerAudioContext: () => audio, getStorageSync: () => 0,
      setStorageSync: vi.fn(), showToast })
    await import('../../miniprogram/subpackages/student/reading-detail/reading-detail')
    if (!definition) throw new Error('Reading detail was not registered')
    const context = { data: { ...definition.data, taskMode: true,
      reading: { book: { id: resource.id } }, readingResource: resource },
    setData(change: Record<string, unknown>, done?: () => void) { Object.assign(this.data, change); done?.() } }
    Object.assign(context, definition.methods)
    context.data.audioMap = audioMap
    context.data.audioMapReady = true
    await context.enterEarMode()
    audio.currentTime = 4
    onTimeUpdate?.()
    expect(context.data.mediaProgress).toBe(40)
    await context.seekMedia({ detail: { value: 20 } })
    expect(seek).toHaveBeenLastCalledWith(2)
    await context.seekMedia({ detail: { value: 80 } })
    expect(seek).toHaveBeenLastCalledWith(4)
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: '任务音频只能拖回已播放位置' }))
    context.onFollowReadingRecordingStart()
    expect(pause).toHaveBeenCalledOnce()
    await context.toggleChapterPlayback()
    expect(play).toHaveBeenCalledOnce()
    context.onFollowReadingRecordingEnd()
    await context.toggleChapterPlayback()
    expect(play).toHaveBeenCalledTimes(2)
  })


  it('starts ear mode for an authorized task snapshot and refreshes its expired chapter URL', async () => {
    const freshMap = { ...audioMap, playback: { temporaryUrl: 'https://example.invalid/refreshed',
      expiresAt: '2099-01-01T00:00:00Z' } }
    getHistoricalTaskLearning.mockResolvedValue({ ok: true, data: { resourceId: resource.id,
      reading: resource, audioMaps: [freshMap] } })
    let definition: { data: Record<string, unknown>; methods: Record<string, (...args: never[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    const play = vi.fn()
    vi.stubGlobal('wx', { createInnerAudioContext: () => ({ src: '', playbackRate: 1,
      seek: vi.fn(), play, pause: vi.fn(), destroy: vi.fn(), onCanplay: vi.fn(),
      onTimeUpdate: vi.fn(), onEnded: vi.fn(), onError: vi.fn() }),
    getStorageSync: vi.fn(() => 0), setStorageSync: vi.fn() })
    await import('../../miniprogram/subpackages/student/reading-detail/reading-detail')
    if (!definition) throw new Error('Reading detail was not registered')
    const context = { data: { ...definition.data, taskMode: true, taskId: 'task_demo',
      taskItemId: 'item_demo', reading: { book: { id: resource.id } }, readingResource: resource,
      audioMap: { ...audioMap, playback: { ...audioMap.playback,
        expiresAt: '2020-01-01T00:00:00Z' } }, audioMapReady: true },
    setData(change: Record<string, unknown>, callback?: () => void) { Object.assign(this.data, change); callback?.() } }
    Object.assign(context, definition.methods)
    await context.enterEarMode()
    expect(context.data).toMatchObject({ earMode: true, mediaPlaying: true,
      audioMap: { playback: { temporaryUrl: 'https://example.invalid/refreshed' } } })
    expect(play).toHaveBeenCalledOnce()
    expect(getHistoricalTaskLearning).toHaveBeenCalledWith('student_demo', 'task_demo', 'item_demo')
    expect(getReadingAudioMap).not.toHaveBeenCalled()
  })

  it('shows ear mode and a retryable explanation when chapter playback cannot start', async () => {
    let definition: { data: Record<string, unknown>; methods: Record<string, (...args: never[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    vi.stubGlobal('wx', {})
    await import('../../miniprogram/subpackages/student/reading-detail/reading-detail')
    if (!definition) throw new Error('Reading detail was not registered')
    const context = { data: { ...definition.data, audioMap, audioMapReady: true },
      setData(change: Record<string, unknown>) { Object.assign(this.data, change) },
      toggleChapterPlayback: vi.fn(async () => {}) }
    Object.assign(context, definition.methods)
    context.toggleChapterPlayback = vi.fn(async () => {})
    await context.enterEarMode()
    expect(context.data).toMatchObject({ earMode: true,
      mediaError: '章节音频暂未能播放，请重试' })
  })

  it('keeps the page image readable and offers a retry after audio service failure', async () => {
    let definition: { data: Record<string, unknown>; methods: Record<string, (...args: never[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    vi.stubGlobal('wx', {})
    getReadingAudioMap.mockResolvedValueOnce({ ok: false,
      error: { code: 'SERVICE_UNAVAILABLE', message: '未部署', retryable: true } })
      .mockResolvedValueOnce({ ok: false,
        error: { code: 'SERVICE_UNAVAILABLE', message: '仍未恢复', retryable: true } })
      .mockResolvedValueOnce({ ok: true, data: audioMap })
    await import('../../miniprogram/subpackages/student/reading-detail/reading-detail')
    if (!definition) throw new Error('Reading detail was not registered')
    const context = { data: { ...definition.data, reading: { book: { id: 'book_demo' } },
      displayPageNumber: 1 },
    setData(change: Record<string, unknown>) { Object.assign(this.data, change) } }
    Object.assign(context, definition.methods)
    await context.loadReadingAudioMap('book_demo', 1)
    expect(context.data.audioMapReady).toBe(false)
    expect(context.data.audioMapError).toContain('重试')
    context.retryReadingAudioMap()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(context.data.audioMapReady).toBe(true)
    expect(context.data.audioMapError).toBe('')
  })

  it('recovers one transient audio lookup failure before showing a retry card', async () => {
    let definition: { data: Record<string, unknown>; methods: Record<string, (...args: never[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    vi.stubGlobal('wx', {})
    getReadingAudioMap.mockResolvedValueOnce({ ok: false,
      error: { code: 'SERVICE_UNAVAILABLE', message: '暂时失败', retryable: true } })
      .mockResolvedValueOnce({ ok: true, data: audioMap })
    await import('../../miniprogram/subpackages/student/reading-detail/reading-detail')
    if (!definition) throw new Error('Reading detail was not registered')
    const context = { data: { ...definition.data, reading: { book: { id: 'book_demo' } },
      displayPageNumber: 1 },
    setData(change: Record<string, unknown>) { Object.assign(this.data, change) } }
    Object.assign(context, definition.methods)
    await context.loadReadingAudioMap('book_demo', 1)
    expect(getReadingAudioMap).toHaveBeenCalledTimes(2)
    expect(context.data.audioMapReady).toBe(true)
    expect(context.data.audioMapError).toBe('')
  })

  it('does not present an unconfigured page-only book as a failed audio mapping', async () => {
    let definition: { data: Record<string, unknown>; methods: Record<string, (...args: never[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    vi.stubGlobal('wx', {})
    getReadingAudioMap.mockResolvedValue({ ok: true, data: {
      resourceId: 'book_demo', sourceVersion: 'v1', chapterId: 'chapter_1',
      durationMs: null, playback: null, segments: [],
    } })
    await import('../../miniprogram/subpackages/student/reading-detail/reading-detail')
    if (!definition) throw new Error('Reading detail was not registered')
    const context = { data: { ...definition.data, reading: { book: { id: 'book_demo' } },
      displayPageNumber: 1 },
    setData(change: Record<string, unknown>) { Object.assign(this.data, change) } }
    Object.assign(context, definition.methods)
    await context.loadReadingAudioMap('book_demo', 1)
    expect(context.data.audioMapReady).toBe(false)
    expect(context.data.audioMapError).toContain('暂未开放点读、跟读与示范音频')
    expect(context.data.audioMapRetryable).toBe(false)
    context.retryReadingAudioMap()
    expect(getReadingAudioMap).toHaveBeenCalledOnce()
    getReadingAudioMap.mockResolvedValueOnce({ ok: true, data: {
      resourceId: 'book_demo', sourceVersion: 'old', chapterId: 'chapter_1',
      durationMs: null, playback: null, segments: [],
    } })
    await context.loadReadingAudioMap('book_demo', 1)
    expect(context.data.audioMapRetryable).toBe(true)
    expect(context.data.audioMapError).toContain('映射暂不可用')
  })

  it('plays a reviewed page clip for point-read without seeking into the chapter recording', async () => {
    const pageMap: ReadingAudioMapView = { ...audioMap, segments: [{ ...audioMap.segments[0]!,
      startMs: 0, endMs: 2300, clipDurationMs: 2500,
      clipPlayback: { temporaryUrl: 'https://example.invalid/page-01.mp3',
        expiresAt: '2099-01-01T00:00:00Z' } }] }
    getReadingAudioMap.mockResolvedValue({ ok: true, data: pageMap })
    let definition: { data: Record<string, unknown>; methods: Record<string, (...args: never[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    const seek = vi.fn(), play = vi.fn(), destroy = vi.fn()
    let onTimeUpdate: (() => void) | null = null
    const audio = { src: '', playbackRate: 1, currentTime: 0, seek, play, destroy,
      onCanplay: vi.fn(), onTimeUpdate: (listener: () => void) => { onTimeUpdate = listener },
      onEnded: vi.fn(), onError: vi.fn() }
    vi.stubGlobal('wx', { createInnerAudioContext: () => audio,
      getStorageSync: vi.fn(() => 0), setStorageSync: vi.fn() })
    await import('../../miniprogram/subpackages/student/reading-detail/reading-detail')
    if (!definition) throw new Error('Reading detail was not registered')
    const context = { data: { ...definition.data, reading: { book: { id: 'book_demo' } }, displayPageNumber: 1 },
      setData(change: Record<string, unknown>, callback?: () => void) { Object.assign(this.data, change); callback?.() } }
    Object.assign(context, definition.methods)
    await context.loadReadingAudioMap('book_demo', 1)
    await context.playPointread({ currentTarget: { dataset: { id: 'segment_1' } } })
    expect(audio.src).toBe('https://example.invalid/page-01.mp3')
    expect(seek).not.toHaveBeenCalled()
    expect(play).toHaveBeenCalledOnce()
    audio.currentTime = 2.4
    onTimeUpdate?.()
    expect(destroy).toHaveBeenCalledOnce()
    expect(context.data.activeHotspotId).toBe('')
  })

  it('hides a stale or expired follow-reading segment until an audited current source is returned', async () => {
    let definition: { data: Record<string, unknown>; methods: Record<string, (...args: never[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    vi.stubGlobal('wx', {})
    const segment = { id: 'segment_1', pageNumber: 1, text: 'The lion sleeps.',
      demonstrationAudio: { temporaryUrl: 'https://example.invalid/signed',
        expiresAt: '2099-01-01T00:00:00Z' } }
    getReadingPronunciationSegments.mockResolvedValueOnce({ ok: true, data: {
      resourceId: 'book_demo', sourceVersion: 'old', segments: [segment] } })
      .mockResolvedValueOnce({ ok: true, data: { resourceId: 'book_demo',
        sourceVersion: 'v1', segments: [{ ...segment, demonstrationAudio: {
          ...segment.demonstrationAudio, expiresAt: '2000-01-01T00:00:00Z' } }] } })
      .mockResolvedValueOnce({ ok: true, data: { resourceId: 'book_demo',
        sourceVersion: 'v1', segments: [segment] } })
    await import('../../miniprogram/subpackages/student/reading-detail/reading-detail')
    if (!definition) throw new Error('Reading detail was not registered')
    const context = { data: { ...definition.data, reading: { book: { id: 'book_demo' } },
      displayPageNumber: 1 },
      setData(change: Record<string, unknown>) { Object.assign(this.data, change) } }
    Object.assign(context, definition.methods)
    await context.loadPronunciationSegments('book_demo')
    expect(context.data.pageSegments).toEqual([])
    expect(context.data.pronunciationError).toContain('版本')
    await context.loadPronunciationSegments('book_demo')
    expect(context.data.pageSegments).toEqual([])
    expect(context.data.pronunciationError).toContain('地址')
    await context.loadPronunciationSegments('book_demo')
    expect(context.data.pageSegments).toMatchObject([{ id: 'segment_1' }])
    expect(context.data.pronunciationError).toBe('')
  })
})
