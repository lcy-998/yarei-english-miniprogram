import type { TeacherPrivateVideo } from '../../../domain/teacher-private-video'
import { listMyVideos, withdrawMyVideo } from '../services/teacher-private-video-service'
import { getSession, setTeacherCatalogResultIds } from '../session/session'

Component({
  data: { items: [] as TeacherPrivateVideo[], loading: false, error: '' },
  pageLifetimes: { show() { this.load() } },
  methods: {
    async load() {
      const session = getSession()
      if (!session || (session.activeRole ?? session.user.role) !== 'teacher') {
        this.setData({ error: '请使用教师账号查看我的视频' }); return
      }
      this.setData({ loading: true, error: '' })
      const result = await listMyVideos(session.user.id)
      this.setData(result.ok ? { items: result.data, loading: false }
        : { error: result.error.message, loading: false })
    },
    create() { wx.navigateTo({ url: '/subpackages/teacher/private-video-editor/private-video-editor' }) },
    edit(event: WechatMiniprogram.TouchEvent) {
      const id = event.currentTarget.dataset.id as string
      if (this.data.items.some(item => item.id === id)) {
        wx.navigateTo({ url: `/subpackages/teacher/private-video-editor/private-video-editor?id=${encodeURIComponent(id)}` })
      }
    },
    assign(event: WechatMiniprogram.TouchEvent) {
      const id = event.currentTarget.dataset.id as string
      if (!this.data.items.some(item => item.id === id && item.status === 'published')) return
      setTeacherCatalogResultIds([id])
      wx.navigateTo({ url: '/subpackages/teacher/publish-task/publish-task' })
    },
    async withdraw(event: WechatMiniprogram.TouchEvent) {
      const id = event.currentTarget.dataset.id as string
      const item = this.data.items.find(row => row.id === id)
      const session = getSession()
      if (!item || item.status !== 'published' || !session) return
      wx.showModal({ title: '停止新布置', content: '下架后不可再布置这个视频，已有任务记录保留。',
        success: async modal => {
          if (!modal.confirm) return
          const result = await withdrawMyVideo(session.user.id, id, item.version)
          if (!result.ok) wx.showToast({ title: result.error.message, icon: 'none' })
          else this.load()
        } })
    },
  },
})
