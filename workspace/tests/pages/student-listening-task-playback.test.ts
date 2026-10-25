import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getTaskDetail = vi.fn(), beginTaskMediaSession = vi.fn(), getTaskMediaPlayback = vi.fn(),
  reportTaskMediaHeartbeat = vi.fn()
const appGlobalData: Record<string, unknown> = {}
vi.mock('../../miniprogram/services/app-service', () => ({ getTaskDetail }))
vi.mock('../../miniprogram/subpackages/student-media/services/app-service', () => ({ getTaskDetail }))
vi.mock('../../miniprogram/subpackages/student/services/app-service', () => ({ getTaskDetail }))
vi.mock('../../miniprogram/subpackages/student/services/task-media-service', () => ({
  beginTaskMediaSession, getTaskMediaPlayback, reportTaskMediaHeartbeat,
}))
vi.mock('../../miniprogram/services/task-media-service', () => ({
  beginTaskMediaSession, getTaskMediaPlayback, reportTaskMediaHeartbeat,
}))
vi.mock('../../miniprogram/subpackages/student-media/services/task-media-service', () => ({
  beginTaskMediaSession, getTaskMediaPlayback, reportTaskMediaHeartbeat,
}))
vi.mock('../../miniprogram/session/session', () => ({
  getCurrentTaskId: () => 'task_demo',
  getSession: () => ({ sessionId: 'session_demo', user: { id: 'student_demo', role: 'student' } }),
  setCurrentBookId: vi.fn(),
}))
vi.mock('../../miniprogram/subpackages/student-media/session/session', () => ({
  getCurrentTaskId: () => 'task_demo',
  getSession: () => ({ sessionId: 'session_demo', user: { id: 'student_demo', role: 'student' } }),
  setCurrentBookId: vi.fn(),
}))
vi.mock('../../miniprogram/subpackages/student/session/session', () => ({
  getCurrentTaskId: () => 'task_demo',
  getSession: () => ({ sessionId: 'session_demo', user: { id: 'student_demo', role: 'student' } }),
  setCurrentBookId: vi.fn(),
  setTeacherReviewScoreDraft: vi.fn(),
  getTeacherReviewScoreDraft: vi.fn(),
}))

async function listeningPage() {
  let definition: { data: Record<string, unknown>;
    methods: Record<string, (...args: never[]) => unknown> } | null = null
  vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
  const handlers = new Map<string, () => void>()
  const play = vi.fn(), pause = vi.fn(), seek = vi.fn(), destroy = vi.fn(), stop = vi.fn()
  vi.stubGlobal('wx', { createInnerAudioContext: () => ({
    currentTime: 10, playbackRate: 1, src: '', play, pause, seek, destroy, stop,
    onCanplay: (fn: () => void) => handlers.set('canplay', fn),
    onPlay: (fn: () => void) => handlers.set('play', fn),
    onPause: (fn: () => void) => handlers.set('pause', fn),
    onWaiting: (fn: () => void) => handlers.set('waiting', fn),
    onTimeUpdate: (fn: () => void) => handlers.set('timeupdate', fn),
    onEnded: (fn: () => void) => handlers.set('ended', fn),
    onError: (fn: () => void) => handlers.set('error', fn),
  }) })
  await import('../../miniprogram/subpackages/student-media/listening-task/listening-task')
  if (!definition) throw new Error('Listening page was not registered')
  const context = { data: { ...definition.data,
    sessionId: 'session_demo', itemId: 'listening_demo',
    detail: { task: { id: 'task_demo' }, assignment: { id: 'assignment_demo' } },
    snapshot: { kind: 'listening', mediaId: 'media_demo', mediaVersion: 1,
      reviewVersion: 1, durationMs: 10521, questionIds: [], questions: [], clips: [],
      subtitleAvailable: false, continuousPlaybackEnforced: true },
    playback: { status: 'ready', mediaId: 'media_demo', mediaVersion: 1,
      sessionId: 'media_session_demo', temporaryUrl: 'https://example.invalid/audio',
      expiresAt: '2099-01-01T00:00:00Z', confirmedThroughMs: 10000, seekForwardAllowed: false },
    currentMs: 10000, confirmedMs: 10000, lastReportedMs: 10000 },
  setData(change: Record<string, unknown>) { Object.assign(this.data, change) } }
  Object.assign(context, definition.methods)
  return { context, handlers, play, pause, seek, destroy }
}

