import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({
  session: { sessionId: 'session_parent', user: { id: 'parent_demo', role: 'parent' }, activeRole: 'parent' } as
    { sessionId: string; user: { id: string; role: string }; activeRole: string },
  childId: 'child_a', taskId: '',
  getParentHome: vi.fn(), listParentChildren: vi.fn(), listNotifications: vi.fn(),
  listChildren: vi.fn(), unbindChild: vi.fn(), bindChild: vi.fn(), chooseChild: vi.fn(),
  markNotificationRead: vi.fn(), markAllNotificationsRead: vi.fn(),
  setCurrentChildId: vi.fn(), setCurrentTaskId: vi.fn(),
}))

vi.mock('../../miniprogram/services/app-service', () => ({
  getParentHome: mock.getParentHome, listParentChildren: mock.listParentChildren,
  listNotifications: mock.listNotifications, markNotificationRead: mock.markNotificationRead,
  markAllNotificationsRead: mock.markAllNotificationsRead,
}))
vi.mock('../../miniprogram/subpackages/parent/services/app-service', () => ({
  getParentHome: mock.getParentHome, listParentChildren: mock.listParentChildren,
  bindChild: mock.bindChild, unbindChild: mock.unbindChild,
  listNotifications: mock.listNotifications, markNotificationRead: mock.markNotificationRead,
  markAllNotificationsRead: mock.markAllNotificationsRead,
}))
vi.mock('../../miniprogram/subpackages/common/services/app-service', () => ({
  getParentHome: mock.getParentHome, listParentChildren: mock.listParentChildren,
  listNotifications: mock.listNotifications, markNotificationRead: mock.markNotificationRead,
  markAllNotificationsRead: mock.markAllNotificationsRead,
}))
vi.mock('../../miniprogram/services/m1-app-service', () => ({
  listChildren: mock.listChildren, unbindChild: mock.unbindChild,
  bindChild: mock.bindChild, chooseChild: mock.chooseChild,
}))
vi.mock('../../miniprogram/subpackages/parent/services/m1-app-service', () => ({
  listChildren: mock.listChildren, unbindChild: mock.unbindChild,
  bindChild: mock.bindChild, chooseChild: mock.chooseChild,
}))
vi.mock('../../miniprogram/session/session', () => ({
  getSession: () => mock.session,
  getCurrentChildId: () => mock.childId,
  setCurrentChildId: (value: string) => { mock.childId = value; mock.setCurrentChildId(value) },
  getCurrentTaskId: () => mock.taskId,
  setCurrentTaskId: (value: string) => { mock.taskId = value; mock.setCurrentTaskId(value) },
}))
vi.mock('../../miniprogram/subpackages/parent/session/session', () => ({
  getSession: () => mock.session,
  getCurrentChildId: () => mock.childId,
  setCurrentChildId: (value: string) => { mock.childId = value; mock.setCurrentChildId(value) },
  getCurrentTaskId: () => mock.taskId,
  setCurrentTaskId: (value: string) => { mock.taskId = value; mock.setCurrentTaskId(value) },
}))
vi.mock('../../miniprogram/subpackages/common/session/session', () => ({
  getSession: () => mock.session,
  getCurrentChildId: () => mock.childId,
  setCurrentChildId: (value: string) => { mock.childId = value; mock.setCurrentChildId(value) },
  getCurrentTaskId: () => mock.taskId,
  setCurrentTaskId: (value: string) => { mock.taskId = value; mock.setCurrentTaskId(value) },
}))
vi.mock('../../miniprogram/shared/write-intent', () => ({ createPageOperationId: () => 'op_demo' }))

interface PageDefinition {
  data: Record<string, unknown>
  methods: Record<string, (this: PageContext, ...args: never[]) => unknown>
}
interface PageContext {
  data: Record<string, unknown>
  setData(value: Record<string, unknown>, done?: () => void): void
}

