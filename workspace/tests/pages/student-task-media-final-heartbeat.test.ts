import { afterEach, describe, expect, it, vi } from 'vitest'

const reportTaskMediaHeartbeat = vi.fn()
vi.mock('../../miniprogram/subpackages/student/services/task-media-service', () => ({
  getTaskMediaPlayback: vi.fn(), beginTaskMediaSession: vi.fn(), reportTaskMediaHeartbeat,
}))
vi.mock('../../miniprogram/subpackages/student/session/session', () => ({
  getSession: () => ({ sessionId: 'session_demo', user: { id: 'student_demo', role: 'student' } }),
  getCurrentTaskId: () => 'task_demo', getTeacherReviewScoreDraft: vi.fn(),
  setCurrentBookId: vi.fn(), setTeacherReviewScoreDraft: vi.fn(),
}))

async function page(kind: 'listening' | 'dubbing') {
  let definition: { data: Record<string, unknown>; methods: Record<string, (...args: never[]) => unknown> } | null = null
  vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
  const pause = vi.fn(), seek = vi.fn(), play = vi.fn(), playbackRate = vi.fn()
  vi.stubGlobal('wx', { createVideoContext: () => ({ pause, seek, play, playbackRate }) })
  await import('../../miniprogram/subpackages/student/task-detail/task-detail')
  if (!definition) throw new Error('Task detail was not registered')
  const context = { data: { ...definition.data,
    detail: { task: { id: 'task_demo' }, assignment: { id: 'assignment_demo' } },
    activeTaskMediaKind: kind, activeTaskMediaItemId: 'item_demo',
    activeTaskMediaSnapshot: { kind, mediaId: 'media_demo', mediaVersion: 1,
      reviewVersion: 1, durationMs: 10521, questionIds: [], questions: [], clips: [],
      subtitleAvailable: false, continuousPlaybackEnforced: true },
    activeTaskMediaPlayback: { status: 'ready', sessionId: 'media_session_demo',
      mediaId: 'media_demo', mediaVersion: 1, temporaryUrl: 'https://example.invalid/media',
      expiresAt: '2099-01-01T00:00:00Z', confirmedThroughMs: 10000,
      seekForwardAllowed: false },
    taskMediaLastReportedMs: 10000, taskMediaConfirmedMs: 10000,
    taskMediaCurrentMs: 10000, taskMediaPlaying: true },
  setData(change: Record<string, unknown>) { Object.assign(this.data, change) } }
  Object.assign(context, definition.methods)
  return { context, pause, seek, play }
}

describe('S-09 media completion heartbeat', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); reportTaskMediaHeartbeat.mockReset() })

  it('sends the final short listening interval when audio ends', async () => {
    reportTaskMediaHeartbeat.mockResolvedValue({ ok: true, data: {
      sessionId: 'media_session_demo', confirmedThroughMs: 10521, completed: true,
    } })
    const { context } = await page('listening')
    context.finishTaskMediaPlayback()
    await vi.waitFor(() => expect(context.data.taskMediaCompleted).toBe(true))
    expect(reportTaskMediaHeartbeat).toHaveBeenCalledOnce()
    expect(reportTaskMediaHeartbeat.mock.calls[0]?.slice(0, 5)).toEqual([
      'student_demo', 'media_session_demo', 10000, 10521, 10521,
    ])
    expect(context.data.taskMediaCurrentMs).toBe(10521)
    expect(context.data.taskMediaPendingHeartbeat).toBeNull()
  })

  it('waits for an in-flight video heartbeat before sending the end interval', async () => {
    let releaseFirst: ((value: unknown) => void) | null = null
    reportTaskMediaHeartbeat.mockImplementationOnce(() => new Promise(resolve => { releaseFirst = resolve }))
      .mockResolvedValueOnce({ ok: true, data: {
        sessionId: 'media_session_demo', confirmedThroughMs: 10521, completed: true,
      } })
    const { context, pause, seek, play } = await page('dubbing')
    const first = context.sendTaskMediaHeartbeat({ sessionId: 'media_session_demo',
      playedFromMs: 8000, playedToMs: 10000, positionMs: 10000, operationId: 'heartbeat_1' })
    context.onTaskVideoEnded()
    expect(context.data.taskMediaFinishPending).toBe(true)
    expect(reportTaskMediaHeartbeat).toHaveBeenCalledOnce()
    if (!releaseFirst) throw new Error('First heartbeat was not started')
    releaseFirst({ ok: true, data: { sessionId: 'media_session_demo',
      confirmedThroughMs: 10000, completed: false } })
    await first
    await vi.waitFor(() => expect(context.data.taskMediaCompleted).toBe(true))
    expect(reportTaskMediaHeartbeat).toHaveBeenCalledTimes(2)
    expect(reportTaskMediaHeartbeat.mock.calls[1]?.slice(0, 5)).toEqual([
      'student_demo', 'media_session_demo', 10000, 10521, 10521,
    ])
    expect(pause).toHaveBeenCalled()
    expect(context.data.taskMediaHeartbeatBusy).toBe(false)
    expect(context.data.taskMediaPendingHeartbeat).toBeNull()
    expect(context.data.taskMediaPlaying).toBe(false)
    expect(context.data.activeTaskMediaPlayback).toMatchObject({ confirmedThroughMs: 10521 })
    expect(await context.refreshTaskMediaPlayback()).toBe(true)
    await context.toggleTaskMediaPlayback()
    expect(seek).toHaveBeenCalledWith(0)
    expect(play).toHaveBeenCalledOnce()
    expect(context.data.taskMediaCurrentMs).toBe(0)
  })

  it('keeps the same failed heartbeat for retry, then reports the remaining end interval', async () => {
    reportTaskMediaHeartbeat.mockResolvedValueOnce({ ok: false, error: {
      code: 'NETWORK_ERROR', message: '网络中断', retryable: true,
    } }).mockResolvedValueOnce({ ok: true, data: {
      sessionId: 'media_session_demo', confirmedThroughMs: 10000, completed: false,
    } }).mockResolvedValueOnce({ ok: true, data: {
      sessionId: 'media_session_demo', confirmedThroughMs: 10521, completed: true,
    } })
    const { context } = await page('listening')
    const prior = { sessionId: 'media_session_demo', playedFromMs: 8000,
      playedToMs: 10000, positionMs: 10000, operationId: 'heartbeat_retry_demo' }
    await context.sendTaskMediaHeartbeat(prior)
    expect(context.data.taskMediaPendingHeartbeat).toEqual(prior)
    context.finishTaskMediaPlayback()
    expect(context.data.taskMediaFinishPending).toBe(true)
    await context.retryTaskMedia()
    await vi.waitFor(() => expect(context.data.taskMediaCompleted).toBe(true))
    expect(reportTaskMediaHeartbeat).toHaveBeenCalledTimes(3)
    expect(reportTaskMediaHeartbeat.mock.calls[0]?.[5]).toBe(prior.operationId)
    expect(reportTaskMediaHeartbeat.mock.calls[1]?.[5]).toBe(prior.operationId)
    expect(reportTaskMediaHeartbeat.mock.calls[2]?.slice(0, 5)).toEqual([
      'student_demo', 'media_session_demo', 10000, 10521, 10521,
    ])
  })
})
