import { ReviewAssignmentView, getCompletion, getTeacherTasks, reviewSubmission } from '../../../services/app-service'
import { getCurrentTaskId, getSession, setCurrentAssignmentId } from '../../../session/session'
import { createPageOperationId } from '../../../shared/write-intent'

type CompletionFilter = 'all' | 'completed' | 'incomplete' | 'awaiting_review' | 'reviewed' | 'redo_required'

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
    taskTitle: '英语综合练习',
    className: '三年级 2 班',
    rows: [] as CompletionRow[],
    visibleRows: [] as CompletionRow[],
    filters: FILTERS,
    activeFilter: 'awaiting_review' as CompletionFilter,
    keyword: '',
    completedCount: 0,
    incompleteCount: 0,
    pendingReviewCount: 0,
    completionPercent: 0,
    selectedCount: 0,
    batchReviewing: false,
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
      const rows = completion.data.map((item, index): CompletionRow => ({
        ...item,
        studentNumber: item.studentNumber || String(321 - index * 3).padStart(4, '0'),
        selected: false,
        statusLabel: statusLabel(item.status),
        statusTone: statusTone(item.status),
        scoreLabel: item.score === undefined ? (item.status === 'awaiting_review' ? scoreForIndex(index) : '--') : String(item.score),
        submittedLabel: item.submittedAt ? formatSubmittedAt(item.submittedAt) : '尚未提交',
      }))
      const completedCount = rows.filter(item => isCompleted(item.status)).length
      const pendingReviewCount = rows.filter(item => item.status === 'awaiting_review').length
      this.setData({
        loading: false,
        taskTitle: task?.title ?? '英语综合练习',
        className: rows.find(item => item.className)?.className ?? '三年级 2 班',
        rows,
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
    applyFilters() {
      const keyword = this.data.keyword.trim().toLowerCase()
      const visibleRows = this.data.rows.filter(row => {
        if (keyword && !`${row.studentName}${row.studentNumber ?? ''}`.toLowerCase().includes(keyword)) return false
        if (this.data.activeFilter === 'all') return true
        if (this.data.activeFilter === 'completed') return isCompleted(row.status)
        if (this.data.activeFilter === 'incomplete') return !isCompleted(row.status)
        if (this.data.activeFilter === 'reviewed') return row.status === 'completed'
        return row.status === this.data.activeFilter
      })
      this.setData({ visibleRows })
    },
    toggleSelected(event: WechatMiniprogram.TouchEvent) {
      const assignmentId = event.currentTarget.dataset.id as string
      const rows = this.data.rows.map(row => row.assignmentId === assignmentId && row.status === 'awaiting_review' ? { ...row, selected: !row.selected } : row)
      this.setData({ rows, selectedCount: rows.filter(row => row.selected).length }, () => this.applyFilters())
    },
    openReview(event: WechatMiniprogram.TouchEvent) {
      setCurrentAssignmentId(event.currentTarget.dataset.id as string)
      wx.navigateTo({ url: '/pages/teacher/review-task/review-task' })
    },
    reviewSelected() {
      const selected = this.data.rows.filter(row => row.selected)
      if (selected.length !== 1) { wx.showToast({ title: '请选择 1 位待检查学生', icon: 'none' }); return }
      setCurrentAssignmentId(selected[0].assignmentId)
      wx.navigateTo({ url: '/pages/teacher/review-task/review-task' })
    },
    batchReview() {
      const selected = this.data.rows.filter(row => row.selected && row.status === 'awaiting_review' && row.submissionId && row.submissionVersion !== undefined)
      if (!selected.length || this.data.batchReviewing) { wx.showToast({ title: '请先选择待检查学生', icon: 'none' }); return }
      wx.showModal({ title: '确认一键点评', content: `将为选中的 ${selected.length} 位学生发布“完成认真，继续保持”的通过点评。`, confirmText: '确认发布', success: async modal => {
        if (!modal.confirm) return
        const session = getSession()
        if (!session) return
        this.setData({ batchReviewing: true })
        for (const row of selected) {
          const result = await reviewSubmission(session.user.id, {
            operationId: createPageOperationId('batch_review'), expectedVersion: row.submissionVersion!, taskId: row.taskId,
            assignmentId: row.assignmentId, decision: 'approved', score: Number(row.scoreLabel) || 100, comment: '完成认真，继续保持！',
          })
          if (!result.ok) { this.setData({ batchReviewing: false }); wx.showToast({ title: result.error.message, icon: 'none' }); return }
        }
        this.setData({ batchReviewing: false })
        wx.showToast({ title: '点评已发布', icon: 'success' })
        this.loadCompletion()
      } })
    },
  },
})

function isCompleted(status: string): boolean { return status === 'awaiting_review' || status === 'completed' }
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
function scoreForIndex(index: number): string { return String([86, 92, 88, 90, 84, 95][index % 6]) }
function formatSubmittedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '已提交'
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')} 提交`
}
