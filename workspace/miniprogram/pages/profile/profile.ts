import { ProfileView, getProfile, saveProfile } from '../../services/m1-app-service'
import { getUser } from '../../services/app-service'
import { getCloudAppService, getRepositoryMode } from '../../repositories/repository-factory'
import { clearSession, getSession, setReadingFavoritesOnly } from '../../session/session'

Component({
  data: { loading: true, saving: false, error: '', profile: null as ProfileView | null, editing: false, displayName: '' },
  lifetimes: { attached() { this.loadProfile() } },
  pageLifetimes: { show() { this.loadProfile() } },
  methods: {
    async loadProfile() {
      const session = getSession()
      if (!session) { wx.reLaunch({ url: '/pages/auth/login/login' }); return }
      this.setData({ loading: true, error: '' })
      if (getRepositoryMode() === 'cloudbase') {
        const result = await getUser(session.user.id)
        if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
        const profile: ProfileView = {
          userId: result.data.id,
          displayName: result.data.displayName,
          maskedMobile: '已绑定开发测试账号',
          role: result.data.role,
          roleLabel: result.data.role === 'student' ? '学生' : result.data.role === 'teacher' ? '教师' : '家长',
          organization: '启航实验学校',
          ...(result.data.className === undefined ? {} : { className: result.data.className }),
        }
        this.setData({ loading: false, profile, displayName: profile.displayName })
        return
      }
      const result = await getProfile(session.user.id)
      if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
      this.setData({ loading: false, profile: result.data, displayName: result.data.displayName })
    },
    toggleEdit() { this.setData({ editing: !this.data.editing, error: '', displayName: this.data.profile?.displayName ?? '' }) },
    onName(event: WechatMiniprogram.Input) { this.setData({ displayName: event.detail.value, error: '' }) },
    async save() {
      const session = getSession()
      if (!session) return
      if (getRepositoryMode() === 'cloudbase') {
        const service = getCloudAppService()
        if (!service) { this.setData({ error: '云端资料服务暂不可用' }); return }
        this.setData({ saving: true, error: '' })
        const result = await service.updateProfile(session.user.id, this.data.displayName)
        if (!result.ok) { this.setData({ saving: false, error: result.error.message }); return }
        const profile = this.data.profile
        this.setData({
          saving: false,
          editing: false,
          profile: profile === null ? null : { ...profile, displayName: result.data.displayName },
          displayName: result.data.displayName,
        })
        wx.showToast({ title: '资料已保存', icon: 'success' })
        return
      }
      this.setData({ saving: true })
      const result = await saveProfile(session.user.id, this.data.displayName)
      if (!result.ok) { this.setData({ saving: false, error: result.error.message }); return }
      this.setData({ saving: false, editing: false, profile: result.data })
      wx.showToast({ title: '资料已保存', icon: 'success' })
    },
    openTasks() { wx.navigateTo({ url: '/pages/student/task-list/task-list' }) },
    openReading() { setReadingFavoritesOnly(true); wx.navigateTo({ url: '/pages/student/reading-library/reading-library' }) },
    openWords() { wx.navigateTo({ url: '/pages/student/vocabulary/vocabulary' }) },
    openPassword() { wx.navigateTo({ url: '/pages/auth/forgot-password/forgot-password' }) },
    switchRole() { wx.navigateTo({ url: '/pages/auth/role-select/role-select' }) },
    logout() { clearSession(); wx.reLaunch({ url: '/pages/auth/login/login' }) },
  },
})

