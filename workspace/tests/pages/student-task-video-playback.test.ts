import { afterEach, describe, expect, it, vi } from 'vitest'

const getTaskMediaPlayback = vi.fn(), reportTaskMediaHeartbeat = vi.fn()
vi.mock('../../miniprogram/subpackages/student/services/task-media-service', () => ({
  getTaskMediaPlayback, beginTaskMediaSession: vi.fn(), reportTaskMediaHeartbeat,
}))
vi.mock('../../miniprogram/subpackages/student/session/session', () => ({
  getSession: () => ({ sessionId: 'session_demo', user: { id: 'student_demo', role: 'student' } }),
  getCurrentTaskId: () => 'task_1', getTeacherReviewScoreDraft: vi.fn(),
  setCurrentBookId: vi.fn(), setTeacherReviewScoreDraft: vi.fn(),
}))

describe('S-09 task video custom playback', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); getTaskMediaPlayback.mockReset();
    reportTaskMediaHeartbeat.mockReset() })

  it('uses supported 1× fallback and rebounds a forward jump to server confirmation', async () => {
    let definition: { data: Record<string, unknown>; methods: Record<string, (...args: never[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    const seek = vi.fn(), play = vi.fn(), pause = vi.fn(), playbackRate = vi.fn()
    vi.stubGlobal('wx', { createVideoContext: () => ({ seek, play, pause, playbackRate }),
      showToast: vi.fn() })
    await import('../../miniprogram/subpackages/student/task-detail/task-detail')
    if (!definition) throw new Error('Task detail was not registered')
    const snapshot = { kind: 'video', mediaId: 'media_1', mediaVersion: 1,
      reviewVersion: 1, durationMs: 10000, questionIds: [], questions: [], clips: [],
      subtitleAvailable: true, subtitleCues: [{ startMs: 2000, endMs: 4000, text: '虚构字幕' }],
      continuousPlaybackEnforced: true }
    const playback = { status: 'ready', mediaId: 'media_1', mediaVersion: 1,
      sessionId: 'media_session_1', temporaryUrl: 'https://example.invalid/signed',
      expiresAt: '2099-01-01T00:00:00Z', confirmedThroughMs: 2000, seekForwardAllowed: false }
    reportTaskMediaHeartbeat.mockResolvedValue({ ok: true, data: {
      sessionId: 'media_session_1', confirmedThroughMs: 2000, completed: false,
    } })
    const context = { data: { ...definition.data,
      detail: { task: { id: 'task_1' }, assignment: { id: 'assignment_1' } },
      activeTaskMediaItemId: 'video_1', activeTaskMediaKind: 'video',
      activeTaskMediaSnapshot: snapshot, activeTaskMediaPlayback: playback,
      taskMediaCurrentMs: 2000, taskMediaConfirmedMs: 2000, taskMediaSpeed: 0.75,
      taskMediaLastReportedMs: 2000,
      taskMediaPlaying: false, hasUnreleasedMedia: true, editable: false },
    setData(change: Record<string, unknown>) { Object.assign(this.data, change) } }
    Object.assign(context, definition.methods)
    await context.toggleTaskMediaPlayback()
    expect(playbackRate).toHaveBeenCalledWith(1)
    expect(seek).toHaveBeenCalledWith(2)
    expect(play).toHaveBeenCalledOnce()
    context.onTaskVideoTimeUpdate({ detail: { currentTime: 0 } })
    expect(context.data.taskMediaCurrentMs).toBe(2000)
    context.onTaskVideoTimeUpdate({ detail: { currentTime: 2 } })
    expect(context.data.taskMediaSubtitle).toBe('虚构字幕')
    context.onTaskVideoTimeUpdate({ detail: { currentTime: 9 } })
    expect(pause).toHaveBeenCalled()
    expect(seek).toHaveBeenLastCalledWith(2)
    expect(context.data.taskMediaWarning).toContain('顺序播放')
    expect(context.data.hasUnreleasedMedia).toBe(true)
    context.toggleTaskMediaEarMode()
    expect(context.data.taskMediaEarMode).toBe(true)
    expect(context.data.taskMediaSubtitle).toBe('')
  })
})
