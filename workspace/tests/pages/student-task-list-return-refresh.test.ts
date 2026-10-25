import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(), listStudentTasks: vi.fn(), listStudentActivities: vi.fn(),
}))

vi.mock('../../miniprogram/subpackages/student/session/session', () => ({ getSession: mocks.getSession,
  setCurrentTaskId: vi.fn() }))
vi.mock('../../miniprogram/subpackages/student/services/app-service', () => ({
  listStudentTasks: mocks.listStudentTasks, listStudentActivities: mocks.listStudentActivities,
  getMyActivityDay: vi.fn(),
}))

interface TaskRow { task: { id: string; dueAt: string }; assignment: { status: string; redoDueAt?: string };
  key: string; statusLabel: string; dueLabel: string }
interface PageContext {
  data: { allTasks: TaskRow[]; allActivities: []; tasks: TaskRow[]; currentFilter: string;
    timeRange: string; loadVersion: number; loading: boolean; [key: string]: unknown }
  setData: (value: Record<string, unknown>) => void
  loadTasks: () => Promise<void>
  applySubmittedTask: (taskId: string) => void
  updateVisibleTasks: (tasks: TaskRow[], activities: [], filter: string, range: string) => void
}

describe('student task list return refresh', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); vi.clearAllMocks() })

  it('moves a submitted task to review immediately and ignores an older list response', async () => {
    const { notifyStudentTaskSubmitted } = await import('../../miniprogram/subpackages/student/shared/student-task-update')
    let definition: { data: PageContext['data']; lifetimes: { attached: (this: PageContext) => void;
      detached: (this: PageContext) => void }; methods: {
        loadTasks: (this: PageContext) => Promise<void>; applySubmittedTask: (this: PageContext, id: string) => void;
        updateVisibleTasks: PageContext['updateVisibleTasks'] } } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    vi.stubGlobal('wx', { redirectTo: vi.fn() })
    mocks.getSession.mockReturnValue({ sessionId: 'session_1', user: { id: 'student_1' } })
    let resolveOld!: (value: unknown) => void
    mocks.listStudentTasks.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve }))
      .mockReturnValueOnce(new Promise(() => {}))
    mocks.listStudentActivities.mockResolvedValue({ ok: true, data: [] })
    await import('../../miniprogram/subpackages/student/task-list/task-list')
    if (!definition) throw new Error('Task list was not registered')
    const registered = definition
    const row: TaskRow = { key: 'task_1', task: { id: 'task_1', dueAt: '2026-10-22T00:00:00+08:00' },
      assignment: { status: 'in_progress' }, statusLabel: '进行中', dueLabel: '明天' }
    const context = { data: { ...registered.data, allTasks: [row], allActivities: [], tasks: [row],
      currentFilter: 'pending', timeRange: 'all', loadVersion: 0, loadedSessionId: 'session_1', loading: false },
    } as PageContext
    context.setData = value => { Object.assign(context.data, value) }
    context.loadTasks = () => registered.methods.loadTasks.call(context)
    context.applySubmittedTask = id => registered.methods.applySubmittedTask.call(context, id)
    context.updateVisibleTasks = (tasks, activities, filter, range) => registered.methods.updateVisibleTasks.call(context, tasks, activities, filter, range)
    registered.lifetimes.attached.call(context)
    const oldLoad = context.loadTasks()

    notifyStudentTaskSubmitted('session_1', 'task_1')

    expect(context.data.allTasks[0]?.assignment.status).toBe('awaiting_review')
    expect(context.data.tasks).toEqual([])
    expect(context.data.reviewCount).toBe(1)
    expect(context.data.loading).toBe(false)
    resolveOld({ ok: true, data: [row] })
    await oldLoad
    expect(context.data.allTasks[0]?.assignment.status).toBe('awaiting_review')
    registered.lifetimes.detached.call(context)
  })
})
