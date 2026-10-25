import { AssignmentStatus } from '../domain/types'

export function assignmentStatusLabel(status: AssignmentStatus, awaitingLabel = '待检查'): string {
  if (status === 'not_started') return '未开始'
  if (status === 'in_progress') return '进行中'
  if (status === 'awaiting_review') return awaitingLabel
  if (status === 'completed') return '已完成'
  if (status === 'redo_required') return '退回重做'
  return '已过期'
}
