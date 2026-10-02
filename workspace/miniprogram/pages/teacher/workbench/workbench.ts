import { getTeacherWorkbench, listTeacherStudents, listNotifications, listTeacherActivities } from '../../../services/app-service'
import { getSession, setCurrentAssignmentId, setCurrentTaskId } from '../../../session/session'

Component({
  data: {
    loading: true,
    loadVersion: 0,
    error: '',
    noticeCount: 0,
    pendingCount: 0,
    pendingCommentCount: 0,
    taskCount: 0,
    activeClassroomCount: 0,
    activityCount: '—' as number | string,
    authorizedStudentCount: 0,
    submittedCount: 0,
    taskProgress: 0,
    recentTaskTitle: '暂无已发布任务',
    recentTaskId: '',
    recentTaskClassName: '',
    teacherName: '',
    greeting: '你好',
    classUpdateText: '当前暂无可显示的任务动态',
    quickReviewTaskId: '',
    selectedClass: '全部负责班级',
    selectedClassId: '',
    classFilterOpen: false,
    suppressClose: false,
    classOptions: [{ id: '', name: '全部负责班级' }] as Array<{ id: string; name: string }>,
  },
  pageLifetimes: { show() { this.loadWorkbench() } },
  methods: {
    async loadWorkbench() {
      const session = getSession()
      if (!session) { wx.redirectTo({ url: '/pages/auth/login/login' }); return }
      const loadVersion = this.data.loadVersion + 1
      const selectedClassId = this.data.selectedClassId
      this.setData({ loading: true, error: '', loadVersion })
      const today = new Date()
      const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
      const [studentPage, overview] = await Promise.all([
        listTeacherStudents(session.user.id, { status: 'active' }),
        getTeacherWorkbench(session.user.id, localDate, selectedClassId || undefined),
      ])
      if (loadVersion !== this.data.loadVersion) return
      if (!overview.ok) { this.setData({ loading: false, error: overview.error.message }); return }
      const classOptions = [{ id: '', name: '全部负责班级' }, ...(studentPage.ok ? studentPage.data.classes : [])]
      const recentTask = overview.data.recentTasks[0]
      const recentClassIds = recentTask?.classIds ?? []
      const recentTaskClassName = selectedClassId
        ? classOptions.find(item => item.id === selectedClassId)?.name ?? '当前班级'
        : recentClassIds.length > 1 ? `${recentClassIds.length} 个负责班级`
          : classOptions.find(item => item.id === recentClassIds[0])?.name ?? '当前授权班级'
      const quickReviewTask = overview.data.recentTasks.find(item => item.pendingReviewCount > 0)
      const submittedCount = recentTask?.completedCount ?? 0
      const authorizedStudentCount = recentTask?.totalCount ?? 0
      const hour = today.getHours()
      const greeting = hour < 11 ? '上午好' : hour < 14 ? '中午好' : hour < 19 ? '下午好' : '晚上好'
      this.setData({
        loading: false,
        noticeCount: 0,
        pendingCount: overview.data.pendingReviewCount,
        pendingCommentCount: overview.data.pendingCommentCount,
        taskCount: overview.data.activeTaskCount,
        activeClassroomCount: overview.data.activeTaskCount,
        activityCount: '—',
        authorizedStudentCount,
        submittedCount,
        taskProgress: recentTask && recentTask.totalCount > 0
          ? Math.round(recentTask.completedCount * 100 / recentTask.totalCount) : 0,
        recentTaskTitle: recentTask?.title ?? '暂无进行中的任务',
        recentTaskId: recentTask?.taskId ?? '',
        recentTaskClassName,
        classUpdateText: recentTask
          ? `${recentTaskClassName}最近任务已提交 ${submittedCount}/${authorizedStudentCount}`
          : '当前暂无可显示的任务动态',
        teacherName: session.user.displayName,
        greeting,
        classOptions,
        quickReviewTaskId: quickReviewTask?.taskId ?? '',
      })
      void listNotifications(session.user.id, 'all', 0, 1).then(notices => {
        if (loadVersion === this.data.loadVersion) this.setData({ noticeCount: notices.ok ? notices.data.unreadCount : 0 })
      }).catch(() => {})
      void listTeacherActivities(session.user.id).then(activities => {
        if (loadVersion !== this.data.loadVersion) return
        this.setData({ activityCount: activities.ok ? activities.data.filter(item => item.status === 'published'
          && item.schedule.startsOn <= localDate && item.schedule.endsOn >= localDate
          && (!selectedClassId || item.schedule.classId === selectedClassId)).length : '—' })
      }).catch(() => {})
    },
    goCenter() { wx.navigateTo({ url: '/pages/teacher/task-center/task-center' }) },
    goStats() { wx.navigateTo({ url: '/pages/teacher/learning-stats/learning-stats' }) },
    goActivities() { wx.navigateTo({ url: '/pages/teacher/checkin-activities/checkin-activities' }) },
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
  },
})
