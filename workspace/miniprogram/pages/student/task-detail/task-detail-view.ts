import type { Task, TaskAssignment, Submission, TaskDetailView } from '../../../domain/types'

export interface TaskWriteAvailability {
  editable: boolean
  reason: string
  timingLabel: string
}

/** Mirrors the server's start, late and redo windows for an authorized task detail. */
export function taskWriteAvailability(task: Task, assignment: TaskAssignment, nowIso: string,
  memoryMode = false): TaskWriteAvailability {
  const now = Date.parse(nowIso)
  const start = Date.parse(task.startsAt)
  const due = Date.parse(task.dueAt)
  if (task.status === 'withdrawn' || task.status === 'closed' || task.status === 'completed' || task.status === 'draft') {
    return { editable: false, reason: '任务已结束，当前只能查看记录', timingLabel: '' }
  }
  if (assignment.status === 'awaiting_review' || assignment.status === 'completed') {
    return { editable: false, reason: '本次已提交，可查看作答和教师反馈', timingLabel: '' }
  }
  if (!Number.isFinite(now) || !Number.isFinite(start) || !Number.isFinite(due)) {
    return { editable: false, reason: '任务时间暂不可核对，请刷新后重试', timingLabel: '' }
  }
  if (now < start) return { editable: false, reason: '任务尚未开始，请到开始时间再作答', timingLabel: '' }
  if (assignment.status === 'redo_required' || assignment.redoDueAt) {
    const redoDue = Date.parse(assignment.redoDueAt ?? '')
    if (!Number.isFinite(redoDue)) return { editable: false, reason: '重做期限暂不可核对，请联系老师', timingLabel: '' }
    if (now > redoDue) return { editable: false, reason: '重做期限已过，当前只能查看记录', timingLabel: '' }
    return { editable: true, reason: '', timingLabel: '退回重做' }
  }
  if (now <= due) return { editable: true, reason: '', timingLabel: '' }
  if (!task.latePolicy || !Number.isInteger(task.latePolicy.lateDays)) {
    // M0's in-memory service has no late policy and accepts overdue assignments.
    if (memoryMode) return { editable: true, reason: '', timingLabel: '演示任务逾期提交' }
    return { editable: false, reason: '补交规则暂不可核对，请刷新任务详情', timingLabel: '' }
  }
  if (!task.latePolicy.allowLate) return { editable: false, reason: '教师未开放补交，当前只能查看记录', timingLabel: '' }
  const lateEnd = due + task.latePolicy.lateDays * 24 * 60 * 60 * 1000
  if (now > lateEnd) return { editable: false, reason: '补交期限已过，当前只能查看记录', timingLabel: '' }
  return { editable: true, reason: '', timingLabel: `补交期内（截止后 ${task.latePolicy.lateDays} 天）` }
}

export interface SubmittedAnswerRow {
  itemId: string
  title: string
  question: string
  answer: string
  result: string
  recordingId?: string
}

/** Submitted snapshots are read from the authorized student's own history, never from a redo draft. */
export function studentSubmissionAtVersion(detail: TaskDetailView, version: number): Submission | undefined {
  const history = detail.submissionHistory?.find(item => item.version === version && item.answers)
  if (history?.answers) return { id: `history_${version}`, assignmentId: detail.assignment.id,
    studentId: detail.assignment.studentId, version, status: history.status,
    submittedAt: history.submittedAt, answers: history.answers.map(answer => ({ ...answer })) }
  const current = detail.submission
  return current?.status !== 'draft' && current?.version === version ? current : undefined
}

export function firstIncompleteTaskItemId(task: Task, inputs: readonly { itemId: string }[],
  byItem: Readonly<Record<string, { complete: boolean }>>): string | undefined {
  return task.items.find(item => inputs.some(input => input.itemId === item.id) && !byItem[item.id]?.complete)?.id
}

/** Uses only the student's own current submitted snapshot; no answer key is exposed. */
export function submittedAnswerRows(task: Task, submission?: Submission): SubmittedAnswerRow[] {
  if (!submission || submission.status === 'draft') return []
  const answers = new Map(submission.answers.map(answer => [answer.taskItemId, answer]))
  return task.items.map(item => {
    const value = answers.get(item.id)?.structuredValue
    if (item.type === 'exercise') {
      const response = value?.kind === 'exercise' && item.exerciseQuestion
        ? value.questionResponses?.find(entry => entry.questionId === item.exerciseQuestion?.questionId) : undefined
      const answer = response?.response === undefined ? '本版本未记录逐题答案'
        : Array.isArray(response.response) ? response.response.join('、') : response.response
      const result = response?.isCorrect === undefined ? '' : response.isCorrect ? '系统判定：正确' : '系统判定：需订正'
      return { itemId: item.id, title: item.title, question: item.exerciseQuestion?.stem ?? '', answer, result }
    }
    if (item.type === 'reading') return { itemId: item.id, title: item.title, question: '',
      answer: value?.kind === 'reading' ? `本次提交记录：${value.completedPageCount} 页` : '本版本未记录阅读页数', result: '' }
    if (item.type === 'vocabulary') return { itemId: item.id, title: item.title, question: '',
      answer: value?.kind === 'vocabulary' ? `本次提交记录：完成 ${value.completedWordCount} 词，首次正确 ${value.correctWordCount} 词` : '本版本未记录单词结果', result: '' }
    return { itemId: item.id, title: item.title, question: '',
      answer: value?.kind === 'recording' ? '本次已提交录音' : '本版本未记录录音', result: '',
      ...(value?.kind === 'recording' ? { recordingId: value.recordingId } : {}) }
  })
}
