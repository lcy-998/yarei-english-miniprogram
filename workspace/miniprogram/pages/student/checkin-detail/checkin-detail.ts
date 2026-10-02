import type { ActivityDayView, ActivityView } from '../../../domain/types'
import { checkinConditionRows, type CheckinConditionRow } from '../../../domain/checkin-task'
import { activeActivityDay, schoolDate } from '../../../domain/student-activity-feed'
import { getMyActivityDay, getStudentActivity, listStudentTasks } from '../../../services/app-service'
import { getSession, setCurrentBookId, setCurrentTaskId } from '../../../session/session'
import { preferDubbingMaterial } from '../../../shared/dubbing-navigation'

Component({
  data: { activityId: '', activity: null as ActivityView | null, day: null as ActivityDayView | null,
    conditions: [] as CheckinConditionRow[], date: '', statusLabel: '', progressLabel: '',
    activeToday: false, loading: true, refreshing: false, error: '', progressError: '', taskLookupError: false,
    loadGeneration: 0 },
  pageLifetimes: { show() {
    const pages = getCurrentPages() as Array<{ options?: Record<string, string> }>
    const id = pages[pages.length - 1]?.options?.activityId ?? ''
    if (id) this.setData({ activityId: decodeURIComponent(id) }, () => this.loadActivity())
    else this.setData({ loading: false, error: '未找到打卡活动' })
  } },
  methods: {
    async loadActivity() {
      const session = getSession()
      if (!session) { wx.reLaunch({ url: '/pages/auth/login/login' }); return }
      const generation = this.data.loadGeneration + 1
      this.setData({ loading: !this.data.activity, refreshing: Boolean(this.data.activity), error: '',
        progressError: '', taskLookupError: false, loadGeneration: generation })
      const result = await getStudentActivity(session.user.id, this.data.activityId)
      if (generation !== this.data.loadGeneration) return
      if (!result.ok) {
        this.setData({ loading: false, refreshing: false, activity: null, day: null,
          conditions: [], error: result.error.message }); return
      }
      const activity = result.data
      const date = schoolDate(activity.schedule.schoolTimeZone)
      const activeDate = activeActivityDay(activity)
      const [dayResult, taskResult] = await Promise.all([
        activeDate ? getMyActivityDay(session.user.id, activity.id, activeDate) : Promise.resolve(null),
        activeDate && activity.schedule.conditions.some(condition => condition.kind === 'exercise')
          ? listStudentTasks(session.user.id) : Promise.resolve(null),
      ])
      if (generation !== this.data.loadGeneration) return
      const day = dayResult?.ok ? dayResult.data : null
      const statusLabel = date < activity.schedule.startsOn ? '活动尚未开始'
        : date > activity.schedule.endsOn || activity.status === 'closed' ? '活动已结束'
          : !activeDate ? '今天是休息日' : day?.supplemented ? '教师已补记今日打卡'
            : day?.complete ? '今日打卡已完成' : day ? '今日打卡待完成' : '今日进度暂不可用'
      const progressLabel = day?.evidenceStatus === 'available'
        ? `已完成 ${day.verifiedConditions}/${day.totalConditions} 项` : '完成情况待核对'
      const conditions = checkinConditionRows(activity, day, taskResult?.ok ? taskResult.data : [], Boolean(activeDate))
      this.setData({ loading: false, refreshing: false, activity, day, date, statusLabel,
        progressLabel, activeToday: Boolean(activeDate), conditions,
        taskLookupError: Boolean(taskResult && !taskResult.ok),
        progressError: dayResult && !dayResult.ok ? dayResult.error.message
          : taskResult && !taskResult.ok ? `习题入口读取失败：${taskResult.error.message}` : '' })
    },
    refreshProgress() { this.loadActivity() },
    onPullDownRefresh() { this.loadActivity().then(() => wx.stopPullDownRefresh()) },
    openCondition(event: WechatMiniprogram.TouchEvent) {
      const index = Number(event.currentTarget.dataset.index)
      const condition = this.data.conditions[index]
      const session = getSession()
      if (!condition || !session) return
      if (!condition.canOpen) {
        wx.showToast({ title: !this.data.activeToday ? '当前不是有效打卡日'
          : condition.kind === 'exercise' ? '暂无对应习题任务' : '该内容后续开放', icon: 'none' })
        return
      }
      if (condition.kind === 'reading') {
        setCurrentBookId(condition.resourceId)
        wx.navigateTo({ url: `/pages/student/reading-detail/reading-detail?bookId=${encodeURIComponent(condition.resourceId)}&activityId=${encodeURIComponent(this.data.activityId)}&startPageNumber=1` })
      } else if (condition.kind === 'vocabulary') {
        wx.navigateTo({ url: `/pages/student/vocabulary/vocabulary?packId=${encodeURIComponent(condition.resourceId)}` })
      } else if (condition.kind === 'work') {
        preferDubbingMaterial(session.user.id, session.sessionId, condition.resourceId)
        wx.navigateTo({ url: '/pages/student/dubbing/dubbing' })
      } else if (condition.kind === 'exercise' && condition.taskId) {
        setCurrentTaskId(condition.taskId)
        wx.navigateTo({ url: '/pages/student/task-detail/task-detail' })
      }
    },
    openLeaderboard() {
      wx.navigateTo({ url: `/pages/student/checkin-leaderboard/checkin-leaderboard?activityId=${encodeURIComponent(this.data.activityId)}` })
    },
  },
})
