import { ReviewAssignmentView, getCompletion, getReviewSubmission, getTeacherTasks, previewTeacherTask, reviewSubmission } from '../../../services/app-service'
import { getCurrentAssignmentId, getCurrentTaskId, getSession, setCurrentTaskId } from '../../../session/session'
import { EMPTY_WRITE_INTENT, WriteIntentState, createPageOperationId, prepareWriteIntent } from '../../../shared/write-intent'
import { TeacherSubmissionAnswer, TeacherSubmissionDetailRow, TeacherTaskItemSummary, teacherSubmissionDetails } from '../../../shared/teacher-submission-detail'
import { ReviewTaskOption, currentReviewTaskFirst, filterReviewRowsByClass, parseReviewScoreInput, reviewClassOptions, reviewTaskOptions, selectReviewRows, selectedReviewTaskId } from './review-task-state'

Component({
  data: {
    loading: true,
    error: '',
    taskId: '',
    taskOptions: [] as ReviewTaskOption[],
    orderedTaskOptions: [] as ReviewTaskOption[],
    rows: [] as ReviewAssignmentView[],
    baseRows: [] as ReviewAssignmentView[],
    visibleRows: [] as ReviewAssignmentView[],
    activeRow: null as ReviewAssignmentView | null,
    activeRowId: '',
    activeRowIndex: 0,
    readOnlyMode: false,
    openedFromAssignment: false,
    publishedFeedback: null as { decision: 'approved' | 'returned'; score: number | null; textComment: string | null; returnReason: string | null } | null,
    taskTitle: '',
    submittedLabel: '',
    taskItems: [] as TeacherTaskItemSummary[],
    activeAnswers: [] as TeacherSubmissionAnswer[],
    detailRows: [] as TeacherSubmissionDetailRow[],
    detailExpanded: false,
    taskItemsLoading: false,
    submissionLoading: false,
    taskItemsError: '',
    submissionError: '',
    classFilter: 'all',
    classOptions: [] as Array<{ id: string; label: string; count: number }>,
    quickPhrases: ['完成得很好', '继续保持', '注意细节'],
    starValues: [1, 2, 3, 4, 5],
    comment: '',
    score: null as number | null,
    scoreInput: '',
    scoreError: '',
    reviewingId: '',
    reviewIntents: {} as Record<string, WriteIntentState>,
  },
  lifetimes: {
    attached() { this.setData({ taskId: getCurrentTaskId() }); this.loadRows() },
  },
  methods: {
    async loadRows() {
      const session = getSession()
      if (!session) return
      this.setData({ loading: true, error: '' })
      const tasks = await getTeacherTasks(session.user.id)
      const requestedAssignmentId = getCurrentAssignmentId()
      const openedFromAssignment = Boolean(requestedAssignmentId)
      if (!tasks.ok && !openedFromAssignment) { this.setData({ loading: false, error: tasks.error.message }); return }
      const taskOptions = tasks.ok ? reviewTaskOptions(tasks.data.tasks, tasks.data.pendingByTask) : []
      const taskId = openedFromAssignment ? this.data.taskId : selectedReviewTaskId(taskOptions, this.data.taskId)
      if (!taskId) {
        if (!openedFromAssignment) setCurrentTaskId('')
        this.setData({ loading: false, taskId: '', taskOptions, orderedTaskOptions: [], rows: [], baseRows: [], visibleRows: [], activeRow: null, activeRowId: '', activeRowIndex: 0, taskTitle: '', classOptions: [], classFilter: 'all', openedFromAssignment: false, readOnlyMode: false, publishedFeedback: null, taskItems: [], activeAnswers: [], detailRows: [], detailExpanded: false, taskItemsLoading: false, submissionLoading: false, submittedLabel: '', comment: '', score: null, scoreInput: '', scoreError: '', reviewIntents: {} })
        return
      }
      const result = await getCompletion(session.user.id, taskId)
      if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
      const selection = selectReviewRows(result.data, requestedAssignmentId)
      const rows = selection.rows
      const classOptions = reviewClassOptions(rows)
      const classFilter = !openedFromAssignment && taskId === this.data.taskId && classOptions.some(option => option.id === this.data.classFilter) ? this.data.classFilter : 'all'
      const visibleRows = filterReviewRowsByClass(rows, classFilter)
      const firstIndex = classFilter === 'all' ? selection.activeIndex : 0
      const activeRow = visibleRows[firstIndex] ?? null
      const task = tasks.ok ? tasks.data.tasks.find(item => item.id === taskId) : undefined
      setCurrentTaskId(taskId)
      this.setData({ loading: false, taskId, taskOptions, orderedTaskOptions: currentReviewTaskFirst(taskOptions, taskId), rows: visibleRows, baseRows: rows, visibleRows, activeRow, activeRowId: activeRow?.assignmentId ?? '', activeRowIndex: firstIndex, readOnlyMode: selection.readOnlyMode, openedFromAssignment, publishedFeedback: null, taskTitle: task?.title ?? '', classOptions, classFilter, taskItems: [], activeAnswers: [], detailRows: [], detailExpanded: false, taskItemsError: '', submissionError: '', taskItemsLoading: Boolean(task), submissionLoading: Boolean(activeRow), comment: '', score: null, scoreInput: '', scoreError: '' }, () => {
        if (task) this.loadTaskItems(taskId, task.version)
        else this.setData({ taskItemsError: '任务内容快照不可用，请返回列表重试。' })
        this.loadActiveSubmission()
      })
    },
    async loadTaskItems(taskId: string, version: number) {
      const session = getSession()
      if (!session) return
      const result = await previewTeacherTask(session.user.id, taskId, version)
      if (this.data.taskId !== taskId) return
      if (!result.ok) { this.setData({ taskItemsLoading: false, taskItemsError: result.error.message }); return }
      this.setData({ taskItemsLoading: false, taskItems: result.data.items.map(item => ({ id: item.id, title: item.title, type: item.type, completionRule: item.completionRule })) }, () => this.refreshDetailRows())
    },
    refreshDetailRows() {
      this.setData({ detailRows: teacherSubmissionDetails(this.data.taskItems, this.data.activeAnswers) })
    },
    async loadActiveSubmission() {
      const session = getSession()
      const row = this.data.activeRow
      const taskId = this.data.taskId
      if (!session || !row?.submissionId) { this.setData({ activeAnswers: [], detailRows: [], submittedLabel: '', publishedFeedback: null, submissionLoading: false }); return }
      const result = await getReviewSubmission(session.user.id, row.submissionId)
      if (this.data.taskId !== taskId || this.data.activeRowId !== row.assignmentId) return
      if (!result.ok) { this.setData({ activeAnswers: [], detailRows: [], submittedLabel: '提交详情读取失败', submissionLoading: false, submissionError: result.error.message }); return }
      this.setData({
        taskTitle: result.data.taskTitle,
        submittedLabel: result.data.submittedAt ? new Date(result.data.submittedAt).toLocaleString('zh-CN') : '提交时间未提供',
        activeAnswers: result.data.answers,
        publishedFeedback: result.data.feedback ? { decision: result.data.feedback.decision, score: result.data.feedback.score, textComment: result.data.feedback.textComment, returnReason: result.data.feedback.returnReason } : null,
        submissionLoading: false,
        submissionError: '',
      }, () => this.refreshDetailRows())
    },
    onComment(event: WechatMiniprogram.Input) {
      this.setData({ comment: event.detail.value, reviewIntents: {} })
    },
    onScore(event: WechatMiniprogram.Input) {
      const parsed = parseReviewScoreInput(event.detail.value)
      this.setData({ score: parsed.score, scoreInput: parsed.input, scoreError: parsed.error, reviewIntents: {} })
    },
    setScore(event: WechatMiniprogram.TouchEvent) {
      const parsed = parseReviewScoreInput(String(event.currentTarget.dataset.score))
      this.setData({ score: parsed.score, scoreInput: parsed.input, scoreError: parsed.error, reviewIntents: {} })
    },
    clearScore() { this.setData({ score: null, scoreInput: '', scoreError: '', reviewIntents: {} }) },
    usePhrase(event: WechatMiniprogram.TouchEvent) { this.setData({ comment: event.currentTarget.dataset.phrase as string, reviewIntents: {} }) },
    confirmDraftSwitch(next: () => void) {
      if (this.data.reviewingId) return
      if (!this.data.comment.trim() && !this.data.scoreInput.trim()) { next(); return }
      wx.showModal({ title: '放弃当前点评？', content: '未发布的评语和评分会丢失。', confirmText: '放弃', cancelText: '继续编辑', success: result => { if (result.confirm) next() } })
    },
    selectTask(event: WechatMiniprogram.TouchEvent) {
      const taskId = event.currentTarget.dataset.id as string
      if (!this.data.taskOptions.some(option => option.id === taskId)) return
      if (taskId === this.data.taskId) return
      this.confirmDraftSwitch(() => this.setData({ taskId, classFilter: 'all', comment: '', score: null, scoreInput: '', scoreError: '', reviewIntents: {} }, () => this.loadRows()))
    },
    selectClassFilter(event: WechatMiniprogram.TouchEvent) {
      const id = event.currentTarget.dataset.id as string
      if (id === this.data.classFilter) return
      const visibleRows = filterReviewRowsByClass(this.data.baseRows, id)
      const activeRow = visibleRows[0] ?? null
      this.confirmDraftSwitch(() => this.setData({ classFilter: id, visibleRows, rows: visibleRows, activeRow, activeRowId: activeRow?.assignmentId ?? '', activeRowIndex: 0, readOnlyMode: Boolean(activeRow && activeRow.status !== 'awaiting_review'), publishedFeedback: null, activeAnswers: [], detailRows: [], detailExpanded: false, submissionError: '', submissionLoading: Boolean(activeRow), comment: '', score: null, scoreInput: '', scoreError: '', reviewIntents: {} }, () => this.loadActiveSubmission()))
    },
    selectRow(event: WechatMiniprogram.TouchEvent) {
      const index = Number(event.currentTarget.dataset.index)
      const activeRow = this.data.visibleRows[index] ?? null
      if (!activeRow || activeRow.assignmentId === this.data.activeRowId) return
      this.confirmDraftSwitch(() => this.setData({ activeRow, activeRowId: activeRow.assignmentId, activeRowIndex: index, readOnlyMode: activeRow.status !== 'awaiting_review', publishedFeedback: null, activeAnswers: [], detailRows: [], detailExpanded: false, submissionError: '', submissionLoading: true, comment: '', score: null, scoreInput: '', scoreError: '', reviewIntents: {} }, () => this.loadActiveSubmission()))
    },
    skipCurrent() {
      if (this.data.visibleRows.length < 2) return
      const nextIndex = (this.data.activeRowIndex + 1) % this.data.visibleRows.length
      const activeRow = this.data.visibleRows[nextIndex] ?? null
      this.confirmDraftSwitch(() => this.setData({ activeRow, activeRowId: activeRow?.assignmentId ?? '', activeRowIndex: nextIndex, readOnlyMode: Boolean(activeRow && activeRow.status !== 'awaiting_review'), publishedFeedback: null, activeAnswers: [], detailRows: [], detailExpanded: false, submissionError: '', submissionLoading: Boolean(activeRow), comment: '', score: null, scoreInput: '', scoreError: '', reviewIntents: {} }, () => this.loadActiveSubmission()))
    },
    openDetail() {
      if (!this.data.activeRow) return
      this.setData({ detailExpanded: !this.data.detailExpanded })
    },
    async publishReview(row: ReviewAssignmentView, decision: 'approved' | 'returned') {
      const session = getSession()
      if (!session || this.data.reviewingId) return
      if (!row.submissionId || row.submissionVersion === undefined || row.status !== 'awaiting_review') {
        wx.showToast({ title: '请选择一条待点评提交', icon: 'none' })
        return
      }
      if (this.data.scoreError) { wx.showToast({ title: this.data.scoreError, icon: 'none' }); return }
      if (decision === 'returned' && !this.data.comment.trim()) {
        wx.showToast({ title: '退回重做必须填写原因', icon: 'none' })
        return
      }
      if (decision === 'approved' && !this.data.comment.trim() && this.data.score === null) {
        wx.showToast({ title: '请先填写评语或评分', icon: 'none' })
        return
      }
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
        ...(this.data.score === null ? {} : { score: this.data.score }),
        comment: this.data.comment,
      })
      this.setData({ reviewingId: '' })
      if (!result.ok) { wx.showToast({ title: result.error.message, icon: 'none' }); return }
      this.setData({ reviewIntents: {}, comment: '', score: null, scoreInput: '', scoreError: '' })
      wx.showToast({ title: decision === 'approved' ? '点评已发布' : '已退回重做', icon: 'success' })
      this.loadRows()
    },
    async approve() {
      if (this.data.activeRow) await this.publishReview(this.data.activeRow, 'approved')
    },
    async returned() {
      if (this.data.activeRow) await this.publishReview(this.data.activeRow, 'returned')
    },
  },
})
