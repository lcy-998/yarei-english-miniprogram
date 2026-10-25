import type { M3TaskMediaPlaybackView, M3TaskMediaSnapshotView, TaskDetailView } from '../../../domain/types'
import { getTaskDetail } from '../services/app-service'
import { beginTaskMediaSession, getTaskMediaPlayback, reportTaskMediaHeartbeat } from '../services/task-media-service'
import { getCurrentTaskId, getSession, getTeacherReviewScoreDraft,
  setTeacherReviewScoreDraft } from '../session/session'
import { createPageOperationId } from '../shared/write-intent'
import { formatRecordingDuration } from '../shared/recording-duration'
import { readTaskMediaDraft, taskMediaDraftKey, writeTaskMediaDraft } from '../shared/task-media-draft'
import { mediaQuestionRows, savedTaskMediaAnswers, taskMediaPlaybackReady, taskMediaSeekTarget } from '../shared/student-task-media-policy'
import { nativeVideoSpeed, nextLearningSpeed, readLearningSpeed, saveLearningSpeed } from '../pages/student/student-media-preferences'
import { teacherContentPreviewRoute } from '../shared/teacher-content-preview'
import { teacherMediaTaskPreview } from '../shared/teacher-media-task-preview'
import { previewTeacherAsset } from '../services/teacher-media-service'
import { getTeacherTaskMediaReviewEvidence } from '../services/teacher-media-service'
import { teacherReviewRoute, loadTeacherReviewItem, type TeacherReviewRoute } from '../shared/teacher-review-item'
import { teacherReviewMediaView, teacherReviewScoreState } from '../shared/teacher-review-student-page'
import { previewVideoQuestionScore, withQuestionScoreDraft } from '../shared/teacher-question-score'
import { parseReviewScoreInput } from '../shared/review-task-state'

