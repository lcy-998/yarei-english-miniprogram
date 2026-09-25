import { TaskDetailView } from '../../../domain/types'
import { canSubmitAssignment } from '../../../domain/task-rules'
import { StructuredSubmissionAnswer, getTaskDetail, getVocabularyProgress, saveDraft, submitTask } from '../../../services/app-service'
import { getReadingProgress } from '../../../services/m1-app-service'
import { getRepositoryMode } from '../../../repositories/repository-factory'
import { getCurrentTaskId, getSession, setCurrentBookId } from '../../../session/session'
import { assignmentStatusLabel } from '../../../shared/assignment-status'
import { activeDraftRecordVersion } from '../../../shared/submission-draft'
import { formatTaskDueAt } from '../../../shared/task-schedule'
import { EMPTY_WRITE_INTENT, WriteIntentState, clearWriteIntent, createPageOperationId, prepareWriteIntent } from '../../../shared/write-intent'

interface CompletionInput {
  itemId: string
  resourceId?: string
  type: 'reading' | 'vocabulary' | 'exercise'
  title: string
  requiredCount: number
  readingVerified: boolean
  vocabularyVerified: boolean
  completedPageCount: string
  completedWordCount: string
  correctWordCount: string
  answeredQuestionCount: string
}

Component({
  data: {
    loading: true,
    error: '',
    detail: null as TaskDetailView | null,
    statusLabel: '',
    dueLabel: '',
    historyEntries: [] as Array<{ version: number; statusLabel: string; submittedLabel: string }>,
    readingSyncError: '',
    vocabularySyncError: '',
    redoDueLabel: '',
    redoExpired: false,
    editable: false,
    hasUnsupportedExercise: false,
    answer: '',
    completionInputs: [] as CompletionInput[],
    saving: false,
    submitting: false,
    draftIntent: EMPTY_WRITE_INTENT as WriteIntentState,
    submitIntent: EMPTY_WRITE_INTENT as WriteIntentState,
  },
  lifetimes: { attached() { this.loadDetail() } },
  pageLifetimes: { show() { this.refreshReadingCompletion(); this.refreshVocabularyCompletion(); this.refreshRedoWindow() } },
  methods: {
    async loadDetail() {
      const session = getSession(); const taskId = getCurrentTaskId()
      if (!session || !taskId) { wx.navigateBack(); return }
      this.setData({ loading: true, error: '' })
      const result = await getTaskDetail(session.user.id, taskId)
      if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
      const answers = new Map(result.data.submission?.answers.map(item => [item.taskItemId, item.structuredValue]) ?? [])
      const completionInputs = result.data.task.items.flatMap((item): CompletionInput[] => {
        const rule = item.completionRuleData
        if (!rule) return []
        const previous = answers.get(item.id)
        const requiredCount = rule.kind === 'reading_pages'
          ? rule.requiredPageCount
          : rule.kind === 'vocabulary_words' ? rule.requiredWordCount : rule.requiredQuestionCount
        return [{
          itemId: item.id,
          ...(item.resourceId === undefined ? {} : { resourceId: item.resourceId }),
          type: item.type,
          title: item.title,
          requiredCount,
          readingVerified: !item.resourceId,
          vocabularyVerified: !item.resourceId,
          completedPageCount: previous?.kind === 'reading' ? String(previous.completedPageCount) : '',
          completedWordCount: previous?.kind === 'vocabulary' ? String(previous.completedWordCount) : '',
          correctWordCount: previous?.kind === 'vocabulary' ? String(previous.correctWordCount) : '',
          answeredQuestionCount: previous?.kind === 'exercise' ? String(previous.answeredQuestionCount) : '',
        }]
      })
      const learningRecord = result.data.submission?.answers.find(item => item.structuredValue === undefined)?.value ?? ''
      const assignment = result.data.assignment
      const redoWindow = assignment.status === 'redo_required' || Boolean(assignment.redoDueAt)
      const redoExpired = redoWindow && !canSubmitAssignment(assignment, new Date().toISOString())
      this.setData({
        loading: false, detail: result.data, completionInputs,
        statusLabel: assignment.status === 'in_progress' && assignment.redoDueAt ? '重做中' : assignmentStatusLabel(assignment.status),
        dueLabel: formatTaskDueAt(result.data.task.dueAt),
        historyEntries: (result.data.submissionHistory ?? []).map(item => ({ version: item.version,
          statusLabel: item.status === 'reviewed' ? '已点评' : item.status === 'returned' ? '退回重做' : '待检查',
          submittedLabel: formatTaskDueAt(item.submittedAt) })),
        redoDueLabel: assignment.redoDueAt ? formatTaskDueAt(assignment.redoDueAt) : '',
        redoExpired,
        editable: assignment.status !== 'awaiting_review' && assignment.status !== 'completed' && !redoExpired,
        hasUnsupportedExercise: getRepositoryMode() === 'cloudbase' && completionInputs.some(item => item.type === 'exercise'),
        answer: learningRecord,
      }, () => { this.refreshReadingCompletion(); this.refreshVocabularyCompletion() })
    },
    refreshRedoWindow() {
      const assignment = this.data.detail?.assignment
      if (!assignment) return
      const redoWindow = assignment.status === 'redo_required' || Boolean(assignment.redoDueAt)
      const redoExpired = redoWindow && !canSubmitAssignment(assignment, new Date().toISOString())
      this.setData({ redoExpired, editable: assignment.status !== 'awaiting_review' && assignment.status !== 'completed' && !redoExpired })
    },
    canEditCurrentRedo(): boolean {
      const assignment = this.data.detail?.assignment
      if (!assignment) return false
      if (assignment.status === 'awaiting_review' || assignment.status === 'completed') return false
      if ((assignment.status === 'redo_required' || assignment.redoDueAt) && !canSubmitAssignment(assignment, new Date().toISOString())) {
        this.setData({ redoExpired: true, editable: false })
        wx.showToast({ title: '重做期限已过，无法提交', icon: 'none' })
        return false
      }
      return true
    },
    async refreshReadingCompletion() {
      const session = getSession()
      if (!session || !this.data.detail) return
      const readingItems = this.data.completionInputs.filter(item => item.type === 'reading' && item.resourceId)
      if (!readingItems.length) return
      const progress = await Promise.all(readingItems.map(async item => ({ itemId: item.itemId, result: await getReadingProgress(session.user.id, item.resourceId!) })))
      const pageCounts = new Map(progress.flatMap(item => item.result.ok && item.result.data.hasSavedProgress ? [[item.itemId, item.result.data.pageNumber] as const] : []))
      this.setData({ readingSyncError: progress.some(item => !item.result.ok) ? '阅读进度同步失败，已保留当前内容' : '', completionInputs: this.data.completionInputs.map(item => {
        if (item.type !== 'reading' || !item.resourceId) return item
        const pageNumber = pageCounts.get(item.itemId)
        return pageNumber === undefined ? { ...item, readingVerified: false } : { ...item, completedPageCount: String(Math.min(pageNumber, item.requiredCount)), readingVerified: true }
      }) })
    },
    async refreshVocabularyCompletion() {
      const session = getSession()
      if (!session || !this.data.detail) return
      const vocabularyItems = this.data.completionInputs.filter(item => item.type === 'vocabulary' && item.resourceId)
      if (!vocabularyItems.length) return
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
    openVocabulary(event: WechatMiniprogram.TouchEvent) {
      const item = this.data.detail?.task.items.find(candidate => candidate.id === event.currentTarget.dataset.id)
      if (!item?.resourceId) { wx.showToast({ title: '单词资源暂不可用', icon: 'none' }); return }
      wx.navigateTo({ url: `/pages/student/vocabulary/vocabulary?packId=${encodeURIComponent(item.resourceId)}` })
    },
    openReading(event: WechatMiniprogram.TouchEvent) {
      const itemId = event.currentTarget.dataset.id as string
      const item = this.data.detail?.task.items.find(candidate => candidate.id === itemId)
      if (!item?.resourceId) { wx.showToast({ title: '阅读资源暂不可用', icon: 'none' }); return }
      const taskId = this.data.detail?.task.id ?? ''
      const requiredCount = item.completionRuleData?.kind === 'reading_pages' ? item.completionRuleData.requiredPageCount : 0
      setCurrentBookId(item.resourceId)
      wx.navigateTo({ url: `/pages/student/reading-detail/reading-detail?bookId=${encodeURIComponent(item.resourceId)}&taskId=${encodeURIComponent(taskId)}&requiredPageCount=${requiredCount}` })
    },
    onAnswer(event: WechatMiniprogram.Input) {
      this.setData({ answer: event.detail.value, draftIntent: clearWriteIntent(), submitIntent: clearWriteIntent() })
    },
    onCompletionInput(event: WechatMiniprogram.Input) {
      const itemId = event.currentTarget.dataset.id as string
      if (this.data.completionInputs.some(item => item.itemId === itemId && item.resourceId && (item.type === 'reading' || item.type === 'vocabulary'))) return
      const field = event.currentTarget.dataset.field as keyof Pick<CompletionInput, 'completedPageCount' | 'completedWordCount' | 'correctWordCount' | 'answeredQuestionCount'>
      this.setData({
        completionInputs: this.data.completionInputs.map(item => item.itemId === itemId ? { ...item, [field]: event.detail.value } : item),
        draftIntent: clearWriteIntent(),
        submitIntent: clearWriteIntent(),
      })
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
        } else {
          if (requireComplete && getRepositoryMode() === 'cloudbase') return null
          const count = parseCount(item.answeredQuestionCount)
          if (count === null) { if (requireComplete) return null; continue }
          if (requireComplete && count < item.requiredCount) return null
          answers.push({ itemId: item.itemId, value: { kind: 'exercise', answeredQuestionCount: count } })
        }
      }
      return answers.length > 0 ? answers : null
    },
    async onSave() {
      const session = getSession(); const taskId = this.data.detail?.task.id
      if (!session || !taskId || this.data.saving) return
      if (!this.canEditCurrentRedo()) return
      const expectedVersion = this.data.detail?.submission?.version ?? 0
      let structuredAnswers: StructuredSubmissionAnswer[] | undefined
      if (this.data.completionInputs.length) {
        const collected = this.structuredAnswers(false)
        if (!collected) { wx.showToast({ title: '请至少填写一项完成数据', icon: 'none' }); return }
        structuredAnswers = collected
      }
      const assignmentVersion = this.data.detail?.assignment.version
      const draftVersion = activeDraftRecordVersion(this.data.detail?.submission)
      const intentFingerprint = JSON.stringify({ taskId, answer: this.data.answer.trim(), expectedVersion, assignmentVersion, draftVersion, structuredAnswers })
      const draftIntent = prepareWriteIntent(this.data.draftIntent, intentFingerprint, () => createPageOperationId('save_draft'))
      this.setData({ saving: true, draftIntent })
      const result = await saveDraft(session.user.id, {
        operationId: draftIntent.operationId, expectedVersion, taskId, answer: this.data.answer,
        assignmentVersion, draftVersion, structuredAnswers,
      })
      if (!result.ok) {
        this.setData({ saving: false })
        wx.showToast({ title: result.error.message, icon: 'none' })
        return
      }
      this.setData({
        saving: false,
        detail: this.data.detail ? {
          ...this.data.detail,
          assignment: { ...this.data.detail.assignment, version: result.data.assignmentVersion ?? this.data.detail.assignment.version },
          submission: result.data,
        } : this.data.detail,
        draftIntent: clearWriteIntent(),
        submitIntent: clearWriteIntent(),
      })
      wx.showToast({ title: '草稿已保存', icon: 'success' })
    },
    async onSubmit() {
      const session = getSession(); const taskId = this.data.detail?.task.id
      if (!session || !taskId || this.data.submitting) return
      if (!this.canEditCurrentRedo()) return
      if (this.data.hasUnsupportedExercise) { wx.showToast({ title: '习题作答将在后续里程碑开放', icon: 'none' }); return }
      let structuredAnswers: StructuredSubmissionAnswer[] | undefined
      if (this.data.completionInputs.length) {
        const collected = this.structuredAnswers(true)
        if (!collected) { wx.showToast({ title: '请按要求填写完整完成数据', icon: 'none' }); return }
        structuredAnswers = collected
      }
      if (!this.data.completionInputs.length && !this.data.answer.trim()) { wx.showToast({ title: '请填写学习记录', icon: 'none' }); return }
      const expectedVersion = this.data.detail?.submission?.version ?? 0
      const assignmentVersion = this.data.detail?.assignment.version
      const draftVersion = activeDraftRecordVersion(this.data.detail?.submission)
      const intentFingerprint = JSON.stringify({ taskId, answer: this.data.answer.trim(), expectedVersion, assignmentVersion, draftVersion, structuredAnswers })
      const submitIntent = prepareWriteIntent(this.data.submitIntent, intentFingerprint, () => createPageOperationId('submit_task'))
      this.setData({ submitting: true, submitIntent })
      const result = await submitTask(session.user.id, {
        operationId: submitIntent.operationId, expectedVersion, taskId, answer: this.data.answer,
        assignmentVersion, draftVersion, structuredAnswers,
      })
      this.setData({ submitting: false }); if (!result.ok) { wx.showToast({ title: result.error.message, icon: 'none' }); return }
      this.setData({ submitIntent: clearWriteIntent(), draftIntent: clearWriteIntent() })
      wx.showToast({ title: '提交成功，等待老师点评', icon: 'success' }); this.loadDetail()
    },
  },
})

function parseCount(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null
  const count = Number(value)
  return Number.isSafeInteger(count) && count >= 0 ? count : null
}
