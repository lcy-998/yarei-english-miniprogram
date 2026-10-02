import type { InboxNotice, NotificationFilter } from '../../domain/types'
import { listNotifications, markAllNotificationsRead, markNotificationRead } from '../../services/app-service'
import { getSession, setCurrentChildId, setCurrentTaskId } from '../../session/session'
import { createPageOperationId } from '../../shared/write-intent'

interface NoticeRow extends InboxNotice { timeLabel: string; displayTitle: string; displaySubtitle: string }
const FILTERS: Array<{ label: string; value: NotificationFilter }> = [
  { label: '全部', value: 'all' }, { label: '任务', value: 'task' },
  { label: '点评', value: 'feedback' }, { label: '打卡', value: 'checkin' },
]
const DAY_OPTIONS: Array<{ label: string; value: 7 | 30 | 90 }> = [
  { label: '近7天', value: 7 }, { label: '近30天', value: 30 }, { label: '近90天', value: 90 },
]

function timeLabel(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '时间未提供'
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

Component({
  data: {
    loading: true, loadingMore: false, busy: false, error: '', rows: [] as NoticeRow[],
    filter: 'all' as NotificationFilter, filters: FILTERS, days: 30 as 7 | 30 | 90,
    dayOptions: DAY_OPTIONS, hasMore: false, unreadCount: 0, total: 0,
  },
  lifetimes: { attached() { this.loadNotices(true) } },
  pageLifetimes: { show() { if (!this.data.loading) this.loadNotices(true) } },
  methods: {
    async loadNotices(reset: boolean) {
      const session = getSession()
      if (!session) { wx.redirectTo({ url: '/pages/auth/login/login' }); return }
      if (this.data.loadingMore) return
      const offset = reset ? 0 : this.data.rows.length
      this.setData(reset ? { loading: true, error: '' } : { loadingMore: true, error: '' })
      const result = await listNotifications(session.user.id, this.data.filter, offset, 20, this.data.days)
      if (!result.ok) {
        this.setData({ loading: false, loadingMore: false, error: result.error.message,
          ...(reset ? { rows: [], unreadCount: 0, total: 0, hasMore: false } : {}) })
        return
      }
      const rows = result.data.items.map(item => {
        const specificTitle = item.summary.trim()
        return { ...item, timeLabel: timeLabel(item.occurredAt),
          displayTitle: specificTitle || item.title,
          displaySubtitle: specificTitle && specificTitle !== item.title ? item.title : '' }
      })
      this.setData({ loading: false, loadingMore: false, rows: reset ? rows : [...this.data.rows, ...rows],
        hasMore: result.data.hasMore, unreadCount: result.data.unreadCount, total: result.data.total })
    },
    chooseFilter(event: WechatMiniprogram.TouchEvent) {
      const filter = event.currentTarget.dataset.value as NotificationFilter
      if (!FILTERS.some(item => item.value === filter) || filter === this.data.filter) return
      this.setData({ filter, rows: [] }, () => this.loadNotices(true))
    },
    chooseDays(event: WechatMiniprogram.PickerChange) {
      const days = DAY_OPTIONS[Number(event.detail.value)]?.value
      if (!days || days === this.data.days) return
      this.setData({ days, rows: [] }, () => this.loadNotices(true))
    },
    loadMore() { if (this.data.hasMore && !this.data.loadingMore) this.loadNotices(false) },
    refreshNotices() { this.loadNotices(true) },
    async markAll() {
      const session = getSession()
      if (!session || this.data.busy || this.data.unreadCount === 0) return
      this.setData({ busy: true })
      const result = await markAllNotificationsRead(session.user.id, createPageOperationId('notice_all'))
      this.setData({ busy: false })
      if (!result.ok) { wx.showToast({ title: result.error.message, icon: 'none' }); return }
      this.setData({ unreadCount: 0, rows: this.data.rows.map(row => ({ ...row, readAt: row.readAt ?? result.data.readAt })) })
    },
    async openNotice(event: WechatMiniprogram.TouchEvent) {
      const notice = this.data.rows.find(item => item.id === event.currentTarget.dataset.id)
      const session = getSession()
      if (!notice || !session || this.data.busy) return
      this.setData({ busy: true })
      if (!notice.readAt) {
        const marked = await markNotificationRead(session.user.id, notice.id, createPageOperationId('notice_read'))
        if (!marked.ok) {
          this.setData({ busy: false })
          wx.showToast({ title: marked.error.message, icon: 'none' })
          return
        }
        this.setData({ rows: this.data.rows.map(row => row.id === notice.id ? { ...row, readAt: marked.data.readAt } : row),
          unreadCount: Math.max(0, this.data.unreadCount - 1) })
      }
      this.setData({ busy: false })
      if (notice.target.kind === 'student_activity') {
        wx.navigateTo({ url: `/pages/student/checkin-detail/checkin-detail?activityId=${encodeURIComponent(notice.target.id)}` })
        return
      }
      if (notice.target.kind === 'parent_task' && notice.target.childId) setCurrentChildId(notice.target.childId)
      setCurrentTaskId(notice.target.id)
      const url = notice.target.kind === 'parent_task' ? '/pages/parent/task-detail/task-detail'
        : notice.target.kind === 'teacher_task' ? '/pages/teacher/completion/completion'
          : '/pages/student/task-detail/task-detail'
      wx.navigateTo({ url })
    },
  },
})
