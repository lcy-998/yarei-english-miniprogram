import { Task } from '../../../domain/types'
import { getTeacherTasks } from '../../../services/app-service'
import { getSession, setCurrentTaskId } from '../../../session/session'

interface TaskReviewRow extends Task { progressPercent: number; pendingReviewCount: number; menuOpen?: boolean }

Component({
  data: { loading: true, error: '', rows: [] as TaskReviewRow[], typeFilter: '全部类型', statusFilter: '全部状态', dateFilter: '近 30 天', filterOpen: '', suppressClose: false, typeOptions: ['全部类型', '课堂任务', '长期任务'], statusOptions: ['全部状态', '进行中', '已完成', '已过期'], dateOptions: ['近 30 天', '近 7 天'] },
  lifetimes: { attached() { this.loadTasks() } },
  pageLifetimes: { show() { this.loadTasks() } },
  methods: {
    async loadTasks() {
      const session = getSession()
      if (!session) { wx.redirectTo({ url: '/pages/auth/login/login' }); return }
      this.setData({ loading: true, error: '' })
      const result = await getTeacherTasks(session.user.id)
      if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
      const rows = result.data.tasks.map(task => ({ ...task, progressPercent: result.data.progressByTask[task.id] ?? 0, pendingReviewCount: result.data.pendingByTask[task.id] ?? 0 }))
      this.setData({ loading: false, rows: this.filterRows(rows) })
    },
    filterRows(rows: TaskReviewRow[]): TaskReviewRow[] {
      return rows.filter(row => this.data.typeFilter === '全部类型' || (this.data.typeFilter === '课堂任务' && row.deliveryType === 'classroom')).filter(row => this.data.statusFilter === '全部状态' || row.status === this.data.statusFilter)
    },
    closeMenus() { if (this.data.suppressClose) { this.setData({ suppressClose: false }); return } this.setData({ filterOpen: '', rows: this.data.rows.map(row => ({ ...row, menuOpen: false })) }) },
    toggleFilter(event: WechatMiniprogram.TouchEvent) { const key = event.currentTarget.dataset.key as string; this.setData({ filterOpen: this.data.filterOpen === key ? '' : key, suppressClose: true }) },
    chooseFilter(event: WechatMiniprogram.TouchEvent) { const key = event.currentTarget.dataset.key as 'type' | 'status' | 'date'; const value = event.currentTarget.dataset.value as string; const next = key === 'type' ? { typeFilter: value } : key === 'status' ? { statusFilter: value } : { dateFilter: value }; this.setData({ ...next, filterOpen: '', suppressClose: true }, () => this.loadTasks()) },
    openReview(event: WechatMiniprogram.TouchEvent) { setCurrentTaskId(event.currentTarget.dataset.id as string); wx.navigateTo({ url: '/pages/teacher/completion/completion' }) },
    toggleMenu(event: WechatMiniprogram.TouchEvent) { const id = event.currentTarget.dataset.id as string; this.setData({ suppressClose: true, rows: this.data.rows.map(row => ({ ...row, menuOpen: row.id === id ? !row.menuOpen : false })) }) },
    moreAction(event: WechatMiniprogram.TouchEvent) { const action = event.currentTarget.dataset.action as string; const id = event.currentTarget.dataset.id as string; if (action === 'review') { setCurrentTaskId(id); wx.navigateTo({ url: '/pages/teacher/completion/completion' }); return } wx.showToast({ title: action === 'preview' ? '学生视角预览已打开' : action === 'edit' ? '当前任务可在布置页继续编辑' : action === 'copy' ? '已生成再次布置草稿' : '已保留任务记录', icon: 'none' }); this.setData({ rows: this.data.rows.map(row => ({ ...row, menuOpen: false })) }) },
  },
})

