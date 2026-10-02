import { TaskDetailView, TaskItem } from '../../../domain/types'
import { StructuredSubmissionAnswer, getPackAttemptSummary, getTaskDetail, getVocabularyProgress, saveDraft, submitTask } from '../../../services/app-service'
import { getReadingProgress } from '../../../services/m1-app-service'
import { getRepositoryMode } from '../../../repositories/repository-factory'
import { getCurrentTaskId, getSession, getTeacherReviewScoreDraft, setCurrentBookId, setTeacherReviewScoreDraft } from '../../../session/session'
import { assignmentStatusLabel } from '../../../shared/assignment-status'
import { activeDraftRecordVersion } from '../../../shared/submission-draft'
import { formatRecordingDuration } from '../../../shared/recording-duration'
import { recordingMediaIssue } from '../../../shared/dubbing-recording-validation'
import { formatTaskDueAt } from '../../../shared/task-schedule'
import { EMPTY_WRITE_INTENT, WriteIntentState, clearWriteIntent, createPageOperationId, prepareWriteIntent } from '../../../shared/write-intent'
import type { TaskRecordingView } from '../../../domain/task-recording'
import { beginTaskRecording, getTaskRecordingMediaState, getTaskRecordingPlayback, listTaskRecordings, submitTaskRecording } from '../../../services/task-recording-service'
import { taskProgress } from './task-progress'
import { firstIncompleteTaskItemId, studentSubmissionAtVersion, submittedAnswerRows, taskWriteAvailability } from './task-detail-view'
import { TeacherReviewRoute, loadTeacherReviewItem, teacherExerciseView, teacherReviewManualScoreRequired, teacherReviewRoute } from '../../../shared/teacher-review-item'
import type { TeacherReviewSubmissionView } from '../../../services/cloudbase-app-service'
import { parseReviewScoreInput } from '../../teacher/review-task/review-task-state'

type RecorderStop = { duration: number; fileSize: number; tempFilePath: string }
let taskRecordingReceiver: { stop: (result: RecorderStop) => void; error: () => void } | null = null
let taskRecorderBound = false
let taskRecorder: ReturnType<typeof wx.getRecorderManager> | null = null
let taskRecordingStartedAtMs: number | null = null
let taskRecordingTimer: ReturnType<typeof setInterval> | null = null
function stopTaskRecordingTimer(): void {
  if (taskRecordingTimer !== null) clearInterval(taskRecordingTimer)
  taskRecordingTimer = null
  taskRecordingStartedAtMs = null
}
function getTaskRecorder(): ReturnType<typeof wx.getRecorderManager> {
  taskRecorder ??= wx.getRecorderManager()
  return taskRecorder
}
function bindTaskRecorder(): void {
  if (taskRecorderBound) return
  const manager = getTaskRecorder()
  manager.onStop(result => taskRecordingReceiver?.stop(result))
  manager.onError(() => taskRecordingReceiver?.error())
  taskRecorderBound = true
}

interface CompletionInput {
  itemId: string
  resourceId?: string
  type: 'reading' | 'vocabulary' | 'exercise' | 'recording'
  title: string
  requiredCount: number
  pageIds?: string[]
  pageNumbers?: number[]
  pageRangeLabel: string
  readingVerified: boolean
  vocabularyVerified: boolean
  completedPageCount: string
  completedWordCount: string
  correctWordCount: string
  answeredQuestionCount: string
  exerciseQuestion?: TaskItem['exerciseQuestion']
  exerciseResponse: string
  exerciseSelectedOptions: string[]
  exerciseChoices: Array<{ value: string; selected: boolean }>
  recordingPrompt: string
  recordingId: string
  recordingMediaAvailable: boolean
  recordingMediaExpired: boolean
  localRecordingPath: string
  recordingDurationMs: number
  recordingElapsedLabel: string
  recordingSizeBytes: number
  recordingState: 'idle' | 'recording' | 'local' | 'invalid' | 'uploading' | 'submitted'
}

type TeacherTaskReviewItem = NonNullable<TeacherReviewSubmissionView['taskItems']>[number]
type TeacherExerciseEvidence = NonNullable<TeacherReviewSubmissionView['exerciseEvidence']>[number]

