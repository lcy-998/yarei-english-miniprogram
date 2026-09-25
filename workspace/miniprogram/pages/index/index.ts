import { HomeView } from '../../domain/types'
import { getHome } from '../../services/app-service'
import { getProfile } from '../../services/m1-app-service'
import { getSession, setCurrentTaskId } from '../../session/session'
import { formatTaskDueAt } from '../../shared/task-schedule'

Component({
  data: { loading: true, error: '', home: null as HomeView | null, topInset: 72, heroHeight: 274, dateLabel: '', dueLabel: '', className: '' },
  lifetimes: {
    attached() {
      const menuRect = wx.getMenuButtonBoundingClientRect()
      const topInset = Math.max(64, Math.ceil(menuRect.bottom + 10))
      const today = new Date()
      this.setData({ topInset, heroHeight: topInset + 160, dateLabel: `${today.getMonth() + 1}月${today.getDate()}日` })
      this.loadHome()
    },
  },
  pageLifetimes: { show() { this.loadHome() } },
  methods: {
    async loadHome() {
      const session = getSession()
      if (!session) { wx.redirectTo({ url: '/pages/auth/login/login' }); return }
      this.setData({ loading: true, error: '' })
      const [result, profile] = await Promise.all([getHome(session.user.id), getProfile(session.user.id)])
      if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
      this.setData({ loading: false, home: result.data, className: profile.ok ? profile.data.className ?? '' : result.data.user.className ?? '',
        dueLabel: result.data.task ? formatTaskDueAt(result.data.task.dueAt) : '' })
    },
    openTask() { const taskId = this.data.home?.task?.id; if (taskId) { setCurrentTaskId(taskId); wx.navigateTo({ url: '/pages/student/task-detail/task-detail' }) } },
    openVocabulary() { wx.navigateTo({ url: '/pages/student/vocabulary/vocabulary' }) },
    openNotice() { wx.showToast({ title: '暂无新通知', icon: 'none' }) },
  },
})
