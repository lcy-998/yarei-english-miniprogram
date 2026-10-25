import type { TaskStatus } from '../../../domain/types'
import type { TeacherCheckFilters, TeacherCheckItem } from '../../../domain/teacher-check'
import { copyTeacherTaskSnapshot, deleteActivityDraft, deleteTeacherDraftTask, getTeacherTaskForEdit,
  previewTeacherTask, recycleTeacherTask } from '../services/app-service'
import { listTeacherCheckItems } from '../services/teacher-check-service'
import { getSession, setCurrentTaskId, setTeacherTaskCopy } from '../session/session'
import { EMPTY_WRITE_INTENT, createPageOperationId,
  prepareWriteIntent, type WriteIntentState } from '../shared/write-intent'

interface TaskReviewRow extends TeacherCheckItem { progressPercent: number; menuOpen?: boolean;
  statusLabel: string; dueLabel: string; typeLabel: string }

const STATUS_OPTIONS: ReadonlyArray<{ label: string; value: TaskStatus | 'all' }> = [
  { label: '全部状态', value: 'all' }, { label: '草稿', value: 'draft' }, { label: '待开始', value: 'scheduled' },
  { label: '进行中', value: 'active' }, { label: '已完成', value: 'completed' }, { label: '已过期', value: 'expired' },
  { label: '已撤回', value: 'withdrawn' }, { label: '已关闭', value: 'closed' },
]
const DATE_OPTIONS = ['全部时间', '近 7 天', '近 30 天']

