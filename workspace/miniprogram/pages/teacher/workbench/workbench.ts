import { getTeacherTasks } from '../../../services/app-service'
import { getSession, setCurrentTaskId } from '../../../session/session'

Component({
  data: { loading: true, error: '', pendingCount: 0, taskCount: 0, recentTaskTitle: '暂无已发布任务', recentTaskId: '' },
  lifetimes: { attached() { this.loadWorkbench() } },
  pageLifetimes: { show() { this.loadWorkbench() } },
  methods: {
    async loadWorkbench() {
      const session = getSession()
      if (!session) { wx.redirectTo({ url: '/pages/auth/login/login' }); return }
      const result = await getTeacherTasks(session.user.id)
      if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
      this.setData({ loading: false, pendingCount: result.data.pendingCount, taskCount: result.data.tasks.length, recentTaskTitle: result.data.tasks[0]?.title ?? '暂无已发布任务', recentTaskId: result.data.tasks[0]?.id ?? '' })
    },
    goCenter() { wx.navigateTo({ url: '/pages/teacher/task-center/task-center' }) },
    goPublish() { wx.navigateTo({ url: '/pages/teacher/publish-task/publish-task' }) },
    goReview() {
      if (!this.data.recentTaskId) { wx.showToast({ title: '暂无可点评任务', icon: 'none' }); return }
      setCurrentTaskId(this.data.recentTaskId)
      wx.navigateTo({ url: '/pages/teacher/completion/completion' })
    },
  },
})
