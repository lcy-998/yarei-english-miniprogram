import { Task } from '../../../domain/types'
import { ReviewAssignmentView } from '../../../services/app-service'

export interface ReviewTaskOption {
  id: string
  title: string
  pendingCount: number
}

export function reviewTaskOptions(tasks: readonly Pick<Task, 'id' | 'title' | 'status'>[], pendingByTask: Readonly<Record<string, number>>): ReviewTaskOption[] {
  const published = tasks.filter(task => typeof task.id === 'string' && task.id.trim() !== ''
    && task.status !== 'draft' && task.status !== 'withdrawn')
    .map(task => ({ id: task.id, title: task.title, pendingCount: pendingByTask[task.id] ?? 0 }))
  return [...published.filter(task => task.pendingCount > 0), ...published.filter(task => task.pendingCount === 0)]
}

export function selectedReviewTaskId(options: readonly ReviewTaskOption[], requestedTaskId: string): string {
  return options.some(option => option.id === requestedTaskId) ? requestedTaskId : options[0]?.id ?? ''
}

export function currentReviewTaskFirst(options: readonly ReviewTaskOption[], selectedTaskId: string): ReviewTaskOption[] {
  const current = options.find(option => option.id === selectedTaskId)
  return current ? [current, ...options.filter(option => option.id !== selectedTaskId)] : [...options]
}

export interface ReviewScoreInput {
  input: string
  score: number | null
  error: string
}

export function parseReviewScoreInput(raw: string): ReviewScoreInput {
  const input = raw.trim()
  if (!input) return { input: '', score: null, error: '' }
  const score = Number(input)
  if (!/^\d{1,3}$/.test(input) || !Number.isSafeInteger(score) || score > 100) {
    return { input, score: null, error: '请输入 0 到 100 的整数分数' }
  }
  return { input, score, error: '' }
}

export function updateManualScoreDraft<T extends { id: string; input: string; score: number | null; error: string }>(
  rows: readonly T[], itemId: string, input: string): T[] {
  const parsed = parseReviewScoreInput(input)
  return rows.map(row => row.id === itemId ? { ...row, ...parsed } : row)
}

export interface ReviewScoringItem {
  itemId: string; weightPercent: number; automaticScore: number | null;
  teacherScoreRequired: boolean; complete: boolean
}

export function previewWeightedReviewScore(items: readonly ReviewScoringItem[],
  manualScores: readonly { id: string; score: number | null }[]): number | null {
  if (!items.length || new Set(items.map(item => item.itemId)).size !== items.length
    || Math.abs(items.reduce((sum, item) => sum + item.weightPercent, 0) - 100) > 0.000001) return null
  const scores = new Map(manualScores.map(item => [item.id, item.score]))
  if (manualScores.length !== items.filter(item => item.teacherScoreRequired).length) return null
  let total = 0
  for (const item of items) {
    const score = item.teacherScoreRequired ? scores.get(item.itemId) : item.automaticScore
    if (!item.complete || !Number.isFinite(item.weightPercent) || item.weightPercent <= 0
      || typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 100) return null
    total += score * item.weightPercent / 100
  }
  return Math.round(total)
}

export function reviewScoreForConfirmation(manualScores: readonly { id: string; score: number | null }[],
  scoringItems: readonly ReviewScoringItem[], teacherScore: number | null, automaticScore: number | null): number | null {
  return manualScores.length ? previewWeightedReviewScore(scoringItems, manualScores)
    : teacherScore ?? automaticScore
}

export function reviewEvidenceReady(state: { submissionLoading: boolean; taskItemsLoading: boolean;
  submissionError: string; taskItemsError: string; selectedSubmissionId: string },
  currentSubmissionId: string | undefined): boolean {
  return Boolean(currentSubmissionId) && !state.submissionLoading && !state.taskItemsLoading
    && !state.submissionError && !state.taskItemsError && state.selectedSubmissionId === currentSubmissionId
}

export function selectReviewRows(rows: readonly ReviewAssignmentView[], requestedAssignmentId: string): { rows: ReviewAssignmentView[]; activeIndex: number; readOnlyMode: boolean } {
  const pending = rows.filter(item => item.status === 'awaiting_review' && !!item.submissionId && item.submissionVersion !== undefined)
  const requested = rows.find(item => item.assignmentId === requestedAssignmentId && !!item.submissionId)
  const selectedRows = requested && requested.status !== 'awaiting_review' ? [requested] : pending
  const requestedIndex = selectedRows.findIndex(item => item.assignmentId === requestedAssignmentId)
  const activeIndex = requestedIndex >= 0 ? requestedIndex : 0
  return { rows: selectedRows, activeIndex, readOnlyMode: Boolean(selectedRows[activeIndex] && selectedRows[activeIndex].status !== 'awaiting_review') }
}

export function reviewQueueOverview(rows: readonly ReviewAssignmentView[]): {
  assignedCount: number; pendingCount: number; reviewedCount: number; withoutPendingCount: number
} {
  const pendingCount = rows.filter(item => item.status === 'awaiting_review'
    && !!item.submissionId && item.submissionVersion !== undefined).length
  const reviewedCount = rows.filter(item => item.status === 'completed' && !!item.submissionId).length
  return { assignedCount: rows.length, pendingCount, reviewedCount,
    withoutPendingCount: rows.length - pendingCount - reviewedCount }
}

export function reviewClassOptions(rows: readonly ReviewAssignmentView[]): Array<{ id: string; label: string; count: number }> {
  const classes = new Map<string, string>()
  for (const row of rows) {
    const id = row.classId ?? row.className
    if (id) classes.set(id, row.className ?? id)
  }
  return [{ id: 'all', label: '全部班级', count: rows.length }, ...[...classes].map(([id, label]) => ({ id, label, count: rows.filter(item => (item.classId ?? item.className) === id).length }))]
}

export function filterReviewRowsByClass(rows: readonly ReviewAssignmentView[], classId: string): ReviewAssignmentView[] {
  return classId === 'all' ? [...rows] : rows.filter(item => (item.classId ?? item.className) === classId)
}
