import { ReviewAssignmentView, getCompletion, getTeacherTasks, reviewSubmission } from '../../../services/app-service'
import { getCurrentTaskId, getSession, setCurrentAssignmentId } from '../../../session/session'
import { createPageOperationId } from '../../../shared/write-intent'
import { CompletionFilter, DEFAULT_COMPLETION_FILTER, filterCompletionRows, isBatchReviewable, isCompletedSubmission, toggleCompletionSelection } from './completion-state'

interface CompletionRow extends ReviewAssignmentView {
  selected: boolean
  statusLabel: string
  statusTone: string
  scoreLabel: string
  submittedLabel: string
}

const FILTERS: ReadonlyArray<Readonly<{ key: CompletionFilter; label: string }>> = [
  { key: 'all', label: '全部' },
  { key: 'completed', label: '已完成' },
  { key: 'incomplete', label: '未完成' },
  { key: 'awaiting_review', label: '待检查' },
  { key: 'reviewed', label: '已点评' },
  { key: 'redo_required', label: '退回重做' },
]

Component({
  data: {
    loading: true,
    error: '',
    taskTitle: '当前任务',
    className: '当前授权班级',
    rows: [] as CompletionRow[],
    visibleRows: [] as CompletionRow[],
    filters: FILTERS,
    activeFilter: DEFAULT_COMPLETION_FILTER,
    keyword: '',
    completedCount: 0,
    incompleteCount: 0,
    pendingReviewCount: 0,
    completionPercent: 0,
    selectedCount: 0,
    batchReviewing: false,
    batchPreviewOpen: false,
    batchComment: '',
    batchEligibleCount: 0,
  },
  lifetimes: { attached() { this.loadCompletion() } },
  methods: {
    async loadCompletion() {
      const session = getSession()
      const taskId = getCurrentTaskId()
      if (!session || !taskId) { wx.navigateBack(); return }
      this.setData({ loading: true, error: '' })
      const [completion, tasks] = await Promise.all([getCompletion(session.user.id, taskId), getTeacherTasks(session.user.id)])
      if (!completion.ok) { this.setData({ loading: false, error: completion.error.message }); return }
      const task = tasks.ok ? tasks.data.tasks.find(item => item.id === taskId) : undefined
      const rows = completion.data.map((item): CompletionRow => ({
        ...item,
        studentNumber: item.studentNumber || '未提供',
        selected: false,
        statusLabel: statusLabel(item.status),
        statusTone: statusTone(item.status),
        scoreLabel: item.score === undefined ? '--' : String(item.score),
        submittedLabel: item.submittedAt ? formatSubmittedAt(item.submittedAt) : '尚未提交',
      }))
      const completedCount = rows.filter(isCompletedSubmission).length
      const pendingReviewCount = rows.filter(item => item.status === 'awaiting_review').length
      this.setData({
        loading: false,
        taskTitle: task?.title ?? '当前任务',
        className: rows.find(item => item.className)?.className ?? '当前授权班级',
        rows,
        selectedCount: 0,
        batchPreviewOpen: false,
        completedCount,
        incompleteCount: rows.length - completedCount,
        pendingReviewCount,
        completionPercent: rows.length ? Math.round(completedCount * 100 / rows.length) : 0,
      }, () => this.applyFilters())
    },
    chooseFilter(event: WechatMiniprogram.TouchEvent) {
      this.setData({ activeFilter: event.currentTarget.dataset.key as CompletionFilter }, () => this.applyFilters())
    },
    onSearch(event: WechatMiniprogram.Input) {
      this.setData({ keyword: event.detail.value }, () => this.applyFilters())
    },
    applyFilters() { this.setData({ visibleRows: filterCompletionRows(this.data.rows, this.data.activeFilter, this.data.keyword) }) },
    toggleSelected(event: WechatMiniprogram.TouchEvent) {
      const assignmentId = event.currentTarget.dataset.id as string
      const rows = toggleCompletionSelection(this.data.rows, assignmentId)
      const visibleRows = filterCompletionRows(rows, this.data.activeFilter, this.data.keyword)
      this.setData({ rows, visibleRows, selectedCount: rows.filter(row => row.selected).length, batchPreviewOpen: false })
    },
    openReview(event: WechatMiniprogram.TouchEvent) {
      this.openAssignment(event.currentTarget.dataset.id as string)
    },
    openAssignment(assignmentId: string) {
      const row = this.data.rows.find(item => item.assignmentId === assignmentId)
      if (!row) return
      if (!row.submissionId) {
        wx.showModal({ title: row.studentName, content: row.status === 'redo_required' ? '该学生正在按退回要求重做，暂无新的提交。' : '该学生尚未提交，暂无可查看的作业内容。', showCancel: false, confirmText: '知道了' })
        return
      }
      setCurrentAssignmentId(assignmentId)
      wx.navigateTo({ url: '/pages/teacher/review-task/review-task' })
    },
    reviewSelected() {
      const selected = this.data.rows.filter(row => row.selected)
      if (selected.length !== 1) { wx.showToast({ title: '请选择 1 位学生', icon: 'none' }); return }
      this.openAssignment(selected[0].assignmentId)
    },
    batchReview() {
      if (this.data.batchReviewing) return
      const selected = this.data.rows.filter(row => row.selected && isBatchReviewable(row))
      if (!selected.length) { wx.showToast({ title: '请先选择已提交、待点评学生', icon: 'none' }); return }
      this.setData({ batchPreviewOpen: true, batchEligibleCount: selected.length })
    },
    onBatchComment(event: WechatMiniprogram.Input) { this.setData({ batchComment: event.detail.value }) },
    closeBatchPreview() { this.setData({ batchPreviewOpen: false }) },
    confirmBatchReview() {
      if (this.data.batchReviewing) return
      const selected = this.data.rows.filter(row => row.selected && isBatchReviewable(row))
      const comment = this.data.batchComment.trim()
      if (!selected.length || !comment) { wx.showToast({ title: '请选择学生并填写评语', icon: 'none' }); return }
      wx.showModal({ title: '确认发布点评', content: `将向 ${selected.length} 位待点评学生发布这条评语，不修改已有分数。`, confirmText: '确认发布', success: async modal => {
        if (!modal.confirm) return
        const session = getSession()
        if (!session) return
        this.setData({ batchReviewing: true })
        let publishedCount = 0
        for (const row of selected) {
          const result = await reviewSubmission(session.user.id, {
            operationId: createPageOperationId('batch_review'), expectedVersion: row.submissionVersion!, taskId: row.taskId,
            assignmentId: row.assignmentId, decision: 'approved', comment,
          })
          if (!result.ok) { this.setData({ batchReviewing: false, batchPreviewOpen: false }); wx.showModal({ title: '部分点评未发布', content: `已发布 ${publishedCount}/${selected.length} 条。${result.error.message} 请刷新后选择剩余记录重试。`, showCancel: false }); this.loadCompletion(); return }
          publishedCount += 1
        }
        this.setData({ batchReviewing: false, batchPreviewOpen: false, batchComment: '' })
        wx.showToast({ title: '点评已发布', icon: 'success' })
        this.loadCompletion()
      } })
    },
  },
})

function statusLabel(status: string): string {
  if (status === 'awaiting_review') return '待点评'
  if (status === 'completed') return '已点评'
  if (status === 'redo_required') return '退回重做'
  if (status === 'overdue') return '已逾期'
  return '未完成'
}
function statusTone(status: string): string {
  if (status === 'awaiting_review') return 'warning'
  if (status === 'completed') return 'success'
  if (status === 'redo_required' || status === 'overdue') return 'danger'
  return 'neutral'
}
function formatSubmittedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '已提交'
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')} 提交`
}
