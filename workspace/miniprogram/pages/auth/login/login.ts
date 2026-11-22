import { login } from '../../../services/auth-service'
import { postLoginPath, ROLE_SELECT_PATH } from '../../../session/auth-flow'
import { saveSession } from '../../../session/session'
import { consentError } from '../../../legal/legal-config'

Component({
  data: { mobile: '', password: '', showPassword: false, loading: false, error: '', topInset: 72, accepted: false },
  lifetimes: {
    attached() {
      const menuRect = wx.getMenuButtonBoundingClientRect()
      this.setData({ topInset: Math.max(64, Math.ceil(menuRect.bottom + 12)) })
    },
  },
  methods: {
    onConsent(event: WechatMiniprogram.CustomEvent<{ accepted: boolean }>) {
      if (this.data.loading) return
      const accepted = event.detail.accepted === true && !consentError(true)
      this.setData({ accepted, error: '', ...(!accepted ? { mobile: '', password: '', showPassword: false } : {}) })
    },
    onMobile(event: WechatMiniprogram.Input) {
      if (!consentError(this.data.accepted) && !this.data.loading) this.setData({ mobile: event.detail.value })
    },
    onPassword(event: WechatMiniprogram.Input) {
      if (!consentError(this.data.accepted) && !this.data.loading) this.setData({ password: event.detail.value })
    },
    togglePassword() { this.setData({ showPassword: !this.data.showPassword }) },
    forgotPassword() { wx.navigateTo({ url: '/pages/auth/forgot-password/forgot-password' }) },
    async submit() {
      if (this.data.loading) return
      const error = consentError(this.data.accepted)
      if (error) { this.setData({ error }); return }
      this.setData({ loading: true, error: '' })
      const result = await login(this.data.mobile, this.data.password)
      if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
      saveSession(result.data)
      this.setData({ loading: false })
      const url = postLoginPath(result.data)
      if (url === ROLE_SELECT_PATH) wx.redirectTo({ url })
      else wx.reLaunch({ url })
    },
  },
})
