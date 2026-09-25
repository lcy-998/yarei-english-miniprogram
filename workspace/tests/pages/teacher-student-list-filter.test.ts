import { describe, expect, it } from 'vitest'
import { filterStudentsByClass } from '../../miniprogram/pages/teacher/student-list/student-list-filter'
import { StudentListView } from '../../miniprogram/repositories/m1-app-repository'

const students: StudentListView[] = [
  { id: 'stu_1', displayName: '小宇', studentNumber: '0321', className: '三年级 2 班', status: 'active', statusLabel: '正常', completedCount: 1, totalCount: 2, completionPercent: 50 },
  { id: 'stu_2', displayName: '林可', studentNumber: '0418', className: '四年级 1 班', status: 'active', statusLabel: '正常', completedCount: 0, totalCount: 2, completionPercent: 0 },
]

describe('teacher student class filter', () => {
  it('uses the newly selected class immediately', () => {
    expect(filterStudentsByClass(students, '四年级 1 班').map(student => student.id)).toEqual(['stu_2'])
    expect(filterStudentsByClass(students, '三年级 2 班').map(student => student.id)).toEqual(['stu_1'])
    expect(filterStudentsByClass(students, '全部负责班级')).toHaveLength(2)
  })
})
