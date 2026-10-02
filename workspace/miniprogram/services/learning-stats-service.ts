import type { AppState, ServiceResult } from '../domain/types'
import type { StatsExport, StatsFilters, StatsTaskDetail, StatsView } from '../domain/learning-stats'
import { getState } from '../repositories/memory/mock-state'
import { getCloudAppService } from '../repositories/repository-factory'

const error = <T>(code: 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION_ERROR', message: string): ServiceResult<T> =>
  ({ ok: false, error: { code, message, retryable: false } })

export async function getTeacherStats(userId: string, filters: StatsFilters): Promise<ServiceResult<StatsView>> {
  const cloud = getCloudAppService()
  if (cloud) return cloud.getTeacherStats(userId, filters)
  if (!validFilters(filters)) return error('VALIDATION_ERROR', '请选择有效的统计日期')
  const state = getState()
  const teacher = state.users.find(item => item.id === userId && item.role === 'teacher')
  if (!teacher?.classId) return error('FORBIDDEN', '仅授权教师可查看统计')
  if (filters.classId && filters.classId !== teacher.classId) return error('FORBIDDEN', '无权查看该班级')
  const classes = [{ id: teacher.classId, name: teacher.className ?? '三年级 2 班' }]
  const students = state.users.filter(item => item.role === 'student' && item.classId === teacher.classId)
    .map(item => ({ id: item.id, name: item.displayName, classId: teacher.classId! }))
  if (filters.studentId && !students.some(item => item.id === filters.studentId)) return error('NOT_FOUND', '学员不在授权范围')
  const selected = filters.studentId ? students.filter(item => item.id === filters.studentId) : students
  const details = memoryDetails(state, filters, classes, selected)
  return { ok: true, data: view(filters, classes, students, details, true) }
}

export async function getParentStats(userId: string, childId: string, filters: StatsFilters): Promise<ServiceResult<StatsView>> {
  const cloud = getCloudAppService()
  if (cloud) return cloud.getParentStats(userId, childId, filters)
  if (!validFilters(filters)) return error('VALIDATION_ERROR', '请选择有效的统计日期')
  const state = getState()
  const parent = state.users.find(item => item.id === userId && item.role === 'parent')
  const linked = state.parentStudentLinks.some(item => item.parentId === userId && item.studentId === childId && item.status === 'active')
  const child = state.users.find(item => item.id === childId && item.role === 'student')
  if (!parent || !linked || !child?.classId) return error('NOT_FOUND', '孩子不存在或无权查看')
  const classes = [{ id: child.classId, name: child.className ?? '三年级 2 班' }]
  const students = [{ id: child.id, name: child.displayName, classId: child.classId }]
  const details = memoryDetails(state, filters, classes, students)
  return { ok: true, data: view(filters, classes, students, details, false) }
}

export async function exportTeacherStats(userId: string, filters: StatsFilters): Promise<ServiceResult<StatsExport>> {
  const cloud = getCloudAppService()
  if (cloud) return cloud.exportTeacherStats(userId, filters)
  const result = await getTeacherStats(userId, filters)
  if (!result.ok) return result
  const summary = result.data.summary
  const rows = [['统计截止日期', `${filters.startsOn} 至 ${filters.endsOn}`],
    ['任务完成率', summary.completionRate === null ? '' : `${summary.completionRate}%`],
    ['已完成任务', String(summary.completedCount)], ['应完成任务', String(summary.assignedCount)],
    ['逾期任务', String(summary.overdueCount)], ['任务提交次数', String(summary.taskSubmissionCount)],
    ['已记录平均成绩', summary.averageScore === null ? '' : String(summary.averageScore)], [],
    ['截止日期', '班级', '学员', '任务', '状态', '提交时间', '逾期', '提交次数', '成绩'],
    ...result.data.details.map(item => [item.dueOn, item.className, item.studentName, item.taskTitle,
      item.status, item.submittedAt ?? '', item.isLate ? '是' : '否', String(item.submissionCount),
      item.score === null ? '' : String(item.score)])]
  return { ok: true, data: { fileName: `雅睿英语-学员统计-${filters.startsOn}-${filters.endsOn}.csv`,
    csv: '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n' } }
}

function memoryDetails(state: AppState, filters: StatsFilters, classes: StatsView['classes'],
  students: StatsView['students']): StatsTaskDetail[] {
  const classById = new Map(classes.map(item => [item.id, item.name]))
  const studentById = new Map(students.map(item => [item.id, item.name]))
  return state.assignments.flatMap(assignment => {
    const task = state.tasks.find(item => item.id === assignment.taskId && item.status !== 'draft' && item.status !== 'withdrawn')
    const className = classById.get(assignment.classId)
    const studentName = studentById.get(assignment.studentId)
    if (!task || !className || !studentName) return []
    const dueOn = localDate(task.dueAt)
    if (dueOn < filters.startsOn || dueOn > filters.endsOn) return []
    const history = state.submissions.filter(item => item.assignmentId === assignment.id && !!item.submittedAt)
    const latest = [...history].sort((left, right) => right.version - left.version)[0]
    const feedback = latest ? state.feedback.find(item => item.submissionId === latest.id) : undefined
    return [{ taskId: task.id, taskTitle: task.title, studentId: assignment.studentId,
      studentName, classId: assignment.classId, className, dueOn, status: assignment.status,
      submittedAt: latest?.submittedAt ?? null, isLate: assignment.status === 'overdue',
      submissionCount: history.length, score: feedback?.score ?? latest?.automaticScore ?? null }]
  }).sort((left, right) => right.dueOn.localeCompare(left.dueOn) || left.studentName.localeCompare(right.studentName, 'zh-CN'))
}

function view(filters: StatsFilters, classes: StatsView['classes'], students: StatsView['students'],
  details: StatsTaskDetail[], canExport: boolean): StatsView {
  const completedCount = details.filter(item => item.status === 'completed' || item.status === 'awaiting_review').length
  const scores = details.map(item => item.score).filter((item): item is number => item !== null)
  return { filters, periodBasis: 'taskDueDate', classes, students, details, canExport,
    summary: { assignedCount: details.length, completedCount,
      completionRate: details.length ? Math.round(completedCount * 100 / details.length) : null,
      overdueCount: details.filter(item => item.isLate || item.status === 'overdue').length,
      taskSubmissionCount: details.reduce((total, item) => total + item.submissionCount, 0),
      averageScore: scores.length ? Math.round(scores.reduce((total, score) => total + score, 0) / scores.length) : null,
      learningMinutes: null, practiceAccuracy: null, dubbingCount: null, shadowingCount: null } }
}

function validFilters(filters: StatsFilters): boolean {
  const start = Date.parse(`${filters.startsOn}T00:00:00Z`)
  const end = Date.parse(`${filters.endsOn}T00:00:00Z`)
  return /^\d{4}-\d{2}-\d{2}$/.test(filters.startsOn) && /^\d{4}-\d{2}-\d{2}$/.test(filters.endsOn)
    && Number.isFinite(start) && Number.isFinite(end) && start <= end && end - start <= 366 * 86400000
    && new Date(start).toISOString().slice(0, 10) === filters.startsOn
    && new Date(end).toISOString().slice(0, 10) === filters.endsOn
}

function localDate(value: string): string {
  const date = new Date(value)
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

function csvCell(value: string): string {
  const safe = /^[=+@\-\t\r]/.test(value) ? `'${value}` : value
  return `"${safe.replace(/"/g, '""')}"`
}
