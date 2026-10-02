import type { TeacherTextbookClass } from '../../../domain/types'
import { getTeacherTextbookCenterSettings, listTeacherTextbookClasses } from '../../../services/app-service'
import { getSession } from '../../../session/session'

type ClassTextbookRow = TeacherTextbookClass & { gradeLabel: string; termLabel: string }

function gradeLabel(grade: string): string {
  const gradeNumber = Number(grade)
  const names = ['一', '二', '三', '四', '五', '六']
  return Number.isInteger(gradeNumber) && gradeNumber >= 1 && gradeNumber <= 6
    ? `${names[gradeNumber - 1]}年级` : grade
}

function termLabel(term: string): string {
  const match = /^(\d{4})-(spring|autumn)(?:-demo)?$/.exec(term)
  return match ? `${match[1]} ${match[2] === 'spring' ? '春季' : '秋季'}学期` : term
}

Component({
  data: { loading: true, error: '', keyword: '', grade: '', configured: '',
    classes: [] as TeacherTextbookClass[], rows: [] as ClassTextbookRow[],
    gradeOptions: [{ value: '', label: '全部年级' }] as Array<{ value: string; label: string }>,
    selectedGradeLabel: '全部年级', unconfiguredCount: 0,
    showGrade: true, showStudentCount: true, showConfiguredBookCount: true,
    showProgress: true, showUpdatedAt: true },
  lifetimes: { attached() { this.load() } },
  methods: {
    async load() {
      const session = getSession()
      if (!session) { wx.reLaunch({ url: '/pages/auth/login/login' }); return }
      if ((session.activeRole ?? session.user.role) !== 'teacher') { this.setData({ loading: false, error: '仅授权教师可查看班级教材' }); return }
      this.setData({ loading: true, error: '' })
      const [result, settings] = await Promise.all([
        listTeacherTextbookClasses(session.user.id), getTeacherTextbookCenterSettings(session.user.id),
      ])
      if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
      if (!settings.ok) { this.setData({ loading: false, error: settings.error.message }); return }
      const gradeOptions = [{ value: '', label: '全部年级' },
        ...[...new Set(result.data.map(item => item.grade))].map(value => ({ value, label: gradeLabel(value) }))]
      this.setData({ loading: false, classes: result.data, gradeOptions,
        selectedGradeLabel: gradeOptions.find(option => option.value === this.data.grade)?.label ?? '全部年级',
        unconfiguredCount: result.data.filter(item => !item.config?.publishedTextbooks.length).length,
        showGrade: settings.data.dashboardFields.includes('grade'),
        showStudentCount: settings.data.dashboardFields.includes('studentCount'),
        showConfiguredBookCount: settings.data.dashboardFields.includes('configuredBookCount'),
        showProgress: settings.data.dashboardFields.includes('progress'),
        showUpdatedAt: settings.data.dashboardFields.includes('updatedAt') }, () => this.filter())
    },
    onKeyword(event: WechatMiniprogram.Input) { this.setData({ keyword: event.detail.value }, () => this.filter()) },
    chooseGrade(event: WechatMiniprogram.PickerChange) {
      const index = Number(event.detail.value)
      const option = this.data.gradeOptions[index] ?? this.data.gradeOptions[0]
      this.setData({ grade: option.value, selectedGradeLabel: option.label }, () => this.filter())
    },
    chooseConfigured(event: WechatMiniprogram.PickerChange) {
      const index = Number(event.detail.value)
      this.setData({ configured: index === 1 ? 'yes' : index === 2 ? 'no' : '' }, () => this.filter())
    },
    filter() {
      const keyword = this.data.keyword.trim().toLocaleLowerCase()
      this.setData({ rows: this.data.classes.filter(item => (!this.data.grade || item.grade === this.data.grade)
        && (!keyword || item.name.toLocaleLowerCase().includes(keyword))
        && (!this.data.configured || (this.data.configured === 'yes') === Boolean(item.config?.publishedTextbooks.length)))
        .map(item => ({ ...item, gradeLabel: gradeLabel(item.grade), termLabel: termLabel(item.term) })) })
    },
    openClass(event: WechatMiniprogram.TouchEvent) {
      const id = event.currentTarget.dataset.id as string
      wx.navigateTo({ url: `/pages/teacher/class-textbook-detail/class-textbook-detail?classId=${encodeURIComponent(id)}` })
    },
  },
})
