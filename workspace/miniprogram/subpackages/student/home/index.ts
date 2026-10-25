import { activeActivityDay } from '../domain/student-activity-feed'
import { todayHomeItems, type TodayHomeItem } from '../domain/today-home-feed'
import { getHome, getMyActivityDay, listNotifications, listStudentActivities } from '../services/app-service'
import { getProfile } from '../services/m1-app-service'
import { getRepositoryMode } from '../../../repositories/repository-factory'
import { getSession, setCurrentTaskId } from '../session/session'
import { formatTaskDueAt } from '../shared/task-schedule'
import { onStudentTaskSubmitted } from '../shared/student-task-update'

const HOME_CACHE_KEY = 'yarei_student_home_summary'
const HOME_CACHE_MAX_AGE_MS = 30 * 60 * 1000
const taskUpdateSubscriptions = new WeakMap<object, () => void>()

interface HomeDisplay {
  displayName: string
  className: string
  todayItems: Array<TodayHomeItem & { dueLabel: string }>
  checkinOnly: boolean
  todayCompletedCount: number
  todayTotalCount: number
  noticeCount: number
}

function localDay(): string {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function homeTime(timestamp: number): string {
  const date = new Date(timestamp)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function readHomeCache(userId: string, sessionId: string): (HomeDisplay & { updatedAt: number }) | null {
  try {
    const value: unknown = wx.getStorageSync(HOME_CACHE_KEY)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
    const cache = value as Record<string, unknown>
    if (cache.userId !== userId || cache.sessionId !== sessionId || cache.localDay !== localDay()
      || typeof cache.updatedAt !== 'number' || cache.updatedAt > Date.now()
      || Date.now() - cache.updatedAt > HOME_CACHE_MAX_AGE_MS
      || typeof cache.displayName !== 'string' || typeof cache.className !== 'string'
      || !Array.isArray(cache.todayItems) || typeof cache.checkinOnly !== 'boolean'
      || typeof cache.todayCompletedCount !== 'number' || typeof cache.todayTotalCount !== 'number'
      || typeof cache.noticeCount !== 'number') return null
    const todayItems = cache.todayItems
    if (!todayItems.every(item => typeof item === 'object' && item !== null
      && (item.kind === 'task' || item.kind === 'activity')
      && typeof item.id === 'string' && typeof item.title === 'string'
      && typeof item.dueLabel === 'string')) return null
    return { displayName: cache.displayName, className: cache.className,
      todayItems: todayItems as HomeDisplay['todayItems'], checkinOnly: cache.checkinOnly,
      todayCompletedCount: cache.todayCompletedCount, todayTotalCount: cache.todayTotalCount,
      noticeCount: cache.noticeCount, updatedAt: cache.updatedAt }
  } catch (_error: unknown) { return null }
}

function writeHomeCache(userId: string, sessionId: string, display: HomeDisplay): void {
  try { wx.setStorageSync(HOME_CACHE_KEY, { ...display, userId, sessionId, localDay: localDay(), updatedAt: Date.now() }) }
  catch (_error: unknown) { /* A storage failure must not hide the live home. */ }
}

Component({
  data: { loading: true, error: '', refreshError: '', hasHome: false, displayName: '', loadVersion: 0, loadedSessionId: '', lastUpdatedAt: '',
    topInset: 72, heroHeight: 274, dateLabel: '', className: '', noticeCount: 0,
    todayItems: [] as Array<TodayHomeItem & { dueLabel: string }>, checkinOnly: false,
    todayCompletedCount: 0, todayTotalCount: 0 },
  lifetimes: {
    attached() {
      const menuRect = wx.getMenuButtonBoundingClientRect()
      const topInset = Math.max(64, Math.ceil(menuRect.bottom + 10))
      const today = new Date()
      this.setData({ topInset, heroHeight: topInset + 160, dateLabel: `${today.getMonth() + 1}月${today.getDate()}日` })
      taskUpdateSubscriptions.set(this, onStudentTaskSubmitted((sessionId, taskId) => {
        if (getSession()?.sessionId !== sessionId || this.data.loadedSessionId !== sessionId) return
        this.applySubmittedTask(taskId)
        this.loadHome()
      }))
    },
    detached() { taskUpdateSubscriptions.get(this)?.(); taskUpdateSubscriptions.delete(this) },
  },
  pageLifetimes: { show() { this.loadHome() } },
  methods: {
    applySubmittedTask(taskId: string) {
      const current = this.data.todayItems.find(item => item.kind === 'task' && item.id === taskId)
      if (!current || current.completed) return
      const todayItems = this.data.todayItems.map(item => item === current
        ? { ...item, completed: true, statusLabel: '待检查', dueLabel: item.dueLabel.replace(/^[^·]+ · /, '待检查 · '), priority: 6 }
        : item).sort((left, right) => left.priority - right.priority
          || Date.parse(left.dueAt) - Date.parse(right.dueAt) || left.key.localeCompare(right.key))
      this.setData({ todayItems, todayCompletedCount: this.data.todayCompletedCount + 1 })
    },
    async loadHome() {
      const session = getSession()
      if (!session) { wx.redirectTo({ url: '/pages/auth/login/login' }); return }
      const loadVersion = this.data.loadVersion + 1
      const hasCurrentHome = this.data.hasHome && this.data.loadedSessionId === session.sessionId
      this.setData({ loadVersion, loading: !hasCurrentHome, error: '', refreshError: '',
        ...(hasCurrentHome ? {} : { hasHome: false, displayName: '', className: '', todayItems: [] }) })
      const [firstHomeResult, profile, notices, activities] = await Promise.all([getHome(session.user.id), getProfile(session.user.id),
        listNotifications(session.user.id, 'all', 0, 1), listStudentActivities(session.user.id)])
      if (this.data.loadVersion !== loadVersion || getSession()?.sessionId !== session.sessionId) return
      let result = firstHomeResult
      const cached = hasCurrentHome ? null : readHomeCache(session.user.id, session.sessionId)
      if (!result.ok && !hasCurrentHome && !cached && result.error.retryable) {
        await new Promise<void>(resolve => setTimeout(resolve, 350))
        if (this.data.loadVersion !== loadVersion || getSession()?.sessionId !== session.sessionId) return
        result = await getHome(session.user.id)
      }
      if (!result.ok) {
        console.warn('[S-01] getHome failed:', result.error.code)
        if (cached) {
          const { updatedAt, ...display } = cached
          this.setData({ ...display, hasHome: true, loadedSessionId: session.sessionId, loading: false,
            lastUpdatedAt: homeTime(updatedAt),
            refreshError: `今日任务更新失败，显示 ${homeTime(updatedAt)} 的内容。` })
        } else {
          this.setData({ loading: false, error: hasCurrentHome ? '' : result.error.message,
            refreshError: hasCurrentHome ? `今日任务更新失败，显示 ${this.data.lastUpdatedAt} 的内容。` : '' })
        }
        return
      }
      if (!activities.ok && getRepositoryMode() === 'cloudbase') console.warn('[S-01] listStudentActivities failed:', activities.error.code)
      const todayActivities = activities.ok ? activities.data.flatMap(activity => {
        const date = activeActivityDay(activity)
        return date ? [{ activity, date }] : []
      }) : []
      const days = await Promise.all(todayActivities.map(async item => ({ ...item,
        result: await getMyActivityDay(session.user.id, item.activity.id, item.date) })))
      const fallbackTask = result.data.task && result.data.assignment ? [{
        taskId: result.data.task.id, title: result.data.task.title,
        status: result.data.assignment.status, startsAt: result.data.task.startsAt,
        dueAt: result.data.task.dueAt, redoDueAt: result.data.assignment.redoDueAt ?? null,
      }] : []
      const items = todayHomeItems(result.data.todayTasks ?? fallbackTask,
        days.map(item => ({ activity: item.activity, day: item.result.ok ? item.result.data : null })))
      const completedActivities = days.filter(item => item.result.ok && item.result.data.complete).length
      if (this.data.loadVersion !== loadVersion || getSession()?.sessionId !== session.sessionId) return
      const displayed: HomeDisplay = { displayName: result.data.user.displayName,
        className: profile.ok ? profile.data.className ?? '' : result.data.user.className ?? '',
        todayItems: items.map(item => ({ ...item, dueLabel: item.kind === 'activity' ? item.statusLabel
          : `${item.statusLabel} · ${formatTaskDueAt(item.dueAt)} 截止` })),
        checkinOnly: items.length === 1 && items[0]?.kind === 'activity',
        todayCompletedCount: result.data.completedCount + completedActivities,
        todayTotalCount: result.data.totalCount + todayActivities.length,
        noticeCount: notices.ok ? notices.data.unreadCount : 0 }
      const partialActivityFailure = !activities.ok && getRepositoryMode() === 'cloudbase'
        || days.some(item => !item.result.ok)
      this.setData({ ...displayed, hasHome: true, loadedSessionId: session.sessionId,
        lastUpdatedAt: homeTime(Date.now()), loading: false,
        refreshError: partialActivityFailure ? '打卡活动更新失败，请重试。' : '' })
      if (!partialActivityFailure) writeHomeCache(session.user.id, session.sessionId, displayed)
    },
    openTodayItem(event: WechatMiniprogram.TouchEvent) {
      const id = event.currentTarget.dataset.id as string
      const kind = event.currentTarget.dataset.kind as TodayHomeItem['kind']
      const item = this.data.todayItems.find(candidate => candidate.id === id && candidate.kind === kind)
      if (!item) return
      if (item.kind === 'task') {
        setCurrentTaskId(item.id)
        wx.navigateTo({ url: '/subpackages/student/task-detail/task-detail' })
      } else {
        wx.navigateTo({ url: `/subpackages/student/checkin-detail/checkin-detail?activityId=${encodeURIComponent(item.id)}` })
      }
    },
    openVocabulary() { wx.navigateTo({ url: '/subpackages/student/vocabulary/vocabulary' }) },
    openNotice() { wx.navigateTo({ url: '/subpackages/common/notifications/notifications' }) },
  },
})
