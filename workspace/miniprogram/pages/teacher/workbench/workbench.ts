import { AssignmentStatus } from '../../../domain/types'
import { getCompletion, getTeacherTasks, getTeacherWorkbench, listTeacherStudents } from '../../../services/app-service'
import { getSession, setCurrentAssignmentId, setCurrentTaskId } from '../../../session/session'
import { summarizeAssignments } from '../../../shared/dashboard-summary'

Component({
  data: {
    loading: true,
    error: '',
    pendingCount: 0,
    pendingCommentCount: 0,
    taskCount: 0,
    activeClassroomCount: 0,
    activityCount: 0,
    authorizedStudentCount: 0,
    submittedCount: 0,
    taskProgress: 0,
    recentTaskTitle: '暂无已发布任务',
    recentTaskId: '',
    recentTaskClassName: '',
    teacherName: '',
    quickReviewTaskId: '',
    selectedClass: '全部负责班级',
    selectedClassId: '',
    classFilterOpen: false,
    suppressClose: false,
    classOptions: [{ id: '', name: '全部负责班级' }] as Array<{ id: string; name: string }>,
  },
  lifetimes: { attached() { this.loadWorkbench() } },
  pageLifetimes: { show() { this.loadWorkbench() } },
  methods: {
    async loadWorkbench() {
      const session = getSession()
      if (!session) { wx.redirectTo({ url: '/pages/auth/login/login' }); return }
      this.setData({ loading: true, error: '' })
      const today = new Date()
      const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
      const [result, studentPage, overview] = await Promise.all([getTeacherTasks(session.user.id), listTeacherStudents(session.user.id, { status: 'all' }), getTeacherWorkbench(session.user.id, localDate, this.data.selectedClassId || undefined)])
      if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
      if (!overview.ok) { this.setData({ loading: false, error: overview.error.message }); return }
      const classOptions = [{ id: '', name: '全部负责班级' }, ...(studentPage.ok ? studentPage.data.classes : [])]
      const tasks = this.data.selectedClassId ? result.data.tasks.filter(item => item.classIds?.includes(this.data.selectedClassId) ?? item.classId === this.data.selectedClassId) : result.data.tasks
      const recentTask = tasks.find((item) => item.id === overview.data.recentTasks[0]?.taskId) ?? tasks.find((item) => item.status === 'active') ?? tasks[0]
      const quickReviewTask = tasks.find((item) => (result.data.pendingByTask[item.id] ?? 0) > 0)
      let authorizedStudentCount = 0
      let submittedCount = 0
      if (recentTask) {
        const completion = await getCompletion(session.user.id, recentTask.id)
        if (!completion.ok) { this.setData({ loading: false, error: completion.error.message }); return }
        const scopedCompletion = this.data.selectedClassId ? completion.data.filter(item => item.className === this.data.selectedClass) : completion.data
        const summary = summarizeAssignments(scopedCompletion.map((item) => ({ status: item.status as AssignmentStatus })))
        authorizedStudentCount = scopedCompletion.length
        submittedCount = summary.completedCount
      }
      this.setData({
        loading: false,
        pendingCount: overview.data.pendingReviewCount,
        pendingCommentCount: overview.data.pendingCommentCount,
        taskCount: tasks.length,
        activeClassroomCount: overview.data.activeTaskCount,
        activityCount: 0,
        authorizedStudentCount,
        submittedCount,
        taskProgress: recentTask ? result.data.progressByTask[recentTask.id] ?? 0 : 0,
        recentTaskTitle: recentTask?.title ?? '暂无已发布任务',
        recentTaskId: recentTask?.id ?? '',
        recentTaskClassName: classOptions.find(item => item.id === recentTask?.classId)?.name ?? '当前授权班级',
        teacherName: session.user.displayName,
        classOptions,
        quickReviewTaskId: quickReviewTask?.id ?? '',
      })
    },
    goCenter() { wx.navigateTo({ url: '/pages/teacher/task-center/task-center' }) },
    goCheckTasks() { wx.navigateTo({ url: '/pages/teacher/task-review-list/task-review-list' }) },
    goPublish() { wx.navigateTo({ url: '/pages/teacher/publish-task/publish-task' }) },
    goReview() {
      setCurrentTaskId(this.data.quickReviewTaskId || '')
      setCurrentAssignmentId('')
      wx.navigateTo({ url: '/pages/teacher/review-task/review-task' })
    },
    goRecentTask() { if (!this.data.recentTaskId) return; setCurrentTaskId(this.data.recentTaskId); wx.navigateTo({ url: '/pages/teacher/completion/completion' }) },
    closeClassFilter() { if (this.data.suppressClose) { this.setData({ suppressClose: false }); return } this.setData({ classFilterOpen: false }) },
    toggleClassFilter() { this.setData({ classFilterOpen: !this.data.classFilterOpen, suppressClose: true }) },
    selectClass(event: WechatMiniprogram.TouchEvent) { const selectedClassId = event.currentTarget.dataset.classId as string; const selectedClass = this.data.classOptions.find(item => item.id === selectedClassId)?.name ?? '全部负责班级'; this.setData({ selectedClassId, selectedClass, classFilterOpen: false, suppressClose: true }, () => this.loadWorkbench()) },
    openFuture(event: WechatMiniprogram.TouchEvent) {
      const label = event.currentTarget.dataset.label as string
      wx.showToast({ title: `${label}将在后续里程碑开放`, icon: 'none' })
    },
  },
})
