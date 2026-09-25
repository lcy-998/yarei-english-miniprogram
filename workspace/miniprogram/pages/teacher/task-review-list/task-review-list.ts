import { Task, TaskStatus } from '../../../domain/types'
import { getTeacherTasks, previewTeacherTask, recycleTeacherTask } from '../../../services/app-service'
import { getSession, setCurrentTaskId, setTeacherTaskCopy } from '../../../session/session'
import { createPageOperationId } from '../../../shared/write-intent'

interface TaskReviewRow extends Task { progressPercent: number; pendingReviewCount: number; menuOpen?: boolean; statusLabel: string; dueLabel: string }

const STATUS_OPTIONS: ReadonlyArray<{ label: string; value: TaskStatus | 'all' }> = [
  { label: '全部状态', value: 'all' }, { label: '草稿', value: 'draft' }, { label: '待开始', value: 'scheduled' },
  { label: '进行中', value: 'active' }, { label: '已完成', value: 'completed' }, { label: '已过期', value: 'expired' },
  { label: '已撤回', value: 'withdrawn' }, { label: '已关闭', value: 'closed' },
]
const DATE_OPTIONS = ['全部时间', '近 7 天', '近 30 天']

function displayDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '时间未提供' : `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

Component({
  data: {
    loading: true, error: '', rows: [] as TaskReviewRow[], allRows: [] as TaskReviewRow[], keyword: '',
    typeFilter: '全部类型', statusFilter: '全部状态', dateFilter: '近 30 天', filterOpen: '', suppressClose: false,
    typeOptions: ['全部类型', '课堂任务'], statusOptions: STATUS_OPTIONS, dateOptions: DATE_OPTIONS,
  },
  lifetimes: { attached() { this.loadTasks() } },
  pageLifetimes: { show() { this.loadTasks() } },
  methods: {
    async loadTasks() {
      const session = getSession()
      if (!session || session.user.role !== 'teacher') { wx.redirectTo({ url: '/pages/auth/login/login' }); return }
      this.setData({ loading: true, error: '' })
      const result = await getTeacherTasks(session.user.id)
      if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
      const allRows = result.data.tasks.map(task => ({
        ...task, progressPercent: result.data.progressByTask[task.id] ?? 0, pendingReviewCount: result.data.pendingByTask[task.id] ?? 0,
        statusLabel: STATUS_OPTIONS.find(option => option.value === task.status)?.label ?? task.status,
        dueLabel: displayDate(task.dueAt),
      }))
      this.setData({ loading: false, allRows }, () => this.applyFilters())
    },
    applyFilters() {
      const statusValue = STATUS_OPTIONS.find(option => option.label === this.data.statusFilter)?.value ?? 'all'
      const keyword = this.data.keyword.trim().toLowerCase()
      const now = Date.now()
      const days = this.data.dateFilter === '近 7 天' ? 7 : this.data.dateFilter === '近 30 天' ? 30 : 0
      const rows = this.data.allRows.filter(row => {
        if (statusValue !== 'all' && row.status !== statusValue) return false
        if (keyword && !row.title.toLowerCase().includes(keyword)) return false
        if (days && Date.parse(row.dueAt) < now - days * 24 * 60 * 60 * 1000) return false
        return true
      })
      this.setData({ rows })
    },
    onSearch(event: WechatMiniprogram.Input) { this.setData({ keyword: event.detail.value }, () => this.applyFilters()) },
    closeMenus() { if (this.data.suppressClose) { this.setData({ suppressClose: false }); return } this.setData({ filterOpen: '', rows: this.data.rows.map(row => ({ ...row, menuOpen: false })) }) },
    toggleFilter(event: WechatMiniprogram.TouchEvent) { const key = event.currentTarget.dataset.key as string; this.setData({ filterOpen: this.data.filterOpen === key ? '' : key, suppressClose: true }) },
    chooseFilter(event: WechatMiniprogram.TouchEvent) { const key = event.currentTarget.dataset.key as 'type' | 'status' | 'date'; const value = event.currentTarget.dataset.value as string; const next = key === 'type' ? { typeFilter: value } : key === 'status' ? { statusFilter: value } : { dateFilter: value }; this.setData({ ...next, filterOpen: '', suppressClose: true }, () => this.applyFilters()) },
    openReview(event: WechatMiniprogram.TouchEvent) { setCurrentTaskId(event.currentTarget.dataset.id as string); wx.navigateTo({ url: '/pages/teacher/completion/completion' }) },
    toggleMenu(event: WechatMiniprogram.TouchEvent) { const id = event.currentTarget.dataset.id as string; this.setData({ suppressClose: true, rows: this.data.rows.map(row => ({ ...row, menuOpen: row.id === id ? !row.menuOpen : false })) }) },
    async moreAction(event: WechatMiniprogram.TouchEvent) {
      const action = event.currentTarget.dataset.action as string
      const row = this.data.allRows.find(item => item.id === event.currentTarget.dataset.id)
      const session = getSession()
      if (!row || !session) return
      if (action === 'review') { setCurrentTaskId(row.id); wx.navigateTo({ url: '/pages/teacher/completion/completion' }); return }
      if (action === 'preview' || action === 'copy') {
        const result = await previewTeacherTask(session.user.id, row.id, row.version)
        if (!result.ok) { wx.showToast({ title: result.error.message, icon: 'none' }); return }
        const preview = result.data
        if (action === 'copy') {
          setTeacherTaskCopy({ title: preview.title, description: preview.description ?? '', items: preview.items.map(item => ({ resourceId: item.resourceId, type: item.type })) })
          wx.navigateTo({ url: '/pages/teacher/publish-task/publish-task' })
          return
        }
        wx.showModal({ title: '学生视角预览', content: `${preview.title}\n${preview.description ?? '无额外要求'}\n内容：${preview.items.map(item => item.title).join('、') || '暂无内容'}\n截止：${displayDate(preview.dueAt)}`, showCancel: false })
        return
      }
      if (action === 'edit') {
        wx.navigateTo({ url: `/pages/teacher/publish-task/publish-task?editTaskId=${encodeURIComponent(row.id)}` })
        return
      }
      if (action === 'delete') {
        wx.showModal({ title: '回收已发布任务', editable: true, placeholderText: '填写删除原因', content: '', confirmText: '确认回收', confirmColor: '#D9342B', success: async answer => {
          if (!answer.confirm) return
          if (!answer.content.trim()) { wx.showToast({ title: '请填写删除原因', icon: 'none' }); return }
          const result = await recycleTeacherTask(session.user.id, row.id, row.version, answer.content.trim(), createPageOperationId('recycle_task'))
          if (!result.ok) { wx.showToast({ title: result.error.message, icon: 'none' }); return }
          wx.showToast({ title: '任务已回收', icon: 'success' }); this.loadTasks()
        } })
      }
    },
  },
})
