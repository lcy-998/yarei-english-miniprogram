import type { M3TaskMediaPlaybackView, M3TaskMediaSnapshotView, TaskDetailView } from '../../../domain/types'
import { getTaskDetail } from '../services/app-service'
import { beginTaskMediaSession, getTaskMediaPlayback, reportTaskMediaHeartbeat } from '../services/task-media-service'
import { getCurrentTaskId, getSession } from '../session/session'
import { createPageOperationId } from '../shared/write-intent'
import { formatRecordingDuration } from '../shared/recording-duration'
import { readTaskMediaDraft, taskMediaDraftKey, writeTaskMediaDraft } from '../shared/task-media-draft'
import { mediaQuestionRows, savedTaskMediaAnswers, taskMediaPlaybackReady, taskMediaSeekTarget } from '../shared/student-task-media-policy'
import { nextLearningSpeed, readLearningSpeed, saveLearningSpeed } from '../pages/student/student-media-preferences'
import { teacherContentPreviewRoute } from '../shared/teacher-content-preview'
import { teacherMediaTaskPreview } from '../shared/teacher-media-task-preview'
import { previewTeacherAsset } from '../services/teacher-media-service'
import { getTeacherTaskMediaReviewEvidence } from '../services/teacher-media-service'
import { teacherReviewRoute, loadTeacherReviewItem, type TeacherReviewRoute } from '../shared/teacher-review-item'
import { teacherReviewMediaView, teacherReviewScoreState,
  updateTeacherReviewScore } from '../shared/teacher-review-student-page'

type AudioContext = ReturnType<typeof wx.createInnerAudioContext>
type PendingHeartbeat = { sessionId: string; fromMs: number; toMs: number; operationId: string }
let audio: AudioContext | null = null
let bufferTimer: ReturnType<typeof setTimeout> | null = null
let progressTimer: ReturnType<typeof setInterval> | null = null
let requestedSeekMs: number | null = null
let observedAt = 0
let observedMs = 0

function clearBufferTimer(): void {
  if (bufferTimer) clearTimeout(bufferTimer)
  bufferTimer = null
}
function clearProgressTimer(): void {
  if (progressTimer) clearInterval(progressTimer)
  progressTimer = null
}
function destroyAudio(): void {
  clearBufferTimer()
  clearProgressTimer()
  audio?.stop()
  audio?.destroy()
  audio = null
  requestedSeekMs = null
}
function draftKey(detail: TaskDetailView, itemId: string, mediaVersion: number,
  sessionId: string): string {
  return taskMediaDraftKey(sessionId, detail.task.id, detail.assignment.id,
    detail.assignment.redoCount, itemId, mediaVersion)
}

