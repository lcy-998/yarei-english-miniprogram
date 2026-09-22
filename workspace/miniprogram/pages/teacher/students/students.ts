import { TeacherStudentClassOption, TeacherStudentListItem, TeacherStudentStatusFilter } from '../../../domain/types'
import { listTeacherStudents } from '../../../services/app-service'
import { getSession } from '../../../session/session'

const STATUS_OPTIONS: ReadonlyArray<Readonly<{ label: string; value: TeacherStudentStatusFilter }>> = [
  { label: '全部状态', value: 'all' },
  { label: '正常', value: 'normal' },
  { label: '待跟进', value: 'attention' },
  { label: '已停用', value: 'disabled' },
]

Page({
  data: {
    loading: true,
    loadingMore: false,
    error: '',
    permissionDenied: false,
    keyword: '',
    classIndex: 0,
    classOptions: [{ id: '', name: '全部负责班级', grade: '', term: '' }] as TeacherStudentClassOption[],
    statusIndex: 0,
    statusOptions: STATUS_OPTIONS,
    students: [] as TeacherStudentListItem[],
    total: 0,
    nextCursor: null as string | null,
  },

  onLoad() { this.loadStudents(true) },

  async loadStudents(reset = true) {
    const session = getSession()
    if (!session || session.user.role !== 'teacher') {
      wx.redirectTo({ url: '/pages/auth/login/login' })
      return
    }
    if (!reset && !this.data.nextCursor) return
    this.setData(reset
      ? { loading: true, error: '', permissionDenied: false }
      : { loadingMore: true, error: '' })
    const selectedClass = this.data.classOptions[this.data.classIndex]
    const result = await listTeacherStudents(session.user.id, {
      status: this.data.statusOptions[this.data.statusIndex].value,
      ...(selectedClass?.id ? { classId: selectedClass.id } : {}),
      ...(this.data.keyword.trim() ? { keyword: this.data.keyword.trim() } : {}),
    }, reset ? undefined : this.data.nextCursor ?? undefined)
    if (!result.ok) {
      this.setData({
        loading: false,
        loadingMore: false,
        error: result.error.message,
        permissionDenied: result.error.code === 'FORBIDDEN',
      })
      return
    }
    const classOptions = [{ id: '', name: '全部负责班级', grade: '', term: '' }, ...result.data.classes]
    this.setData({
      loading: false,
      loadingMore: false,
      classOptions,
      classIndex: Math.min(this.data.classIndex, classOptions.length - 1),
      students: reset ? result.data.items : [...this.data.students, ...result.data.items],
      total: result.data.total,
      nextCursor: result.data.nextCursor,
    })
  },

  onKeywordInput(event: WechatMiniprogram.Input) {
    this.setData({ keyword: event.detail.value })
  },

  onSearch() { this.loadStudents(true) },

  loadMore() { this.loadStudents(false) },

  onClassChange(event: WechatMiniprogram.PickerChange) {
    this.setData({ classIndex: Number(event.detail.value) }, () => this.loadStudents(true))
  },

  onStatusChange(event: WechatMiniprogram.PickerChange) {
    this.setData({ statusIndex: Number(event.detail.value) }, () => this.loadStudents(true))
  },

  openStudent(event: WechatMiniprogram.TouchEvent) {
    const studentId = event.currentTarget.dataset.id as string
    wx.navigateTo({ url: `/pages/teacher/student-detail/student-detail?studentId=${encodeURIComponent(studentId)}` })
  },

  showReadOnlyNotice() {
    wx.showToast({ title: '当前版本仅开放学员查询', icon: 'none' })
  },
})
