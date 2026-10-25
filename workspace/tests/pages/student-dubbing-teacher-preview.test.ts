import { afterEach, describe, expect, it, vi } from 'vitest'

const previewTeacherAsset = vi.fn()
const beginTaskDubbingWork = vi.fn()
const searchWorkMaterials = vi.fn()
vi.mock('../../miniprogram/subpackages/student-media/services/app-service', async importOriginal => ({
  ...await importOriginal<typeof import('../../miniprogram/subpackages/student-media/services/app-service')>(),
  searchWorkMaterials,
}))
vi.mock('../../miniprogram/subpackages/student-media/services/teacher-media-service', async importOriginal => ({
  ...await importOriginal<typeof import('../../miniprogram/subpackages/student-media/services/teacher-media-service')>(),
  previewTeacherAsset,
}))
vi.mock('../../miniprogram/subpackages/student-media/services/student-task-dubbing-service', async importOriginal => ({
  ...await importOriginal<typeof import('../../miniprogram/subpackages/student-media/services/student-task-dubbing-service')>(),
  beginTaskDubbingWork,
}))

describe('S-07 teacher content preview', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); vi.clearAllMocks() })

  it('loads only a teacher-authorized dubbing asset without creating a recording', async () => {
    let definition: { data: Record<string, unknown>; methods: Record<string, (...args: never[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    vi.stubGlobal('getCurrentPages', () => [{ options: { teacherPreview: '1',
      resourceId: 'video_demo', type: 'dubbing', targetClassIds: 'class_demo' } }])
    vi.stubGlobal('wx', { getRecorderManager: () => ({ onStop: vi.fn(), onError: vi.fn() }),
      getStorageSync: () => ({ sessionId: 'teacher_session', activeRole: 'teacher',
        user: { id: 'teacher_demo', role: 'teacher' } }) })
    previewTeacherAsset.mockResolvedValue({ ok: true, data: { id: 'video_demo', kind: 'dubbing',
      title: '虚构配音', subtitles: [], playback: { temporaryUrl: 'https://example.test/video.mp4',
        expiresAt: '2099-01-01T00:00:00Z' } } })
    await import('../../miniprogram/subpackages/student-media/dubbing/dubbing')
    if (!definition) throw new Error('S-07 page unavailable')
    const context = { data: { ...definition.data },
      setData(change: Record<string, unknown>) { Object.assign(this.data, change) } }
    Object.assign(context, definition.methods)
    await context.loadMaterials()
    expect(previewTeacherAsset).toHaveBeenCalledWith('teacher_demo', 'video_demo', ['class_demo'])
    expect(context.data).toMatchObject({ teacherPreviewMode: true,
      teacherPreviewAsset: { kind: 'dubbing' }, recordingState: 'idle' })
    expect(beginTaskDubbingWork).not.toHaveBeenCalled()
  })

  it('waits for page options before the first teacher preview request', async () => {
    let definition: { data: Record<string, unknown>;
      methods: Record<string, (...args: never[]) => unknown>;
      pageLifetimes: { show: (...args: never[]) => unknown } } | null = null
    let options: Record<string, string> = {}
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    vi.stubGlobal('getCurrentPages', () => [{ options }])
    vi.stubGlobal('wx', { getRecorderManager: () => ({ onStop: vi.fn(), onError: vi.fn() }),
      getStorageSync: () => ({ sessionId: 'teacher_session', activeRole: 'teacher',
        user: { id: 'teacher_demo', role: 'teacher' } }) })
    previewTeacherAsset.mockResolvedValue({ ok: true, data: { id: 'video_demo', kind: 'dubbing',
      title: '虚构配音', subtitles: [], playback: { temporaryUrl: 'https://example.test/video.mp4',
        expiresAt: '2099-01-01T00:00:00Z' } } })
    await import('../../miniprogram/subpackages/student-media/dubbing/dubbing')
    if (!definition) throw new Error('S-07 page unavailable')
    const context = { data: { ...definition.data },
      setData(change: Record<string, unknown>) { Object.assign(this.data, change) } }
    Object.assign(context, definition.methods)
    expect(searchWorkMaterials).not.toHaveBeenCalled()
    expect(previewTeacherAsset).not.toHaveBeenCalled()
    options = { teacherPreview: '1', resourceId: 'video_demo', type: 'dubbing' }
    definition.pageLifetimes.show.call(context)
    await vi.waitFor(() => expect(context.data).toMatchObject({ loading: false,
      error: '', teacherPreviewMode: true, teacherPreviewAsset: { id: 'video_demo' } }))
    expect(previewTeacherAsset).toHaveBeenCalledOnce()
    expect(searchWorkMaterials).not.toHaveBeenCalled()
  })

  it('still loads the student material catalog once on first show', async () => {
    let definition: { data: Record<string, unknown>;
      methods: Record<string, (...args: never[]) => unknown>;
      pageLifetimes: { show: (...args: never[]) => unknown } } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    vi.stubGlobal('getCurrentPages', () => [{ options: {} }])
    vi.stubGlobal('wx', { getRecorderManager: () => ({ onStop: vi.fn(), onError: vi.fn() }),
      getStorageSync: (key: string) => key === 'yarei_session'
        ? { sessionId: 'student_session', user: { id: 'student_demo', role: 'student' } } : null })
    searchWorkMaterials.mockResolvedValue({ ok: true,
      data: { items: [], total: 0, nextOffset: null } })
    await import('../../miniprogram/subpackages/student-media/dubbing/dubbing')
    if (!definition) throw new Error('S-07 page unavailable')
    const context = { data: { ...definition.data },
      setData(change: Record<string, unknown>, callback?: () => void) {
        Object.assign(this.data, change); callback?.()
      } }
    Object.assign(context, definition.methods)
    definition.pageLifetimes.show.call(context)
    await vi.waitFor(() => expect(searchWorkMaterials).toHaveBeenCalledOnce())
    definition.pageLifetimes.show.call(context)
    expect(searchWorkMaterials).toHaveBeenCalledOnce()
  })
})
