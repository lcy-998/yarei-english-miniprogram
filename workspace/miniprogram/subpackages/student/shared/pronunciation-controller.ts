// S-05 跟读与试验性评分。评分、次数和参考文本均由可信服务核对。
import { getSession } from '../session/session'
import { getReadingResource } from '../services/app-service'
import { formatRecordingDuration } from './recording-duration'
import { createPageOperationId } from './write-intent'
import {
  beginPronunciationRecording, beginPronunciationScore, getPronunciationScore, getReadingPronunciationSegments,
  listPronunciationAttempts,
  sealPronunciationRecording,
  type PronunciationRecordingDraft, type PronunciationScoreView, type PronunciationSource,
  type TeacherPronunciationEvidence,
  type SealedPronunciationRecording,
} from '../services/student-pronunciation-service'
import { pronunciationSourceFromOptions, recordingIssue, scoreDisplay } from './pronunciation-state'
import { validDemonstrationAudio } from './reading-media-view'
import { nextLearningSpeed, readLearningSpeed, saveLearningSpeed } from '../pages/student/student-media-preferences'

type RecorderStop = { duration: number; fileSize: number; tempFilePath: string }
type LocalDraft = {
  savedAt: string
  source: PronunciationSource
  serverDraft: PronunciationRecordingDraft | null
  sealed: SealedPronunciationRecording | null
  stagingFileId: string
  localPath: string
  durationMs: number
  sizeBytes: number
  beginOperationId: string
  sealOperationId: string
  scoreOperationId: string
  scoreId: string
  scoreRecoveryCheckedAt: number
}

let receiver: { stop: (result: RecorderStop) => void; error: () => void } | null = null
let recorderOwner: unknown = null
let recorderBound = false
let recordStartedAt = 0
let tickTimer: ReturnType<typeof setInterval> | null = null
const scoreTimers = new WeakMap<object, ReturnType<typeof setTimeout>>()
let activeAudio: ReturnType<typeof wx.createInnerAudioContext> | null = null
let activeAudioOwner: object | null = null
let demonstrationAudio: ReturnType<typeof wx.createInnerAudioContext> | null = null
let demonstrationAudioOwner: { setData(data: { demonstrationPlaying: boolean }): void } | null = null

function stopDemonstrationAudio() {
  demonstrationAudio?.destroy()
  demonstrationAudio = null
  demonstrationAudioOwner?.setData({ demonstrationPlaying: false })
  demonstrationAudioOwner = null
}

function recorder() {
  const manager = wx.getRecorderManager()
  if (!recorderBound) {
    recorderBound = true
    manager.onStop(result => receiver?.stop(result))
    manager.onError(() => receiver?.error())
  }
  return manager
}

function stopRecordingTimer() {
  if (tickTimer !== null) clearInterval(tickTimer)
  tickTimer = null
}

function clearScoreTimer(owner: object) {
  const timer = scoreTimers.get(owner)
  if (timer !== undefined) clearTimeout(timer)
  scoreTimers.delete(owner)
}

function storageKey(userId: string, sessionId: string, source: PronunciationSource): string {
  return `pronunciation_local_${userId}_${sessionId}_${source.kind}_${source.kind === 'reading' ? source.resourceId : source.taskId}_${source.segmentId}`
}

function sameStudentSession(userId: string, sessionId: string): boolean {
  const current = getSession()
  return current?.user.id === userId && current.sessionId === sessionId
    && (current.activeRole ?? current.user.role) === 'student'
}

function savedDraft(value: unknown, source: PronunciationSource): LocalDraft | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Partial<LocalDraft>
  if (JSON.stringify(candidate.source) !== JSON.stringify(source)
    || typeof candidate.savedAt !== 'string' || !Number.isFinite(Date.parse(candidate.savedAt))
    || Date.now() - Date.parse(candidate.savedAt) > 24 * 60 * 60 * 1000
    || Date.parse(candidate.savedAt) > Date.now() + 5 * 60 * 1000
    || typeof candidate.localPath !== 'string' || typeof candidate.durationMs !== 'number'
    || typeof candidate.sizeBytes !== 'number') return null
  return {
    savedAt: candidate.savedAt, source, serverDraft: candidate.serverDraft ?? null, sealed: candidate.sealed ?? null,
    stagingFileId: candidate.stagingFileId ?? '', localPath: candidate.localPath,
    durationMs: candidate.durationMs, sizeBytes: candidate.sizeBytes,
    beginOperationId: candidate.beginOperationId ?? '', sealOperationId: candidate.sealOperationId ?? '',
    scoreOperationId: candidate.scoreOperationId ?? '', scoreId: candidate.scoreId ?? '',
    scoreRecoveryCheckedAt: candidate.scoreRecoveryCheckedAt ?? 0,
  }
}

