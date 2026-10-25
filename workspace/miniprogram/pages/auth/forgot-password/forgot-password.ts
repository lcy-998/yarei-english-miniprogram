import { requestPasswordResetCode, resetPassword, verifyPasswordResetCode } from '../../../services/auth-service'
import { getRepositoryMode } from '../../../repositories/repository-factory'

Component({
  data: { step: 1, mobile: '', code: '', newPassword: '', confirmPassword: '', loading: false, error: '',
    codeSent: false, countdown: 0, codeButtonLabel: '获取验证码', verificationExpiresAt: 0,
    verificationSecondsRemaining: 0, verificationCountdownLabel: '' },
  methods: {
    onMobile(event: WechatMiniprogram.Input) { this.setData({ mobile: event.detail.value, error: '' }) },
    onCode(event: WechatMiniprogram.Input) { this.setData({ code: event.detail.value, error: '' }) },
    onNewPassword(event: WechatMiniprogram.Input) { this.setData({ newPassword: event.detail.value, error: '' }) },
    onConfirmPassword(event: WechatMiniprogram.Input) { this.setData({ confirmPassword: event.detail.value, error: '' }) },
    async sendCode() {
      if (this.data.loading || this.data.countdown > 0) return
      this.setData({ loading: true, error: '' })
      const result = await requestPasswordResetCode(this.data.mobile)
      this.setData({ loading: false })
      if (!result.ok) { this.setData({ error: result.error.message }); return }
      this.setData({ codeSent: true, countdown: 60, codeButtonLabel: '60 秒', code: '',
        verificationExpiresAt: 0, verificationSecondsRemaining: 0, verificationCountdownLabel: '' })
      this.tickCountdown()
      wx.showToast({ title: getRepositoryMode() === 'cloudbase' ? '验证码已发送，请查收短信' : '演示验证码：246810', icon: 'none' })
    },
    tickCountdown() {
      if (this.data.countdown <= 0) return
      setTimeout(() => {
        if (this.data.countdown <= 0) return
        const countdown = this.data.countdown - 1
        this.setData({ countdown, codeButtonLabel: countdown > 0 ? `${countdown} 秒` : '重新获取' })
        this.tickCountdown()
      }, 1000)
    },
    async nextStep() {
      if (this.data.loading) return
      if (!this.data.codeSent) { this.setData({ error: '请先获取验证码' }); return }
      if (!/^1\d{10}$/.test(this.data.mobile) || !/^\d{6}$/.test(this.data.code)) { this.setData({ error: '请输入正确的手机号和 6 位验证码' }); return }
      this.setData({ loading: true, error: '' })
      const result = await verifyPasswordResetCode(this.data.mobile, this.data.code)
      if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
      const verificationExpiresAt = Date.now() + result.data.expiresInSeconds * 1000
      this.setData({ loading: false, step: 2, error: '', verificationExpiresAt,
        verificationSecondsRemaining: result.data.expiresInSeconds }, () => this.tickVerificationCountdown())
    },
    tickVerificationCountdown() {
      if (this.data.step !== 2 || this.data.verificationExpiresAt <= 0) return
      const remaining = Math.max(0, Math.ceil((this.data.verificationExpiresAt - Date.now()) / 1000))
      const minutes = Math.floor(remaining / 60)
      const seconds = remaining % 60
      this.setData({ verificationSecondsRemaining: remaining,
        verificationCountdownLabel: remaining > 0
          ? `验证码已验证，剩余 ${minutes} 分 ${String(seconds).padStart(2, '0')} 秒可设置密码`
          : '验证码验证已过期，请重新验证手机号' })
      if (remaining > 0) setTimeout(() => this.tickVerificationCountdown(), 1000)
    },
    restartVerification() {
      this.setData({ step: 1, code: '', newPassword: '', confirmPassword: '', loading: false, error: '',
        codeSent: false, countdown: 0, codeButtonLabel: '重新获取', verificationExpiresAt: 0,
        verificationSecondsRemaining: 0, verificationCountdownLabel: '' })
    },
    async submit() {
      if (this.data.loading) return
      if (this.data.verificationSecondsRemaining <= 0) {
        this.setData({ error: '验证码验证已过期，请重新验证手机号' }); return
      }
      if (this.data.newPassword !== this.data.confirmPassword) { this.setData({ error: '两次输入的密码不一致' }); return }
      if (this.data.newPassword.length < 8 || this.data.newPassword.length > 32
        || !/[A-Za-z]/.test(this.data.newPassword) || !/\d/.test(this.data.newPassword)) {
        this.setData({ error: '新密码需为 8—32 位且同时包含字母和数字' }); return
      }
      this.setData({ loading: true, error: '' })
      const result = await resetPassword(this.data.mobile, this.data.newPassword)
      this.setData({ loading: false })
      if (!result.ok) {
        const expired = result.error.code === 'VALIDATION_ERROR' && result.error.message.includes('验证码')
        this.setData({ error: result.error.message,
          ...(expired ? { verificationSecondsRemaining: 0, verificationCountdownLabel: '验证码验证已过期，请重新验证手机号' } : {}) })
        return
      }
      wx.showToast({ title: '密码已更新', icon: 'success' })
      setTimeout(() => wx.redirectTo({ url: '/pages/auth/login/login' }), 500)
    },
    backToLogin() { wx.navigateBack() },
  },
})
