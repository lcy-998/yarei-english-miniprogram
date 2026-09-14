import { AssignmentStatus } from '../domain/types'

export interface DashboardAssignment {
  status: AssignmentStatus
  progressPercent?: number
}

export interface DashboardSummary {
  completedCount: number
  pendingCount: number
  pendingReviewCount: number
  overdueCount: number
  completionRate: number
}

export function summarizeAssignments(assignments: readonly DashboardAssignment[]): DashboardSummary {
  const completedCount = assignments.filter((item) => item.status === 'awaiting_review' || item.status === 'completed').length
  const pendingReviewCount = assignments.filter((item) => item.status === 'awaiting_review').length
  const overdueCount = assignments.filter((item) => item.status === 'overdue').length
  const progressTotal = assignments.reduce((total, item) => total + (item.progressPercent ?? (item.status === 'awaiting_review' || item.status === 'completed' ? 100 : 0)), 0)
  return {
    completedCount,
    pendingCount: assignments.length - completedCount,
    pendingReviewCount,
    overdueCount,
    completionRate: assignments.length ? Math.round(progressTotal / assignments.length) : 0,
  }
}
