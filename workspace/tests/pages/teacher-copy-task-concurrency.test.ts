import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../miniprogram/services/app-service', () => ({
  getTeacherTaskForEdit: vi.fn(),
  copyTeacherTaskSnapshot: vi.fn(),
  getTeacherTasks: vi.fn(),
  previewTeacherTask: vi.fn(),
  recycleTeacherTask: vi.fn(),
}))

describe('T-07 copy action', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('locks before the first async read so rapid taps create one snapshot draft', async () => {
    let moreAction: ((this: unknown, event: WechatMiniprogram.TouchEvent) => Promise<void>) | null = null
    vi.stubGlobal('Component', (definition: { methods: { moreAction: typeof moreAction } }) => {
      moreAction = definition.methods.moreAction
    })
    const navigateTo = vi.fn()
    vi.stubGlobal('wx', { getStorageSync: () => ({ user: { id: 'teacher_demo', role: 'teacher' } }),
      navigateTo, showToast: vi.fn() })
    const services = await import('../../miniprogram/services/app-service')
    let finishRead: ((result: unknown) => void) | null = null
    vi.mocked(services.getTeacherTaskForEdit).mockImplementation(() => new Promise(resolve => {
      finishRead = resolve as (result: unknown) => void
    }))
    vi.mocked(services.copyTeacherTaskSnapshot).mockResolvedValue({ ok: true,
      data: { taskId: 'task_copied_demo', version: 1 } })
    await import('../../miniprogram/pages/teacher/task-review-list/task-review-list')
    if (moreAction === null) throw new Error('Copy handler was not registered')
    const context = { data: { allRows: [{ id: 'task_source_demo', version: 2 }], copyInProgress: false,
      copySourceKey: '', copyOperationId: '' },
    setData(change: Record<string, unknown>) { Object.assign(this.data, change) } }
    const event = { currentTarget: { dataset: { action: 'copy', id: 'task_source_demo' } } } as unknown as WechatMiniprogram.TouchEvent
    const first = moreAction.call(context, event)
    const second = moreAction.call(context, event)
    await second
    expect(services.getTeacherTaskForEdit).toHaveBeenCalledTimes(1)
    if (finishRead === null) throw new Error('Source read was not started')
    finishRead({ ok: true, data: { taskId: 'task_source_demo', status: 'active', version: 2,
      title: '虚构阅读任务', description: '', itemRefs: [{ id: 'item_reading' }],
      items: [{ resourceId: 'resource_reading_demo' }] } })
    await first
    expect(services.copyTeacherTaskSnapshot).toHaveBeenCalledTimes(1)
    expect(navigateTo).toHaveBeenCalledWith({ url: '/pages/teacher/publish-task/publish-task?editTaskId=task_copied_demo' })
  })
})
