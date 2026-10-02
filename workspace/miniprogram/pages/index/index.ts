import { HomeView } from '../../domain/types'
import { activeActivityDay } from '../../domain/student-activity-feed'
import { todayHomeItems, type TodayHomeItem } from '../../domain/today-home-feed'
import { getHome, getMyActivityDay, listNotifications, listStudentActivities } from '../../services/app-service'
import { getProfile } from '../../services/m1-app-service'
import { getRepositoryMode } from '../../repositories/repository-factory'
import { getSession, setCurrentTaskId } from '../../session/session'
import { formatTaskDueAt } from '../../shared/task-schedule'

Component({
  data: { loading: true, error: '', home: null as HomeView | null, topInset: 72, heroHeight: 274, dateLabel: '', className: '', noticeCount: 0,
    todayItems: [] as Array<TodayHomeItem & { dueLabel: string }>, checkinOnly: false,
    todayCompletedCount: 0, todayTotalCount: 0 },
  lifetimes: {
    attached() {
      const menuRect = wx.getMenuButtonBoundingClientRect()
      const topInset = Math.max(64, Math.ceil(menuRect.bottom + 10))
      const today = new Date()
      this.setData({ topInset, heroHeight: topInset + 160, dateLabel: `${today.getMonth() + 1}月${today.getDate()}日` })
      this.loadHome()
    },
  },
  pageLifetimes: { show() { this.loadHome() } },
  methods: {
    async loadHome() {
      const session = getSession()
      if (!session) { wx.redirectTo({ url: '/pages/auth/login/login' }); return }
      this.setData({ loading: true, error: '' })
      const [result, profile, notices, activities] = await Promise.all([getHome(session.user.id), getProfile(session.user.id),
        listNotifications(session.user.id, 'all', 0, 1), listStudentActivities(session.user.id)])
      if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
      if (!activities.ok && getRepositoryMode() === 'cloudbase') {
        this.setData({ loading: false, error: activities.error.message }); return
      }
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
      this.setData({ loading: false, home: result.data, className: profile.ok ? profile.data.className ?? '' : result.data.user.className ?? '',
        todayItems: items.map(item => ({ ...item, dueLabel: item.kind === 'activity' ? item.statusLabel
          : `${item.statusLabel} · ${formatTaskDueAt(item.dueAt)} 截止` })),
        checkinOnly: items.length === 1 && items[0]?.kind === 'activity',
        todayCompletedCount: result.data.completedCount + completedActivities,
        todayTotalCount: result.data.totalCount + todayActivities.length,
        noticeCount: notices.ok ? notices.data.unreadCount : 0 })
    },
    openTodayItem(event: WechatMiniprogram.TouchEvent) {
      const id = event.currentTarget.dataset.id as string
      const kind = event.currentTarget.dataset.kind as TodayHomeItem['kind']
      const item = this.data.todayItems.find(candidate => candidate.id === id && candidate.kind === kind)
      if (!item) return
      if (item.kind === 'task') {
        setCurrentTaskId(item.id)
        wx.navigateTo({ url: '/pages/student/task-detail/task-detail' })
      } else {
        wx.navigateTo({ url: `/pages/student/checkin-detail/checkin-detail?activityId=${encodeURIComponent(item.id)}` })
      }
    },
    openVocabulary() { wx.navigateTo({ url: '/pages/student/vocabulary/vocabulary' }) },
    openNotice() { wx.navigateTo({ url: '/pages/notifications/notifications' }) },
  },
})
