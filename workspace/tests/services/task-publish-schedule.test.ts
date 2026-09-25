import { beforeEach, describe, expect, it } from 'vitest'
import { getDraftOptions, getTaskDetail, publishClassroomTask } from '../../miniprogram/services/app-service'
import { getState, initialState, replaceState } from '../../miniprogram/repositories/memory/mock-state'
import { configureRepositories } from '../../miniprogram/repositories/repository-factory'

const teacherId = 'usr_teacher_lin'

describe('M1 classroom task time and reading resource', () => {
  beforeEach(() => { configureRepositories({ mode: 'memory' }); replaceState(initialState) })

  it('defaults the deadline to 24 hours after the start', async () => {
    const now = new Date('2026-09-24T08:15:00.000Z')
    const options = await getDraftOptions(teacherId, { now: () => now })
    expect(options.ok).toBe(true)
    if (!options.ok) return
    expect(Date.parse(options.data.structuredDraft.dueAt) - Date.parse(options.data.structuredDraft.startsAt)).toBe(24 * 60 * 60 * 1000)
  })

  it('persists the selected deadline and a reading resource the student can open', async () => {
    const options = await getDraftOptions(teacherId)
    expect(options.ok).toBe(true)
    if (!options.ok) return
    const startsAt = '2026-09-25T08:00:00.000Z'
    const dueAt = '2026-09-27T09:30:00.000Z'
    const published = await publishClassroomTask(teacherId, {
      operationId: 'op_task_schedule_reading', expectedVersion: 0, title: '阅读任务', description: '阅读三页',
      structuredDraft: { ...options.data.structuredDraft, startsAt, dueAt },
    })
    expect(published).toMatchObject({ ok: true, data: { startsAt, dueAt } })
    if (!published.ok) return
    expect(published.data.items[0]?.resourceId).toBe('book_zoo')
    expect(getState().assignments.filter(item => item.taskId === published.data.id)).toHaveLength(36)
    const studentDetail = await getTaskDetail('usr_student_xiaoyu', published.data.id)
    expect(studentDetail).toMatchObject({ ok: true, data: { task: { dueAt } } })
    if (studentDetail.ok) expect(studentDetail.data.task.items[0]?.resourceId).toBe('book_zoo')
  })

  it('publishes only to the selected authorized student', async () => {
    const options = await getDraftOptions(teacherId)
    expect(options.ok).toBe(true)
    if (!options.ok) return
    const published = await publishClassroomTask(teacherId, {
      operationId: 'op_task_single_student', expectedVersion: 0, title: '个人阅读任务', description: '',
      structuredDraft: { ...options.data.structuredDraft, target: { type: 'students', studentIds: ['usr_student_xiaoyu'] } },
    })
    expect(published.ok).toBe(true)
    if (!published.ok) return
    expect(getState().assignments.filter(item => item.taskId === published.data.id).map(item => item.studentId)).toEqual(['usr_student_xiaoyu'])
  })

  it('rejects an invalid deadline without creating a task', async () => {
    const options = await getDraftOptions(teacherId)
    expect(options.ok).toBe(true)
    if (!options.ok) return
    const before = getState().tasks.length
    const result = await publishClassroomTask(teacherId, {
      operationId: 'op_task_schedule_invalid', expectedVersion: 0, title: '无效时间任务', description: '',
      structuredDraft: { ...options.data.structuredDraft, startsAt: '2026-09-27T09:30:00.000Z', dueAt: '2026-09-26T09:30:00.000Z' },
    })
    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } })
    expect(getState().tasks).toHaveLength(before)
  })
})
