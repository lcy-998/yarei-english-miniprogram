import { login } from '../../../services/app-service'
import { saveSession } from '../../../session/session'

Component({
  data: { mobile: '13800000001', password: '123456', showPassword: false, loading: false, error: '', topInset: 72 },
  lifetimes: {
    attached() {
      const menuRect = wx.getMenuButtonBoundingClientRect()
      this.setData({ topInset: Math.max(64, Math.ceil(menuRect.bottom + 12)) })
    },
  },
  methods: {
    chooseDemo(event: WechatMiniprogram.TouchEvent) { this.setData({ mobile: event.currentTarget.dataset.mobile as string, error: '' }) },
    onMobile(event: WechatMiniprogram.Input) { this.setData({ mobile: event.detail.value }) },
    onPassword(event: WechatMiniprogram.Input) { this.setData({ password: event.detail.value }) },
    togglePassword() { this.setData({ showPassword: !this.data.showPassword }) },
    forgotPassword() { wx.showToast({ title: '找回密码将在后续页面开放', icon: 'none' }) },
    async submit() {
      if (this.data.loading) return
      this.setData({ loading: true, error: '' })
      const result = await login(this.data.mobile, this.data.password)
      if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
      saveSession(result.data)
      this.setData({ loading: false })
      wx.redirectTo({ url: '/pages/auth/role-select/role-select' })
    },
  },
})