type VideoKind = 'video' | 'dubbing'
type PendingHeartbeat = { sessionId: string; fromMs: number; toMs: number; operationId: string }
let bufferTimer: ReturnType<typeof setTimeout> | null = null
let observedMs = 0
let observedAt = 0
function clearBufferTimer(): void { if (bufferTimer) clearTimeout(bufferTimer); bufferTimer = null }
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
    teacherItemScorePreview: null as number | null,
    detail: null as TaskDetailView | null, itemId: '', itemTitle: '', kind: '' as '' | VideoKind,
    snapshot: null as M3TaskMediaSnapshotView | null,
    playback: null as M3TaskMediaPlaybackView | null,
    questions: [] as Array<ReturnType<typeof mediaQuestionRows>[number] & {
      verdict?: string; teacherScoreRequired?: boolean; teacherScoreInput?: string; teacherScoreError?: string }>,
    answers: {} as Record<string, string | string[]>,
    playing: false, buffering: false, speed: 1,
    currentMs: 0, confirmedMs: 0, lastReportedMs: 0,
    currentLabel: '00:00', durationLabel: '00:00', positionPercent: 0, confirmedPercent: 0,
    completed: false, subtitle: '', subtitleTranslation: '', subtitleInChinese: false,
    warning: '', playbackError: '', draftError: '',
    heartbeatBusy: false, pendingHeartbeat: null as PendingHeartbeat | null,
    finishPending: false, pendingSeekMs: null as number | null, pendingSeekAt: 0,
  },
  lifetimes: { detached() { clearBufferTimer() } },
  pageLifetimes: {
    show() { const session = getSession()
      if (this.data.teacherPreview && (session?.activeRole ?? session?.user.role) !== 'teacher') {
        this.pause()
        this.setData({ loading: false, error: '教师预览权限已变化，请返回重新进入' })
        return
      }
      if (!this.data.initialized || session?.sessionId !== this.data.sessionId) void this.load() },
    hide() { this.pause() },
  },
  methods: {
    video() { return wx.createVideoContext('task-video', this) },
    async load() {
      this.pause()
      const session = getSession()
      const pages = getCurrentPages() as Array<{ options?: Record<string, string> }>
      const options = pages[pages.length - 1]?.options ?? {}
      if (options.teacherReview === '1') {
        const route = teacherReviewRoute(options)
        if (!route) { this.setData({ loading: false, error: '缺少要查看的视频提交' }); return }
        this.setData({ loading: true, error: '', initialized: true,
          sessionId: session?.sessionId ?? '', teacherPreview: true,
          teacherReview: true, teacherReviewRoute: route, playbackError: '' })
        const submission = await loadTeacherReviewItem(route, 'video')
        if (getSession()?.sessionId !== session?.sessionId) return
        if (!submission.ok) { this.setData({ loading: false, error: submission.message }); return }
        const evidence = await getTeacherTaskMediaReviewEvidence(session!.user.id,
          route.submissionId, route.itemId)
        if (getSession()?.sessionId !== session?.sessionId) return
        if (!evidence.ok || evidence.data.kind !== 'video'
          || evidence.data.submissionId !== route.submissionId
          || evidence.data.itemId !== route.itemId) {
          this.setData({ loading: false, error: evidence.ok ? '视频证据与当前提交不一致' : evidence.error.message }); return
        }
        const view = teacherReviewMediaView(evidence.data)
        const draft = getTeacherReviewScoreDraft()
        const questionInputs = draft?.submissionId === route.submissionId
          && draft.itemId === route.itemId ? draft.questionInputs ?? {} : {}
        const questions = withQuestionScoreDraft(view.questions, questionInputs)
        this.setData({ loading: false, itemId: route.itemId, itemTitle: evidence.data.title,
          kind: 'video', snapshot: view.snapshot, playback: view.playback,
          questions, teacherItemScorePreview: previewVideoQuestionScore(questions),
          teacherReviewVersion: evidence.data.submissionVersion,
          teacherReviewProgress: view.progressLabel,
          ...teacherReviewScoreState(route, submission.submission),
          currentMs: 0, confirmedMs: 0, lastReportedMs: 0,
          currentLabel: '00:00', durationLabel: formatRecordingDuration(evidence.data.durationMs),
          positionPercent: 0, confirmedPercent: 0, completed: false,
          speed: 1, playing: false, buffering: false })
        return
      }
      if (options.teacherPreview === '1') {
        const route = teacherContentPreviewRoute(options)
        if (!session || (session.activeRole ?? session.user.role) !== 'teacher'
          || !route || route.type !== 'video') {
          this.setData({ loading: false, error: '仅授权教师可预览视频内容' }); return
        }
        this.setData({ loading: true, error: '', initialized: true,
          sessionId: session.sessionId, teacherPreview: true, playbackError: '' })
        const result = await previewTeacherAsset(session.user.id, route.resourceId, route.targetClassIds)
        if (getSession()?.sessionId !== session.sessionId) return
        if (!result.ok || result.data.kind !== 'video') {
          this.setData({ loading: false, error: result.ok ? '预览内容类型不匹配' : result.error.message }); return
        }
        const view = teacherMediaTaskPreview(result.data)
        this.setData({ loading: false, itemTitle: result.data.title,
          kind: 'video', snapshot: view.snapshot, playback: view.playback,
          questions: view.questions, currentMs: 0, confirmedMs: 0, lastReportedMs: 0,
          currentLabel: '00:00', durationLabel: formatRecordingDuration(result.data.durationMs),
          positionPercent: 0, confirmedPercent: 0, completed: false,
          speed: 1, playing: false, buffering: false })
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
      if (!item || (item.type !== 'video' && item.type !== 'dubbing')
        || snapshot?.kind !== item.type) {
        this.setData({ loading: false, error: '视频任务缺少可用的发布内容，请联系老师' }); return
      }
      const result = await beginTaskMediaSession(session.user.id, taskId, itemId,
        createPageOperationId('begin_task_video'))
      if (getSession()?.sessionId !== session.sessionId) return
      if (!result.ok || !taskMediaPlaybackReady(snapshot, result.data, Date.now())) {
        this.setData({ loading: false, error: result.ok ? '播放会话尚未就绪，请重试' : result.error.message }); return
      }
      const answers = { ...savedTaskMediaAnswers(detail, itemId, snapshot),
        ...readTaskMediaDraft(draftKey(detail, itemId, snapshot.mediaVersion, session.sessionId)) }
      const confirmedMs = result.data.confirmedThroughMs
      observedMs = confirmedMs; observedAt = Date.now()
      this.setData({ loading: false, error: '', detail, itemId, itemTitle: item.title,
        kind: snapshot.kind, snapshot, playback: result.data,
        answers, questions: mediaQuestionRows(snapshot, answers),
        playing: false, buffering: false,
        speed: nativeVideoSpeed(readLearningSpeed(session.user.id)).speed,
        currentMs: confirmedMs, confirmedMs, lastReportedMs: confirmedMs,
        currentLabel: formatRecordingDuration(confirmedMs),
        durationLabel: formatRecordingDuration(snapshot.durationMs),
        positionPercent: Math.round(confirmedMs * 100 / snapshot.durationMs),
        confirmedPercent: Math.round(confirmedMs * 100 / snapshot.durationMs),
        completed: snapshot.kind === 'video' ? confirmedMs >= Math.ceil(snapshot.durationMs * .9)
          : confirmedMs >= snapshot.durationMs,
        subtitle: '', subtitleTranslation: '', subtitleInChinese: false,
        warning: '', heartbeatBusy: false, pendingHeartbeat: null,
        finishPending: false, pendingSeekMs: null, pendingSeekAt: 0 })
    },
    pause() {
      clearBufferTimer()
      if (this.data.playback) this.video().pause()
      this.setData({ playing: false, buffering: false })
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
        if (!result.ok || result.data.kind !== 'video'
          || result.data.submissionId !== route.submissionId || result.data.itemId !== route.itemId) {
          this.setData({ playbackError: result.ok ? '视频证据已失效' : result.error.message }); return false
        }
        const view = teacherReviewMediaView(result.data)
        const draft = getTeacherReviewScoreDraft()
        const questions = withQuestionScoreDraft(view.questions,
          draft?.submissionId === route.submissionId && draft.itemId === route.itemId
            ? draft.questionInputs ?? {} : {})
        this.setData({ snapshot: view.snapshot, playback: view.playback,
          questions, teacherItemScorePreview: previewVideoQuestionScore(questions),
          teacherReviewProgress: view.progressLabel,
          playbackError: view.playback.temporaryUrl ? '' : '原视频当前不可播放，作答记录仍可核对' })
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
        if (!result.ok || result.data.kind !== 'video') {
          this.setData({ playbackError: result.ok ? '预览内容已失效' : result.error.message }); return false
        }
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
        this.pause(); this.setData({ playbackError: '播放地址已失效，请重试获取；作答已保留' }); return false
      }
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
        this.pause(); this.setData({ playbackError: '视频加载超时，请检查网络后重试；进度和答案已保留' })
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
      const replay = this.data.currentMs >= snapshot.durationMs
        && (this.data.teacherPreview || this.data.confirmedMs >= snapshot.durationMs)
      const startMs = replay ? 0 : this.data.teacherPreview ? this.data.currentMs
        : Math.min(this.data.currentMs, this.data.confirmedMs)
      if (replay) this.updatePosition(0)
      const video = this.video()
      const speed = nativeVideoSpeed(this.data.speed)
      let speedWarning = ''
      try { video.playbackRate(speed.speed) }
      catch (_error: unknown) { this.setData({ speed: 1 });
        speedWarning = '当前设备不能调速，已使用 1 倍速' }
      this.setData({ pendingSeekMs: startMs, pendingSeekAt: Date.now(),
        playing: true, buffering: true, playbackError: '', warning: speedWarning })
      observedMs = startMs; observedAt = Date.now()
      this.startBufferTimer()
      video.seek(startMs / 1000)
      video.play()
    },
    onVideoPlay() { this.setData({ playing: true })
      observedMs = this.data.currentMs; observedAt = Date.now() },
    onVideoPause() { clearBufferTimer(); this.setData({ playing: false, buffering: false }) },
    onVideoWaiting() { this.setData({ buffering: true }); this.startBufferTimer() },
    onVideoError() { this.pause(); this.setData({ playbackError: '视频播放失败，请重试；已确认进度不受影响' }) },
    onVideoEnded() { this.finish() },
    onVideoTimeUpdate(event: WechatMiniprogram.CustomEvent<{ currentTime: number }>) {
      const currentMs = Math.round(event.detail.currentTime * 1000)
      const pending = this.data.pendingSeekMs
      if (pending !== null) {
        if (Math.abs(currentMs - pending) > 750 && Date.now() - this.data.pendingSeekAt < 3000) return
        this.setData({ pendingSeekMs: null, pendingSeekAt: 0 })
        observedMs = currentMs; observedAt = Date.now()
      }
      this.observe(currentMs)
    },
    updatePosition(currentMs: number) {
      const snapshot = this.data.snapshot
      if (!snapshot) return
      this.setData({ currentMs, currentLabel: formatRecordingDuration(currentMs),
        positionPercent: Math.round(currentMs * 100 / snapshot.durationMs) })
    },
    toggleSubtitleLanguage() {
      if (this.data.subtitle) this.setData({ subtitleInChinese: !this.data.subtitleInChinese })
    },
    observe(positionMs: number) {
      const snapshot = this.data.snapshot
      if (!snapshot || !this.data.playing || !Number.isSafeInteger(positionMs)) return
      const currentMs = Math.max(0, Math.min(positionMs, snapshot.durationMs))
      if (this.data.teacherPreview) {
        clearBufferTimer()
        if (this.data.buffering) this.setData({ buffering: false })
        this.updatePosition(currentMs)
        const cue = snapshot.subtitleCues?.find(item => item.startMs <= currentMs && item.endMs > currentMs)
        const subtitle = cue?.text ?? ''
        const subtitleTranslation = cue?.translationText ?? ''
        if (subtitle !== this.data.subtitle || subtitleTranslation !== this.data.subtitleTranslation) {
          this.setData({ subtitle, subtitleTranslation })
        }
        return
      }
      const now = Date.now()
      if (observedAt && currentMs - observedMs > Math.max(0, now - observedAt) * 2 + 1500
        && currentMs > this.data.confirmedMs) {
        this.pause(); this.setData({ warning: '任务需按顺序播放，已回到确认位置' })
        this.seekTo(this.data.confirmedMs)
        return
      }
      const progressed = currentMs > observedMs
      observedMs = currentMs; observedAt = now
      if (progressed) { clearBufferTimer()
        if (this.data.buffering) this.setData({ buffering: false }) }
      this.updatePosition(currentMs)
      const cue = snapshot.subtitleCues?.find(item => item.startMs <= currentMs && item.endMs > currentMs)
      const subtitle = cue?.text ?? ''
      const subtitleTranslation = cue?.translationText ?? ''
      if (subtitle !== this.data.subtitle || subtitleTranslation !== this.data.subtitleTranslation) {
        this.setData({ subtitle, subtitleTranslation })
      }
      if (!this.data.heartbeatBusy && !this.data.pendingHeartbeat
        && currentMs - this.data.lastReportedMs >= 2000) {
        const sessionId = this.data.playback?.sessionId
        if (sessionId) void this.sendHeartbeat({ sessionId, fromMs: this.data.lastReportedMs,
          toMs: currentMs, operationId: createPageOperationId('task_video_heartbeat') })
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
        this.pause(); this.setData({ heartbeatBusy: false,
          playbackError: '播放进度同步失败，请重试；答案已保留' }); return
      }
      const confirmedMs = result.data.confirmedThroughMs
      this.setData({ heartbeatBusy: false, pendingHeartbeat: null, confirmedMs,
        lastReportedMs: confirmedMs, completed: result.data.completed,
        confirmedPercent: Math.round(confirmedMs * 100 / snapshot.durationMs),
        playback: { ...this.data.playback!, confirmedThroughMs: confirmedMs }, playbackError: '' })
      if (this.data.finishPending) void this.flushFinish()
    },
    finish() {
      const snapshot = this.data.snapshot
      if (!snapshot) return
      this.pause(); this.updatePosition(snapshot.durationMs)
      if (this.data.teacherPreview) { this.setData({ completed: true }); return }
      this.setData({ finishPending: true })
      void this.flushFinish()
    },
    async flushFinish() {
      const snapshot = this.data.snapshot, sessionId = this.data.playback?.sessionId
      if (!snapshot || !sessionId || !this.data.finishPending || this.data.heartbeatBusy
        || this.data.pendingHeartbeat) return
      this.setData({ finishPending: false })
      if (this.data.lastReportedMs >= snapshot.durationMs) return
      await this.sendHeartbeat({ sessionId, fromMs: this.data.lastReportedMs,
        toMs: snapshot.durationMs, operationId: createPageOperationId('task_video_finish') })
    },
    seekTo(positionMs: number) {
      const snapshot = this.data.snapshot
      if (!snapshot) return
      const target = Math.max(0, Math.min(positionMs, snapshot.durationMs))
      this.setData({ pendingSeekMs: target, pendingSeekAt: Date.now() })
      this.video().seek(target / 1000)
      observedMs = target; observedAt = Date.now()
      this.updatePosition(target)
    },
    seek(event: WechatMiniprogram.CustomEvent<{ percent: number }>) {
      const snapshot = this.data.snapshot, playback = this.data.playback
      if (!snapshot || !playback) return
      const requested = Math.round(snapshot.durationMs * event.detail.percent / 100)
      if (this.data.teacherPreview) { this.seekTo(requested); return }
      const target = taskMediaSeekTarget(requested, snapshot, playback)
      if (target < requested) this.setData({ warning: '未播放的部分不能跳过，请先顺序观看' })
      this.seekTo(target)
    },
    blockSeek() { if (!this.data.teacherPreview) this.setData({ warning: '未播放的部分不能跳过，请先顺序观看' }) },
    chooseSpeed() {
      const session = getSession(), selected = nextLearningSpeed(this.data.speed)
      const speed = nativeVideoSpeed(selected)
      try { this.video().playbackRate(speed.speed) }
      catch (_error: unknown) { this.setData({ warning: '当前设备不能调速，已使用 1 倍速' }); return }
      this.setData({ speed: speed.speed,
        warning: speed.fallback ? '当前视频不支持 0.75 倍速，已使用 1 倍速' : '' })
      if (session && !this.data.teacherPreview) saveLearningSpeed(session.user.id, speed.speed)
    },
    async retry() {
      if (this.data.pendingHeartbeat) { await this.sendHeartbeat(this.data.pendingHeartbeat); return }
      this.pause()
      if (await this.refreshPlayback(true)) void this.togglePlayback()
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
      if (!snapshot || snapshot.kind !== 'video') return
      const questionId = event.currentTarget.dataset.questionId as string
      const value = event.currentTarget.dataset.value as string
      const question = snapshot.questions.find(item => item.questionId === questionId)
      if (!question || !question.options.includes(value)) return
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
      if (!snapshot || snapshot.kind !== 'video') return
      const questionId = event.currentTarget.dataset.questionId as string
      if (!snapshot.questionIds.includes(questionId)) return
      const answers = { ...this.data.answers, [questionId]: event.detail.value }
      this.setData({ answers, questions: mediaQuestionRows(snapshot, answers) })
      this.persistAnswers(answers)
    },
    onTeacherQuestionScore(event: WechatMiniprogram.Input) {
      const route = this.data.teacherReviewRoute
      const questionId = event.currentTarget.dataset.questionId as string
      if (!this.data.teacherReview || !this.data.teacherScoreRequired || !route
        || !this.data.questions.some(question => question.questionId === questionId
          && question.teacherScoreRequired)) return
      const old = getTeacherReviewScoreDraft()
      const questionInputs = old?.submissionId === route.submissionId && old.itemId === route.itemId
        ? { ...old.questionInputs } : {}
      const parsed = parseReviewScoreInput(event.detail.value)
      questionInputs[questionId] = parsed.input
      const reviewQuestions = this.data.questions.filter((question): question is typeof question & { verdict: string } =>
        typeof question.verdict === 'string')
      if (reviewQuestions.length !== this.data.questions.length) return
      const questions = withQuestionScoreDraft(reviewQuestions, questionInputs)
      const preview = previewVideoQuestionScore(questions)
      setTeacherReviewScoreDraft({ submissionId: route.submissionId, itemId: route.itemId,
        input: preview === null ? '' : String(preview), questionInputs })
      this.setData({ questions, teacherItemScorePreview: preview,
        teacherScoreInput: preview === null ? '' : String(preview), teacherScoreError: '' })
    },
    async returnToTask() {
      this.pause()
      if (this.data.teacherPreview || this.data.kind === 'dubbing') { wx.navigateBack(); return }
      const pending = this.data.pendingHeartbeat
      if (pending && !this.data.heartbeatBusy) await this.sendHeartbeat(pending)
      const currentMs = this.data.currentMs
      if (!this.data.heartbeatBusy && !this.data.pendingHeartbeat
        && currentMs > this.data.lastReportedMs) {
        const sessionId = this.data.playback?.sessionId
        if (sessionId) await this.sendHeartbeat({ sessionId,
          fromMs: this.data.lastReportedMs, toMs: currentMs,
          operationId: createPageOperationId('task_video_return') })
      }
      if (this.data.finishPending && !this.data.heartbeatBusy && !this.data.pendingHeartbeat) {
        await this.flushFinish()
      }
      if (this.data.heartbeatBusy || this.data.pendingHeartbeat || this.data.finishPending
        || this.data.playbackError) {
        this.setData({ warning: '播放进度尚未同步成功，请重试后再返回；答案已保留' })
        return
      }
      wx.navigateBack()
    },
  },
})
