import { M3TaskMediaPlaybackView, M3TaskMediaSnapshotView, StudentWork, TaskDubbingWorkView,
  WorkMaterial, WorkMaterialFacet, WorkMaterialFilters } from '../domain/types'
import { getRepositoryMode } from '../../../repositories/repository-factory'
import { beginWorkDraft, getMaterialPlayback, getTaskDetail, getWorkMaterial, listMyWorks,
  listWorkMaterialFacets, searchWorkMaterials, submitWork } from '../services/app-service'
import { beginTaskMediaSession, getTaskMediaPlayback, reportTaskMediaHeartbeat } from '../services/task-media-service'
import { getTeacherTaskMediaReviewEvidence, previewTeacherAsset } from '../services/teacher-media-service'
import type { TeacherAssetPreview, TeacherTaskMediaReviewEvidenceView } from '../../../domain/teacher-media'
import { beginTaskDubbingWork, getTaskDubbingPlayback, sealTaskDubbingWork } from '../services/student-task-dubbing-service'
import { findSubmittedTaskDubbingWork } from '../services/task-dubbing-work-lookup'
import { getSession, getTeacherReviewScoreDraft, setTeacherReviewScoreDraft } from '../session/session'
import { parseReviewScoreInput } from '../shared/review-task-state'
import { clearDubbingLocalDraft, readDubbingLocalDraft, saveDubbingLocalDraft } from '../shared/dubbing-local-draft'
import { dubbingRecordingIssue } from '../shared/dubbing-recording-validation'
import { formatRecordingDuration } from '../shared/recording-duration'
import { taskMediaPlaybackReady, taskMediaSeekTarget } from '../shared/student-task-media-policy'
import { takePreferredDubbingMaterial } from '../shared/dubbing-navigation'
import { nativeVideoSpeed, nextLearningSpeed, readLearningSpeed, saveLearningSpeed } from '../pages/student/student-media-preferences'
import { EMPTY_WRITE_INTENT, WriteIntentState, clearWriteIntent, createPageOperationId, prepareWriteIntent } from '../shared/write-intent'
import { readTaskDubbingLocalDraft, saveTaskDubbingLocalDraft } from '../shared/task-dubbing-local-draft'
import { teacherContentPreviewRoute } from '../shared/teacher-content-preview'
import { dubbingCueState, validDubbingSubtitleCues } from '../shared/dubbing-subtitle'

type StopResult = { duration: number; fileSize: number; tempFilePath: string }
let activeRecorder: { stop: (result: StopResult) => void; error: () => void } | null = null
let recorderBound = false
const recorder = wx.getRecorderManager()
let recordingStartedAtMs: number | null = null
let recordingTimer: ReturnType<typeof setInterval> | null = null
let materialSearchTimer: ReturnType<typeof setTimeout> | null = null
let materialSearchRequest = 0
let teacherFinalAudio: ReturnType<typeof wx.createInnerAudioContext> | null = null
let studentRecordingAudio: ReturnType<typeof wx.createInnerAudioContext> | null = null
function stopStudentRecordingAudio(): void {
  studentRecordingAudio?.stop()
  studentRecordingAudio?.destroy()
  studentRecordingAudio = null
}
type PendingDubbingHeartbeat = { sessionId: string; fromMs: number; toMs: number; operationId: string }
let taskVideoObservedMs = 0
let taskVideoObservedAt = 0
let taskVideoPendingSeekAt = 0
let taskVideoBufferTimer: ReturnType<typeof setTimeout> | null = null
function clearTaskVideoBufferTimer(): void {
  if (taskVideoBufferTimer) clearTimeout(taskVideoBufferTimer)
  taskVideoBufferTimer = null
}

function teacherDubbingReviewRoute(): { submissionId: string; itemId: string } | null {
  const pages = typeof getCurrentPages === 'function'
    ? getCurrentPages() as Array<{ options?: Record<string, string> }> : []
  const options = pages[pages.length - 1]?.options
  return options?.teacherReview === '1' && options.submissionId && options.itemId
    ? { submissionId: options.submissionId, itemId: options.itemId } : null
}

function teacherDubbingPreviewRoute(): { resourceId: string; targetClassIds?: string[] } | null {
  const pages = typeof getCurrentPages === 'function'
    ? getCurrentPages() as Array<{ options?: Record<string, string> }> : []
  const route = teacherContentPreviewRoute(pages[pages.length - 1]?.options)
  return route?.type === 'dubbing' ? route : null
}

function blockedDubbingRoute(): string {
  const pages = typeof getCurrentPages === 'function'
    ? getCurrentPages() as Array<{ options?: Record<string, string> }> : []
  const options = pages[pages.length - 1]?.options
  return options?.teacherReview === '1' ? (options.submissionId && options.itemId ? '' : '缺少要检查的配音提交')
    : options?.teacherPreview === '1' && !teacherDubbingPreviewRoute() ? '教师预览入口尚未就绪，请返回内容选择重新进入'
    : Boolean(options?.taskId) !== Boolean(options?.itemId) ? '任务配音入口缺少任务或内容项'
      : ''
}

function taskDubbingRoute(): { taskId: string; itemId: string } | null {
  const pages = typeof getCurrentPages === 'function'
    ? getCurrentPages() as Array<{ options?: Record<string, string> }> : []
  const options = pages[pages.length - 1]?.options
  return options?.taskId && options.itemId ? { taskId: options.taskId, itemId: options.itemId } : null
}

function filterOptions(facets: readonly WorkMaterialFacet[], filters: { grade: string; textbook: string; unit: string }) {
  const grades = [...new Set(facets.map(facet => facet.grade || '未标注年级'))].sort((a, b) => a.localeCompare(b, 'zh-CN'))
  const byGrade = facets.filter(facet => filters.grade === '全部年级'
    || (facet.grade || '未标注年级') === filters.grade)
  const textbooks = [...new Set(byGrade.map(facet => facet.textbook || '未标注教材'))]
    .sort((a, b) => a.localeCompare(b, 'zh-CN'))
  const byTextbook = byGrade.filter(facet => filters.textbook === '全部教材'
    || (facet.textbook || '未标注教材') === filters.textbook)
  const units = [...new Set(byTextbook.map(facet => facet.unit || '未标注单元'))]
    .sort((a, b) => a.localeCompare(b, 'zh-CN'))
  return { grades, textbooks, units }
}

function catalogFilters(grade: string, textbook: string, unit: string): WorkMaterialFilters {
  return {
    ...(grade === '全部年级' ? {} : { grade: grade === '未标注年级' ? '__unlabeled_grade__' : grade }),
    ...(textbook === '全部教材' ? {} : { textbook: textbook === '未标注教材' ? '__unlabeled_textbook__' : textbook }),
    ...(unit === '全部单元' ? {} : { unit: unit === '未标注单元' ? '__unlabeled_unit__' : unit }),
  }
}

function stopRecordingTimer(): void {
  if (recordingTimer !== null) clearInterval(recordingTimer)
  recordingTimer = null
  recordingStartedAtMs = null
}

function startRecordingTimer(onTick: () => void): void {
  stopRecordingTimer()
  recordingStartedAtMs = Date.now()
  recordingTimer = setInterval(onTick, 250)
}

function bindRecorder(): void {
  if (recorderBound) return
  recorderBound = true
  recorder.onStop(result => activeRecorder?.stop(result))
  recorder.onError(() => activeRecorder?.error())
}

