import { ReviewAssignmentView } from '../../../services/app-service'

export type CompletionFilter = 'all' | 'completed' | 'incomplete' | 'awaiting_review' | 'reviewed' | 'redo_required'

export const DEFAULT_COMPLETION_FILTER: CompletionFilter = 'all'

export interface SelectableCompletionRow extends ReviewAssignmentView {
  selected: boolean
}

export function isCompletedSubmission(row: ReviewAssignmentView): boolean {
  return row.status === 'awaiting_review' || row.status === 'completed'
}

export function isBatchReviewable(row: ReviewAssignmentView): boolean {
  return row.status === 'awaiting_review' && !!row.submissionId && row.submissionVersion !== undefined
}

export function filterCompletionRows<T extends SelectableCompletionRow>(rows: readonly T[], filter: CompletionFilter, keyword: string): T[] {
  const search = keyword.trim().toLowerCase()
  return rows.filter(row => {
    if (search && !`${row.studentName}${row.studentNumber ?? ''}`.toLowerCase().includes(search)) return false
    if (filter === 'all') return true
    if (filter === 'completed') return isCompletedSubmission(row)
    if (filter === 'incomplete') return !isCompletedSubmission(row)
    if (filter === 'reviewed') return row.status === 'completed'
    return row.status === filter
  })
}

export function toggleCompletionSelection<T extends SelectableCompletionRow>(rows: readonly T[], assignmentId: string): T[] {
  return rows.map(row => row.assignmentId === assignmentId ? { ...row, selected: !row.selected } : row)
}
