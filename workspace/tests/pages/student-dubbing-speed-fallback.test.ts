import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../miniprogram/subpackages/student-media/services/app-service', () => ({
  beginWorkDraft: vi.fn(), getMaterialPlayback: vi.fn(), getWorkMaterial: vi.fn(), listMyWorks: vi.fn(),
  listWorkMaterialFacets: vi.fn(), searchWorkMaterials: vi.fn(), submitWork: vi.fn(),
}))

describe('S-07 native video speed', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

  it('falls back to actual 1× playback when cycling from 2× past unsupported 0.75×', async () => {
    let definition: { data: Record<string, unknown>; methods: Record<string, (this: unknown) => void> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    const playbackRate = vi.fn()
    const setStorageSync = vi.fn()
    const showToast = vi.fn()
    vi.stubGlobal('wx', {
      getRecorderManager: () => ({ onStop: vi.fn(), onError: vi.fn() }),
      getStorageSync: (key: string) => key === 'yarei_session'
        ? { sessionId: 'session_demo', user: { id: 'student_demo', role: 'student' } } : null,
      setStorageSync, createVideoContext: () => ({ playbackRate }), showToast,
    })
    await import('../../miniprogram/subpackages/student-media/dubbing/dubbing')
    if (!definition) throw new Error('Dubbing page was not registered')
    const context = { data: { ...definition.data, demonstrationSpeed: 2 },
      setData(change: Record<string, unknown>) { Object.assign(this.data, change) } }

    definition.methods.cycleSpeed!.call(context)
    expect(playbackRate).toHaveBeenCalledWith(1)
    expect(playbackRate).not.toHaveBeenCalledWith(0.75)
    expect(context.data.demonstrationSpeed).toBe(1)
    expect(context.data.videoSpeedNotice).toContain('不支持 0.75')
    expect(setStorageSync).toHaveBeenCalledWith('learning_audio_speed_student_demo', 1)
    expect(showToast).toHaveBeenCalledOnce()
  })

  it('applies the displayed speed when playback starts', async () => {
    let definition: { data: Record<string, unknown>; methods: Record<string, (this: unknown) => void> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    const playbackRate = vi.fn()
    vi.stubGlobal('wx', {
      getRecorderManager: () => ({ onStop: vi.fn(), onError: vi.fn() }),
      createVideoContext: () => ({ playbackRate }),
    })
    await import('../../miniprogram/subpackages/student-media/dubbing/dubbing')
    if (!definition) throw new Error('Dubbing page was not registered')
    const context = { data: { ...definition.data, demonstrationSpeed: 1.25 },
      setData(change: Record<string, unknown>) { Object.assign(this.data, change) } }

    definition.methods.onDemonstrationPlay!.call(context)
    expect(playbackRate).toHaveBeenCalledWith(1.25)
    expect(context.data.demonstrationSpeed).toBe(1.25)
  })

  it('keeps a task deep link closed until reviewed media playback is live', async () => {
    let definition: { data: Record<string, unknown>; methods: Record<string, (this: unknown) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    vi.stubGlobal('getCurrentPages', () => [{ options: { taskId: 'task_unreleased' } }])
    vi.stubGlobal('wx', { getRecorderManager: () => ({ onStop: vi.fn(), onError: vi.fn() }) })
    await import('../../miniprogram/subpackages/student-media/dubbing/dubbing')
    if (!definition) throw new Error('Dubbing page was not registered')
    const context = { data: { ...definition.data },
      setData(change: Record<string, unknown>) { Object.assign(this.data, change) } }
    await definition.methods.loadMaterials!.call(context)
    expect(context.data.error).toContain('缺少任务或内容项')
    expect(context.data.loading).toBe(false)
  })
})
