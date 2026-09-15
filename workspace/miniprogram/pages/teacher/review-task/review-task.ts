import { ReviewAssignmentView, getCompletion, reviewSubmission } from '../../../services/app-service'
import { getCurrentTaskId, getSession } from '../../../session/session'
import { EMPTY_WRITE_INTENT, WriteIntentState, createPageOperationId, prepareWriteIntent } from '../../../shared/write-intent'

Component({
  data: {
    loading: true,
    error: '',
    taskId: '',
    rows: [] as ReviewAssignmentView[],
    comment: '完成得很好，继续保持！',
    score: 90,
    reviewingId: '',
    reviewIntents: {} as Record<string, WriteIntentState>,
  },
  lifetimes: {
    attached() { this.setData({ taskId: getCurrentTaskId() }); this.loadRows() },
  },
  methods: {
    async loadRows() {
      const session = getSession()
      if (!session || !this.data.taskId) return
      const result = await getCompletion(session.user.id, this.data.taskId)
      if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
      this.setData({ loading: false, rows: result.data })
    },
    onComment(event: WechatMiniprogram.Input) {
      this.setData({ comment: event.detail.value, reviewIntents: {} })
    },
    onScore(event: WechatMiniprogram.Input) {
      this.setData({ score: Number(event.detail.value), reviewIntents: {} })
    },
    async publishReview(row: ReviewAssignmentView, decision: 'approved' | 'returned') {
      const session = getSession()
      if (!session || !row.submissionId || row.submissionVersion === undefined || this.data.reviewingId) return
      const intentKey = `${row.assignmentId}:${decision}`
      const intentFingerprint = JSON.stringify({ taskId: this.data.taskId, assignmentId: row.assignmentId, submissionId: row.submissionId, submissionVersion: row.submissionVersion, decision, score: this.data.score, comment: this.data.comment.trim() })
      const currentIntent = this.data.reviewIntents[intentKey] ?? EMPTY_WRITE_INTENT
      const reviewIntent = prepareWriteIntent(currentIntent, intentFingerprint, () => createPageOperationId('publish_review'))
      this.setData({ reviewingId: row.assignmentId, reviewIntents: { ...this.data.reviewIntents, [intentKey]: reviewIntent } })
      const result = await reviewSubmission(session.user.id, {
        operationId: reviewIntent.operationId,
        expectedVersion: row.submissionVersion,
        taskId: this.data.taskId,
        assignmentId: row.assignmentId,
        decision,
        score: this.data.score,
        comment: this.data.comment,
      })
      this.setData({ reviewingId: '' })
      if (!result.ok) { wx.showToast({ title: result.error.message, icon: 'none' }); return }
      this.setData({ reviewIntents: {} })
      wx.showToast({ title: decision === 'approved' ? '点评已发布' : '已退回重做', icon: 'success' })
      this.loadRows()
    },
    async approve(event: WechatMiniprogram.TouchEvent) {
      await this.publishReview(event.currentTarget.dataset.row as ReviewAssignmentView, 'approved')
    },
    async returned(event: WechatMiniprogram.TouchEvent) {
      await this.publishReview(event.currentTarget.dataset.row as ReviewAssignmentView, 'returned')
    },
  },
})
