import { afterEach, describe, expect, it, vi } from 'vitest'

const setCurrentTaskId = vi.fn()
vi.mock('../../miniprogram/session/session', () => ({ setCurrentTaskId, getSession: vi.fn() }))

describe('student home task rows', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); vi.clearAllMocks() })

  it('opens the tapped classroom task or checkin activity independently', async () => {
    let definition: { data: Record<string, unknown>; methods: Record<string,
      (this: unknown, ...args: unknown[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    const navigateTo = vi.fn()
    vi.stubGlobal('wx', { navigateTo })
    await import('../../miniprogram/pages/index/index')
    if (!definition) throw new Error('Student home was not registered')
    const context = { data: { ...definition.data, todayItems: [
      { id: 'task_1', kind: 'task' }, { id: 'activity_1', kind: 'activity' },
    ] } }
    definition.methods.openTodayItem!.call(context, { currentTarget: { dataset: { id: 'activity_1', kind: 'activity' } } })
    definition.methods.openTodayItem!.call(context, { currentTarget: { dataset: { id: 'task_1', kind: 'task' } } })
    definition.methods.openTodayItem!.call(context, { currentTarget: { dataset: { id: 'unknown', kind: 'task' } } })
    expect(navigateTo.mock.calls.map(call => call[0].url)).toEqual([
      '/pages/student/checkin-detail/checkin-detail?activityId=activity_1',
      '/pages/student/task-detail/task-detail',
    ])
    expect(setCurrentTaskId).toHaveBeenCalledOnce()
    expect(setCurrentTaskId).toHaveBeenCalledWith('task_1')
  })
})
