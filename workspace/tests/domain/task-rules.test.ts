import { describe, expect, it } from 'vitest'
import { canPublishReview, canSubmitAssignment, getRedoDueAt, getTodayAssignments, getTodayTask, hasReachedRedoLimit, nextAssignmentStatusAfterSubmit } from '../../miniprogram/domain/task-rules'
import { Task, TaskAssignment } from '../../miniprogram/domain/types'

const assignment = (status: TaskAssignment['status']): TaskAssignment => ({ id: 'asn_demo', taskId: 'tsk_demo', studentId: 'usr_student', classId: 'cls_demo', status, progressPercent: 0, redoCount: 0 })
const task = (id: string, dueAt: string): Task => ({ id, title: id, deliveryType: 'classroom', status: 'active', creatorTeacherId: 'usr_teacher', classId: 'cls_demo', startsAt: '2026-09-11T08:00:00+08:00', dueAt, description: '', items: [], version: 1 })

describe('M0 task rules', () => {
  it('allows submission only while an assignment is actionable', () => {
    const now = '2026-09-14T08:00:00.000Z'
    expect(canSubmitAssignment(assignment('not_started'), now)).toBe(true)
    expect(canSubmitAssignment(assignment('in_progress'), now)).toBe(true)
    expect(canSubmitAssignment({ ...assignment('redo_required'), redoDueAt: '2026-09-17T08:00:00.000Z' }, now)).toBe(true)
    expect(canSubmitAssignment(assignment('awaiting_review'), now)).toBe(false)
    expect(nextAssignmentStatusAfterSubmit()).toBe('awaiting_review')
  })

  it('calculates and enforces the fixed three-day redo period', () => {
    const redoDueAt = getRedoDueAt('2026-09-14T08:30:00.000Z')
    const redoAssignment = { ...assignment('redo_required'), redoDueAt }
    expect(redoDueAt).toBe('2026-09-17T08:30:00.000Z')
    expect(canSubmitAssignment(redoAssignment, redoDueAt)).toBe(true)
    expect(canSubmitAssignment(redoAssignment, '2026-09-17T08:30:00.001Z')).toBe(false)
    expect(canSubmitAssignment({ ...redoAssignment, status: 'in_progress' }, redoDueAt)).toBe(true)
    expect(canSubmitAssignment({ ...redoAssignment, status: 'in_progress' }, '2026-09-17T08:30:00.001Z')).toBe(false)
  })

  it('recognizes the two-return limit', () => {
    expect(hasReachedRedoLimit({ ...assignment('awaiting_review'), redoCount: 1 })).toBe(false)
    expect(hasReachedRedoLimit({ ...assignment('awaiting_review'), redoCount: 2 })).toBe(true)
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
    const result = getTodayTask([second, first], [{ ...assignment('in_progress'), taskId: first.id }, { ...assignment('completed'), id: 'asn_done', taskId: second.id }], 'usr_student', '2026-09-11')
    expect(result.task?.id).toBe(first.id)
  })

  it('does not count an old pending task as a today task, while keeping overdue and redo visible', () => {
    const old = task('tsk_old', '2026-09-11T20:00:00+08:00')
    const today = task('tsk_today', '2026-09-24T20:00:00+08:00')
    const assignments = [{ ...assignment('in_progress'), taskId: old.id }, { ...assignment('completed'), id: 'asn_today', taskId: today.id }]
    expect(getTodayAssignments([old, today], assignments, 'usr_student', '2026-09-24').map(item => item.task.id)).toEqual([today.id])
    expect(getTodayTask([old, today], assignments, 'usr_student', '2026-09-24').task).toBeNull()
    expect(getTodayTask([old, today], [{ ...assignment('overdue'), taskId: old.id }], 'usr_student', '2026-09-24').task?.id).toBe(old.id)
  })
})
