import { HomeView } from '../../domain/types'
import { getHome } from '../../services/app-service'
import { getSession, setCurrentTaskId } from '../../session/session'

Component({
  data: { loading: true, error: '', home: null as HomeView | null, topInset: 72, heroHeight: 274, dateLabel: '' },
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
      const result = await getHome(session.user.id)
      if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
      this.setData({ loading: false, home: result.data })
    },
    openTask() { const taskId = this.data.home?.task?.id; if (taskId) { setCurrentTaskId(taskId); wx.navigateTo({ url: '/pages/student/task-detail/task-detail' }) } },
    openVocabulary() { wx.showToast({ title: '单词练习将在 M1 接入', icon: 'none' }) },
    openNotice() { wx.showToast({ title: '暂无新通知', icon: 'none' }) },
  },
})
