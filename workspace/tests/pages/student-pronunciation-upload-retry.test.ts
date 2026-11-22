vi.mock('../../miniprogram/repositories/selfhost-upload', () => ({ uploadBackendFile: (input: { cloudPath: string; filePath: string }) => wx.cloud.uploadFile(input) }))
import { afterEach, describe, expect, it, vi } from 'vitest'

const sealPronunciationRecording = vi.fn(), beginPronunciationScore = vi.fn()
vi.mock('../../miniprogram/subpackages/student/services/student-pronunciation-service', () => ({
  beginPronunciationRecording: vi.fn(), sealPronunciationRecording,
  beginPronunciationScore, getPronunciationScore: vi.fn(),
  getReadingPronunciationSegments: vi.fn(), listPronunciationAttempts: vi.fn(),
}))
vi.mock('../../miniprogram/subpackages/student/session/session', () => ({ getSession: () => ({
  sessionId: 'session_demo', user: { id: 'student_demo', role: 'student' },
}) }))

describe('S-05 rejected recording retry', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); sealPronunciationRecording.mockReset();
    beginPronunciationScore.mockReset() })

  it('uploads, seals, and requests a score automatically when a valid recording stops', async () => {
    let definition: { data: Record<string, unknown>; methods: Record<string, (...args: never[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    const uploadFile = vi.fn().mockResolvedValue({ fileID: 'cloud://test-env/pronunciation/staging/demo.mp3' })
    vi.stubGlobal('wx', { getRecorderManager: () => ({ onStop: vi.fn(), onError: vi.fn() }),
      cloud: { uploadFile }, setStorageSync: vi.fn() })
    sealPronunciationRecording.mockResolvedValue({ ok: true, data: {
      recordingId: 'recording_demo', durationMs: 2200, expectedVersion: 2,
    } })
    beginPronunciationScore.mockResolvedValue({ ok: true, data: {
      scoreId: 'score_demo', status: 'scored', experimental: true,
      score: { total: 80, pronunciation: 80, fluency: 80, completeness: 80 },
    } })
    await import('../../miniprogram/subpackages/student/pronunciation/pronunciation')
    if (!definition) throw new Error('Pronunciation page was not registered')
    const draft = { recordingId: 'recording_demo', stagingPath: 'pronunciation/staging/demo.mp3',
      source: { kind: 'reading', resourceId: 'book_demo', segmentId: 'segment_demo' } }
    const context = { data: { ...definition.data, pageVisible: true, source: draft.source,
      serverDraft: draft, recordingState: 'recording' },
      setData(change: Record<string, unknown>, done?: () => void) { Object.assign(this.data, change); done?.() } }
    Object.assign(context, definition.methods, { loadAttempts: vi.fn() })
    context.onRecorderStopped({ duration: 2200, fileSize: 1000, tempFilePath: 'wxfile://take.webm' })
    await vi.waitFor(() => expect(beginPronunciationScore).toHaveBeenCalledOnce())
    expect(uploadFile).toHaveBeenCalledOnce()
    expect(sealPronunciationRecording).toHaveBeenCalledOnce()
    expect(context.data).toMatchObject({ recordingState: 'sealed', scoreView: { status: 'scored' } })
  })

  it('keeps a too-short take local and does not upload it', async () => {
    let definition: { data: Record<string, unknown>; methods: Record<string, (...args: never[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    const uploadFile = vi.fn()
    vi.stubGlobal('wx', { getRecorderManager: () => ({ onStop: vi.fn(), onError: vi.fn() }),
      cloud: { uploadFile }, setStorageSync: vi.fn() })
    await import('../../miniprogram/subpackages/student/pronunciation/pronunciation')
    if (!definition) throw new Error('Pronunciation page was not registered')
    const context = { data: { ...definition.data, pageVisible: true, recordingState: 'recording',
      source: { kind: 'reading', resourceId: 'book_demo', segmentId: 'segment_demo' } },
      setData(change: Record<string, unknown>, done?: () => void) { Object.assign(this.data, change); done?.() } }
    Object.assign(context, definition.methods)
    context.onRecorderStopped({ duration: 500, fileSize: 500, tempFilePath: 'wxfile://short.webm' })
    expect(context.data.recordingError).toContain('1 秒')
    expect(uploadFile).not.toHaveBeenCalled()
  })

  it('reuploads the retained local take after cloud media validation rejects its staged copy', async () => {
    let definition: { data: Record<string, unknown>; methods: Record<string, (...args: never[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    const uploadFile = vi.fn().mockResolvedValue({ fileID: 'cloud://test-env/pronunciation/staging/demo.mp3' })
    vi.stubGlobal('wx', { getRecorderManager: () => ({ onStop: vi.fn(), onError: vi.fn() }),
      cloud: { uploadFile }, setStorageSync: vi.fn() })
    sealPronunciationRecording.mockResolvedValue({ ok: false, error: {
      code: 'MEDIA_INVALID', message: '录音文件无效或超出时长', retryable: false,
    } })
    await import('../../miniprogram/subpackages/student/pronunciation/pronunciation')
    if (!definition) throw new Error('Pronunciation page was not registered')
    const draft = { recordingId: 'recording_demo', stagingPath: 'pronunciation/staging/demo.mp3',
      source: { kind: 'reading', resourceId: 'book_demo', segmentId: 'segment_demo' } }
    const context = { data: { ...definition.data, source: draft.source, serverDraft: draft,
      localPath: 'wxfile://take.webm', durationMs: 2200, sizeBytes: 1000, recordingState: 'local' },
      setData(change: Record<string, unknown>, done?: () => void) { Object.assign(this.data, change); done?.() } }
    Object.assign(context, definition.methods)
    await context.uploadAndScore()
    expect(context.data).toMatchObject({ busy: false, stagingFileId: '', sealOperationId: '',
      localPath: 'wxfile://take.webm', recordingState: 'local' })
    await context.uploadAndScore()
    expect(uploadFile).toHaveBeenCalledTimes(2)
    expect(sealPronunciationRecording).toHaveBeenCalledTimes(2)
    expect(sealPronunciationRecording.mock.calls[0]?.[3])
      .not.toBe(sealPronunciationRecording.mock.calls[1]?.[3])
  })
})
