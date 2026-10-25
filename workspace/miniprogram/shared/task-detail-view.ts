import type { Task, TaskAssignment, Submission, TaskDetailView } from '../domain/types'

export type TaskItemProgressTone = 'complete' | 'in-progress' | 'pending' | 'review' | 'unavailable'

export function mediaTaskProgressFraction(playbackFraction: number, answerFraction: number,
  hasRequiredAnswer: boolean, complete: boolean): number {
  if (complete) return 1
  const playback = Math.max(0, Math.min(1, playbackFraction))
  if (!hasRequiredAnswer) return playback
  const answer = Math.max(0, Math.min(1, answerFraction))
  return (playback + answer) / 2
}

export function taskItemStatusLabel(rawLabel: string, complete: boolean):
  { label: string; tone: TaskItemProgressTone } {
  if (complete) return { label: '已完成', tone: 'complete' }
  if (/不可用|缺失|异常|失败/.test(rawLabel)) return { label: '资源异常', tone: 'unavailable' }
  if (/待服务端核对|答案待核对|待检查|待点评|待核对/.test(rawLabel)) {
    return { label: '待核对', tone: 'review' }
  }
  if (/待作答/.test(rawLabel)) return { label: '待作答', tone: 'in-progress' }
  if (/作答中/.test(rawLabel)) return { label: '作答中', tone: 'in-progress' }
  if (/^已(?:听|播放) 0%$/.test(rawLabel)) return { label: '未开始', tone: 'pending' }
  if (/已播放 0% · 待录制/.test(rawLabel)) return { label: '未开始', tone: 'pending' }
  if (/待录制/.test(rawLabel) && !/已播放 0%/.test(rawLabel)) {
    return { label: '待录制', tone: 'in-progress' }
  }
  if (/已听|已播放|已作答|配音已封存|[1-9]\d*\/\d+|[1-9]\d*%/.test(rawLabel)) {
    return { label: '进行中', tone: 'in-progress' }
  }
  return { label: '未开始', tone: 'pending' }
}

export interface TaskWriteAvailability {
  editable: boolean
  reason: string
  timingLabel: string
}

const OPEN_STUDENT_TASK_TYPES = new Set(['reading', 'vocabulary', 'exercise', 'recording'])
const MEDIA_TASK_TYPES = new Set(['listening', 'video', 'dubbing'])

export function hasUnreleasedMediaItem(task: Readonly<{ items: readonly Readonly<{
  type: string; mediaSnapshot?: Task['items'][number]['mediaSnapshot']
}>[] }>, cloudMediaEnabled = false): boolean {
  return task.items.some(item => {
    if (OPEN_STUDENT_TASK_TYPES.has(item.type)) return false
    const snapshot = item.mediaSnapshot
    return !cloudMediaEnabled || !MEDIA_TASK_TYPES.has(item.type) || !snapshot
      || snapshot.kind !== item.type || snapshot.continuousPlaybackEnforced !== true
      || !snapshot.mediaId || !Number.isSafeInteger(snapshot.mediaVersion)
      || snapshot.mediaVersion < 1 || !Number.isSafeInteger(snapshot.durationMs)
      || snapshot.durationMs < 1
  })
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
  mediaKind?: 'listening' | 'video' | 'dubbing'
  mediaResponses?: Array<{ questionId: string; stem: string; answer: string }>
}

function submittedMediaResponses(item: Task['items'][number], value: Submission['answers'][number]['structuredValue']):
  SubmittedAnswerRow['mediaResponses'] {
  if (!value || (value.kind !== 'listening' && value.kind !== 'video')) return undefined
  const responses = value.questionResponses ?? []
  return item.mediaSnapshot?.questions.map(question => {
    const original = responses.find(response => response.questionId === question.questionId)?.response
    return { questionId: question.questionId, stem: question.stem,
      answer: original === undefined ? '本版本未记录答案'
        : Array.isArray(original) ? original.join('、') : original }
  })
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
    if (item.type === 'listening') return { itemId: item.id, title: item.title, question: '',
      answer: value?.kind === 'listening'
        ? `本次已提交 ${value.questionResponses.length} 道听力题；播放证据由服务端核对`
        : '本版本未记录听力题与播放证据', result: '',
      mediaResponses: submittedMediaResponses(item, value),
      ...(value?.kind === 'listening' ? { mediaKind: 'listening' as const } : {}) }
    if (item.type === 'video') return { itemId: item.id, title: item.title, question: '',
      answer: value?.kind === 'video'
        ? `本次已提交视频学习${value.questionResponses?.length ? `及 ${value.questionResponses.length} 道配套题` : ''}；有效观看由服务端核对`
        : '本版本未记录视频观看与作答证据', result: '',
      mediaResponses: submittedMediaResponses(item, value),
      ...(value?.kind === 'video' ? { mediaKind: 'video' as const } : {}) }
    if (item.type === 'dubbing') return { itemId: item.id, title: item.title, question: '',
      answer: value?.kind === 'dubbing' ? '本次最终配音作品已提交；播放证据由服务端核对'
        : '本版本未记录任务配音最终作品', result: '',
      ...(value?.kind === 'dubbing' ? { mediaKind: 'dubbing' as const } : {}) }
    return { itemId: item.id, title: item.title, question: '',
      answer: value?.kind === 'recording' ? '本次已提交录音' : '本版本未记录录音', result: '',
      ...(value?.kind === 'recording' ? { recordingId: value.recordingId } : {}) }
  })
}
