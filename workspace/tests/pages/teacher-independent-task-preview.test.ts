import { afterEach, describe, expect, it, vi } from 'vitest'

const previewTeacherAsset = vi.fn()
const beginTaskMediaSession = vi.fn()
const reportTaskMediaHeartbeat = vi.fn()
const getTaskDetail = vi.fn()
const getSchoolQuestion = vi.fn()
const getRecordingPrompt = vi.fn()

vi.mock('../../miniprogram/services/teacher-media-service', () => ({ previewTeacherAsset }))
vi.mock('../../miniprogram/subpackages/student-media/services/teacher-media-service', () => ({ previewTeacherAsset }))
vi.mock('../../miniprogram/services/task-media-service', () => ({
  beginTaskMediaSession, getTaskMediaPlayback: vi.fn(), reportTaskMediaHeartbeat,
}))
vi.mock('../../miniprogram/subpackages/student-media/services/task-media-service', () => ({
  beginTaskMediaSession, getTaskMediaPlayback: vi.fn(), reportTaskMediaHeartbeat,
}))
vi.mock('../../miniprogram/services/app-service', () => ({ getTaskDetail, getSchoolQuestion }))
vi.mock('../../miniprogram/subpackages/student-media/services/app-service', () => ({ getTaskDetail, getSchoolQuestion }))
vi.mock('../../miniprogram/subpackages/student/services/app-service', () => ({ getTaskDetail, getSchoolQuestion }))
vi.mock('../../miniprogram/services/task-recording-service', () => ({ getRecordingPrompt }))
vi.mock('../../miniprogram/subpackages/student-media/services/task-recording-service', () => ({ getRecordingPrompt }))
vi.mock('../../miniprogram/session/session', () => ({
  getCurrentTaskId: () => '',
  getSession: () => ({ sessionId: 'teacher_session', activeRole: 'teacher',
    user: { id: 'teacher_demo', role: 'teacher' } }),
}))
vi.mock('../../miniprogram/subpackages/student-media/session/session', () => ({
  getCurrentTaskId: () => '',
  getSession: () => ({ sessionId: 'teacher_session', activeRole: 'teacher',
    user: { id: 'teacher_demo', role: 'teacher' } }),
}))
vi.mock('../../miniprogram/subpackages/student/session/session', () => ({
  getCurrentTaskId: () => '',
  getSession: () => ({ sessionId: 'teacher_session', activeRole: 'teacher',
    user: { id: 'teacher_demo', role: 'teacher' } }),
}))

type PageDefinition = { data: Record<string, unknown>;
  methods: Record<string, (...args: never[]) => unknown> }

async function page(path: string, type: string) {
  let definition: PageDefinition | null = null
  vi.stubGlobal('Component', (value: PageDefinition) => { definition = value })
  vi.stubGlobal('getCurrentPages', () => [{ options: {
    teacherPreview: '1', type, resourceId: `resource_${type}`, targetClassIds: 'class_demo',
  } }])
  vi.stubGlobal('wx', { navigateBack: vi.fn(), getStorageSync: vi.fn(),
    createVideoContext: () => ({ pause: vi.fn(), seek: vi.fn() }) })
  await import(path)
  if (!definition) throw new Error(`Page ${path} was not registered`)
  const context = { data: { ...definition.data },
    setData(change: Record<string, unknown>) { Object.assign(this.data, change) } }
  Object.assign(context, definition.methods)
  return context as typeof context & PageDefinition['methods']
}

