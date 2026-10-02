import type { StatsFilters, StatsTaskDetail, StatsView } from '../../../domain/learning-stats'
import { exportTeacherStats, getTeacherStats } from '../../../services/learning-stats-service'
import { getSession, setCurrentStudentId, takeTeacherStatsTargetStudentId } from '../../../session/session'

type DetailRow = StatsTaskDetail & { key: string; statusLabel: string; scoreLabel: string }
type TrendDay = { date: string; completed: number; percent: number }

function dateBefore(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function statusLabel(status: string): string {
  return ({ completed: '已完成', awaiting_review: '待点评', overdue: '已逾期', redo_required: '待重做',
    in_progress: '进行中', not_started: '未开始' } as Record<string, string>)[status] ?? status
}

Component({
  data: {
    loading: true, exporting: false, error: '', exportError: '', report: null as StatsView | null,
    startsOn: dateBefore(6), endsOn: dateBefore(0), periodIndex: 0,
    periodNames: ['近 7 天', '近 30 天', '自定义'],
    classIndex: 0, classNames: ['全部负责班级'], classOptions: [{ id: '', name: '全部负责班级' }],
    studentIndex: 0, studentNames: ['全部学员'], studentOptions: [{ id: '', name: '全部学员' }],
    targetStudentId: '',
    rows: [] as DetailRow[], trend: [] as TrendDay[], scrollTarget: '',
  },
  lifetimes: { attached() { this.setData({ targetStudentId: takeTeacherStatsTargetStudentId() }, () => this.loadReport()) } },
  methods: {
    filters(): StatsFilters {
      const classId = this.data.classOptions[this.data.classIndex]?.id
      const studentId = this.data.targetStudentId || this.data.studentOptions[this.data.studentIndex]?.id
      return { startsOn: this.data.startsOn, endsOn: this.data.endsOn,
        ...(classId ? { classId } : {}), ...(studentId ? { studentId } : {}) }
    },
    async loadReport() {
      const session = getSession()
      if (!session || (session.activeRole ?? session.user.role) !== 'teacher') {
        wx.reLaunch({ url: '/pages/auth/login/login' }); return
      }
      this.setData({ loading: true, error: '', exportError: '' })
      const result = await getTeacherStats(session.user.id, this.filters())
      if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
      const report = result.data
      const classOptions = [{ id: '', name: '全部负责班级' }, ...report.classes]
      const selectedClass = this.data.classOptions[this.data.classIndex]?.id ?? ''
      const classIndex = Math.max(0, classOptions.findIndex(item => item.id === selectedClass))
      const studentOptions = [{ id: '', name: '全部学员' }, ...report.students
        .filter(item => !selectedClass || item.classId === selectedClass).map(item => ({ id: item.id, name: item.name }))]
      const selectedStudent = this.data.targetStudentId || this.data.studentOptions[this.data.studentIndex]?.id || ''
      const studentIndex = Math.max(0, studentOptions.findIndex(item => item.id === selectedStudent))
      this.setData({ loading: false, report, classOptions, classNames: classOptions.map(item => item.name), classIndex,
        studentOptions, studentNames: studentOptions.map(item => item.name), studentIndex, targetStudentId: '',
        rows: report.details.map(item => ({ ...item, key: `${item.taskId}|${item.studentId}`,
          statusLabel: statusLabel(item.status),
          scoreLabel: item.score === null ? '未记录' : `${item.score} 分` })), trend: this.trend(report.details) })
    },
    trend(details: StatsTaskDetail[]): TrendDay[] {
      const days: TrendDay[] = []
      const end = Date.parse(`${this.data.endsOn}T00:00:00Z`)
      for (let offset = 6; offset >= 0; offset--) {
        const date = new Date(end - offset * 86400000).toISOString().slice(0, 10)
        const completed = details.filter(item => item.dueOn === date
          && (item.status === 'completed' || item.status === 'awaiting_review')).length
        days.push({ date: date.slice(5), completed, percent: 0 })
      }
      const maximum = Math.max(1, ...days.map(item => item.completed))
      return days.map(item => ({ ...item, percent: item.completed ? Math.round(item.completed * 100 / maximum) : 0 }))
    },
    onPeriodChange(event: WechatMiniprogram.PickerChange) {
      const periodIndex = Number(event.detail.value)
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
    onClassChange(event: WechatMiniprogram.PickerChange) {
      this.setData({ classIndex: Number(event.detail.value), studentIndex: 0, targetStudentId: '' }, () => this.loadReport())
    },
    onStudentChange(event: WechatMiniprogram.PickerChange) {
      this.setData({ studentIndex: Number(event.detail.value), targetStudentId: '' }, () => this.loadReport())
    },
    jumpDetails() { wx.pageScrollTo({ selector: '#stats-details', duration: 250 }) },
    openStudent(event: WechatMiniprogram.TouchEvent) {
      const studentId = event.currentTarget.dataset.studentId as string
      if (!studentId) return
      setCurrentStudentId(studentId)
      wx.navigateTo({ url: '/pages/teacher/student-detail/student-detail' })
    },
    async exportCsv() {
      const session = getSession()
      if (!session || this.data.exporting || !this.data.report?.canExport) return
      this.setData({ exporting: true, exportError: '' })
      const result = await exportTeacherStats(session.user.id, this.filters())
      if (!result.ok) { this.setData({ exporting: false, exportError: result.error.message }); return }
      wx.setClipboardData({ data: result.data.csv,
        success: () => { this.setData({ exporting: false }); wx.showToast({ title: 'CSV 已复制，可粘贴保存', icon: 'none' }) },
        fail: () => this.setData({ exporting: false, exportError: 'CSV 复制失败，请重试' }) })
    },
  },
})
