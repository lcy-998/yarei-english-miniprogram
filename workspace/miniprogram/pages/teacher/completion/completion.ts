import { ReviewAssignmentView, getCompletion, getReviewSubmission, getTeacherTasks, previewBatchComment, publishBatchComment, reviewSubmission } from '../../../services/app-service'
import { getRepositoryMode } from '../../../repositories/repository-factory'
import { getCurrentTaskId, getSession, setCurrentAssignmentId } from '../../../session/session'
import { createPageOperationId } from '../../../shared/write-intent'
import { CompletionFilter, DEFAULT_COMPLETION_FILTER, filterCompletionRows, isBatchReviewable, isCompletedSubmission, requiresIndividualReview, scoreCaption, selectedBatchCounts, toggleCompletionSelection } from './completion-state'

interface CompletionRow extends ReviewAssignmentView {
  selected: boolean
  statusLabel: string
  statusTone: string
  scoreLabel: string
  scoreCaption: string
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
    selectedBatchCandidateCount: 0,
    selectedExcludedCount: 0,
    batchReviewing: false,
    batchPreviewOpen: false,
    batchComment: '',
    batchEligibleCount: 0,
    batchExcludedCount: 0,
    batchChecking: false,
  },
  lifetimes: { attached() { this.loadCompletion() } },
  methods: {
    async loadCompletion(preserveSelection = false) {
      const session = getSession()
      const taskId = getCurrentTaskId()
      if (!session || !taskId) { wx.navigateBack(); return }
      this.setData({ loading: true, error: '' })
      const [completion, tasks] = await Promise.all([getCompletion(session.user.id, taskId), getTeacherTasks(session.user.id)])
      if (!completion.ok) { this.setData({ loading: false, error: completion.error.message }); return }
      const task = tasks.ok ? tasks.data.tasks.find(item => item.id === taskId) : undefined
      const previouslySelected = preserveSelection ? new Set(this.data.rows.filter(row => row.selected).map(row => row.assignmentId)) : new Set<string>()
      const rows = completion.data.map((item): CompletionRow => ({
        ...item,
        studentNumber: item.studentNumber || '未提供',
        selected: previouslySelected.has(item.assignmentId),
        statusLabel: statusLabel(item.status),
        statusTone: statusTone(item.status),
        scoreLabel: item.score === undefined ? '--' : String(item.score),
        scoreCaption: scoreCaption(item),
        submittedLabel: item.submittedAt ? formatSubmittedAt(item.submittedAt) : '尚未提交',
      }))
      const completedCount = rows.filter(isCompletedSubmission).length
      const pendingReviewCount = rows.filter(item => item.status === 'awaiting_review').length
      const selectedCounts = selectedBatchCounts(rows)
      this.setData({
        loading: false,
        taskTitle: task?.title ?? '当前任务',
        className: rows.find(item => item.className)?.className ?? '当前授权班级',
        rows,
        selectedCount: selectedCounts.selected,
        selectedBatchCandidateCount: selectedCounts.candidates,
        selectedExcludedCount: selectedCounts.excluded,
        batchPreviewOpen: false,
        batchEligibleCount: 0,
        batchExcludedCount: 0,
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
      const counts = selectedBatchCounts(rows)
      this.setData({ rows, visibleRows, selectedCount: counts.selected, selectedBatchCandidateCount: counts.candidates,
        selectedExcludedCount: counts.excluded, batchPreviewOpen: false })
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
      if (this.data.batchReviewing || this.data.batchChecking) return
      const counts = selectedBatchCounts(this.data.rows)
      if (!counts.selected) { wx.showToast({ title: '请先选择学生', icon: 'none' }); return }
      if (!counts.candidates) {
        wx.showModal({ title: '暂无可一键点评的作业', content: '所选学生尚未提交、已点评或正在重做。请选择待点评提交，其他作业可逐人查看。', showCancel: false })
        return
      }
      if (counts.candidates > 100) {
        wx.showModal({ title: '请缩小批量范围', content: '一次最多预览 100 份待点评作业。请取消部分勾选后再试。', showCancel: false })
        return
      }
      this.setData({ batchPreviewOpen: true, batchEligibleCount: counts.candidates, batchExcludedCount: counts.excluded })
    },
    onBatchComment(event: WechatMiniprogram.Input) { this.setData({ batchComment: event.detail.value }) },
    closeBatchPreview() { this.setData({ batchPreviewOpen: false }) },
    async confirmBatchReview() {
      if (this.data.batchReviewing || this.data.batchChecking) return
      const selected = this.data.rows.filter(row => row.selected && isBatchReviewable(row))
      const comment = this.data.batchComment.trim()
      if (!selected.length || !comment) { wx.showToast({ title: '请选择学生并填写评语', icon: 'none' }); return }
      if (comment.length > 200) { wx.showToast({ title: '评语最多 200 字', icon: 'none' }); return }
      const session = getSession()
      if (!session) return
      this.setData({ batchChecking: true })
      if (getRepositoryMode() === 'memory') {
        await this.confirmMemoryBatch(session.user.id, selected, comment)
        return
      }
      const taskId = getCurrentTaskId()
      if (!taskId) { this.setData({ batchChecking: false }); return }
      const preview = await previewBatchComment(session.user.id, taskId, selected.map(row => row.submissionId!), comment)
      this.setData({ batchChecking: false })
      if (!preview.ok) {
        wx.showModal({ title: '预览失败', content: `${preview.error.message} 请刷新完成情况后重试，评语已保留。`, showCancel: false })
        return
      }
      const excludedCount = this.data.selectedExcludedCount + preview.data.excludedCount
      this.setData({ batchEligibleCount: preview.data.eligibleCount, batchExcludedCount: excludedCount })
      if (!preview.data.eligibleCount) {
        wx.showModal({ title: '没有可批量点评的作业', content: '所选提交目前均不符合批量点评条件；含人工评分的作业请逐人检查。评语已保留。', showCancel: false })
        return
      }
      wx.showModal({ title: '确认发布点评', content: `将向 ${preview.data.eligibleCount} 位学生发布统一评语；另有 ${excludedCount} 位不参与。分数不由本次批量操作填写。`, confirmText: '确认发布', success: async modal => {
        if (!modal.confirm) return
        this.setData({ batchReviewing: true })
        const result = await publishBatchComment(session.user.id, preview.data.previewToken, preview.data.previewVersion,
          comment, createPageOperationId('batch_review'))
        this.setData({ batchReviewing: false })
        if (!result.ok) {
          wx.showModal({ title: '发布结果需核对', content: `${result.error.message} 请刷新列表核对后重新预览，评语已保留。`, showCancel: false })
          await this.loadCompletion(true)
          return
        }
        this.setData({ batchPreviewOpen: false, batchComment: '' })
        wx.showModal({ title: '点评已发布', content: `本次已发布 ${result.data.reviewedCount} 条点评。${excludedCount ? `另有 ${excludedCount} 位未参与，可逐人检查。` : ''}`, showCancel: false })
        await this.loadCompletion()
      } })
    },
    async confirmMemoryBatch(userId: string, selected: CompletionRow[], comment: string) {
      const eligible: CompletionRow[] = []
      let excluded = this.data.selectedExcludedCount
      for (const row of selected) {
        const detail = await getReviewSubmission(userId, row.submissionId!)
        if (!detail.ok || detail.data.submissionVersion !== row.submissionVersion || requiresIndividualReview(detail.data)) {
          excluded += 1
        } else eligible.push(row)
      }
      this.setData({ batchChecking: false, batchEligibleCount: eligible.length, batchExcludedCount: excluded })
      if (!eligible.length) {
        wx.showModal({ title: '请逐人检查评分', content: '所选作业需要人工评分、版本已变化或详情读取失败；请刷新后逐人检查。评语已保留。', showCancel: false })
        return
      }
      wx.showModal({ title: '确认发布点评', content: `将向 ${eligible.length} 位学生发布统一评语；另有 ${excluded} 位不参与。`, confirmText: '确认发布', success: async modal => {
        if (!modal.confirm) return
        this.setData({ batchReviewing: true })
        let publishedCount = 0
        for (const row of eligible) {
          const result = await reviewSubmission(userId, {
            operationId: createPageOperationId('batch_review'), expectedVersion: row.submissionVersion!, taskId: row.taskId,
            assignmentId: row.assignmentId, decision: 'approved', comment,
          })
          if (!result.ok) {
            this.setData({ batchReviewing: false })
            wx.showModal({ title: '部分点评未发布', content: `已发布 ${publishedCount}/${eligible.length} 条，未发布从 ${row.studentName} 开始。${result.error.message} 请刷新列表后只选择仍待点评的学生重试；评语已保留。`, showCancel: false })
            await this.loadCompletion(true)
            return
          }
          publishedCount += 1
        }
        this.setData({ batchReviewing: false, batchPreviewOpen: false, batchComment: '' })
        wx.showModal({ title: '点评已发布', content: `本次已发布 ${publishedCount} 条点评。${excluded ? `另有 ${excluded} 位未参与。` : ''}`, showCancel: false })
        await this.loadCompletion()
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
