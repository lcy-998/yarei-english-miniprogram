import { AssignmentStatus, ReviewDecision, Task, TaskAssignment } from './types'

export const MAX_REDO_COUNT = 2
export const REDO_PERIOD_DAYS = 3

export function canSubmitAssignment(assignment: TaskAssignment, nowIso: string): boolean {
  if (assignment.status === 'redo_required') {
    return Boolean(assignment.redoDueAt && Date.parse(nowIso) <= Date.parse(assignment.redoDueAt))
  }
  return assignment.status === 'not_started' || assignment.status === 'in_progress' || assignment.status === 'overdue'
}

export function nextAssignmentStatusAfterSubmit(): AssignmentStatus {
  return 'awaiting_review'
}

export function canPublishReview(assignment: TaskAssignment, decision: ReviewDecision, reason?: string): boolean {
  if (assignment.status !== 'awaiting_review') return false
  if (decision === 'returned') return Boolean(reason && reason.trim())
  return true
}

export function hasReachedRedoLimit(assignment: TaskAssignment): boolean {
  return assignment.redoCount >= MAX_REDO_COUNT
}

export function getRedoDueAt(returnedAtIso: string): string {
  const dueAt = new Date(returnedAtIso)
  dueAt.setUTCDate(dueAt.getUTCDate() + REDO_PERIOD_DAYS)
  return dueAt.toISOString()
}

export function getTodayTask(tasks: Task[], assignments: TaskAssignment[], studentId: string): { task: Task | null; assignment: TaskAssignment | null } {
  const candidates = assignments
    .filter(item => item.studentId === studentId && item.status !== 'completed')
    .map(item => ({ assignment: item, task: tasks.find(task => task.id === item.taskId) }))
    .filter((item): item is { assignment: TaskAssignment; task: Task } => Boolean(item.task))
    .sort((a, b) => a.task.dueAt.localeCompare(b.task.dueAt))
  return candidates[0] ?? { task: null, assignment: null }
}
