import type { InboxNotice, NotificationFilter } from '../../../domain/types'
import { listNotifications, markAllNotificationsRead, markNotificationRead } from '../services/app-service'
import { getSession, setCurrentChildId, setCurrentTaskId } from '../session/session'
import { createPageOperationId } from '../shared/write-intent'

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
    dayOptions: DAY_OPTIONS, hasMore: false, unreadCount: 0, total: 0, requestVersion: 0,
  },
  lifetimes: { attached() { this.loadNotices(true) } },
  pageLifetimes: { show() { if (!this.data.loading) this.loadNotices(true) } },
  methods: {
    async loadNotices(reset: boolean) {
      const session = getSession()
      if (!session) {
        this.setData({ rows: [], unreadCount: 0, total: 0 })
        wx.redirectTo({ url: '/pages/auth/login/login' }); return
      }
      if (this.data.loadingMore) return
      const role = session.activeRole ?? session.user.role
      const requestVersion = this.data.requestVersion + 1
      const offset = reset ? 0 : this.data.rows.length
      this.setData(reset ? { loading: true, error: '', requestVersion }
        : { loadingMore: true, error: '', requestVersion })
      const result = await listNotifications(session.user.id, this.data.filter, offset, 20, this.data.days)
      const current = getSession()
      if (this.data.requestVersion !== requestVersion) return
      if (!current || current.sessionId !== session.sessionId
        || (current.activeRole ?? current.user.role) !== role) {
        this.setData({ loading: false, loadingMore: false, rows: [], unreadCount: 0,
          total: 0, hasMore: false })
        return
      }
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
      const role = session.activeRole ?? session.user.role
      this.setData({ busy: true })
      const result = await markAllNotificationsRead(session.user.id, createPageOperationId('notice_all'))
      const current = getSession()
      if (!current || current.sessionId !== session.sessionId
        || (current.activeRole ?? current.user.role) !== role) {
        this.setData({ busy: false, rows: [], unreadCount: 0, total: 0, hasMore: false })
        return
      }
      this.setData({ busy: false })
      if (!result.ok) { wx.showToast({ title: result.error.message, icon: 'none' }); return }
      this.setData({ unreadCount: 0, rows: this.data.rows.map(row => ({ ...row, readAt: row.readAt ?? result.data.readAt })) })
    },
    async openNotice(event: WechatMiniprogram.TouchEvent) {
      const notice = this.data.rows.find(item => item.id === event.currentTarget.dataset.id)
      const session = getSession()
      if (!notice || !session || this.data.busy) return
      const role = session.activeRole ?? session.user.role
      this.setData({ busy: true })
      const marked = await markNotificationRead(session.user.id, notice.id, createPageOperationId('notice_read'))
      const currentSession = getSession()
      if (!currentSession || currentSession.sessionId !== session.sessionId
        || (currentSession.activeRole ?? currentSession.user.role) !== role) {
        this.setData({ busy: false, rows: [], unreadCount: 0, total: 0, hasMore: false })
        return
      }
      if (!marked.ok) {
        const inaccessible = marked.error.code === 'NOT_FOUND' || marked.error.code === 'FORBIDDEN'
        this.setData({ busy: false,
          ...(inaccessible ? { rows: this.data.rows.filter(row => row.id !== notice.id),
            unreadCount: notice.readAt ? this.data.unreadCount : Math.max(0, this.data.unreadCount - 1),
            total: Math.max(0, this.data.total - 1) } : {}) })
        wx.showToast({ title: inaccessible ? '通知已失效或当前无权查看' : marked.error.message, icon: 'none' })
        return
      }
      const current = marked.data
      if (current.target.kind === 'parent_task' && role !== 'parent'
        || current.target.kind === 'teacher_task' && role !== 'teacher'
        || current.target.kind === 'student_task' && role !== 'student'
        || current.target.kind === 'student_activity' && role !== 'student') {
        this.setData({ busy: false })
        wx.showToast({ title: '请切换到对应身份查看', icon: 'none' })
        return
      }
      if (current.target.kind === 'parent_task' && !current.target.childId) {
        this.setData({ busy: false })
        wx.showToast({ title: '通知缺少孩子信息，请刷新后重试', icon: 'none' })
        return
      }
      this.setData({ rows: this.data.rows.map(row => row.id === notice.id ? { ...row, readAt: current.readAt } : row),
        unreadCount: notice.readAt ? this.data.unreadCount : Math.max(0, this.data.unreadCount - 1) })
      this.setData({ busy: false })
      if (current.target.kind === 'student_activity') {
        wx.navigateTo({ url: `/subpackages/student/checkin-detail/checkin-detail?activityId=${encodeURIComponent(current.target.id)}` })
        return
      }
      if (current.target.kind === 'parent_task') setCurrentChildId(current.target.childId as string)
      setCurrentTaskId(current.target.id)
      const url = current.target.kind === 'parent_task' ? '/subpackages/parent/task-detail/task-detail'
        : current.target.kind === 'teacher_task' ? '/subpackages/teacher/completion/completion'
          : '/subpackages/student/task-detail/task-detail'
      wx.navigateTo({ url })
    },
  },
})
