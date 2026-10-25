import { afterEach, describe, expect, it, vi } from 'vitest'

const listMyTaskDubbingWorks = vi.fn(), getTaskDubbingPlayback = vi.fn()
const setCurrentTaskId = vi.fn()
let currentSession = { sessionId: 'session_demo', user: { id: 'student_demo', role: 'student' } }
vi.mock('../../miniprogram/subpackages/student/services/task-media-service', () => ({
  listMyTaskDubbingWorks, getTaskDubbingPlayback,
}))
vi.mock('../../miniprogram/subpackages/student/services/student-pronunciation-service', () => ({
  listMyPronunciationWorks: vi.fn(), getMyPronunciationPlayback: vi.fn(),
}))
vi.mock('../../miniprogram/subpackages/student/services/app-service', () => ({
  deleteWorkDraft: vi.fn(), getWorkPlayback: vi.fn(), listMyWorks: vi.fn(), listWorkMaterials: vi.fn(),
}))
vi.mock('../../miniprogram/repositories/repository-factory', () => ({ getRepositoryMode: () => 'cloudbase' }))
vi.mock('../../miniprogram/subpackages/student/session/session', () => ({
  getSession: () => currentSession, setCurrentTaskId,
}))

describe('S-12 own classroom dubbing works', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); listMyTaskDubbingWorks.mockReset()
    getTaskDubbingPlayback.mockReset(); setCurrentTaskId.mockReset()
    currentSession = { sessionId: 'session_demo', user: { id: 'student_demo', role: 'student' } } })

  it('shows pending versus formal work and signs each playback on demand', async () => {
    let definition: { data: Record<string, unknown>; methods: Record<string, (...args: never[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    const play = vi.fn(), navigateTo = vi.fn()
    vi.stubGlobal('wx', { createInnerAudioContext: () => ({ src: '', play, stop: vi.fn(),
      destroy: vi.fn(), onEnded: vi.fn(), onError: vi.fn() }), navigateTo })
    listMyTaskDubbingWorks.mockResolvedValue({ ok: true, data: { nextOffset: null, items: [
      { workId: 'work_pending', taskId: 'task_demo', taskTitle: '真实配音任务', itemId: 'item_1',
        round: 1, status: 'task_pending', durationMs: 2200,
        submittedAt: '2026-10-05T12:00:00+08:00', playbackAvailable: true },
      { workId: 'work_formal', taskId: 'task_done', taskTitle: '已交任务', itemId: 'item_2',
        round: 1, status: 'formal', durationMs: 3000,
        submittedAt: '2026-10-05T11:00:00+08:00', playbackAvailable: false },
    ] } })
    getTaskDubbingPlayback.mockResolvedValue({ ok: true, data: { workId: 'work_pending',
      status: 'task_pending', durationMs: 2200, temporaryUrl: 'https://example.invalid/short',
      expiresAt: '2099-01-01T00:00:00Z' } })
    await import('../../miniprogram/subpackages/student/my-works/my-works')
    if (!definition) throw new Error('My works page was not registered')
    const context = { data: { ...definition.data },
      setData(change: Record<string, unknown>) { Object.assign(this.data, change) } }
    Object.assign(context, definition.methods)
    await context.loadTaskDubbingWorks()
    expect(listMyTaskDubbingWorks).toHaveBeenCalledWith('student_demo', 0, 20)
    expect(context.data.taskDubbingRows).toMatchObject([
      { workId: 'work_pending', statusLabel: '作品已封存，待任务提交' },
      { workId: 'work_formal', statusLabel: '已正式提交' },
    ])
    await context.playTaskDubbing({ currentTarget: { dataset: { id: 'work_pending' } } })
    expect(getTaskDubbingPlayback).toHaveBeenCalledWith('student_demo', 'work_pending')
    expect(play).toHaveBeenCalledOnce()
    await context.playTaskDubbing({ currentTarget: { dataset: { id: 'work_formal' } } })
    expect(getTaskDubbingPlayback).toHaveBeenCalledOnce()
    context.openTaskDubbingTask({ currentTarget: { dataset: { taskId: 'task_demo' } } })
    expect(setCurrentTaskId).toHaveBeenCalledWith('task_demo')
    expect(navigateTo).toHaveBeenCalledWith({ url: '/subpackages/student/task-detail/task-detail' })
  })

  it('discards delayed private rows after a student session changes', async () => {
    let definition: { data: Record<string, unknown>; methods: Record<string, (...args: never[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    let resolveList: ((value: unknown) => void) | null = null
    listMyTaskDubbingWorks.mockReturnValueOnce(new Promise(resolve => { resolveList = resolve }))
      .mockResolvedValueOnce({ ok: true, data: { nextOffset: null, items: [{
        workId: 'new_work', taskId: 'new_task', taskTitle: '新账号任务', itemId: 'new_item',
        round: 1, status: 'task_pending', durationMs: 2200,
        submittedAt: '2026-10-05T12:00:00+08:00', playbackAvailable: false,
      }] } })
    await import('../../miniprogram/subpackages/student/my-works/my-works')
    if (!definition) throw new Error('My works page was not registered')
    const context = { data: { ...definition.data },
      setData(change: Record<string, unknown>) { Object.assign(this.data, change) } }
    Object.assign(context, definition.methods)
    const loading = context.loadTaskDubbingWorks()
    currentSession = { sessionId: 'other_session', user: { id: 'other_student', role: 'student' } }
    await context.loadTaskDubbingWorks()
    resolveList?.({ ok: true, data: { nextOffset: null, items: [{ workId: 'private_work' }] } })
    await loading
    expect(context.data.taskDubbingRows).toMatchObject([{ workId: 'new_work' }])
    expect(context.data.taskDubbingRows).not.toContainEqual(expect.objectContaining({ workId: 'private_work' }))
  })
})
