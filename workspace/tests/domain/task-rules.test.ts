import { describe, expect, it } from 'vitest'
import { canPublishReview, canSubmitAssignment, getTodayTask, nextAssignmentStatusAfterSubmit } from '../../miniprogram/domain/task-rules'
import { Task, TaskAssignment } from '../../miniprogram/domain/types'

const assignment = (status: TaskAssignment['status']): TaskAssignment => ({ id: 'asn_demo', taskId: 'tsk_demo', studentId: 'usr_student', classId: 'cls_demo', status, progressPercent: 0, redoCount: 0 })
const task = (id: string, dueAt: string): Task => ({ id, title: id, deliveryType: 'classroom', status: 'active', creatorTeacherId: 'usr_teacher', classId: 'cls_demo', startsAt: '2026-09-11T08:00:00+08:00', dueAt, description: '', items: [], version: 1 })

describe('M0 task rules', () => {
  it('allows submission only while an assignment is actionable', () => {
    expect(canSubmitAssignment(assignment('not_started'))).toBe(true)
    expect(canSubmitAssignment(assignment('in_progress'))).toBe(true)
    expect(canSubmitAssignment(assignment('redo_required'))).toBe(true)
    expect(canSubmitAssignment(assignment('awaiting_review'))).toBe(false)
    expect(nextAssignmentStatusAfterSubmit()).toBe('awaiting_review')
  })

  it('requires a reason when a teacher returns work', () => {
    expect(canPublishReview(assignment('awaiting_review'), 'approved')).toBe(true)
    expect(canPublishReview(assignment('awaiting_review'), 'returned')).toBe(false)
    expect(canPublishReview(assignment('awaiting_review'), 'returned', '请补充练习记录')).toBe(true)
    expect(canPublishReview(assignment('completed'), 'approved')).toBe(false)
  })

  it('chooses the earliest actionable task as the home task', () => {
    const first = task('tsk_early', '2026-09-11T18:00:00+08:00')
    const second = task('tsk_late', '2026-09-11T20:00:00+08:00')
    const result = getTodayTask([second, first], [{ ...assignment('in_progress'), taskId: first.id }, { ...assignment('completed'), id: 'asn_done', taskId: second.id }], 'usr_student')
    expect(result.task?.id).toBe(first.id)
  })
})
