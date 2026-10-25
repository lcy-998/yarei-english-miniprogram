import type { ReviewFeedback } from '../../../domain/types'
import { getParentTask, listParentChildren } from '../services/app-service'
import { getParentFeedbackVoicePlayback } from '../services/parent-feedback-voice-service'
import { getCurrentChildId, getCurrentTaskId, getSession } from '../session/session'

interface FeedbackVersion { version: number; label: string; submittedAt: string | null;
  feedback: ReviewFeedback | null }
let activeFeedbackAudio: WechatMiniprogram.InnerAudioContext | null = null
function stopFeedbackAudio(): void { activeFeedbackAudio?.destroy(); activeFeedbackAudio = null }
function publishedLabel(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '时间未记录'
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

Component({
  data: { loading: true, error: '', taskTitle: '', versions: [] as FeedbackVersion[],
    requestVersion: 0,
    selectedVersion: 0, selectedSubmittedAtLabel: '',
    feedback: null as ReviewFeedback | null, feedbackTime: '',
    childDisplayName: '', childClassName: '',
    parentAssignmentId: '', childId: '', taskId: '',
    voiceLoading: false, voicePlaying: false, voiceMessage: '', voiceRequestVersion: 0 },
  lifetimes: { attached() { this.loadFeedback() }, detached() { stopFeedbackAudio() } },
  pageLifetimes: { show() { if (!this.data.loading) this.loadFeedback() },
    hide() { stopFeedbackAudio(); this.setData({ loading: false, voicePlaying: false, voiceLoading: false,
      voiceRequestVersion: this.data.voiceRequestVersion + 1,
      requestVersion: this.data.requestVersion + 1 }) } },
  methods: {
    async loadFeedback() {
      stopFeedbackAudio()
      const session = getSession()
      const taskId = getCurrentTaskId()
      const childId = getCurrentChildId()
      const requestVersion = this.data.requestVersion + 1
      if (!session || (session.activeRole ?? session.user.role) !== 'parent' || !taskId) {
        this.setData({ loading: false, error: '请重新进入孩子任务', versions: [], feedback: null,
          feedbackTime: '', parentAssignmentId: '', voicePlaying: false, voiceLoading: false })
        return
      }
      this.setData({ loading: true, error: '', versions: [], feedback: null, feedbackTime: '',
        childDisplayName: '', childClassName: '',
        requestVersion,
        parentAssignmentId: '', voicePlaying: false, voiceLoading: false, voiceMessage: '',
        voiceRequestVersion: this.data.voiceRequestVersion + 1 })
      const result = await getParentTask(session.user.id, taskId)
      if (this.data.requestVersion !== requestVersion) return
      const currentSession = getSession()
      if (!currentSession || currentSession.sessionId !== session.sessionId
        || (currentSession.activeRole ?? currentSession.user.role) !== 'parent') {
        this.setData({ loading: false, versions: [], feedback: null, taskTitle: '',
          parentAssignmentId: '', error: '请重新进入家长反馈' })
        return
      }
      if (getCurrentTaskId() !== taskId || getCurrentChildId() !== childId) {
        this.setData({ loading: false, versions: [], feedback: null, parentAssignmentId: '',
          error: '任务或孩子已切换，请重新打开' }); return
      }
      if (!result.ok) {
        this.setData({ loading: false, error: result.error.message, taskTitle: '', versions: [], feedback: null,
          feedbackTime: '', parentAssignmentId: '' })
        return
      }
      const children = await listParentChildren(session.user.id)
      if (this.data.requestVersion !== requestVersion) return
      const latestSession = getSession()
      if (!latestSession || latestSession.sessionId !== session.sessionId
        || (latestSession.activeRole ?? latestSession.user.role) !== 'parent'
        || getCurrentTaskId() !== taskId || getCurrentChildId() !== childId) {
        this.setData({ loading: false, error: '孩子或身份已切换，请重新进入反馈',
          taskTitle: '', versions: [], feedback: null, parentAssignmentId: '' })
        return
      }
      const authorizedChild = children.ok
        ? children.data.find(item => item.childId === result.data.assignment.studentId) : undefined
      if (children.ok && !authorizedChild) {
        this.setData({ loading: false, error: '当前无权查看该孩子反馈', taskTitle: '',
          versions: [], feedback: null, parentAssignmentId: '' })
        return
      }
      const versions: FeedbackVersion[] = (result.data.submissionHistory ?? [])
        .map(item => ({ version: item.version, label: `第 ${item.version} 次提交`,
          submittedAt: item.submittedAt ?? null, feedback: item.feedback ?? null }))
      if (!versions.length && result.data.feedback) {
        versions.push({ version: result.data.submission?.version ?? 1,
          label: `第 ${result.data.submission?.version ?? 1} 次提交`,
          submittedAt: result.data.submission?.submittedAt ?? null, feedback: result.data.feedback })
      }
      this.setData({ loading: false, taskTitle: result.data.task.title, versions,
        childDisplayName: authorizedChild?.displayName ?? '',
        childClassName: authorizedChild?.className ?? '',
        selectedVersion: 0, feedback: versions[0]?.feedback ?? null,
        selectedSubmittedAtLabel: versions[0]?.submittedAt ? publishedLabel(versions[0].submittedAt) : '时间未记录',
        feedbackTime: versions[0]?.feedback ? publishedLabel(versions[0].feedback.publishedAt) : '',
        parentAssignmentId: result.data.parentAssignmentId ?? '',
        childId: result.data.assignment.studentId, taskId: result.data.task.id })
    },
    selectVersion(event: WechatMiniprogram.TouchEvent) {
      stopFeedbackAudio()
      const index = Number(event.currentTarget.dataset.index)
      if (!Number.isInteger(index) || index < 0 || index >= this.data.versions.length) return
      const feedback = this.data.versions[index].feedback
      this.setData({ selectedVersion: index, feedback,
        selectedSubmittedAtLabel: this.data.versions[index].submittedAt
          ? publishedLabel(this.data.versions[index].submittedAt as string) : '时间未记录',
        feedbackTime: feedback ? publishedLabel(feedback.publishedAt) : '',
        voicePlaying: false, voiceLoading: false, voiceMessage: '',
        voiceRequestVersion: this.data.voiceRequestVersion + 1 })
    },
    async playVoiceComment() {
      const session = getSession()
      const selected = this.data.versions[this.data.selectedVersion]
      const feedback = selected?.feedback
      if (!session || (session.activeRole ?? session.user.role) !== 'parent'
        || !feedback?.voiceComment?.available || !this.data.parentAssignmentId
        || this.data.voiceLoading) return
      if (this.data.voicePlaying) {
        stopFeedbackAudio()
        this.setData({ voicePlaying: false, voiceMessage: '语音评语试听已停止' })
        return
      }
      stopFeedbackAudio()
      const requestVersion = this.data.voiceRequestVersion + 1
      this.setData({ voiceLoading: true, voicePlaying: false, voiceMessage: '',
        voiceRequestVersion: requestVersion })
      const result = await getParentFeedbackVoicePlayback(session.user.id, {
        childId: this.data.childId, taskId: this.data.taskId,
        assignmentId: this.data.parentAssignmentId,
        submissionVersion: selected.version, feedbackId: feedback.id,
      })
      if (this.data.voiceRequestVersion !== requestVersion) return
      const currentSession = getSession()
      if (!currentSession || currentSession.sessionId !== session.sessionId
        || (currentSession.activeRole ?? currentSession.user.role) !== 'parent') {
        this.setData({ voiceLoading: false, voicePlaying: false, voiceMessage: '请重新进入家长反馈' })
        return
      }
      if (getCurrentChildId() !== this.data.childId || getCurrentTaskId() !== this.data.taskId
        || this.data.versions[this.data.selectedVersion]?.feedback?.id !== feedback.id) {
        this.setData({ voiceLoading: false, voiceMessage: '孩子或点评版本已切换，请重新打开' }); return
      }
      if (!result.ok) { this.setData({ voiceLoading: false, voiceMessage: result.error.message }); return }
      if (!result.data.temporaryUrl.startsWith('https://')
        || Date.parse(result.data.expiresAt) <= Date.now()) {
        this.setData({ voiceLoading: false, voiceMessage: '语音评语试听地址已过期，请重试' }); return
      }
      const audio = wx.createInnerAudioContext()
      activeFeedbackAudio = audio
      audio.src = result.data.temporaryUrl
      audio.onEnded(() => {
        if (activeFeedbackAudio !== audio) return
        stopFeedbackAudio()
        this.setData({ voicePlaying: false, voiceMessage: '语音评语试听完成' })
      })
      audio.onError(() => {
        if (activeFeedbackAudio !== audio) return
        stopFeedbackAudio()
        this.setData({ voicePlaying: false, voiceMessage: '播放失败，请重新获取语音评语后重试' })
      })
      this.setData({ voiceLoading: false, voicePlaying: true, voiceMessage: '正在播放语音评语' })
      audio.play()
    },
  },
})
