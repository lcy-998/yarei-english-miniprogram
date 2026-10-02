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

export function selectedBatchCounts(rows: readonly SelectableCompletionRow[]): Readonly<{ selected: number; candidates: number; excluded: number }> {
  const selected = rows.filter(row => row.selected)
  const candidates = selected.filter(isBatchReviewable).length
  return { selected: selected.length, candidates, excluded: selected.length - candidates }
}

export function scoreCaption(row: ReviewAssignmentView): string {
  if (row.score === undefined) return '暂无分数'
  return row.status === 'awaiting_review' ? '系统参考分' : '列表参考分'
}

export function requiresIndividualReview(detail: { taskItems?: readonly { type: string }[];
  exerciseEvidence?: readonly { questionType: string }[] }): boolean {
  if (!detail.taskItems?.length) return true
  return detail.taskItems.some(item => item.type === 'recording'
    || item.type === 'exercise' && !detail.exerciseEvidence?.length)
    || Boolean(detail.exerciseEvidence?.some(item => item.questionType === 'subjective'))
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
