import { TaskDetailView } from '../../../domain/types'
import { getParentHome } from '../../../services/app-service'
import { getSession, setCurrentTaskId } from '../../../session/session'
import { assignmentStatusLabel } from '../../../shared/assignment-status'
import { summarizeAssignments } from '../../../shared/dashboard-summary'

interface ParentTaskListItem extends TaskDetailView {
  key: string
  statusLabel: string
}

Component({
  data: {
    loading: true,
    error: '',
    childName: '',
    childAvatarText: '',
    childClassName: '',
    tasks: [] as ParentTaskListItem[],
    pendingCount: 0,
    completedCount: 0,
    reviewedCount: 0,
    overdueCount: 0,
    completionRate: 0,
    latestFeedbackTaskId: '',
    latestFeedbackTaskTitle: '',
    latestFeedbackText: '',
  },
  lifetimes: { attached() { this.loadHome() } },
  pageLifetimes: { show() { this.loadHome() } },
  methods: {
    async loadHome() {
      const session = getSession()
      if (!session) { wx.redirectTo({ url: '/pages/auth/login/login' }); return }
      this.setData({ loading: true, error: '' })
      const result = await getParentHome(session.user.id)
      if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
      const tasks = result.data.tasks.map((item) => ({ ...item, key: item.task.id, statusLabel: assignmentStatusLabel(item.assignment.status, '待点评') }))
      const summary = summarizeAssignments(tasks.map((item) => item.assignment))
      const latestFeedbackTask = tasks.find((item) => Boolean(item.feedback))
      this.setData({
        loading: false,
        childName: result.data.child.displayName,
        childAvatarText: result.data.child.displayName.slice(-1),
        childClassName: result.data.child.className ?? '班级信息暂未提供',
        tasks,
        pendingCount: summary.pendingCount,
        completedCount: summary.completedCount,
        reviewedCount: tasks.filter((item) => Boolean(item.feedback)).length,
        overdueCount: summary.overdueCount,
        completionRate: summary.completionRate,
        latestFeedbackTaskId: latestFeedbackTask?.task.id ?? '',
        latestFeedbackTaskTitle: latestFeedbackTask?.task.title ?? '',
        latestFeedbackText: latestFeedbackTask?.feedback?.textComment ?? '',
      })
    },
    openTask(event: WechatMiniprogram.TouchEvent) {
      setCurrentTaskId(event.currentTarget.dataset.id as string)
      wx.navigateTo({ url: '/pages/parent/task-detail/task-detail' })
    },
    openLatestFeedback() {
      if (!this.data.latestFeedbackTaskId) { wx.showToast({ title: '暂无新点评', icon: 'none' }); return }
      setCurrentTaskId(this.data.latestFeedbackTaskId)
      wx.navigateTo({ url: '/pages/parent/feedback/feedback' })
    },
    openChildren() {
      wx.reLaunch({ url: '/pages/parent/children/children' })
    },
    showAllTasks() {
      wx.showToast({ title: this.data.tasks.length ? '当前已展示全部任务' : '暂无近期任务', icon: 'none' })
    },
    openFuture(event: WechatMiniprogram.TouchEvent) {
      const label = event.currentTarget.dataset.label as string
      wx.showToast({ title: `${label}将在后续里程碑开放`, icon: 'none' })
    },
  },
})
