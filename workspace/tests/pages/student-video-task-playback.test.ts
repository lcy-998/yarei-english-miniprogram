import { afterEach, describe, expect, it, vi } from 'vitest'

const reportTaskMediaHeartbeat = vi.fn()
vi.mock('../../miniprogram/subpackages/student-media/services/task-media-service', () => ({
  beginTaskMediaSession: vi.fn(), getTaskMediaPlayback: vi.fn(), reportTaskMediaHeartbeat,
}))
vi.mock('../../miniprogram/subpackages/student-media/session/session', () => ({
  getCurrentTaskId: () => 'task_demo',
  getSession: () => ({ sessionId: 'session_demo', user: { id: 'student_demo', role: 'student' } }),
}))

async function videoPage(kind: 'video' | 'dubbing') {
  let definition: { data: Record<string, unknown>;
    methods: Record<string, (...args: never[]) => unknown> } | null = null
  vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
  const pause = vi.fn(), seek = vi.fn(), play = vi.fn(), playbackRate = vi.fn()
  vi.stubGlobal('wx', { createVideoContext: () => ({ pause, seek, play, playbackRate }) })
  await import('../../miniprogram/subpackages/student-media/video-task/video-task')
  if (!definition) throw new Error('Video task page was not registered')
  const context = { data: { ...definition.data,
    sessionId: 'session_demo', itemId: 'video_demo', kind,
    detail: { task: { id: 'task_demo' }, assignment: { id: 'assignment_demo' } },
    snapshot: { kind, mediaId: 'media_demo', mediaVersion: 1,
      reviewVersion: 1, durationMs: 10521, questionIds: [], questions: [], clips: [],
      subtitleAvailable: false, continuousPlaybackEnforced: true },
    playback: { status: 'ready', mediaId: 'media_demo', mediaVersion: 1,
      sessionId: 'media_session_demo', temporaryUrl: 'https://example.invalid/video',
      expiresAt: '2099-01-01T00:00:00Z', confirmedThroughMs: 10000, seekForwardAllowed: false },
    currentMs: 10000, confirmedMs: 10000, lastReportedMs: 10000 },
  setData(change: Record<string, unknown>) { Object.assign(this.data, change) } }
  Object.assign(context, definition.methods)
  return { context, pause, seek, play }
}

describe('independent video task playback', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); reportTaskMediaHeartbeat.mockReset() })

  it('rejects a forward seek and preserves the confirmed position', async () => {
    const { context, seek } = await videoPage('video')
    context.seek({ detail: { percent: 100 } })
    expect(seek).toHaveBeenCalledWith(10)
    expect(context.data.currentMs).toBe(10000)
    expect(context.data.warning).toContain('不能跳过')
  })

  it('reports the final short interval for task dubbing before recording unlocks', async () => {
    reportTaskMediaHeartbeat.mockResolvedValue({ ok: true, data: {
      sessionId: 'media_session_demo', confirmedThroughMs: 10521, completed: true,
    } })
    const { context, pause } = await videoPage('dubbing')
    context.onVideoEnded()
    await vi.waitFor(() => expect(context.data.completed).toBe(true))
    expect(reportTaskMediaHeartbeat.mock.calls[0]?.slice(0, 5)).toEqual([
      'student_demo', 'media_session_demo', 10000, 10521, 10521,
    ])
    expect(pause).toHaveBeenCalled()
  })
})