Component({
  data: {
    initialized: false,
    loading: true,
    error: '',
    submitError: '',
    teacherReviewMode: false,
    teacherReviewSessionId: '',
    teacherEvidence: null as TeacherTaskMediaReviewEvidenceView | null,
    teacherSubtitle: '', teacherSubtitleTranslation: '', teacherFinalPlaying: false, teacherFinalDurationLabel: '未记录',
    teacherScoreInput: '', teacherScoreError: '',
    teacherPreviewMode: false, teacherPreviewAsset: null as TeacherAssetPreview | null,
    teacherPreviewSessionId: '', teacherPreviewSubtitle: '', teacherPreviewSubtitleTranslation: '', teacherPreviewPlaying: false,
    subtitleInChinese: false,
    taskMode: false, taskId: '', taskItemId: '', taskTitle: '', taskRound: 0, taskExpectedRound: 0,
    taskSnapshot: null as M3TaskMediaSnapshotView | null,
    taskPlayback: null as M3TaskMediaPlaybackView | null, taskPlaybackReady: false,
    taskSubtitle: '', taskSubtitleTranslation: '', taskVideoBuffering: false, taskVideoCurrentMs: 0,
    taskVideoConfirmedMs: 0, taskVideoLastReportedMs: 0,
    taskVideoCurrentLabel: '00:00', taskVideoDurationLabel: '00:00',
    taskVideoPositionPercent: 0, taskVideoConfirmedPercent: 0,
    taskVideoHeartbeatBusy: false,
    taskVideoPendingHeartbeat: null as PendingDubbingHeartbeat | null,
    taskVideoPendingSeekMs: null as number | null,
    taskVideoFinishPending: false,
    taskVideoPlaybackError: '', taskVideoWarning: '',
    taskWork: null as TaskDubbingWorkView | null, taskStagingFileId: '',
    taskBeginIntent: EMPTY_WRITE_INTENT as WriteIntentState,
    taskSealIntent: EMPTY_WRITE_INTENT as WriteIntentState,
    materials: [] as WorkMaterial[],
    hasAuthorizedMaterials: false,
    materialTotal: 0,
    materialNextOffset: null as number | null,
    materialKeyword: '',
    materialSelectOpen: false,
    materialSearchLoading: false,
    materialSearchError: '',
    materialFacets: [] as WorkMaterialFacet[],
    materialFilterOptions: { grades: [] as string[], textbooks: [] as string[], units: [] as string[] },
    gradeFilter: '全部年级',
    textbookFilter: '全部教材',
    unitFilter: '全部单元',
    materialFilterOpen: '',
    selectedMaterialId: '',
    selectedMaterial: null as WorkMaterial | null,
    practiceSubtitleCues: [] as Array<{ startMs: number; endMs: number; text: string;
      translationText?: string }>,
    practiceSubtitleIndex: -1,
    practicePreviousCueIndex: -1, practiceNextCueIndex: -1,
    practiceSubtitleText: '', practiceSubtitleTranslation: '',
    demonstrationUrl: '',
    demonstrationSpeed: 1,
    taskVideoPlaying: false,
    videoSpeedNotice: '',
    recordingState: 'idle' as 'idle' | 'recording' | 'local' | 'uploading' | 'submitted',
    recordingIssue: '',
    permissionDenied: false,
    localPath: '',
    durationMs: 0,
    durationLabel: '00:00',
    fileSize: 0,
    note: '',
    draft: null as StudentWork | null,
    submittedWork: null as StudentWork | null,
    submitting: false,
    beginIntent: EMPTY_WRITE_INTENT as WriteIntentState,
    submitIntent: EMPTY_WRITE_INTENT as WriteIntentState,
  },
  lifetimes: {
    detached() {
      teacherFinalAudio?.destroy(); teacherFinalAudio = null
      stopStudentRecordingAudio()
      if (!this.data.teacherPreviewMode && !this.data.teacherReviewMode) this.rememberLocalDraft()
      stopRecordingTimer()
      if (materialSearchTimer) clearTimeout(materialSearchTimer)
      materialSearchRequest += 1
      activeRecorder = null
      if (this.data.recordingState === 'recording') recorder.stop()
    },
  },
  pageLifetimes: {
    hide() { if (this.data.recordingState === 'recording') { stopRecordingTimer(); recorder.stop() }
      stopStudentRecordingAudio()
      teacherFinalAudio?.pause(); this.setData({ teacherFinalPlaying: false })
      if (this.data.teacherReviewMode) wx.createVideoContext('teacher-demonstration-video', this).pause()
      if (this.data.teacherPreviewMode) { wx.createVideoContext('teacher-preview-dubbing-video', this).pause()
        this.setData({ teacherPreviewPlaying: false }) }
      if (this.data.taskMode) this.pauseTaskDemonstration() },
    show() {
      const previewRoute = teacherDubbingPreviewRoute()
      if (previewRoute) {
        const session = getSession()
        if (!this.data.teacherPreviewMode || !session
          || session.sessionId !== this.data.teacherPreviewSessionId
          || this.data.teacherPreviewAsset?.playback.expiresAt
            && Date.parse(this.data.teacherPreviewAsset.playback.expiresAt) <= Date.now() + 5000) {
          void this.loadTeacherAssetPreview(previewRoute.resourceId, previewRoute.targetClassIds)
        }
        return
      }
      const teacherRoute = teacherDubbingReviewRoute()
      if (teacherRoute) {
        if (!this.data.teacherReviewMode) {
          void this.loadTeacherDubbingReview(teacherRoute.submissionId, teacherRoute.itemId)
          return
        }
        const session = getSession()
        if (!session || (session.activeRole ?? session.user.role) !== 'teacher'
          || session.sessionId !== this.data.teacherReviewSessionId) {
          this.setData({ teacherEvidence: null }, () => this.refreshTeacherDubbingReview())
        }
        return
      }
      const session = getSession()
      if (session && (session.activeRole ?? session.user.role) === 'student') {
        bindRecorder()
        activeRecorder = { stop: result => this.onRecorderStopped(result), error: () => this.onRecorderFailed() }
      }
      const route = taskDubbingRoute()
      if (route && !this.data.taskMode) void this.loadTaskDubbing(route.taskId, route.itemId)
      else if (route && this.data.taskMode) void this.refreshTaskVideoPlayback()
      else if (!this.data.initialized) {
        this.setData({ initialized: true })
        void this.loadMaterials()
      }
    },
  },
  methods: {
    async loadMaterials() {
      const previewRoute = teacherDubbingPreviewRoute()
      if (previewRoute) { await this.loadTeacherAssetPreview(previewRoute.resourceId, previewRoute.targetClassIds); return }
      const blocked = blockedDubbingRoute()
      if (blocked) { this.setData({ loading: false, error: blocked }); return }
      const teacherRoute = teacherDubbingReviewRoute()
      if (teacherRoute) { await this.loadTeacherDubbingReview(teacherRoute.submissionId, teacherRoute.itemId); return }
      const route = taskDubbingRoute()
      if (route) { await this.loadTaskDubbing(route.taskId, route.itemId); return }
      const session = getSession()
      if (!session) { wx.redirectTo({ url: '/pages/auth/login/login' }); return }
      if ((session.activeRole ?? session.user.role) !== 'student') {
        this.setData({ loading: false, error: '教师请从任务内容选择页进入配音预览' }); return
      }
      this.setData({ loading: true, error: '' })
      const [result, facets] = await Promise.all([
        searchWorkMaterials(session.user.id, '', 20, 0), listWorkMaterialFacets(session.user.id),
      ])
      const blockedAfterLoad = blockedDubbingRoute()
      if (blockedAfterLoad) { this.setData({ loading: false, error: blockedAfterLoad }); return }
      if (taskDubbingRoute()) return
      if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
      const saved = readDubbingLocalDraft(session.user.id, session.sessionId)
      const preferredMaterialId = takePreferredDubbingMaterial(session.user.id, session.sessionId)
      const remembered = wx.getStorageSync(`dubbing_recent_material_${session.user.id}`) as unknown
      const recentMaterialId = typeof remembered === 'string' ? remembered : ''
      const hasLocalRecording = Boolean(saved?.localPath || this.data.localPath)
      let selectedMaterialId = saved?.materialId || preferredMaterialId
        || this.data.selectedMaterialId || recentMaterialId || result.data.items[0]?.id || ''
      const listedMaterial = result.data.items.find(item => item.id === selectedMaterialId)
      const selectedResult = selectedMaterialId && !listedMaterial
        ? await getWorkMaterial(session.user.id, selectedMaterialId) : null
      let authorizedMaterial = listedMaterial ?? (selectedResult?.ok ? selectedResult.data : null)
      if (!authorizedMaterial && !saved?.materialId && !preferredMaterialId && !hasLocalRecording) {
        authorizedMaterial = result.data.items[0] ?? null
        selectedMaterialId = authorizedMaterial?.id ?? ''
      }
      const needsPreferredTitle = preferredMaterialId && saved?.localPath && saved.materialId !== preferredMaterialId
      const preferredListed = needsPreferredTitle
        ? result.data.items.find(item => item.id === preferredMaterialId) : undefined
      const preferredLookup = needsPreferredTitle && !preferredListed
        ? await getWorkMaterial(session.user.id, preferredMaterialId) : null
      const preferredTitle = preferredListed?.title ?? (preferredLookup?.ok ? preferredLookup.data.title : '指定素材')
      const materialVersion = saved?.materialVersion ?? this.data.draft?.materialVersion
      const selectedMaterial = authorizedMaterial && (!hasLocalRecording || !materialVersion
        || authorizedMaterial.contentVersion === materialVersion) ? authorizedMaterial : null
      const practiceSubtitleCues = validDubbingSubtitleCues(selectedMaterial?.subtitleCues)
      const initialSubtitle = dubbingCueState(practiceSubtitleCues, 0)
      const savedVideoSpeed = nativeVideoSpeed(readLearningSpeed(session.user.id))
      if (savedVideoSpeed.fallback) saveLearningSpeed(session.user.id, savedVideoSpeed.speed)
      this.setData({ loading: false, materials: result.data.items, hasAuthorizedMaterials: result.data.total > 0,
        demonstrationSpeed: savedVideoSpeed.speed,
        videoSpeedNotice: savedVideoSpeed.fallback ? '视频播放器不支持 0.75 倍速，已使用 1 倍速。' : '',
        materialTotal: result.data.total,
        materialNextOffset: result.data.nextOffset, materialKeyword: '', materialSelectOpen: false,
        materialSearchLoading: false, materialSearchError: '', selectedMaterialId, selectedMaterial,
        practiceSubtitleCues, practiceSubtitleIndex: initialSubtitle.index,
        practicePreviousCueIndex: initialSubtitle.previousIndex,
        practiceNextCueIndex: initialSubtitle.nextIndex,
        practiceSubtitleText: initialSubtitle.text,
        practiceSubtitleTranslation: initialSubtitle.translationText, subtitleInChinese: false,
        materialFacets: facets.ok ? facets.data : [],
        materialFilterOptions: filterOptions(facets.ok ? facets.data : [],
          { grade: '全部年级', textbook: '全部教材', unit: '全部单元' }),
        gradeFilter: '全部年级', textbookFilter: '全部教材', unitFilter: '全部单元', materialFilterOpen: '',
        ...(saved ? { localPath: saved.localPath, durationMs: saved.durationMs,
          durationLabel: formatRecordingDuration(saved.durationMs), fileSize: saved.fileSize, note: saved.note,
          recordingIssue: dubbingRecordingIssue(saved.durationMs, saved.fileSize, saved.localPath),
          draft: saved.draft, beginIntent: saved.beginIntent, submitIntent: saved.submitIntent,
          recordingState: 'local' as const } : {}),
        ...(preferredMaterialId && saved?.localPath && saved.materialId !== preferredMaterialId
          ? { submitError: `本次打卡需使用“${preferredTitle}”；当前保留了另一素材的录音，请先切换素材。` }
          : hasLocalRecording && !selectedMaterial
          ? { submitError: '原配音素材已不可用或已更新，录音仍保留；请重新选择素材并录制' }
          : preferredMaterialId && !selectedMaterial
            ? { submitError: '原配音素材已不可用，请选择其他素材' } : {}) },
      () => this.loadDemonstration())
    },
    async loadTeacherAssetPreview(resourceId: string, targetClassIds?: string[]) {
      const session = getSession()
      if (!session || (session.activeRole ?? session.user.role) !== 'teacher') {
        this.setData({ loading: false, error: '仅授权教师可预览任务配音内容' }); return
      }
      this.setData({ teacherPreviewMode: true, loading: true, error: '',
        teacherPreviewAsset: null, teacherPreviewPlaying: false, teacherPreviewSubtitle: '',
        teacherPreviewSubtitleTranslation: '' })
      const result = await previewTeacherAsset(session.user.id, resourceId, targetClassIds)
      if (getSession()?.sessionId !== session.sessionId) return
      if (!result.ok || result.data.kind !== 'dubbing') {
        this.setData({ loading: false, error: result.ok ? '预览内容类型不匹配' : result.error.message }); return
      }
      this.setData({ loading: false, teacherPreviewAsset: result.data,
        teacherPreviewSessionId: session.sessionId })
    },
    onTeacherPreviewVideoTimeUpdate(event: WechatMiniprogram.CustomEvent<{ currentTime: number }>) {
      const asset = this.data.teacherPreviewAsset
      if (!this.data.teacherPreviewMode || !asset) return
      const positionMs = Math.round(event.detail.currentTime * 1000)
      const cue = asset.subtitles.find(item => item.startMs <= positionMs && item.endMs > positionMs)
      const subtitle = cue?.text ?? '', subtitleTranslation = cue?.translationText ?? ''
      if (subtitle !== this.data.teacherPreviewSubtitle
        || subtitleTranslation !== this.data.teacherPreviewSubtitleTranslation) {
        this.setData({ teacherPreviewSubtitle: subtitle, teacherPreviewSubtitleTranslation: subtitleTranslation })
      }
    },
    toggleTeacherPreviewVideo() {
      if (!this.data.teacherPreviewAsset) return
      if (Date.parse(this.data.teacherPreviewAsset.playback.expiresAt) <= Date.now() + 5000) {
        this.refreshTeacherAssetPreview(); return
      }
      const video = wx.createVideoContext('teacher-preview-dubbing-video', this)
      if (this.data.teacherPreviewPlaying) video.pause()
      else video.play()
      this.setData({ teacherPreviewPlaying: !this.data.teacherPreviewPlaying })
    },
    onTeacherPreviewVideoPause() { this.setData({ teacherPreviewPlaying: false }) },
    onTeacherPreviewVideoError() {
      this.setData({ teacherPreviewPlaying: false, error: '示范视频预览失败，请刷新授权地址' })
    },
    replayTeacherPreviewVideo() {
      if (!this.data.teacherPreviewAsset) return
      if (Date.parse(this.data.teacherPreviewAsset.playback.expiresAt) <= Date.now() + 5000) {
        this.refreshTeacherAssetPreview(); return
      }
      const video = wx.createVideoContext('teacher-preview-dubbing-video', this)
      video.seek(0); video.play()
      this.setData({ teacherPreviewPlaying: true })
    },
    refreshTeacherAssetPreview() {
      const route = teacherDubbingPreviewRoute()
      if (route) void this.loadTeacherAssetPreview(route.resourceId, route.targetClassIds)
    },
    async loadTeacherDubbingReview(submissionId: string, itemId: string) {
      const session = getSession()
      if (!session || (session.activeRole ?? session.user.role) !== 'teacher') {
        this.setData({ loading: false, error: '仅当前授权教师可查看这份配音提交' }); return
      }
      this.setData({ teacherReviewMode: true, loading: true, error: '' })
      const result = await getTeacherTaskMediaReviewEvidence(session.user.id, submissionId, itemId)
      const current = getSession()
      if (current?.sessionId !== session.sessionId || current.user.id !== session.user.id
        || (current.activeRole ?? current.user.role) !== 'teacher') return
      if (!result.ok || result.data.kind !== 'dubbing'
        || result.data.submissionId !== submissionId || result.data.itemId !== itemId) {
        this.setData({ loading: false, teacherEvidence: null,
          error: result.ok ? '配音提交证据不匹配' : result.error.message }); return
      }
      const draft = getTeacherReviewScoreDraft()
      const score = parseReviewScoreInput(draft?.submissionId === submissionId && draft.itemId === itemId
        ? draft.input : '')
      this.setData({ loading: false, teacherEvidence: result.data,
        teacherReviewSessionId: session.sessionId, teacherSubtitle: '', teacherSubtitleTranslation: '',
        teacherFinalDurationLabel: result.data.finalWork?.durationMs
          ? formatRecordingDuration(result.data.finalWork.durationMs) : '未记录',
        teacherScoreInput: score.input, teacherScoreError: score.error })
    },
    onTeacherReviewScore(event: WechatMiniprogram.Input) {
      const evidence = this.data.teacherEvidence
      if (!this.data.teacherReviewMode || !evidence) return
      const score = parseReviewScoreInput(event.detail.value)
      setTeacherReviewScoreDraft({ submissionId: evidence.submissionId,
        itemId: evidence.itemId, input: score.input })
      this.setData({ teacherScoreInput: score.input, teacherScoreError: score.error })
    },
    refreshTeacherDubbingReview() {
      const route = teacherDubbingReviewRoute()
      if (route) void this.loadTeacherDubbingReview(route.submissionId, route.itemId)
    },
    returnToTeacherReview() { wx.navigateBack() },
    onTeacherVideoTimeUpdate(event: WechatMiniprogram.CustomEvent<{ currentTime: number }>) {
      const evidence = this.data.teacherEvidence
      if (!this.data.teacherReviewMode || !evidence) return
      const positionMs = Math.round(event.detail.currentTime * 1000)
      const cue = evidence.subtitleCues.find(item => item.startMs <= positionMs && item.endMs > positionMs)
      const subtitle = cue?.text ?? '', subtitleTranslation = cue?.translationText ?? ''
      if (subtitle !== this.data.teacherSubtitle || subtitleTranslation !== this.data.teacherSubtitleTranslation) {
        this.setData({ teacherSubtitle: subtitle, teacherSubtitleTranslation: subtitleTranslation })
      }
    },
    async playTeacherFinalWork() {
      if (!this.data.teacherReviewMode) return
      if (this.data.teacherFinalPlaying && teacherFinalAudio) {
        teacherFinalAudio.stop(); teacherFinalAudio.destroy(); teacherFinalAudio = null
        this.setData({ teacherFinalPlaying: false }); return
      }
      let evidence = this.data.teacherEvidence
      if (!evidence?.finalWork?.available || !evidence.finalWork.temporaryUrl) return
      if (Date.parse(evidence.finalWork.expiresAt ?? '') <= Date.now() + 5000) {
        await this.loadTeacherDubbingReview(evidence.submissionId, evidence.itemId)
        evidence = this.data.teacherEvidence
      }
      const work = evidence?.finalWork
      if (!work?.available || !work.temporaryUrl || !work.temporaryUrl.startsWith('https://')
        || Date.parse(work.expiresAt ?? '') <= Date.now()) {
        this.setData({ error: '配音试听地址已失效，请刷新证据后重试' }); return
      }
      teacherFinalAudio?.destroy()
      const audio = wx.createInnerAudioContext()
      teacherFinalAudio = audio
      audio.src = work.temporaryUrl
      audio.onEnded(() => { if (teacherFinalAudio === audio) teacherFinalAudio = null
        audio.destroy(); this.setData({ teacherFinalPlaying: false }) })
      audio.onError(() => { if (teacherFinalAudio === audio) teacherFinalAudio = null
        audio.destroy(); this.setData({ teacherFinalPlaying: false })
        wx.showToast({ title: '配音试听失败，请刷新后重试', icon: 'none' }) })
      this.setData({ teacherFinalPlaying: true })
      audio.play()
    },
    async loadTaskDubbing(taskId: string, itemId: string) {
      const session = getSession()
      if (!session || (session.activeRole ?? session.user.role) !== 'student') {
        this.setData({ loading: false, error: '仅学生本人可以完成任务配音' }); return
      }
      this.setData({ taskMode: true, taskId, taskItemId: itemId, loading: true, error: '' })
      const detail = await getTaskDetail(session.user.id, taskId)
      if (getSession()?.sessionId !== session.sessionId) return
      if (!detail.ok) { this.setData({ loading: false, error: detail.error.message }); return }
      const item = detail.data.task.items.find(candidate => candidate.id === itemId)
      if (!item || item.type !== 'dubbing' || item.mediaSnapshot?.kind !== 'dubbing') {
        this.setData({ loading: false, error: '任务配音快照缺失或没有访问权限' }); return
      }
      const playback = await beginTaskMediaSession(session.user.id, taskId, itemId,
        createPageOperationId('begin_task_dubbing_video'))
      if (getSession()?.sessionId !== session.sessionId) return
      const pending = readTaskDubbingLocalDraft(session.user.id, session.sessionId,
        taskId, itemId, 0)
      const expectedRound = detail.data.assignment.redoCount + 1
      const saved = readTaskDubbingLocalDraft(session.user.id, session.sessionId,
        taskId, itemId, expectedRound)
      const localWork = saved?.work?.round === expectedRound ? saved.work
        : pending?.work?.round === expectedRound ? pending.work : null
      const cloudWork = localWork?.status === 'submitted' ? null
        : await findSubmittedTaskDubbingWork(session.user.id, taskId, itemId, expectedRound)
      if (getSession()?.sessionId !== session.sessionId) return
      if (cloudWork && !cloudWork.ok) {
        this.setData({ loading: false, error: '本轮配音状态暂时无法核对，请稍后重试' })
        return
      }
      const restoredWork = saved?.localPath && localWork?.status === 'draft'
        ? localWork : cloudWork?.ok && cloudWork.data ? cloudWork.data : localWork
      const sealed = restoredWork?.status === 'submitted'
      const restoredLocalPath = !sealed ? saved?.localPath ?? '' : ''
      const restoredDurationMs = sealed ? restoredWork.durationMs ?? 0 : saved?.durationMs ?? 0
      const ready = playback.ok && playback.data.confirmedThroughMs >= item.mediaSnapshot.durationMs
      const confirmedMs = playback.ok ? playback.data.confirmedThroughMs : 0
      taskVideoObservedMs = confirmedMs; taskVideoObservedAt = Date.now()
      this.setData({ loading: false, taskTitle: item.title, taskSnapshot: item.mediaSnapshot,
        taskPlayback: playback.ok && taskMediaPlaybackReady(item.mediaSnapshot, playback.data, Date.now()) ? playback.data : null,
        taskPlaybackReady: ready && Boolean(playback.ok && taskMediaPlaybackReady(item.mediaSnapshot, playback.data, Date.now())),
        demonstrationUrl: playback.ok && taskMediaPlaybackReady(item.mediaSnapshot, playback.data, Date.now())
          ? playback.data.temporaryUrl ?? '' : '', taskVideoPlaying: false,
        taskVideoCurrentMs: confirmedMs, taskVideoConfirmedMs: confirmedMs, taskVideoLastReportedMs: confirmedMs,
        taskVideoCurrentLabel: formatRecordingDuration(confirmedMs),
        taskVideoDurationLabel: formatRecordingDuration(item.mediaSnapshot.durationMs),
        taskVideoPositionPercent: Math.round(confirmedMs * 100 / item.mediaSnapshot.durationMs),
        taskVideoConfirmedPercent: Math.round(confirmedMs * 100 / item.mediaSnapshot.durationMs),
        taskVideoPendingHeartbeat: null, taskVideoHeartbeatBusy: false, taskVideoPendingSeekMs: null,
        taskVideoFinishPending: false,
        taskVideoBuffering: false, taskVideoPlaybackError: playback.ok ? '' : playback.error.message,
        taskVideoWarning: '', taskSubtitle: '', taskSubtitleTranslation: '',
        taskExpectedRound: expectedRound,
        taskWork: restoredWork, taskRound: restoredWork?.round ?? 0,
        taskStagingFileId: sealed ? '' : saved?.stagingFileId ?? '',
        taskSealIntent: sealed ? EMPTY_WRITE_INTENT : saved?.sealIntent ?? EMPTY_WRITE_INTENT,
        localPath: restoredLocalPath, durationMs: restoredDurationMs,
        durationLabel: formatRecordingDuration(restoredDurationMs),
        fileSize: sealed ? 0 : saved?.fileSize ?? 0,
        recordingState: sealed ? 'submitted' as const : restoredLocalPath ? 'local' as const : 'idle' as const,
        demonstrationSpeed: nativeVideoSpeed(readLearningSpeed(session.user.id)).speed,
        submitError: sealed ? ''
          : restoredLocalPath ? ''
            : ready ? '' : '请先在本页完整观看示范视频，再录制任务配音',
        taskBeginIntent: pending && (!pending.work || pending.work.round === expectedRound)
          ? pending.beginIntent : saved?.beginIntent ?? EMPTY_WRITE_INTENT })
    },
    async loadDemonstration() {
      const material = this.data.selectedMaterial
      const session = getSession()
      if (!material || !session || getRepositoryMode() !== 'cloudbase') { this.setData({ demonstrationUrl: '' }); return }
      const result = await getMaterialPlayback(session.user.id, material.id)
      if (this.data.selectedMaterialId !== material.id) return
      this.setData({ demonstrationUrl: result.ok ? result.data.temporaryUrl : '' })
    },
    selectMaterial(event: WechatMiniprogram.TouchEvent) {
      const materialId = event.currentTarget.dataset.id as string
      if (!this.data.materials.some(item => item.id === materialId)
        || (materialId === this.data.selectedMaterialId && this.data.selectedMaterial !== null)
        || this.data.recordingState === 'recording' || this.data.submitting) return
      const select = () => { clearDubbingLocalDraft(); const session = getSession()
        if (session) wx.setStorageSync(`dubbing_recent_material_${session.user.id}`, materialId)
        const selectedMaterial = this.data.materials.find(item => item.id === materialId) ?? null
        const practiceSubtitleCues = validDubbingSubtitleCues(selectedMaterial?.subtitleCues)
        const initialSubtitle = dubbingCueState(practiceSubtitleCues, 0)
        this.setData({ selectedMaterialId: materialId,
        selectedMaterial, practiceSubtitleCues, practiceSubtitleIndex: initialSubtitle.index,
        practicePreviousCueIndex: initialSubtitle.previousIndex,
        practiceNextCueIndex: initialSubtitle.nextIndex,
        practiceSubtitleText: initialSubtitle.text, practiceSubtitleTranslation: initialSubtitle.translationText,
        subtitleInChinese: false,
        materialSelectOpen: false,
        demonstrationUrl: '', localPath: '',
        durationMs: 0, durationLabel: '00:00', fileSize: 0, recordingState: 'idle', recordingIssue: '',
        draft: null, submittedWork: null,
        beginIntent: clearWriteIntent(), submitIntent: clearWriteIntent(), submitError: '' }, () => this.loadDemonstration()) }
      if (!this.data.localPath) { select(); return }
      wx.showModal({ title: '切换配音素材？', content: '当前未提交的录音会从页面清除。',
        confirmText: '切换', success: result => { if (result.confirm) select() } })
    },
    toggleMaterialSelect() {
      if (this.data.recordingState === 'recording' || this.data.submitting) return
      this.setData({ materialSelectOpen: !this.data.materialSelectOpen })
    },
    showPreviousPracticeText() {
      const cue = this.data.practiceSubtitleCues[this.data.practicePreviousCueIndex]
      if (!cue || !this.data.demonstrationUrl) return
      this.setData({ practiceSubtitleText: '', practiceSubtitleTranslation: '' })
      wx.createVideoContext('demonstration', this).seek(cue.startMs / 1000)
    },
    showNextPracticeText() {
      const cue = this.data.practiceSubtitleCues[this.data.practiceNextCueIndex]
      if (!cue || !this.data.demonstrationUrl) return
      this.setData({ practiceSubtitleText: '', practiceSubtitleTranslation: '' })
      wx.createVideoContext('demonstration', this).seek(cue.startMs / 1000)
    },
    onPracticeVideoTimeUpdate(event: WechatMiniprogram.VideoTimeUpdate) {
      const state = dubbingCueState(this.data.practiceSubtitleCues,
        Math.round(event.detail.currentTime * 1000))
      if (state.index !== this.data.practiceSubtitleIndex
        || state.text !== this.data.practiceSubtitleText
        || state.translationText !== this.data.practiceSubtitleTranslation
        || state.previousIndex !== this.data.practicePreviousCueIndex
        || state.nextIndex !== this.data.practiceNextCueIndex) {
        this.setData({ practiceSubtitleIndex: state.index, practiceSubtitleText: state.text,
          practiceSubtitleTranslation: state.translationText,
          practicePreviousCueIndex: state.previousIndex, practiceNextCueIndex: state.nextIndex })
      }
    },
    onPracticeVideoEnded() {
      const cues = this.data.practiceSubtitleCues
      const state = dubbingCueState(cues, cues[cues.length - 1]?.endMs ?? 0)
      this.setData({ practiceSubtitleIndex: state.index, practiceSubtitleText: state.text,
        practicePreviousCueIndex: state.previousIndex, practiceNextCueIndex: state.nextIndex })
    },
    onMaterialSearch(event: WechatMiniprogram.Input) {
      this.setData({ materialKeyword: event.detail.value })
      if (materialSearchTimer) clearTimeout(materialSearchTimer)
      materialSearchTimer = setTimeout(() => { void this.refreshMaterialCatalog() }, 250)
    },
    clearMaterialSearch() {
      if (materialSearchTimer) clearTimeout(materialSearchTimer)
      const filters = { grade: '全部年级', textbook: '全部教材', unit: '全部单元' }
      this.setData({ materialKeyword: '', gradeFilter: filters.grade, textbookFilter: filters.textbook,
        unitFilter: filters.unit, materialFilterOpen: '',
        materialFilterOptions: filterOptions(this.data.materialFacets, filters) },
      () => { void this.refreshMaterialCatalog() })
    },
    toggleMaterialFilter(event: WechatMiniprogram.TouchEvent) {
      const key = event.currentTarget.dataset.key as string
      if (key !== 'grade' && key !== 'textbook' && key !== 'unit') return
      this.setData({ materialFilterOpen: this.data.materialFilterOpen === key ? '' : key })
    },
    chooseMaterialFilter(event: WechatMiniprogram.TouchEvent) {
      const key = event.currentTarget.dataset.key as 'grade' | 'textbook' | 'unit'
      const value = event.currentTarget.dataset.value as string
      if (!['grade', 'textbook', 'unit'].includes(key) || !value) return
      const filters = { grade: key === 'grade' ? value : this.data.gradeFilter,
        textbook: key === 'grade' ? '全部教材' : key === 'textbook' ? value : this.data.textbookFilter,
        unit: key === 'grade' || key === 'textbook' ? '全部单元' : value }
      this.setData({ gradeFilter: filters.grade, textbookFilter: filters.textbook, unitFilter: filters.unit,
        materialFilterOpen: '', materialFilterOptions: filterOptions(this.data.materialFacets, filters) },
      () => { void this.refreshMaterialCatalog() })
    },
    async refreshMaterialCatalog(offset = 0) {
      const session = getSession()
      if (!session) return
      const request = ++materialSearchRequest
      this.setData({ materialSearchLoading: true, materialSearchError: '' })
      const result = await searchWorkMaterials(session.user.id, this.data.materialKeyword.trim(), 20, offset,
        catalogFilters(this.data.gradeFilter, this.data.textbookFilter, this.data.unitFilter))
      if (request !== materialSearchRequest) return
      if (!result.ok) {
        this.setData({ materialSearchLoading: false, materialSearchError: result.error.message }); return
      }
      this.setData({ materialSearchLoading: false,
        materials: offset === 0 ? result.data.items : [...this.data.materials, ...result.data.items],
        materialTotal: result.data.total, materialNextOffset: result.data.nextOffset })
    },
    loadMoreMaterials() {
      if (!this.data.materialSearchLoading && this.data.materialNextOffset !== null) {
        void this.refreshMaterialCatalog(this.data.materialNextOffset)
      }
    },
    cycleSpeed() {
      const requested = nextLearningSpeed(this.data.demonstrationSpeed)
      const resolved = nativeVideoSpeed(requested)
      const video = wx.createVideoContext('demonstration', this)
      try { video.playbackRate(resolved.speed) }
      catch (_error: unknown) {
        try {
          video.playbackRate(1)
          this.setData({ demonstrationSpeed: 1,
            videoSpeedNotice: '当前设备无法切换该视频倍速，已恢复 1 倍速。' })
          const session = getSession()
          if (session) saveLearningSpeed(session.user.id, 1)
          wx.showToast({ title: '视频倍速不可用，已恢复 1 倍速', icon: 'none' })
        } catch (_fallbackError: unknown) {
          this.setData({ videoSpeedNotice: '视频播放器暂不可调速，请重新打开素材。' })
          wx.showToast({ title: '视频播放器暂不可调速', icon: 'none' })
        }
        return
      }
      this.setData({ demonstrationSpeed: resolved.speed,
        videoSpeedNotice: resolved.fallback ? '视频播放器不支持 0.75 倍速，已使用 1 倍速。' : '' })
      const session = getSession()
      if (session) saveLearningSpeed(session.user.id, resolved.speed)
      if (resolved.fallback) wx.showToast({ title: '视频不支持 0.75 倍，已使用 1 倍', icon: 'none' })
    },
    onDemonstrationPlay() {
      if (this.data.taskMode && Date.parse(this.data.taskPlayback?.expiresAt ?? '') <= Date.now() + 5000) {
        wx.createVideoContext('demonstration', this).pause()
        void this.refreshTaskVideoPlayback()
        return
      }
      const resolved = nativeVideoSpeed(this.data.demonstrationSpeed)
      if (resolved.fallback) this.setData({ demonstrationSpeed: resolved.speed,
        videoSpeedNotice: '视频播放器不支持 0.75 倍速，已使用 1 倍速。' })
      const video = wx.createVideoContext('demonstration', this)
      if (this.data.taskMode) this.setData({ taskVideoPlaying: true })
      try { video.playbackRate(resolved.speed) }
      catch (_error: unknown) {
        try {
          video.playbackRate(1)
          this.setData({ demonstrationSpeed: 1,
            videoSpeedNotice: '当前设备无法使用已选倍速，已恢复 1 倍速。' })
          const session = getSession()
          if (session) saveLearningSpeed(session.user.id, 1)
        } catch (_fallbackError: unknown) {
          this.setData({ videoSpeedNotice: '视频播放器暂不可调速，请重新打开素材。' })
        }
      }
    },
    taskVideo() { return wx.createVideoContext('demonstration', this) },
    pauseTaskDemonstration() {
      clearTaskVideoBufferTimer()
      if (this.data.taskPlayback) this.taskVideo().pause()
      this.setData({ taskVideoPlaying: false, taskVideoBuffering: false })
    },
    onTaskDemonstrationPlay() { this.setData({ taskVideoPlaying: true });
      taskVideoObservedMs = this.data.taskVideoCurrentMs; taskVideoObservedAt = Date.now() },
    onTaskDemonstrationPause() { clearTaskVideoBufferTimer(); if (this.data.taskMode)
      this.setData({ taskVideoPlaying: false, taskVideoBuffering: false }) },
    onTaskDemonstrationWaiting() {
      this.setData({ taskVideoBuffering: true }); clearTaskVideoBufferTimer()
      taskVideoBufferTimer = setTimeout(() => {
        if (!this.data.taskVideoBuffering) return
        this.pauseTaskDemonstration()
        this.setData({ taskVideoPlaybackError: '视频加载超时，请检查网络后重试；观看进度已保留' })
      }, 12000)
    },
    onTaskDemonstrationError() { this.pauseTaskDemonstration()
      this.setData({ taskVideoPlaybackError: '示范视频播放失败，请重试；已确认进度不受影响' }) },
    onTaskDemonstrationEnded() { this.finishTaskVideo() },
    async toggleTaskDemonstration() {
      if (!this.data.taskMode || !this.data.taskPlayback || this.data.taskVideoHeartbeatBusy) return
      if (this.data.taskVideoPlaying) { this.pauseTaskDemonstration(); return }
      if (this.data.taskVideoPendingHeartbeat) { this.setData({ taskVideoPlaybackError: '观看进度尚未同步，请先重试' }); return }
      if (!await this.refreshTaskVideoPlayback()) return
      const snapshot = this.data.taskSnapshot, playback = this.data.taskPlayback
      if (!snapshot || !playback) return
      const startMs = this.data.taskVideoCurrentMs >= snapshot.durationMs
        && this.data.taskVideoConfirmedMs >= snapshot.durationMs ? 0
        : Math.min(this.data.taskVideoCurrentMs, this.data.taskVideoConfirmedMs)
      this.updateTaskVideoPosition(startMs)
      taskVideoPendingSeekAt = Date.now()
      this.setData({ taskVideoPendingSeekMs: startMs, taskVideoPlaybackError: '', taskVideoBuffering: true })
      taskVideoObservedMs = startMs; taskVideoObservedAt = Date.now()
      clearTaskVideoBufferTimer()
      taskVideoBufferTimer = setTimeout(() => {
        if (!this.data.taskVideoBuffering) return
        this.pauseTaskDemonstration()
        this.setData({ taskVideoPlaybackError: '视频加载超时，请检查网络后重试；观看进度已保留' })
      }, 12000)
      const video = this.taskVideo(), speed = nativeVideoSpeed(this.data.demonstrationSpeed)
      try { video.playbackRate(speed.speed) } catch (_error: unknown) { video.playbackRate(1) }
      video.seek(startMs / 1000); video.play()
    },
    async replayTaskDemonstration() {
      if (!this.data.taskMode) return
      this.pauseTaskDemonstration()
      this.updateTaskVideoPosition(0)
      this.setData({ taskVideoPendingSeekMs: 0 })
      taskVideoObservedMs = 0; taskVideoObservedAt = Date.now()
      await this.toggleTaskDemonstration()
    },
    async refreshTaskVideoPlayback(): Promise<boolean> {
      const session = getSession(), snapshot = this.data.taskSnapshot
      if (!session || !snapshot || !this.data.taskId || !this.data.taskItemId) return false
      const oldPlayback = this.data.taskPlayback
      if (oldPlayback && taskMediaPlaybackReady(snapshot, oldPlayback, Date.now() + 5000)) return true
      const result = await getTaskMediaPlayback(session.user.id, this.data.taskId, this.data.taskItemId)
      if (getSession()?.sessionId !== session.sessionId) return false
      if (!result.ok || !taskMediaPlaybackReady(snapshot, result.data, Date.now())) {
        this.setData({ taskVideoPlaybackError: result.ok ? '播放地址暂不可用，请重试' : result.error.message,
          demonstrationUrl: '' }); return false
      }
      const confirmedMs = result.data.confirmedThroughMs
      this.setData({ taskPlayback: result.data, taskPlaybackReady: confirmedMs >= snapshot.durationMs,
        demonstrationUrl: result.data.temporaryUrl ?? '', taskVideoConfirmedMs: confirmedMs,
        taskVideoLastReportedMs: confirmedMs,
        taskVideoConfirmedPercent: Math.round(confirmedMs * 100 / snapshot.durationMs),
        taskVideoCurrentMs: Math.min(this.data.taskVideoCurrentMs, confirmedMs),
        taskVideoPlaybackError: '', submitError: confirmedMs >= snapshot.durationMs ? '' : this.data.submitError })
      return true
    },
    onTaskVideoTimeUpdate(event: WechatMiniprogram.CustomEvent<{ currentTime: number }>) {
      if (!this.data.taskMode || !this.data.taskSnapshot) return
      let positionMs = Math.round(event.detail.currentTime * 1000)
      const pending = this.data.taskVideoPendingSeekMs
      if (pending !== null) {
        if (Math.abs(positionMs - pending) > 750 && Date.now() - taskVideoPendingSeekAt < 3000) return
        this.setData({ taskVideoPendingSeekMs: null }); taskVideoObservedMs = positionMs; taskVideoObservedAt = Date.now()
      }
      const snap = this.data.taskSnapshot, now = Date.now()
      positionMs = Math.max(0, Math.min(positionMs, snap.durationMs))
      if (this.data.taskVideoPlaying && taskVideoObservedAt
        && positionMs - taskVideoObservedMs > Math.max(0, now - taskVideoObservedAt) * 2 + 1500
        && positionMs > this.data.taskVideoConfirmedMs) {
        this.pauseTaskDemonstration(); this.setData({ taskVideoWarning: '请按顺序观看，不能跳过未播放内容' })
        this.seekTaskVideo(this.data.taskVideoConfirmedMs); return
      }
      const progressed = positionMs > taskVideoObservedMs
      taskVideoObservedMs = positionMs; taskVideoObservedAt = now
      if (progressed) { clearTaskVideoBufferTimer(); this.setData({ taskVideoBuffering: false }) }
      this.updateTaskVideoPosition(positionMs)
      const cue = this.data.taskSnapshot.subtitleCues?.find(item =>
        item.startMs <= positionMs && item.endMs > positionMs)
      const subtitle = cue?.text ?? '', subtitleTranslation = cue?.translationText ?? ''
      if (subtitle !== this.data.taskSubtitle || subtitleTranslation !== this.data.taskSubtitleTranslation) {
        this.setData({ taskSubtitle: subtitle, taskSubtitleTranslation: subtitleTranslation })
      }
      if (!this.data.taskVideoHeartbeatBusy && !this.data.taskVideoPendingHeartbeat
        && positionMs - this.data.taskVideoLastReportedMs >= 2000 && this.data.taskPlayback?.sessionId) {
        void this.sendTaskVideoHeartbeat({ sessionId: this.data.taskPlayback.sessionId,
          fromMs: this.data.taskVideoLastReportedMs, toMs: positionMs,
          operationId: createPageOperationId('task_dubbing_video_heartbeat') })
      }
    },
    updateTaskVideoPosition(positionMs: number) {
      const snapshot = this.data.taskSnapshot
      if (!snapshot) return
      const value = Math.max(0, Math.min(positionMs, snapshot.durationMs))
      this.setData({ taskVideoCurrentMs: value, taskVideoCurrentLabel: formatRecordingDuration(value),
        taskVideoPositionPercent: Math.round(value * 100 / snapshot.durationMs) })
    },
    async sendTaskVideoHeartbeat(pending: PendingDubbingHeartbeat) {
      const session = getSession(), snapshot = this.data.taskSnapshot
      if (!session || !snapshot || this.data.taskVideoHeartbeatBusy) return
      this.setData({ taskVideoHeartbeatBusy: true, taskVideoPendingHeartbeat: pending })
      const result = await reportTaskMediaHeartbeat(session.user.id, pending.sessionId,
        pending.fromMs, pending.toMs, pending.toMs, pending.operationId)
      if (this.data.taskPlayback?.sessionId !== pending.sessionId || getSession()?.sessionId !== session.sessionId) return
      if (!result.ok || result.data.sessionId !== pending.sessionId
        || result.data.confirmedThroughMs < this.data.taskVideoConfirmedMs
        || result.data.confirmedThroughMs > snapshot.durationMs) {
        this.pauseTaskDemonstration(); this.setData({ taskVideoHeartbeatBusy: false,
          taskVideoPlaybackError: '观看进度同步失败，请重试；已确认进度已保留' }); return
      }
      const confirmedMs = result.data.confirmedThroughMs
      this.setData({ taskVideoHeartbeatBusy: false, taskVideoPendingHeartbeat: null,
        taskVideoConfirmedMs: confirmedMs, taskVideoLastReportedMs: confirmedMs,
        taskVideoConfirmedPercent: Math.round(confirmedMs * 100 / snapshot.durationMs),
        taskPlayback: { ...this.data.taskPlayback!, confirmedThroughMs: confirmedMs },
        taskPlaybackReady: confirmedMs >= snapshot.durationMs,
        submitError: confirmedMs >= snapshot.durationMs ? '' : this.data.submitError,
        taskVideoPlaybackError: '' })
      if (this.data.taskVideoFinishPending) void this.finishTaskVideo()
    },
    finishTaskVideo() {
      const snapshot = this.data.taskSnapshot
      if (!snapshot) return
      this.pauseTaskDemonstration(); this.updateTaskVideoPosition(snapshot.durationMs)
      const playback = this.data.taskPlayback
      if (this.data.taskVideoHeartbeatBusy || this.data.taskVideoPendingHeartbeat) {
        this.setData({ taskVideoFinishPending: true }); return
      }
      if (!playback?.sessionId || this.data.taskVideoLastReportedMs >= snapshot.durationMs) {
        this.setData({ taskVideoFinishPending: false }); return
      }
      this.setData({ taskVideoFinishPending: false })
      void this.sendTaskVideoHeartbeat({ sessionId: playback.sessionId,
        fromMs: this.data.taskVideoLastReportedMs, toMs: snapshot.durationMs,
        operationId: createPageOperationId('task_dubbing_video_finish') })
    },
    seekTaskVideo(positionMs: number) {
      const snapshot = this.data.taskSnapshot
      if (!snapshot) return
      const target = Math.max(0, Math.min(positionMs, snapshot.durationMs))
      this.setData({ taskVideoPendingSeekMs: target }); taskVideoPendingSeekAt = Date.now()
      this.taskVideo().seek(target / 1000)
      taskVideoObservedMs = target; taskVideoObservedAt = Date.now(); this.updateTaskVideoPosition(target)
    },
    seekTaskDemonstration(event: WechatMiniprogram.CustomEvent<{ percent: number }>) {
      const snapshot = this.data.taskSnapshot, playback = this.data.taskPlayback
      if (!snapshot || !playback) return
      const requested = Math.round(snapshot.durationMs * event.detail.percent / 100)
      const target = taskMediaSeekTarget(requested, snapshot, playback)
      if (target < requested) this.setData({ taskVideoWarning: '未观看的部分不能跳过，请先顺序观看' })
      this.seekTaskVideo(target)
    },
    blockTaskSeek() { this.setData({ taskVideoWarning: '未观看的部分不能跳过，请先顺序观看' }) },
    toggleSubtitleLanguage() { this.setData({ subtitleInChinese: !this.data.subtitleInChinese }) },
    toggleTaskEarMode() { this.setData({ taskEarMode: !this.data.taskEarMode,
      taskSubtitle: '', taskSubtitleTranslation: '' }) },
    async retryTaskVideo() {
      if (this.data.taskVideoPendingHeartbeat) {
        await this.sendTaskVideoHeartbeat(this.data.taskVideoPendingHeartbeat); return
      }
      this.pauseTaskDemonstration()
      if (await this.refreshTaskVideoPlayback()) void this.toggleTaskDemonstration()
    },
    async startRecording() {
      if (this.data.teacherPreviewMode || this.data.teacherReviewMode) return
      if (blockedDubbingRoute() || this.data.error) return
      if (this.data.taskMode && !this.data.taskPlaybackReady) {
        this.setData({ submitError: '请先完整观看示范视频' }); return
      }
      if (this.data.taskMode && Date.parse(this.data.taskPlayback?.expiresAt ?? '') <= Date.now() + 5000) {
        await this.refreshTaskVideoPlayback()
        if (!this.data.taskPlaybackReady) return
      }
      if (!this.data.taskMode && !this.data.selectedMaterial) {
        this.setData({ submitError: '请先选择可用的配音素材' }); return
      }
      if (this.data.recordingState === 'recording' || this.data.submitting || this.data.localPath
        || (!this.data.taskMode && !this.data.selectedMaterialId)) return
      if (this.data.taskMode && !await this.prepareTaskRecording()) return
      try { await wx.authorize({ scope: 'scope.record' }) }
      catch (_error: unknown) { this.setData({ permissionDenied: true,
        submitError: '请在微信设置中允许使用麦克风后重试' }); return }
      this.setData({ permissionDenied: false })
      this.setData({ recordingState: 'recording', materialSelectOpen: false, durationMs: 0, durationLabel: '00:00',
        recordingIssue: '', submitError: '', submittedWork: null })
      try {
        recorder.start({ duration: 300000, sampleRate: 16000, encodeBitRate: 64000,
          numberOfChannels: 1, format: 'mp3' })
        startRecordingTimer(() => {
          if (recordingStartedAtMs === null) return
          const durationMs = Math.min(300000, Math.max(0, Date.now() - recordingStartedAtMs))
          const durationLabel = formatRecordingDuration(durationMs)
          if (durationLabel !== this.data.durationLabel) this.setData({ durationMs, durationLabel })
        })
      } catch (_error: unknown) {
        stopRecordingTimer()
        this.setData({ recordingState: 'idle', durationMs: 0, durationLabel: '00:00',
          recordingIssue: '录音未能开始，请重新录制', submitError: '' })
      }
    },
    stopRecording() { if (this.data.recordingState === 'recording') { stopRecordingTimer(); recorder.stop() } },
    async prepareTaskRecording(): Promise<boolean> {
      const session = getSession()
      if (!session || !this.data.taskId || !this.data.taskItemId) return false
      if (this.data.taskWork?.status === 'draft'
        && this.data.taskWork.round === this.data.taskExpectedRound) return true
      const fingerprint = JSON.stringify({ taskId: this.data.taskId, itemId: this.data.taskItemId })
      const intent = prepareWriteIntent(this.data.taskBeginIntent, fingerprint,
        () => createPageOperationId('begin_task_dubbing'))
      this.setData({ taskBeginIntent: intent, submitting: true, submitError: '' })
      const begun = await beginTaskDubbingWork(session.user.id, this.data.taskId,
        this.data.taskItemId, intent.operationId)
      if (!begun.ok) { this.setData({ submitting: false, submitError: `${begun.error.message}；当前录音未改变` });
        this.rememberTaskDubbingDraft(); return false }
      const work = begun.data
      if (work.taskId !== this.data.taskId || work.itemId !== this.data.taskItemId
        || work.round !== this.data.taskExpectedRound) {
        this.setData({ submitting: false, taskBeginIntent: clearWriteIntent(),
          submitError: '任务配音回执不属于本轮，请返回任务重试' })
        this.rememberTaskDubbingDraft(); return false
      }
      const saved = readTaskDubbingLocalDraft(session.user.id, session.sessionId,
        this.data.taskId, this.data.taskItemId, work.round)
      this.setData({ submitting: false, taskWork: work, taskRound: work.round,
        taskBeginIntent: intent,
        ...(saved?.work?.workId === work.workId && saved.localPath ? {
          localPath: saved.localPath, durationMs: saved.durationMs,
          durationLabel: formatRecordingDuration(saved.durationMs), fileSize: saved.fileSize,
          recordingState: work.status === 'submitted' ? 'submitted' as const : 'local' as const,
          taskStagingFileId: saved.stagingFileId, taskSealIntent: saved.sealIntent,
        } : work.status === 'submitted' ? { recordingState: 'submitted' as const } : {}) })
      this.rememberTaskDubbingDraft()
      if (work.status === 'submitted') { this.setData({ submitError: '本轮录音已上传，请返回任务详情' }); return false }
      if (saved?.work?.workId === work.workId && saved.localPath) {
        this.setData({ submitError: '已找回本轮保留在本机的录音，可试听或继续上传' }); return false
      }
      return true
    },
    openMicrophoneSettings() {
      wx.openSetting({ success: result => this.setData({ permissionDenied: !result.authSetting['scope.record'],
        submitError: result.authSetting['scope.record']
          ? '麦克风已允许，请重新点击开始录音' : '仍未获得麦克风权限，请在设置中允许后重试' }),
      fail: () => this.setData({ submitError: '无法打开权限设置，请从微信的小程序设置中允许麦克风' }) })
    },
    onRecorderStopped(result: StopResult) {
      if (this.data.recordingState !== 'recording') return
      stopRecordingTimer()
      const recordingIssue = dubbingRecordingIssue(result.duration, result.fileSize, result.tempFilePath)
      this.setData({ recordingState: result.tempFilePath ? 'local' : 'idle', localPath: result.tempFilePath,
        durationMs: result.duration, durationLabel: formatRecordingDuration(result.duration),
        fileSize: result.fileSize, recordingIssue, submitIntent: clearWriteIntent(), submitError: '' })
      this.rememberLocalDraft()
    },
    onRecorderFailed() {
      if (this.data.recordingState === 'recording') {
        stopRecordingTimer()
        this.setData({ recordingState: 'idle', durationMs: 0, durationLabel: '00:00',
          recordingIssue: '录音失败，请重新录制', submitError: '' })
      }
    },
    playRecording() {
      if (!this.data.localPath) return
      stopStudentRecordingAudio()
      const audio = wx.createInnerAudioContext()
      studentRecordingAudio = audio
      audio.src = this.data.localPath
      audio.onEnded(() => { if (studentRecordingAudio === audio) stopStudentRecordingAudio() })
      audio.onError(() => { if (studentRecordingAudio === audio) stopStudentRecordingAudio()
        wx.showToast({ title: '试听失败，请重试', icon: 'none' }) })
      audio.play()
    },
    async playSubmittedTaskRecording() {
      const session = getSession(), work = this.data.taskWork
      if (!this.data.taskMode || !session || work?.status !== 'submitted') return
      const playback = await getTaskDubbingPlayback(session.user.id, work.workId)
      if (getSession()?.sessionId !== session.sessionId || this.data.taskWork?.workId !== work.workId) return
      if (!playback.ok || !playback.data.temporaryUrl.startsWith('https://')
        || Date.parse(playback.data.expiresAt) <= Date.now()) {
        this.setData({ submitError: playback.ok ? '配音试听地址已过期，请重试' : playback.error.message }); return
      }
      stopStudentRecordingAudio()
      const audio = wx.createInnerAudioContext()
      studentRecordingAudio = audio
      audio.src = playback.data.temporaryUrl
      audio.onEnded(() => { if (studentRecordingAudio === audio) stopStudentRecordingAudio() })
      audio.onError(() => { if (studentRecordingAudio === audio) stopStudentRecordingAudio()
        this.setData({ submitError: '已上传录音试听失败，请重试' }) })
      audio.play()
    },
    redoRecording() {
      if ((!this.data.localPath && !(this.data.taskMode && this.data.taskWork?.status === 'submitted'))
        || this.data.submitting) return
      if (this.data.taskMode) {
        stopStudentRecordingAudio()
        wx.showModal({ title: '重新录制任务配音？',
          content: this.data.localPath ? '本机录音将被替换；已上传作品仍由服务端保留。'
            : '将新建本轮录音草稿；已上传作品仍由服务端保留。',
          confirmText: '重录', success: result => {
            if (!result.confirm) return
            const submitted = this.data.taskWork?.status === 'submitted'
            this.setData({ localPath: '', durationMs: 0, durationLabel: '00:00', fileSize: 0,
              recordingState: 'idle', recordingIssue: '', submitError: '', taskStagingFileId: '',
              taskSealIntent: clearWriteIntent(),
              ...(submitted ? { taskWork: null, taskRound: 0,
                taskBeginIntent: clearWriteIntent() } : {}) },
            () => this.rememberTaskDubbingDraft())
          } })
        return
      }
      wx.showModal({ title: '重新录制？', content: '当前录音会从页面清除。', confirmText: '重录',
        success: result => { if (result.confirm) { clearDubbingLocalDraft(); this.setData({ localPath: '', durationMs: 0,
          durationLabel: '00:00', fileSize: 0, recordingState: 'idle', recordingIssue: '',
          submitError: '', submittedWork: null,
          ...(this.data.draft?.status === 'submitted' ? { draft: null, beginIntent: clearWriteIntent() } : {}),
          submitIntent: clearWriteIntent() }) } } })
    },
    onNote(event: WechatMiniprogram.Input) {
      this.setData({ note: event.detail.value, submitIntent: clearWriteIntent(), submitError: '' })
      this.rememberLocalDraft()
    },
    rememberLocalDraft() {
      if (this.data.teacherPreviewMode || this.data.teacherReviewMode) return
      if (this.data.taskMode) { this.rememberTaskDubbingDraft(); return }
      const session = getSession()
      const materialVersion = this.data.selectedMaterial?.contentVersion
        ?? readDubbingLocalDraft(session?.user.id ?? '', session?.sessionId ?? '')?.materialVersion
        ?? this.data.draft?.materialVersion ?? ''
      if (!session || !this.data.localPath || this.data.recordingState === 'submitted') return
      saveDubbingLocalDraft({ ownerUserId: session.user.id, ownerSessionId: session.sessionId,
        materialId: this.data.selectedMaterialId,
        materialVersion, localPath: this.data.localPath, durationMs: this.data.durationMs,
        fileSize: this.data.fileSize, note: this.data.note, draft: this.data.draft,
        beginIntent: this.data.beginIntent, submitIntent: this.data.submitIntent })
    },
    rememberTaskDubbingDraft() {
      const session = getSession()
      if (!session || !this.data.taskId || !this.data.taskItemId) return
      saveTaskDubbingLocalDraft({ savedAt: new Date().toISOString(), ownerUserId: session.user.id,
        ownerSessionId: session.sessionId, taskId: this.data.taskId, itemId: this.data.taskItemId,
        round: this.data.taskRound || 0, localPath: this.data.localPath,
        durationMs: this.data.durationMs, fileSize: this.data.fileSize,
        work: this.data.taskWork, stagingFileId: this.data.taskStagingFileId,
        beginIntent: this.data.taskBeginIntent, sealIntent: this.data.taskSealIntent })
      if (this.data.taskRound > 0) saveTaskDubbingLocalDraft({ savedAt: new Date().toISOString(),
        ownerUserId: session.user.id, ownerSessionId: session.sessionId,
        taskId: this.data.taskId, itemId: this.data.taskItemId, round: 0,
        localPath: '', durationMs: 0, fileSize: 0, work: this.data.taskWork,
        stagingFileId: '', beginIntent: this.data.taskBeginIntent,
        sealIntent: clearWriteIntent() })
    },
    async submitRecording() {
      if (this.data.teacherPreviewMode || this.data.teacherReviewMode) return
      if (blockedDubbingRoute() || this.data.error) return
      if (this.data.taskMode) { await this.sealTaskRecording(); return }
      const session = getSession()
      if (!session || this.data.submitting || this.data.recordingState !== 'local'
        || !this.data.localPath || this.data.recordingIssue) return
      if (!this.data.selectedMaterial || this.data.selectedMaterial.id !== this.data.selectedMaterialId) {
        this.setData({ submitError: '原配音素材已不可用，请重新选择素材并录制' }); return
      }
      const recordingIssue = dubbingRecordingIssue(this.data.durationMs, this.data.fileSize, this.data.localPath)
      if (recordingIssue) { this.setData({ recordingIssue, submitError: '' }); return }
      this.setData({ submitting: true, recordingState: 'uploading', submitError: '' })
      let draft = this.data.draft
      if (!draft || draft.status !== 'draft' || draft.materialId !== this.data.selectedMaterialId) {
        const beginIntent = prepareWriteIntent(this.data.beginIntent, this.data.selectedMaterialId,
          () => createPageOperationId('begin_work'))
        this.setData({ beginIntent })
        const begun = await beginWorkDraft(session.user.id, this.data.selectedMaterialId, beginIntent.operationId)
        if (!begun.ok) { this.setData({ submitting: false, recordingState: 'local', submitError: begun.error.message });
          this.rememberLocalDraft(); return }
        draft = begun.data
        this.setData({ draft, beginIntent: clearWriteIntent() })
      }
      let stagingFileId: string
      try {
        const uploaded = await wx.cloud.uploadFile({ cloudPath: draft.stagingPath, filePath: this.data.localPath })
        stagingFileId = uploaded.fileID
      } catch (_error: unknown) {
        this.setData({ submitting: false, recordingState: 'local', submitError: '上传失败，录音已保留，可重试' })
        this.rememberLocalDraft()
        return
      }
      const fingerprint = JSON.stringify({ workId: draft.id, stagingFileId, note: this.data.note.trim(), version: draft.version })
      const submitIntent = prepareWriteIntent(this.data.submitIntent, fingerprint,
        () => createPageOperationId('submit_work'))
      this.setData({ submitIntent })
      const submitted = await submitWork(session.user.id, { workId: draft.id, stagingFileId,
        note: this.data.note.trim() }, draft.version, submitIntent.operationId)
      if (!submitted.ok) {
        const verified = await listMyWorks(session.user.id)
        const committed = verified.ok ? verified.data.find(work => work.id === draft.id && work.status === 'submitted') : null
        if (committed) {
          clearDubbingLocalDraft()
          this.setData({ submitting: false, recordingState: 'submitted', submittedWork: committed,
            draft: committed, submitError: '', submitIntent: clearWriteIntent() })
          wx.showToast({ title: '作品已提交', icon: 'success' })
          return
        }
        if (submitted.error.code === 'MEDIA_INVALID') {
          this.setData({ submitting: false, recordingState: 'local',
            recordingIssue: '', submitError: '云端未通过本次录音核验，录音已保留；可重试，仍失败时请重新录制',
            submitIntent: clearWriteIntent() })
          this.rememberLocalDraft()
          return
        }
        if (submitted.error.code === 'NOT_FOUND' && verified.ok
          && !verified.data.some(work => work.id === draft.id)) {
          this.setData({ submitting: false, recordingState: 'local', draft: null,
            beginIntent: clearWriteIntent(), submitIntent: clearWriteIntent(),
            submitError: '原草稿已删除或不可用，录音仍保留；请重新提交' })
          this.rememberLocalDraft()
          return
        }
        this.setData({ submitting: false, recordingState: 'local', submitError: `${submitted.error.message}，录音已保留，可重试` })
        this.rememberLocalDraft()
        return
      }
      clearDubbingLocalDraft()
      this.setData({ submitting: false, recordingState: 'submitted', submittedWork: submitted.data,
        draft: submitted.data, submitError: '', submitIntent: clearWriteIntent() })
      wx.showToast({ title: '作品已提交', icon: 'success' })
    },
    async sealTaskRecording() {
      if (this.data.teacherPreviewMode || this.data.teacherReviewMode) return
      const session = getSession(), work = this.data.taskWork
      if (!session || !work || work.status !== 'draft' || !this.data.taskPlaybackReady
        || !this.data.localPath || this.data.submitting || this.data.recordingState !== 'local') return
      const issue = dubbingRecordingIssue(this.data.durationMs, this.data.fileSize, this.data.localPath)
      if (issue) { this.setData({ recordingIssue: issue }); return }
      this.setData({ submitting: true, recordingState: 'uploading', submitError: '' })
      let stagingFileId = this.data.taskStagingFileId
      if (!stagingFileId) {
        try {
          const uploaded = await wx.cloud.uploadFile({ cloudPath: work.stagingPath,
            filePath: this.data.localPath })
          stagingFileId = uploaded.fileID
          this.setData({ taskStagingFileId: stagingFileId })
          this.rememberTaskDubbingDraft()
        } catch (_error: unknown) {
          this.setData({ submitting: false, recordingState: 'local',
            submitError: '任务录音上传失败，本机录音已保留，可重试' })
          this.rememberTaskDubbingDraft(); return
        }
      }
      const fingerprint = JSON.stringify({ workId: work.workId, stagingFileId,
        expectedVersion: work.version })
      const intent = prepareWriteIntent(this.data.taskSealIntent, fingerprint,
        () => createPageOperationId('seal_task_dubbing'))
      this.setData({ taskSealIntent: intent })
      const sealed = await sealTaskDubbingWork(session.user.id, work.workId,
        stagingFileId, work.version, intent.operationId)
      if (!sealed.ok || sealed.data.status !== 'submitted' || sealed.data.workId !== work.workId) {
        this.setData({ submitting: false, recordingState: 'local',
          submitError: !sealed.ok ? sealed.error.code === 'MEDIA_INVALID'
            ? '云端未通过本次录音核验；本机录音已保留，可重试上传或重录'
            : `${sealed.error.message}；本机录音已保留，可重试`
            : '上传回执不匹配，本机录音已保留' })
        this.rememberTaskDubbingDraft(); return
      }
      this.setData({ submitting: false, recordingState: 'submitted', taskWork: sealed.data,
        taskSealIntent: clearWriteIntent(), submitError: '' },
      () => this.rememberTaskDubbingDraft())
    },
    returnToTask() {
      if (this.data.taskMode && this.data.recordingState === 'recording') {
        this.stopRecording(); return
      }
      if (this.data.taskMode && this.data.recordingState === 'local' && this.data.localPath) {
        wx.showModal({ title: '配音尚未上传',
          content: '离开后本机录音可能丢失。请先上传，或确认放弃本次录音。',
          confirmText: '继续上传', cancelText: '放弃离开',
          success: result => { if (result.cancel) wx.navigateBack() } })
        return
      }
      wx.navigateBack()
    },
    openMyWorks() { wx.navigateTo({ url: '/subpackages/student/my-works/my-works' }) },
  },
})
