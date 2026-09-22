import { TaskDetailView } from '../../../domain/types'
import { StructuredSubmissionAnswer, getTaskDetail, saveDraft, submitTask } from '../../../services/app-service'
import { getCurrentTaskId, getSession } from '../../../session/session'
import { assignmentStatusLabel } from '../../../shared/assignment-status'
import { EMPTY_WRITE_INTENT, WriteIntentState, clearWriteIntent, createPageOperationId, prepareWriteIntent } from '../../../shared/write-intent'

interface CompletionInput {
  itemId: string
  type: 'reading' | 'vocabulary' | 'exercise'
  title: string
  requiredCount: number
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
    answer: '',
    completionInputs: [] as CompletionInput[],
    saving: false,
    submitting: false,
    draftIntent: EMPTY_WRITE_INTENT as WriteIntentState,
    submitIntent: EMPTY_WRITE_INTENT as WriteIntentState,
  },
  lifetimes: { attached() { this.loadDetail() } },
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
          type: item.type,
          title: item.title,
          requiredCount,
          completedPageCount: previous?.kind === 'reading' ? String(previous.completedPageCount) : '',
          completedWordCount: previous?.kind === 'vocabulary' ? String(previous.completedWordCount) : '',
          correctWordCount: previous?.kind === 'vocabulary' ? String(previous.correctWordCount) : '',
          answeredQuestionCount: previous?.kind === 'exercise' ? String(previous.answeredQuestionCount) : '',
        }]
      })
      const learningRecord = result.data.submission?.answers.find(item => item.structuredValue === undefined)?.value ?? ''
      this.setData({ loading: false, detail: result.data, completionInputs, statusLabel: assignmentStatusLabel(result.data.assignment.status), answer: learningRecord })
    },
    onAnswer(event: WechatMiniprogram.Input) {
      this.setData({ answer: event.detail.value, draftIntent: clearWriteIntent(), submitIntent: clearWriteIntent() })
    },
    onCompletionInput(event: WechatMiniprogram.Input) {
      const itemId = event.currentTarget.dataset.id as string
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
          const count = parseCount(item.completedPageCount)
          if (count === null) { if (requireComplete) return null; continue }
          if (requireComplete && count < item.requiredCount) return null
          answers.push({ itemId: item.itemId, value: { kind: 'reading', completedPageCount: count } })
        } else if (item.type === 'vocabulary') {
          const completed = parseCount(item.completedWordCount)
          const correct = parseCount(item.correctWordCount)
          if (completed === null || correct === null) { if (requireComplete) return null; continue }
          if (correct > completed || (requireComplete && completed < item.requiredCount)) return null
          answers.push({ itemId: item.itemId, value: { kind: 'vocabulary', completedWordCount: completed, correctWordCount: correct } })
        } else {
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
      const expectedVersion = this.data.detail?.submission?.version ?? 0
      let structuredAnswers: StructuredSubmissionAnswer[] | undefined
      if (this.data.completionInputs.length) {
        const collected = this.structuredAnswers(false)
        if (!collected) { wx.showToast({ title: '请至少填写一项完成数据', icon: 'none' }); return }
        structuredAnswers = collected
      }
      const assignmentVersion = this.data.detail?.assignment.version
      const draftVersion = this.data.detail?.submission?.recordVersion
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
      let structuredAnswers: StructuredSubmissionAnswer[] | undefined
      if (this.data.completionInputs.length) {
        const collected = this.structuredAnswers(true)
        if (!collected) { wx.showToast({ title: '请按要求填写完整完成数据', icon: 'none' }); return }
        structuredAnswers = collected
      }
      if (!this.data.completionInputs.length && !this.data.answer.trim()) { wx.showToast({ title: '请填写学习记录', icon: 'none' }); return }
      const expectedVersion = this.data.detail?.submission?.version ?? 0
      const assignmentVersion = this.data.detail?.assignment.version
      const draftVersion = this.data.detail?.submission?.recordVersion
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