describe('S-13 listening playback recovery', () => {
  beforeEach(() => vi.stubGlobal('getApp', () => ({ globalData: appGlobalData })))
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules();
    delete appGlobalData.taskMediaDrafts
    getTaskDetail.mockReset(); beginTaskMediaSession.mockReset();
    getTaskMediaPlayback.mockReset(); reportTaskMediaHeartbeat.mockReset() })

  it('keeps playback actionable while buffering and shows a retry after timeout', async () => {
    vi.useFakeTimers()
    const { context, handlers, play, pause } = await listeningPage()
    await context.togglePlayback()
    expect(play).toHaveBeenCalledOnce()
    handlers.get('waiting')?.()
    expect(context.data.buffering).toBe(true)
    context.togglePlayback()
    expect(pause).toHaveBeenCalledOnce()
    await context.togglePlayback()
    handlers.get('waiting')?.()
    vi.advanceTimersByTime(12000)
    expect(context.data.playing).toBe(false)
    expect(context.data.playbackError).toContain('重试')
  })

  it('reports the final short interval when the whole audio ends', async () => {
    reportTaskMediaHeartbeat.mockResolvedValue({ ok: true, data: {
      sessionId: 'media_session_demo', confirmedThroughMs: 10521, completed: true,
    } })
    const { context, handlers } = await listeningPage()
    await context.togglePlayback()
    handlers.get('ended')?.()
    await vi.waitFor(() => expect(context.data.completed).toBe(true))
    expect(reportTaskMediaHeartbeat.mock.calls[0]?.slice(0, 5)).toEqual([
      'student_demo', 'media_session_demo', 10000, 10521, 10521,
    ])
  })

  it('opens the dedicated page for every task type formerly embedded in details', async () => {
    let definition: { data: Record<string, unknown>;
      methods: Record<string, (...args: never[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    const navigateTo = vi.fn()
    vi.stubGlobal('wx', { navigateTo })
    await import('../../miniprogram/subpackages/student/task-detail/task-detail')
    if (!definition) throw new Error('Task detail was not registered')
    const context = { data: { ...definition.data,
      detail: { task: { id: 'task_demo', items: [
        { id: 'reading_demo', type: 'reading', resourceId: 'book_demo' },
        { id: 'vocabulary_demo', type: 'vocabulary', resourceId: 'pack_demo' },
        { id: 'listening_demo', type: 'listening', mediaSnapshot: { kind: 'listening' } },
        { id: 'video_demo', type: 'video', mediaSnapshot: { kind: 'video' } },
        { id: 'dubbing_demo', type: 'dubbing', mediaSnapshot: { kind: 'dubbing' } },
        { id: 'exercise_demo', type: 'exercise' }, { id: 'recording_demo', type: 'recording' },
      ] } } },
    setData(change: Record<string, unknown>) { Object.assign(this.data, change) } }
    Object.assign(context, definition.methods)
    context.openTaskContent({ currentTarget: { dataset: { id: 'listening_demo' } } })
    expect(navigateTo).toHaveBeenCalledWith({
      url: '/subpackages/student-media/listening-task/listening-task?taskId=task_demo&itemId=listening_demo',
    })
    for (const [itemId, route] of [
      ['video_demo', '/subpackages/student-media/video-task/video-task'],
      ['dubbing_demo', '/subpackages/student-media/dubbing/dubbing'],
      ['exercise_demo', '/subpackages/student/exercise-task/exercise-task'],
      ['recording_demo', '/subpackages/student-media/recording-task/recording-task'],
    ]) {
      context.openTaskContent({ currentTarget: { dataset: { id: itemId } } })
      expect(navigateTo).toHaveBeenLastCalledWith({
        url: `${route}?taskId=task_demo&itemId=${itemId}`,
      })
    }
    context.openTaskContent({ currentTarget: { dataset: { id: 'reading_demo' } } })
    expect(navigateTo).toHaveBeenLastCalledWith({ url:
      '/subpackages/student/reading-detail/reading-detail?bookId=book_demo&taskId=task_demo&itemId=reading_demo&requiredPageCount=0' })
  })

  it('loads published questions and preserves this round of answers for task submission', async () => {
    let definition: { data: Record<string, unknown>;
      methods: Record<string, (...args: never[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    vi.stubGlobal('getCurrentPages', () => [{ options: { taskId: 'task_demo', itemId: 'listening_demo' } }])
    const saved = new Map<string, unknown>()
    vi.stubGlobal('wx', { getStorageSync: (key: string) => saved.get(key),
      setStorageSync: (key: string, value: unknown) => saved.set(key, value),
      removeStorageSync: (key: string) => saved.delete(key) })
    const snapshot = { kind: 'listening', mediaId: 'media_demo', mediaVersion: 2,
      reviewVersion: 1, durationMs: 10000, questionIds: ['q1'],
      questions: [{ questionId: 'q1', questionType: 'single_choice', stem: 'Which animal?',
        options: ['A. Cat', 'B. Dog'] }],
      clips: [{ questionId: 'q1', segmentId: 'clip_1', startMs: 0, endMs: 3000 }],
      subtitleAvailable: false, continuousPlaybackEnforced: true }
    getTaskDetail.mockResolvedValue({ ok: true, data: { task: { id: 'task_demo',
      items: [{ id: 'listening_demo', title: 'Animal listening', type: 'listening', mediaSnapshot: snapshot }] },
    assignment: { id: 'assignment_demo', redoCount: 1 } } })
    beginTaskMediaSession.mockResolvedValue({ ok: true, data: { status: 'ready',
      mediaId: 'media_demo', mediaVersion: 2, sessionId: 'media_session_demo',
      temporaryUrl: 'https://example.invalid/audio', expiresAt: '2099-01-01T00:00:00Z',
      confirmedThroughMs: 0, seekForwardAllowed: false } })
    await import('../../miniprogram/subpackages/student-media/listening-task/listening-task')
    if (!definition) throw new Error('Listening page was not registered')
    const context = { data: { ...definition.data },
      setData(change: Record<string, unknown>) { Object.assign(this.data, change) } }
    Object.assign(context, definition.methods)
    await context.load()
    expect(context.data.questions).toMatchObject([{ stem: 'Which animal?', options: [
      { value: 'A. Cat', selected: false }, { value: 'B. Dog', selected: false },
    ] }])
    context.chooseOption({ currentTarget: { dataset: { questionId: 'q1', value: 'B. Dog' } } })
    expect(saved.get('task_media_answer_session_demo_task_demo_assignment_demo_1_listening_demo_2'))
      .toMatchObject({ answers: { q1: 'B. Dog' } })
  })

  it('submits a fifth answer restored on the listening page without changing another option', async () => {
    let definition: { data: Record<string, unknown>;
      methods: Record<string, (...args: never[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    vi.stubGlobal('getCurrentPages', () => [{ options: { taskId: 'task_demo', itemId: 'listening_demo' } }])
    const saved = new Map<string, unknown>()
    vi.stubGlobal('wx', { getStorageSync: (key: string) => saved.get(key),
      setStorageSync: (key: string, value: unknown) => saved.set(key, value),
      removeStorageSync: (key: string) => saved.delete(key), navigateBack: vi.fn() })
    const questionIds = Array.from({ length: 5 }, (_, index) => `q${index + 1}`)
    const snapshot = { kind: 'listening', mediaId: 'media_sss', mediaVersion: 2,
      reviewVersion: 1, durationMs: 10000, questionIds,
      questions: questionIds.map(questionId => ({ questionId, questionType: 'single_choice',
        stem: questionId, options: ['A', 'B', 'C'] })),
      clips: questionIds.map(questionId => ({ questionId, segmentId: questionId,
        startMs: 0, endMs: 10000 })),
      subtitleAvailable: false, continuousPlaybackEnforced: true }
    const responses = questionIds.map(questionId => ({ questionId, response: 'A' }))
    const detail = (answerCount: number) => ({ task: { id: 'task_demo', version: 1,
      items: [{ id: 'listening_demo', title: 'SSS Hello listening', type: 'listening', mediaSnapshot: snapshot }] },
    assignment: { id: 'assignment_demo', redoCount: 0, version: 1 },
    submission: { status: 'draft', version: 1, answers: [{ taskItemId: 'listening_demo',
      structuredValue: { kind: 'listening', mediaSessionId: 'media_session_demo',
        questionResponses: responses.slice(0, answerCount) } }] } })
    getTaskDetail.mockResolvedValue({ ok: true, data: detail(5) })
    const playback = { status: 'ready', mediaId: 'media_sss', mediaVersion: 2,
      sessionId: 'media_session_demo', temporaryUrl: 'https://example.invalid/audio',
      expiresAt: '2099-01-01T00:00:00Z', confirmedThroughMs: 10000, seekForwardAllowed: false }
    beginTaskMediaSession.mockResolvedValue({ ok: true, data: playback })
    getTaskMediaPlayback.mockResolvedValue({ ok: true, data: playback })
    await import('../../miniprogram/subpackages/student-media/listening-task/listening-task')
    if (!definition) throw new Error('Listening page was not registered')
    const listening = { data: { ...definition.data },
      setData(change: Record<string, unknown>) { Object.assign(this.data, change) } }
    Object.assign(listening, definition.methods)
    await listening.load()
    expect(listening.data.questions[4]?.options[0]?.selected).toBe(true)
    const key = 'task_media_answer_session_demo_task_demo_assignment_demo_0_listening_demo_2'
    expect(saved.get(key)).toMatchObject({ answers: { q5: 'A' } })
    saved.delete(key)
    await listening.returnToTask()
    expect(saved.get(key)).toMatchObject({ answers: { q5: 'A' } })
    expect(wx.navigateBack).toHaveBeenCalledOnce()

    await import('../../miniprogram/subpackages/student/task-detail/task-detail')
    if (!definition) throw new Error('Task detail was not registered')
    const task = { data: { ...definition.data, detail: detail(4) },
      setData(change: Record<string, unknown>) { Object.assign(this.data, change) } }
    Object.assign(task, definition.methods)
    await expect(task.collectTaskMediaAnswers(true)).resolves.toMatchObject({ error: '', answers: [{
      value: { kind: 'listening', questionResponses: responses },
    }] })
  })

  it('accepts multiple selections and written answers by question type', async () => {
    const { context } = await listeningPage()
    context.data.snapshot = { ...context.data.snapshot, questionIds: ['multi', 'fill'], questions: [
      { questionId: 'multi', questionType: 'multiple_choice', stem: 'Pick two', options: ['A', 'B', 'C'] },
      { questionId: 'fill', questionType: 'fill', stem: 'Complete the word', options: [] },
    ] }
    context.chooseOption({ currentTarget: { dataset: { questionId: 'multi', value: 'A' } } })
    context.chooseOption({ currentTarget: { dataset: { questionId: 'multi', value: 'C' } } })
    context.chooseOption({ currentTarget: { dataset: { questionId: 'multi', value: 'A' } } })
    context.inputAnswer({ currentTarget: { dataset: { questionId: 'fill' } }, detail: { value: 'rabbit' } })
    expect(context.data.answers).toMatchObject({ multi: ['C'], fill: 'rabbit' })
    expect(context.data.questions).toMatchObject([
      { typeLabel: '多选题', choiceQuestion: true, options: [
        { value: 'A', selected: false }, { value: 'B', selected: false }, { value: 'C', selected: true },
      ] },
      { typeLabel: '填空题', choiceQuestion: false, answerText: 'rabbit' },
    ])
  })

  it('hands a completed answer to task submission when device storage is full', async () => {
    let definition: { data: Record<string, unknown>;
      methods: Record<string, (...args: never[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    vi.stubGlobal('wx', { getStorageSync: () => null,
      setStorageSync: () => { throw new Error('storage full') }, removeStorageSync: vi.fn() })
    const snapshot = { kind: 'listening', mediaId: 'media_shakespeare', mediaVersion: 1,
      reviewVersion: 1, durationMs: 10000,
      questionIds: ['voa-lle1-l13-source-comprehension'],
      questions: [{ questionId: 'voa-lle1-l13-source-comprehension',
        questionType: 'subjective', stem: 'What activities?', options: [] }],
      clips: [{ questionId: 'voa-lle1-l13-source-comprehension',
        segmentId: 'clip_1', startMs: 0, endMs: 10000 }],
      subtitleAvailable: false, continuousPlaybackEnforced: true }
    const detail = { task: { id: 'task_demo', version: 1, items: [{ id: 'listening_demo',
      title: 'Happy Birthday, William Shakespeare!｜活动与日常听力',
      type: 'listening', mediaSnapshot: snapshot }] },
    assignment: { id: 'assignment_demo', redoCount: 0 } }
    await import('../../miniprogram/subpackages/student-media/listening-task/listening-task')
    if (!definition) throw new Error('Listening page was not registered')
    const listening = { data: { ...definition.data, sessionId: 'session_demo',
      itemId: 'listening_demo', detail, snapshot },
    setData(change: Record<string, unknown>) { Object.assign(this.data, change) } }
    Object.assign(listening, definition.methods)
    listening.inputAnswer({ currentTarget: { dataset: {
      questionId: 'voa-lle1-l13-source-comprehension' } },
    detail: { value: 'drum band and puppet show' } })
    expect(listening.data.draftError).toContain('持久保存失败')
    getTaskMediaPlayback.mockResolvedValue({ ok: true, data: { status: 'ready',
      mediaId: 'media_shakespeare', mediaVersion: 1, sessionId: 'media_session_demo',
      temporaryUrl: 'https://example.invalid/audio', expiresAt: '2099-01-01T00:00:00Z',
      confirmedThroughMs: 10000, seekForwardAllowed: false } })
    await import('../../miniprogram/subpackages/student/task-detail/task-detail')
    if (!definition) throw new Error('Task detail was not registered')
    const task = { data: { ...definition.data, detail,
      activeTaskMediaItemId: 'listening_demo', activeTaskMediaAnswers: {} },
      setData(change: Record<string, unknown>) { Object.assign(this.data, change) } }
    Object.assign(task, definition.methods)
    await expect(task.collectTaskMediaAnswers(true)).resolves.toMatchObject({ error: '', answers: [{
      itemId: 'listening_demo', value: { kind: 'listening', questionResponses: [{
        questionId: 'voa-lle1-l13-source-comprehension',
        response: 'drum band and puppet show',
      }] },
    }] })
    task.data.saving = true
    await task.onSubmit()
    expect(task.data.writeError).toBe('作答正在同步，请稍后再提交')
  })
})
