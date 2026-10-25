import type { TaskDetailView, TaskItem } from '../../../domain/types'
import type { TaskRecordingView } from '../../../domain/task-recording'
import { getTaskDetail } from '../services/app-service'
import { beginTaskRecording, getRecordingPrompt, getTaskRecordingMediaState, getTaskRecordingPlayback,
  listTaskRecordings, submitTaskRecording } from '../services/task-recording-service'
import { getRepositoryMode } from '../../../repositories/repository-factory'
import { getCurrentTaskId, getSession } from '../session/session'
import { teacherContentPreviewRoute } from '../shared/teacher-content-preview'
import { recordingMediaIssue } from '../shared/dubbing-recording-validation'
import { formatRecordingDuration } from '../shared/recording-duration'
import { EMPTY_WRITE_INTENT, clearWriteIntent, createPageOperationId,
  prepareWriteIntent, type WriteIntentState } from '../shared/write-intent'
import { taskWriteAvailability } from '../shared/task-detail-view'
import { teacherReviewRoute, loadTeacherReviewItem, type TeacherReviewRoute } from '../shared/teacher-review-item'
import { teacherReviewScoreState, updateTeacherReviewScore } from '../shared/teacher-review-student-page'

type RecorderStop = { duration: number; fileSize: number; tempFilePath: string }
let recorder: ReturnType<typeof wx.getRecorderManager> | null = null
let receiver: { stop(result: RecorderStop): void; error(): void } | null = null
let bound = false
let timer: ReturnType<typeof setInterval> | null = null
let startedAt = 0
let playbackAudio: ReturnType<typeof wx.createInnerAudioContext> | null = null
function getRecorder(): ReturnType<typeof wx.getRecorderManager> {
  recorder ??= wx.getRecorderManager()
  if (!bound) {
    recorder.onStop(result => receiver?.stop(result))
    recorder.onError(() => receiver?.error())
    bound = true
  }
  return recorder
}
function stopTimer(): void { if (timer) clearInterval(timer); timer = null; startedAt = 0 }
function stopPlayback(): void { playbackAudio?.stop(); playbackAudio?.destroy(); playbackAudio = null }

