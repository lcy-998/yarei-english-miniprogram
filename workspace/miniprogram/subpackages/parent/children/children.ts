import { bindChild, listParentChildren, unbindChild } from '../services/app-service'
import type { ParentChildLinkView } from '../domain/types'
import { getCurrentChildId, getSession, setCurrentChildId } from '../session/session'

interface ChildRow extends ParentChildLinkView { id: string; current: boolean; className: string; studentNumber: string }

function toChildRow(child: ParentChildLinkView, currentId: string): ChildRow {
  return { ...child, id: child.childId, current: child.childId === currentId,
    className: child.className || '未分班', studentNumber: child.studentNumber || '—' }
}

Component({
  data: { loading: true, submitting: false, error: '', children: [] as ChildRow[], showAdd: false, studentNumber: '', bindingCode: '', bindingOperationId: '' },
  lifetimes: { attached() { this.loadChildren() } },
  pageLifetimes: { show() { this.loadChildren() } },
  methods: {
    async loadChildren() {
      const session = getSession()
      if (!session || (session.activeRole ?? session.user.role) !== 'parent') {
        this.setData({ children: [], studentNumber: '', bindingCode: '' })
        wx.reLaunch({ url: '/pages/auth/login/login' }); return
      }
      this.setData({ loading: true, error: '' })
      const result = await listParentChildren(session.user.id)
      if (!result.ok) {
        const accessLost = result.error.code === 'FORBIDDEN' || result.error.code === 'NOT_FOUND'
        if (accessLost) setCurrentChildId('')
        this.setData({ loading: false, error: result.error.message,
          ...(accessLost ? { children: [] } : {}) })
        return
      }
      const current = getCurrentChildId()
      const selected = result.data.find((child) => child.childId === current) ?? result.data[0]
      setCurrentChildId(selected?.childId ?? '')
      this.setData({ loading: false, children: result.data.map((child) => toChildRow(child, selected?.childId ?? '')) })
    },
    toggleAdd() { const showAdd = !this.data.showAdd; this.setData({ showAdd, error: '', studentNumber: '', bindingCode: '', bindingOperationId: showAdd ? `bind_child_${Date.now()}` : '' }) },
    onStudentNumber(event: WechatMiniprogram.Input) { this.setData({ studentNumber: event.detail.value, error: '' }) },
    onBindingCode(event: WechatMiniprogram.Input) { this.setData({ bindingCode: event.detail.value, error: '' }) },
    async addChild() {
      const session = getSession()
      if (!session) return
      this.setData({ submitting: true, error: '' })
      const result = await bindChild(session.user.id, { operationId: this.data.bindingOperationId,
        studentNumber: this.data.studentNumber, code: this.data.bindingCode })
      if (!result.ok) { this.setData({ submitting: false, error: result.error.message }); return }
      this.setData({ submitting: false, showAdd: false, studentNumber: '', bindingCode: '', bindingOperationId: '' })
      wx.showToast({ title: '绑定成功', icon: 'success' })
      this.loadChildren()
    },
    async selectChild(event: WechatMiniprogram.TouchEvent) {
      const session = getSession()
      if (!session) return
      const childId = event.currentTarget.dataset.id as string
      if (!this.data.children.some((child) => child.id === childId)) return
      setCurrentChildId(childId)
      wx.reLaunch({ url: '/subpackages/parent/home/home' })
    },
    removeChild(event: WechatMiniprogram.TouchEvent) {
      const childId = event.currentTarget.dataset.id as string
      const expectedVersion = event.currentTarget.dataset.version as number | undefined
      wx.showModal({ title: '解除绑定', content: '解绑后将立即无法查看该孩子的全部历史学习信息，学习数据本身不会删除。', confirmText: '确认解绑', confirmColor: '#D9342B', success: async (modal) => {
        if (!modal.confirm) return
        const session = getSession()
        if (!session) return
        const result = await unbindChild(session.user.id, { childId, expectedVersion: expectedVersion ?? 0,
          operationId: `unbind_child_${childId}_${Date.now()}`, reason: '家长主动解除绑定' })
        if (!result.ok) { wx.showToast({ title: result.error.message, icon: 'none' }); return }
        const children = this.data.children.filter((child) => child.id !== childId)
        const nextCurrent = children.find((child) => child.current) ?? children[0]
        setCurrentChildId(nextCurrent?.id ?? '')
        this.setData({ children: children.map((child) => ({ ...child, current: child.id === nextCurrent?.id })) })
        wx.showToast({ title: '已解除绑定', icon: 'success' })
      } })
    },
  },
})