export function registerPronunciation(inline: boolean): void {
Component({
  properties: {
    resourceId: { type: String, value: '' },
    segmentId: { type: String, value: '' },
    taskId: { type: String, value: '' },
    itemId: { type: String, value: '' },
    referenceText: { type: String, value: '' },
    translationText: { type: String, value: '' },
    teacherReadonly: { type: Boolean, value: false },
    teacherEvidenceState: { type: String, value: 'loading' },
    teacherEvidence: { type: Object, value: {} },
    teacherEvidenceStatusLabel: { type: String, value: '' },
    teacherEvidenceMessage: { type: String, value: '' },
  },
  observers: {
    'resourceId, segmentId, taskId, itemId': function () {
      if (!this.data.teacherReadonly && inline && this.data.pageVisible && !this.data.initialized
        && this.data.resourceId && this.data.segmentId) this.initializeInlineSource()
    },
  },
  data: {
    initialized: false, source: null as PronunciationSource | null, error: '', busy: false,
    subtitleInChinese: false,
    teacherEvidencePlaying: false, teacherPlaybackError: '',
    pageVisible: false, scorePollDelayMs: 2000,
    discardOnLeave: false,
    referencePreview: '', localPath: '', durationMs: 0, sizeBytes: 0, durationLabel: '00:00',
    recordingState: 'idle' as 'idle' | 'recording' | 'local' | 'sealed',
    recordingError: '', permissionDenied: false,
    scoreError: '', scoreView: null as PronunciationScoreView | null,
    scoreStatusLabel: '', scoreMessage: '', showScore: false,
    attemptRows: [] as Array<{ scoreId: string; status: PronunciationScoreView['status'];
      label: string; scoreLabel: string; timeLabel: string }>,
    historyError: '',
    demonstrationUrl: '', demonstrationExpiresAt: '', demonstrationPlaying: false,
    demonstrationSpeed: 1, demonstrationError: '',
    effectiveAttemptNumber: 0, serverDraft: null as PronunciationRecordingDraft | null,
    sealed: null as SealedPronunciationRecording | null, stagingFileId: '',
    beginOperationId: '', sealOperationId: '', scoreOperationId: '', scoreId: '', scoreRecoveryCheckedAt: 0,
  },
  lifetimes: {
    attached() { if (this.data.teacherReadonly) return
      recorder()
      if (inline) { this.setData({ pageVisible: true });
        if (this.data.resourceId && this.data.segmentId) this.initializeInlineSource() }
    },
    detached() {
      this.setData({ pageVisible: false })
      if (!this.data.teacherReadonly && !this.data.discardOnLeave) this.rememberDraft()
      if (recorderOwner === this) {
        if (this.data.recordingState === 'recording') recorder().stop()
        receiver = null
        recorderOwner = null
        stopRecordingTimer()
      }
      clearScoreTimer(this)
      if (activeAudioOwner === this) { activeAudio?.destroy(); activeAudio = null; activeAudioOwner = null }
      if (demonstrationAudioOwner === this) stopDemonstrationAudio()
    },
  },
  pageLifetimes: {
    hide() {
      clearScoreTimer(this)
      this.setData({ pageVisible: false })
      if (this.data.teacherReadonly) {
        if (activeAudioOwner === this) activeAudio?.pause()
        this.setData({ teacherEvidencePlaying: false })
        return
      }
      if (this.data.recordingState === 'recording') { stopRecordingTimer(); recorder().stop() }
      if (activeAudioOwner === this) activeAudio?.pause()
      if (demonstrationAudioOwner === this) demonstrationAudio?.pause()
      this.setData({ demonstrationPlaying: false })
    },
    show() {
      this.setData({ pageVisible: true, scorePollDelayMs: 2000 })
      if (this.data.teacherReadonly) return
      if (this.data.initialized) {
        if (this.data.scoreId) void this.refreshScore(true)
        if (this.data.source) { void this.loadAttempts(); void this.loadDemonstration() }
        return
      }
      if (inline) { if (this.data.resourceId && this.data.segmentId) this.initializeInlineSource(); return }
      const pages = getCurrentPages() as Array<{ options?: Record<string, string> }>
      const source = pronunciationSourceFromOptions(pages[pages.length - 1]?.options ?? {})
      this.initializeSource(source)
    },
  },
  methods: {
    toggleReferenceLanguage() { this.setData({ subtitleInChinese: !this.data.subtitleInChinese }) },
    toggleTeacherEvidencePlayback() {
      if (!this.data.teacherReadonly) return
      const evidence = this.data.teacherEvidence as TeacherPronunciationEvidence | null
      const playback = evidence?.playback
      if (activeAudioOwner === this && activeAudio) {
        if (this.data.teacherEvidencePlaying) {
          activeAudio.pause()
          this.setData({ teacherEvidencePlaying: false })
        } else {
          activeAudio.play()
          this.setData({ teacherEvidencePlaying: true, teacherPlaybackError: '' })
        }
        return
      }
      if (!playback?.temporaryUrl.startsWith('https://')
        || !Number.isFinite(Date.parse(playback.expiresAt)) || Date.parse(playback.expiresAt) <= Date.now()) {
        this.setData({ teacherPlaybackError: '录音试听地址已失效，请刷新作业记录' })
        this.triggerEvent('teacherrefresh', { segmentId: this.data.segmentId })
        return
      }
      activeAudio?.destroy()
      activeAudio = null
      activeAudioOwner = null
      stopDemonstrationAudio()
      const audio = wx.createInnerAudioContext()
      activeAudio = audio
      activeAudioOwner = this
      audio.src = playback.temporaryUrl
      audio.onEnded(() => {
        if (activeAudio === audio) { audio.destroy(); activeAudio = null; activeAudioOwner = null }
        this.setData({ teacherEvidencePlaying: false })
      })
      audio.onError(() => {
        if (activeAudio === audio) { audio.destroy(); activeAudio = null; activeAudioOwner = null }
        this.setData({ teacherEvidencePlaying: false, teacherPlaybackError: '学生录音播放失败，可刷新后重试' })
      })
      this.setData({ teacherEvidencePlaying: true, teacherPlaybackError: '' })
      audio.play()
    },
    refreshTeacherEvidence() {
      if (this.data.teacherReadonly) this.triggerEvent('teacherrefresh', { segmentId: this.data.segmentId })
    },
    initializeInlineSource() {
      if (this.data.initialized) return
      const source = pronunciationSourceFromOptions(this.data.taskId && this.data.itemId
        ? { kind: 'task', taskId: this.data.taskId, itemId: this.data.itemId,
          segmentId: this.data.segmentId }
        : { kind: 'reading', resourceId: this.data.resourceId, segmentId: this.data.segmentId })
      this.initializeSource(source)
    },
    initializeSource(source: PronunciationSource | null) {
      if (!source) { this.setData({ initialized: true, error: '缺少可跟读的句段，请返回阅读页重新进入' }); return }
      const session = getSession()
      if (!session) { wx.reLaunch({ url: '/pages/auth/login/login' }); return }
      if ((session.activeRole ?? session.user.role) !== 'student') {
        this.setData({ initialized: true, error: '仅学生本人可以录制跟读' }); return
      }
      const key = storageKey(session.user.id, session.sessionId, source)
      const raw = wx.getStorageSync(key) as unknown
      const cached = savedDraft(raw, source)
      if (raw && !cached) wx.removeStorageSync(key)
      this.setData({ initialized: true, source, demonstrationSpeed: readLearningSpeed(session.user.id),
        referencePreview: inline ? this.data.referenceText : '',
        ...(cached ? {
          serverDraft: cached.serverDraft, sealed: cached.sealed, stagingFileId: cached.stagingFileId,
          localPath: cached.localPath, durationMs: cached.durationMs, sizeBytes: cached.sizeBytes,
          durationLabel: formatRecordingDuration(cached.durationMs),
          recordingState: cached.sealed ? 'sealed' as const : cached.localPath ? 'local' as const : 'idle' as const,
          referencePreview: cached.serverDraft?.referencePreview ?? (inline ? this.data.referenceText : ''),
          beginOperationId: cached.beginOperationId, sealOperationId: cached.sealOperationId,
          scoreOperationId: cached.scoreOperationId, scoreId: cached.scoreId,
          scoreRecoveryCheckedAt: cached.scoreRecoveryCheckedAt,
        } : {}) }, () => { if (cached?.scoreId) void this.refreshScore(true);
          void this.loadAttempts(); void this.loadDemonstration() })
    },
    async loadDemonstration() {
      const session = getSession(), source = this.data.source
      if (!session || !source) return
      const resourceId = source.kind === 'reading' ? source.resourceId : this.data.resourceId
      if (!resourceId) return
      const [resource, result] = await Promise.all([
        getReadingResource(session.user.id, resourceId),
        getReadingPronunciationSegments(session.user.id, resourceId),
      ])
      if (this.data.source !== source || !sameStudentSession(session.user.id, session.sessionId)) return
      if (!resource.ok || resource.data.id !== resourceId) {
        this.setData({ demonstrationUrl: '', demonstrationError: '阅读资源版本暂不可核对，请重试' }); return
      }
      if (!result.ok) { this.setData({ demonstrationError: result.error.message }); return }
      if (result.data.resourceId !== resourceId
        || result.data.sourceVersion !== resource.data.contentVersion) {
        this.setData({ demonstrationUrl: '', demonstrationError: '跟读句段版本已变化，请返回阅读页重试' }); return
      }
      const segment = result.data.segments.find(item => item.id === source.segmentId)
      if (!segment || !validDemonstrationAudio(segment, Date.now())) {
        this.setData({ demonstrationUrl: '', demonstrationError: '示范音频暂不可用' }); return
      }
      this.setData({ demonstrationUrl: segment.demonstrationAudio.temporaryUrl,
        demonstrationExpiresAt: segment.demonstrationAudio.expiresAt, demonstrationError: '',
        ...(this.data.referencePreview ? {} : { referencePreview: segment.text }) })
    },
    async retryDemonstration() { await this.loadDemonstration() },
    async playDemonstration() {
      activeAudio?.destroy(); activeAudio = null
      activeAudioOwner = null
      if (demonstrationAudio && demonstrationAudioOwner !== this) stopDemonstrationAudio()
      if (demonstrationAudio) {
        if (this.data.demonstrationPlaying) { demonstrationAudio.pause(); this.setData({ demonstrationPlaying: false }) }
        else { demonstrationAudio.play(); this.setData({ demonstrationPlaying: true }) }
        return
      }
      if (!this.data.demonstrationUrl || Date.parse(this.data.demonstrationExpiresAt) <= Date.now() + 5000) {
        await this.loadDemonstration()
      }
      if (!this.data.demonstrationUrl || Date.parse(this.data.demonstrationExpiresAt) <= Date.now()) return
      const audio = wx.createInnerAudioContext()
      demonstrationAudio = audio
      demonstrationAudioOwner = this
      audio.src = this.data.demonstrationUrl
      audio.playbackRate = this.data.demonstrationSpeed
      audio.onEnded(() => { if (demonstrationAudio === audio) { audio.destroy(); demonstrationAudio = null
        demonstrationAudioOwner = null
        this.setData({ demonstrationPlaying: false }) } })
      audio.onError(() => { if (demonstrationAudio === audio) { audio.destroy(); demonstrationAudio = null
        demonstrationAudioOwner = null
        this.setData({ demonstrationPlaying: false, demonstrationError: '示范音频播放失败，请重试' }) } })
      this.setData({ demonstrationPlaying: true })
      audio.play()
    },
    cycleDemonstrationSpeed() {
      const session = getSession()
      const speed = nextLearningSpeed(this.data.demonstrationSpeed)
      if (session) saveLearningSpeed(session.user.id, speed)
      this.setData({ demonstrationSpeed: speed })
      if (demonstrationAudioOwner === this && demonstrationAudio) demonstrationAudio.playbackRate = speed
    },
    openMicrophoneSettings() {
      wx.openSetting({ success: result => {
        this.setData({ permissionDenied: !result.authSetting['scope.record'],
          recordingError: result.authSetting['scope.record']
            ? '麦克风已允许，请重新点击开始录音' : '仍未获得麦克风权限，请在设置中允许后重试' })
      }, fail: () => this.setData({ recordingError: '无法打开权限设置，请从微信的小程序设置中允许麦克风' }) })
    },
    leave(action: 'close' | 'pagechange', delta = 0) {
      if (this.data.recordingState === 'recording') {
        wx.showToast({ title: '请先结束录音，再翻页或离开', icon: 'none' }); return
      }
      if (this.data.busy && this.data.localPath && !this.data.sealed) {
        wx.showToast({ title: '录音正在上传，请稍候', icon: 'none' }); return
      }
      const complete = () => {
        if (inline) this.triggerEvent(action, action === 'pagechange' ? { delta } : {})
        else wx.navigateBack()
      }
      if (!this.data.localPath || this.data.sealed || this.data.scoreView?.status === 'scored') { complete(); return }
      wx.showActionSheet({ itemList: ['保存录音', '放弃录音'],
        success: result => {
          if (result.tapIndex === 0) { this.rememberDraft(); complete(); return }
          if (result.tapIndex !== 1) return
          const session = getSession(), source = this.data.source
          if (session && source) wx.removeStorageSync(storageKey(session.user.id, session.sessionId, source))
          this.setData({ discardOnLeave: true })
          complete()
        } })
    },
    onBack() { this.leave('close') },
    requestPageChange(delta: number) { this.leave('pagechange', delta) },
    hasActiveRecording() { return this.data.recordingState === 'recording'
      || Boolean(this.data.busy && this.data.localPath && !this.data.sealed) },
    hasUnsubmittedRecording() { return Boolean(this.data.localPath && !this.data.sealed) },
    discardLocalDraft() {
      const session = getSession(), source = this.data.source
      if (session && source) wx.removeStorageSync(storageKey(session.user.id, session.sessionId, source))
      this.setData({ discardOnLeave: true })
    },
    rememberDraft() {
      const session = getSession(), source = this.data.source
      if (!session || !source) return
      const draft: LocalDraft = {
        savedAt: new Date().toISOString(), source, serverDraft: this.data.serverDraft, sealed: this.data.sealed,
        stagingFileId: this.data.stagingFileId, localPath: this.data.localPath,
        durationMs: this.data.durationMs, sizeBytes: this.data.sizeBytes,
        beginOperationId: this.data.beginOperationId, sealOperationId: this.data.sealOperationId,
        scoreOperationId: this.data.scoreOperationId, scoreId: this.data.scoreId,
        scoreRecoveryCheckedAt: this.data.scoreRecoveryCheckedAt,
      }
      wx.setStorageSync(storageKey(session.user.id, session.sessionId, source), draft)
    },
    async startRecording() {
      const session = getSession(), source = this.data.source
      if (!session || !source || this.data.busy || this.data.recordingState !== 'idle') return
      if (recorderOwner && recorderOwner !== this) {
        wx.showToast({ title: '请先结束另一段录音', icon: 'none' }); return
      }
      this.setData({ busy: true, recordingError: '', scoreError: '' })
      stopDemonstrationAudio()
      if (!this.data.serverDraft) {
        const operationId = this.data.beginOperationId || createPageOperationId('begin_pronunciation')
        this.setData({ beginOperationId: operationId })
        const begun = await beginPronunciationRecording(session.user.id, source, operationId)
        if (!sameStudentSession(session.user.id, session.sessionId)) return
        if (!begun.ok) { this.setData({ busy: false, recordingError: begun.error.message }); this.rememberDraft(); return }
        this.setData({ serverDraft: begun.data, referencePreview: begun.data.referencePreview,
          beginOperationId: '', busy: false })
      } else this.setData({ busy: false })
      try { await wx.authorize({ scope: 'scope.record' }) }
      catch (_error: unknown) {
        this.setData({ permissionDenied: true,
          recordingError: '请在微信设置中允许使用麦克风后重试' }); this.rememberDraft(); return
      }
      this.setData({ permissionDenied: false })
      try {
        recordStartedAt = Date.now()
        this.setData({ recordingState: 'recording', durationMs: 0, durationLabel: '00:00' })
        recorderOwner = this
        receiver = { stop: result => this.onRecorderStopped(result), error: () => this.onRecorderError() }
        recorder().start({ duration: 300000, sampleRate: 16000, encodeBitRate: 64000,
          numberOfChannels: 1, format: 'mp3' })
        tickTimer = setInterval(() => {
          if (this.data.recordingState !== 'recording') return
          const elapsed = Math.min(300000, Date.now() - recordStartedAt)
          const label = formatRecordingDuration(elapsed)
          if (label !== this.data.durationLabel) this.setData({ durationMs: elapsed, durationLabel: label })
        }, 250)
      } catch (_error: unknown) {
        stopRecordingTimer()
        if (recorderOwner === this) { receiver = null; recorderOwner = null }
        this.setData({ recordingState: 'idle', recordingError: '录音未能开始，请重试' })
      }
    },
    stopRecording() { if (this.data.recordingState === 'recording') { stopRecordingTimer(); recorder().stop() } },
    onRecorderStopped(result: RecorderStop) {
      if (this.data.recordingState !== 'recording') return
      stopRecordingTimer()
      if (recorderOwner === this) { recorderOwner = null; receiver = null }
      const issue = recordingIssue(result.duration, result.fileSize, result.tempFilePath)
      this.setData({ recordingState: result.tempFilePath ? 'local' : 'idle',
        localPath: result.tempFilePath, durationMs: result.duration,
        sizeBytes: result.fileSize, durationLabel: formatRecordingDuration(result.duration),
        recordingError: issue }, () => {
        this.rememberDraft()
        if (!issue && this.data.pageVisible) void this.uploadAndScore()
      })
    },
    onRecorderError() {
      if (this.data.recordingState !== 'recording') return
      stopRecordingTimer()
      if (recorderOwner === this) { recorderOwner = null; receiver = null }
      this.setData({ recordingState: 'idle', recordingError: '录音失败，请重新录制' })
    },
    playLocal() {
      if (!this.data.localPath) return
      if (demonstrationAudioOwner === this) { demonstrationAudio?.pause(); this.setData({ demonstrationPlaying: false }) }
      activeAudio?.destroy()
      const audio = wx.createInnerAudioContext()
      activeAudio = audio
      activeAudioOwner = this
      audio.src = this.data.localPath
      audio.onEnded(() => { audio.destroy(); if (activeAudio === audio) { activeAudio = null; activeAudioOwner = null } })
      audio.onError(() => { audio.destroy(); if (activeAudio === audio) { activeAudio = null; activeAudioOwner = null }
        this.setData({ recordingError: '本机录音暂无法试听，请重新录制' }) })
      audio.play()
    },
    redoRecording() {
      if (this.data.busy || this.data.recordingState === 'recording') return
      wx.showModal({ title: '重新录制？', content: '本机这段录音会被新录音替换，已得到的试验结果仍由服务端保留。',
        confirmText: '重录', success: result => {
          if (!result.confirm) return
          if (activeAudioOwner === this) { activeAudio?.destroy(); activeAudio = null; activeAudioOwner = null }
          this.setData({ recordingState: 'idle', localPath: '', durationMs: 0, sizeBytes: 0,
            durationLabel: '00:00', serverDraft: null, sealed: null, stagingFileId: '',
            beginOperationId: '', sealOperationId: '', scoreOperationId: '', scoreId: '',
            scoreRecoveryCheckedAt: 0,
            scoreView: null, scoreStatusLabel: '', scoreMessage: '', showScore: false,
            recordingError: '', scoreError: '' }, () => this.rememberDraft())
        } })
    },
    async uploadAndScore() {
      const session = getSession(), draft = this.data.serverDraft
      if (!session || !draft || (!this.data.sealed && !this.data.localPath) || this.data.busy) return
      if (!this.data.sealed) {
        const issue = recordingIssue(this.data.durationMs, this.data.sizeBytes, this.data.localPath)
        if (issue) { this.setData({ recordingError: issue }); return }
      }
      this.setData({ busy: true, recordingError: '', scoreError: '',
        scoreStatusLabel: '正在提交录音', scoreMessage: '录音已结束，正在上传并请求试验评分。' })
      let stagingFileId = this.data.stagingFileId
      if (!this.data.sealed && !stagingFileId) {
        try {
          const uploaded = await wx.cloud.uploadFile({ cloudPath: draft.stagingPath,
            filePath: this.data.localPath })
          if (!sameStudentSession(session.user.id, session.sessionId)) return
          stagingFileId = uploaded.fileID
          this.setData({ stagingFileId }, () => this.rememberDraft())
        } catch (_error: unknown) {
          this.setData({ busy: false, scoreStatusLabel: '', scoreMessage: '',
            recordingError: '上传失败，本机录音已保留，可重试' })
          this.rememberDraft(); return
        }
      }
      let sealed = this.data.sealed
      if (!sealed) {
        const operationId = this.data.sealOperationId || createPageOperationId('seal_pronunciation')
        this.setData({ sealOperationId: operationId })
        const result = await sealPronunciationRecording(session.user.id, draft.recordingId,
          stagingFileId, operationId)
        if (!sameStudentSession(session.user.id, session.sessionId)) return
        if (!result.ok) {
          const rejectedMedia = result.error.code === 'MEDIA_INVALID'
          this.setData({ busy: false, scoreStatusLabel: '', scoreMessage: '',
            ...(rejectedMedia ? { stagingFileId: '', sealOperationId: '' } : {}),
            recordingError: rejectedMedia
              ? '云端未能核验这段录音；本机录音已保留，可重新录制或重试上传'
              : `${result.error.message}；本机录音已保留` })
          this.rememberDraft(); return
        }
        sealed = result.data
        this.setData({ sealed, recordingState: 'sealed', sealOperationId: '' }, () => this.rememberDraft())
      }
      await this.requestScore(sealed.recordingId)
    },
    async requestScore(recordingId: string) {
      const session = getSession()
      if (!session) return
      const operationId = this.data.scoreOperationId || createPageOperationId('score_pronunciation')
      const expectedVersion = this.data.scoreView?.expectedVersion ?? this.data.sealed?.expectedVersion ?? 2
      this.setData({ scoreOperationId: operationId, busy: true, scoreError: '', scorePollDelayMs: 2000,
        scoreView: null, showScore: false, scoreStatusLabel: '云端评分请求中',
        scoreMessage: '录音已保留，请等待服务端处理；离开后可返回刷新。' })
      const result = await beginPronunciationScore(session.user.id, recordingId, operationId, expectedVersion)
      if (!sameStudentSession(session.user.id, session.sessionId)) return
      if (!result.ok) {
        this.setData({ busy: false, scoreId: recordingId,
          scoreStatusLabel: '评分状态待核对',
          scoreError: `${result.error.message}；录音已保留，可重试` })
        this.rememberDraft()
        void this.refreshScore(true)
        return
      }
      this.setData({ busy: false, scoreId: result.data.scoreId,
        scoreRecoveryCheckedAt: Date.now() })
      this.acceptScore(result.data)
      this.rememberDraft()
      void this.loadAttempts()
      if (result.data.status === 'processing') this.scheduleScoreRefresh()
    },
    acceptScore(view: PronunciationScoreView) {
      const display = scoreDisplay(view, this.data.source?.kind)
      const autonomousFailure = this.data.source?.kind === 'reading' && view.status === 'failed'
        && !view.retryable
      this.setData({ scoreView: view, scoreStatusLabel: autonomousFailure ? '本次评分未完成' : display.statusLabel,
        scoreMessage: autonomousFailure
          ? '可以重新录制并评分；自主阅读分数只在本次阅读显示，不保留在历史记录。'
          : display.message, showScore: display.showScore,
        effectiveAttemptNumber: view.effectiveAttemptNumber ?? 0 })
    },
    scheduleScoreRefresh() {
      clearScoreTimer(this)
      if (!this.data.pageVisible || this.data.scoreView?.status !== 'processing') return
      const delayMs = this.data.scorePollDelayMs
      const timer = setTimeout(async () => {
        scoreTimers.delete(this)
        if (Date.now() - this.data.scoreRecoveryCheckedAt >= 90_000) {
          await this.recoverStalledDispatch()
        }
        const refreshed = await this.refreshScore()
        if (refreshed && this.data.pageVisible && this.data.scoreView?.status === 'processing') {
          this.setData({ scorePollDelayMs: Math.min(10000, delayMs * 2) })
          this.scheduleScoreRefresh()
        }
      }, delayMs)
      scoreTimers.set(this, timer)
    },
    async recoverStalledDispatch() {
      const session = getSession(), recordingId = this.data.scoreId
      if (!session || !recordingId || this.data.scoreView?.status !== 'processing') return
      const operationId = this.data.scoreOperationId || createPageOperationId('recover_pronunciation')
      this.setData({ scoreRecoveryCheckedAt: Date.now(), scoreStatusLabel: '正在检查后台评分任务' },
        () => this.rememberDraft())
      try {
        const result = await beginPronunciationScore(session.user.id, recordingId, operationId,
          this.data.scoreView.expectedVersion ?? this.data.sealed?.expectedVersion ?? 2)
        if (!sameStudentSession(session.user.id, session.sessionId)) return
        if (!result.ok) {
          this.setData({ scoreError: `${result.error.message}；录音已保留，可稍后重试查询` })
          return
        }
        this.acceptScore(result.data)
        this.setData({ scoreId: result.data.scoreId, scoreError: '' }, () => this.rememberDraft())
        void this.loadAttempts()
      } catch {
        // Still query status below; a failed recovery request must not stop polling.
        this.setData({ scoreError: '后台恢复检查暂不可用，正在继续查询评分状态' })
      }
    },
    async refreshScore(resumePolling = false): Promise<boolean> {
      const session = getSession(), scoreId = this.data.scoreId
      if (!session || !scoreId) return false
      const result = await getPronunciationScore(session.user.id, scoreId)
      if (!sameStudentSession(session.user.id, session.sessionId)) return false
      if (!result.ok) { this.setData({ scoreError: `${result.error.message}；录音已保留，可手动刷新` }); return result.error.retryable }
      this.acceptScore(result.data)
      this.setData({ scoreError: '' })
      void this.loadAttempts()
      if (resumePolling && result.data.status === 'processing') this.scheduleScoreRefresh()
      return true
    },
    manualRefreshScore() {
      if (this.data.scoreView?.status === 'processing') {
        void this.recoverStalledDispatch().then(() => this.refreshScore(true))
        return
      }
      this.setData({ scoreStatusLabel: '正在查询评分状态', scoreError: '' },
        () => { void this.refreshScore(true) })
    },
    async loadAttempts() {
      const session = getSession(), source = this.data.source
      if (!session || !source) return
      if (source.kind === 'reading') {
        this.setData({ attemptRows: [], historyError: '' })
        return
      }
      const result = await listPronunciationAttempts(session.user.id, source)
      if (this.data.source !== source || !sameStudentSession(session.user.id, session.sessionId)) return
      if (!result.ok) { this.setData({ historyError: result.error.message }); return }
      const rows = [...result.data].reverse().slice(0, 10).map(view => ({
        scoreId: view.scoreId, status: view.status, label: scoreDisplay(view).statusLabel,
        scoreLabel: view.status === 'scored' && scoreDisplay(view).showScore && view.score
          ? `${view.score.total} 分（试验）` : view.status === 'processing' ? '后台处理中'
            : view.status === 'unreliable' ? '暂未生成分数'
              : view.status === 'failed' ? '评分失败' : '待评分',
        timeLabel: view.scoredAt ? view.scoredAt.replace('T', ' ').slice(0, 16) : '未完成评分',
      }))
      this.setData({ attemptRows: rows, historyError: '' })
    },
    recoverProcessingScore(event: WechatMiniprogram.TouchEvent) {
      const scoreId = event.currentTarget.dataset.id as string
      if (!this.data.attemptRows.some(row => row.scoreId === scoreId && row.status === 'processing')) return
      this.setData({ scoreId, scoreStatusLabel: '试验评分中',
        scoreMessage: '已找回本人未完成的试验评分，正在核对最新状态。', showScore: false },
      () => { void this.recoverStalledDispatch().then(() => this.refreshScore(true)) })
    },
    retryScore() {
      const recordingId = this.data.sealed?.recordingId
      if (!recordingId || this.data.busy) return
      if (this.data.source?.kind === 'reading' && this.data.scoreView?.status === 'failed'
        && !this.data.scoreView.retryable) {
        const session = getSession(), source = this.data.source
        if (session && source) wx.removeStorageSync(storageKey(session.user.id, session.sessionId, source))
        if (activeAudioOwner === this) { activeAudio?.destroy(); activeAudio = null; activeAudioOwner = null }
        this.setData({ serverDraft: null, sealed: null, stagingFileId: '', localPath: '',
          durationMs: 0, sizeBytes: 0, durationLabel: '00:00', recordingState: 'idle',
          beginOperationId: '', sealOperationId: '', scoreOperationId: '', scoreId: '',
          scoreRecoveryCheckedAt: 0, scoreView: null, scoreStatusLabel: '', scoreMessage: '',
          scoreError: '', showScore: false, recordingError: '' }, () => { void this.startRecording() })
        return
      }
      if (this.data.scoreView?.status === 'failed') {
        this.setData({ scoreOperationId: createPageOperationId('score_pronunciation') },
          () => { void this.requestScore(recordingId) })
        return
      }
      void this.requestScore(recordingId)
    },
    finish() { if (inline) this.triggerEvent('close'); else wx.navigateBack() },
  },
})
}