Component({
  data: {
    loading: true, error: '', initialized: false, sessionId: '',
    detail: null as TaskDetailView | null, item: null as TaskItem | null,
    title: '', prompt: '', editable: false, unavailableReason: '',
    teacherPreview: false,
    teacherReview: false, teacherReviewRoute: null as TeacherReviewRoute | null,
    teacherReviewVersion: 0, teacherScoreInput: '', teacherScoreError: '',
    state: 'idle' as 'idle' | 'recording' | 'local' | 'invalid' | 'uploading' | 'submitted',
    durationMs: 0, durationLabel: '00:00', sizeBytes: 0, localPath: '', stagingFileId: '',
    recordingId: '', mediaAvailable: false, mediaExpired: false,
    recordingDraft: null as TaskRecordingView | null, uploadRetryAllowed: false,
    beginIntent: EMPTY_WRITE_INTENT as WriteIntentState,
    submitIntent: EMPTY_WRITE_INTENT as WriteIntentState,
    message: '',
  },
  lifetimes: {
    attached() { receiver = { stop: result => this.onStopped(result),
      error: () => this.onFailed() } },
    detached() { stopTimer(); stopPlayback(); receiver = null
      if (this.data.state === 'recording') getRecorder().stop() },
  },
  pageLifetimes: {
    show() { const session = getSession()
      if ((this.data.teacherPreview || this.data.teacherReview)
        && (session?.activeRole ?? session?.user.role) !== 'teacher') {
        stopPlayback()
        this.setData({ loading: false, error: '教师预览权限已变化，请返回重新进入' }); return
      }
      if (!this.data.initialized || session?.sessionId !== this.data.sessionId) void this.load() },
    hide() { stopPlayback(); if (this.data.state === 'recording') { stopTimer(); getRecorder().stop() } },
  },
  methods: {
    async load() {
      const session = getSession()
      const pages = getCurrentPages() as Array<{ options?: Record<string, string> }>
      const options = pages[pages.length - 1]?.options ?? {}
      if (options.teacherReview === '1') {
        const route = teacherReviewRoute(options)
        if (!route) { this.setData({ loading: false, error: '缺少要查看的录音提交' }); return }
        this.setData({ loading: true, error: '', initialized: true,
          sessionId: session?.sessionId ?? '', teacherReview: true, teacherReviewRoute: route,
          editable: false, localPath: '', stagingFileId: '' })
        const result = await loadTeacherReviewItem(route, 'recording')
        if (getSession()?.sessionId !== session?.sessionId) return
        if (!result.ok) { this.setData({ loading: false, error: result.message }); return }
        const value = result.submission.answers.find(answer => answer.itemId === route.itemId)?.value
        const answer = value && typeof value === 'object' && !Array.isArray(value)
          ? value as Record<string, unknown> : null
        const recordingId = answer?.kind === 'recording' && typeof answer.recordingId === 'string'
          ? answer.recordingId : ''
        const durationMs = typeof answer?.durationMs === 'number' && Number.isFinite(answer.durationMs)
          ? answer.durationMs : 0
        const media = recordingId ? await getTaskRecordingMediaState(session!.user.id, recordingId) : null
        if (getSession()?.sessionId !== session?.sessionId) return
        this.setData({ loading: false, title: result.item.title,
          prompt: result.item.recordingPrompt ?? '本次提交未记录录音要求',
          unavailableReason: '教师只读查看当前提交，不使用麦克风或写入学生记录',
          recordingId, state: recordingId ? 'submitted' : 'idle', durationMs,
          durationLabel: formatRecordingDuration(durationMs),
          mediaAvailable: Boolean(media?.ok && !media.data.mediaExpired),
          mediaExpired: Boolean(media?.ok && media.data.mediaExpired),
          message: !recordingId ? '本次提交没有可试听的录音'
            : !media?.ok ? '录音状态暂无法核对，请重试' : '',
          teacherReviewVersion: result.submission.submissionVersion,
          ...teacherReviewScoreState(route, result.submission) })
        return
      }
      if (options.teacherPreview === '1') {
        const route = teacherContentPreviewRoute(options)
        if (!session || (session.activeRole ?? session.user.role) !== 'teacher'
          || !route || route.type !== 'recording') {
          this.setData({ loading: false, error: '仅授权教师可预览录音要求' }); return
        }
        this.setData({ loading: true, error: '', initialized: true,
          sessionId: session.sessionId, teacherPreview: true, editable: false,
          state: 'idle', recordingId: '', localPath: '' })
        const preview = await getRecordingPrompt(session.user.id, route.resourceId, route.targetClassIds)
        if (getSession()?.sessionId !== session.sessionId) return
        this.setData(preview.ok ? { loading: false, title: preview.data.title,
          prompt: preview.data.promptText, unavailableReason: '教师只读预览，不使用麦克风或保存录音' }
          : { loading: false, error: preview.error.message })
        return
      }
      const taskId = options.taskId || getCurrentTaskId(), itemId = options.itemId || ''
      if (!session || (session.activeRole ?? session.user.role) !== 'student' || !taskId || !itemId) {
        this.setData({ loading: false, error: '学生任务信息不可用，请从任务详情重新进入' }); return
      }
      this.setData({ loading: true, error: '', initialized: true, sessionId: session.sessionId,
        localPath: '', stagingFileId: '', uploadRetryAllowed: false })
      const result = await getTaskDetail(session.user.id, taskId)
      if (getSession()?.sessionId !== session.sessionId) return
      if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
      const detail = result.data, item = detail.task.items.find(entry => entry.id === itemId)
      if (!item || item.type !== 'recording') {
        this.setData({ loading: false, error: '课堂录音内容不可用，请返回任务详情' }); return
      }
      const availability = taskWriteAvailability(detail.task, detail.assignment,
        new Date().toISOString(), getRepositoryMode() === 'memory')
      const currentVersion = detail.submission?.status === 'draft'
        ? detail.submission.version : (detail.submission?.version ?? 0) + 1
      const records = await listTaskRecordings(session.user.id, taskId, itemId)
      if (getSession()?.sessionId !== session.sessionId) return
      const matching = records.ok ? records.data.filter(record => record.submissionVersion === currentVersion)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : []
      const sealed = matching.find(record => record.status === 'submitted')
      const draft = matching.find(record => record.status === 'draft') ?? null
      const submittedValue = (detail.assignment.status === 'redo_required' || detail.assignment.redoDueAt)
        && detail.submission?.status === 'returned' ? undefined
          : detail.submission?.answers.find(answer => answer.taskItemId === itemId)?.structuredValue
      const recordingId = sealed?.id ?? (submittedValue?.kind === 'recording' ? submittedValue.recordingId : '')
      const durationMs = sealed?.durationMs ?? (submittedValue?.kind === 'recording' ? submittedValue.durationMs ?? 0 : 0)
      const media = recordingId ? await getTaskRecordingMediaState(session.user.id, recordingId) : null
      if (getSession()?.sessionId !== session.sessionId) return
      this.setData({ loading: false, detail, item, title: item.title,
        prompt: item.recordingPrompt ?? item.completionRule,
        editable: availability.editable, unavailableReason: availability.reason,
        recordingDraft: draft, recordingId, state: recordingId ? 'submitted' : 'idle',
        durationMs, durationLabel: formatRecordingDuration(durationMs),
        sizeBytes: sealed?.sizeBytes ?? (submittedValue?.kind === 'recording' ? submittedValue.sizeBytes ?? 0 : 0), localPath: '',
        mediaAvailable: Boolean(media?.ok && !media.data.mediaExpired),
        mediaExpired: Boolean(media?.ok && media.data.mediaExpired),
        message: records.ok ? '' : '录音记录暂无法同步，请稍后重试' })
    },
    async startRecording() {
      if (!this.data.editable || this.data.state !== 'idle' || getRepositoryMode() !== 'cloudbase') {
        if (getRepositoryMode() !== 'cloudbase') this.setData({ message: '录音任务需要可信云端服务' })
        return
      }
      try { await wx.authorize({ scope: 'scope.record' }) }
      catch (_error: unknown) { this.setData({ message: '请在微信设置中允许使用麦克风后重试' }); return }
      this.setData({ state: 'recording', durationMs: 0, durationLabel: '00:00', message: '', uploadRetryAllowed: false })
      try {
        getRecorder().start({ duration: 300000, sampleRate: 16000, encodeBitRate: 64000,
          numberOfChannels: 1, format: 'mp3' })
        stopTimer(); startedAt = Date.now()
        timer = setInterval(() => {
          if (this.data.state !== 'recording') { stopTimer(); return }
          const durationMs = Math.min(300000, Math.max(0, Date.now() - startedAt))
          const label = formatRecordingDuration(durationMs)
          if (label !== this.data.durationLabel) this.setData({ durationMs, durationLabel: label })
        }, 250)
      } catch (_error: unknown) {
        stopTimer(); this.setData({ state: 'idle', message: '录音未能开始，请重试' })
      }
    },
    stopRecording() { if (this.data.state === 'recording') { stopTimer(); getRecorder().stop() } },
    onStopped(result: RecorderStop) {
      if (this.data.state !== 'recording') return
      stopTimer()
      const issue = recordingMediaIssue(result.duration, result.fileSize, result.tempFilePath)
      this.setData({ state: result.tempFilePath ? issue ? 'invalid' : 'local' : 'idle',
        localPath: result.tempFilePath, stagingFileId: '', durationMs: result.duration,
        durationLabel: formatRecordingDuration(result.duration), sizeBytes: result.fileSize,
        recordingId: '', mediaAvailable: false, mediaExpired: false, message: issue, uploadRetryAllowed: false })
    },
    onFailed() { if (this.data.state === 'recording') {
      stopTimer(); this.setData({ state: 'idle', message: '录音失败，请重试', uploadRetryAllowed: false }) } },
    playLocal() { if (this.data.localPath) this.playAudio(this.data.localPath) },
    async playSubmitted() {
      const session = getSession()
      if (!session || !this.data.recordingId || !this.data.mediaAvailable) return
      const result = await getTaskRecordingPlayback(session.user.id, this.data.recordingId)
      if (!result.ok) { this.setData({ message: result.error.message }); return }
      this.playAudio(result.data.temporaryUrl)
    },
    playAudio(url: string) {
      stopPlayback()
      const next = wx.createInnerAudioContext()
      playbackAudio = next; next.src = url
      next.onEnded(() => { if (playbackAudio === next) stopPlayback() })
      next.onError(() => { if (playbackAudio === next) stopPlayback()
        this.setData({ message: '试听失败，请重试' }) })
      next.play()
    },
    redoRecording() {
      if (!this.data.editable || this.data.state === 'recording' || this.data.state === 'uploading') return
      wx.showModal({ title: '重新录制？', content: '本页当前录音将替换为新录音，已提交的历史版本保留。',
        confirmText: '重录', success: answer => { if (answer.confirm) this.setData({
          state: 'idle', localPath: '', stagingFileId: '', recordingId: '', durationMs: 0, durationLabel: '00:00',
          sizeBytes: 0, mediaAvailable: false, mediaExpired: false, message: '', uploadRetryAllowed: false,
          recordingDraft: null, beginIntent: clearWriteIntent(), submitIntent: clearWriteIntent(),
        }) } })
    },
    async uploadRecording() {
      const session = getSession(), detail = this.data.detail, item = this.data.item
      if (!session || !detail || !item || !this.data.editable
        || (this.data.state !== 'local' && !(this.data.state === 'invalid' && this.data.uploadRetryAllowed))
        || !this.data.localPath) return
      const issue = recordingMediaIssue(this.data.durationMs, this.data.sizeBytes, this.data.localPath)
      if (issue) { this.setData({ state: 'invalid', message: issue, uploadRetryAllowed: false }); return }
      this.setData({ state: 'uploading', message: '', uploadRetryAllowed: false })
      let draft = this.data.recordingDraft
      if (!draft || draft.status !== 'draft') {
        const intent = prepareWriteIntent(this.data.beginIntent,
          `${detail.task.id}:${item.id}`, () => createPageOperationId('begin_task_recording'))
        this.setData({ beginIntent: intent })
        const result = await beginTaskRecording(session.user.id, detail.task.id, item.id, intent.operationId)
        if (!result.ok) { this.setData({ state: 'local', message: result.error.message }); return }
        draft = result.data
        this.setData({ recordingDraft: draft, beginIntent: clearWriteIntent() })
      }
      let stagingFileId = this.data.stagingFileId
      if (!stagingFileId) {
        try { stagingFileId = (await wx.cloud.uploadFile({ cloudPath: draft.stagingPath,
          filePath: this.data.localPath })).fileID }
        catch (_error: unknown) { this.setData({ state: 'local', message: '上传失败，本机录音已保留，可重试' }); return }
        this.setData({ stagingFileId })
      }
      const fingerprint = JSON.stringify({ recordingId: draft.id, stagingFileId, version: draft.version })
      const intent = prepareWriteIntent(this.data.submitIntent, fingerprint,
        () => createPageOperationId('seal_task_recording'))
      this.setData({ submitIntent: intent })
      const submitted = await submitTaskRecording(session.user.id, draft.id, stagingFileId,
        draft.version, intent.operationId)
      if (!submitted.ok) {
        const invalid = submitted.error.code === 'MEDIA_INVALID'
        this.setData({ state: invalid ? 'invalid' : 'local', uploadRetryAllowed: invalid,
        message: invalid ? '云端安全或音频校验未通过。原录音仍保存在本机，可试听、重试上传或重新录制'
            : `${submitted.error.message}，本机录音已保留，可重试` })
        return
      }
      this.setData({ state: 'submitted', recordingId: submitted.data.id,
        durationMs: submitted.data.durationMs ?? 0,
        durationLabel: formatRecordingDuration(submitted.data.durationMs ?? 0),
        sizeBytes: submitted.data.sizeBytes ?? 0, mediaAvailable: true, mediaExpired: false,
        recordingDraft: submitted.data, stagingFileId: '', submitIntent: clearWriteIntent(),
        message: '', uploadRetryAllowed: false })
      wx.showToast({ title: '录音已上传，请返回任务提交', icon: 'success' })
    },
    onTeacherReviewScore(event: WechatMiniprogram.Input) {
      const route = this.data.teacherReviewRoute
      if (this.data.teacherReview && route) {
        this.setData(updateTeacherReviewScore(route, event.detail.value))
      }
    },
    returnToTask() {
      if (this.data.state === 'recording') { this.stopRecording(); return }
      if (this.data.state === 'local' || this.data.state === 'invalid') {
        wx.showModal({ title: '录音尚未上传', content: '离开后本机录音可能丢失。请先上传，或确认放弃本次录音。',
          confirmText: '继续上传', cancelText: '放弃离开',
          success: result => { if (result.cancel) wx.navigateBack() } })
        return
      }
      wx.navigateBack()
    },
  },
})
