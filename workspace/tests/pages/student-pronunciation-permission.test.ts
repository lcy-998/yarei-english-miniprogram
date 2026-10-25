import { afterEach, describe, expect, it, vi } from 'vitest'

const beginPronunciationRecording = vi.fn()
const getReadingPronunciationSegments = vi.fn()
const getReadingResource = vi.fn()
vi.mock('../../miniprogram/subpackages/student/services/app-service', () => ({ getReadingResource }))
vi.mock('../../miniprogram/subpackages/student/services/student-pronunciation-service', () => ({
  beginPronunciationRecording, sealPronunciationRecording: vi.fn(), beginPronunciationScore: vi.fn(),
  getPronunciationScore: vi.fn(), getReadingPronunciationSegments,
  listPronunciationAttempts: vi.fn(),
}))
vi.mock('../../miniprogram/subpackages/student/session/session', () => ({
  getSession: () => ({ sessionId: 'session_demo', user: { id: 'student_demo', role: 'student' } }),
}))

describe('S-05 microphone permission recovery', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules();
    beginPronunciationRecording.mockReset(); getReadingPronunciationSegments.mockReset();
    getReadingResource.mockReset() })

  it('keeps the server draft and starts recording only after permission is granted', async () => {
    vi.useFakeTimers()
    let definition: { data: Record<string, unknown>; methods: Record<string, (...args: never[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    const start = vi.fn(), authorize = vi.fn().mockRejectedValueOnce(new Error('denied'))
      .mockResolvedValueOnce(undefined)
    vi.stubGlobal('wx', {
      getRecorderManager: () => ({ start, stop: vi.fn(), onStop: vi.fn(), onError: vi.fn() }), authorize,
      openSetting: ({ success }: { success: (value: { authSetting: Record<string, boolean> }) => void }) =>
        success({ authSetting: { 'scope.record': true } }),
      setStorageSync: vi.fn(),
    })
    beginPronunciationRecording.mockResolvedValue({ ok: true, data: {
      recordingId: 'recording_1', stagingPath: 'pronunciation/staging/recording_1.mp3',
      expectedVersion: 1, source: { kind: 'reading', resourceId: 'book_demo', segmentId: 'segment_1' },
      referencePreview: 'The lion sleeps.',
      durationLimits: { minMs: 1000, maxMs: 300000, maxBytes: 20971520 },
    } })
    await import('../../miniprogram/subpackages/student/pronunciation/pronunciation')
    if (!definition) throw new Error('Pronunciation page was not registered')
    const context = { data: { ...definition.data, source: { kind: 'reading', resourceId: 'book_demo', segmentId: 'segment_1' } },
      setData(change: Record<string, unknown>, callback?: () => void) { Object.assign(this.data, change); callback?.() } }
    Object.assign(context, definition.methods)
    await context.startRecording()
    expect(context.data.permissionDenied).toBe(true)
    expect(start).not.toHaveBeenCalled()
    context.openMicrophoneSettings()
    expect(context.data.permissionDenied).toBe(false)
    await context.startRecording()
    expect(beginPronunciationRecording).toHaveBeenCalledOnce()
    expect(start).toHaveBeenCalledOnce()
    expect(context.data.recordingState).toBe('recording')
    context.stopRecording()
  })

  it('keeps the audited source and retries a failed demonstration lookup', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-03T10:00:00Z'))
    let definition: { data: Record<string, unknown>; methods: Record<string, (...args: never[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    vi.stubGlobal('wx', { getRecorderManager: () => ({ onStop: vi.fn(), onError: vi.fn() }) })
    getReadingPronunciationSegments.mockResolvedValueOnce({ ok: false,
      error: { code: 'SERVICE_UNAVAILABLE', message: '未部署', retryable: true } })
      .mockResolvedValueOnce({ ok: true, data: { resourceId: 'book_demo', sourceVersion: 'old',
        segments: [] } })
      .mockResolvedValueOnce({ ok: true, data: { resourceId: 'book_demo', sourceVersion: 'v1', segments: [{
        id: 'segment_1', pageNumber: 1, text: 'The lion sleeps.',
        demonstrationAudio: { temporaryUrl: 'https://example.invalid/signed',
          expiresAt: '2026-10-04T00:00:00Z' },
      }] } })
    getReadingResource.mockResolvedValue({ ok: true, data: { id: 'book_demo', contentVersion: 'v1' } })
    await import('../../miniprogram/subpackages/student/pronunciation/pronunciation')
    if (!definition) throw new Error('Pronunciation page was not registered')
    const source = { kind: 'reading', resourceId: 'book_demo', segmentId: 'segment_1' }
    const context = { data: { ...definition.data, source },
      setData(change: Record<string, unknown>) { Object.assign(this.data, change) } }
    Object.assign(context, definition.methods)
    await context.loadDemonstration()
    expect(context.data.demonstrationError).toBe('未部署')
    await context.retryDemonstration()
    expect(context.data.demonstrationUrl).toBe('')
    expect(context.data.demonstrationError).toContain('版本')
    await context.retryDemonstration()
    expect(context.data.demonstrationUrl).toBe('https://example.invalid/signed')
    expect(context.data.demonstrationError).toBe('')
  })
})
