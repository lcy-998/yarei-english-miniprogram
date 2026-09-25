import { TeacherStudentClassOption, TeacherStudentDetail } from '../../../domain/types'
import { getTeacherStudent, listTeacherStudents, setTeacherStudentStatus, transferTeacherStudent, updateTeacherStudent } from '../../../services/app-service'
import { getCurrentStudentId, getSession, setTeacherTaskTargetStudentId, takeTeacherTaskTargetStudentId } from '../../../session/session'
import { createPageOperationId } from '../../../shared/write-intent'

Component({
  data: {
    loading: true, saving: false, error: '', student: null as TeacherStudentDetail | null,
    currentTab: 'tasks', visibleTasks: [] as TeacherStudentDetail['recentTasks'],
    editDraftName: '',
    classes: [] as TeacherStudentClassOption[], transferClassIndex: 0,
  },
  lifetimes: { attached() { this.loadStudent() } },
  pageLifetimes: { show() { this.loadStudent() } },
  methods: {
    async loadStudent() {
      const session = getSession()
      if (!session || session.user.role !== 'teacher') { wx.reLaunch({ url: '/pages/auth/login/login' }); return }
      this.setData({ loading: true, error: '' })
      const studentId = getCurrentStudentId()
      const [detail, list] = await Promise.all([getTeacherStudent(session.user.id, studentId), listTeacherStudents(session.user.id, { status: 'all' })])
      if (!detail.ok) { this.setData({ loading: false, error: detail.error.message }); return }
      const classes = list.ok ? list.data.classes.filter(item => item.id !== detail.data.classInfo.id) : []
      this.setData({ loading: false, student: detail.data, classes, transferClassIndex: 0 }, () => this.updateVisibleTasks())
    },
    setTab(event: WechatMiniprogram.TouchEvent) { this.setData({ currentTab: event.currentTarget.dataset.tab as string }, () => this.updateVisibleTasks()) },
    updateVisibleTasks() {
      const tasks = this.data.student?.recentTasks ?? []
      this.setData({ visibleTasks: this.data.currentTab === 'scores' ? tasks.filter(item => item.score !== null) : tasks })
    },
    editStudent() {
      const student = this.data.student
      if (!student || this.data.saving) return
      wx.showModal({ title: '编辑学员姓名', editable: true, content: this.data.editDraftName || student.displayName, confirmText: '保存', success: async answer => {
        if (!answer.confirm) return
        const displayName = answer.content.trim()
        this.setData({ editDraftName: displayName })
        if (!displayName || displayName.length > 50) { wx.showToast({ title: '姓名须为 1—50 字', icon: 'none' }); return }
        if (student.userVersion === undefined || student.membershipVersion === undefined) { wx.showToast({ title: '请更新服务后重试', icon: 'none' }); return }
        const session = getSession()
        if (!session) return
        this.setData({ saving: true })
        const result = await updateTeacherStudent(session.user.id, { studentId: student.studentId, classId: student.classInfo.id, displayName, expectedUserVersion: student.userVersion, expectedMembershipVersion: student.membershipVersion, reason: '教师编辑学员姓名', operationId: createPageOperationId('student_profile') })
        this.setData({ saving: false })
        if (!result.ok) { wx.showToast({ title: result.error.message, icon: 'none' }); return }
        this.setData({ editDraftName: '' })
        wx.showToast({ title: '资料已更新', icon: 'success' })
        this.loadStudent()
      } })
    },
    startTask() {
      const studentId = this.data.student?.studentId
      if (studentId) {
        setTeacherTaskTargetStudentId(studentId)
        wx.navigateTo({ url: `/pages/teacher/publish-task/publish-task?studentId=${encodeURIComponent(studentId)}`, fail: () => { takeTeacherTaskTargetStudentId() } })
      }
    },
    onTransferClassChange(event: WechatMiniprogram.PickerChange) { this.setData({ transferClassIndex: Number(event.detail.value) }) },
    transferStudent() {
      const student = this.data.student
      const target = this.data.classes[this.data.transferClassIndex]
      if (!student || !target || this.data.saving) { wx.showToast({ title: '暂无可转入的授权班级', icon: 'none' }); return }
      if (student.userVersion === undefined || student.membershipVersion === undefined || student.classInfo.version === undefined || target.version === undefined) { wx.showToast({ title: '请更新服务后重试', icon: 'none' }); return }
      wx.showModal({ title: '确认转班', content: `将 ${student.displayName} 转入 ${target.name}？历史任务记录会保留。`, confirmText: '确认转班', success: async answer => {
        if (!answer.confirm) return
        const session = getSession()
        if (!session) return
        this.setData({ saving: true })
        const result = await transferTeacherStudent(session.user.id, {
          studentId: student.studentId, sourceClassId: student.classInfo.id, targetClassId: target.id,
          expectedUserVersion: student.userVersion!, expectedMembershipVersion: student.membershipVersion!, expectedTargetMembershipVersion: student.membershipVersions?.[target.id] ?? 0,
          expectedSourceClassVersion: student.classInfo.version!, expectedTargetClassVersion: target.version!, reason: '教师确认学员转班', operationId: createPageOperationId('student_transfer'),
        })
        this.setData({ saving: false })
        if (!result.ok) { wx.showToast({ title: result.error.message, icon: 'none' }); return }
        wx.showToast({ title: '转班已完成', icon: 'success' })
        this.loadStudent()
      } })
    },
    disableStudent() {
      const student = this.data.student
      if (!student || this.data.saving) return
      if (student.userVersion === undefined || student.membershipVersion === undefined || student.classInfo.version === undefined) { wx.showToast({ title: '请更新服务后重试', icon: 'none' }); return }
      const disabling = student.accountStatus === 'active'
      wx.showModal({ title: disabling ? '停用学员' : '恢复学员', content: disabling ? '停用后学员将无法登录，历史记录仍会保留。' : '确认恢复该学员账号？', confirmText: disabling ? '确认停用' : '确认恢复', confirmColor: disabling ? '#D9342B' : '#1764D8', success: async answer => {
        if (!answer.confirm) return
        const session = getSession()
        if (!session) return
        this.setData({ saving: true })
        const result = await setTeacherStudentStatus(session.user.id, {
          studentId: student.studentId, classId: student.classInfo.id, status: disabling ? 'disabled' : 'active',
          expectedUserVersion: student.userVersion!, expectedMembershipVersion: student.membershipVersion!, expectedClassVersion: student.classInfo.version!,
          reason: disabling ? '教师确认停用学员' : '教师确认恢复学员', operationId: createPageOperationId('student_status'),
        })
        this.setData({ saving: false })
        if (!result.ok) { wx.showToast({ title: result.error.message, icon: 'none' }); return }
        wx.showToast({ title: disabling ? '学员已停用' : '学员已恢复', icon: 'success' })
        this.loadStudent()
      } })
    },
  },
})
