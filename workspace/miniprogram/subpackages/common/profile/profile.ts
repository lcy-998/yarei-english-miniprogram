import { ProfileView, getProfile, saveProfile } from '../services/m1-app-service'
import { getUser } from '../services/app-service'
import { getCloudAppService, getRepositoryMode } from '../../../repositories/repository-factory'
import { clearSession, getSession, setReadingFavoritesOnly } from '../session/session'
import { getNativeAdminAccess } from '../services/native-admin-service'

Component({
  data: { loading: true, saving: false, error: '', profile: null as ProfileView | null,
    editing: false, displayName: '', canOpenNativeAdmin: false },
  lifetimes: { attached() { this.loadProfile() } },
  pageLifetimes: { show() { this.loadProfile() } },
  methods: {
    async loadProfile() {
      const session = getSession()
      if (!session) { wx.reLaunch({ url: '/pages/auth/login/login' }); return }
      this.setData({ loading: true, error: '', canOpenNativeAdmin: false })
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
        if (profile.role === 'teacher') {
          const access = await getNativeAdminAccess(session.user.id)
          if (getSession()?.user.id === session.user.id && access.ok
            && access.data.permissions.includes('dashboard.read')) this.setData({ canOpenNativeAdmin: true })
        }
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
    openTasks() { wx.navigateTo({ url: '/subpackages/student/task-list/task-list' }) },
    openReading() { setReadingFavoritesOnly(true); wx.navigateTo({ url: '/subpackages/student/reading-library/reading-library' }) },
    openWords() { wx.navigateTo({ url: '/subpackages/student/vocabulary/vocabulary' }) },
    openDubbing() { wx.navigateTo({ url: '/subpackages/student-media/dubbing/dubbing' }) },
    openPhonics() { wx.navigateTo({ url: '/subpackages/student/phonics/phonics' }) },
    openMyWorks() { wx.navigateTo({ url: '/subpackages/student/my-works/my-works' }) },
    openTaskTemplates() { wx.navigateTo({ url: '/subpackages/teacher/task-templates/task-templates' }) },
    async openNativeAdmin() {
      const session = getSession()
      if (!session || session.user.role !== 'teacher') return
      const access = await getNativeAdminAccess(session.user.id)
      if (!access.ok || !access.data.permissions.includes('dashboard.read')) {
        this.setData({ canOpenNativeAdmin: false })
        wx.showToast({ title: '管理授权已失效，请刷新后重试', icon: 'none' })
        return
      }
      wx.navigateTo({ url: '/subpackages/admin/workbench/workbench' })
    },
    openPassword() { wx.navigateTo({ url: '/pages/auth/forgot-password/forgot-password' }) },
    openServiceAgreement() { wx.navigateTo({ url: '/pages/legal/document/document?kind=service' }) },
    openPrivacyPolicy() { wx.navigateTo({ url: '/pages/legal/document/document?kind=privacy' }) },
    switchRole() { wx.navigateTo({ url: '/pages/auth/role-select/role-select' }) },
    logout() { clearSession(); wx.reLaunch({ url: '/pages/auth/login/login' }) },
  },
})

