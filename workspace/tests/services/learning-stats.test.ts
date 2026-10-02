import { describe, expect, it } from 'vitest'
import { initialState, replaceState } from '../../miniprogram/repositories/memory/mock-state'
import { exportTeacherStats, getParentStats, getTeacherStats } from '../../miniprogram/services/learning-stats-service'

const today = new Date()
const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
const filters = { startsOn: date, endsOn: date }

describe('M2 基础统计内存回退', () => {
  it('教师卡片与明细相符，未记录的来源保持空值，CSV 只含当前筛选', async () => {
    replaceState(initialState)
    const report = await getTeacherStats('usr_teacher_lin', { ...filters, studentId: 'usr_student_xiaoyu' })
    expect(report).toMatchObject({ ok: true, data: { summary: { assignedCount: 1,
      learningMinutes: null, practiceAccuracy: null, dubbingCount: null, shadowingCount: null } } })
    if (!report.ok) throw new Error('expected report')
    expect(report.data.details).toHaveLength(report.data.summary.assignedCount)
    const csv = await exportTeacherStats('usr_teacher_lin', { ...filters, studentId: 'usr_student_xiaoyu' })
    expect(csv).toMatchObject({ ok: true, data: { csv: expect.stringContaining('小宇') } })
    if (!csv.ok) throw new Error('expected CSV')
    expect(csv.data.csv).not.toContain('演示学生02')
  })

  it('教师跨班和家长跨孩子不可读取，解除绑定后报告不可访问', async () => {
    replaceState(initialState)
    expect(await getTeacherStats('usr_teacher_lin', { ...filters, classId: 'class_other' }))
      .toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })
    expect(await getParentStats('usr_parent_xiaoyu', 'usr_student_xiaoyu', filters))
      .toMatchObject({ ok: true, data: { canExport: false } })
    expect(await getParentStats('usr_parent_xiaoyu', 'usr_student_demo_02', filters))
      .toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
    replaceState({ ...initialState, parentStudentLinks: [] })
    expect(await getParentStats('usr_parent_xiaoyu', 'usr_student_xiaoyu', filters))
      .toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
    replaceState(initialState)
  })
})
