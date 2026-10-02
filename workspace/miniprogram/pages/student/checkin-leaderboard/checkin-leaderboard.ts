import type { ActivityDayView, ActivityLeaderboardView, ActivityView } from '../../../domain/types'
import { getActivityLeaderboard, getMyActivityDay, listStudentActivities, listTeacherActivities } from '../../../services/app-service'
import { getSession } from '../../../session/session'
import { activityHistoryDates, localToday, previousActivityDate } from './history-dates'

interface HistoryRow extends ActivityDayView { statusLabel: string }

function historyStatus(day: ActivityDayView): string {
  if (day.restDay) return '休息日'
  if (day.evidenceStatus === 'not_available') return '记录暂不可用'
  if (day.complete) return day.supplemented ? '教师补记完成' : '已完成'
  return '未完成'
}

Component({
  data: {
    loading: true,
    refreshing: false,
    error: '',
    activities: [] as ActivityView[],
    activityNames: [] as string[],
    activityId: '',
    activityTitle: '',
    result: null as ActivityLeaderboardView | null,
    updatedLabel: '',
    selfId: '',
    historyOpen: false,
    historyLoading: false,
    historyError: '',
    historyRows: [] as HistoryRow[],
    historyNextDate: '',
    historyGeneration: 0,
  },
  lifetimes: { attached() { this.loadActivities() } },
  pageLifetimes: { show() { if (this.data.activityId) this.loadBoard(false) } },
  methods: {
    async loadActivities() {
      const session = getSession()
      if (!session) { wx.reLaunch({ url: '/pages/auth/login/login' }); return }
      const role = session.activeRole ?? session.user.role
      if (role !== 'student' && role !== 'teacher') {
        this.setData({ loading: false, error: '当前身份不可查看班级榜单' }); return
      }
      this.setData({ loading: true, error: '' })
      const listed = role === 'student' ? await listStudentActivities(session.user.id)
        : await listTeacherActivities(session.user.id)
      if (!listed.ok) { this.setData({ loading: false, error: listed.error.message }); return }
      const activities = listed.data.filter(item => item.status !== 'draft')
      const pages = getCurrentPages() as Array<{ options?: Record<string, string> }>
      const rawId = pages[pages.length - 1]?.options?.activityId ?? ''
      const requestedId = rawId ? decodeURIComponent(rawId) : ''
      const selected = activities.find(item => item.id === requestedId) ?? activities[0]
      this.setData({ loading: false, activities, activityNames: activities.map(item => item.title),
        activityId: selected?.id ?? '', activityTitle: selected?.title ?? '', selfId: role === 'student' ? session.user.id : '',
        result: null, historyOpen: false, historyRows: [], historyNextDate: '', historyError: '',
        historyGeneration: this.data.historyGeneration + 1 },
      () => { if (selected) this.loadBoard(false) })
    },
    chooseActivity(event: WechatMiniprogram.PickerChange) {
      const selected = this.data.activities[Number(event.detail.value)]
      if (!selected || selected.id === this.data.activityId) return
      this.setData({ activityId: selected.id, activityTitle: selected.title, result: null, error: '',
        historyOpen: false, historyRows: [], historyNextDate: '', historyError: '',
        historyGeneration: this.data.historyGeneration + 1 },
        () => this.loadBoard(false))
    },
    openActivity() {
      if (!this.data.selfId || !this.data.activityId) return
      wx.navigateTo({ url: `/pages/student/checkin-detail/checkin-detail?activityId=${encodeURIComponent(this.data.activityId)}` })
    },
    async loadBoard(refresh: boolean) {
      const session = getSession()
      const activityId = this.data.activityId
      if (!session || !activityId) return
      this.setData(refresh ? { refreshing: true, error: '' } : { loading: true, error: '' })
      const result = await getActivityLeaderboard(session.user.id, activityId)
      if (this.data.activityId !== activityId) return
      if (!result.ok) {
        const authorizationChanged = result.error.code === 'FORBIDDEN' || result.error.code === 'NOT_FOUND'
          || result.error.code === 'UNAUTHENTICATED'
        this.setData({ loading: false, refreshing: false, error: result.error.message,
          ...(authorizationChanged ? { result: null, activities: [], activityId: '', activityTitle: '',
            historyOpen: false, historyRows: [], historyNextDate: '',
            historyGeneration: this.data.historyGeneration + 1 } : {}) }); return
      }
      const date = new Date(result.data.updatedAt)
      const updatedLabel = Number.isFinite(date.getTime())
        ? `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` : '时间未记录'
      this.setData({ loading: false, refreshing: false, result: result.data, updatedLabel, error: '' })
    },
    refresh() { this.loadBoard(true) },
    onPullDownRefresh() { this.loadBoard(true).then(() => wx.stopPullDownRefresh()) },
    openMyHistory() {
      if (!this.data.selfId || !this.data.result?.myRank) return
      const activity = this.data.activities.find(item => item.id === this.data.activityId)
      if (!activity) return
      const schoolToday = this.data.result.schoolToday || localToday()
      const lastDate = activity.schedule.endsOn < schoolToday ? activity.schedule.endsOn : schoolToday
      this.setData({ historyOpen: true, historyLoading: false, historyRows: [], historyNextDate: lastDate,
        historyError: '', historyGeneration: this.data.historyGeneration + 1 }, () => this.loadMoreHistory())
    },
    closeMyHistory() { this.setData({ historyOpen: false, historyLoading: false, historyError: '',
      historyGeneration: this.data.historyGeneration + 1 }) },
    async loadMoreHistory() {
      const session = getSession()
      const activityId = this.data.activityId
      const activity = this.data.activities.find(item => item.id === activityId)
      if (!session || !activity || !this.data.selfId || !this.data.historyOpen
        || this.data.historyLoading || !this.data.historyNextDate) return
      const dates = activityHistoryDates(activity.schedule.startsOn, this.data.historyNextDate)
      if (!dates.length) { this.setData({ historyNextDate: '' }); return }
      const generation = this.data.historyGeneration
      this.setData({ historyLoading: true, historyError: '' })
      const results = await Promise.all(dates.map(date => getMyActivityDay(session.user.id, activityId, date)))
      if (!this.data.historyOpen || this.data.activityId !== activityId
        || this.data.historyGeneration !== generation) return
      const failure = results.find(result => !result.ok)
      if (failure && !failure.ok) {
        const revoked = failure.error.code === 'FORBIDDEN' || failure.error.code === 'NOT_FOUND'
          || failure.error.code === 'UNAUTHENTICATED'
        this.setData({ historyLoading: false, historyError: failure.error.message,
          ...(revoked ? { historyRows: [], historyNextDate: '', result: null } : {}) })
        return
      }
      const rows = results.flatMap(result => result.ok ? [{ ...result.data,
        statusLabel: historyStatus(result.data) }] : [])
      const nextDate = previousActivityDate(dates[dates.length - 1]!)
      this.setData({ historyLoading: false, historyRows: [...this.data.historyRows, ...rows],
        historyNextDate: nextDate >= activity.schedule.startsOn ? nextDate : '' })
    },
  },
})
