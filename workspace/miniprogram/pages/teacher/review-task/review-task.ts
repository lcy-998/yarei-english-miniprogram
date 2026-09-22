import { ReviewAssignmentView, getCompletion, reviewSubmission } from '../../../services/app-service'
import { getCurrentAssignmentId, getCurrentTaskId, getSession } from '../../../session/session'
import { EMPTY_WRITE_INTENT, WriteIntentState, createPageOperationId, prepareWriteIntent } from '../../../shared/write-intent'

Component({
  data: {
    loading: true,
    error: '',
    taskId: '',
    rows: [] as ReviewAssignmentView[],
    baseRows: [] as ReviewAssignmentView[],
    visibleRows: [] as ReviewAssignmentView[],
    activeRow: null as ReviewAssignmentView | null,
    activeRowId: '',
    activeRowIndex: 0,
    classPreview: 'class_grade3_2',
    classOptions: [{ id: 'class_grade3_2', label: '三年级 2 班', count: 6 }, { id: 'class_grade4_1', label: '四年级 1 班', count: 0 }],
    quickPhrases: ['完成得很好', '继续保持', '注意细节'],
    starValues: [1, 2, 3, 4, 5],
    voiceRecorded: false,
    comment: '完成得很好，继续保持！',
    score: 80,
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
      const requestedAssignmentId = getCurrentAssignmentId()
      const requestedIndex = result.data.findIndex(item => item.assignmentId === requestedAssignmentId)
      const firstIndex = requestedIndex >= 0 ? requestedIndex : Math.max(0, result.data.findIndex(item => item.status === 'awaiting_review'))
      const activeRow = result.data[firstIndex] ?? null
      this.setData({ loading: false, rows: result.data, baseRows: result.data, visibleRows: result.data, activeRow, activeRowId: activeRow?.assignmentId ?? '', activeRowIndex: firstIndex })
    },
    onComment(event: WechatMiniprogram.Input) {
      this.setData({ comment: event.detail.value, reviewIntents: {} })
    },
    onScore(event: WechatMiniprogram.Input) {
      this.setData({ score: Number(event.detail.value), reviewIntents: {} })
    },
    setScore(event: WechatMiniprogram.TouchEvent) { this.setData({ score: Number(event.currentTarget.dataset.score), reviewIntents: {} }) },
    usePhrase(event: WechatMiniprogram.TouchEvent) { this.setData({ comment: event.currentTarget.dataset.phrase as string, reviewIntents: {} }) },
    toggleVoice() { this.setData({ voiceRecorded: !this.data.voiceRecorded }) },
    selectClassPreview(event: WechatMiniprogram.TouchEvent) {
      const id = event.currentTarget.dataset.id as string
      const visibleRows = id === 'class_grade4_1' ? [] : this.data.baseRows
      const activeRow = visibleRows[0] ?? null
      this.setData({ classPreview: id, visibleRows, rows: visibleRows, activeRow, activeRowId: activeRow?.assignmentId ?? '', activeRowIndex: 0 })
    },
    selectRow(event: WechatMiniprogram.TouchEvent) {
      const index = Number(event.currentTarget.dataset.index)
      const activeRow = this.data.visibleRows[index] ?? null
      this.setData({ activeRow, activeRowId: activeRow?.assignmentId ?? '', activeRowIndex: index })
    },
    skipCurrent() {
      if (!this.data.visibleRows.length) return
      const nextIndex = (this.data.activeRowIndex + 1) % this.data.visibleRows.length
      const activeRow = this.data.visibleRows[nextIndex] ?? null
      this.setData({ activeRow, activeRowId: activeRow?.assignmentId ?? '', activeRowIndex: nextIndex })
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
      this.setData({ reviewIntents: {}, voiceRecorded: false })
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
