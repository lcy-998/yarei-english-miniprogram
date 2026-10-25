import { afterEach, describe, expect, it, vi } from 'vitest'

const getSchoolQuestion = vi.fn()
const getTaskDetail = vi.fn()
const getRecordingPrompt = vi.fn()
const previewTeacherAsset = vi.fn()
vi.mock('../../miniprogram/subpackages/student/services/app-service', async importOriginal => ({
  ...await importOriginal<typeof import('../../miniprogram/subpackages/student/services/app-service')>(),
  getSchoolQuestion, getTaskDetail,
}))
vi.mock('../../miniprogram/subpackages/student/services/task-recording-service', async importOriginal => ({
  ...await importOriginal<typeof import('../../miniprogram/subpackages/student/services/task-recording-service')>(),
  getRecordingPrompt,
}))
vi.mock('../../miniprogram/subpackages/student/services/teacher-media-service', async importOriginal => ({
  ...await importOriginal<typeof import('../../miniprogram/subpackages/student/services/teacher-media-service')>(),
  previewTeacherAsset,
}))

describe('S-09 teacher content preview', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); vi.clearAllMocks() })

  it('loads teacher-authorized media and exercise without a student task session', async () => {
    let definition: { data: Record<string, unknown>; methods: Record<string, (...args: never[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    vi.stubGlobal('wx', { getStorageSync: () => ({ sessionId: 'teacher_session', activeRole: 'teacher',
      user: { id: 'teacher_demo', role: 'teacher' } }) })
    previewTeacherAsset.mockResolvedValue({ ok: true, data: { id: 'audio_demo', kind: 'listening',
      title: '虚构听力', durationMs: 10000, questions: [{ questionId: 'q1', stem: 'Select one',
        options: ['cat', 'dog'] }], clips: [{ questionId: 'q1', segmentId: 'clip_1', startMs: 0, endMs: 5000 }],
      subtitles: [], playback: { temporaryUrl: 'https://example.test/audio.mp3',
        expiresAt: '2099-01-01T00:00:00Z' } } })
    getSchoolQuestion.mockResolvedValue({ ok: true, data: { id: 'quiz_demo', title: '虚构习题',
      stem: 'Choose one', options: ['A', 'B'] } })
    await import('../../miniprogram/subpackages/student/task-detail/task-detail')
    if (!definition) throw new Error('S-09 page unavailable')
    const context = { data: { ...definition.data, teacherPreviewMode: true,
      teacherPreviewRoute: { resourceId: 'audio_demo', type: 'listening', targetClassIds: ['class_demo'] } },
      setData(change: Record<string, unknown>) { Object.assign(this.data, change) } }
    Object.assign(context, definition.methods)
    await context.loadTeacherPreview()
    expect(previewTeacherAsset).toHaveBeenCalledWith('teacher_demo', 'audio_demo', ['class_demo'])
    expect(context.data).toMatchObject({ teacherPreviewAsset: { kind: 'listening' },
      teacherPreviewSessionId: 'teacher_session' })
    context.data.teacherPreviewRoute = { resourceId: 'quiz_demo', type: 'exercise' }
    await context.loadTeacherPreview()
    expect(context.data).toMatchObject({ teacherPreviewQuestion: { id: 'quiz_demo' },
      teacherPreviewAsset: null })
    expect(getTaskDetail).not.toHaveBeenCalled()
  })
})
