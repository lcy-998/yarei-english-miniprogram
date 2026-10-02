import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../miniprogram/repositories/repository-factory', () => ({ getRepositoryMode: () => 'cloudbase' }))
vi.mock('../../miniprogram/services/task-recording-service', () => ({
  beginTaskRecording: vi.fn(), getTaskRecordingMediaState: vi.fn(), getTaskRecordingPlayback: vi.fn(),
  listTaskRecordings: vi.fn(), submitTaskRecording: vi.fn(),
}))

describe('S-09 task recording indicator', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules() })

  it('updates elapsed time while recording and keeps the actual duration after stopping', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-30T10:00:00+08:00'))
    let definition: { data: Record<string, unknown>; methods: Record<string,
      (this: unknown, ...args: unknown[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    const stop = vi.fn()
    vi.stubGlobal('wx', {
      getRecorderManager: () => ({ onStop: vi.fn(), onError: vi.fn(), start: vi.fn(), stop }),
      authorize: vi.fn().mockResolvedValue(undefined),
    })
    await import('../../miniprogram/pages/student/task-detail/task-detail')
    if (!definition) throw new Error('Task detail page was not registered')
    const methods = definition.methods
    const context = { data: { ...definition.data, editable: true, completionInputs: [{
      itemId: 'item_recording', type: 'recording', recordingState: 'idle', recordingElapsedLabel: '00:00',
    }] }, setData(change: Record<string, unknown>) { Object.assign(this.data, change) } }

    await methods.startRecording!.call(context, { currentTarget: { dataset: { id: 'item_recording' } } })
    vi.advanceTimersByTime(2200)
    expect(context.data.activeRecordingItemId).toBe('item_recording')
    expect(context.data.completionInputs[0]).toMatchObject({ recordingState: 'recording', recordingElapsedLabel: '00:02' })
    methods.stopRecording!.call(context)
    expect(stop).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(2000)
    expect(context.data.completionInputs[0]).toMatchObject({ recordingElapsedLabel: '00:02' })
    methods.onRecordingStopped!.call(context, { duration: 2400, fileSize: 1000, tempFilePath: 'wxfile://demo.mp3' })
    expect(context.data.completionInputs[0]).toMatchObject({ recordingState: 'local',
      recordingElapsedLabel: '00:02', recordingDurationMs: 2400 })
  })

  it('keeps an invalid take for review while requiring a new recording before upload', async () => {
    let definition: { data: Record<string, unknown>; methods: Record<string,
      (this: unknown, ...args: unknown[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    vi.stubGlobal('wx', { getRecorderManager: () => ({ onStop: vi.fn(), onError: vi.fn(), start: vi.fn(), stop: vi.fn() }) })
    await import('../../miniprogram/pages/student/task-detail/task-detail')
    if (!definition) throw new Error('Task detail page was not registered')
    const context = { data: { ...definition.data, activeRecordingItemId: 'item_recording', completionInputs: [{
      itemId: 'item_recording', type: 'recording', recordingState: 'recording', recordingElapsedLabel: '00:02',
    }] }, setData(change: Record<string, unknown>) { Object.assign(this.data, change) } }
    definition.methods.onRecordingStopped!.call(context, { duration: 500, fileSize: 1000,
      tempFilePath: 'wxfile://short.mp3' })
    expect(context.data.recordingError).toContain('不足 1 秒')
    expect(context.data.completionInputs[0]).toMatchObject({ recordingState: 'invalid',
      localRecordingPath: 'wxfile://short.mp3' })
  })

  it('blocks another upload of a file the cloud rejected', async () => {
    let definition: { data: Record<string, unknown>; methods: Record<string,
      (this: unknown, ...args: unknown[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    const uploadFile = vi.fn().mockResolvedValue({ fileID: 'cloud://demo/staging.mp3' })
    vi.stubGlobal('wx', {
      getRecorderManager: () => ({ onStop: vi.fn(), onError: vi.fn(), start: vi.fn(), stop: vi.fn() }),
      getStorageSync: () => ({ sessionId: 'session_demo', user: { id: 'student_demo', role: 'student' } }),
      cloud: { uploadFile },
    })
    const service = await import('../../miniprogram/services/task-recording-service')
    vi.mocked(service.submitTaskRecording).mockResolvedValue({ ok: false, error: {
      code: 'MEDIA_INVALID', message: '录音文件无效或超出时长、大小限制', retryable: false,
    } })
    await import('../../miniprogram/pages/student/task-detail/task-detail')
    if (!definition) throw new Error('Task detail page was not registered')
    const methods = definition.methods
    const item = { itemId: 'item_recording', type: 'recording', recordingState: 'local',
      localRecordingPath: 'wxfile://recording.mp3', recordingDurationMs: 2200, recordingSizeBytes: 1000 }
    const context = { data: { ...definition.data, editable: true, detail: { task: { id: 'task_demo' } },
      completionInputs: [item], recordingDrafts: { item_recording: { id: 'recording_demo',
        status: 'draft', stagingPath: 'task-recordings/staging/demo/recording_demo.mp3', version: 1 } } },
    setData(change: Record<string, unknown>) { Object.assign(this.data, change) },
    recordingUploadFailed: methods.recordingUploadFailed }
    await methods.uploadRecording!.call(context, { currentTarget: { dataset: { id: 'item_recording' } } })
    expect(context.data.recordingError).toBe('云端无法识别本次录音文件，请重新录制')
    expect(context.data.completionInputs[0]).toMatchObject({ recordingState: 'invalid',
      localRecordingPath: 'wxfile://recording.mp3' })
    await methods.uploadRecording!.call(context, { currentTarget: { dataset: { id: 'item_recording' } } })
    expect(uploadFile).toHaveBeenCalledOnce()
  })
})