Component({
  data: {
    loading: true, error: '', initialized: false, sessionId: '',
    teacherPreview: false,
    teacherReview: false, teacherReviewRoute: null as TeacherReviewRoute | null,
    teacherReviewVersion: 0, teacherReviewProgress: '',
    teacherScoreRequired: false, teacherScoreInput: '', teacherScoreError: '',
    detail: null as TaskDetailView | null,
    itemId: '', itemTitle: '', snapshot: null as M3TaskMediaSnapshotView | null,
    playback: null as M3TaskMediaPlaybackView | null,
    hasListeningText: false, subtitle: '',
    questions: [] as ReturnType<typeof mediaQuestionRows>,
    answers: {} as Record<string, string | string[]>,
    playing: false, buffering: false, earMode: true, speed: 1,
    currentMs: 0, confirmedMs: 0, lastReportedMs: 0,
    currentLabel: '00:00', durationLabel: '00:00', positionPercent: 0, confirmedPercent: 0,
    completed: false, warning: '', playbackError: '', draftError: '',
    heartbeatBusy: false, pendingHeartbeat: null as PendingHeartbeat | null,
    finishPending: false, clipEndMs: 0,
  },
  lifetimes: { detached() { destroyAudio() } },
  pageLifetimes: {
    show() {
      const session = getSession()
      if (this.data.teacherPreview && (session?.activeRole ?? session?.user.role) !== 'teacher') {
        destroyAudio()
        this.setData({ loading: false, error: '教师预览权限已变化，请返回重新进入' })
        return
      }
      if (!this.data.initialized || session?.sessionId !== this.data.sessionId) void this.load()
    },
    hide() { this.pause(); destroyAudio() },
  },
  methods: {
    async load() {
      destroyAudio()
      const session = getSession()
      const pages = getCurrentPages() as Array<{ options?: Record<string, string> }>
      const options = pages[pages.length - 1]?.options ?? {}
      if (options.teacherReview === '1') {
        const route = teacherReviewRoute(options)
        if (!route) { this.setData({ loading: false, error: '缺少要查看的听力提交' }); return }
        this.setData({ loading: true, error: '', initialized: true,
          sessionId: session?.sessionId ?? '', teacherPreview: true,
          teacherReview: true, teacherReviewRoute: route, playbackError: '' })
        const submission = await loadTeacherReviewItem(route, 'listening')
        if (getSession()?.sessionId !== session?.sessionId) return
        if (!submission.ok) { this.setData({ loading: false, error: submission.message }); return }
        const evidence = await getTeacherTaskMediaReviewEvidence(session!.user.id,
          route.submissionId, route.itemId)
        if (getSession()?.sessionId !== session?.sessionId) return
        if (!evidence.ok || evidence.data.kind !== 'listening'
          || evidence.data.submissionId !== route.submissionId
          || evidence.data.itemId !== route.itemId) {
          this.setData({ loading: false, error: evidence.ok ? '听力证据与当前提交不一致' : evidence.error.message }); return
        }
        const view = teacherReviewMediaView(evidence.data)
        this.setData({ loading: false, itemTitle: evidence.data.title,
          snapshot: view.snapshot, playback: view.playback, questions: view.questions,
          teacherReviewVersion: evidence.data.submissionVersion,
          teacherReviewProgress: view.progressLabel,
          ...teacherReviewScoreState(route, submission.submission),
          hasListeningText: evidence.data.subtitleCues.length > 0,
          currentMs: 0, confirmedMs: 0, lastReportedMs: 0,
          currentLabel: '00:00', durationLabel: formatRecordingDuration(evidence.data.durationMs),
          positionPercent: 0, confirmedPercent: 0, completed: false,
          speed: 1, earMode: false, subtitle: '', playing: false, buffering: false })
        return
      }
      if (options.teacherPreview === '1') {
        const route = teacherContentPreviewRoute(options)
        if (!session || (session.activeRole ?? session.user.role) !== 'teacher'
          || !route || route.type !== 'listening') {
          this.setData({ loading: false, error: '仅授权教师可预览听力内容' }); return
        }
        this.setData({ loading: true, error: '', initialized: true,
          sessionId: session.sessionId, teacherPreview: true, playbackError: '' })
        const result = await previewTeacherAsset(session.user.id, route.resourceId, route.targetClassIds)
        if (getSession()?.sessionId !== session.sessionId) {
          this.setData({ loading: false, error: '教师预览权限已变化，请返回重新进入' }); return
        }
        if (!result.ok || result.data.kind !== 'listening') {
          this.setData({ loading: false, error: result.ok ? '预览内容类型不匹配' : result.error.message }); return
        }
        const view = teacherMediaTaskPreview(result.data)
        this.setData({ loading: false, itemTitle: result.data.title,
          snapshot: view.snapshot, playback: view.playback, questions: view.questions,
          hasListeningText: result.data.subtitles.length > 0,
          currentMs: 0, confirmedMs: 0, lastReportedMs: 0,
          currentLabel: '00:00', durationLabel: formatRecordingDuration(result.data.durationMs),
          positionPercent: 0, confirmedPercent: 0, completed: false,
          speed: 1, earMode: false, subtitle: '', playing: false, buffering: false })
        return
      }
      const taskId = options.taskId || getCurrentTaskId()
      const itemId = options.itemId || ''
      if (!session || (session.activeRole ?? session.user.role) !== 'student' || !taskId || !itemId) {
        this.setData({ loading: false, error: '学生任务信息不可用，请从任务详情重新进入' }); return
      }
      this.setData({ loading: true, error: '', initialized: true, sessionId: session.sessionId,
        playback: null, snapshot: null, itemId, playbackError: '' })
      const detailResult = await getTaskDetail(session.user.id, taskId)
      if (getSession()?.sessionId !== session.sessionId) return
      if (!detailResult.ok) {
        this.setData({ loading: false, error: detailResult.error.message }); return
      }
      const detail = detailResult.data
      const item = detail.task.items.find(entry => entry.id === itemId)
      const snapshot = item?.mediaSnapshot
      if (!item || item.type !== 'listening' || snapshot?.kind !== 'listening') {
        this.setData({ loading: false, error: '这项听力任务缺少可用的发布内容，请联系老师' }); return
      }
      const result = await beginTaskMediaSession(session.user.id, taskId, itemId,
        createPageOperationId('begin_listening'))
      if (getSession()?.sessionId !== session.sessionId) return
      if (!result.ok || !taskMediaPlaybackReady(snapshot, result.data, Date.now())) {
        this.setData({ loading: false, error: result.ok ? '播放会话尚未就绪，请重试' : result.error.message }); return
      }
      const answers = { ...savedTaskMediaAnswers(detail, itemId, snapshot),
        ...readTaskMediaDraft(draftKey(detail, itemId, snapshot.mediaVersion, session.sessionId)) }
      const confirmedMs = result.data.confirmedThroughMs
      observedMs = confirmedMs; observedAt = Date.now()
      this.setData({ loading: false, error: '', detail, itemTitle: item.title, snapshot,
        hasListeningText: snapshot.subtitleAvailable && Boolean(snapshot.subtitleCues?.length),
        playback: result.data, answers, questions: mediaQuestionRows(snapshot, answers),
        speed: readLearningSpeed(session.user.id), playing: false, buffering: false,
        currentMs: confirmedMs, confirmedMs, lastReportedMs: confirmedMs,
        currentLabel: formatRecordingDuration(confirmedMs),
        durationLabel: formatRecordingDuration(snapshot.durationMs), earMode: true, subtitle: '',
        positionPercent: Math.round(confirmedMs * 100 / snapshot.durationMs),
        confirmedPercent: Math.round(confirmedMs * 100 / snapshot.durationMs),
        completed: confirmedMs >= snapshot.durationMs, heartbeatBusy: false,
        pendingHeartbeat: null, finishPending: false, clipEndMs: 0 })
      // The page may display answers restored from a newer cloud draft than the
      // task detail underneath. Share exactly the displayed answer set before
      // the student returns, even when no option is changed on this visit.
      if (Object.keys(answers).length) this.persistAnswers(answers)
    },
    pause() {
      audio?.pause()
      clearBufferTimer()
      clearProgressTimer()
      this.setData({ playing: false, buffering: false })
    },
    startProgressPolling() {
      clearProgressTimer()
      progressTimer = setInterval(() => {
        if (!audio || !this.data.playing) return
        this.observe(Math.round(audio.currentTime * 1000))
      }, 500)
    },
    async refreshPlayback(force = false): Promise<boolean> {
      if (this.data.teacherReview) {
        const route = this.data.teacherReviewRoute, session = getSession()
        if (!route || !session || session.sessionId !== this.data.sessionId
          || (session.activeRole ?? session.user.role) !== 'teacher') return false
        if (!force && Date.parse(this.data.playback?.expiresAt ?? '') > Date.now() + 5000) return true
        const result = await getTeacherTaskMediaReviewEvidence(session.user.id,
          route.submissionId, route.itemId)
        if (getSession()?.sessionId !== session.sessionId) return false
        if (!result.ok || result.data.kind !== 'listening'
          || result.data.submissionId !== route.submissionId || result.data.itemId !== route.itemId) {
          this.setData({ playbackError: result.ok ? '听力证据已失效' : result.error.message }); return false
        }
        destroyAudio()
        const view = teacherReviewMediaView(result.data)
        this.setData({ snapshot: view.snapshot, playback: view.playback,
          questions: view.questions, teacherReviewProgress: view.progressLabel,
          playbackError: view.playback.temporaryUrl ? '' : '原音频当前不可试听，作答记录仍可核对' })
        return Boolean(view.playback.temporaryUrl)
      }
      if (this.data.teacherPreview) {
        const pages = getCurrentPages() as Array<{ options?: Record<string, string> }>
        const route = teacherContentPreviewRoute(pages[pages.length - 1]?.options)
        const session = getSession()
        if (!route || !session || (session.activeRole ?? session.user.role) !== 'teacher'
          || session.sessionId !== this.data.sessionId) return false
        if (!force && Date.parse(this.data.playback?.expiresAt ?? '') > Date.now() + 5000) return true
        const result = await previewTeacherAsset(session.user.id, route.resourceId, route.targetClassIds)
        if (getSession()?.sessionId !== session.sessionId) return false
        if (!result.ok || result.data.kind !== 'listening') {
          this.setData({ playbackError: result.ok ? '试听内容已失效' : result.error.message }); return false
        }
        destroyAudio()
        const view = teacherMediaTaskPreview(result.data)
        this.setData({ snapshot: view.snapshot, playback: view.playback, questions: view.questions,
          playbackError: '' })
        return true
      }
      const session = getSession(), detail = this.data.detail
      const snapshot = this.data.snapshot, playback = this.data.playback
      if (!session || !detail || !snapshot || !playback || session.sessionId !== this.data.sessionId) return false
      if (!force && taskMediaPlaybackReady(snapshot, playback, Date.now() + 5000)) return true
      const result = await getTaskMediaPlayback(session.user.id, detail.task.id, this.data.itemId)
      if (getSession()?.sessionId !== session.sessionId) return false
      if (!result.ok || !taskMediaPlaybackReady(snapshot, result.data, Date.now())) {
        this.pause()
        this.setData({ playbackError: '播放地址已失效，请重试获取；作答已保留' }); return false
      }
      destroyAudio()
      const confirmedMs = result.data.confirmedThroughMs
      this.setData({ playback: result.data, confirmedMs, lastReportedMs: confirmedMs,
        confirmedPercent: Math.round(confirmedMs * 100 / snapshot.durationMs),
        currentMs: Math.min(this.data.currentMs, confirmedMs), playbackError: '' })
      return true
    },
    startBufferTimer() {
      clearBufferTimer()
      bufferTimer = setTimeout(() => {
        if (!this.data.buffering) return
        this.pause()
        this.setData({ playbackError: '音频加载超时，请检查网络后重试；进度和答案已保留' })
      }, 12000)
    },
    async togglePlayback() {
      const snapshot = this.data.snapshot
      if (!snapshot || this.data.heartbeatBusy) return
      if (this.data.playing) { this.pause(); return }
      if (this.data.pendingHeartbeat) {
        this.setData({ playbackError: '播放进度尚未同步，请先重试' }); return
      }
      if (!await this.refreshPlayback()) return
      const playback = this.data.playback
      if (!playback?.temporaryUrl) return
      const replay = this.data.currentMs >= snapshot.durationMs
        && (this.data.teacherPreview || this.data.confirmedMs >= snapshot.durationMs)
      const startMs = replay ? 0 : this.data.teacherPreview ? this.data.currentMs
        : Math.min(this.data.currentMs, this.data.confirmedMs)
      if (replay) this.updatePosition(0)
      if (!audio) {
        const next = wx.createInnerAudioContext()
        audio = next
        requestedSeekMs = startMs
        next.playbackRate = this.data.speed
        next.onCanplay(() => {
          if (audio !== next) return
          if (requestedSeekMs !== null) { next.seek(requestedSeekMs / 1000); requestedSeekMs = null }
        })
        next.onPlay(() => { if (audio === next) { this.setData({ playing: true }); this.startProgressPolling() } })
        next.onPause(() => { if (audio === next) {
          clearBufferTimer(); clearProgressTimer(); this.setData({ playing: false, buffering: false }) } })
        next.onWaiting(() => { if (audio === next) {
          this.setData({ buffering: true }); this.startBufferTimer() } })
        next.onTimeUpdate(() => { if (audio === next) this.observe(Math.round(next.currentTime * 1000)) })
        next.onEnded(() => { if (audio === next) this.finish() })
        next.onError(() => { if (audio === next) {
          destroyAudio(); this.setData({ playing: false, buffering: false,
            playbackError: '音频播放失败，请重试；服务端已确认的进度不会丢失' }) } })
        next.src = playback.temporaryUrl
      } else if (Math.abs(audio.currentTime * 1000 - startMs) > 500) audio.seek(startMs / 1000)
      observedMs = startMs; observedAt = Date.now()
      this.setData({ playing: true, buffering: true, playbackError: '', warning: '' })
      this.startBufferTimer()
      this.startProgressPolling()
      audio.play()
    },
    updatePosition(currentMs: number) {
      const snapshot = this.data.snapshot
      if (!snapshot) return
      const subtitle = snapshot.subtitleCues?.find(cue => cue.startMs <= currentMs
        && cue.endMs > currentMs)?.text ?? ''
      this.setData({ currentMs, currentLabel: formatRecordingDuration(currentMs),
        positionPercent: Math.round(currentMs * 100 / snapshot.durationMs), subtitle })
    },
    observe(positionMs: number) {
      const snapshot = this.data.snapshot
      if (!snapshot || !this.data.playing || !Number.isSafeInteger(positionMs)) return
      const currentMs = Math.max(0, Math.min(positionMs, snapshot.durationMs))
      if (this.data.teacherPreview) {
        clearBufferTimer()
        if (this.data.buffering) this.setData({ buffering: false })
        this.updatePosition(currentMs)
        if (this.data.clipEndMs && currentMs >= this.data.clipEndMs) {
          this.pause(); this.setData({ clipEndMs: 0 })
        }
        return
      }
      if (requestedSeekMs !== null) {
        if (Math.abs(currentMs - requestedSeekMs) > 1000) return
        requestedSeekMs = null
      }
      const now = Date.now()
      if (observedAt && currentMs - observedMs > Math.max(0, now - observedAt) * 2 + 1500
        && currentMs > this.data.confirmedMs) {
        this.pause()
        this.setData({ warning: '任务需按顺序播放，已回到确认位置' })
        this.seekTo(this.data.confirmedMs)
        return
      }
      const progressed = currentMs > observedMs
      observedMs = currentMs; observedAt = now
      if (progressed) { clearBufferTimer()
        if (this.data.buffering) this.setData({ buffering: false }) }
      this.updatePosition(currentMs)
      if (this.data.clipEndMs && currentMs >= this.data.clipEndMs) {
        this.pause(); this.setData({ clipEndMs: 0 }); return
      }
      if (!this.data.heartbeatBusy && !this.data.pendingHeartbeat
        && currentMs - this.data.lastReportedMs >= 2000) {
        const sessionId = this.data.playback?.sessionId
        if (sessionId) void this.sendHeartbeat({ sessionId, fromMs: this.data.lastReportedMs,
          toMs: currentMs, operationId: createPageOperationId('listening_heartbeat') })
      }
    },
    async sendHeartbeat(pending: PendingHeartbeat) {
      const session = getSession(), snapshot = this.data.snapshot
      if (!session || !snapshot || this.data.heartbeatBusy) return
      this.setData({ heartbeatBusy: true, pendingHeartbeat: pending })
      const result = await reportTaskMediaHeartbeat(session.user.id, pending.sessionId,
        pending.fromMs, pending.toMs, pending.toMs, pending.operationId)
      if (this.data.playback?.sessionId !== pending.sessionId || getSession()?.sessionId !== session.sessionId) return
      if (!result.ok || result.data.sessionId !== pending.sessionId
        || result.data.confirmedThroughMs < this.data.confirmedMs
        || result.data.confirmedThroughMs > snapshot.durationMs) {
        this.pause()
        this.setData({ heartbeatBusy: false, playbackError: '播放进度同步失败，请重试；答案已保留' })
        return
      }
      const confirmedMs = result.data.confirmedThroughMs
      this.setData({ heartbeatBusy: false, pendingHeartbeat: null,
        confirmedMs, lastReportedMs: confirmedMs, completed: result.data.completed,
        confirmedPercent: Math.round(confirmedMs * 100 / snapshot.durationMs),
        playback: { ...this.data.playback!, confirmedThroughMs: confirmedMs }, playbackError: '' })
      if (this.data.finishPending) void this.flushFinish()
    },
    finish() {
      const snapshot = this.data.snapshot
      if (!snapshot) return
      this.pause()
      this.updatePosition(snapshot.durationMs)
      if (this.data.teacherPreview) { this.setData({ completed: true, clipEndMs: 0 }); return }
      this.setData({ clipEndMs: 0, finishPending: true })
      void this.flushFinish()
    },
    async flushFinish() {
      const snapshot = this.data.snapshot, sessionId = this.data.playback?.sessionId
      if (!snapshot || !sessionId || !this.data.finishPending || this.data.heartbeatBusy
        || this.data.pendingHeartbeat) return
      this.setData({ finishPending: false })
      if (this.data.lastReportedMs >= snapshot.durationMs) return
      await this.sendHeartbeat({ sessionId, fromMs: this.data.lastReportedMs,
        toMs: snapshot.durationMs, operationId: createPageOperationId('listening_finish') })
    },
    seekTo(positionMs: number) {
      const snapshot = this.data.snapshot
      if (!snapshot) return
      const target = Math.max(0, Math.min(positionMs, snapshot.durationMs))
      requestedSeekMs = target
      audio?.seek(target / 1000)
      observedMs = target; observedAt = Date.now()
      this.updatePosition(target)
    },
    seek(event: WechatMiniprogram.CustomEvent<{ percent: number }>) {
      const snapshot = this.data.snapshot, playback = this.data.playback
      if (!snapshot || !playback) return
      const requested = Math.round(snapshot.durationMs * event.detail.percent / 100)
      if (this.data.teacherPreview) { this.seekTo(requested); return }
      const target = taskMediaSeekTarget(requested, snapshot, playback)
      if (target < requested) this.setData({ warning: '未播放的部分不能跳过，请先顺序收听' })
      this.seekTo(target)
    },
    blockSeek() {
      if (this.data.teacherPreview) return
      this.setData({ warning: '未播放的部分不能跳过，请先顺序收听' })
      this.seekTo(this.data.confirmedMs)
    },
    chooseSpeed() {
      const session = getSession()
      const speed = nextLearningSpeed(this.data.speed)
      audio && (audio.playbackRate = speed)
      this.setData({ speed })
      if (session && !this.data.teacherPreview) saveLearningSpeed(session.user.id, speed)
    },
    toggleEarMode() {
      if (!this.data.teacherPreview) return
      this.setData({ earMode: !this.data.earMode })
    },
    async retry() {
      if (this.data.pendingHeartbeat) {
        await this.sendHeartbeat(this.data.pendingHeartbeat)
        return
      }
      this.pause(); destroyAudio()
      if (await this.refreshPlayback(true)) void this.togglePlayback()
    },
    playClip(event: WechatMiniprogram.TouchEvent) {
      const questionId = event.currentTarget.dataset.id as string
      const clip = this.data.snapshot?.clips.find(item => item.questionId === questionId)
      if (!clip) { this.setData({ playbackError: '本题音频片段不可用，请联系老师' }); return }
      if (!this.data.teacherPreview && clip.startMs > this.data.confirmedMs) {
        this.setData({ warning: '请先顺序收听到本题，再单独重听' }); return
      }
      this.seekTo(clip.startMs)
      this.setData({ clipEndMs: clip.endMs })
      if (!this.data.playing) void this.togglePlayback()
    },
    persistAnswers(answers: Record<string, string | string[]>) {
      const detail = this.data.detail, snapshot = this.data.snapshot
      if (!detail || !snapshot) return
      const key = draftKey(detail, this.data.itemId, snapshot.mediaVersion, this.data.sessionId)
      this.setData({ draftError: writeTaskMediaDraft(key, answers) ? '' : '本机持久保存失败，返回任务详情后请先同步作答' })
    },
    chooseOption(event: WechatMiniprogram.TouchEvent) {
      if (this.data.teacherPreview) return
      const snapshot = this.data.snapshot
      if (!snapshot) return
      const questionId = event.currentTarget.dataset.questionId as string
      const value = event.currentTarget.dataset.value as string
      const question = snapshot.questions.find(item => item.questionId === questionId)
      if (!question || !question.options.includes(value)) return
      if (question.questionType !== 'single_choice' && question.questionType !== 'multiple_choice') return
      const old = this.data.answers[questionId]
      const answer = question.questionType === 'multiple_choice'
        ? Array.isArray(old) ? old.includes(value) ? old.filter(item => item !== value) : [...old, value] : [value]
        : value
      const answers = { ...this.data.answers, [questionId]: answer }
      this.setData({ answers, questions: mediaQuestionRows(snapshot, answers) })
      this.persistAnswers(answers)
    },
    inputAnswer(event: WechatMiniprogram.Input) {
      if (this.data.teacherPreview) return
      const snapshot = this.data.snapshot
      if (!snapshot) return
      const questionId = event.currentTarget.dataset.questionId as string
      const question = snapshot.questions.find(item => item.questionId === questionId)
      if (!question || (question.questionType !== 'fill' && question.questionType !== 'subjective')) return
      const answers = { ...this.data.answers, [questionId]: event.detail.value }
      this.setData({ answers, questions: mediaQuestionRows(snapshot, answers) })
      this.persistAnswers(answers)
    },
    onTeacherReviewScore(event: WechatMiniprogram.Input) {
      const route = this.data.teacherReviewRoute
      if (this.data.teacherReview && this.data.teacherScoreRequired && route) {
        this.setData(updateTeacherReviewScore(route, event.detail.value))
      }
    },
    async returnToTask() {
      this.pause()
      if (this.data.teacherPreview) { wx.navigateBack(); return }
      this.persistAnswers(this.data.answers)
      const pending = this.data.pendingHeartbeat
      if (pending && !this.data.heartbeatBusy) await this.sendHeartbeat(pending)
      const currentMs = this.data.currentMs
      if (!this.data.heartbeatBusy && !this.data.pendingHeartbeat
        && currentMs > this.data.lastReportedMs) {
        const sessionId = this.data.playback?.sessionId
        if (sessionId) await this.sendHeartbeat({ sessionId,
          fromMs: this.data.lastReportedMs, toMs: currentMs,
          operationId: createPageOperationId('listening_return') })
      }
      if (this.data.finishPending && !this.data.heartbeatBusy && !this.data.pendingHeartbeat) {
        await this.flushFinish()
      }
      if (this.data.heartbeatBusy || this.data.pendingHeartbeat || this.data.finishPending
        || (currentMs >= (this.data.snapshot?.durationMs ?? Number.POSITIVE_INFINITY)
          && !this.data.completed)) {
        this.setData({ warning: '播放进度尚未同步成功，请重试后再返回；答案已保留' })
        return
      }
      wx.navigateBack()
    },
  },
})
