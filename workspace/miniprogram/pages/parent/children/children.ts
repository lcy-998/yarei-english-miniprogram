import { ChildView, bindChild, chooseChild, listChildren, unbindChild } from '../../../services/m1-app-service'
import { getSession } from '../../../session/session'

Component({
  data: { loading: true, submitting: false, error: '', children: [] as ChildView[], showAdd: false, studentNumber: '', bindingCode: '', bindingOperationId: '' },
  lifetimes: { attached() { this.loadChildren() } },
  pageLifetimes: { show() { this.loadChildren() } },
  methods: {
    async loadChildren() {
      const session = getSession()
      if (!session) { wx.reLaunch({ url: '/pages/auth/login/login' }); return }
      this.setData({ loading: true, error: '' })
      const result = await listChildren(session.user.id)
      if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
      this.setData({ loading: false, children: result.data })
    },
    toggleAdd() { const showAdd = !this.data.showAdd; this.setData({ showAdd, error: '', studentNumber: '', bindingCode: '', bindingOperationId: showAdd ? `bind_child_${Date.now()}` : '' }) },
    onStudentNumber(event: WechatMiniprogram.Input) { this.setData({ studentNumber: event.detail.value, error: '' }) },
    onBindingCode(event: WechatMiniprogram.Input) { this.setData({ bindingCode: event.detail.value, error: '' }) },
    async addChild() {
      const session = getSession()
      if (!session) return
      this.setData({ submitting: true, error: '' })
      const result = await bindChild(session.user.id, this.data.bindingOperationId, this.data.studentNumber, this.data.bindingCode)
      if (!result.ok) { this.setData({ submitting: false, error: result.error.message }); return }
      this.setData({ submitting: false, showAdd: false, studentNumber: '', bindingCode: '', bindingOperationId: '' })
      wx.showToast({ title: '绑定成功', icon: 'success' })
      this.loadChildren()
    },
    async selectChild(event: WechatMiniprogram.TouchEvent) {
      const session = getSession()
      if (!session) return
      const result = await chooseChild(session.user.id, event.currentTarget.dataset.id as string)
      if (!result.ok) { wx.showToast({ title: result.error.message, icon: 'none' }); return }
      wx.reLaunch({ url: '/pages/parent/home/home' })
    },
    removeChild(event: WechatMiniprogram.TouchEvent) {
      const childId = event.currentTarget.dataset.id as string
      const expectedVersion = event.currentTarget.dataset.version as number | undefined
      wx.showModal({ title: '解除绑定', content: '解绑后将立即无法查看该孩子的全部历史学习信息，学习数据本身不会删除。', confirmText: '确认解绑', confirmColor: '#D9342B', success: async (modal) => {
        if (!modal.confirm) return
        const session = getSession()
        if (!session) return
        const result = await unbindChild(session.user.id, childId, expectedVersion, `unbind_child_${childId}_${Date.now()}`)
        if (!result.ok) { wx.showToast({ title: result.error.message, icon: 'none' }); return }
        wx.showToast({ title: '已解除绑定', icon: 'success' })
        this.loadChildren()
      } })
    },
  },
})