describe('teacher preview on independent student task pages', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); vi.clearAllMocks() })

  it('shows authorised listening content without starting a student media session', async () => {
    previewTeacherAsset.mockResolvedValue({ ok: true, data: {
      id: 'resource_listening', contentVersion: 2, kind: 'listening', title: 'Listening',
      durationMs: 10000, questions: [{ questionId: 'q1', stem: 'Question', options: ['A', 'B'] }],
      clips: [{ questionId: 'q1', segmentId: 'clip_1', startMs: 0, endMs: 2000 }],
      subtitles: [{ startMs: 2000, endMs: 4000, text: 'Listen to this sentence.' }],
      playback: { temporaryUrl: 'https://example.test/audio', expiresAt: '2099-01-01T00:00:00Z' },
    } })
    const context = await page('../../miniprogram/subpackages/student-media/listening-task/listening-task', 'listening')
    await context.load()
    expect(previewTeacherAsset).toHaveBeenCalledWith('teacher_demo', 'resource_listening', ['class_demo'])
    expect(context.data).toMatchObject({ teacherPreview: true, itemTitle: 'Listening',
      earMode: false, hasListeningText: true,
      questions: [{ stem: 'Question', typeLabel: '选择题' }] })
    context.seek({ detail: { percent: 30 } } as never)
    expect(context.data).toMatchObject({ currentMs: 3000, positionPercent: 30,
      subtitle: 'Listen to this sentence.' })
    context.seek({ detail: { percent: 60 } } as never)
    expect(context.data).toMatchObject({ currentMs: 6000, positionPercent: 60, subtitle: '' })
    const handlers = new Map<string, () => void>()
    const seekAudio = vi.fn()
    vi.stubGlobal('wx', { createInnerAudioContext: () => ({ currentTime: 0, playbackRate: 1,
      src: '', seek: seekAudio, play: vi.fn(), pause: vi.fn(), stop: vi.fn(), destroy: vi.fn(),
      onCanplay: (callback: () => void) => handlers.set('canplay', callback),
      onPlay: vi.fn(), onPause: vi.fn(), onWaiting: vi.fn(), onTimeUpdate: vi.fn(),
      onEnded: vi.fn(), onError: vi.fn(),
    }) })
    await context.togglePlayback()
    handlers.get('canplay')?.()
    expect(seekAudio).toHaveBeenCalledWith(6)
    context.chooseOption({ currentTarget: { dataset: { questionId: 'q1', value: 'A' } } } as never)
    context.finish()
    expect(beginTaskMediaSession).not.toHaveBeenCalled()
    expect(reportTaskMediaHeartbeat).not.toHaveBeenCalled()
    expect(getTaskDetail).not.toHaveBeenCalled()
  })

  it('shows video questions and disables answer and playback writes', async () => {
    previewTeacherAsset.mockResolvedValue({ ok: true, data: {
      id: 'resource_video', contentVersion: 3, kind: 'video', title: 'Video',
      durationMs: 8000, questions: [{ questionId: 'q1', stem: 'Describe it', options: [] }],
      clips: [], subtitles: [],
      playback: { temporaryUrl: 'https://example.test/video', expiresAt: '2099-01-01T00:00:00Z' },
    } })
    const context = await page('../../miniprogram/subpackages/student-media/video-task/video-task', 'video')
    await context.load()
    expect(context.data).toMatchObject({ teacherPreview: true, itemTitle: 'Video',
      questions: [{ stem: 'Describe it', typeLabel: '文字作答' }] })
    context.inputAnswer({ currentTarget: { dataset: { questionId: 'q1' } },
      detail: { value: 'answer' } } as never)
    context.finish()
    expect(beginTaskMediaSession).not.toHaveBeenCalled()
    expect(reportTaskMediaHeartbeat).not.toHaveBeenCalled()
    expect(getTaskDetail).not.toHaveBeenCalled()
  })

  it('uses the exercise and recording student layouts with teacher-only data', async () => {
    getSchoolQuestion.mockResolvedValue({ ok: true, data: { id: 'resource_exercise',
      title: 'Exercise', questionType: 'single_choice', stem: 'Pick one', options: ['A', 'B'] } })
    const exercise = await page('../../miniprogram/subpackages/student/exercise-task/exercise-task', 'exercise')
    await exercise.load()
    expect(exercise.data).toMatchObject({ teacherPreview: true, editable: false,
      cards: [{ question: { stem: 'Pick one' } }] })
    vi.resetModules()
    getRecordingPrompt.mockResolvedValue({ ok: true, data: { id: 'resource_recording',
      title: 'Record', promptText: 'Read this sentence' } })
    const recording = await page('../../miniprogram/subpackages/student-media/recording-task/recording-task', 'recording')
    await recording.load()
    expect(recording.data).toMatchObject({ teacherPreview: true, editable: false,
      prompt: 'Read this sentence', state: 'idle' })
    expect(getTaskDetail).not.toHaveBeenCalled()
  })
})
