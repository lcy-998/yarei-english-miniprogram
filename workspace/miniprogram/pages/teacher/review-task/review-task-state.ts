import { Task } from '../../../domain/types'
import { ReviewAssignmentView } from '../../../services/app-service'

export interface ReviewTaskOption {
  id: string
  title: string
  pendingCount: number
}

export function reviewTaskOptions(tasks: readonly Pick<Task, 'id' | 'title' | 'status'>[], pendingByTask: Readonly<Record<string, number>>): ReviewTaskOption[] {
  const published = tasks.filter(task => task.status !== 'draft' && task.status !== 'withdrawn')
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

export function selectReviewRows(rows: readonly ReviewAssignmentView[], requestedAssignmentId: string): { rows: ReviewAssignmentView[]; activeIndex: number; readOnlyMode: boolean } {
  const pending = rows.filter(item => item.status === 'awaiting_review' && !!item.submissionId && item.submissionVersion !== undefined)
  const requested = rows.find(item => item.assignmentId === requestedAssignmentId && !!item.submissionId)
  const selectedRows = requested && requested.status !== 'awaiting_review' ? [requested] : pending
  const requestedIndex = selectedRows.findIndex(item => item.assignmentId === requestedAssignmentId)
  const activeIndex = requestedIndex >= 0 ? requestedIndex : 0
  return { rows: selectedRows, activeIndex, readOnlyMode: Boolean(selectedRows[activeIndex] && selectedRows[activeIndex].status !== 'awaiting_review') }
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
