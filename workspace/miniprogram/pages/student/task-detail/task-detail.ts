import { TaskDetailView } from '../../../domain/types'
import { getTaskDetail, saveDraft, submitTask } from '../../../services/app-service'
import { getCurrentTaskId, getSession } from '../../../session/session'
import { assignmentStatusLabel } from '../../../shared/assignment-status'
import { EMPTY_WRITE_INTENT, WriteIntentState, clearWriteIntent, createPageOperationId, prepareWriteIntent } from '../../../shared/write-intent'

Component({
  data: {
    loading: true,
    error: '',
    detail: null as TaskDetailView | null,
    statusLabel: '',
    answer: '',
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
      this.setData({ loading: false, detail: result.data, statusLabel: assignmentStatusLabel(result.data.assignment.status), answer: result.data.submission?.answers[0]?.value ?? '' })
    },
    onAnswer(event: WechatMiniprogram.Input) {
      this.setData({ answer: event.detail.value, draftIntent: clearWriteIntent(), submitIntent: clearWriteIntent() })
    },
    async onSave() {
      const session = getSession(); const taskId = this.data.detail?.task.id
      if (!session || !taskId || this.data.saving) return
      const expectedVersion = this.data.detail?.submission?.version ?? 0
      const intentFingerprint = JSON.stringify({ taskId, answer: this.data.answer.trim(), expectedVersion })
      const draftIntent = prepareWriteIntent(this.data.draftIntent, intentFingerprint, () => createPageOperationId('save_draft'))
      this.setData({ saving: true, draftIntent })
      const result = await saveDraft(session.user.id, { operationId: draftIntent.operationId, expectedVersion, taskId, answer: this.data.answer })
      if (!result.ok) {
        this.setData({ saving: false })
        wx.showToast({ title: result.error.message, icon: 'none' })
        return
      }
      this.setData({
        saving: false,
        detail: this.data.detail ? { ...this.data.detail, submission: result.data } : this.data.detail,
        draftIntent: clearWriteIntent(),
        submitIntent: clearWriteIntent(),
      })
      wx.showToast({ title: '草稿已保存', icon: 'success' })
    },
    async onSubmit() {
      const session = getSession(); const taskId = this.data.detail?.task.id
      if (!session || !taskId || this.data.submitting) return
      if (!this.data.answer.trim()) { wx.showToast({ title: '请填写学习记录', icon: 'none' }); return }
      const expectedVersion = this.data.detail?.submission?.version ?? 0
      const intentFingerprint = JSON.stringify({ taskId, answer: this.data.answer.trim(), expectedVersion })
      const submitIntent = prepareWriteIntent(this.data.submitIntent, intentFingerprint, () => createPageOperationId('submit_task'))
      this.setData({ submitting: true, submitIntent })
      const result = await submitTask(session.user.id, { operationId: submitIntent.operationId, expectedVersion, taskId, answer: this.data.answer })
      this.setData({ submitting: false }); if (!result.ok) { wx.showToast({ title: result.error.message, icon: 'none' }); return }
      this.setData({ submitIntent: clearWriteIntent(), draftIntent: clearWriteIntent() })
      wx.showToast({ title: '提交成功，等待老师点评', icon: 'success' }); this.loadDetail()
    },
  },
})
