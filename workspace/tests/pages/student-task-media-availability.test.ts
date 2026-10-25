import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getTaskMediaPlayback = vi.fn(), beginTaskMediaSession = vi.fn(), reportTaskMediaHeartbeat = vi.fn()
const listMyTaskDubbingWorks = vi.fn()
vi.mock('../../miniprogram/subpackages/student/services/task-media-service', () => ({
  getTaskMediaPlayback, beginTaskMediaSession, reportTaskMediaHeartbeat, listMyTaskDubbingWorks,
}))
vi.mock('../../miniprogram/subpackages/student/session/session', () => ({
  getSession: () => ({ sessionId: 'session_demo', user: { id: 'student_demo', role: 'student' } }),
  getCurrentTaskId: () => 'task_1', getTeacherReviewScoreDraft: vi.fn(),
  setCurrentBookId: vi.fn(), setTeacherReviewScoreDraft: vi.fn(),
}))

describe('S-09 task media preparation state', () => {
  beforeEach(() => listMyTaskDubbingWorks.mockResolvedValue({ ok: true,
    data: { items: [], nextOffset: null } }))
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules();
    getTaskMediaPlayback.mockReset(); beginTaskMediaSession.mockReset(); reportTaskMediaHeartbeat.mockReset();
    listMyTaskDubbingWorks.mockReset() })

  it('restores a sealed dubbing item from the cloud after a new login', async () => {
    vi.stubGlobal('wx', { getStorageSync: () => null })
    let definition: { data: Record<string, unknown>; methods: Record<string, (...args: never[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    getTaskMediaPlayback.mockResolvedValue({ ok: true, data: {
      status: 'ready', mediaId: 'media_1', mediaVersion: 1,
      sessionId: 'new_media_session', temporaryUrl: 'https://example.invalid/signed',
      expiresAt: '2099-01-01T00:00:00Z', confirmedThroughMs: 10000, seekForwardAllowed: false,
    } })
    listMyTaskDubbingWorks.mockResolvedValue({ ok: true, data: { items: [{
      workId: 'work_1', taskId: 'task_1', taskTitle: '虚构任务', itemId: 'dubbing_1',
      round: 1, status: 'task_pending', durationMs: 2200,
      submittedAt: '2026-10-16T10:00:00+08:00', playbackAvailable: true,
    }], nextOffset: null } })
    await import('../../miniprogram/subpackages/student/task-detail/task-detail')
    if (!definition) throw new Error('Task detail was not registered')
    const detail = { task: { id: 'task_1', version: 1, items: [{ id: 'dubbing_1', type: 'dubbing',
      title: '虚构配音', mediaSnapshot: { kind: 'dubbing', mediaId: 'media_1', mediaVersion: 1,
        reviewVersion: 1, durationMs: 10000, questionIds: [], questions: [], clips: [],
        subtitleAvailable: false, continuousPlaybackEnforced: true } }] },
      assignment: { id: 'assignment_1', status: 'in_progress', redoCount: 0 }, submission: null }
    const context = { data: { ...definition.data, detail },
      setData(change: Record<string, unknown>) { Object.assign(this.data, change) } }
    Object.assign(context, definition.methods)
    await context.refreshMediaAvailability()
    expect(context.data.mediaAvailability).toMatchObject([{ progressComplete: true,
      progressFraction: 1, progressLabel: '已完成' }])
    const answers = await context.collectTaskMediaAnswers(true)
    expect(answers).toMatchObject({ error: '', answers: [{ itemId: 'dubbing_1',
      value: { kind: 'dubbing', finalWorkId: 'work_1' } }] })
  })

  it('recognizes saved listening completion when the new login has no local answers', async () => {
    vi.stubGlobal('wx', { getStorageSync: () => null })
    let definition: { data: Record<string, unknown>; methods: Record<string, (...args: never[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    getTaskMediaPlayback.mockResolvedValue({ ok: true, data: {
      status: 'ready', mediaId: 'media_1', mediaVersion: 1,
      sessionId: 'renewed_media_session', temporaryUrl: 'https://example.invalid/signed',
      expiresAt: '2099-01-01T00:00:00Z', confirmedThroughMs: 10000, seekForwardAllowed: false,
    } })
    await import('../../miniprogram/subpackages/student/task-detail/task-detail')
    if (!definition) throw new Error('Task detail was not registered')
    const detail = { task: { id: 'task_1', version: 1, items: [{ id: 'listening_1', type: 'listening',
      title: '虚构听力', mediaSnapshot: { kind: 'listening', mediaId: 'media_1', mediaVersion: 1,
        reviewVersion: 1, durationMs: 10000, questionIds: ['q1'], questions: [], clips: [],
        subtitleAvailable: false, continuousPlaybackEnforced: true } }] },
      assignment: { id: 'assignment_1', status: 'in_progress', redoCount: 0 },
      submission: { status: 'draft', answers: [{ taskItemId: 'listening_1', structuredValue: {
        kind: 'listening', mediaSessionId: 'previous_media_session',
        questionResponses: [{ questionId: 'q1', response: 'A' }] } }] } }
    const context = { data: { ...definition.data, detail },
      setData(change: Record<string, unknown>) { Object.assign(this.data, change) } }
    Object.assign(context, definition.methods)
    await context.refreshMediaAvailability()
    expect(context.data.mediaAvailability).toMatchObject([{ progressComplete: true,
      progressFraction: 1, progressLabel: '已完成' }])
  })

  it('saves completed media answers to the cloud draft before a later login', async () => {
    let definition: { data: Record<string, unknown>; methods: Record<string, (...args: never[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    const showToast = vi.fn()
    vi.stubGlobal('wx', { showToast })
    const appService = await import('../../miniprogram/subpackages/student/services/app-service')
    const mediaValue = { kind: 'listening' as const, mediaSessionId: 'media_session_1',
      questionResponses: [{ questionId: 'q1', response: 'A' }] }
    const submission = { id: 'submission_1', assignmentId: 'assignment_1', studentId: 'student_demo',
      version: 1, recordVersion: 1, assignmentVersion: 2, status: 'draft' as const,
      answers: [{ taskItemId: 'listening_1', value: '', structuredValue: mediaValue }] }
    const saveDraft = vi.spyOn(appService, 'saveDraft').mockResolvedValue({ ok: true, data: submission })
    await import('../../miniprogram/subpackages/student/task-detail/task-detail')
    if (!definition) throw new Error('Task detail was not registered')
    const detail = { task: { id: 'task_1', version: 1, items: [{ id: 'listening_1', type: 'listening' }] },
      assignment: { id: 'assignment_1', status: 'in_progress', version: 1, redoCount: 0 } }
    const context = { data: { ...definition.data, detail, editable: true },
      setData(change: Record<string, unknown>) { Object.assign(this.data, change) } }
    Object.assign(context, definition.methods)
    context.collectTaskMediaAnswers = vi.fn().mockResolvedValue({ answers: [{ itemId: 'listening_1', value: mediaValue }], error: '' })
    context.structuredAnswers = vi.fn().mockReturnValue(null)
    await context.saveReturnedMediaProgress()
    expect(saveDraft).toHaveBeenCalledWith('student_demo', expect.objectContaining({
      taskId: 'task_1', expectedVersion: 0,
      structuredAnswers: [{ itemId: 'listening_1', value: mediaValue }],
    }))
    expect(context.data.detail.submission).toBe(submission)
    expect(showToast).not.toHaveBeenCalled()
  })

  it('shows server unavailability without enabling student writes', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-03T10:00:00Z'))
    let definition: { data: Record<string, unknown>; methods: Record<string, (...args: never[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    const audioPlay = vi.fn(), audioPause = vi.fn()
    const storage = new Map<string, unknown>()
    const setStorageSync = vi.fn((key: string, value: unknown) => storage.set(key, value))
    const removeStorageSync = vi.fn((key: string) => storage.delete(key))
    vi.stubGlobal('wx', { getStorageSync: vi.fn((key: string) => storage.get(key) ?? null),
      setStorageSync, removeStorageSync,
      createInnerAudioContext: () => ({ src: '', playbackRate: 1,
      seek: vi.fn(), play: audioPlay, pause: audioPause, destroy: vi.fn(),
      onCanplay: vi.fn(), onTimeUpdate: vi.fn(), onWaiting: vi.fn(), onError: vi.fn(), onEnded: vi.fn() }) })
    getTaskMediaPlayback.mockResolvedValue({ ok: false, error: { code: 'SERVICE_UNAVAILABLE',
      message: '未部署', retryable: false } })
    await import('../../miniprogram/subpackages/student/task-detail/task-detail')
    if (!definition) throw new Error('Task detail was not registered')
    const context = { data: { ...definition.data, detail: { task: { id: 'task_1', version: 1, items: [{
      id: 'listening_1', title: '虚构听力', type: 'listening', mediaSnapshot: {
        kind: 'listening', mediaId: 'media_1', mediaVersion: 1, reviewVersion: 1,
        durationMs: 10000, questionIds: ['q1'],
        questions: [{ questionId: 'q1', questionType: 'single_choice', stem: '虚构题', options: ['A', 'B'] }],
        clips: [{ questionId: 'q1', segmentId: 'clip_1', startMs: 0, endMs: 2000 }],
        subtitleAvailable: false, continuousPlaybackEnforced: true,
      },
    }] }, assignment: { id: 'assignment_1', redoCount: 0 } },
      hasUnreleasedMedia: true, editable: false },
    setData(change: Record<string, unknown>) { Object.assign(this.data, change) } }
    Object.assign(context, definition.methods)
    await context.refreshMediaAvailability()
    expect(getTaskMediaPlayback).toHaveBeenCalledWith('student_demo', 'task_1', 'listening_1')
    expect(context.data.mediaAvailability).toMatchObject([{ ready: false,
      label: '媒体播放服务尚未就绪，暂不可作答' }])
    expect(context.data.editable).toBe(false)
    beginTaskMediaSession.mockResolvedValueOnce({ ok: false, error: { code: 'SERVICE_UNAVAILABLE',
      message: '未部署', retryable: false } }).mockResolvedValueOnce({ ok: true, data: {
      status: 'ready', mediaId: 'media_1', mediaVersion: 1,
      sessionId: 'media_session_1', temporaryUrl: 'https://example.invalid/signed',
      expiresAt: '2099-01-01T00:00:00Z', confirmedThroughMs: 0, seekForwardAllowed: false,
    } }).mockResolvedValueOnce({ ok: true, data: {
      status: 'ready', mediaId: 'media_1', mediaVersion: 1,
      sessionId: 'media_session_1', temporaryUrl: 'https://example.invalid/signed',
      expiresAt: '2099-01-01T00:00:00Z', confirmedThroughMs: 0, seekForwardAllowed: false,
    } }).mockResolvedValueOnce({ ok: true, data: {
      status: 'ready', mediaId: 'media_1', mediaVersion: 1,
      sessionId: 'media_session_1', temporaryUrl: 'https://example.invalid/signed',
      expiresAt: '2099-01-01T00:00:00Z', confirmedThroughMs: 0, seekForwardAllowed: false,
    } })
    await context.startTaskMediaSession({ currentTarget: { dataset: { id: 'listening_1' } } })
    expect(context.data.mediaStartError).toContain('当前作答未改变')
    await context.startTaskMediaSession({ currentTarget: { dataset: { id: 'listening_1' } } })
    expect(beginTaskMediaSession).toHaveBeenCalledTimes(2)
    expect(beginTaskMediaSession.mock.calls[0]?.[3]).toBe(beginTaskMediaSession.mock.calls[1]?.[3])
    expect(context.data.mediaAvailability).toMatchObject([{ ready: true }])
    expect(context.data.hasUnreleasedMedia).toBe(true)
    expect(context.data.editable).toBe(false)
    context.chooseTaskMediaOption({ currentTarget: { dataset: { questionId: 'q1', value: 'A' } } })
    expect(context.data.activeTaskMediaAnswers).toMatchObject({ q1: 'A' })
    expect(setStorageSync).toHaveBeenCalledOnce()
    context.data.activeTaskMediaAnswers = {}
    await context.startTaskMediaSession({ currentTarget: { dataset: { id: 'listening_1' } } })
    expect(context.data.activeTaskMediaAnswers).toMatchObject({ q1: 'A' })
    await context.toggleTaskMediaPlayback()
    expect(audioPlay).toHaveBeenCalledOnce()
    expect(context.data.taskMediaPlaying).toBe(true)
    reportTaskMediaHeartbeat.mockResolvedValueOnce({ ok: false, error: { code: 'NETWORK_ERROR',
      message: '网络中断', retryable: true } }).mockResolvedValueOnce({ ok: true, data: {
      sessionId: 'media_session_1', confirmedThroughMs: 2000, completed: false,
    } })
    context.data.taskMediaPlaying = true
    vi.advanceTimersByTime(2000)
    context.observeTaskMediaPosition(2000)
    await Promise.resolve()
    expect(context.data.taskMediaPendingHeartbeat).toMatchObject({ playedFromMs: 0, playedToMs: 2000 })
    expect(context.data.taskMediaPlaying).toBe(false)
    expect(audioPause).toHaveBeenCalled()
    await context.retryTaskMedia()
    expect(reportTaskMediaHeartbeat).toHaveBeenCalledTimes(2)
    expect(reportTaskMediaHeartbeat.mock.calls[0]?.[5]).toBe(reportTaskMediaHeartbeat.mock.calls[1]?.[5])
    expect(context.data.taskMediaConfirmedMs).toBe(2000)
    context.data.taskMediaPlaying = true
    context.observeTaskMediaPosition(9000)
    expect(context.data.taskMediaPlaying).toBe(false)
    expect(context.data.taskMediaCurrentMs).toBe(2000)
    expect(context.data.taskMediaWarning).toContain('顺序播放')
    expect(context.data.taskMediaError).toBe('')
    const staleKey = [...storage.keys()][0]
    vi.advanceTimersByTime(8 * 24 * 60 * 60 * 1000)
    await context.startTaskMediaSession({ currentTarget: { dataset: { id: 'listening_1' } } })
    expect(removeStorageSync).toHaveBeenCalledWith(staleKey)
    expect(context.data.activeTaskMediaAnswers).toEqual({})
  })

  it('submits frozen answers only with current server sessions and current-round sealed dubbing', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-03T10:00:00Z'))
    let definition: { data: Record<string, unknown>; methods: Record<string, (...args: never[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    const storage = new Map<string, unknown>()
    vi.stubGlobal('wx', { getStorageSync: (key: string) => storage.get(key) ?? null })
    const snapshot = (kind: 'listening' | 'video' | 'dubbing') => ({ kind, mediaId: `media_${kind}`,
      mediaVersion: 1, reviewVersion: 1, durationMs: 10000,
      questionIds: kind === 'dubbing' ? [] : ['q1'],
      questions: kind === 'dubbing' ? [] : [{ questionId: 'q1', questionType: 'single_choice',
        stem: '虚构题目', options: ['A', 'B'] }],
      clips: kind === 'listening' ? [{ questionId: 'q1', segmentId: 'clip_1', startMs: 0, endMs: 2000 }] : [],
      subtitleAvailable: false, continuousPlaybackEnforced: true })
    const items = (['listening', 'video', 'dubbing'] as const).map(kind => ({ id: kind,
      type: kind, title: `虚构${kind}`, mediaSnapshot: snapshot(kind) }))
    const playback = (kind: string, confirmedThroughMs = 10000) => ({ status: 'ready',
      mediaId: `media_${kind}`, mediaVersion: 1, sessionId: `media_session_${kind}`,
      temporaryUrl: 'https://example.invalid/signed', expiresAt: '2026-10-04T00:00:00Z',
      confirmedThroughMs, seekForwardAllowed: false })
    storage.set('task_media_answer_session_demo_task_1_assignment_1_0_listening_1',
      { savedAt: '2026-10-03T10:00:00Z', answers: { q1: 'A' } })
    storage.set('task_media_answer_session_demo_task_1_assignment_1_0_video_1',
      { savedAt: '2026-10-03T10:00:00Z', answers: { q1: 'B' } })
    const work = { workId: 'work_1', taskId: 'task_1', itemId: 'dubbing', round: 1,
      stagingPath: 'private/staging', status: 'submitted', durationMs: 2200,
      submittedAt: '2026-10-03T10:00:00Z', version: 2 }
    storage.set('task_media_answer_dubbing_session_demo_task_1_dubbing_0', {
      savedAt: '2026-10-03T10:00:00Z', ownerUserId: 'student_demo', ownerSessionId: 'session_demo',
      taskId: 'task_1', itemId: 'dubbing', round: 0, localPath: '', durationMs: 0,
      fileSize: 0, work, stagingFileId: '', beginIntent: {}, sealIntent: {},
    })
    getTaskMediaPlayback.mockImplementation(async (_user: string, _task: string, itemId: string) =>
      ({ ok: true, data: playback(itemId) }))
    await import('../../miniprogram/subpackages/student/task-detail/task-detail')
    if (!definition) throw new Error('Task detail was not registered')
    const context = { data: { ...definition.data, detail: { task: { id: 'task_1', items },
      assignment: { id: 'assignment_1', redoCount: 0 } } } }
    Object.assign(context, definition.methods)
    const complete = await context.collectTaskMediaAnswers(true)
    expect(complete.error).toBe('')
    expect(complete.answers).toEqual([
      { itemId: 'listening', value: { kind: 'listening', mediaSessionId: 'media_session_listening',
        questionResponses: [{ questionId: 'q1', response: 'A' }] } },
      { itemId: 'video', value: { kind: 'video', mediaSessionId: 'media_session_video',
        questionResponses: [{ questionId: 'q1', response: 'B' }] } },
      { itemId: 'dubbing', value: { kind: 'dubbing', mediaSessionId: 'media_session_dubbing',
        finalWorkId: 'work_1' } },
    ])
    getTaskMediaPlayback.mockImplementation(async (_user: string, _task: string, itemId: string) =>
      ({ ok: true, data: playback(itemId, itemId === 'video' ? 8999 : 10000) }))
    expect((await context.collectTaskMediaAnswers(true)).error).toContain('顺序播放')
    getTaskMediaPlayback.mockImplementation(async (_user: string, _task: string, itemId: string) =>
      ({ ok: true, data: playback(itemId) }))
    context.data.detail.assignment.redoCount = 1
    storage.set('task_media_answer_session_demo_task_1_assignment_1_1_listening_1',
      { savedAt: '2026-10-03T10:00:00Z', answers: { q1: 'A' } })
    storage.set('task_media_answer_session_demo_task_1_assignment_1_1_video_1',
      { savedAt: '2026-10-03T10:00:00Z', answers: { q1: 'B' } })
    expect((await context.collectTaskMediaAnswers(true)).error).toContain('本轮')
    getTaskMediaPlayback.mockResolvedValue({ ok: false, error: { code: 'SERVICE_UNAVAILABLE',
      message: '未部署', retryable: false } })
    expect((await context.collectTaskMediaAnswers(true)).error).toContain('不可用')
    expect(await context.collectTaskMediaAnswers(false)).toEqual({ answers: [], error: '' })
  })
})
