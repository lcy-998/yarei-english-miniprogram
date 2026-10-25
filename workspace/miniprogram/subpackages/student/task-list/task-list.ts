import { ActivityView, TaskDetailView } from '../domain/types'
import { activeActivityDay, schoolDate } from '../domain/student-activity-feed'
import { getRepositoryMode } from '../../../repositories/repository-factory'
import { getMyActivityDay, listStudentActivities, listStudentTasks } from '../services/app-service'
import { getSession, setCurrentTaskId } from '../session/session'
import { assignmentStatusLabel } from '../shared/assignment-status'
import { formatTaskDueAt } from '../shared/task-schedule'
import { onStudentTaskSubmitted } from '../shared/student-task-update'

const taskUpdateSubscriptions = new WeakMap<object, () => void>()

type TaskFilter = 'pending' | 'review' | 'completed' | 'overdue_redo' | 'all'
type TimeRange = '30' | '90' | 'all'
interface StudentTaskListItem extends TaskDetailView { key: string; statusLabel: string; dueLabel: string }
interface ActivityListItem { key: string; activity: ActivityView; statusLabel: string; dueLabel: string;
  filter: TaskFilter }

Component({
  data: { loading: true, error: '', allTasks: [] as StudentTaskListItem[], tasks: [] as StudentTaskListItem[],
    allActivities: [] as ActivityListItem[], activities: [] as ActivityListItem[], currentFilter: 'pending' as TaskFilter,
    timeRange: '30' as TimeRange, loadVersion: 0, loadedSessionId: '', totalVisibleCount: 0, pendingCount: 0, reviewCount: 0, completedCount: 0, overdueRedoCount: 0 },
  lifetimes: {
    attached() {
      taskUpdateSubscriptions.set(this, onStudentTaskSubmitted((sessionId, taskId) => {
        if (getSession()?.sessionId !== sessionId || this.data.loadedSessionId !== sessionId) return
        this.applySubmittedTask(taskId)
        this.loadTasks()
      }))
    },
    detached() { taskUpdateSubscriptions.get(this)?.(); taskUpdateSubscriptions.delete(this) },
  },
  pageLifetimes: { show() { this.loadTasks() } },
  methods: {
    applySubmittedTask(taskId: string) {
      if (!this.data.allTasks.some(item => item.task.id === taskId)) return
      const tasks = this.data.allTasks.map(item => item.task.id === taskId
        ? { ...item, assignment: { ...item.assignment, status: 'awaiting_review' as const, redoDueAt: undefined }, statusLabel: '待检查' }
        : item)
      this.updateVisibleTasks(tasks, this.data.allActivities, this.data.currentFilter, this.data.timeRange)
    },
    async loadTasks() {
      const session = getSession()
      if (!session) { wx.redirectTo({ url: '/pages/auth/login/login' }); return }
      const loadVersion = this.data.loadVersion + 1
      const hasCurrentList = this.data.loadedSessionId === session.sessionId
      this.setData({ loadVersion, loading: !hasCurrentList, error: '',
        ...(this.data.loadedSessionId && this.data.loadedSessionId !== session.sessionId
          ? { allTasks: [], tasks: [], allActivities: [], activities: [] } : {}) })
      const [result, activityResult] = await Promise.all([listStudentTasks(session.user.id), listStudentActivities(session.user.id)])
      if (this.data.loadVersion !== loadVersion || getSession()?.sessionId !== session.sessionId) return
      if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
      if (!activityResult.ok && getRepositoryMode() === 'cloudbase') {
        this.setData({ loading: false, error: activityResult.error.message }); return
      }
      const tasks = result.data.map((item) => ({ ...item, key: item.task.id, statusLabel: item.assignment.status === 'in_progress' && item.assignment.redoDueAt ? '重做中' : assignmentStatusLabel(item.assignment.status), dueLabel: formatTaskDueAt(item.task.dueAt) }))
      const activities: ActivityListItem[] = activityResult.ok ? await Promise.all(activityResult.data
        .filter(activity => activity.publishedAt !== null)
        .map(async activity => {
          const today = schoolDate(activity.schedule.schoolTimeZone)
          const day = activeActivityDay(activity)
          const dayResult = day ? await getMyActivityDay(session.user.id, activity.id, day) : null
          const completed = dayResult?.ok && dayResult.data.complete === true
          const ended = today > activity.schedule.endsOn || activity.status === 'closed'
          return { key: `activity:${activity.id}`, activity,
            statusLabel: ended ? '已结束' : today < activity.schedule.startsOn ? '待开始'
              : !day ? '今日休息' : completed ? '今日已打卡' : '今日待打卡',
            dueLabel: activity.schedule.endsOn,
            filter: ended || completed ? 'completed' as const : 'pending' as const }
        })) : []
      if (this.data.loadVersion !== loadVersion || getSession()?.sessionId !== session.sessionId) return
      this.updateVisibleTasks(tasks, activities, this.data.currentFilter, this.data.timeRange)
      this.setData({ loadedSessionId: session.sessionId })
    },
    setFilter(event: WechatMiniprogram.TouchEvent) {
      const currentFilter = event.currentTarget.dataset.filter as TaskFilter
      this.updateVisibleTasks(this.data.allTasks, this.data.allActivities, currentFilter, this.data.timeRange)
    },
    setTimeRange(event: WechatMiniprogram.TouchEvent) {
      this.updateVisibleTasks(this.data.allTasks, this.data.allActivities, this.data.currentFilter, event.currentTarget.dataset.range as TimeRange)
    },
    updateVisibleTasks(allTasks: StudentTaskListItem[], allActivities: ActivityListItem[], currentFilter: TaskFilter, timeRange: TimeRange) {
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - Number(timeRange === 'all' ? 0 : timeRange))
      const dated = timeRange === 'all' ? allTasks : allTasks.filter(item => new Date(item.task.dueAt) >= cutoff)
      const activityCutoff = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`
      const datedActivities = timeRange === 'all' ? allActivities : allActivities.filter(item => item.activity.schedule.endsOn >= activityCutoff)
      const isRedo = (item: StudentTaskListItem) => item.assignment.status === 'redo_required' || Boolean(item.assignment.redoDueAt)
      const status = (item: StudentTaskListItem): TaskFilter => isRedo(item) || item.assignment.status === 'overdue' ? 'overdue_redo'
        : item.assignment.status === 'awaiting_review' ? 'review'
          : item.assignment.status === 'completed' ? 'completed' : 'pending'
      this.setData({ loading: false, allTasks, allActivities, currentFilter, timeRange,
        tasks: dated.filter(item => currentFilter === 'all' || status(item) === currentFilter),
        activities: datedActivities.filter(item => currentFilter === 'all' || item.filter === currentFilter),
        totalVisibleCount: dated.length + datedActivities.length,
        pendingCount: dated.filter(item => status(item) === 'pending').length + datedActivities.filter(item => item.filter === 'pending').length,
        reviewCount: dated.filter(item => status(item) === 'review').length,
        completedCount: dated.filter(item => status(item) === 'completed').length + datedActivities.filter(item => item.filter === 'completed').length,
        overdueRedoCount: dated.filter(item => status(item) === 'overdue_redo').length })
    },
    openTask(event: WechatMiniprogram.TouchEvent) {
      setCurrentTaskId(event.currentTarget.dataset.id as string)
      wx.navigateTo({ url: '/subpackages/student/task-detail/task-detail' })
    },
    openActivity(event: WechatMiniprogram.TouchEvent) {
      const id = event.currentTarget.dataset.id as string
      if (!this.data.allActivities.some(item => item.activity.id === id)) return
      wx.navigateTo({ url: `/subpackages/student/checkin-detail/checkin-detail?activityId=${encodeURIComponent(id)}` })
    },
  },
})
