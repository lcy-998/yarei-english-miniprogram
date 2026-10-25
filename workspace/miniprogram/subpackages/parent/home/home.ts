import { TaskDetailView } from '../domain/types'
import { getParentHome, listParentChildren, listNotifications } from '../services/app-service'
import type { ParentHomeView } from '../../../services/parent-task-types'
import { getCurrentChildId, getSession, setCurrentChildId, setCurrentTaskId } from '../session/session'
import { assignmentStatusLabel } from '../shared/assignment-status'
import { formatTaskDueAt } from '../shared/task-schedule'

interface ParentTaskPreview extends TaskDetailView {
  key: string
  statusLabel: string
  dueLabel: string
}

// Memory-only preview, restricted to one authenticated session and one child.
let recentHome: { sessionId: string; childId: string; value: ParentHomeView; noticeCount: number } | null = null

function displayHome(value: ParentHomeView, noticeCount: number) {
  const weeklyTotal = value.weeklyAssignedCount
  const weeklyDone = value.weeklyCompletedCount
  const latest = value.recentFeedback[0]
  return {
    childName: value.child.displayName,
    childAvatarText: value.child.displayName.slice(-1),
    childClassName: value.child.className ?? '班级信息暂未提供',
    tasks: value.tasks.map((item): ParentTaskPreview => ({ ...item, key: item.task.id,
      statusLabel: assignmentStatusLabel(item.assignment.status, '待点评'),
      dueLabel: formatTaskDueAt(item.task.dueAt) })),
    noticeCount,
    completionRateLabel: weeklyTotal === null || weeklyDone === null ? '未记录'
      : weeklyTotal === 0 ? '暂无任务' : `${Math.round(weeklyDone * 100 / weeklyTotal)}%`,
    pendingCountLabel: value.pendingTaskCount === null ? '未记录' : String(value.pendingTaskCount),
    overdueCountLabel: value.overdueTaskCount === null ? '未记录' : String(value.overdueTaskCount),
    reviewedCount: value.recentFeedback.length,
    latestFeedbackTaskId: latest?.taskId ?? '',
    latestFeedbackTaskTitle: latest?.taskTitle ?? '',
    latestFeedbackText: latest?.textComment || '老师已发布点评',
    latestFeedbackTeacherName: latest?.teacherName || '任课教师',
  }
}

