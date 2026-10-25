import type { StatsLearningEvent, StatsTaskDetail, StatsView } from '../../../domain/learning-stats'
import { listParentChildren } from '../services/app-service'
import { getParentStats } from '../services/learning-stats-service'
import { getCurrentChildId, getSession, setCurrentChildId, setCurrentTaskId } from '../session/session'

type ReportRow = StatsTaskDetail & { key: string; statusLabel: string; scoreLabel: string }
type TrendDay = { date: string; completed: number; percent: number }
type LearningRow = StatsLearningEvent & { key: string; kindLabel: string; resultLabel: string }

function dateBefore(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

Component({
  data: {
    loading: true, error: '', children: [] as Array<{ childId: string; displayName: string }>,
    childIndex: 0, childName: '尚未绑定孩子', childClassName: '',
    childAvatarText: '学', report: null as StatsView | null,
    requestVersion: 0,
    startsOn: dateBefore(6), endsOn: dateBefore(0), periodIndex: 0,
    periodNames: ['近 7 天', '近 30 天', '自定义'], rows: [] as ReportRow[],
    learningRows: [] as LearningRow[], trend: [] as TrendDay[],
  },
  lifetimes: { attached() { this.loadChildren() } },
  pageLifetimes: { show() { if (this.data.children.length) this.loadChildren() } },
  methods: {
    async loadChildren() {
      const session = getSession()
      if (!session || (session.activeRole ?? session.user.role) !== 'parent') {
        wx.reLaunch({ url: '/pages/auth/login/login' }); return
      }
      const requestVersion = this.data.requestVersion + 1
      this.setData({ loading: true, error: '', requestVersion })
      const result = await listParentChildren(session.user.id)
      if (this.data.requestVersion !== requestVersion) return
      if (!result.ok) { this.setData({ loading: false, error: result.error.message,
        children: [], report: null, rows: [], learningRows: [], trend: [],
        childName: '尚未绑定孩子', childClassName: '' }); return }
      const children = result.data.map(item => ({ childId: item.childId, displayName: item.displayName }))
      const current = getCurrentChildId()
      const childIndex = Math.max(0, children.findIndex(item => item.childId === current))
      this.setData({ children, childIndex, report: null, rows: [], learningRows: [], trend: [],
        childName: children[childIndex]?.displayName ?? '尚未绑定孩子',
        childAvatarText: children[childIndex]?.displayName.slice(-1) ?? '学' }, () => this.loadReport())
    },
    async loadReport() {
      const session = getSession()
      const child = this.data.children[this.data.childIndex]
      if (!session || !child) { this.setData({ loading: false, report: null, rows: [], learningRows: [], trend: [] }); return }
      if (this.data.startsOn > this.data.endsOn) {
        this.setData({ loading: false, error: '开始日期不能晚于结束日期' }); return
      }
      setCurrentChildId(child.childId)
      const requestVersion = this.data.requestVersion + 1
      this.setData({ loading: true, error: '', report: null, rows: [], learningRows: [], trend: [], requestVersion })
      const result = await getParentStats(session.user.id, child.childId,
        { startsOn: this.data.startsOn, endsOn: this.data.endsOn })
      if (this.data.requestVersion !== requestVersion || getCurrentChildId() !== child.childId) return
      if (!result.ok) { this.setData({ loading: false, error: result.error.message,
        report: null, rows: [], learningRows: [], trend: [] }); return }
      const report: StatsView = { ...result.data,
        learningPeriodBasis: result.data.learningPeriodBasis ?? 'eventSchoolDate',
        learningEvents: result.data.learningEvents ?? [],
        summary: { ...result.data.summary,
          learningMinutes: result.data.summary.learningMinutes ?? null,
          phonicsPracticeCount: result.data.summary.phonicsPracticeCount ?? null,
          practiceAccuracy: result.data.summary.practiceAccuracy ?? null,
          checkinCompletedDays: result.data.summary.checkinCompletedDays ?? null,
          checkinEvidenceStatus: result.data.summary.checkinEvidenceStatus ?? 'unavailable',
          dubbingCount: result.data.summary.dubbingCount ?? null,
          shadowingCount: result.data.summary.shadowingCount ?? null } }
      this.setData({ loading: false, report, trend: this.trend(report.details),
        childClassName: result.data.classes[0]?.name ?? '',
        learningRows: report.learningEvents.map((item, index) => ({ ...item,
          key: `${item.kind}|${item.sourceId}|${item.studentId}|${item.occurredOn}|${index}`,
          kindLabel: item.kind === 'phonics' ? '自然拼读' : '打卡活动',
          resultLabel: item.kind === 'phonics' ? item.firstCorrect ? '首次正确' : '首次错误'
            : item.supplemented ? '教师补记' : '证据完成' })),
        rows: report.details.map(item => ({ ...item, key: `${item.taskId}|${item.studentId}`,
          statusLabel: ({ completed: '已完成', awaiting_review: '待点评', overdue: '已逾期',
            redo_required: '待重做', in_progress: '进行中', not_started: '未开始' } as Record<string, string>)[item.status] ?? item.status,
          scoreLabel: item.score === null ? '未记录' : `${item.score} 分` })) })
    },
    trend(details: StatsTaskDetail[]): TrendDay[] {
      const end = Date.parse(`${this.data.endsOn}T00:00:00Z`)
      const days = Array.from({ length: 7 }, (_, index) => {
        const date = new Date(end - (6 - index) * 86400000).toISOString().slice(0, 10)
        const completed = details.filter(item => item.dueOn === date
          && (item.status === 'completed' || item.status === 'awaiting_review')).length
        return { date: date.slice(5), completed, percent: 0 }
      })
      const maximum = Math.max(1, ...days.map(item => item.completed))
      return days.map(item => ({ ...item, percent: item.completed ? Math.round(item.completed * 100 / maximum) : 0 }))
    },
    onPeriodTap(event: WechatMiniprogram.TouchEvent) {
      const periodIndex = Number(event.currentTarget.dataset.index)
      if (!Number.isInteger(periodIndex) || periodIndex < 0 || periodIndex > 2 || periodIndex === this.data.periodIndex) return
      this.setData({ periodIndex,
        ...(periodIndex === 0 ? { startsOn: dateBefore(6), endsOn: dateBefore(0) }
          : periodIndex === 1 ? { startsOn: dateBefore(29), endsOn: dateBefore(0) } : {}) },
      () => this.loadReport())
    },
    onStartChange(event: WechatMiniprogram.PickerChange) {
      this.setData({ startsOn: String(event.detail.value), periodIndex: 2 }, () => this.loadReport())
    },
    onEndChange(event: WechatMiniprogram.PickerChange) {
      this.setData({ endsOn: String(event.detail.value), periodIndex: 2 }, () => this.loadReport())
    },
    jumpDetails() { wx.pageScrollTo({ selector: '#report-details', duration: 250 }) },
    openTask(event: WechatMiniprogram.TouchEvent) {
      setCurrentTaskId(event.currentTarget.dataset.taskId as string)
      wx.navigateTo({ url: '/subpackages/parent/task-detail/task-detail' })
    },
    openChildren() { wx.navigateTo({ url: '/subpackages/parent/children/children' }) },
  },
})
