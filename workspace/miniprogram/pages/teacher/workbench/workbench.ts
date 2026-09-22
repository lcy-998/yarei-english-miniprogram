import { AssignmentStatus } from '../../../domain/types'
import { getCompletion, getTeacherTasks } from '../../../services/app-service'
import { getSession, setCurrentTaskId } from '../../../session/session'
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
    selectedClass: '全部负责班级',
    classFilterOpen: false,
    suppressClose: false,
    classOptions: ['全部负责班级', '三年级 2 班', '四年级 1 班'],
  },
  lifetimes: { attached() { this.loadWorkbench() } },
  pageLifetimes: { show() { this.loadWorkbench() } },
  methods: {
    async loadWorkbench() {
      const session = getSession()
      if (!session) { wx.redirectTo({ url: '/pages/auth/login/login' }); return }
      this.setData({ loading: true, error: '' })
      const result = await getTeacherTasks(session.user.id)
      if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
      const recentTask = result.data.tasks.find((item) => item.status === 'active') ?? result.data.tasks[0]
      let authorizedStudentCount = 0
      let submittedCount = 0
      if (recentTask) {
        const completion = await getCompletion(session.user.id, recentTask.id)
        if (!completion.ok) { this.setData({ loading: false, error: completion.error.message }); return }
        const summary = summarizeAssignments(completion.data.map((item) => ({ status: item.status as AssignmentStatus })))
        authorizedStudentCount = completion.data.length
        submittedCount = summary.completedCount
      }
      this.setData({
        loading: false,
        pendingCount: result.data.pendingCount,
        pendingCommentCount: recentTask ? result.data.pendingByTask[recentTask.id] ?? 0 : 0,
        taskCount: result.data.tasks.length,
        activeClassroomCount: result.data.tasks.filter((item) => item.status === 'active').length,
        activityCount: 0,
        authorizedStudentCount,
        submittedCount,
        taskProgress: recentTask ? result.data.progressByTask[recentTask.id] ?? 0 : 0,
        recentTaskTitle: recentTask?.title ?? '暂无已发布任务',
        recentTaskId: recentTask?.id ?? '',
      })
    },
    goCenter() { wx.navigateTo({ url: '/pages/teacher/task-center/task-center' }) },
    goCheckTasks() { wx.navigateTo({ url: '/pages/teacher/task-review-list/task-review-list' }) },
    goPublish() { wx.navigateTo({ url: '/pages/teacher/publish-task/publish-task' }) },
    goReview() {
      if (!this.data.recentTaskId) { wx.showToast({ title: '暂无可点评任务', icon: 'none' }); return }
      setCurrentTaskId(this.data.recentTaskId)
      wx.navigateTo({ url: '/pages/teacher/completion/completion' })
    },
    closeClassFilter() { if (this.data.suppressClose) { this.setData({ suppressClose: false }); return } this.setData({ classFilterOpen: false }) },
    toggleClassFilter() { this.setData({ classFilterOpen: !this.data.classFilterOpen, suppressClose: true }) },
    selectClass(event: WechatMiniprogram.TouchEvent) { this.setData({ selectedClass: event.currentTarget.dataset.className as string, classFilterOpen: false, suppressClose: true }) },
    openFuture(event: WechatMiniprogram.TouchEvent) {
      const label = event.currentTarget.dataset.label as string
      wx.showToast({ title: `${label}将在后续里程碑开放`, icon: 'none' })
    },
  },
})
