import { describe, expect, it } from 'vitest'
import { ClassTarget, StudentTarget, eligibleTargetClasses, filterTargetStudents, initialPublishTarget, publishTargetSummary, selectedPublishTarget, targetCapacityError } from '../../miniprogram/pages/teacher/publish-task/publish-target'
import { setTeacherTaskTargetStudentId, takeTeacherTaskTargetStudentId } from '../../miniprogram/session/session'

const classes: ClassTarget[] = [
  { id: 'class_3', name: '三年级 2 班', grade: '三年级', term: '上学期', selected: true },
  { id: 'class_4', name: '四年级 1 班', grade: '四年级', term: '上学期', selected: false },
]
const students: StudentTarget[] = [
  { studentId: 'stu_1', displayName: '小宇', studentNumber: '0321', accountStatus: 'active', needsAttention: false, classInfo: classes[0], performance: { assignedCount: 0, completedCount: 0, overdueCount: 0, redoCount: 0, completionRate: 0, averageScore: null }, selected: false },
  { studentId: 'stu_2', displayName: '林可', studentNumber: '0418', accountStatus: 'active', needsAttention: false, classInfo: classes[1], performance: { assignedCount: 0, completedCount: 0, overdueCount: 0, redoCount: 0, completionRate: 0, averageScore: null }, selected: true },
]

describe('publish task target', () => {
  it('requires an explicit target for a new task and preserves an existing task target', () => {
    const previous = { type: 'classes' as const, classIds: ['class_3'] }
    expect(initialPublishTarget(previous, false, '')).toEqual({ type: 'classes', classIds: [] })
    expect(initialPublishTarget(previous, true, '')).toEqual(previous)
  })

  it('passes a student-detail recipient once and preselects that student alone', () => {
    setTeacherTaskTargetStudentId('stu_2')
    expect(takeTeacherTaskTargetStudentId()).toBe('stu_2')
    expect(takeTeacherTaskTargetStudentId()).toBe('')
    expect(initialPublishTarget({ type: 'classes', classIds: ['class_3'] }, false, 'stu_2')).toEqual({ type: 'students', studentIds: ['stu_2'] })
  })
  it('allows up to 500 students and blocks a larger selection', () => {
    expect(targetCapacityError(36)).toBeNull()
    expect(targetCapacityError(50)).toBeNull()
    expect(targetCapacityError(68)).toBeNull()
    expect(targetCapacityError(500)).toBeNull()
    expect(targetCapacityError(501)).toContain('最多布置给 500 名学员')
  })
  it('keeps class and student targets separate', () => {
    expect(selectedPublishTarget('classes', classes, students)).toEqual({ type: 'classes', classIds: ['class_3'] })
    expect(selectedPublishTarget('students', classes, students)).toEqual({ type: 'students', studentIds: ['stu_2'] })
    expect(publishTargetSummary('classes', classes, students)).toEqual({ label: '三年级 2 班（1 人）', count: 1 })
    expect(publishTargetSummary('students', classes, students)).toEqual({ label: '林可（1 人）', count: 1 })
  })

  it('finds authorized students by name, number, or class', () => {
    expect(filterTargetStudents(students, '0418').map(item => item.studentId)).toEqual(['stu_2'])
    expect(filterTargetStudents(students, '三年级').map(item => item.studentId)).toEqual(['stu_1'])
  })

  it('only offers classes licensed for every selected task resource', () => {
    expect(eligibleTargetClasses(classes, [
      { allowedClassIds: ['class_3', 'class_4'] },
      { allowedClassIds: ['class_3'] },
    ], classes).map(item => item.id)).toEqual(['class_3'])
  })
})
