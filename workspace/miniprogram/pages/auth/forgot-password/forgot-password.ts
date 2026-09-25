import { requestPasswordResetCode, resetPassword } from '../../../services/app-service'
import { getRepositoryMode } from '../../../repositories/repository-factory'

Component({
  data: { step: 1, mobile: '', code: '', newPassword: '', confirmPassword: '', loading: false, error: '', codeSent: false, countdown: 0, codeButtonLabel: '获取验证码' },
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
      this.setData({ codeSent: true, countdown: 60, codeButtonLabel: '60 秒' })
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
    nextStep() {
      if (!this.data.codeSent) { this.setData({ error: '请先获取验证码' }); return }
      if (!/^1\d{10}$/.test(this.data.mobile) || !/^\d{6}$/.test(this.data.code)) { this.setData({ error: '请输入正确的手机号和 6 位验证码' }); return }
      this.setData({ step: 2, error: '' })
    },
    async submit() {
      if (this.data.newPassword !== this.data.confirmPassword) { this.setData({ error: '两次输入的密码不一致' }); return }
      this.setData({ loading: true, error: '' })
      const result = await resetPassword(this.data.mobile, this.data.code, this.data.newPassword)
      this.setData({ loading: false })
      if (!result.ok) { this.setData({ error: result.error.message }); return }
      wx.showToast({ title: '密码已更新', icon: 'success' })
      setTimeout(() => wx.redirectTo({ url: '/pages/auth/login/login' }), 500)
    },
    backToLogin() { wx.navigateBack() },
  },
})
