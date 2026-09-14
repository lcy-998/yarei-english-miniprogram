import { AssignmentStatus, ReviewDecision, Task, TaskAssignment } from './types'

export function canSubmitAssignment(assignment: TaskAssignment): boolean {
  return assignment.status === 'not_started' || assignment.status === 'in_progress' || assignment.status === 'redo_required' || assignment.status === 'overdue'
}

export function nextAssignmentStatusAfterSubmit(): AssignmentStatus {
  return 'awaiting_review'
}

export function canPublishReview(assignment: TaskAssignment, decision: ReviewDecision, reason?: string): boolean {
  if (assignment.status !== 'awaiting_review') return false
  if (decision === 'returned') return Boolean(reason && reason.trim())
  return true
}

export function getTodayTask(tasks: Task[], assignments: TaskAssignment[], studentId: string): { task: Task | null; assignment: TaskAssignment | null } {
  const candidates = assignments
    .filter(item => item.studentId === studentId && item.status !== 'completed')
    .map(item => ({ assignment: item, task: tasks.find(task => task.id === item.taskId) }))
    .filter((item): item is { assignment: TaskAssignment; task: Task } => Boolean(item.task))
    .sort((a, b) => a.task.dueAt.localeCompare(b.task.dueAt))
  return candidates[0] ?? { task: null, assignment: null }
}
