import { AssignmentStatus, ReviewDecision, Task, TaskAssignment } from './types'

export const MAX_REDO_COUNT = 2
export const REDO_PERIOD_DAYS = 3

export function canSubmitAssignment(assignment: TaskAssignment, nowIso: string): boolean {
  if (assignment.status === 'awaiting_review' || assignment.status === 'completed') return false
  if (assignment.status === 'redo_required' || (assignment.status === 'in_progress' && assignment.redoDueAt)) {
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

export function localTaskDate(iso: string): string {
  return new Date(Date.parse(iso) + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

export function getTodayAssignments(tasks: Task[], assignments: TaskAssignment[], studentId: string, localDate: string): Array<{ task: Task; assignment: TaskAssignment }> {
  const taskById = new Map(tasks.map(task => [task.id, task]))
  return assignments
    .filter(item => item.studentId === studentId)
    .flatMap(item => {
      const task = taskById.get(item.taskId)
      if (!task || task.status === 'draft' || task.status === 'withdrawn') return []
      const urgent = item.status === 'overdue' || item.status === 'redo_required'
        || (item.status !== 'completed' && item.status !== 'awaiting_review' && Boolean(item.redoDueAt))
      return urgent || localTaskDate(task.startsAt) === localDate || localTaskDate(task.dueAt) === localDate ? [{ task, assignment: item }] : []
    })
    .sort((a, b) => {
      const priority = (item: TaskAssignment) => item.status === 'redo_required' ? 0 : item.status === 'overdue' ? 1 : 2
      return priority(a.assignment) - priority(b.assignment) || a.task.dueAt.localeCompare(b.task.dueAt)
    })
}

export function getTodayTask(tasks: Task[], assignments: TaskAssignment[], studentId: string, localDate: string): { task: Task | null; assignment: TaskAssignment | null } {
  const candidate = getTodayAssignments(tasks, assignments, studentId, localDate)
    .find(item => item.assignment.status !== 'completed' && item.assignment.status !== 'awaiting_review')
  return candidate ?? { task: null, assignment: null }
}
