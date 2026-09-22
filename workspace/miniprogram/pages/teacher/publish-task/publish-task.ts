import { TaskDraftOptionsView, getDraftOptions, getTeacherStudent, publishClassroomTask } from '../../../services/app-service'
import { getSession } from '../../../session/session'
import { EMPTY_WRITE_INTENT, WriteIntentState, clearWriteIntent, createPageOperationId, prepareWriteIntent } from '../../../shared/write-intent'

Component({
  data: {
    title: '',
    description: '',
    loading: false,
    optionsLoading: true,
    error: '',
    draftOptions: null as TaskDraftOptionsView | null,
    resourceSummary: '正在加载已授权资源',
    targetSummary: '正在加载发布对象',
    requestedStudentId: '',
    publishIntent: EMPTY_WRITE_INTENT as WriteIntentState,
  },
  lifetimes: {
    attached() {
      const pages = getCurrentPages() as Array<{ options?: Record<string, string> }>
      const requestedStudentId = pages[pages.length - 1]?.options?.studentId ?? ''
      this.setData({ requestedStudentId }, () => this.loadDraftOptions())
    },
  },
  methods: {
    async loadDraftOptions() {
      const session = getSession()
      if (!session) return
      this.setData({ optionsLoading: true, error: '' })
      const result = await getDraftOptions(session.user.id)
      if (!result.ok) {
        this.setData({ optionsLoading: false, error: result.error.message })
        return
      }
      let draftOptions = result.data
      let targetSummary = result.data.selectedClassName
      if (this.data.requestedStudentId) {
        const student = await getTeacherStudent(session.user.id, this.data.requestedStudentId)
        if (!student.ok) {
          this.setData({ optionsLoading: false, error: '该学员不在当前授权范围，无法发起任务' })
          return
        }
        draftOptions = {
          ...result.data,
          selectedClassName: `${student.data.displayName}（1 人）`,
          structuredDraft: {
            ...result.data.structuredDraft,
            target: { type: 'students', studentIds: [student.data.studentId] },
          },
        }
        targetSummary = draftOptions.selectedClassName
      }
      this.setData({
        optionsLoading: false,
        draftOptions,
        resourceSummary: draftOptions.resources.map(item => `${item.title}（${item.requiredCount}）`).join('、'),
        targetSummary,
      })
    },
    onTitle(event: WechatMiniprogram.Input) {
      this.setData({ title: event.detail.value, error: '', publishIntent: clearWriteIntent() })
    },
    onDescription(event: WechatMiniprogram.Input) {
      this.setData({ description: event.detail.value, publishIntent: clearWriteIntent() })
    },
    async publish() {
      const session = getSession()
      if (!session || this.data.loading || this.data.optionsLoading) return
      if (!this.data.draftOptions) {
        this.setData({ error: '任务资源尚未加载，请重试' })
        return
      }
      const structuredDraft = this.data.draftOptions.structuredDraft
      const normalizedInput = JSON.stringify({ title: this.data.title.trim(), description: this.data.description.trim(), structuredDraft })
      const publishIntent = prepareWriteIntent(this.data.publishIntent, normalizedInput, () => createPageOperationId('publish_task'))
      this.setData({ loading: true, error: '', publishIntent })
      const result = await publishClassroomTask(session.user.id, {
        operationId: publishIntent.operationId,
        expectedVersion: 0,
        title: this.data.title,
        description: this.data.description,
        structuredDraft,
      })
      if (!result.ok) {
        this.setData({ loading: false, error: result.error.message })
        return
      }
      this.setData({ publishIntent: clearWriteIntent() })
      wx.showToast({ title: '任务已发布', icon: 'success' })
      setTimeout(() => wx.redirectTo({ url: '/pages/teacher/task-center/task-center' }), 400)
    },
  },
})
