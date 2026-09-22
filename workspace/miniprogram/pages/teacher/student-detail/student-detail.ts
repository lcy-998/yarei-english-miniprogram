import { StudentDetailView, getTeacherStudent } from '../../../services/m1-app-service'
import { getCurrentStudentId, getSession } from '../../../session/session'

Component({
  data: { loading: true, error: '', student: null as StudentDetailView | null, currentTab: 'tasks' },
  lifetimes: { attached() { this.loadStudent() } },
  methods: {
    async loadStudent() {
      const session = getSession()
      if (!session) { wx.reLaunch({ url: '/pages/auth/login/login' }); return }
      this.setData({ loading: true, error: '' })
      const result = await getTeacherStudent(session.user.id, getCurrentStudentId())
      if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
      this.setData({ loading: false, student: result.data })
    },
    setTab(event: WechatMiniprogram.TouchEvent) { this.setData({ currentTab: event.currentTarget.dataset.tab as string }) },
    editStudent() { wx.showToast({ title: '资料编辑需管理权限', icon: 'none' }) },
    startTask() { wx.navigateTo({ url: '/pages/teacher/publish-task/publish-task' }) },
    transferStudent() { wx.showModal({ title: '转班', content: '转班会改变学员的班级授权范围，请在管理后台确认目标班级。', showCancel: false }) },
    disableStudent() { wx.showModal({ title: '停用学员', content: '停用后学员将无法登录，但历史学习记录会保留。是否继续？', confirmText: '确认停用', confirmColor: '#D9342B', success: (result) => { if (result.confirm) wx.showToast({ title: '演示环境未执行停用', icon: 'none' }) } }) },
  },
})

