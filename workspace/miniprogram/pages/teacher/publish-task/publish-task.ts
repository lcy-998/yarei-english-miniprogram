import { publishClassroomTask } from '../../../services/app-service'
import { getSession } from '../../../session/session'
import { EMPTY_WRITE_INTENT, WriteIntentState, clearWriteIntent, createPageOperationId, prepareWriteIntent } from '../../../shared/write-intent'

Component({
  data: {
    title: '',
    description: '',
    loading: false,
    error: '',
    publishIntent: EMPTY_WRITE_INTENT as WriteIntentState,
  },
  methods: {
    onTitle(event: WechatMiniprogram.Input) {
      this.setData({ title: event.detail.value, error: '', publishIntent: clearWriteIntent() })
    },
    onDescription(event: WechatMiniprogram.Input) {
      this.setData({ description: event.detail.value, publishIntent: clearWriteIntent() })
    },
    async publish() {
      const session = getSession()
      if (!session || this.data.loading) return
      const normalizedInput = JSON.stringify({ title: this.data.title.trim(), description: this.data.description.trim() })
      const publishIntent = prepareWriteIntent(this.data.publishIntent, normalizedInput, () => createPageOperationId('publish_task'))
      this.setData({ loading: true, error: '', publishIntent })
      const result = await publishClassroomTask(session.user.id, {
        operationId: publishIntent.operationId,
        expectedVersion: 0,
        title: this.data.title,
        description: this.data.description,
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
