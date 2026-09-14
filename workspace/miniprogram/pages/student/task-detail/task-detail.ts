import { TaskDetailView } from '../../../domain/types'
import { getTaskDetail, saveDraft, submitTask } from '../../../services/app-service'
import { getCurrentTaskId, getSession } from '../../../session/session'
import { assignmentStatusLabel } from '../../../shared/assignment-status'

Component({
  data: { loading: true, error: '', detail: null as TaskDetailView | null, statusLabel: '', answer: '', saving: false, submitting: false },
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
    onAnswer(event: WechatMiniprogram.Input) { this.setData({ answer: event.detail.value }) },
    async onSave() {
      const session = getSession(); const taskId = this.data.detail?.task.id
      if (!session || !taskId || this.data.saving) return
      this.setData({ saving: true }); const result = await saveDraft(session.user.id, taskId, this.data.answer)
      this.setData({ saving: false }); wx.showToast({ title: result.ok ? '草稿已保存' : result.error.message, icon: result.ok ? 'success' : 'none' })
    },
    async onSubmit() {
      const session = getSession(); const taskId = this.data.detail?.task.id
      if (!session || !taskId || this.data.submitting) return
      if (!this.data.answer.trim()) { wx.showToast({ title: '请填写学习记录', icon: 'none' }); return }
      this.setData({ submitting: true }); const result = await submitTask(session.user.id, taskId, this.data.answer)
      this.setData({ submitting: false }); if (!result.ok) { wx.showToast({ title: result.error.message, icon: 'none' }); return }
      wx.showToast({ title: '提交成功，等待老师点评', icon: 'success' }); this.loadDetail()
    },
  },
})