function displayDate(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '时间未提供' : `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function dateBefore(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

Component({
  data: {
    loading: true, loadingMore: false, error: '', rows: [] as TaskReviewRow[], keyword: '',
    nextOffset: null as number | null, total: 0, queryVersion: 0,
    classFilter: '全部班级', classId: '', classOptions: [{ id: '', name: '全部班级' }],
    copyInProgress: false, copySourceKey: '', copyOperationId: '',
    draftDeleteReasons: {} as Record<string, string>,
    draftDeleteIntents: {} as Record<string, WriteIntentState>,
    typeFilter: '全部类型', statusFilter: '全部状态', dateFilter: '近 30 天', filterOpen: '', suppressClose: false,
    typeOptions: ['全部类型', '课堂任务', '打卡活动'], statusOptions: STATUS_OPTIONS, dateOptions: DATE_OPTIONS,
  },
  lifetimes: { attached() { this.loadTasks() } },
  pageLifetimes: { show() { this.loadTasks() } },
  methods: {
    async loadTasks() {
      const session = getSession()
      if (!session || session.user.role !== 'teacher') { wx.redirectTo({ url: '/pages/auth/login/login' }); return }
      const queryVersion = this.data.queryVersion + 1
      this.setData({ loading: true, error: '', rows: [], nextOffset: null, queryVersion })
      const result = await listTeacherCheckItems(session.user.id, this.filters(), 20, 0)
      if (queryVersion !== this.data.queryVersion) return
      if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
      const classOptions = [{ id: '', name: '全部班级' }, ...result.data.classes]
      this.setData({ loading: false, rows: result.data.items.map(item => this.toRow(item)),
        total: result.data.total, nextOffset: result.data.nextOffset, classOptions,
        classFilter: classOptions.find(item => item.id === this.data.classId)?.name ?? '全部班级' })
    },
    filters(): TeacherCheckFilters {
      const statusValue = STATUS_OPTIONS.find(option => option.label === this.data.statusFilter)?.value ?? 'all'
      const days = this.data.dateFilter === '近 7 天' ? 7 : this.data.dateFilter === '近 30 天' ? 30 : 0
      return { ...(this.data.typeFilter === '课堂任务' ? { type: 'classroom' as const }
        : this.data.typeFilter === '打卡活动' ? { type: 'checkin' as const } : {}),
      ...(this.data.classId ? { classId: this.data.classId } : {}),
      ...(statusValue !== 'all' ? { status: statusValue } : {}),
      ...(days ? { startsOn: dateBefore(days) } : {}),
      ...(this.data.keyword.trim() ? { keyword: this.data.keyword.trim() } : {}) }
    },
    toRow(item: TeacherCheckItem): TaskReviewRow {
      return { ...item,
        progressPercent: item.completedCount === null || item.totalCount === 0 ? 0
          : Math.round(item.completedCount * 100 / item.totalCount),
        statusLabel: STATUS_OPTIONS.find(option => option.value === item.status)?.label ?? item.status,
        dueLabel: displayDate(item.dueOn), typeLabel: item.kind === 'checkin' ? '打卡活动' : '课堂任务' }
    },
    async loadMore() {
      const session = getSession()
      const offset = this.data.nextOffset
      if (!session || offset === null || this.data.loading || this.data.loadingMore) return
      const queryVersion = this.data.queryVersion
      this.setData({ loadingMore: true, error: '' })
      const result = await listTeacherCheckItems(session.user.id, this.filters(), 20, offset)
      if (queryVersion !== this.data.queryVersion) return
      if (!result.ok) { this.setData({ loadingMore: false, error: result.error.message }); return }
      const known = new Set(this.data.rows.map(row => `${row.kind}:${row.id}`))
      this.setData({ loadingMore: false, total: result.data.total, nextOffset: result.data.nextOffset,
        rows: [...this.data.rows, ...result.data.items.filter(item => !known.has(`${item.kind}:${item.id}`))
          .map(item => this.toRow(item))] })
    },
    onSearch(event: WechatMiniprogram.Input) { this.setData({ keyword: event.detail.value }, () => this.loadTasks()) },
    chooseClass(event: WechatMiniprogram.TouchEvent) { const id = event.currentTarget.dataset.id as string
      const choice = this.data.classOptions.find(item => item.id === id); if (!choice) return
      this.setData({ classId: id, classFilter: choice.name, filterOpen: '', suppressClose: true }, () => this.loadTasks()) },
    closeMenus() { if (this.data.suppressClose) { this.setData({ suppressClose: false }); return } this.setData({ filterOpen: '', rows: this.data.rows.map(row => ({ ...row, menuOpen: false })) }) },
    toggleFilter(event: WechatMiniprogram.TouchEvent) { const key = event.currentTarget.dataset.key as string; this.setData({ filterOpen: this.data.filterOpen === key ? '' : key, suppressClose: true }) },
    chooseFilter(event: WechatMiniprogram.TouchEvent) { const key = event.currentTarget.dataset.key as 'type' | 'status' | 'date'; const value = event.currentTarget.dataset.value as string; const next = key === 'type' ? { typeFilter: value } : key === 'status' ? { statusFilter: value } : { dateFilter: value }; this.setData({ ...next, filterOpen: '', suppressClose: true }, () => this.loadTasks()) },
    openReview(event: WechatMiniprogram.TouchEvent) {
      const id = event.currentTarget.dataset.id as string
      const row = this.data.rows.find(item => item.id === id)
      if (!row) return
      if (row.kind === 'checkin') { wx.navigateTo({ url: `/subpackages/teacher/checkin-activities/checkin-activities?activityId=${encodeURIComponent(row.id)}` }); return }
      if (row.status === 'draft') {
        wx.navigateTo({ url: `/subpackages/teacher/publish-task/publish-task?editTaskId=${encodeURIComponent(id)}` })
        return
      }
      setCurrentTaskId(id)
      wx.navigateTo({ url: '/subpackages/teacher/completion/completion' })
    },
    toggleMenu(event: WechatMiniprogram.TouchEvent) { const id = event.currentTarget.dataset.id as string; this.setData({ suppressClose: true, rows: this.data.rows.map(row => ({ ...row, menuOpen: row.id === id ? !row.menuOpen : false })) }) },
    async moreAction(event: WechatMiniprogram.TouchEvent) {
      const action = event.currentTarget.dataset.action as string
      const row = this.data.rows.find(item => item.id === event.currentTarget.dataset.id)
      const session = getSession()
      if (!row || !session) return
      if (row.kind === 'checkin') {
        if (action === 'deleteActivityDraft' && row.canDeleteDraft) {
          wx.showModal({ title: '彻底删除活动草稿？', editable: true,
            placeholderText: '填写删除原因', content: this.data.draftDeleteReasons[row.id] ?? '',
            confirmText: '确认删除', confirmColor: '#D9342B', success: async answer => {
              if (!answer.confirm) return
              const reason = answer.content.trim()
              if (!reason || reason.length > 200) {
                wx.showToast({ title: '请填写 1—200 字删除原因', icon: 'none' }); return
              }
              const fingerprint = JSON.stringify({ activityId: row.id, version: row.version, reason })
              const intent = prepareWriteIntent(this.data.draftDeleteIntents[row.id] ?? EMPTY_WRITE_INTENT,
                fingerprint, () => createPageOperationId('activity_delete_draft'))
              this.setData({ draftDeleteReasons: { ...this.data.draftDeleteReasons, [row.id]: reason },
                draftDeleteIntents: { ...this.data.draftDeleteIntents, [row.id]: intent } })
              const result = await deleteActivityDraft(session.user.id, row.id, row.version,
                reason, intent.operationId)
              if (!result.ok) { wx.showToast({ title: result.error.message, icon: 'none' }); return }
              wx.showToast({ title: '活动草稿已彻底删除', icon: 'none' }); this.loadTasks()
            } })
          return
        }
        if (action === 'review' || action === 'edit' || action === 'recycle') {
          wx.navigateTo({ url: `/subpackages/teacher/checkin-activities/checkin-activities?activityId=${encodeURIComponent(row.id)}` })
        }
        return
      }
      if (action === 'review') { setCurrentTaskId(row.id); wx.navigateTo({ url: '/subpackages/teacher/completion/completion' }); return }
      if (action === 'copy') {
        if (this.data.copyInProgress) return
        this.setData({ copyInProgress: true })
        try {
          const source = await getTeacherTaskForEdit(session.user.id, row.id)
          if (!source.ok) { wx.showToast({ title: source.error.message, icon: 'none' }); return }
          if (source.data.status === 'draft') { wx.showToast({ title: '草稿请直接编辑', icon: 'none' }); return }
          if (!source.data.itemRefs.length || source.data.itemRefs.length !== source.data.items.length) {
            wx.showToast({ title: '原任务内容快照不完整，无法再次布置', icon: 'none' }); return
          }
          const copySourceKey = `${source.data.taskId}:${source.data.version}`
          const copyOperationId = this.data.copySourceKey === copySourceKey && this.data.copyOperationId
            ? this.data.copyOperationId : createPageOperationId('copy_task')
          this.setData({ copySourceKey, copyOperationId })
          const copied = await copyTeacherTaskSnapshot(session.user.id, source.data.taskId,
            source.data.version, copyOperationId)
          if (!copied.ok) {
            if (copied.error.code === 'CONFLICT' || copied.error.code === 'VALIDATION_ERROR') {
              this.setData({ copySourceKey: '', copyOperationId: '' })
            }
            wx.showToast({ title: copied.error.message, icon: 'none' }); return
          }
          this.setData({ copySourceKey: '', copyOperationId: '' })
          if (copied.data) {
            wx.navigateTo({ url: `/subpackages/teacher/publish-task/publish-task?editTaskId=${encodeURIComponent(copied.data.taskId)}` })
            return
          }
          setTeacherTaskCopy({ title: source.data.title, description: source.data.description ?? '',
            itemRefs: source.data.itemRefs, items: source.data.items })
          wx.navigateTo({ url: '/subpackages/teacher/publish-task/publish-task' })
        } catch (_error: unknown) {
          wx.showToast({ title: '复制暂未完成，请重试', icon: 'none' })
        } finally { this.setData({ copyInProgress: false }) }
        return
      }
      if (action === 'preview') {
        const result = await previewTeacherTask(session.user.id, row.id, row.version)
        if (!result.ok) { wx.showToast({ title: result.error.message, icon: 'none' }); return }
        const preview = result.data
        wx.showModal({ title: '学生视角预览', content: `${preview.title}\n${preview.description ?? '无额外要求'}\n内容：${preview.items.map(item => item.title).join('、') || '暂无内容'}\n截止：${displayDate(preview.dueAt)}`, showCancel: false })
        return
      }
      if (action === 'edit') {
        wx.navigateTo({ url: `/subpackages/teacher/publish-task/publish-task?editTaskId=${encodeURIComponent(row.id)}` })
        return
      }
      if (action === 'deleteDraft') {
        wx.showModal({ title: '彻底删除未发布草稿？', editable: true,
          placeholderText: '填写删除原因', content: this.data.draftDeleteReasons[row.id] ?? '',
          confirmText: '确认删除', confirmColor: '#D9342B', success: async answer => {
            if (!answer.confirm) return
            const reason = answer.content.trim()
            if (!reason || reason.length > 200) {
              wx.showToast({ title: '请填写 1—200 字删除原因', icon: 'none' }); return
            }
            const fingerprint = JSON.stringify({ taskId: row.id, version: row.version, reason })
            const intent = prepareWriteIntent(this.data.draftDeleteIntents[row.id] ?? EMPTY_WRITE_INTENT,
              fingerprint, () => createPageOperationId('delete_draft_task'))
            this.setData({ draftDeleteReasons: { ...this.data.draftDeleteReasons, [row.id]: reason },
              draftDeleteIntents: { ...this.data.draftDeleteIntents, [row.id]: intent } })
            const result = await deleteTeacherDraftTask(session.user.id, row.id, row.version,
              reason, intent.operationId)
            if (!result.ok) { wx.showToast({ title: result.error.message, icon: 'none' }); return }
            const reasons = { ...this.data.draftDeleteReasons }
            const intents = { ...this.data.draftDeleteIntents }
            delete reasons[row.id]
            delete intents[row.id]
            this.setData({ draftDeleteReasons: reasons, draftDeleteIntents: intents })
            wx.showToast({ title: '草稿已彻底删除', icon: 'none' }); this.loadTasks()
          } })
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