async function page(path: string): Promise<{ definition: PageDefinition; context: PageContext }> {
  let definition: PageDefinition | null = null
  vi.stubGlobal('Component', (value: PageDefinition) => { definition = value })
  await import(/* @vite-ignore */ path)
  if (!definition) throw new Error('Page was not registered')
  const selected = definition as PageDefinition
  const context: PageContext = { data: { ...selected.data },
    setData(value, done) { Object.assign(this.data, value); done?.() } }
  return { definition: selected, context }
}

function home(childId: string, title: string) {
  return { ok: true, data: { user: { id: 'parent_demo' },
    child: { id: childId, displayName: title, className: '三年级 2 班' }, tasks: [],
    weeklyAssignedCount: 2, weeklyCompletedCount: 1,
    pendingTaskCount: 6, overdueTaskCount: 1, recentFeedback: [] } }
}

describe('M3 家长页面切换、缓存与通知深链', () => {
  beforeEach(() => {
    mock.childId = 'child_a'; mock.taskId = ''
    mock.session = { sessionId: 'session_parent', user: { id: 'parent_demo', role: 'parent' }, activeRole: 'parent' }
    mock.listNotifications.mockResolvedValue({ ok: true, data: { unreadCount: 2 } })
    vi.stubGlobal('wx', { navigateTo: vi.fn(), redirectTo: vi.fn(), reLaunch: vi.fn(),
      showToast: vi.fn(), showModal: vi.fn() })
  })
  afterEach(() => { vi.clearAllMocks(); vi.resetModules(); vi.unstubAllGlobals() })

  it('切换孩子后立即隐藏旧孩子概览，不能让旧请求覆盖新孩子', async () => {
    mock.getParentHome.mockResolvedValueOnce(home('child_a', '小甲'))
    let resolveNext: ((value: unknown) => void) | null = null
    mock.getParentHome.mockImplementationOnce(() => new Promise(resolve => { resolveNext = resolve }))
    const { definition, context } = await page('../../miniprogram/subpackages/parent/home/home')
    await definition.methods.loadHome.call(context)
    expect(context.data.childName).toBe('小甲')
    mock.childId = 'child_b'
    const pending = definition.methods.loadHome.call(context)
    expect(context.data.childName).toBe('')
    expect(context.data.tasks).toEqual([])
    if (!resolveNext) throw new Error('Second child request did not start')
    resolveNext(home('child_b', '小乙'))
    await pending
    expect(context.data.childName).toBe('小乙')
    expect(context.data.pendingCountLabel).toBe('6')
  })

  it('短暂断网保留同会话孩子的最近可信概览和重试提示', async () => {
    mock.getParentHome.mockResolvedValueOnce(home('child_a', '小甲'))
      .mockResolvedValueOnce({ ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: '网络暂不可用' } })
    const { definition, context } = await page('../../miniprogram/subpackages/parent/home/home')
    await definition.methods.loadHome.call(context)
    await definition.methods.loadHome.call(context)
    expect(context.data.childName).toBe('小甲')
    expect(context.data.completionRateLabel).toBe('50%')
    expect(context.data.refreshError).toBe('网络暂不可用')
  })

  it('孩子列表暂时刷新失败保留已绑定关系，解绑后立即切到剩余孩子', async () => {
    const children = [{ childId: 'child_a', displayName: '小甲', linkVersion: 1 },
      { childId: 'child_b', displayName: '小乙', linkVersion: 1 }]
    mock.listParentChildren.mockResolvedValueOnce({ ok: true, data: children })
      .mockResolvedValueOnce({ ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: '请重试' } })
    mock.unbindChild.mockResolvedValue({ ok: true, data: null })
    const showModal = vi.fn((options: { success: (value: { confirm: boolean }) => void }) => options.success({ confirm: true }))
    vi.stubGlobal('wx', { showModal, showToast: vi.fn(), reLaunch: vi.fn() })
    const { definition, context } = await page('../../miniprogram/subpackages/parent/children/children')
    await definition.methods.loadChildren.call(context)
    await definition.methods.loadChildren.call(context)
    expect(mock.listParentChildren).toHaveBeenCalledWith('parent_demo')
    expect(mock.listChildren).not.toHaveBeenCalled()
    expect((context.data.children as unknown[]).length).toBe(2)
    definition.methods.removeChild.call(context, { currentTarget: { dataset: { id: 'child_a', version: 1 } } } as never)
    await vi.waitFor(() => expect(mock.setCurrentChildId).toHaveBeenLastCalledWith('child_b'))
    expect((context.data.children as unknown[]).length).toBe(1)
  })

  it('孩子页使用与首页相同的绑定列表，切换孩子后首页读取所选孩子', async () => {
    mock.listParentChildren.mockResolvedValue({ ok: true, data: [
      { childId: 'child_a', displayName: '小甲', linkVersion: 1 },
      { childId: 'child_b', displayName: '小乙', linkVersion: 2 },
    ] })
    const { definition, context } = await page('../../miniprogram/subpackages/parent/children/children')
    await definition.methods.loadChildren.call(context)
    await definition.methods.selectChild.call(context,
      { currentTarget: { dataset: { id: 'child_b' } } } as never)
    expect(mock.setCurrentChildId).toHaveBeenLastCalledWith('child_b')
    expect(mock.chooseChild).not.toHaveBeenCalled()
    expect(wx.reLaunch).toHaveBeenCalledWith({ url: '/subpackages/parent/home/home' })
  })

  it('P-05 只在重新验权成功后跳到当前绑定孩子，失效通知不导航', async () => {
    const navigateTo = vi.fn()
    vi.stubGlobal('wx', { navigateTo, showToast: vi.fn() })
    const { definition, context } = await page('../../miniprogram/subpackages/common/notifications/notifications')
    const notice = { id: 'notice_a', readAt: null, target: { kind: 'parent_task',
      childId: 'child_a', id: 'task_a' } }
    context.data.rows = [notice]; context.data.unreadCount = 1
    mock.markNotificationRead.mockResolvedValueOnce({ ok: false, error: { code: 'NOT_FOUND' } })
    await definition.methods.openNotice.call(context, { currentTarget: { dataset: { id: 'notice_a' } } } as never)
    expect(navigateTo).not.toHaveBeenCalled()
    expect(context.data.rows).toEqual([])
    context.data.rows = [notice]; context.data.unreadCount = 1
    mock.markNotificationRead.mockResolvedValueOnce({ ok: true, data: { ...notice, readAt: '2026-10-03T10:00:00.000Z' } })
    await definition.methods.openNotice.call(context, { currentTarget: { dataset: { id: 'notice_a' } } } as never)
    expect(mock.setCurrentChildId).toHaveBeenLastCalledWith('child_a')
    expect(mock.setCurrentTaskId).toHaveBeenLastCalledWith('task_a')
    expect(navigateTo).toHaveBeenCalledWith({ url: '/subpackages/parent/task-detail/task-detail' })
  })

  it('P-05 标记已读期间切换身份时丢弃旧家长深链回执', async () => {
    const navigateTo = vi.fn()
    vi.stubGlobal('wx', { navigateTo, showToast: vi.fn() })
    const { definition, context } = await page('../../miniprogram/subpackages/common/notifications/notifications')
    const notice = { id: 'notice_old', readAt: null,
      target: { kind: 'parent_task', childId: 'child_a', id: 'task_old' } }
    context.data.rows = [notice]; context.data.unreadCount = 1
    let finish: ((value: unknown) => void) | null = null
    mock.markNotificationRead.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const pending = definition.methods.openNotice.call(context,
      { currentTarget: { dataset: { id: 'notice_old' } } } as never)
    mock.session = { ...mock.session, activeRole: 'teacher' }
    if (!finish) throw new Error('Mark read request did not start')
    finish({ ok: true, data: { ...notice, readAt: '2026-10-03T10:00:00.000Z' } })
    await pending
    expect(navigateTo).not.toHaveBeenCalled()
    expect(mock.setCurrentChildId).not.toHaveBeenCalled()
    expect(context.data.rows).toEqual([])
  })
})
