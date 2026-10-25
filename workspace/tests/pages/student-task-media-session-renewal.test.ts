import { afterEach, describe, expect, it, vi } from 'vitest'

const getTaskMediaPlayback = vi.fn()
const beginTaskMediaSession = vi.fn()
vi.mock('../../miniprogram/subpackages/student/services/task-media-service', () => ({
  getTaskMediaPlayback, beginTaskMediaSession,
}))
vi.mock('../../miniprogram/subpackages/student/session/session', () => ({
  getSession: () => ({ sessionId: 'login_1', user: { id: 'student_1', role: 'student' } }),
}))

describe('S-09 media submission session renewal', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
    getTaskMediaPlayback.mockReset()
    beginTaskMediaSession.mockReset()
  })

  it('renews an expired listening session and retains its server confirmed position', async () => {
    let definition: { data: Record<string, unknown>;
      methods: Record<string, (...args: never[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    vi.stubGlobal('wx', { getStorageSync: () => null })
    await import('../../miniprogram/subpackages/student/task-detail/task-detail')
    if (!definition) throw new Error('Task detail was not registered')

    const snapshot = { kind: 'listening', mediaId: 'media_1', mediaVersion: 1,
      durationMs: 10000, continuousPlaybackEnforced: true, questionIds: [], questions: [], clips: [] }
    const detail = { task: { id: 'task_1', version: 1, items: [{
      id: 'item_1', type: 'listening', title: 'Listening', mediaSnapshot: snapshot,
    }] }, assignment: { id: 'assignment_1', redoCount: 0 } }
    getTaskMediaPlayback.mockResolvedValue({ ok: true, data: {
      status: 'expired', mediaId: 'media_1', mediaVersion: 1, sessionId: null,
      temporaryUrl: null, expiresAt: null, confirmedThroughMs: 10000,
      seekForwardAllowed: false,
    } })
    beginTaskMediaSession.mockResolvedValue({ ok: true, data: {
      status: 'ready', mediaId: 'media_1', mediaVersion: 1, sessionId: 'renewed_1',
      temporaryUrl: 'https://example.invalid/audio', expiresAt: '2099-01-01T00:00:00Z',
      confirmedThroughMs: 10000, seekForwardAllowed: false,
    } })

    const context = { data: { ...definition.data, detail },
      setData(change: Record<string, unknown>) { Object.assign(this.data, change) } }
    Object.assign(context, definition.methods)
    expect(await context.collectTaskMediaAnswers(true)).toEqual({ answers: [{
      itemId: 'item_1', value: { kind: 'listening', mediaSessionId: 'renewed_1',
        questionResponses: [] },
    }], error: '' })
    expect(beginTaskMediaSession).toHaveBeenCalledWith('student_1', 'task_1', 'item_1',
      expect.stringMatching(/^renew_task_media_submit_/))
  })
})
