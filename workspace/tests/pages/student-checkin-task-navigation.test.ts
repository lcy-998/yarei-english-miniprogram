import { afterEach, describe, expect, it, vi } from 'vitest'

const setCurrentBookId = vi.fn()
const setCurrentTaskId = vi.fn()
const preferDubbingMaterial = vi.fn()
vi.mock('../../miniprogram/session/session', () => ({
  getSession: () => ({ user: { id: 'student_demo' }, sessionId: 'session_demo' }),
  setCurrentBookId, setCurrentTaskId,
}))
vi.mock('../../miniprogram/shared/dubbing-navigation', () => ({ preferDubbingMaterial }))

describe('student checkin task actions', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); vi.resetModules() })

  it('opens the actual learning material and assigned exercise instead of the leaderboard', async () => {
    let definition: { data: Record<string, unknown>; methods: Record<string,
      (this: unknown, ...args: unknown[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    const navigateTo = vi.fn()
    vi.stubGlobal('wx', { navigateTo, showToast: vi.fn() })
    await import('../../miniprogram/pages/student/checkin-detail/checkin-detail')
    if (!definition) throw new Error('Checkin detail page was not registered')
    const rows = [
      { kind: 'reading', resourceId: 'book_demo', canOpen: true },
      { kind: 'vocabulary', resourceId: 'pack_demo', canOpen: true },
      { kind: 'work', resourceId: 'material_demo', canOpen: true },
      { kind: 'exercise', resourceId: 'question_demo', taskId: 'task_demo', canOpen: true },
    ]
    const context = { data: { ...definition.data, activityId: 'activity_demo', conditions: rows, activeToday: true } }
    for (let index = 0; index < rows.length; index += 1) {
      definition.methods.openCondition!.call(context, { currentTarget: { dataset: { index } } })
    }
    expect(setCurrentBookId).toHaveBeenCalledWith('book_demo')
    expect(preferDubbingMaterial).toHaveBeenCalledWith('student_demo', 'session_demo', 'material_demo')
    expect(setCurrentTaskId).toHaveBeenCalledWith('task_demo')
    expect(navigateTo.mock.calls.map(call => call[0].url)).toEqual([
      '/pages/student/reading-detail/reading-detail?bookId=book_demo&activityId=activity_demo&startPageNumber=1',
      '/pages/student/vocabulary/vocabulary?packId=pack_demo',
      '/pages/student/dubbing/dubbing', '/pages/student/task-detail/task-detail',
    ])
  })

  it('keeps future listening content visible but cannot navigate to an unbuilt page', async () => {
    let definition: { data: Record<string, unknown>; methods: Record<string,
      (this: unknown, ...args: unknown[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    const navigateTo = vi.fn()
    const showToast = vi.fn()
    vi.stubGlobal('wx', { navigateTo, showToast })
    await import('../../miniprogram/pages/student/checkin-detail/checkin-detail')
    if (!definition) throw new Error('Checkin detail page was not registered')
    const context = { data: { ...definition.data, activeToday: true,
      conditions: [{ kind: 'listening', resourceId: 'future_audio', canOpen: false }] } }
    definition.methods.openCondition!.call(context, { currentTarget: { dataset: { index: 0 } } })
    expect(navigateTo).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith({ title: '该内容后续开放', icon: 'none' })
    expect(definition.methods.openWork).toBeUndefined()
  })
})
