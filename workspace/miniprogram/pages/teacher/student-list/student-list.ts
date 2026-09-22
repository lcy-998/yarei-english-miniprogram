import { StudentListView, listTeacherStudents } from '../../../services/m1-app-service'
import { getSession, setCurrentStudentId } from '../../../session/session'

Component({
  data: { loading: true, error: '', keyword: '', status: 'all', students: [] as StudentListView[], allStudents: [] as StudentListView[], selectedClass: '全部负责班级', classFilterOpen: false, suppressClose: false, classOptions: ['全部负责班级', '三年级 2 班', '四年级 1 班'] },
  lifetimes: { attached() { this.loadStudents() } },
  pageLifetimes: { show() { this.loadStudents() } },
  methods: {
    async loadStudents() {
      const session = getSession()
      if (!session) { wx.reLaunch({ url: '/pages/auth/login/login' }); return }
      this.setData({ loading: true, error: '' })
      const result = await listTeacherStudents(session.user.id, this.data.keyword, this.data.status)
      if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
      const students = this.filterClass(result.data)
      this.setData({ loading: false, students, allStudents: result.data })
    },
    onSearch(event: WechatMiniprogram.Input) { this.setData({ keyword: event.detail.value }, () => this.loadStudents()) },
    toggleStatus() { const status = this.data.status === 'all' ? 'follow_up' : 'all'; this.setData({ status }, () => this.loadStudents()) },
    filterClass(students: StudentListView[]): StudentListView[] { return this.data.selectedClass === '全部负责班级' ? students : students.filter(item => item.className === this.data.selectedClass) },
    closeClassMenu() { if (this.data.suppressClose) { this.setData({ suppressClose: false }); return } this.setData({ classFilterOpen: false }) },
    chooseClass() { this.setData({ classFilterOpen: !this.data.classFilterOpen, suppressClose: true }) },
    selectClass(event: WechatMiniprogram.TouchEvent) { const selectedClass = event.currentTarget.dataset.className as string; this.setData({ selectedClass, classFilterOpen: false, suppressClose: true, students: this.filterClass(this.data.allStudents) }) },
    openStudent(event: WechatMiniprogram.TouchEvent) { setCurrentStudentId(event.currentTarget.dataset.id as string); wx.navigateTo({ url: '/pages/teacher/student-detail/student-detail' }) },
    importStudents() { wx.showToast({ title: '批量导入由授权管理员操作', icon: 'none' }) },
    exportStudents() { wx.showToast({ title: '演示名单已生成', icon: 'success' }) },
    addStudent() { wx.showToast({ title: '请在管理后台新建学员', icon: 'none' }) },
  },
})

