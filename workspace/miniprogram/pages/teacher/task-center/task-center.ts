import { Task } from '../../../domain/types'
import { getTeacherTasks } from '../../../services/app-service'
import { getSession, setCurrentAssignmentId, setCurrentTaskId } from '../../../session/session'

interface TeacherTaskRow extends Task {
  progressPercent: number
  pendingReviewCount: number
  dueLabel: string
}

Component({
  data: { loading: true, loadVersion: 0, error: '', tasks: [] as TeacherTaskRow[], allTasks: [] as TeacherTaskRow[], pendingCount: 0, statusFilter: '进行中', keyword: '' },
  pageLifetimes: { show() { this.loadTasks() } },
  methods: {
    async loadTasks() {
      const session = getSession()
      if (!session) { wx.redirectTo({ url: '/pages/auth/login/login' }); return }
      const loadVersion = this.data.loadVersion + 1
      this.setData({ loading: true, error: '', loadVersion })
      const result = await getTeacherTasks(session.user.id)
      if (loadVersion !== this.data.loadVersion) return
      if (!result.ok) { this.setData({ loading: false, error: result.error.message, tasks: [] }); return }
      const tasks = result.data.tasks.map((task) => ({ ...task, progressPercent: result.data.progressByTask[task.id] ?? 0, pendingReviewCount: result.data.pendingByTask[task.id] ?? 0, dueLabel: formatDue(task.dueAt) }))
      this.setData({ loading: false, allTasks: tasks, pendingCount: result.data.pendingCount }, () => this.applyFilter())
    },
    toggleStatusFilter() { this.setData({ statusFilter: this.data.statusFilter === '全部任务' ? '进行中' : '全部任务' }, () => this.applyFilter()) },
    onSearch(event: WechatMiniprogram.Input) { this.setData({ keyword: event.detail.value }, () => this.applyFilter()) },
    applyFilter() { const keyword = this.data.keyword.trim().toLowerCase(); this.setData({ tasks: this.data.allTasks.filter(item => (this.data.statusFilter !== '进行中' || item.status === 'active') && (!keyword || item.title.toLowerCase().includes(keyword))) }) },
    publish() {
      wx.showActionSheet({ itemList: ['课堂任务', '打卡活动', '模板布置'], success: result => {
        if (result.tapIndex === 0) wx.navigateTo({ url: '/pages/teacher/publish-task/publish-task' })
        else if (result.tapIndex === 1) wx.navigateTo({ url: '/pages/teacher/checkin-activities/checkin-activities' })
        else wx.navigateTo({ url: '/pages/teacher/task-templates/task-templates' })
      } })
    },
    focusTasks() { wx.navigateTo({ url: '/pages/teacher/task-review-list/task-review-list' }) },
    quickReview() {
      const task = this.data.allTasks.find((item) => item.pendingReviewCount > 0)
      setCurrentTaskId(task?.id ?? '')
      setCurrentAssignmentId('')
      wx.navigateTo({ url: '/pages/teacher/review-task/review-task' })
    },
    review(event: WechatMiniprogram.TouchEvent) {
      const taskId = event.currentTarget.dataset.id as string
      if (this.data.tasks.find(item => item.id === taskId)?.status === 'draft') { wx.navigateTo({ url: `/pages/teacher/publish-task/publish-task?editTaskId=${encodeURIComponent(taskId)}` }); return }
      setCurrentTaskId(taskId)
      wx.navigateTo({ url: '/pages/teacher/completion/completion' })
    },
  },
})

function formatDue(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '时间未提供' : `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}
