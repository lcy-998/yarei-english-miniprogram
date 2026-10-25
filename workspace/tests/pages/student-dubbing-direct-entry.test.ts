import { afterEach, describe, expect, it, vi } from 'vitest'

const getTaskDetail = vi.fn(), getTaskMediaPlayback = vi.fn(), beginTaskMediaSession = vi.fn()
vi.mock('../../miniprogram/subpackages/student-media/services/app-service', () => ({
  getTaskDetail, beginWorkDraft: vi.fn(), submitWork: vi.fn(), getMaterialPlayback: vi.fn(),
  getWorkMaterial: vi.fn(), listMyWorks: vi.fn(), listWorkMaterialFacets: vi.fn(), searchWorkMaterials: vi.fn(),
}))
vi.mock('../../miniprogram/subpackages/student-media/services/task-media-service', () => ({
  getTaskMediaPlayback, beginTaskMediaSession, reportTaskMediaHeartbeat: vi.fn(),
  listMyTaskDubbingWorks: vi.fn().mockResolvedValue({ ok: true,
    data: { items: [], nextOffset: null } }),
}))
vi.mock('../../miniprogram/subpackages/student-media/services/student-task-dubbing-service', () => ({
  beginTaskDubbingWork: vi.fn(), sealTaskDubbingWork: vi.fn(),
}))

describe('S-07 direct task dubbing entry', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules();
    getTaskDetail.mockReset(); getTaskMediaPlayback.mockReset(); beginTaskMediaSession.mockReset() })

  it('keeps the demonstration in S-07 and unlocks recording after confirmed playback', async () => {
    let definition: { data: Record<string, unknown>;
      methods: Record<string, (...args: never[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    vi.stubGlobal('getCurrentPages', () => [{ options: { taskId: 'task_demo', itemId: 'item_demo' } }])
    vi.stubGlobal('wx', { getRecorderManager: () => ({ onStop: vi.fn(), onError: vi.fn(), stop: vi.fn() }),
      getStorageSync: (key: string) => key === 'yarei_session'
        ? { sessionId: 'session_demo', user: { id: 'student_demo', role: 'student' } } : null })
    getTaskDetail.mockResolvedValue({ ok: true, data: { task: { id: 'task_demo', items: [{
      id: 'item_demo', type: 'dubbing', title: 'Demo dubbing', mediaSnapshot: {
        kind: 'dubbing', mediaId: 'media_demo', mediaVersion: 1, reviewVersion: 1,
        durationMs: 10000, questionIds: [], questions: [], clips: [],
        subtitleAvailable: false, continuousPlaybackEnforced: true,
      },
    }] }, assignment: { id: 'assignment_demo', redoCount: 0 } } })
    beginTaskMediaSession.mockResolvedValue({ ok: true, data: { status: 'unavailable',
      mediaId: 'media_demo', mediaVersion: 1, sessionId: null, temporaryUrl: null,
      expiresAt: null, confirmedThroughMs: 0, seekForwardAllowed: false,
      reason: 'SESSION_NOT_STARTED' } })
    getTaskMediaPlayback.mockResolvedValue({ ok: true, data: {
      status: 'ready', mediaId: 'media_demo', mediaVersion: 1,
      sessionId: 'media_session_demo', temporaryUrl: 'https://example.invalid/video',
      expiresAt: '2099-01-01T00:00:00Z', confirmedThroughMs: 10000,
      seekForwardAllowed: false,
    } })
    await import('../../miniprogram/subpackages/student-media/dubbing/dubbing')
    if (!definition) throw new Error('Dubbing page was not registered')
    const context = { data: { ...definition.data },
      setData(change: Record<string, unknown>) { Object.assign(this.data, change) } }
    Object.assign(context, definition.methods)
    await context.loadTaskDubbing('task_demo', 'item_demo')
    expect(context.data.loading).toBe(false)
    expect(context.data.error).toBe('')
    expect(context.data.taskPlaybackReady).toBe(false)
    await context.refreshTaskVideoPlayback()
    expect(context.data.taskPlaybackReady).toBe(true)
  })
})