Component({
  data: {
    loading: true,
    error: '',
    requestVersion: 0,
    noticeCount: 0,
    childName: '',
    childAvatarText: '',
    childClassName: '',
    tasks: [] as ParentTaskPreview[],
    completionRateLabel: '未记录', pendingCountLabel: '未记录', overdueCountLabel: '未记录',
    reviewedCount: 0,
    refreshing: false, refreshError: '', noChild: false,
    latestFeedbackTaskId: '',
    latestFeedbackTaskTitle: '',
    latestFeedbackText: '',
    latestFeedbackTeacherName: '',
  },
  lifetimes: { attached() { this.loadHome() } },
  pageLifetimes: { show() { this.loadHome() } },
  methods: {
    async loadHome() {
      const session = getSession()
      if (!session || (session.activeRole ?? session.user.role) !== 'parent') {
        recentHome = null
        this.setData({ tasks: [], childName: '', childAvatarText: '', childClassName: '' })
        wx.redirectTo({ url: '/pages/auth/login/login' })
        return
      }
      if (recentHome && recentHome.sessionId !== session.sessionId) recentHome = null
      const requestVersion = this.data.requestVersion + 1
      const currentChildId = getCurrentChildId()
      const cached = recentHome && recentHome.childId === currentChildId ? recentHome : null
      this.setData(cached
        ? { ...displayHome(cached.value, cached.noticeCount), loading: false, refreshing: true,
          error: '', refreshError: '', noChild: false, requestVersion }
        : { loading: true, refreshing: false, error: '', refreshError: '', noChild: false,
          tasks: [], childName: '', childAvatarText: '', childClassName: '',
          latestFeedbackTaskId: '', latestFeedbackText: '', latestFeedbackTeacherName: '',
          completionRateLabel: '未记录', pendingCountLabel: '未记录', overdueCountLabel: '未记录',
          reviewedCount: 0, noticeCount: 0, requestVersion })
      let result = await getParentHome(session.user.id)
      const stillParent = () => {
        const current = getSession()
        return current?.sessionId === session.sessionId
          && (current.activeRole ?? current.user.role) === 'parent'
      }
      if (!stillParent()) { recentHome = null; this.setData({ tasks: [], childName: '' }); return }
      if (!result.ok && (result.error.code === 'VALIDATION_ERROR' || result.error.code === 'NOT_FOUND'
        || result.error.code === 'FORBIDDEN')) {
        const children = await listParentChildren(session.user.id)
        if (this.data.requestVersion !== requestVersion) return
        if (children.ok && children.data.length === 0) {
          recentHome = null
          setCurrentChildId('')
          this.setData({ loading: false, refreshing: false, noChild: true, error: '', refreshError: '',
            tasks: [], childName: '', childAvatarText: '', childClassName: '', reviewedCount: 0,
            noticeCount: 0 })
          return
        }
        const selectedChild = children.ok
          ? children.data.find(item => item.childId === currentChildId) ?? children.data[0] : undefined
        if (selectedChild && selectedChild.childId !== currentChildId) {
          recentHome = null
          setCurrentChildId(selectedChild.childId)
          result = await getParentHome(session.user.id)
        }
      }
      if (this.data.requestVersion !== requestVersion) return
      if (!stillParent()) { recentHome = null; this.setData({ tasks: [], childName: '' }); return }
      if (!result.ok) {
        const accessLost = result.error.code === 'FORBIDDEN' || result.error.code === 'NOT_FOUND'
        if (accessLost) recentHome = null
        if (cached && !accessLost && getCurrentChildId() === cached.childId) {
          this.setData({ loading: false, refreshing: false, refreshError: result.error.message })
        } else {
          this.setData({ loading: false, refreshing: false, error: result.error.message,
            tasks: [], childName: '', childAvatarText: '', childClassName: '' })
        }
        return
      }
      if (!getCurrentChildId()) setCurrentChildId(result.data.child.id)
      if (getCurrentChildId() !== result.data.child.id) {
        this.setData({ loading: false, refreshing: false, tasks: [], childName: '',
          error: '孩子已切换，请重新加载' })
        return
      }
      const notices = await listNotifications(session.user.id, 'all', 0, 1)
      if (this.data.requestVersion !== requestVersion) return
      if (!stillParent()) { recentHome = null; this.setData({ tasks: [], childName: '' }); return }
      if (getCurrentChildId() !== result.data.child.id) return
      const noticeCount = notices.ok ? notices.data.unreadCount : cached?.noticeCount ?? 0
      recentHome = { sessionId: session.sessionId, childId: result.data.child.id,
        value: result.data, noticeCount }
      this.setData({ ...displayHome(result.data, noticeCount), loading: false, refreshing: false,
        error: '', refreshError: '', noChild: false })
    },
    openTask(event: WechatMiniprogram.TouchEvent) {
      setCurrentTaskId(event.currentTarget.dataset.id as string)
      wx.navigateTo({ url: '/subpackages/parent/task-detail/task-detail' })
    },
    openLatestFeedback() {
      if (!this.data.latestFeedbackTaskId) { wx.showToast({ title: '暂无新点评', icon: 'none' }); return }
      setCurrentTaskId(this.data.latestFeedbackTaskId)
      wx.navigateTo({ url: '/subpackages/parent/feedback/feedback' })
    },
    openChildren() {
      wx.reLaunch({ url: '/subpackages/parent/children/children' })
    },
    openReport() { wx.navigateTo({ url: '/subpackages/parent/learning-report/learning-report' }) },
    showAllTasks() { wx.navigateTo({ url: '/subpackages/parent/task-list/task-list' }) },
  },
})
