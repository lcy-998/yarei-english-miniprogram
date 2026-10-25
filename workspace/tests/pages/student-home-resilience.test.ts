import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(), getHome: vi.fn(), getProfile: vi.fn(), listNotifications: vi.fn(),
  listStudentActivities: vi.fn(), getMyActivityDay: vi.fn(), getRepositoryMode: vi.fn(),
}))

vi.mock('../../miniprogram/subpackages/student/session/session', () => ({ getSession: mocks.getSession, setCurrentTaskId: vi.fn() }))
vi.mock('../../miniprogram/subpackages/student/services/app-service', () => ({ getHome: mocks.getHome,
  getMyActivityDay: mocks.getMyActivityDay, listNotifications: mocks.listNotifications,
  listStudentActivities: mocks.listStudentActivities }))
vi.mock('../../miniprogram/subpackages/student/services/m1-app-service', () => ({ getProfile: mocks.getProfile }))
vi.mock('../../miniprogram/repositories/repository-factory', () => ({ getRepositoryMode: mocks.getRepositoryMode }))

type PageDefinition = { data: Record<string, unknown>; methods: Record<string, (this: PageContext, ...args: unknown[]) => void | Promise<void>>;
  lifetimes: { attached: (this: PageContext) => void; detached: (this: PageContext) => void } }
type PageContext = { data: Record<string, unknown>; setData: (update: Record<string, unknown>) => void }

async function page(storage: Map<string, unknown>): Promise<{ definition: PageDefinition; context: PageContext }> {
  let definition: PageDefinition | null = null
  vi.stubGlobal('Component', (value: PageDefinition) => { definition = value })
  vi.stubGlobal('wx', {
    getStorageSync: (key: string) => storage.get(key),
    setStorageSync: (key: string, value: unknown) => storage.set(key, value),
    getMenuButtonBoundingClientRect: () => ({ bottom: 54 }),
    redirectTo: vi.fn(), navigateTo: vi.fn(),
  })
  await import('../../miniprogram/subpackages/student/home/index')
  if (!definition) throw new Error('Student home was not registered')
  const registered = definition as PageDefinition
  const context: PageContext = { data: { ...registered.data }, setData(update) { Object.assign(this.data, update) } }
  return { definition: registered, context }
}

function homeResult() {
  return { ok: true, data: { user: { id: 'student_1', displayName: '小树', role: 'student' },
    task: null, assignment: null, todayTasks: [], completedCount: 0, totalCount: 0 } }
}

