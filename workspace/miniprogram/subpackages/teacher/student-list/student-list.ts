import { TeacherStudentListItem, TeacherStudentStatusFilter } from '../domain/types'
import { listTeacherStudents } from '../services/app-service'
import { getSession, setCurrentStudentId } from '../session/session'
import { ImportIssue, ImportPreview, createTeacherStudentErrorCsv, createTeacherStudentImportResultCsv, createTeacherStudentImportTemplate, previewTeacherStudentCsv, projectTeacherStudentImportErrors } from '../shared/teacher-student-csv'
import { createPageOperationId } from '../shared/write-intent'
import { importTeacherStudents, type TeacherStudentBulkImportView } from '../services/teacher-student-import-service'

let selectedCsvBytes: Uint8Array | null = null
let selectedImportUserId = ''

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
    importOperationId: '', importResult: null as TeacherStudentBulkImportView | null,
    formalImportErrors: [] as ImportIssue[], importError: '', importCreatedCount: 0, importRejectedCount: 0,
  },
  lifetimes: { attached() { this.loadStudents() }, detached() {
    selectedCsvBytes = null
    selectedImportUserId = ''
  } },
  pageLifetimes: { show() {
    if (selectedImportUserId && selectedImportUserId !== getSession()?.user.id) {
      selectedCsvBytes = null
      selectedImportUserId = ''
      this.setData({ importPreviewOpen: false, importPreview: null, importResult: null,
        importOperationId: '', importError: '' })
    }
    this.loadStudents()
  } },
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
    openStudent(event: WechatMiniprogram.TouchEvent) { setCurrentStudentId(event.currentTarget.dataset.id as string); wx.navigateTo({ url: '/subpackages/teacher/student-detail/student-detail' }) },
    openStats() { wx.navigateTo({ url: '/subpackages/teacher/learning-stats/learning-stats' }) },
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
          const bytes = new Uint8Array(readResult.data)
          const preview = previewTeacherStudentCsv(bytes, this.data.classOptions.filter(item => item.id).map(item => item.id), existing)
          selectedCsvBytes = bytes
          selectedImportUserId = session.user.id
          this.setData({ importBusy: false, importPreviewOpen: true, importFileName: file.name,
            importPreview: preview, visibleImportErrors: preview.errors.slice(0, 10),
            importOperationId: createPageOperationId('teacher_student_import'), importResult: null,
            importError: '', importCreatedCount: 0, importRejectedCount: 0 })
        }, fail: () => { this.setData({ importBusy: false }); wx.showToast({ title: '文件读取失败，请重试', icon: 'none' }) } })
      } })
    },
    closeImportPreview() {
      selectedCsvBytes = null
      selectedImportUserId = ''
      this.setData({ importPreviewOpen: false, importPreview: null, visibleImportErrors: [],
        importResult: null, formalImportErrors: [], importError: '', importOperationId: '' })
    },
    requestFormalImport() {
      const preview = this.data.importPreview
      const session = getSession()
      if (!preview || preview.blocked || !preview.readyRowCount || !selectedCsvBytes
        || !session || session.user.role !== 'teacher' || session.user.id !== selectedImportUserId
        || this.data.importBusy || !this.data.importOperationId) return
      wx.showModal({ title: '确认正式导入学员？',
        content: `文件 ${this.data.importFileName}：共 ${preview.totalRowCount} 行，本地预检可用 ${preview.readyRowCount} 行、错误 ${preview.rejectedRowCount} 行。服务端还会重新核对账号、权限和重复信息；仅成功行会创建账号。`,
        confirmText: '确认导入', success: result => { if (result.confirm) this.submitFormalImport() } })
    },
    async submitFormalImport() {
      const session = getSession()
      const bytes = selectedCsvBytes
      if (!session || session.user.role !== 'teacher' || session.user.id !== selectedImportUserId
        || !bytes || !this.data.importOperationId || this.data.importBusy) return
      this.setData({ importBusy: true, importError: '' })
      const uploadBuffer = new ArrayBuffer(bytes.byteLength)
      new Uint8Array(uploadBuffer).set(bytes)
      const csvBase64 = wx.arrayBufferToBase64(uploadBuffer)
      let result: Awaited<ReturnType<typeof importTeacherStudents>>
      try {
        result = await importTeacherStudents(session.user.id, csvBase64, this.data.importOperationId)
      } catch (_error: unknown) {
        this.setData({ importBusy: false, importError: '账号服务暂时不可用' })
        return
      }
      if (!result.ok) {
        this.setData({ importBusy: false, importError: result.error.message })
        return
      }
      const createdCount = result.data.outcomes.filter(item => item.status === 'created').length
      const rejectedCount = result.data.outcomes.length - createdCount
      selectedCsvBytes = null
      selectedImportUserId = ''
      this.setData({ importBusy: false, importResult: result.data, importCreatedCount: createdCount,
        importRejectedCount: rejectedCount, formalImportErrors: projectTeacherStudentImportErrors(
          result.data.outcomes, result.data.validationErrors), importError: '' })
      this.loadStudents()
    },
    copyImportTemplate() { wx.setClipboardData({ data: createTeacherStudentImportTemplate(), success: () => wx.showToast({ title: 'CSV 模板已复制', icon: 'none' }), fail: () => wx.showToast({ title: '复制模板失败', icon: 'none' }) }) },
    copyImportErrors() {
      const preview = this.data.importPreview
      if (!preview?.errors.length) return
      wx.setClipboardData({ data: createTeacherStudentErrorCsv(preview.errors), success: () => wx.showToast({ title: '错误行结果已复制', icon: 'none' }), fail: () => wx.showToast({ title: '复制错误结果失败', icon: 'none' }) })
    },
    exportImportPreviewErrors() {
      const errors = this.data.importPreview?.errors ?? []
      if (errors.length) this.exportImportErrorCsv(createTeacherStudentErrorCsv(errors), 'student-import-preview-errors.csv')
    },
    exportImportResultErrors() {
      const result = this.data.importResult
      if (!result || !this.data.formalImportErrors.length) return
      this.exportImportErrorCsv(createTeacherStudentImportResultCsv(result.outcomes, result.validationErrors), 'student-import-errors.csv')
    },
    exportImportErrorCsv(csv: string, fileName: string) {
      const fallbackToClipboard = () => wx.setClipboardData({ data: csv,
        success: () => wx.showToast({ title: '当前设备不支持保存文件，错误 CSV 已复制', icon: 'none' }),
        fail: () => wx.showToast({ title: '错误结果导出失败', icon: 'none' }) })
      const filePath = `${wx.env.USER_DATA_PATH}/${fileName}`
      wx.getFileSystemManager().writeFile({ filePath, data: csv, encoding: 'utf8',
        success: () => {
          if (typeof wx.saveFileToDisk !== 'function') { fallbackToClipboard(); return }
          wx.saveFileToDisk({ filePath,
            success: () => wx.showToast({ title: '错误 CSV 已保存', icon: 'success' }),
            fail: fallbackToClipboard })
        },
        fail: fallbackToClipboard })
    },
    addStudent() { wx.showModal({ title: '新建学员', content: '请在管理后台创建账号并授权班级。', showCancel: false }) },
  },
})
