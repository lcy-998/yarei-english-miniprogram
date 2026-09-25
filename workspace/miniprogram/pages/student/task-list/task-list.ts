import { TaskDetailView } from '../../../domain/types'
import { listStudentTasks } from '../../../services/app-service'
import { getSession, setCurrentTaskId } from '../../../session/session'
import { assignmentStatusLabel } from '../../../shared/assignment-status'
import { formatTaskDueAt } from '../../../shared/task-schedule'

type TaskFilter = 'pending' | 'review' | 'completed' | 'overdue_redo' | 'all'
type TimeRange = '30' | '90' | 'all'
interface StudentTaskListItem extends TaskDetailView { key: string; statusLabel: string; dueLabel: string }

Component({
  data: { loading: true, error: '', allTasks: [] as StudentTaskListItem[], tasks: [] as StudentTaskListItem[], currentFilter: 'pending' as TaskFilter,
    timeRange: '30' as TimeRange, totalVisibleCount: 0, pendingCount: 0, reviewCount: 0, completedCount: 0, overdueRedoCount: 0 },
  lifetimes: { attached() { this.loadTasks() } },
  pageLifetimes: { show() { this.loadTasks() } },
  methods: {
    async loadTasks() {
      const session = getSession()
      if (!session) { wx.redirectTo({ url: '/pages/auth/login/login' }); return }
      this.setData({ loading: true, error: '' })
      const result = await listStudentTasks(session.user.id)
      if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
      const tasks = result.data.map((item) => ({ ...item, key: item.task.id, statusLabel: item.assignment.status === 'in_progress' && item.assignment.redoDueAt ? '重做中' : assignmentStatusLabel(item.assignment.status), dueLabel: formatTaskDueAt(item.task.dueAt) }))
      this.updateVisibleTasks(tasks, this.data.currentFilter, this.data.timeRange)
    },
    setFilter(event: WechatMiniprogram.TouchEvent) {
      const currentFilter = event.currentTarget.dataset.filter as TaskFilter
      this.updateVisibleTasks(this.data.allTasks, currentFilter, this.data.timeRange)
    },
    setTimeRange(event: WechatMiniprogram.TouchEvent) {
      this.updateVisibleTasks(this.data.allTasks, this.data.currentFilter, event.currentTarget.dataset.range as TimeRange)
    },
    updateVisibleTasks(allTasks: StudentTaskListItem[], currentFilter: TaskFilter, timeRange: TimeRange) {
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - Number(timeRange === 'all' ? 0 : timeRange))
      const dated = timeRange === 'all' ? allTasks : allTasks.filter(item => new Date(item.task.dueAt) >= cutoff)
      const isRedo = (item: StudentTaskListItem) => item.assignment.status === 'redo_required' || Boolean(item.assignment.redoDueAt)
      const status = (item: StudentTaskListItem): TaskFilter => isRedo(item) || item.assignment.status === 'overdue' ? 'overdue_redo'
        : item.assignment.status === 'awaiting_review' ? 'review'
          : item.assignment.status === 'completed' ? 'completed' : 'pending'
      this.setData({ loading: false, allTasks, currentFilter, timeRange,
        tasks: dated.filter(item => currentFilter === 'all' || status(item) === currentFilter),
        totalVisibleCount: dated.length,
        pendingCount: dated.filter(item => status(item) === 'pending').length,
        reviewCount: dated.filter(item => status(item) === 'review').length,
        completedCount: dated.filter(item => status(item) === 'completed').length,
        overdueRedoCount: dated.filter(item => status(item) === 'overdue_redo').length })
    },
    openTask(event: WechatMiniprogram.TouchEvent) {
      setCurrentTaskId(event.currentTarget.dataset.id as string)
      wx.navigateTo({ url: '/pages/student/task-detail/task-detail' })
    },
  },
})
