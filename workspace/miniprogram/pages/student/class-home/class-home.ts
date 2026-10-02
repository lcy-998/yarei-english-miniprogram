import type { ActivityView, StudentClassView } from '../../../domain/types'
import { getMyClass, listStudentActivities } from '../../../services/app-service'
import { getSession } from '../../../session/session'

Component({
  data: {
    loading: true,
    error: '',
    classInfo: null as StudentClassView | null,
    teacherLabel: '',
    activities: [] as ActivityView[],
    activitiesLoading: false,
    activityError: '',
  },
  lifetimes: { attached() { this.loadClass() } },
  pageLifetimes: { show() { if (this.data.classInfo) this.loadClass() } },
  methods: {
    async loadClass() {
      const session = getSession()
      if (!session) { wx.reLaunch({ url: '/pages/auth/login/login' }); return }
      if ((session.activeRole ?? session.user.role) !== 'student') { this.setData({ loading: false, error: '当前身份不能查看学生班级' }); return }
      this.setData({ loading: true, error: '' })
      const result = await getMyClass(session.user.id)
      if (!result.ok) {
        const authorizationChanged = result.error.code === 'FORBIDDEN' || result.error.code === 'NOT_FOUND'
          || result.error.code === 'UNAUTHENTICATED'
        this.setData({ loading: false, error: result.error.message,
          ...(authorizationChanged ? { classInfo: null, activities: [], activityError: '' } : {}) }); return
      }
      const classChanged = this.data.classInfo?.id !== result.data.id
      this.setData({
        loading: false,
        classInfo: result.data,
        ...(classChanged ? { activities: [] } : {}),
        teacherLabel: result.data.teacherNames.join('、') || '暂未分配',
      })
      await this.loadActivities()
    },
    async loadActivities() {
      const session = getSession()
      if (!session) return
      this.setData({ activitiesLoading: true, activityError: '' })
      const result = await listStudentActivities(session.user.id)
      if (!result.ok) { this.setData({ activitiesLoading: false, activities: [], activityError: result.error.message }); return }
      this.setData({ activitiesLoading: false, activities: result.data.filter(item => item.status !== 'draft') })
    },
    openLeaderboard(event: WechatMiniprogram.TouchEvent) {
      const id = event.currentTarget.dataset.id as string
      if (!this.data.activities.some(item => item.id === id)) return
      wx.navigateTo({ url: `/pages/student/checkin-leaderboard/checkin-leaderboard?activityId=${encodeURIComponent(id)}` })
    },
    openActivity(event: WechatMiniprogram.TouchEvent) {
      const id = event.currentTarget.dataset.id as string
      if (!this.data.activities.some(item => item.id === id)) return
      wx.navigateTo({ url: `/pages/student/checkin-detail/checkin-detail?activityId=${encodeURIComponent(id)}` })
    },
  },
})
