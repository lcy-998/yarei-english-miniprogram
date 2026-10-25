import { describe, expect, it } from 'vitest'
import { createTeacherStudentErrorCsv, createTeacherStudentImportResultCsv, createTeacherStudentImportTemplate, decodeUtf8Strict, exportTeacherStudentsCsv, previewTeacherStudentCsv, projectTeacherStudentImportErrors } from '../../miniprogram/subpackages/teacher/shared/teacher-student-csv'
import type { TeacherStudentListItem } from '../../miniprogram/domain/types'

const bytes = (value: string): Uint8Array => Buffer.from(value, 'utf8')
const header = 'student_number,display_name,mobile,class_id\r\n'

describe('教师学员 CSV 本地预检', () => {
  it('仅返回行数与安全错误，不保留明文手机号或姓名', () => {
    const result = previewTeacherStudentCsv(bytes(`\uFEFF${header}S001,小宇,13800000001,class_a\r\nS002,林可,13800000002,class_b\r\n`), ['class_a'], ['S001'])
    expect(result).toMatchObject({ blocked: false, totalRowCount: 2, readyRowCount: 0, rejectedRowCount: 2 })
    expect(result.errors.map(item => item.code)).toContain('DUPLICATE_STUDENT_NUMBER')
    expect(result.errors.map(item => item.code)).toContain('CLASS_NOT_ALLOWED')
    expect(JSON.stringify(result)).not.toContain('13800000001')
    expect(JSON.stringify(result)).not.toContain('林可')
  })

  it('拒绝无效 UTF-8、引号错误与文件内重复，允许标准引号转义', () => {
    expect(decodeUtf8Strict(new Uint8Array([0xc0, 0xaf]))).toBeNull()
    expect(previewTeacherStudentCsv(new Uint8Array([0xc0, 0xaf]), ['class_a']).errors[0]?.code).toBe('INVALID_UTF8')
    expect(previewTeacherStudentCsv(bytes(`${header}"S001,小宇,13800000001,class_a`), ['class_a']).errors[0]).toMatchObject({ code: 'INVALID_CSV', lineNumber: 2 })
    const duplicate = previewTeacherStudentCsv(bytes(`${header}S001,"小""宇",13800000001,class_a\r\nS001,小宇,13800000001,class_a\r\n`), ['class_a'])
    expect(duplicate).toMatchObject({ blocked: false, readyRowCount: 0, rejectedRowCount: 2 })
    expect(duplicate.errors.filter(item => item.code === 'DUPLICATE_MOBILE')).toHaveLength(2)
  })

  it('导出完整规定列并处理电子表格公式注入', () => {
    const item: TeacherStudentListItem = {
      studentId: 'student_1', displayName: '=SUM(1,1)', studentNumber: 'S001', accountStatus: 'active', needsAttention: false,
      classInfo: { id: 'class_a', name: '三年级 2 班', grade: '三年级', term: '上学期' },
      performance: { assignedCount: 4, completedCount: 3, overdueCount: 1, redoCount: 0, completionRate: 75, averageScore: 86 },
    }
    const csv = exportTeacherStudentsCsv([item])
    expect(csv).toContain('student_number,display_name,class_id,class_name,account_status,assigned_count,completed_count,overdue_count,redo_count,completion_rate,average_score')
    expect(csv).toContain('"\'=SUM(1,1)"')
    expect(csv).not.toContain('mobile')
    expect(createTeacherStudentImportTemplate()).toContain(header)
    expect(createTeacherStudentErrorCsv([{ lineNumber: 2, field: 'mobile', code: 'INVALID_MOBILE', message: '手机号格式无效。' }])).not.toContain('13800000001')
  })

  it('正式导入结果可导出逐行错误，保留可读原因但不包含账号资料', () => {
    const errors = projectTeacherStudentImportErrors([
      { lineNumber: 2, status: 'created', studentId: 'private_student_id', classId: 'class_a' },
      { lineNumber: 3, status: 'rejected', code: 'DUPLICATE_MOBILE' },
      { lineNumber: 4, status: 'failed', code: 'BUSINESS_COMMIT_FAILED' },
    ], [{ lineNumber: 4, field: 'display_name', code: 'REQUIRED_FIELD', message: '该字段为必填项。' }])
    expect(errors).toEqual([
      { lineNumber: 3, field: 'row', code: 'DUPLICATE_MOBILE', message: '手机号已绑定其他账号。' },
      { lineNumber: 4, field: 'display_name', code: 'REQUIRED_FIELD', message: '该字段为必填项。' },
    ])
    const csv = createTeacherStudentImportResultCsv([
      { lineNumber: 2, status: 'created', studentId: 'private_student_id', classId: 'class_a' },
      { lineNumber: 3, status: 'rejected', code: 'DUPLICATE_MOBILE' },
    ], [])
    expect(csv).toContain('"3","row","DUPLICATE_MOBILE","手机号已绑定其他账号。"')
    expect(csv).not.toContain('private_student_id')
  })
})