describe('student home service resilience', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); vi.clearAllMocks() })

  it('keeps the classroom home visible when activity lookup fails', async () => {
    mocks.getSession.mockReturnValue({ sessionId: 'session_1', user: { id: 'student_1' } })
    mocks.getHome.mockResolvedValue(homeResult())
    mocks.getProfile.mockResolvedValue({ ok: true, data: { className: '三年级二班' } })
    mocks.listNotifications.mockResolvedValue({ ok: true, data: { unreadCount: 0 } })
    mocks.listStudentActivities.mockResolvedValue({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } })
    mocks.getRepositoryMode.mockReturnValue('cloudbase')
    const { definition, context } = await page(new Map())

    await definition.methods.loadHome.call(context)

    expect(context.data.hasHome).toBe(true)
    expect(context.data.error).toBe('')
    expect(context.data.refreshError).toContain('打卡活动更新失败')
  })

  it('retries one transient first-load home failure', async () => {
    mocks.getSession.mockReturnValue({ sessionId: 'session_1', user: { id: 'student_1' } })
    mocks.getHome.mockResolvedValueOnce({ ok: false, error: { code: 'SERVICE_UNAVAILABLE',
      message: '服务暂不可用，请稍后重试', retryable: true } }).mockResolvedValueOnce(homeResult())
    mocks.getProfile.mockResolvedValue({ ok: true, data: { className: '三年级二班' } })
    mocks.listNotifications.mockResolvedValue({ ok: true, data: { unreadCount: 0 } })
    mocks.listStudentActivities.mockResolvedValue({ ok: true, data: [] })
    mocks.getRepositoryMode.mockReturnValue('cloudbase')
    const { definition, context } = await page(new Map())

    await definition.methods.loadHome.call(context)

    expect(mocks.getHome).toHaveBeenCalledTimes(2)
    expect(context.data.hasHome).toBe(true)
    expect(context.data.error).toBe('')
  })

  it('shows the last same-session summary when the home request later fails', async () => {
    mocks.getSession.mockReturnValue({ sessionId: 'session_1', user: { id: 'student_1' } })
    mocks.getHome.mockResolvedValueOnce(homeResult()).mockResolvedValueOnce({ ok: false,
      error: { code: 'SERVICE_UNAVAILABLE', message: '服务暂不可用，请稍后重试' } })
    mocks.getProfile.mockResolvedValue({ ok: true, data: { className: '三年级二班' } })
    mocks.listNotifications.mockResolvedValue({ ok: true, data: { unreadCount: 0 } })
    mocks.listStudentActivities.mockResolvedValue({ ok: true, data: [] })
    mocks.getRepositoryMode.mockReturnValue('cloudbase')
    const storage = new Map<string, unknown>()
    const first = await page(storage)
    await first.definition.methods.loadHome.call(first.context)
    expect(storage.size).toBe(1)

    vi.resetModules()
    const second = await page(storage)
    await second.definition.methods.loadHome.call(second.context)

    expect(second.context.data.hasHome).toBe(true)
    expect(second.context.data.displayName).toBe('小树')
    expect(second.context.data.error).toBe('')
    expect(second.context.data.refreshError).toContain('显示')
  })

  it('does not show another session\'s cached summary', async () => {
    mocks.getSession.mockReturnValue({ sessionId: 'session_1', user: { id: 'student_1' } })
    mocks.getHome.mockResolvedValueOnce(homeResult()).mockResolvedValueOnce({ ok: false,
      error: { code: 'SERVICE_UNAVAILABLE', message: '服务暂不可用，请稍后重试', retryable: false } })
    mocks.getProfile.mockResolvedValue({ ok: true, data: { className: '三年级二班' } })
    mocks.listNotifications.mockResolvedValue({ ok: true, data: { unreadCount: 0 } })
    mocks.listStudentActivities.mockResolvedValue({ ok: true, data: [] })
    mocks.getRepositoryMode.mockReturnValue('cloudbase')
    const storage = new Map<string, unknown>()
    const first = await page(storage)
    await first.definition.methods.loadHome.call(first.context)

    vi.resetModules()
    mocks.getSession.mockReturnValue({ sessionId: 'session_2', user: { id: 'student_1' } })
    const second = await page(storage)
    await second.definition.methods.loadHome.call(second.context)

    expect(second.context.data.hasHome).toBe(false)
    expect(second.context.data.error).toBe('服务暂不可用，请稍后重试')
    expect(second.context.data.displayName).toBe('')
  })

  it('dims an acknowledged task immediately while the return refresh is pending', async () => {
    const { notifyStudentTaskSubmitted } = await import('../../miniprogram/subpackages/student/shared/student-task-update')
    mocks.getSession.mockReturnValue({ sessionId: 'session_1', user: { id: 'student_1' } })
    mocks.getHome.mockImplementation(() => new Promise(() => {}))
    mocks.getProfile.mockResolvedValue({ ok: true, data: { className: '三年级二班' } })
    mocks.listNotifications.mockResolvedValue({ ok: true, data: { unreadCount: 0 } })
    mocks.listStudentActivities.mockResolvedValue({ ok: true, data: [] })
    const { definition, context } = await page(new Map())
    Object.assign(context.data, { hasHome: true, loadedSessionId: 'session_1', todayCompletedCount: 0,
      todayItems: [{ key: 'task:task_1', kind: 'task', id: 'task_1', title: '阅读',
        statusLabel: '进行中', dueLabel: '进行中 · 明天 截止', dueAt: '2026-10-22T00:00:00+08:00',
        completed: false, priority: 3 }] })
    Object.assign(context, { loadHome: () => definition.methods.loadHome.call(context),
      applySubmittedTask: (taskId: string) => definition.methods.applySubmittedTask.call(context, taskId) })
    definition.lifetimes.attached.call(context)

    notifyStudentTaskSubmitted('session_1', 'task_1')

    const item = (context.data.todayItems as Array<{ completed: boolean; dueLabel: string }>)[0]
    expect(item.completed).toBe(true)
    expect(item.dueLabel).toContain('待检查')
    expect(context.data.todayCompletedCount).toBe(1)
    expect(context.data.loading).toBe(false)
    definition.lifetimes.detached.call(context)
  })
})
