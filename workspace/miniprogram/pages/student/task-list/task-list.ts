import { TaskDetailView } from '../../../domain/types'
import { listStudentTasks } from '../../../services/app-service'
import { getSession, setCurrentTaskId } from '../../../session/session'
import { assignmentStatusLabel } from '../../../shared/assignment-status'

type TaskFilter = 'all' | 'active' | 'completed'
interface StudentTaskListItem extends TaskDetailView { key: string; statusLabel: string }

Component({
  data: { loading: true, error: '', allTasks: [] as StudentTaskListItem[], tasks: [] as StudentTaskListItem[], currentFilter: 'all' as TaskFilter, activeCount: 0, completedCount: 0 },
  lifetimes: { attached() { this.loadTasks() } },
  pageLifetimes: { show() { this.loadTasks() } },
  methods: {
    async loadTasks() {
      const session = getSession()
      if (!session) { wx.redirectTo({ url: '/pages/auth/login/login' }); return }
      this.setData({ loading: true, error: '' })
      const result = await listStudentTasks(session.user.id)
      if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
      const tasks = result.data.map((item) => ({ ...item, key: item.task.id, statusLabel: assignmentStatusLabel(item.assignment.status) }))
      const activeCount = tasks.filter((item) => item.assignment.status !== 'completed').length
      const completedCount = tasks.length - activeCount
      this.setData({ loading: false, allTasks: tasks, tasks, activeCount, completedCount })
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