Component({
  data: {
    loading: true,
    error: '',
    detail: null as TaskDetailView | null,
    teacherReviewMode: false,
    teacherReviewRoute: null as TeacherReviewRoute | null,
    teacherReviewItem: null as TeacherTaskReviewItem | null,
    teacherReviewVersion: 0,
    teacherExercise: null as TeacherExerciseEvidence | null,
    teacherExerciseChoices: [] as Array<{ id: number; value: string; selected: boolean; correct: boolean }>,
    teacherAnswerLabel: '',
    teacherCorrectLabel: '',
    teacherVerdict: '',
    teacherRecordingId: '',
    teacherRecordingState: 'missing' as 'missing' | 'available' | 'expired' | 'error',
    teacherRecordingDuration: '',
    teacherManualScoreRequired: false,
    teacherScoreInput: '',
    teacherScoreError: '',
    statusLabel: '',
    dueLabel: '',
    historyEntries: [] as Array<{ version: number; statusLabel: string; submittedLabel: string; hasAnswers: boolean }>,
    selectedHistoryVersion: 0,
    selectedItemIndex: 0,
    readingSyncError: '',
    selectedReadingSyncError: '',
    vocabularySyncError: '',
    redoDueLabel: '',
    redoExpired: false,
    editable: false,
    writeUnavailableReason: '',
    writeTimingLabel: '',
    writeError: '',
    submittedAnswerRows: [] as ReturnType<typeof submittedAnswerRows>,
    submissionAnswerVersion: 0,
    submittedLearningRecord: '',
    selectedHistoryFeedback: null as TaskDetailView['feedback'] | null,
    feedbackVersion: 0,
    hasUnsupportedExercise: false,
    answer: '',
    completionInputs: [] as CompletionInput[],
    saving: false,
    submitting: false,
    draftIntent: EMPTY_WRITE_INTENT as WriteIntentState,
    submitIntent: EMPTY_WRITE_INTENT as WriteIntentState,
    activeRecordingItemId: '',
    recordingDrafts: {} as Record<string, TaskRecordingView | undefined>,
    recordingBeginIntents: {} as Record<string, WriteIntentState>,
    recordingSubmitIntents: {} as Record<string, WriteIntentState>,
    recordingError: '',
    hasRecordingTask: false,
    hasCompletionForm: false,
    progressPercent: 0,
    completedCount: 0,
    requirementItems: [] as Array<TaskItem & { progressComplete: boolean; progressLabel: string; readingPageRangeLabel: string }>,
  },
  observers: {
    'completionInputs, detail'(inputs: CompletionInput[], detail: TaskDetailView | null) {
      const progress = taskProgress(inputs, detail?.assignment.status ?? 'not_started')
      const assignment = detail?.assignment
      const statusLabel = assignment
        ? assignment.status === 'not_started' || assignment.status === 'in_progress'
          ? progress.percent === 100 ? '待提交'
            : assignment.redoDueAt ? '重做中'
              : progress.percent > 0 ? '学习中' : assignmentStatusLabel(assignment.status)
          : assignmentStatusLabel(assignment.status)
        : ''
      this.setData({ progressPercent: progress.percent, completedCount: progress.completedCount,
        statusLabel,
        requirementItems: (detail?.task.items ?? []).map(item => ({ ...item,
          progressComplete: progress.byItem[item.id]?.complete ?? false,
          progressLabel: progress.byItem[item.id]?.label ?? '未完成',
          readingPageRangeLabel: item.readingPageNumbers?.join('、') ?? '' })),
        hasCompletionForm: inputs.some(item => item.type === 'recording' || item.type === 'exercise' || !item.resourceId) })
    },
  },
  lifetimes: {
    attached() { const session = getSession(); if ((session?.activeRole ?? session?.user.role) === 'teacher') return
      bindTaskRecorder(); taskRecordingReceiver = { stop: result => this.onRecordingStopped(result),
      error: () => this.onRecordingFailed() }; this.loadDetail() },
    detached() { if (this.data.teacherReviewMode) return
      stopTaskRecordingTimer(); taskRecordingReceiver = null; if (this.data.activeRecordingItemId) getTaskRecorder().stop() },
  },
  pageLifetimes: { show() {
    const pages = getCurrentPages() as Array<{ options?: Record<string, string> }>
    const options = pages[pages.length - 1]?.options
    if (options?.teacherReview === '1') {
      if (!this.data.teacherReviewMode) {
        const route = teacherReviewRoute(options)
        this.setData({ teacherReviewMode: true, teacherReviewRoute: route }, () => this.loadTeacherReview())
      }
      return
    }
    if (this.data.detail) this.loadDetail(true)
  } },
  methods: {
    async loadTeacherReview() {
      const route = this.data.teacherReviewRoute
      if (!route) { this.setData({ loading: false, error: '缺少要查看的作业记录。' }); return }
      this.setData({ loading: true, error: '' })
      const result = await loadTeacherReviewItem(route, ['exercise', 'recording'])
      if (!result.ok) { this.setData({ loading: false, error: result.message }); return }
      const submission = result.submission
      const previousDraft = getTeacherReviewScoreDraft()
      const parsedDraft = parseReviewScoreInput(previousDraft?.submissionId === route.submissionId
        && previousDraft.itemId === route.itemId ? previousDraft.input : '')
      const scoreDraft = { teacherManualScoreRequired: teacherReviewManualScoreRequired(submission, result.item),
        teacherScoreInput: parsedDraft.input, teacherScoreError: parsedDraft.error }
      if (result.item.type === 'exercise') {
        const evidence = submission.exerciseEvidence?.find(entry => entry.itemId === route.itemId) ?? null
        const display = teacherExerciseView(evidence)
        this.setData({ loading: false, teacherReviewItem: result.item, ...scoreDraft,
          teacherReviewVersion: submission.submissionVersion, teacherExercise: evidence,
          teacherExerciseChoices: display.choices, teacherAnswerLabel: display.answerLabel,
          teacherCorrectLabel: display.correctLabel, teacherVerdict: display.verdict })
        return
      }
      const answer = submission.answers.find(entry => entry.itemId === route.itemId)?.value
      const value = answer !== null && typeof answer === 'object' && !Array.isArray(answer)
        ? answer as Record<string, unknown> : null
      const recordingId = value?.kind === 'recording' && typeof value.recordingId === 'string'
        ? value.recordingId : ''
      const durationMs = typeof value?.durationMs === 'number' && Number.isFinite(value.durationMs)
        ? value.durationMs : 0
      this.setData({ loading: false, teacherReviewItem: result.item, ...scoreDraft,
        teacherReviewVersion: submission.submissionVersion, teacherRecordingId: recordingId,
        teacherRecordingDuration: durationMs > 0 ? formatRecordingDuration(durationMs) : '未记录',
        teacherRecordingState: recordingId ? 'error' : 'missing' })
      if (!recordingId) return
      const session = getSession()
      if (!session) return
      const media = await getTaskRecordingMediaState(session.user.id, recordingId)
      if (this.data.teacherReviewRoute?.submissionId !== route.submissionId) return
      this.setData({ teacherRecordingState: !media.ok ? 'error'
        : media.data.mediaExpired ? 'expired' : 'available' })
    },
    onTeacherReviewScore(event: WechatMiniprogram.Input) {
      const route = this.data.teacherReviewRoute
      if (!this.data.teacherReviewMode || !this.data.teacherManualScoreRequired || !route) return
      const parsed = parseReviewScoreInput(event.detail.value)
      setTeacherReviewScoreDraft({ submissionId: route.submissionId, itemId: route.itemId, input: parsed.input })
      this.setData({ teacherScoreInput: parsed.input, teacherScoreError: parsed.error })
    },
    async playTeacherRecording() {
      const recordingId = this.data.teacherRecordingId
      const session = getSession()
      if (!this.data.teacherReviewMode || !session || !recordingId || this.data.teacherRecordingState !== 'available') return
      const result = await getTaskRecordingPlayback(session.user.id, recordingId)
      if (!result.ok) { wx.showToast({ title: result.error.message, icon: 'none' }); return }
      const audio = wx.createInnerAudioContext()
      audio.src = result.data.temporaryUrl
      audio.onEnded(() => audio.destroy())
      audio.onError(() => { audio.destroy(); wx.showToast({ title: '录音试听失败，请重试', icon: 'none' }) })
      audio.play()
    },
    async loadDetail(refresh = false) {
      if (this.data.teacherReviewMode) { await this.loadTeacherReview(); return }
      const session = getSession(); const taskId = getCurrentTaskId()
      if (!session || !taskId) { wx.navigateBack(); return }
      if (refresh !== true) this.setData({ loading: true, error: '' })
      const result = await getTaskDetail(session.user.id, taskId)
      if (!result.ok) {
        this.setData(refresh === true ? { writeError: `任务状态刷新失败：${result.error.message}；当前输入已保留` }
          : { loading: false, error: result.error.message }); return
      }
      const assignment = result.data.assignment
      const redoWindow = assignment.status === 'redo_required' || Boolean(assignment.redoDueAt)
      const reuseSubmission = !(redoWindow && result.data.submission?.status === 'returned')
      const answers = new Map(reuseSubmission ? result.data.submission?.answers.map(item => [item.taskItemId, item.structuredValue]) ?? [] : [])
      const readingPageCounts = new Map(result.data.readingPageProgress?.map(item => [item.itemId, item.completedPageCount]) ?? [])
      const completionInputs = result.data.task.items.flatMap((item): CompletionInput[] => {
        const rule = item.completionRuleData
        if (!rule) return []
        const previous = answers.get(item.id)
        const priorQuestionResponse = previous?.kind === 'exercise' && item.exerciseQuestion
          ? previous.questionResponses?.find(response => response.questionId === item.exerciseQuestion?.questionId)?.response : undefined
        const exerciseResponse = typeof priorQuestionResponse === 'string' ? priorQuestionResponse : ''
        const exerciseSelectedOptions = Array.isArray(priorQuestionResponse) ? [...priorQuestionResponse] : []
        const requiredCount = rule.kind === 'reading_pages'
          ? rule.requiredPageCount
          : rule.kind === 'vocabulary_words' ? rule.requiredWordCount
            : rule.kind === 'exercise_questions' ? rule.requiredQuestionCount : 1
        const recordingId = previous?.kind === 'recording' && result.data.assignment.status !== 'redo_required'
          ? previous.recordingId : ''
        return [{
          itemId: item.id,
          ...(item.resourceId === undefined ? {} : { resourceId: item.resourceId }),
          type: item.type,
          title: item.title,
          requiredCount,
          ...(rule.kind === 'reading_pages' && rule.pageIds ? { pageIds: [...rule.pageIds] } : {}),
          ...(item.readingPageNumbers ? { pageNumbers: [...item.readingPageNumbers] } : {}),
          pageRangeLabel: item.readingPageNumbers?.length ? `（第 ${item.readingPageNumbers.join('、')} 页）` : '',
          readingVerified: !item.resourceId || (rule.kind === 'reading_pages' && Boolean(rule.pageIds?.length)
            && (readingPageCounts.get(item.id) ?? 0) >= rule.requiredPageCount),
          vocabularyVerified: !item.resourceId,
          completedPageCount: rule.kind === 'reading_pages' && rule.pageIds
            ? String(readingPageCounts.get(item.id) ?? 0)
            : previous?.kind === 'reading' ? String(previous.completedPageCount) : '',
          completedWordCount: previous?.kind === 'vocabulary' ? String(previous.completedWordCount) : '',
          correctWordCount: previous?.kind === 'vocabulary' ? String(previous.correctWordCount) : '',
          answeredQuestionCount: previous?.kind === 'exercise' ? String(previous.answeredQuestionCount) : '',
          ...(item.exerciseQuestion === undefined ? {} : { exerciseQuestion: item.exerciseQuestion }),
          exerciseResponse,
          exerciseSelectedOptions,
          exerciseChoices: item.exerciseQuestion?.options.map(value => ({ value,
            selected: item.exerciseQuestion?.questionType === 'multiple_choice'
              ? exerciseSelectedOptions.includes(value) : exerciseResponse === value })) ?? [],
          recordingPrompt: item.recordingPrompt ?? '',
          recordingId,
          recordingMediaAvailable: false,
          recordingMediaExpired: false,
          localRecordingPath: '',
          recordingDurationMs: previous?.kind === 'recording' && recordingId ? previous.durationMs ?? 0 : 0,
          recordingElapsedLabel: formatRecordingDuration(previous?.kind === 'recording' && recordingId ? previous.durationMs ?? 0 : 0),
          recordingSizeBytes: previous?.kind === 'recording' && recordingId ? previous.sizeBytes ?? 0 : 0,
          recordingState: recordingId ? 'submitted' : 'idle',
        }]
      })
      const learningRecord = reuseSubmission
        ? result.data.submission?.answers.find(item => item.structuredValue === undefined)?.value ?? '' : ''
       const availability = taskWriteAvailability(result.data.task, assignment, new Date().toISOString(), getRepositoryMode() === 'memory')
      const previousDetail = this.data.detail
      const retainInput = refresh === true && availability.editable && previousDetail?.task.id === taskId
        && previousDetail.assignment.redoCount === assignment.redoCount
        && previousDetail.submission?.version === result.data.submission?.version
      const previousInputs = new Map(retainInput ? this.data.completionInputs.map(item => [item.itemId, item]) : [])
      const visibleInputs = completionInputs.map(item => {
        const previous = previousInputs.get(item.itemId)
        if (!previous || (item.resourceId && (item.type === 'reading' || item.type === 'vocabulary'))) return item
        return { ...item, ...previous }
      })
      const selectedHistoryVersion = result.data.submissionHistory?.some(item => item.version === this.data.selectedHistoryVersion)
        ? this.data.selectedHistoryVersion : result.data.submissionHistory?.[0]?.version
          ?? (result.data.submission?.status !== 'draft' ? result.data.submission?.version ?? 0 : 0)
      const selectedSubmission = studentSubmissionAtVersion(result.data, selectedHistoryVersion)
      const selectedHistoryFeedback = result.data.submissionHistory?.find(item => item.version === selectedHistoryVersion)?.feedback
        ?? (result.data.submission?.version === selectedHistoryVersion ? result.data.feedback : undefined)
      const submittedAnswers = submittedAnswerRows(result.data.task, selectedSubmission)
      this.setData({
        loading: false, detail: result.data, completionInputs: visibleInputs,
        hasRecordingTask: visibleInputs.some(item => item.type === 'recording'),
        dueLabel: formatTaskDueAt(result.data.task.dueAt),
        historyEntries: (result.data.submissionHistory ?? []).map(item => ({ version: item.version,
          statusLabel: item.status === 'reviewed' ? '已点评' : item.status === 'returned' ? '退回重做' : '待检查',
          submittedLabel: formatTaskDueAt(item.submittedAt), hasAnswers: Boolean(item.answers) })),
        selectedHistoryVersion,
        selectedReadingSyncError: completionInputs.some(item => item.pageIds) && !result.data.readingPageProgress
          ? '阅读页进度暂未返回，请重试同步' : '',
        redoDueLabel: assignment.redoDueAt ? formatTaskDueAt(assignment.redoDueAt) : '',
         redoExpired: redoWindow && !availability.editable,
         editable: availability.editable,
         writeUnavailableReason: availability.reason,
         writeTimingLabel: availability.timingLabel,
         writeError: '',
         submittedAnswerRows: submittedAnswers,
         submissionAnswerVersion: submittedAnswers.length ? selectedHistoryVersion : 0,
         submittedLearningRecord: selectedSubmission?.answers.find(item => item.structuredValue === undefined)?.value ?? '',
         selectedHistoryFeedback: selectedHistoryFeedback ?? null,
         feedbackVersion: result.data.feedback && result.data.submission
           ? result.data.submission.status === 'draft' ? result.data.submission.version - 1 : result.data.submission.version : 0,
        hasUnsupportedExercise: getRepositoryMode() === 'cloudbase' && completionInputs.some(item => item.type === 'exercise' && !item.exerciseQuestion),
        answer: retainInput ? this.data.answer : learningRecord,
      }, () => { this.refreshReadingCompletion(); this.refreshVocabularyCompletion(); this.refreshTaskRecordings(); this.refreshRecordingMediaStates() })
    },
    selectHistoryVersion(event: WechatMiniprogram.TouchEvent) {
      const version = Number(event.currentTarget.dataset.version)
      const detail = this.data.detail
      if (!detail || !Number.isSafeInteger(version)) return
      const selected = studentSubmissionAtVersion(detail, version)
      this.setData({ selectedHistoryVersion: version,
        submittedAnswerRows: submittedAnswerRows(detail.task, selected),
        submissionAnswerVersion: selected ? version : 0,
        submittedLearningRecord: selected?.answers.find(item => item.structuredValue === undefined)?.value ?? '',
        selectedHistoryFeedback: detail.submissionHistory?.find(item => item.version === version)?.feedback ?? null })
    },
    async playHistoryRecording(event: WechatMiniprogram.TouchEvent) {
      const session = getSession()
      const recordingId = event.currentTarget.dataset.id as string
      if (!session || !recordingId) return
      const result = await getTaskRecordingPlayback(session.user.id, recordingId)
      if (!result.ok) { wx.showToast({ title: result.error.message || '录音暂不可试听', icon: 'none' }); return }
      const audio = wx.createInnerAudioContext()
      audio.src = result.data.temporaryUrl
      audio.onEnded(() => audio.destroy())
      audio.onError(() => { audio.destroy(); wx.showToast({ title: '试听失败，请重试', icon: 'none' }) })
      audio.play()
    },
    jumpToItem(event: WechatMiniprogram.TouchEvent) {
      this.scrollToTaskItem(Number(event.currentTarget.dataset.index))
    },
    jumpToFirstIncomplete() {
      const detail = this.data.detail
      if (!detail) return
      const progress = taskProgress(this.data.completionInputs, detail.assignment.status)
      const itemId = firstIncompleteTaskItemId(detail.task, this.data.completionInputs, progress.byItem)
      const index = detail.task.items.findIndex(item => item.id === itemId)
      if (index < 0) { wx.showToast({ title: '任务项已完成，请核对后提交', icon: 'none' }); return }
      this.scrollToTaskItem(index)
    },
    scrollToTaskItem(index: number) {
      const detail = this.data.detail
      if (!detail || !Number.isInteger(index) || index < 0 || index >= detail.task.items.length) return
      this.setData({ selectedItemIndex: index })
      const item = detail.task.items[index]
      const answerHere = this.data.editable && (item.type === 'recording' || item.type === 'exercise' || !item.resourceId)
      wx.pageScrollTo({ selector: `#${answerHere ? 'answer' : 'requirement'}-item-${index}`, duration: 250 })
    },
    async refreshTaskReadingProof() {
      const session = getSession()
      const taskId = this.data.detail?.task.id
      if (!session || !taskId || !this.data.completionInputs.some(item => item.type === 'reading' && item.pageIds)) return
      const result = await getTaskDetail(session.user.id, taskId)
      if (this.data.detail?.task.id !== taskId) return
      if (!result.ok || !result.data.readingPageProgress) {
        this.setData({ selectedReadingSyncError: result.ok ? '阅读页进度暂未返回，请重试同步' : result.error.message })
        return
      }
      const counts = new Map(result.data.readingPageProgress.map(item => [item.itemId, item.completedPageCount]))
      this.setData({ selectedReadingSyncError: '', completionInputs: this.data.completionInputs.map(item =>
        item.type === 'reading' && item.pageIds ? { ...item,
          completedPageCount: String(counts.get(item.itemId) ?? 0),
          readingVerified: (counts.get(item.itemId) ?? 0) >= item.requiredCount } : item) })
    },
    async refreshRecordingMediaStates() {
      const session = getSession()
      const taskId = this.data.detail?.task.id
      if (!session || !taskId) return
      const recordingItems = this.data.completionInputs.filter(item => item.type === 'recording' && item.recordingId)
      const states = await Promise.all(recordingItems.map(async item => ({ itemId: item.itemId,
        recordingId: item.recordingId,
        result: await getTaskRecordingMediaState(session.user.id, item.recordingId) })))
      if (this.data.detail?.task.id !== taskId) return
      const byItem = new Map(states.map(item => [item.itemId, item]))
      this.setData({ completionInputs: this.data.completionInputs.map(item => {
        const state = byItem.get(item.itemId)
        if (!state || state.recordingId !== item.recordingId) return item
        return { ...item, recordingMediaAvailable: state.result.ok && !state.result.data.mediaExpired,
          recordingMediaExpired: state.result.ok && state.result.data.mediaExpired }
      }) })
    },
    refreshRedoWindow() {
      const detail = this.data.detail
      if (!detail) return
      const availability = taskWriteAvailability(detail.task, detail.assignment, new Date().toISOString(), getRepositoryMode() === 'memory')
      const redoWindow = detail.assignment.status === 'redo_required' || Boolean(detail.assignment.redoDueAt)
      this.setData({ redoExpired: redoWindow && !availability.editable, editable: availability.editable,
        writeUnavailableReason: availability.reason, writeTimingLabel: availability.timingLabel })
    },
    canEditCurrentRedo(): boolean {
      const detail = this.data.detail
      if (!detail) return false
      const availability = taskWriteAvailability(detail.task, detail.assignment, new Date().toISOString(), getRepositoryMode() === 'memory')
      this.setData({ editable: availability.editable, writeUnavailableReason: availability.reason,
        writeTimingLabel: availability.timingLabel })
      if (!availability.editable) this.setData({ writeError: availability.reason })
      return availability.editable
    },
    async refreshReadingCompletion() {
      const session = getSession()
      if (!session || !this.data.detail) return
      const readingItems = this.data.completionInputs.filter(item => item.type === 'reading' && item.resourceId && !item.pageIds)
      if (!readingItems.length) return
      const progress = await Promise.all(readingItems.map(async item => ({ itemId: item.itemId, result: await getReadingProgress(session.user.id, item.resourceId!) })))
      const pageCounts = new Map(progress.flatMap(item => item.result.ok && item.result.data.hasSavedProgress ? [[item.itemId, item.result.data.pageNumber] as const] : []))
      this.setData({ readingSyncError: progress.some(item => !item.result.ok) ? '阅读进度同步失败，已保留当前内容' : '', completionInputs: this.data.completionInputs.map(item => {
        if (item.type !== 'reading' || !item.resourceId || item.pageIds) return item
        const pageNumber = pageCounts.get(item.itemId)
        return pageNumber === undefined ? { ...item, readingVerified: false } : { ...item, completedPageCount: String(Math.min(pageNumber, item.requiredCount)), readingVerified: true }
      }) })
    },
    async refreshVocabularyCompletion() {
      const session = getSession()
      if (!session || !this.data.detail) return
      if (!this.data.editable) return
      const vocabularyItems = this.data.completionInputs.filter(item => item.type === 'vocabulary' && item.resourceId)
      if (!vocabularyItems.length) return
      if (getRepositoryMode() === 'cloudbase') {
        const taskId = this.data.detail.task.id
        const verified = await Promise.all(vocabularyItems.map(async item => {
          const taskItem = this.data.detail?.task.items.find(candidate => candidate.id === item.itemId)
          if (taskItem?.snapshotSchemaVersion === 2) {
            const wordIds = taskItem.vocabularyWordIds
            if (!wordIds?.length) return { itemId: item.itemId, completed: null, correct: null }
            const summary = await getPackAttemptSummary(session.user.id, { packId: item.resourceId!, taskId, itemId: item.itemId })
            if (!summary.ok || summary.data.words.length !== wordIds.length
              || !wordIds.every(wordId => summary.data.words.some(word => word.wordId === wordId))) {
              return { itemId: item.itemId, completed: null, correct: null }
            }
            return { itemId: item.itemId,
              completed: summary.data.words.filter(word => word.firstCorrect !== null).length,
              correct: summary.data.words.filter(word => word.firstCorrect === true).length }
          }
          const old = await getVocabularyProgress(session.user.id, item.resourceId!)
          return old.ok && old.data
            ? { itemId: item.itemId, completed: old.data.completedCount, correct: old.data.correctCount }
            : { itemId: item.itemId, completed: null, correct: null }
        }))
        const counts = new Map(verified.map(item => [item.itemId, item] as const))
        this.setData({ vocabularySyncError: verified.some(item => item.completed === null) ? '单词进度同步失败，请重试' : '',
          completionInputs: this.data.completionInputs.map(item => {
            if (item.type !== 'vocabulary' || !item.resourceId) return item
            const count = counts.get(item.itemId)
            return count?.completed === null || count?.completed === undefined || count.correct === null
              ? { ...item, completedWordCount: '', correctWordCount: '', vocabularyVerified: false }
              : { ...item, completedWordCount: String(count.completed), correctWordCount: String(count.correct), vocabularyVerified: true }
          }) })
        return
      }
      const progress = await Promise.all(vocabularyItems.map(async item => ({ itemId: item.itemId, result: await getVocabularyProgress(session.user.id, item.resourceId!) })))
      const counts = new Map(progress.flatMap(item => item.result.ok && item.result.data
        ? [[item.itemId, { completed: item.result.data.completedCount, correct: item.result.data.correctCount }] as const] : []))
      this.setData({ vocabularySyncError: progress.some(item => !item.result.ok) ? '单词进度同步失败，请重试' : '',
        completionInputs: this.data.completionInputs.map(item => {
          if (item.type !== 'vocabulary' || !item.resourceId) return item
          const count = counts.get(item.itemId)
          return count === undefined
            ? { ...item, completedWordCount: '', correctWordCount: '', vocabularyVerified: false }
            : { ...item, completedWordCount: String(count.completed), correctWordCount: String(count.correct), vocabularyVerified: true }
        }) })
    },
    async refreshTaskRecordings() {
      const session = getSession()
      const taskId = this.data.detail?.task.id
      if (!session || !taskId || !this.data.editable) return
      const currentSubmissionVersion = this.data.detail?.submission?.status === 'draft'
        ? this.data.detail.submission.version : (this.data.detail?.submission?.version ?? 0) + 1
      const recordingItems = this.data.completionInputs.filter(item => item.type === 'recording')
      if (!recordingItems.length) return
      const results = await Promise.all(recordingItems.map(async item => ({ itemId: item.itemId,
        result: await listTaskRecordings(session.user.id, taskId, item.itemId) })))
      if (this.data.detail?.task.id !== taskId) return
      const drafts = { ...this.data.recordingDrafts }
      const submitted = new Map<string, TaskRecordingView>()
      for (const entry of results) {
        if (!entry.result.ok) continue
        const ordered = entry.result.data.filter(recording => recording.submissionVersion === currentSubmissionVersion)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        const latestDraft = ordered.find(recording => recording.status === 'draft')
        const latestSubmitted = ordered.find(recording => recording.status === 'submitted')
        if (latestDraft) drafts[entry.itemId] = latestDraft
        if (latestSubmitted) submitted.set(entry.itemId, latestSubmitted)
      }
      this.setData({ recordingDrafts: drafts,
        recordingError: results.some(entry => !entry.result.ok)
          ? '录音进度同步失败，已保留当前内容；可稍后重试' : this.data.recordingError,
        completionInputs: this.data.completionInputs.map(item => {
          const recording = submitted.get(item.itemId)
          if (!recording || item.type !== 'recording' || item.localRecordingPath || item.recordingId) return item
          return { ...item, recordingId: recording.id, recordingState: 'submitted' as const,
            recordingMediaAvailable: !recording.mediaExpired, recordingMediaExpired: Boolean(recording.mediaExpired),
            recordingDurationMs: recording.durationMs ?? 0,
            recordingElapsedLabel: formatRecordingDuration(recording.durationMs ?? 0),
            recordingSizeBytes: recording.sizeBytes ?? 0 }
        }) })
    },
    openVocabulary(event: WechatMiniprogram.TouchEvent) {
      if (getRepositoryMode() === 'cloudbase' && !this.data.editable) {
        wx.showToast({ title: '任务已提交，请查看本次结果', icon: 'none' }); return
      }
      const item = this.data.detail?.task.items.find(candidate => candidate.id === event.currentTarget.dataset.id)
      if (!item?.resourceId) { wx.showToast({ title: '单词资源暂不可用', icon: 'none' }); return }
      const taskId = this.data.detail?.task.id ?? ''
      wx.navigateTo({ url: `/pages/student/vocabulary/vocabulary?packId=${encodeURIComponent(item.resourceId)}&taskId=${encodeURIComponent(taskId)}&itemId=${encodeURIComponent(item.id)}` })
    },
    openReading(event: WechatMiniprogram.TouchEvent) {
      const itemId = event.currentTarget.dataset.id as string
      const item = this.data.detail?.task.items.find(candidate => candidate.id === itemId)
      if (!item?.resourceId) { wx.showToast({ title: '阅读资源暂不可用', icon: 'none' }); return }
      const taskId = this.data.detail?.task.id ?? ''
      const requiredCount = item.completionRuleData?.kind === 'reading_pages' ? item.completionRuleData.requiredPageCount : 0
      setCurrentBookId(item.resourceId)
      const startPage = item.readingPageNumbers?.[0]
      wx.navigateTo({ url: `/pages/student/reading-detail/reading-detail?bookId=${encodeURIComponent(item.resourceId)}&taskId=${encodeURIComponent(taskId)}&requiredPageCount=${requiredCount}${startPage ? `&startPageNumber=${startPage}` : ''}` })
    },
    onAnswer(event: WechatMiniprogram.Input) {
      this.setData({ answer: event.detail.value, draftIntent: clearWriteIntent(), submitIntent: clearWriteIntent() })
    },
    onCompletionInput(event: WechatMiniprogram.Input) {
      const itemId = event.currentTarget.dataset.id as string
      if (this.data.completionInputs.some(item => item.itemId === itemId && item.resourceId
        && (item.type === 'reading' || item.type === 'vocabulary'))) return
      const field = event.currentTarget.dataset.field as keyof Pick<CompletionInput, 'completedPageCount' | 'completedWordCount' | 'correctWordCount' | 'answeredQuestionCount'>
      this.setData({
        completionInputs: this.data.completionInputs.map(item => item.itemId === itemId ? { ...item, [field]: event.detail.value } : item),
        draftIntent: clearWriteIntent(),
        submitIntent: clearWriteIntent(),
      })
    },
    onExerciseResponse(event: WechatMiniprogram.Input) {
      const itemId = event.currentTarget.dataset.id as string
      this.setData({ completionInputs: this.data.completionInputs.map(item => item.itemId === itemId
        ? { ...item, exerciseResponse: event.detail.value } : item),
      draftIntent: clearWriteIntent(), submitIntent: clearWriteIntent() })
    },
    chooseExerciseOption(event: WechatMiniprogram.TouchEvent) {
      const itemId = event.currentTarget.dataset.id as string
      const value = event.currentTarget.dataset.value as string
      this.setData({ completionInputs: this.data.completionInputs.map(item => {
        if (item.itemId !== itemId || !item.exerciseQuestion || !item.exerciseQuestion.options.includes(value)) return item
        const multiple = item.exerciseQuestion.questionType === 'multiple_choice'
        const selected = multiple
          ? item.exerciseSelectedOptions.includes(value) ? item.exerciseSelectedOptions.filter(option => option !== value) : [...item.exerciseSelectedOptions, value]
          : []
        const response = multiple ? '' : value
        return { ...item, exerciseSelectedOptions: selected, exerciseResponse: response,
          exerciseChoices: item.exerciseChoices.map(choice => ({ ...choice, selected: multiple ? selected.includes(choice.value) : response === choice.value })) }
      }), draftIntent: clearWriteIntent(), submitIntent: clearWriteIntent() })
    },
    async startRecording(event: WechatMiniprogram.TouchEvent) {
      const itemId = event.currentTarget.dataset.id as string
      const item = this.data.completionInputs.find(candidate => candidate.itemId === itemId && candidate.type === 'recording')
      if (!item || !this.data.editable || this.data.activeRecordingItemId || this.data.submitting
        || item.recordingState === 'uploading') return
      if (getRepositoryMode() !== 'cloudbase') {
        this.setData({ recordingError: '录音任务需要可信云端服务，当前演示模式不可录制提交' }); return
      }
      try { await wx.authorize({ scope: 'scope.record' }) }
      catch (_error: unknown) { this.setData({ recordingError: '请在微信设置中允许使用麦克风后重试' }); return }
      this.setData({ activeRecordingItemId: itemId, recordingError: '',
        completionInputs: this.data.completionInputs.map(candidate => candidate.itemId === itemId
          ? { ...candidate, recordingState: 'recording' as const, recordingElapsedLabel: '00:00' } : candidate) })
      try {
        getTaskRecorder().start({ duration: 300000, sampleRate: 16000, encodeBitRate: 64000,
          numberOfChannels: 1, format: 'mp3' })
        stopTaskRecordingTimer()
        taskRecordingStartedAtMs = Date.now()
        taskRecordingTimer = setInterval(() => {
          if (this.data.activeRecordingItemId !== itemId || taskRecordingStartedAtMs === null) {
            stopTaskRecordingTimer()
            return
          }
          const label = formatRecordingDuration(Math.min(300000, Date.now() - taskRecordingStartedAtMs))
          const current = this.data.completionInputs.find(candidate => candidate.itemId === itemId)
          if (current?.recordingElapsedLabel !== label) this.setData({
            completionInputs: this.data.completionInputs.map(candidate => candidate.itemId === itemId
              ? { ...candidate, recordingElapsedLabel: label } : candidate),
          })
        }, 250)
      } catch (_error: unknown) {
        stopTaskRecordingTimer()
        this.setData({ activeRecordingItemId: '', recordingError: '录音未能开始，请重试',
          completionInputs: this.data.completionInputs.map(candidate => candidate.itemId === itemId
            ? { ...candidate, recordingState: 'idle' as const, recordingElapsedLabel: '00:00' } : candidate) })
      }
    },
    stopRecording() { if (this.data.activeRecordingItemId) { stopTaskRecordingTimer(); getTaskRecorder().stop() } },
    onRecordingStopped(result: RecorderStop) {
      const itemId = this.data.activeRecordingItemId
      if (!itemId) return
      stopTaskRecordingTimer()
      const recordingIssue = recordingMediaIssue(result.duration, result.fileSize, result.tempFilePath)
      this.setData({ activeRecordingItemId: '',
        recordingError: recordingIssue,
        completionInputs: this.data.completionInputs.map(item => item.itemId === itemId ? {
          ...item, recordingState: result.tempFilePath ? recordingIssue ? 'invalid' as const : 'local' as const : 'idle' as const,
          localRecordingPath: result.tempFilePath,
          recordingDurationMs: result.duration, recordingSizeBytes: result.fileSize, recordingId: '',
          recordingElapsedLabel: formatRecordingDuration(result.duration),
          recordingMediaAvailable: false, recordingMediaExpired: false,
        } : item), draftIntent: clearWriteIntent(), submitIntent: clearWriteIntent() })
    },
    onRecordingFailed() {
      const itemId = this.data.activeRecordingItemId
      if (!itemId) return
      stopTaskRecordingTimer()
      this.setData({ activeRecordingItemId: '', recordingError: '录音失败，请重试',
        completionInputs: this.data.completionInputs.map(item => item.itemId === itemId
          ? { ...item, recordingState: 'idle' as const, recordingElapsedLabel: '00:00' } : item) })
    },
    playLocalRecording(event: WechatMiniprogram.TouchEvent) {
      const item = this.data.completionInputs.find(candidate => candidate.itemId === event.currentTarget.dataset.id)
      if (!item?.localRecordingPath) return
      const audio = wx.createInnerAudioContext()
      audio.src = item.localRecordingPath
      audio.onEnded(() => audio.destroy())
      audio.onError(() => { audio.destroy(); wx.showToast({ title: '试听失败，请重试', icon: 'none' }) })
      audio.play()
    },
    async playSubmittedRecording(event: WechatMiniprogram.TouchEvent) {
      const session = getSession()
      const item = this.data.completionInputs.find(candidate => candidate.itemId === event.currentTarget.dataset.id)
      if (!session || !item?.recordingId || !item.recordingMediaAvailable) return
      const result = await getTaskRecordingPlayback(session.user.id, item.recordingId)
      if (!result.ok) { this.setData({ recordingError: result.error.message }); return }
      const audio = wx.createInnerAudioContext()
      audio.src = result.data.temporaryUrl
      audio.onEnded(() => audio.destroy())
      audio.onError(() => { audio.destroy(); wx.showToast({ title: '试听失败，请重试', icon: 'none' }) })
      audio.play()
    },
    redoRecording(event: WechatMiniprogram.TouchEvent) {
      const itemId = event.currentTarget.dataset.id as string
      if (!this.data.editable || this.data.activeRecordingItemId) return
      wx.showModal({ title: '重新录制？', content: '本页当前录音将替换为新录音，已提交的历史版本保留。',
        confirmText: '重录', success: answer => {
          if (!answer.confirm) return
          this.setData({ recordingError: '',
            completionInputs: this.data.completionInputs.map(item => item.itemId === itemId ? {
              ...item, localRecordingPath: '', recordingDurationMs: 0, recordingElapsedLabel: '00:00', recordingSizeBytes: 0,
              recordingId: '', recordingState: 'idle' as const,
              recordingMediaAvailable: false, recordingMediaExpired: false,
            } : item),
            recordingDrafts: { ...this.data.recordingDrafts, [itemId]: undefined },
            recordingBeginIntents: { ...this.data.recordingBeginIntents, [itemId]: clearWriteIntent() },
            recordingSubmitIntents: { ...this.data.recordingSubmitIntents, [itemId]: clearWriteIntent() },
            draftIntent: clearWriteIntent(), submitIntent: clearWriteIntent() })
        } })
    },
    async uploadRecording(event: WechatMiniprogram.TouchEvent) {
      const itemId = event.currentTarget.dataset.id as string
      const item = this.data.completionInputs.find(candidate => candidate.itemId === itemId && candidate.type === 'recording')
      const session = getSession()
      const taskId = this.data.detail?.task.id
      if (!session || !taskId || !item || !this.data.editable || item.recordingState !== 'local'
        || !item.localRecordingPath || this.data.activeRecordingItemId) return
      const recordingIssue = recordingMediaIssue(item.recordingDurationMs, item.recordingSizeBytes,
        item.localRecordingPath)
      if (recordingIssue) { this.recordingUploadFailed(itemId, recordingIssue, true); return }
      this.setData({ recordingError: '', completionInputs: this.data.completionInputs.map(candidate =>
        candidate.itemId === itemId ? { ...candidate, recordingState: 'uploading' as const } : candidate) })
      let draft = this.data.recordingDrafts[itemId]
      if (!draft || draft.status !== 'draft') {
        const beginIntent = prepareWriteIntent(this.data.recordingBeginIntents[itemId] ?? EMPTY_WRITE_INTENT,
          `${taskId}:${itemId}`, () => createPageOperationId('begin_task_recording'))
        this.setData({ recordingBeginIntents: { ...this.data.recordingBeginIntents, [itemId]: beginIntent } })
        const begun = await beginTaskRecording(session.user.id, taskId, itemId, beginIntent.operationId)
        if (!begun.ok) { this.recordingUploadFailed(itemId, begun.error.message); return }
        draft = begun.data
        this.setData({ recordingDrafts: { ...this.data.recordingDrafts, [itemId]: draft },
          recordingBeginIntents: { ...this.data.recordingBeginIntents, [itemId]: clearWriteIntent() } })
      }
      let stagingFileId: string
      try { stagingFileId = (await wx.cloud.uploadFile({ cloudPath: draft.stagingPath,
        filePath: item.localRecordingPath })).fileID }
      catch (_error: unknown) { this.recordingUploadFailed(itemId, '上传失败，录音已保留，可重试'); return }
      const fingerprint = JSON.stringify({ recordingId: draft.id, stagingFileId, version: draft.version })
      const submitIntent = prepareWriteIntent(this.data.recordingSubmitIntents[itemId] ?? EMPTY_WRITE_INTENT,
        fingerprint, () => createPageOperationId('seal_task_recording'))
      this.setData({ recordingSubmitIntents: { ...this.data.recordingSubmitIntents, [itemId]: submitIntent } })
      const submitted = await submitTaskRecording(session.user.id, draft.id, stagingFileId,
        draft.version, submitIntent.operationId)
      if (!submitted.ok) {
        this.recordingUploadFailed(itemId, submitted.error.code === 'MEDIA_INVALID'
          ? '云端无法识别本次录音文件，请重新录制'
          : `${submitted.error.message}，录音已保留，可重试`, submitted.error.code === 'MEDIA_INVALID')
        return
      }
      this.setData({ recordingError: '',
        recordingDrafts: { ...this.data.recordingDrafts, [itemId]: submitted.data },
        recordingSubmitIntents: { ...this.data.recordingSubmitIntents, [itemId]: clearWriteIntent() },
        completionInputs: this.data.completionInputs.map(candidate => candidate.itemId === itemId ? {
          ...candidate, recordingId: submitted.data.id, recordingDurationMs: submitted.data.durationMs ?? 0,
          recordingElapsedLabel: formatRecordingDuration(submitted.data.durationMs ?? 0),
          recordingSizeBytes: submitted.data.sizeBytes ?? 0, recordingState: 'submitted' as const,
          recordingMediaAvailable: true, recordingMediaExpired: false,
        } : candidate), draftIntent: clearWriteIntent(), submitIntent: clearWriteIntent() })
      wx.showToast({ title: '录音已上传，请提交任务', icon: 'success' })
    },
    recordingUploadFailed(itemId: string, message: string, invalid = false) {
      this.setData({ recordingError: message, completionInputs: this.data.completionInputs.map(item =>
        item.itemId === itemId ? { ...item, recordingState: invalid ? 'invalid' as const : 'local' as const } : item) })
    },
    structuredAnswers(requireComplete: boolean): StructuredSubmissionAnswer[] | null {
      const answers: StructuredSubmissionAnswer[] = []
      for (const item of this.data.completionInputs) {
        if (item.type === 'reading') {
          if (requireComplete && !item.readingVerified) return null
          const count = parseCount(item.completedPageCount)
          if (count === null) { if (requireComplete) return null; continue }
          if (requireComplete && count < item.requiredCount) return null
          answers.push({ itemId: item.itemId, value: { kind: 'reading', completedPageCount: count } })
        } else if (item.type === 'vocabulary') {
          if (requireComplete && !item.vocabularyVerified) return null
          const completed = parseCount(item.completedWordCount)
          const correct = parseCount(item.correctWordCount)
          if (completed === null || correct === null) { if (requireComplete) return null; continue }
          if (correct > completed || (requireComplete && completed < item.requiredCount)) return null
          answers.push({ itemId: item.itemId, value: { kind: 'vocabulary', completedWordCount: completed, correctWordCount: correct } })
        } else if (item.type === 'recording') {
          if (!item.recordingId) { if (requireComplete) return null; continue }
          answers.push({ itemId: item.itemId, value: { kind: 'recording', recordingId: item.recordingId } })
        } else {
          if (item.exerciseQuestion) {
            const response = item.exerciseQuestion.questionType === 'multiple_choice'
              ? item.exerciseSelectedOptions : item.exerciseResponse.trim()
            if (typeof response === 'string' ? !response : response.length === 0) {
              if (requireComplete) return null
              continue
            }
            answers.push({ itemId: item.itemId, value: { kind: 'exercise', answeredQuestionCount: 1,
              questionResponses: [{ questionId: item.exerciseQuestion.questionId, response }] } })
            continue
          }
          if (requireComplete && getRepositoryMode() === 'cloudbase') return null
          const count = parseCount(item.answeredQuestionCount)
          if (count === null) { if (requireComplete) return null; continue }
          if (requireComplete && count < item.requiredCount) return null
          answers.push({ itemId: item.itemId, value: { kind: 'exercise', answeredQuestionCount: count } })
        }
      }
      return answers.length > 0 ? answers : null
    },
    incompleteRequirementMessage(): string {
      for (const item of this.data.completionInputs) {
        if (item.type === 'reading') {
          if (!item.readingVerified || (parseCount(item.completedPageCount) ?? 0) < item.requiredCount)
            return `请先完成“${item.title}”的阅读要求并同步进度`
        } else if (item.type === 'vocabulary') {
          if (!item.vocabularyVerified || (parseCount(item.completedWordCount) ?? 0) < item.requiredCount)
            return `请先完成“${item.title}”的单词练习并同步进度`
          if ((parseCount(item.correctWordCount) ?? 0) > (parseCount(item.completedWordCount) ?? 0))
            return `请核对“${item.title}”的首次正确词数`
        } else if (item.type === 'recording') {
          if (!item.recordingId) return `请先上传“${item.title}”的有效录音`
        } else if (item.exerciseQuestion) {
          if (item.exerciseQuestion.questionType === 'multiple_choice'
            ? item.exerciseSelectedOptions.length === 0 : !item.exerciseResponse.trim())
            return `请先完成“${item.title}”的作答`
        } else if ((parseCount(item.answeredQuestionCount) ?? 0) < item.requiredCount) {
          return `请先完成“${item.title}”的习题要求`
        }
      }
      return '请先完成全部任务要求'
    },
    invalidDraftInputMessage(): string {
      for (const item of this.data.completionInputs) {
        if (item.type === 'reading' && !item.resourceId && item.completedPageCount.trim()
          && parseCount(item.completedPageCount) === null) return `请核对“${item.title}”的完成页数`
        if (item.type === 'vocabulary' && !item.resourceId) {
          const completed = item.completedWordCount.trim() ? parseCount(item.completedWordCount) : null
          const correct = item.correctWordCount.trim() ? parseCount(item.correctWordCount) : null
          if ((item.completedWordCount.trim() && completed === null)
            || (item.correctWordCount.trim() && correct === null)
            || (completed !== null && correct !== null && correct > completed)) return `请核对“${item.title}”的完成词数`
        }
        if (item.type === 'exercise' && !item.exerciseQuestion && item.answeredQuestionCount.trim()
          && parseCount(item.answeredQuestionCount) === null) return `请核对“${item.title}”的已答题数`
      }
      return ''
    },
    async onSave() {
      const session = getSession(); const taskId = this.data.detail?.task.id
      if (!session || !taskId || this.data.saving || this.data.submitting) return
      if (!this.canEditCurrentRedo()) return
      const invalidInput = this.invalidDraftInputMessage()
      if (invalidInput) { this.setData({ writeError: `${invalidInput}，草稿尚未保存` }); return }
      const expectedVersion = this.data.detail?.submission?.version ?? 0
      let structuredAnswers: StructuredSubmissionAnswer[] | undefined
      if (this.data.completionInputs.length) {
        const collected = this.structuredAnswers(false)
        if (collected) structuredAnswers = collected
      }
      if (!structuredAnswers?.length && !this.data.answer.trim()) {
        this.setData({ writeError: '请先填写至少一项作答或学习记录，再保存草稿' }); return
      }
      const assignmentVersion = this.data.detail?.assignment.version
      const draftVersion = activeDraftRecordVersion(this.data.detail?.submission)
      const intentFingerprint = JSON.stringify({ taskId, answer: this.data.answer.trim(), expectedVersion, assignmentVersion, draftVersion, structuredAnswers })
      const draftIntent = prepareWriteIntent(this.data.draftIntent, intentFingerprint, () => createPageOperationId('save_draft'))
      this.setData({ saving: true, draftIntent, writeError: '' })
      const result = await saveDraft(session.user.id, {
        operationId: draftIntent.operationId, expectedVersion, taskId, answer: this.data.answer,
        assignmentVersion, draftVersion, structuredAnswers,
      })
      if (!result.ok) {
        this.setData({ saving: false, writeError: result.error.message })
        return
      }
      this.setData({
        saving: false, writeError: '',
        detail: this.data.detail ? {
          ...this.data.detail,
          assignment: { ...this.data.detail.assignment, version: result.data.assignmentVersion ?? this.data.detail.assignment.version },
          submission: result.data,
        } : this.data.detail,
        draftIntent: clearWriteIntent(),
        submitIntent: clearWriteIntent(),
      })
      wx.showToast({ title: '已填写内容已保存', icon: 'success' })
    },
    async onSubmit() {
      const session = getSession(); const taskId = this.data.detail?.task.id
      if (!session || !taskId || this.data.submitting || this.data.saving) return
      if (!this.canEditCurrentRedo()) return
      if (this.data.hasUnsupportedExercise) { this.setData({ writeError: '习题内容暂不可作答，请联系老师' }); return }
      let structuredAnswers: StructuredSubmissionAnswer[] | undefined
      if (this.data.completionInputs.length) {
        const collected = this.structuredAnswers(true)
        if (!collected) { this.setData({ writeError: this.incompleteRequirementMessage() }); this.jumpToFirstIncomplete(); return }
        structuredAnswers = collected
      }
      if (!this.data.completionInputs.length && !this.data.answer.trim()) { this.setData({ writeError: '请先填写本次完成情况' }); return }
      const itemCount = this.data.detail?.task.items.length ?? 0
      const confirmed = await new Promise<boolean>(resolve => wx.showModal({
        title: '确认提交作业？',
        content: `“${this.data.detail?.task.title ?? '本次作业'}”共 ${itemCount} 项，已完成 ${itemCount} 项。提交后等待老师检查，本轮作答将锁定。`,
        confirmText: '确认提交', cancelText: '继续检查',
        success: result => resolve(result.confirm), fail: () => resolve(false),
      }))
      if (!confirmed || !this.canEditCurrentRedo()) return
      const expectedVersion = this.data.detail?.submission?.version ?? 0
      const assignmentVersion = this.data.detail?.assignment.version
      const draftVersion = activeDraftRecordVersion(this.data.detail?.submission)
      const intentFingerprint = JSON.stringify({ taskId, answer: this.data.answer.trim(), expectedVersion, assignmentVersion, draftVersion, structuredAnswers })
      const submitIntent = prepareWriteIntent(this.data.submitIntent, intentFingerprint, () => createPageOperationId('submit_task'))
      this.setData({ submitting: true, submitIntent, writeError: '' })
      const result = await submitTask(session.user.id, {
        operationId: submitIntent.operationId, expectedVersion, taskId, answer: this.data.answer,
        assignmentVersion, draftVersion, structuredAnswers,
      })
      this.setData({ submitting: false }); if (!result.ok) { this.setData({ writeError: result.error.message }); return }
      this.setData({ submitIntent: clearWriteIntent(), draftIntent: clearWriteIntent(), selectedHistoryVersion: 0 })
      wx.showToast({ title: '提交成功，等待老师点评', icon: 'success' }); this.loadDetail()
    },
  },
})

function parseCount(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null
  const count = Number(value)
  return Number.isSafeInteger(count) && count >= 0 ? count : null
}
