import { Task } from '../../../domain/types'
import { getTeacherTasks } from '../../../services/app-service'
import { getSession, setCurrentTaskId } from '../../../session/session'

interface TeacherTaskRow extends Task {
  progressPercent: number
  pendingReviewCount: number
}

Component({
  data: { loading: true, error: '', tasks: [] as TeacherTaskRow[], pendingCount: 0 },
  lifetimes: { attached() { this.loadTasks() } },
  pageLifetimes: { show() { this.loadTasks() } },
  methods: {
    async loadTasks() {
      const session = getSession()
      if (!session) { wx.redirectTo({ url: '/pages/auth/login/login' }); return }
      this.setData({ loading: true, error: '' })
      const result = await getTeacherTasks(session.user.id)
      if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
      const tasks = result.data.tasks.map((task) => ({ ...task, progressPercent: result.data.progressByTask[task.id] ?? 0, pendingReviewCount: result.data.pendingByTask[task.id] ?? 0 }))
      this.setData({ loading: false, tasks, pendingCount: result.data.pendingCount })
    },
    publish() { wx.navigateTo({ url: '/pages/teacher/publish-task/publish-task' }) },
    focusTasks() { wx.pageScrollTo({ selector: '#teacher-task-list', duration: 280 }) },
    quickReview() {
      const task = this.data.tasks[0]
      if (!task) { wx.showToast({ title: '暂无可点评任务', icon: 'none' }); return }
      setCurrentTaskId(task.id)
      wx.navigateTo({ url: '/pages/teacher/completion/completion' })
    },
    review(event: WechatMiniprogram.TouchEvent) {
      setCurrentTaskId(event.currentTarget.dataset.id as string)
      wx.navigateTo({ url: '/pages/teacher/completion/completion' })
    },
  },
})
