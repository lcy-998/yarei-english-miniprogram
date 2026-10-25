import { TaskDetailView } from '../domain/types'
import { getParentTask } from '../services/app-service'
import { listParentPronunciationEvidence } from '../services/parent-pronunciation-service'
import { getParentRecordingPlayback } from '../services/parent-recording-service'
import { getParentTaskMediaPlayback } from '../services/parent-task-media-service'
import { getCurrentChildId, getCurrentTaskId, getSession } from '../session/session'
import { assignmentStatusLabel } from '../shared/assignment-status'
import { parentEvidenceRows, parentSubmittedRecordingItems, parentSubmittedTaskMediaItems,
  type ParentEvidenceRow, type ParentRecordingItem, type ParentTaskMediaItem } from './parent-evidence-view'
import { parentPronunciationRows, type ParentPronunciationRow } from './parent-pronunciation-view'

let activeParentAudio: WechatMiniprogram.InnerAudioContext | null = null
function stopParentAudio(): void {
  activeParentAudio?.destroy()
  activeParentAudio = null
}
Component({
  data: { loading: true, error: '', detail: null as TaskDetailView | null, statusLabel: '',
    taskRequestVersion: 0,
    hasFeedbackHistory: false, evidenceRows: [] as ParentEvidenceRow[],
    readingItems: [] as Array<{ itemId: string; title: string }>,
    pronunciationLoading: false, pronunciationError: '', pronunciationRows: [] as ParentPronunciationRow[],
    missingPronunciationCount: 0, pronunciationItemTitle: '', pronunciationRequestVersion: 0,
    recordingItems: [] as ParentRecordingItem[], recordingLoading: false,
    recordingMessage: '', recordingPlayingItemId: '', recordingRequestVersion: 0,
    mediaItems: [] as ParentTaskMediaItem[], mediaLoading: false, mediaMessage: '',
    mediaPlayingItemId: '', mediaPlayingQuestionId: '', mediaVideoUrl: '', mediaRequestVersion: 0 },
  lifetimes: { attached() { this.loadTask() }, detached() { stopParentAudio() } },
  pageLifetimes: { show() { if (!this.data.loading) this.loadTask() },
    hide() { stopParentAudio(); this.setData({ recordingPlayingItemId: '', recordingLoading: false,
      mediaPlayingItemId: '', mediaPlayingQuestionId: '', mediaVideoUrl: '', mediaLoading: false,
      mediaRequestVersion: this.data.mediaRequestVersion + 1,
      pronunciationLoading: false, recordingRequestVersion: this.data.recordingRequestVersion + 1,
      pronunciationRequestVersion: this.data.pronunciationRequestVersion + 1 }) } },
  methods: {
    async loadTask() {
      stopParentAudio()
      const taskRequestVersion = this.data.taskRequestVersion + 1
      const session = getSession()
      const taskId = getCurrentTaskId()
      const childId = getCurrentChildId()
      if (!session || (session.activeRole ?? session.user.role) !== 'parent' || !taskId) {
        this.setData({ loading: false, error: '请重新进入孩子任务', detail: null,
          hasFeedbackHistory: false, evidenceRows: [], readingItems: [], pronunciationRows: [],
          recordingItems: [], recordingPlayingItemId: '', mediaItems: [],
          mediaPlayingQuestionId: '', mediaVideoUrl: '' }); return
      }
      this.setData({ loading: true, error: '', detail: null, hasFeedbackHistory: false,
        taskRequestVersion,
        evidenceRows: [], readingItems: [], pronunciationRows: [], pronunciationError: '',
        pronunciationLoading: false, pronunciationItemTitle: '', missingPronunciationCount: 0,
        pronunciationRequestVersion: this.data.pronunciationRequestVersion + 1,
        recordingItems: [], recordingPlayingItemId: '', recordingMessage: '', recordingLoading: false,
        recordingRequestVersion: this.data.recordingRequestVersion + 1,
        mediaItems: [], mediaPlayingItemId: '', mediaPlayingQuestionId: '',
        mediaVideoUrl: '', mediaMessage: '', mediaLoading: false,
        mediaRequestVersion: this.data.mediaRequestVersion + 1 })
      const result = await getParentTask(session.user.id, taskId)
      if (this.data.taskRequestVersion !== taskRequestVersion) return
      if (getCurrentTaskId() !== taskId || getCurrentChildId() !== childId) {
        this.setData({ loading: false, detail: null, hasFeedbackHistory: false, evidenceRows: [],
          readingItems: [], pronunciationRows: [], recordingItems: [], recordingPlayingItemId: '',
          mediaItems: [], mediaPlayingQuestionId: '', mediaVideoUrl: '',
          error: '任务或孩子已切换，请重新打开' }); return
      }
      if (!result.ok) { this.setData({ loading: false, error: result.error.message,
        detail: null, hasFeedbackHistory: false, evidenceRows: [], readingItems: [],
        pronunciationRows: [], recordingItems: [], recordingPlayingItemId: '',
        mediaItems: [], mediaPlayingQuestionId: '', mediaVideoUrl: '' }); return }
      const summaries = result.data.parentItemSummaries
        ?? result.data.task.items.map(item => ({ itemId: item.id, title: item.title, type: item.type, order: 0 }))
      this.setData({ loading: false, detail: result.data,
        evidenceRows: parentEvidenceRows(result.data.submission?.answers ?? [], summaries),
        readingItems: result.data.parentAssignmentId && result.data.submission
          ? summaries.filter(item => item.type === 'reading' && 'pronunciationAvailable' in item
            && item.pronunciationAvailable === true).map(item => ({ itemId: item.itemId, title: item.title })) : [],
        recordingItems: result.data.parentAssignmentId && result.data.submission
          ? parentSubmittedRecordingItems(result.data.submission.answers, summaries) : [],
        mediaItems: result.data.parentAssignmentId && result.data.submission
          ? parentSubmittedTaskMediaItems(result.data.submission.answers, summaries) : [],
        hasFeedbackHistory: Boolean(result.data.feedback)
          || Boolean(result.data.submissionHistory?.some(item => item.feedback)),
        statusLabel: assignmentStatusLabel(result.data.assignment.status, '待点评') })
    },
    async openPronunciation(event: WechatMiniprogram.TouchEvent) {
      const session = getSession()
      const detail = this.data.detail
      const itemId = String(event.currentTarget.dataset.itemId ?? '')
      const item = this.data.readingItems.find(candidate => candidate.itemId === itemId)
      if (!session || (session.activeRole ?? session.user.role) !== 'parent'
        || !detail?.parentAssignmentId || !detail.submission || !item
        || this.data.pronunciationLoading) return
      const requestVersion = this.data.pronunciationRequestVersion + 1
      this.setData({ pronunciationLoading: true, pronunciationError: '', pronunciationRows: [],
        missingPronunciationCount: 0, pronunciationItemTitle: item.title,
        pronunciationRequestVersion: requestVersion })
      const result = await listParentPronunciationEvidence(session.user.id, {
        studentId: detail.assignment.studentId, taskId: detail.task.id,
        assignmentId: detail.parentAssignmentId, submissionVersion: detail.submission.version, itemId,
      })
      if (this.data.pronunciationRequestVersion !== requestVersion) return
      if (getCurrentTaskId() !== detail.task.id || getCurrentChildId() !== detail.assignment.studentId
        || this.data.detail?.submission?.id !== detail.submission.id) {
        this.setData({ pronunciationLoading: false, pronunciationError: '任务或孩子已切换，请重新打开' }); return
      }
      if (!result.ok) { this.setData({ pronunciationLoading: false,
        pronunciationError: result.error.message }); return }
      this.setData({ pronunciationLoading: false, pronunciationRows: parentPronunciationRows(result.data.items),
        missingPronunciationCount: result.data.missingReferenceCount })
    },
    async openRecording(event: WechatMiniprogram.TouchEvent) {
      const session = getSession()
      const detail = this.data.detail
      const itemId = String(event.currentTarget.dataset.itemId ?? '')
      const item = this.data.recordingItems.find(candidate => candidate.itemId === itemId)
      if (!session || (session.activeRole ?? session.user.role) !== 'parent'
        || !detail?.parentAssignmentId || !detail.submission || !item || this.data.recordingLoading) return
      if (this.data.recordingPlayingItemId === itemId) {
        stopParentAudio()
        this.setData({ recordingPlayingItemId: '', recordingMessage: '试听已停止' })
        return
      }
      stopParentAudio()
      this.setData({ mediaVideoUrl: '', mediaPlayingItemId: '', mediaPlayingQuestionId: '' })
      const requestVersion = this.data.recordingRequestVersion + 1
      this.setData({ recordingLoading: true, recordingMessage: '', recordingPlayingItemId: '',
        recordingRequestVersion: requestVersion })
      const result = await getParentRecordingPlayback(session.user.id, {
        childId: detail.assignment.studentId, taskId: detail.task.id,
        assignmentId: detail.parentAssignmentId, submissionVersion: detail.submission.version, itemId,
      })
      if (this.data.recordingRequestVersion !== requestVersion) return
      if (getCurrentTaskId() !== detail.task.id || getCurrentChildId() !== detail.assignment.studentId
        || this.data.detail?.submission?.id !== detail.submission.id) {
        this.setData({ recordingLoading: false, recordingMessage: '任务或孩子已切换，请重新打开' }); return
      }
      if (!result.ok) { this.setData({ recordingLoading: false, recordingMessage: result.error.message }); return }
      if (result.data.status === 'expired') {
        this.setData({ recordingLoading: false,
          recordingMessage: '录音已过保留期，提交与老师点评仍可查看' }); return
      }
      if (result.data.status !== 'ready' || !result.data.playback) {
        this.setData({ recordingLoading: false, recordingMessage: '录音暂无法试听，请稍后重试' }); return
      }
      const remaining = Date.parse(result.data.playback.expiresAt) - Date.now()
      if (!result.data.playback.temporaryUrl.startsWith('https://') || remaining <= 0) {
        this.setData({ recordingLoading: false, recordingMessage: '试听地址已过期，请重新获取' }); return
      }
      const audio = wx.createInnerAudioContext()
      activeParentAudio = audio
      audio.src = result.data.playback.temporaryUrl
      audio.onEnded(() => {
        if (activeParentAudio !== audio) return
        stopParentAudio()
        this.setData({ recordingPlayingItemId: '', recordingMessage: '试听完成' })
      })
      audio.onError(() => {
        if (activeParentAudio !== audio) return
        stopParentAudio()
        this.setData({ recordingPlayingItemId: '', recordingMessage: '播放失败，请重新获取试听地址后重试' })
      })
      this.setData({ recordingLoading: false, recordingPlayingItemId: itemId,
        recordingMessage: `${item.title}：正在试听` })
      audio.play()
    },
    async openTaskMedia(event: WechatMiniprogram.TouchEvent) {
      const session = getSession()
      const detail = this.data.detail
      const itemId = String(event.currentTarget.dataset.itemId ?? '')
      const questionId = String(event.currentTarget.dataset.questionId ?? '')
      const item = this.data.mediaItems.find(candidate => candidate.itemId === itemId)
      if (!session || (session.activeRole ?? session.user.role) !== 'parent'
        || !detail?.parentAssignmentId || !detail.submission || !item || this.data.mediaLoading) return
      if (this.data.mediaPlayingItemId === itemId && this.data.mediaPlayingQuestionId === questionId) {
        stopParentAudio()
        this.setData({ mediaPlayingItemId: '', mediaPlayingQuestionId: '',
          mediaVideoUrl: '', mediaMessage: '回看已停止' })
        return
      }
      stopParentAudio()
      const requestVersion = this.data.mediaRequestVersion + 1
      this.setData({ mediaLoading: true, mediaPlayingItemId: '', mediaPlayingQuestionId: '',
        mediaVideoUrl: '', mediaMessage: '',
        recordingPlayingItemId: '', mediaRequestVersion: requestVersion })
      const result = await getParentTaskMediaPlayback(session.user.id, {
        childId: detail.assignment.studentId, taskId: detail.task.id,
        assignmentId: detail.parentAssignmentId, submissionVersion: detail.submission.version, itemId,
      })
      if (this.data.mediaRequestVersion !== requestVersion) return
      if (getCurrentTaskId() !== detail.task.id || getCurrentChildId() !== detail.assignment.studentId
        || this.data.detail?.submission?.id !== detail.submission.id) {
        this.setData({ mediaLoading: false, mediaMessage: '任务或孩子已切换，请重新打开' }); return
      }
      if (!result.ok) { this.setData({ mediaLoading: false, mediaMessage: result.error.message }); return }
      const playback = result.data.playback
      if (result.data.kind === 'dubbing' && result.data.status === 'expired') {
        this.setData({ mediaLoading: false,
          mediaMessage: '配音原件已过保留期，提交与老师点评仍可查看' }); return
      }
      if (result.data.kind !== item.kind || result.data.status !== 'ready' || !playback) {
        this.setData({ mediaLoading: false, mediaMessage: '媒体暂无法回看，请稍后重试' }); return
      }
      if (!playback.temporaryUrl.startsWith('https://') || Date.parse(playback.expiresAt) <= Date.now()) {
        this.setData({ mediaLoading: false, mediaMessage: '媒体地址已过期，请重新获取' }); return
      }
      if (item.kind === 'video') {
        if (questionId) { this.setData({ mediaLoading: false, mediaMessage: '该题不支持单独片段回看' }); return }
        this.setData({ mediaLoading: false, mediaPlayingItemId: itemId,
          mediaVideoUrl: playback.temporaryUrl, mediaMessage: `${item.title}：可只读回看，不记录学生进度` })
        return
      }
      const clip = questionId ? result.data.clips?.find(candidate => candidate.questionId === questionId) : null
      if (questionId && (!clip || !Number.isSafeInteger(clip.startMs) || !Number.isSafeInteger(clip.endMs)
        || clip.startMs < 0 || clip.endMs <= clip.startMs
        || result.data.durationMs === null || clip.endMs > result.data.durationMs)) {
        this.setData({ mediaLoading: false, mediaMessage: '该题音频片段未记录，请回看完整听力' }); return
      }
      const audio = wx.createInnerAudioContext()
      activeParentAudio = audio
      let clipStarted = false
      if (clip) {
        audio.onCanplay(() => {
          if (activeParentAudio !== audio || clipStarted) return
          clipStarted = true
          audio.seek(clip.startMs / 1000)
          audio.play()
        })
        audio.onTimeUpdate(() => {
          if (activeParentAudio !== audio || audio.currentTime * 1000 < clip.endMs) return
          stopParentAudio()
          this.setData({ mediaPlayingItemId: '', mediaPlayingQuestionId: '',
            mediaMessage: '本题音频试听完成' })
        })
      }
      audio.onEnded(() => {
        if (activeParentAudio !== audio) return
        stopParentAudio()
        this.setData({ mediaPlayingItemId: '', mediaPlayingQuestionId: '', mediaMessage: '听力回看完成' })
      })
      audio.onError(() => {
        if (activeParentAudio !== audio) return
        stopParentAudio()
        this.setData({ mediaPlayingItemId: '', mediaPlayingQuestionId: '',
          mediaMessage: '播放失败，请重新获取媒体地址后重试' })
      })
      audio.src = playback.temporaryUrl
      this.setData({ mediaLoading: false, mediaPlayingItemId: itemId, mediaPlayingQuestionId: questionId,
        mediaMessage: questionId ? '正在只读试听本题音频' : `${item.title}：正在只读回听` })
      if (!clip) audio.play()
    },
    onTaskVideoError() {
      this.setData({ mediaPlayingItemId: '', mediaPlayingQuestionId: '',
        mediaVideoUrl: '', mediaMessage: '视频播放失败，请重新获取地址后重试' })
    },
    onTaskVideoEnded() {
      this.setData({ mediaPlayingItemId: '', mediaPlayingQuestionId: '',
        mediaVideoUrl: '', mediaMessage: '视频回看完成' })
    },
    openFeedback() { wx.navigateTo({ url: '/subpackages/parent/feedback/feedback' }) },
  },
})
