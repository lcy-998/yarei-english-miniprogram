import { TaskDetailView } from '../../../domain/types'
import { listStudentTasks } from '../../../services/app-service'
import { getSession, setCurrentTaskId } from '../../../session/session'

type TaskFilter = 'all' | 'active' | 'completed'

Component({
  data: { loading: true, error: '', allTasks: [] as TaskDetailView[], tasks: [] as TaskDetailView[], currentFilter: 'all' as TaskFilter, activeCount: 0, completedCount: 0 },
  lifetimes: { attached() { this.loadTasks() } },
  pageLifetimes: { show() { this.loadTasks() } },
  methods: {
    async loadTasks() {
      const session = getSession()
      if (!session) { wx.redirectTo({ url: '/pages/auth/login/login' }); return }
      this.setData({ loading: true, error: '' })
      const result = await listStudentTasks(session.user.id)
      if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
      const activeCount = result.data.filter((item) => item.assignment.status !== 'completed').length
      const completedCount = result.data.length - activeCount
      this.setData({ loading: false, allTasks: result.data, tasks: result.data, activeCount, completedCount })
    },
    setFilter(event: WechatMiniprogram.TouchEvent) {
      const currentFilter = event.currentTarget.dataset.filter as TaskFilter
      const tasks = this.data.allTasks.filter((item) => currentFilter === 'all' || (currentFilter === 'completed' ? item.assignment.status === 'completed' : item.assignment.status !== 'completed'))
      this.setData({ currentFilter, tasks })
    },
    openTask(event: WechatMiniprogram.TouchEvent) {
      setCurrentTaskId(event.currentTarget.dataset.id as string)
      wx.navigateTo({ url: '/pages/student/task-detail/task-detail' })
    },
  },
})
