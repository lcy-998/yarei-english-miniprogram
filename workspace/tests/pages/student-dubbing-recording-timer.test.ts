import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../miniprogram/subpackages/student-media/services/app-service', () => ({
  beginWorkDraft: vi.fn(), getMaterialPlayback: vi.fn(), getWorkMaterial: vi.fn(), listMyWorks: vi.fn(),
  listWorkMaterials: vi.fn(), listWorkMaterialFacets: vi.fn(), searchWorkMaterials: vi.fn(), submitWork: vi.fn(),
}))

describe('S-07 recording duration', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules() })

  it('recovers from denied microphone permission through settings without losing the selected material', async () => {
    vi.useFakeTimers()
    let definition: { data: Record<string, unknown>; methods: Record<string,
      (this: unknown, ...args: unknown[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    const start = vi.fn(), authorize = vi.fn().mockRejectedValueOnce(new Error('denied'))
      .mockResolvedValueOnce(undefined)
    vi.stubGlobal('wx', {
      getRecorderManager: () => ({ onStop: vi.fn(), onError: vi.fn(), start, stop: vi.fn() }),
      authorize,
      openSetting: ({ success }: { success: (value: { authSetting: Record<string, boolean> }) => void }) =>
        success({ authSetting: { 'scope.record': true } }),
    })
    await import('../../miniprogram/subpackages/student-media/dubbing/dubbing')
    if (!definition) throw new Error('Dubbing page was not registered')
    const context = { data: { ...definition.data, selectedMaterialId: 'material_demo',
      selectedMaterial: { id: 'material_demo' } },
    setData(change: Record<string, unknown>) { Object.assign(this.data, change) } }
    Object.assign(context, definition.methods)
    await context.startRecording()
    expect(context.data.permissionDenied).toBe(true)
    expect(start).not.toHaveBeenCalled()
    context.openMicrophoneSettings()
    await context.startRecording()
    expect(context.data.permissionDenied).toBe(false)
    expect(context.data.selectedMaterialId).toBe('material_demo')
    expect(start).toHaveBeenCalledOnce()
    context.stopRecording()
  })

  it('advances during recording and keeps the recorder duration after stopping', async () => {
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
    await import('../../miniprogram/subpackages/student-media/dubbing/dubbing')
    if (!definition) throw new Error('Dubbing page was not registered')
    const methods = definition.methods
    const context = { data: { ...definition.data, selectedMaterialId: 'material_demo',
      selectedMaterial: { id: 'material_demo' } },
    setData(change: Record<string, unknown>) { Object.assign(this.data, change) },
    rememberLocalDraft: vi.fn() }

    await methods.startRecording!.call(context)
    vi.advanceTimersByTime(2200)
    expect(context.data).toMatchObject({ recordingState: 'recording', durationLabel: '00:02' })
    methods.stopRecording!.call(context)
    expect(stop).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(2000)
    expect(context.data.durationLabel).toBe('00:02')
    methods.onRecorderStopped!.call(context, { duration: 2300, fileSize: 1000,
      tempFilePath: 'wxfile://demo.mp3' })
    expect(context.data).toMatchObject({ recordingState: 'local', durationMs: 2300, durationLabel: '00:02' })
  })

  it('continues ticking while the native recording state update is pending', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-16T10:00:00+08:00'))
    let definition: { data: Record<string, unknown>; methods: Record<string,
      (this: unknown, ...args: unknown[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    vi.stubGlobal('wx', { getRecorderManager: () => ({ onStop: vi.fn(), onError: vi.fn(),
      start: vi.fn(), stop: vi.fn() }), authorize: vi.fn().mockResolvedValue(undefined) })
    await import('../../miniprogram/subpackages/student-media/dubbing/dubbing')
    if (!definition) throw new Error('Dubbing page was not registered')
    const context = { data: { ...definition.data, selectedMaterialId: 'material_demo',
      selectedMaterial: { id: 'material_demo' } },
      setData(change: Record<string, unknown>) {
        const { recordingState, ...rest } = change
        Object.assign(this.data, rest)
        if (recordingState !== 'recording') this.data.recordingState = recordingState
      } }
    Object.assign(context, definition.methods)
    await context.startRecording()
    vi.advanceTimersByTime(2200)
    expect(context.data.durationLabel).toBe('00:02')
  })

  it('marks an overlong take as unavailable for submission beside the recording timer', async () => {
    let definition: { data: Record<string, unknown>; methods: Record<string,
      (this: unknown, ...args: unknown[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    vi.stubGlobal('wx', {
      getRecorderManager: () => ({ onStop: vi.fn(), onError: vi.fn(), start: vi.fn(), stop: vi.fn() }),
    })
    await import('../../miniprogram/subpackages/student-media/dubbing/dubbing')
    if (!definition) throw new Error('Dubbing page was not registered')
    const context = { data: { ...definition.data, recordingState: 'recording' },
      setData(change: Record<string, unknown>) { Object.assign(this.data, change) },
      rememberLocalDraft: vi.fn() }
    definition.methods.onRecorderStopped!.call(context, { duration: 300001, fileSize: 1000,
      tempFilePath: 'wxfile://long.mp3' })
    expect(context.data).toMatchObject({ recordingState: 'local',
      recordingIssue: '录音超过 5 分钟，请重新录制' })
  })

  it('keeps a locally valid take available for retry after cloud media rejection', async () => {
    let definition: { data: Record<string, unknown>; methods: Record<string,
      (this: unknown, ...args: unknown[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    vi.stubGlobal('wx', {
      getRecorderManager: () => ({ onStop: vi.fn(), onError: vi.fn(), start: vi.fn(), stop: vi.fn() }),
      getStorageSync: () => ({ sessionId: 'session_demo', user: { id: 'student_demo', role: 'student' } }),
      cloud: { uploadFile: vi.fn().mockResolvedValue({ fileID: 'cloud://demo/staging.mp3' }) },
    })
    const services = await import('../../miniprogram/subpackages/student-media/services/app-service')
    vi.mocked(services.submitWork).mockResolvedValue({ ok: false, error: {
      code: 'MEDIA_INVALID', message: '录音文件无效或超出时长、大小限制', retryable: false,
    } })
    vi.mocked(services.listMyWorks).mockResolvedValue({ ok: true, data: [] })
    await import('../../miniprogram/subpackages/student-media/dubbing/dubbing')
    if (!definition) throw new Error('Dubbing page was not registered')
    const context = { data: { ...definition.data, selectedMaterialId: 'material_demo',
      selectedMaterial: { id: 'material_demo', contentVersion: 'v1' },
      recordingState: 'local', localPath: 'wxfile://recording.mp3', durationMs: 2200,
      fileSize: 1000, draft: { id: 'work_demo', status: 'draft', materialId: 'material_demo',
        version: 1, stagingPath: 'student-works/staging/demo/work_demo.mp3' } },
    setData(change: Record<string, unknown>) { Object.assign(this.data, change) },
    rememberLocalDraft: vi.fn() }
    await definition.methods.submitRecording!.call(context)
    expect(context.data).toMatchObject({ recordingState: 'local', submitting: false,
      recordingIssue: '', submitError: expect.stringContaining('录音已保留') })
    expect(context.rememberLocalDraft).toHaveBeenCalledOnce()
    await definition.methods.submitRecording!.call(context)
    expect(services.submitWork).toHaveBeenCalledTimes(2)
  })
})
