import { beforeEach, describe, expect, it } from 'vitest'
import { getTeacherWorkbench } from '../../miniprogram/services/app-service'
import { initialState, replaceState } from '../../miniprogram/repositories/memory/mock-state'
import { configureRepositories } from '../../miniprogram/repositories/repository-factory'

const teacherId = 'usr_teacher_lin'
const taskDate = initialState.tasks[0]!.startsAt.slice(0, 10)

describe('teacher workbench summary', () => {
  beforeEach(() => { configureRepositories({ mode: 'memory' }); replaceState(initialState) })

  it('uses the authorized task summary for submitted and pending counts', async () => {
    const result = await getTeacherWorkbench(teacherId, taskDate, 'cls_grade3_2')
    expect(result).toMatchObject({ ok: true, data: {
      activeTaskCount: 1, pendingReviewCount: 6,
      recentTasks: [{ taskId: 'tsk_animals_listening', completedCount: 27, totalCount: 36 }],
    } })
  })

  it('does not present a draft as a current classroom task', async () => {
    replaceState({ ...initialState, tasks: initialState.tasks.map(task => ({ ...task, status: 'draft' as const })) })
    const result = await getTeacherWorkbench(teacherId, taskDate)
    expect(result).toMatchObject({ ok: true, data: { activeTaskCount: 0, recentTasks: [] } })
  })
})
