import { listParentChildren, listParentTasks } from '../services/app-service'
import type { ParentTaskListView, ParentTaskStatusGroup } from '../../../services/parent-task-types'
import { getCurrentChildId, getSession, setCurrentChildId, setCurrentTaskId } from '../session/session'
import { assignmentStatusLabel } from '../shared/assignment-status'
import { formatTaskDueAt } from '../shared/task-schedule'

type TaskRow = ParentTaskListView & { statusLabel: string; dueLabel: string;
  submittedLabel: string; scoreLabel: string; typeLabel: string; iconName: string }

const STATUS_OPTIONS: Array<{ label: string; value: ParentTaskStatusGroup | 'all' }> = [
  { label: '全部', value: 'all' }, { label: '进行中', value: 'active' },
  { label: '待检查', value: 'awaiting_review' }, { label: '已完成', value: 'completed' },
]
const DAY_OPTIONS = [7, 30, 90] as const

function schoolDateBefore(days: number): string {
  const date = new Date(Date.now() + 8 * 60 * 60 * 1000)
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString().slice(0, 10)
}

function submittedLabel(value: string | null): string {
  if (!value) return '尚未提交'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '提交时间未记录'
  const school = new Date(date.getTime() + 8 * 60 * 60 * 1000)
  return `提交于 ${school.getUTCMonth() + 1}月${school.getUTCDate()}日 ${String(school.getUTCHours()).padStart(2, '0')}:${String(school.getUTCMinutes()).padStart(2, '0')}`
}

function taskRow(item: ParentTaskListView): TaskRow {
  const typeNames: Record<string, string> = { listening: '听力', reading: '阅读', recording: '录音',
    video: '看视频', vocabulary: '单词', exercise: '习题', dubbing: '视频配音' }
  const typeLabel = [...new Set(item.contentTypes.map(type => typeNames[type] ?? '其他内容'))]
    .join('、') || '课堂任务'
  const singleType = item.contentTypes.length === 1 ? item.contentTypes[0] ?? '' : ''
  const iconName = ({ listening: 'headphones', reading: 'reading', recording: 'microphone',
    video: 'video', vocabulary: 'vocabulary', exercise: 'exercise', dubbing: 'dubbing' } as Record<string, string>)[singleType] ?? 'task'
  return { ...item, statusLabel: assignmentStatusLabel(item.status, '待检查'),
    dueLabel: formatTaskDueAt(item.dueAt), submittedLabel: submittedLabel(item.submittedAt),
    scoreLabel: item.score === null ? '未记录' : `${item.score} 分`, typeLabel, iconName }
}

Component({
  data: {
    loading: true, loadingMore: false, error: '', requestVersion: 0,
    childId: '', childName: '', childAvatarText: '', childClassName: '', hasChildren: true,
    rows: [] as TaskRow[], total: 0, nextCursor: null as string | null,
    statusOptions: STATUS_OPTIONS, statusGroup: 'all' as ParentTaskStatusGroup | 'all',
    dayOptions: DAY_OPTIONS, dayIndex: 1, days: 30 as 7 | 30 | 90,
  },
  lifetimes: { attached() { this.loadChildrenAndTasks() } },
  pageLifetimes: { show() { if (!this.data.loading) this.loadChildrenAndTasks() } },
  methods: {
    async loadChildrenAndTasks() {
      const session = getSession()
      if (!session || (session.activeRole ?? session.user.role) !== 'parent') {
        this.setData({ rows: [], childId: '', childName: '' })
        wx.redirectTo({ url: '/pages/auth/login/login' })
        return
      }
      const requestVersion = this.data.requestVersion + 1
      this.setData({ loading: true, error: '', requestVersion, rows: [], total: 0, nextCursor: null,
        childId: '', childName: '', childAvatarText: '', childClassName: '' })
      const result = await listParentChildren(session.user.id)
      if (this.data.requestVersion !== requestVersion) return
      const current = getSession()
      if (!current || current.sessionId !== session.sessionId
        || (current.activeRole ?? current.user.role) !== 'parent') {
        this.setData({ loading: false, rows: [], childId: '', childName: '' })
        return
      }
      if (!result.ok) { this.setData({ loading: false, error: result.error.message,
        childId: '', childName: '', rows: [] }); return }
      if (!result.data.length) { this.setData({ loading: false, hasChildren: false,
        childId: '', childName: '', rows: [] }); return }
      const child = result.data.find(item => item.childId === getCurrentChildId()) ?? result.data[0]
      setCurrentChildId(child.childId)
      this.setData({ childId: child.childId, childName: child.displayName,
        childAvatarText: child.displayName.slice(-1),
        childClassName: child.className ?? '', hasChildren: true }, () => this.loadTasks(true))
    },
    async loadTasks(reset: boolean) {
      const session = getSession()
      const childId = this.data.childId
      if (!session || !childId || (session.activeRole ?? session.user.role) !== 'parent') return
      if (!reset && (!this.data.nextCursor || this.data.loadingMore)) return
      const requestVersion = this.data.requestVersion + 1
      this.setData(reset ? { loading: true, loadingMore: false, error: '', requestVersion,
        rows: [], total: 0, nextCursor: null } : { loadingMore: true, error: '', requestVersion })
      const filters = { startsOn: schoolDateBefore(this.data.days - 1), endsOn: schoolDateBefore(0),
        ...(this.data.statusGroup === 'all' ? {} : { statusGroup: this.data.statusGroup }) }
      const result = await listParentTasks(session.user.id, filters,
        { limit: 20, ...(reset ? {} : { cursor: this.data.nextCursor as string }) })
      if (this.data.requestVersion !== requestVersion || getCurrentChildId() !== childId) return
      const current = getSession()
      if (!current || current.sessionId !== session.sessionId
        || (current.activeRole ?? current.user.role) !== 'parent') {
        this.setData({ loading: false, loadingMore: false, rows: [], childId: '', childName: '' })
        return
      }
      if (!result.ok) { this.setData({ loading: false, loadingMore: false,
        error: result.error.message, ...(reset ? { rows: [], total: 0, nextCursor: null } : {}) }); return }
      this.setData({ loading: false, loadingMore: false, error: '',
        rows: reset ? result.data.items.map(taskRow) : [...this.data.rows, ...result.data.items.map(taskRow)],
        total: result.data.total, nextCursor: result.data.nextCursor })
    },
    chooseStatus(event: WechatMiniprogram.TouchEvent) {
      const group = event.currentTarget.dataset.value as ParentTaskStatusGroup | 'all'
      if (!STATUS_OPTIONS.some(item => item.value === group) || group === this.data.statusGroup) return
      this.setData({ statusGroup: group }, () => this.loadTasks(true))
    },
    chooseDays(event: WechatMiniprogram.PickerChange) {
      const days = DAY_OPTIONS[Number(event.detail.value)]
      if (!days || days === this.data.days) return
      this.setData({ days, dayIndex: Number(event.detail.value) }, () => this.loadTasks(true))
    },
    loadMore() { this.loadTasks(false) },
    retry() { if (this.data.childId) this.loadTasks(this.data.rows.length === 0)
      else this.loadChildrenAndTasks() },
    openTask(event: WechatMiniprogram.TouchEvent) {
      const taskId = String(event.currentTarget.dataset.taskId ?? '')
      if (!this.data.rows.some(item => item.taskId === taskId)) return
      setCurrentTaskId(taskId)
      wx.navigateTo({ url: '/subpackages/parent/task-detail/task-detail' })
    },
    openChildren() { wx.navigateTo({ url: '/subpackages/parent/children/children' }) },
  },
})
