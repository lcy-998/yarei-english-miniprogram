import { TeacherStudentListItem, TeacherStudentStatusFilter } from '../../../domain/types'
import { listTeacherStudents } from '../../../services/app-service'
import { getSession, setCurrentStudentId } from '../../../session/session'
import { ImportIssue, ImportPreview, createTeacherStudentErrorCsv, createTeacherStudentImportTemplate, exportTeacherStudentsCsv, previewTeacherStudentCsv } from '../../../shared/teacher-student-csv'

const STATUS_OPTIONS: ReadonlyArray<{ label: string; value: TeacherStudentStatusFilter }> = [
  { label: '全部状态', value: 'all' },
  { label: '正常', value: 'normal' },
  { label: '待跟进', value: 'attention' },
  { label: '已停用', value: 'disabled' },
]

interface StudentRow extends TeacherStudentListItem {
  statusLabel: string
  completionPercent: number
}

function presentStudent(item: TeacherStudentListItem): StudentRow {
  return {
    ...item,
    statusLabel: item.accountStatus === 'disabled' ? '已停用' : item.needsAttention ? '待跟进' : '正常',
    completionPercent: item.performance.completionRate,
  }
}

Component({
  data: {
    loading: true, loadingMore: false, error: '', keyword: '', statusIndex: 0,
    statusOptions: STATUS_OPTIONS, students: [] as StudentRow[],
    selectedClassId: '', selectedClass: '全部负责班级', classFilterOpen: false, suppressClose: false,
    classOptions: [{ id: '', name: '全部负责班级' }] as Array<{ id: string; name: string }>,
    total: 0, nextCursor: null as string | null,
    requestVersion: 0,
    importBusy: false, importPreviewOpen: false, importFileName: '', importPreview: null as ImportPreview | null,
    visibleImportErrors: [] as ImportIssue[],
  },
  lifetimes: { attached() { this.loadStudents() } },
  pageLifetimes: { show() { this.loadStudents() } },
  methods: {
    filters() {
      return {
        status: STATUS_OPTIONS[this.data.statusIndex]?.value ?? 'all',
        ...(this.data.selectedClassId ? { classId: this.data.selectedClassId } : {}),
        ...(this.data.keyword.trim() ? { keyword: this.data.keyword.trim() } : {}),
      }
    },
    async loadStudents(append = false) {
      const session = getSession()
      if (!session || session.user.role !== 'teacher') { wx.reLaunch({ url: '/pages/auth/login/login' }); return }
      if (append && !this.data.nextCursor) return
      const requestVersion = this.data.requestVersion + 1
      this.setData(append ? { loadingMore: true, error: '', requestVersion } : { loading: true, error: '', requestVersion })
      const result = await listTeacherStudents(session.user.id, this.filters(), append ? this.data.nextCursor ?? undefined : undefined)
      if (this.data.requestVersion !== requestVersion) return
      if (!result.ok) { this.setData({ loading: false, loadingMore: false, error: result.error.message }); return }
      const classOptions = [{ id: '', name: '全部负责班级' }, ...result.data.classes]
      this.setData({
        loading: false, loadingMore: false, classOptions, total: result.data.total, nextCursor: result.data.nextCursor,
        students: append ? [...this.data.students, ...result.data.items.map(presentStudent)] : result.data.items.map(presentStudent),
      })
    },
    onSearch(event: WechatMiniprogram.Input) { this.setData({ keyword: event.detail.value }, () => this.loadStudents()) },
    onStatusChange(event: WechatMiniprogram.PickerChange) { this.setData({ statusIndex: Number(event.detail.value) }, () => this.loadStudents()) },
    closeClassMenu() { if (this.data.suppressClose) { this.setData({ suppressClose: false }); return } this.setData({ classFilterOpen: false }) },
    chooseClass() { this.setData({ classFilterOpen: !this.data.classFilterOpen, suppressClose: true }) },
    selectClass(event: WechatMiniprogram.TouchEvent) {
      const selectedClassId = event.currentTarget.dataset.classId as string
      const selectedClass = this.data.classOptions.find(item => item.id === selectedClassId)?.name ?? '全部负责班级'
      this.setData({ selectedClassId, selectedClass, classFilterOpen: false, suppressClose: true }, () => this.loadStudents())
    },
    loadMore() { this.loadStudents(true) },
    openStudent(event: WechatMiniprogram.TouchEvent) { setCurrentStudentId(event.currentTarget.dataset.id as string); wx.navigateTo({ url: '/pages/teacher/student-detail/student-detail' }) },
    importStudents() {
      this.setData({ importPreviewOpen: true })
    },
    chooseImportFile() {
      if (this.data.importBusy) return
      wx.chooseMessageFile({ count: 1, type: 'file', extension: ['csv'], success: result => {
        const file = result.tempFiles[0]
        if (!file || file.size > 1024 * 1024) { wx.showToast({ title: '请选择不超过 1 MB 的 CSV 文件', icon: 'none' }); return }
        this.setData({ importBusy: true })
        wx.getFileSystemManager().readFile({ filePath: file.path, success: async readResult => {
          if (typeof readResult.data === 'string') { this.setData({ importBusy: false }); wx.showToast({ title: '文件读取格式不支持', icon: 'none' }); return }
          const session = getSession()
          if (!session) { this.setData({ importBusy: false }); return }
          const existing: string[] = []
          let cursor: string | undefined
          const seen = new Set<string>()
          for (let page = 0; page < 2000; page++) {
            const students = await listTeacherStudents(session.user.id, { status: 'all' }, cursor)
            if (!students.ok) { this.setData({ importBusy: false }); wx.showToast({ title: students.error.message, icon: 'none' }); return }
            existing.push(...students.data.items.map(item => item.studentNumber))
            if (!students.data.nextCursor) break
            if (seen.has(students.data.nextCursor)) { this.setData({ importBusy: false }); wx.showToast({ title: '学员列表分页异常', icon: 'none' }); return }
            seen.add(students.data.nextCursor)
            cursor = students.data.nextCursor
          }
          const preview = previewTeacherStudentCsv(new Uint8Array(readResult.data), this.data.classOptions.filter(item => item.id).map(item => item.id), existing)
          this.setData({ importBusy: false, importPreviewOpen: true, importFileName: file.name, importPreview: preview, visibleImportErrors: preview.errors.slice(0, 10) })
        }, fail: () => { this.setData({ importBusy: false }); wx.showToast({ title: '文件读取失败，请重试', icon: 'none' }) } })
      } })
    },
    closeImportPreview() { this.setData({ importPreviewOpen: false, importPreview: null, visibleImportErrors: [] }) },
    copyImportTemplate() { wx.setClipboardData({ data: createTeacherStudentImportTemplate(), success: () => wx.showToast({ title: 'CSV 模板已复制', icon: 'none' }), fail: () => wx.showToast({ title: '复制模板失败', icon: 'none' }) }) },
    copyImportErrors() {
      const preview = this.data.importPreview
      if (!preview?.errors.length) return
      wx.setClipboardData({ data: createTeacherStudentErrorCsv(preview.errors), success: () => wx.showToast({ title: '错误行结果已复制', icon: 'none' }), fail: () => wx.showToast({ title: '复制错误结果失败', icon: 'none' }) })
    },
    addStudent() { wx.showModal({ title: '新建学员', content: '请在管理后台创建账号并授权班级。', showCancel: false }) },
    async exportStudents() {
      const session = getSession()
      if (!session) return
      const records: TeacherStudentListItem[] = []
      let cursor: string | undefined
      const seen = new Set<string>()
      for (let page = 0; page < 2000; page++) {
        const result = await listTeacherStudents(session.user.id, this.filters(), cursor)
        if (!result.ok) { wx.showToast({ title: result.error.message, icon: 'none' }); return }
        records.push(...result.data.items)
        if (!result.data.nextCursor) break
        if (seen.has(result.data.nextCursor) || records.length > 100000) { wx.showToast({ title: '名单过大，请缩小筛选范围', icon: 'none' }); return }
        seen.add(result.data.nextCursor)
        cursor = result.data.nextCursor
      }
      wx.setClipboardData({ data: exportTeacherStudentsCsv(records), success: () => wx.showToast({ title: `已复制 ${records.length} 条 CSV 记录`, icon: 'none' }), fail: () => wx.showToast({ title: '复制失败，请缩小筛选范围重试', icon: 'none' }) })
    },
  },
})
