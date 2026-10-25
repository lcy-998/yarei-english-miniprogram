import { M3TaskMediaPlaybackView, M3TaskMediaSnapshotView, TaskDetailView, TaskItem } from '../domain/types'
import { StructuredSubmissionAnswer, getPackAttemptSummary, getTaskDetail, getVocabularyProgress, saveDraft, submitTask } from '../services/app-service'
import { getReadingProgress } from '../services/m1-app-service'
import { getRepositoryMode } from '../../../repositories/repository-factory'
import { getCurrentTaskId, getSession, getTeacherReviewScoreDraft, setCurrentBookId, setTeacherReviewScoreDraft } from '../session/session'
import { assignmentStatusLabel } from '../shared/assignment-status'
import { notifyStudentTaskSubmitted } from '../shared/student-task-update'
import { exercisePackTitleKey } from '../shared/exercise-pack-title'
import { taskExerciseGroupKey } from '../shared/exercise-pack-title'
import { activeDraftRecordVersion } from '../shared/submission-draft'
import { formatRecordingDuration } from '../shared/recording-duration'
import { recordingMediaIssue } from '../shared/dubbing-recording-validation'
import { formatTaskDueAt } from '../shared/task-schedule'
import { EMPTY_WRITE_INTENT, WriteIntentState, clearWriteIntent, createPageOperationId, prepareWriteIntent } from '../shared/write-intent'
import type { TaskRecordingView } from '../../../domain/task-recording'
import { beginTaskRecording, getTaskRecordingMediaState, getTaskRecordingPlayback, listTaskRecordings, submitTaskRecording } from '../services/task-recording-service'
import { taskProgress } from './task-progress'
import { firstIncompleteTaskItemId, hasUnreleasedMediaItem, mediaTaskProgressFraction, taskItemStatusLabel, taskWriteAvailability, type TaskItemProgressTone } from '../shared/task-detail-view'
import { TeacherReviewRoute, loadTeacherReviewItem, teacherExerciseView, teacherReviewManualScoreRequired, teacherReviewRoute } from '../shared/teacher-review-item'
import type { TeacherReviewSubmissionView } from '../../../services/cloudbase-app-service'
import { parseReviewScoreInput } from '../shared/review-task-state'
import { beginTaskMediaSession, getTaskMediaPlayback,
  reportTaskMediaHeartbeat } from '../services/task-media-service'
import { mediaDraftValue, mediaQuestionRows, mediaSubmissionValue, taskMediaPlaybackReady, taskMediaSeekTarget,
  taskMediaSubmissionReady, taskMediaPlaybackCompleted, taskMediaAnswersComplete,
  sealedTaskDubbingWorkId, savedTaskMediaAnswers,
  type MediaQuestionAnswers } from '../shared/student-task-media-policy'
import { LEARNING_SPEEDS, nativeVideoSpeed, readLearningSpeed, saveLearningSpeed } from '../pages/student/student-media-preferences'
import { readTaskDubbingLocalDraft } from '../shared/task-dubbing-local-draft'
import { findSubmittedTaskDubbingWork } from '../services/task-dubbing-work-lookup'
import { getTeacherTaskMediaReviewEvidence } from '../services/teacher-media-service'
import type { TeacherTaskMediaReviewEvidenceView } from '../../../domain/teacher-media'
import { teacherMediaProgressLabel, teacherMediaQuestionRows } from '../shared/teacher-task-media-view'
import { teacherContentPreviewRoute, type TeacherContentPreviewRoute } from '../shared/teacher-content-preview'
import { exerciseTaskDraftKey, readExerciseTaskDraft } from '../shared/exercise-task-draft'
import { getSchoolQuestion } from '../services/app-service'
import { getRecordingPrompt } from '../services/task-recording-service'
import { readTaskMediaDraft, taskMediaDraftKey, writeTaskMediaDraft } from '../shared/task-media-draft'
import { previewTeacherAsset } from '../services/teacher-media-service'
import type { TeacherAssetPreview } from '../../../domain/teacher-media'
import type { SchoolQuestionDetail } from '../../../domain/types'
import type { RecordingPromptView } from '../../../domain/task-recording'

type RecorderStop = { duration: number; fileSize: number; tempFilePath: string }
let taskRecordingReceiver: { stop: (result: RecorderStop) => void; error: () => void } | null = null
let taskRecorderBound = false
let taskRecorder: ReturnType<typeof wx.getRecorderManager> | null = null
let taskRecordingStartedAtMs: number | null = null
let taskRecordingTimer: ReturnType<typeof setInterval> | null = null
let activeTaskMediaAudio: ReturnType<typeof wx.createInnerAudioContext> | null = null
let teacherMediaAudio: ReturnType<typeof wx.createInnerAudioContext> | null = null
let teacherPreviewAudio: ReturnType<typeof wx.createInnerAudioContext> | null = null
let lastTaskMediaObservedMs = 0
let lastTaskMediaObservedAt = 0

function stopTeacherMediaAudio(): void {
  teacherMediaAudio?.stop()
  teacherMediaAudio?.destroy()
  teacherMediaAudio = null
}
function stopTeacherPreviewAudio(): void {
  teacherPreviewAudio?.stop()
  teacherPreviewAudio?.destroy()
  teacherPreviewAudio = null
}

function stopTaskRecordingTimer(): void {
  if (taskRecordingTimer !== null) clearInterval(taskRecordingTimer)
  taskRecordingTimer = null
  taskRecordingStartedAtMs = null
}
function getTaskRecorder(): ReturnType<typeof wx.getRecorderManager> {
  taskRecorder ??= wx.getRecorderManager()
  return taskRecorder
}
function bindTaskRecorder(): void {
  if (taskRecorderBound) return
  const manager = getTaskRecorder()
  manager.onStop(result => taskRecordingReceiver?.stop(result))
  manager.onError(() => taskRecordingReceiver?.error())
  taskRecorderBound = true
}

interface CompletionInput {
  itemId: string
  resourceId?: string
  type: 'reading' | 'vocabulary' | 'exercise' | 'recording'
  title: string
  requiredCount: number
  pageIds?: string[]
  pageNumbers?: number[]
  pageRangeLabel: string
  readingVerified: boolean
  vocabularyVerified: boolean
  completedPageCount: string
  completedWordCount: string
  correctWordCount: string
  answeredQuestionCount: string
  exerciseQuestion?: TaskItem['exerciseQuestion']
  exerciseResponse: string
  exerciseSelectedOptions: string[]
  exerciseChoices: Array<{ value: string; selected: boolean }>
  recordingPrompt: string
  recordingId: string
  recordingMediaAvailable: boolean
  recordingMediaExpired: boolean
  localRecordingPath: string
  recordingDurationMs: number
  recordingElapsedLabel: string
  recordingSizeBytes: number
  recordingState: 'idle' | 'recording' | 'local' | 'invalid' | 'uploading' | 'submitted'
}

interface MediaAvailabilityRow { itemId: string; title: string; label: string; ready: boolean;
  hasSnapshot: boolean; progressFraction: number; progressComplete: boolean; progressLabel: string }
interface PendingTaskMediaHeartbeat { sessionId: string; playedFromMs: number;
  playedToMs: number; positionMs: number; operationId: string }

type TeacherTaskReviewItem = NonNullable<TeacherReviewSubmissionView['taskItems']>[number]
type TeacherExerciseEvidence = NonNullable<TeacherReviewSubmissionView['exerciseEvidence']>[number]

Component({
  data: {
    loading: true,
    error: '',
    detail: null as TaskDetailView | null,
    teacherPreviewMode: false,
    teacherPreviewRoute: null as TeacherContentPreviewRoute | null,
    teacherPreviewSessionId: '',
    teacherPreviewTitle: '',
    teacherPreviewQuestion: null as SchoolQuestionDetail | null,
    teacherPreviewRecording: null as RecordingPromptView | null,
    teacherPreviewAsset: null as TeacherAssetPreview | null,
    teacherPreviewPlaying: false, teacherPreviewError: '', teacherPreviewSubtitle: '',
    teacherPreviewCurrentMs: 0, teacherPreviewSpeed: 1, teacherPreviewEarMode: false,
    teacherPreviewCurrentLabel: '00:00', teacherPreviewDurationLabel: '00:00', teacherPreviewProgress: 0,
    teacherPreviewClipEndMs: null as number | null,
    teacherReviewMode: false,
    teacherReviewSessionId: '',
    teacherReviewRoute: null as TeacherReviewRoute | null,
    teacherReviewItem: null as TeacherTaskReviewItem | null,
    teacherReviewVersion: 0,
    teacherExercise: null as TeacherExerciseEvidence | null,
    teacherExerciseChoices: [] as Array<{ id: number; value: string; selected: boolean; correct: boolean }>,
    teacherAnswerLabel: '',
    teacherCorrectLabel: '',
    teacherVerdict: '',
    teacherRecordingId: '',
    teacherRecordingState: 'missing' as 'missing' | 'available' | 'expired' | 'error',
    teacherRecordingDuration: '',
    teacherMediaEvidence: null as TeacherTaskMediaReviewEvidenceView | null,
    teacherMediaQuestions: [] as ReturnType<typeof teacherMediaQuestionRows>,
    teacherMediaProgress: '', teacherMediaPlaying: false, teacherMediaPlaybackError: '',
    teacherManualScoreRequired: false,
    teacherScoreInput: '',
    teacherScoreError: '',
    statusLabel: '',
    dueLabel: '',
    readingSyncError: '',
    selectedReadingSyncError: '',
    vocabularySyncError: '',
    redoDueLabel: '',
    redoExpired: false,
    editable: false,
    writeUnavailableReason: '',
    writeTimingLabel: '',
    writeError: '',
    feedbackVersion: 0,
    hasUnsupportedExercise: false,
    hasUnreleasedMedia: false,
    mediaAvailability: [] as MediaAvailabilityRow[],
    otherMediaAvailability: [] as MediaAvailabilityRow[],
    mediaStartBusyItemId: '', mediaStartError: '',
    mediaStartIntents: {} as Record<string, WriteIntentState>,
    activeTaskMediaItemId: '', activeTaskMediaKind: '' as '' | 'listening' | 'video' | 'dubbing',
    activeTaskMediaSnapshot: null as M3TaskMediaSnapshotView | null,
    activeTaskMediaPlayback: null as M3TaskMediaPlaybackView | null,
    taskMediaPlaying: false, taskMediaEarMode: false, taskMediaSpeed: 1,
    taskMediaCurrentMs: 0, taskMediaLastReportedMs: 0, taskMediaConfirmedMs: 0,
    taskMediaCurrentLabel: '00:00', taskMediaDurationLabel: '00:00',
    taskMediaPositionPercent: 0, taskMediaConfirmedPercent: 0,
    taskMediaCompleted: false,
    taskMediaSubtitle: '',
    taskMediaFinalWorkId: '',
    activeTaskMediaAnswers: {} as Record<string, string | string[]>,
    activeTaskMediaQuestions: [] as ReturnType<typeof mediaQuestionRows>,
    taskMediaDraftError: '',
    taskMediaPendingVideoSeekMs: null as number | null, taskMediaPendingVideoSeekAt: 0,
    taskMediaError: '', taskMediaWarning: '', taskMediaHeartbeatBusy: false,
    taskMediaPendingHeartbeat: null as PendingTaskMediaHeartbeat | null,
    taskMediaFinishPending: false,
    taskMediaClipEndMs: 0, taskMediaBuffering: false,
    answer: '',
    completionInputs: [] as CompletionInput[],
    saving: false,
    submitting: false,
    draftIntent: EMPTY_WRITE_INTENT as WriteIntentState,
    submitIntent: EMPTY_WRITE_INTENT as WriteIntentState,
    activeRecordingItemId: '',
    recordingDrafts: {} as Record<string, TaskRecordingView | undefined>,
    recordingBeginIntents: {} as Record<string, WriteIntentState>,
    recordingSubmitIntents: {} as Record<string, WriteIntentState>,
    recordingError: '',
    hasRecordingTask: false,
    hasCompletionForm: false,
    progressPercent: 0,
    completedCount: 0,
    requirementCount: 0,
    requirementItems: [] as Array<TaskItem & { progressComplete: boolean; progressLabel: string;
      progressTone: TaskItemProgressTone; readingPageRangeLabel: string }>,
  },
  observers: {
    'completionInputs, detail, mediaAvailability'(inputs: CompletionInput[], detail: TaskDetailView | null,
      mediaAvailability: MediaAvailabilityRow[]) {
      const progress = taskProgress(inputs, detail?.assignment.status ?? 'not_started')
      const unreleased = detail ? hasUnreleasedMediaItem(detail.task, getRepositoryMode() === 'cloudbase') : false
      const assignment = detail?.assignment
      const mediaItems = detail?.task.items.filter(item => item.type === 'listening'
        || item.type === 'video' || item.type === 'dubbing') ?? []
      const submitted = assignment?.status === 'awaiting_review' || assignment?.status === 'completed'
      const mediaProgress = new Map(mediaAvailability.map(row => [row.itemId, row]))
      const totalProgress = progress.percent * inputs.length / 100
        + mediaItems.reduce((sum, item) => sum + (mediaProgress.get(item.id)?.progressFraction ?? 0), 0)
      const progressPercent = submitted ? 100
        : Math.round(totalProgress * 100 / Math.max(1, detail?.task.items.length ?? 1))
      const statusLabel = assignment
        ? assignment.status === 'not_started' || assignment.status === 'in_progress'
          ? unreleased ? '含未开放媒体内容'
            : progressPercent === 100 ? '待提交'
            : assignment.redoDueAt ? '重做中'
              : progressPercent > 0 ? '学习中' : assignmentStatusLabel(assignment.status)
          : assignmentStatusLabel(assignment.status)
        : ''
      const requirementItems = (detail?.task.items ?? []).map(item => {
          const mediaSubmitted = submitted && mediaItems.some(media => media.id === item.id)
          const progressComplete = progress.byItem[item.id]?.complete
            ?? (mediaSubmitted || mediaProgress.get(item.id)?.progressComplete === true)
          const rawProgressLabel = progressComplete ? '已完成'
            : progress.byItem[item.id]?.label
              ?? (mediaSubmitted ? '已完成' : mediaProgress.get(item.id)?.progressLabel ?? '待服务端核对')
          const status = taskItemStatusLabel(rawProgressLabel, progressComplete)
          return { ...item, progressComplete, progressLabel: status.label,
            progressTone: status.tone,
            readingPageRangeLabel: item.readingPageNumbers?.join('、') ?? '' }
        })
      const exerciseGroups = new Map<string, typeof requirementItems>()
      for (const item of requirementItems) if (item.type === 'exercise') {
        const key = taskExerciseGroupKey(item)
        exerciseGroups.set(key, [...(exerciseGroups.get(key) ?? []), item])
      }
      const displayedRequirements = requirementItems.filter(item => item.type !== 'exercise'
        || exerciseGroups.get(taskExerciseGroupKey(item))?.[0]?.id === item.id)
        .map(item => {
          if (item.type !== 'exercise') return item
          const key = taskExerciseGroupKey(item)
          const group = exerciseGroups.get(key) ?? [item]
          if (group.length < 2) return item
          const complete = group.every(question => question.progressComplete)
          return { ...item, title: `${exercisePackTitleKey(item.title) ?? item.title}（${group.length} 题）`,
            completionRule: `完成本组 ${group.length} 道题`, progressComplete: complete,
            progressLabel: complete ? '已完成'
              : `已完成 ${group.filter(question => question.progressComplete).length}/${group.length} 题`,
            progressTone: (complete ? 'complete' : 'in-progress') as TaskItemProgressTone }
        })
      this.setData({ progressPercent,
        completedCount: displayedRequirements.filter(item => item.progressComplete).length,
        requirementCount: displayedRequirements.length,
        statusLabel,
        requirementItems: displayedRequirements,
        hasCompletionForm: inputs.some(item => (item.type === 'reading' || item.type === 'vocabulary')
          && !item.resourceId) })
    },
  },
  lifetimes: {
    attached() { const session = getSession(); if ((session?.activeRole ?? session?.user.role) === 'teacher') return
      bindTaskRecorder(); taskRecordingReceiver = { stop: result => this.onRecordingStopped(result),
      error: () => this.onRecordingFailed() }; this.loadDetail() },
    detached() { activeTaskMediaAudio?.destroy(); activeTaskMediaAudio = null
      stopTeacherPreviewAudio()
      stopTeacherMediaAudio()
      if (this.data.teacherReviewMode) return
      stopTaskRecordingTimer(); taskRecordingReceiver = null; if (this.data.activeRecordingItemId) getTaskRecorder().stop() },
  },
  pageLifetimes: { hide() {
    stopTeacherPreviewAudio()
    if (this.data.teacherPreviewAsset && this.data.teacherPreviewAsset.kind !== 'listening') {
      wx.createVideoContext('teacher-preview-video', this).pause()
    }
    stopTeacherMediaAudio()
    if (this.data.teacherMediaEvidence?.kind === 'video') wx.createVideoContext('teacher-media-video', this).pause()
    if (this.data.activeRecordingItemId) { stopTaskRecordingTimer(); getTaskRecorder().stop() }
    activeTaskMediaAudio?.pause()
    if (this.data.activeTaskMediaKind === 'video' || this.data.activeTaskMediaKind === 'dubbing') {
      wx.createVideoContext('task-media-video', this).pause()
    }
    this.setData({ taskMediaPlaying: false, teacherMediaPlaying: false, teacherPreviewPlaying: false })
  }, show() {
    const pages = getCurrentPages() as Array<{ options?: Record<string, string> }>
    const options = pages[pages.length - 1]?.options
    if (options?.teacherPreview === '1') {
      const session = getSession()
      if (!this.data.teacherPreviewMode) {
        const route = teacherContentPreviewRoute(options)
        this.setData({ teacherPreviewMode: true, teacherPreviewRoute: route }, () => this.loadTeacherPreview())
      } else if (!session || session.sessionId !== this.data.teacherPreviewSessionId
        || this.data.teacherPreviewAsset?.playback.expiresAt
          && Date.parse(this.data.teacherPreviewAsset.playback.expiresAt) <= Date.now() + 5000) {
        this.loadTeacherPreview()
      }
      return
    }
    if (options?.teacherReview === '1') {
      const currentSession = getSession()
      if (!this.data.teacherReviewMode) {
        const route = teacherReviewRoute(options)
        this.setData({ teacherReviewMode: true, teacherReviewRoute: route }, () => this.loadTeacherReview())
      } else if (!currentSession || (currentSession.activeRole ?? currentSession.user.role) !== 'teacher'
        || currentSession.sessionId !== this.data.teacherReviewSessionId) {
        stopTeacherMediaAudio()
        this.setData({ teacherReviewItem: null, teacherMediaEvidence: null,
          teacherMediaQuestions: [], teacherExercise: null, teacherRecordingId: '' },
        () => this.loadTeacherReview())
      } else if (this.data.teacherMediaEvidence?.sourcePlayback.expiresAt
        && Date.parse(this.data.teacherMediaEvidence.sourcePlayback.expiresAt) <= Date.now() + 5000) {
        this.refreshTeacherMediaEvidence()
      }
      return
    }
    if (this.data.detail) this.loadDetail(true)
  } },
  methods: {
    async loadTeacherPreview() {
      const route = this.data.teacherPreviewRoute
      const session = getSession()
      if (!route || !session || (session.activeRole ?? session.user.role) !== 'teacher') {
        this.setData({ loading: false, error: '仅授权教师可预览任务内容' }); return
      }
      stopTeacherPreviewAudio()
      this.setData({ loading: true, error: '', teacherPreviewError: '',
        teacherPreviewQuestion: null, teacherPreviewRecording: null, teacherPreviewAsset: null,
        teacherPreviewPlaying: false, teacherPreviewCurrentMs: 0, teacherPreviewSubtitle: '',
        teacherPreviewCurrentLabel: '00:00', teacherPreviewDurationLabel: '00:00', teacherPreviewProgress: 0 })
      if (route.type === 'exercise') {
        const result = await getSchoolQuestion(session.user.id, route.resourceId, route.targetClassIds)
        if (getSession()?.sessionId !== session.sessionId) return
        this.setData(result.ok ? { loading: false, teacherPreviewSessionId: session.sessionId,
          teacherPreviewQuestion: result.data, teacherPreviewTitle: result.data.title }
          : { loading: false, error: result.error.message })
        return
      }
      if (route.type === 'recording') {
        const result = await getRecordingPrompt(session.user.id, route.resourceId, route.targetClassIds)
        if (getSession()?.sessionId !== session.sessionId) return
        this.setData(result.ok ? { loading: false, teacherPreviewSessionId: session.sessionId,
          teacherPreviewRecording: result.data, teacherPreviewTitle: result.data.title }
          : { loading: false, error: result.error.message })
        return
      }
      if (route.type === 'listening' || route.type === 'video') {
        const result = await previewTeacherAsset(session.user.id, route.resourceId, route.targetClassIds)
        if (getSession()?.sessionId !== session.sessionId) return
        if (!result.ok || result.data.kind !== route.type) {
          this.setData({ loading: false, error: result.ok ? '预览内容类型不匹配' : result.error.message }); return
        }
        this.setData({ loading: false, teacherPreviewSessionId: session.sessionId,
          teacherPreviewAsset: result.data, teacherPreviewTitle: result.data.title,
          teacherPreviewSpeed: 1, teacherPreviewEarMode: false,
          teacherPreviewDurationLabel: formatRecordingDuration(result.data.durationMs) })
        return
      }
      this.setData({ loading: false, error: '请从对应的学生学习页面预览此内容' })
    },
    startTeacherPreviewAudio(startMs: number, endMs: number | null) {
      const asset = this.data.teacherPreviewAsset
      if (!asset || asset.kind !== 'listening'
        || Date.parse(asset.playback.expiresAt) <= Date.now() + 5000) {
        this.setData({ teacherPreviewError: '试听地址已过期，请刷新内容后重试' }); return
      }
      stopTeacherPreviewAudio()
      const player = wx.createInnerAudioContext()
      teacherPreviewAudio = player
      let started = false
      player.onCanplay(() => {
        if (started || teacherPreviewAudio !== player) return
        started = true
        if (startMs > 0) player.seek(startMs / 1000)
        else player.play()
      })
      player.onSeeked(() => { if (teacherPreviewAudio === player) player.play() })
      player.onTimeUpdate(() => {
        if (teacherPreviewAudio !== player) return
        const currentMs = Math.round(player.currentTime * 1000)
        this.setData({ teacherPreviewCurrentMs: currentMs,
          teacherPreviewCurrentLabel: formatRecordingDuration(currentMs),
          teacherPreviewProgress: Math.min(100, Math.round(currentMs * 100 / asset.durationMs)) })
        if (endMs !== null && currentMs >= endMs) {
          stopTeacherPreviewAudio(); this.setData({ teacherPreviewPlaying: false,
            teacherPreviewClipEndMs: null })
        }
      })
      player.onEnded(() => { stopTeacherPreviewAudio(); this.setData({ teacherPreviewPlaying: false,
        teacherPreviewClipEndMs: null }) })
      player.onError(() => { stopTeacherPreviewAudio(); this.setData({ teacherPreviewPlaying: false,
        teacherPreviewError: '音频预览失败，请刷新后重试' }) })
      player.playbackRate = this.data.teacherPreviewSpeed
      player.src = asset.playback.temporaryUrl
      this.setData({ teacherPreviewPlaying: true, teacherPreviewCurrentMs: startMs,
        teacherPreviewCurrentLabel: formatRecordingDuration(startMs),
        teacherPreviewProgress: Math.min(100, Math.round(startMs * 100 / asset.durationMs)),
        teacherPreviewClipEndMs: endMs, teacherPreviewError: '' })
    },
    toggleTeacherPreviewPlayback() {
      const asset = this.data.teacherPreviewAsset
      if (!asset) return
      if (this.data.teacherPreviewPlaying) {
        if (asset.kind === 'video') wx.createVideoContext('teacher-preview-video', this).pause()
        else stopTeacherPreviewAudio()
        this.setData({ teacherPreviewPlaying: false }); return
      }
      if (Date.parse(asset.playback.expiresAt) <= Date.now() + 5000) {
        this.setData({ teacherPreviewError: '试听地址已过期，请刷新内容后重试' }); return
      }
      if (asset.kind === 'video') {
        wx.createVideoContext('teacher-preview-video', this).play()
        this.setData({ teacherPreviewPlaying: true, teacherPreviewError: '' })
      } else this.startTeacherPreviewAudio(this.data.teacherPreviewCurrentMs, null)
    },
    playTeacherPreviewClip(event: WechatMiniprogram.TouchEvent) {
      const questionId = event.currentTarget.dataset.questionId as string
      const clip = this.data.teacherPreviewAsset?.clips.find(item => item.questionId === questionId)
      if (!clip) { this.setData({ teacherPreviewError: '本题没有可用的听力片段' }); return }
      this.startTeacherPreviewAudio(clip.startMs, clip.endMs)
    },
    onTeacherPreviewVideoTimeUpdate(event: WechatMiniprogram.CustomEvent<{ currentTime: number }>) {
      const asset = this.data.teacherPreviewAsset
      if (!asset || asset.kind !== 'video') return
      const currentMs = Math.round(event.detail.currentTime * 1000)
      this.setData({ teacherPreviewCurrentMs: currentMs,
        teacherPreviewCurrentLabel: formatRecordingDuration(currentMs),
        teacherPreviewProgress: Math.min(100, Math.round(currentMs * 100 / asset.durationMs)),
        teacherPreviewSubtitle: asset.subtitles.find(cue => cue.startMs <= currentMs && cue.endMs > currentMs)?.text ?? '' })
    },
    onTeacherPreviewVideoPause() { this.setData({ teacherPreviewPlaying: false }) },
    onTeacherPreviewVideoError() {
      this.setData({ teacherPreviewPlaying: false, teacherPreviewError: '视频预览失败，请刷新内容后重试' })
    },
    seekTeacherPreviewMedia(event: WechatMiniprogram.CustomEvent<{ percent: number }>) {
      const asset = this.data.teacherPreviewAsset
      if (!asset) return
      const targetMs = Math.round(Math.max(0, Math.min(100, event.detail.percent)) * asset.durationMs / 100)
      if (asset.kind === 'video') wx.createVideoContext('teacher-preview-video', this).seek(targetMs / 1000)
      else teacherPreviewAudio?.seek(targetMs / 1000)
      this.setData({ teacherPreviewCurrentMs: targetMs,
        teacherPreviewCurrentLabel: formatRecordingDuration(targetMs),
        teacherPreviewProgress: Math.min(100, Math.round(targetMs * 100 / asset.durationMs)) })
    },
    chooseTeacherPreviewSpeed() {
      const asset = this.data.teacherPreviewAsset
      if (!asset) return
      const currentIndex = LEARNING_SPEEDS.findIndex(speed => speed === this.data.teacherPreviewSpeed)
      const speed = LEARNING_SPEEDS[(currentIndex + 1) % LEARNING_SPEEDS.length]!
      if (asset.kind === 'video') wx.createVideoContext('teacher-preview-video', this).playbackRate(nativeVideoSpeed(speed).speed)
      else if (teacherPreviewAudio) teacherPreviewAudio.playbackRate = speed
      this.setData({ teacherPreviewSpeed: speed })
    },
    toggleTeacherPreviewEarMode() {
      this.setData({ teacherPreviewEarMode: !this.data.teacherPreviewEarMode })
    },
    refreshTeacherPreview() { this.loadTeacherPreview() },
    async loadTeacherReview() {
      const route = this.data.teacherReviewRoute
      if (!route) { this.setData({ loading: false, error: '缺少要查看的作业记录。' }); return }
      const session = getSession()
      if (!session || (session.activeRole ?? session.user.role) !== 'teacher') {
        this.setData({ loading: false, error: '仅授权教师可查看学生作答。' }); return
      }
      stopTeacherMediaAudio()
      this.setData({ loading: true, error: '', teacherMediaPlaybackError: '', teacherMediaPlaying: false })
      const result = await loadTeacherReviewItem(route, ['exercise', 'recording', 'listening', 'video'])
      if (getSession()?.sessionId !== session.sessionId) {
        this.setData({ loading: false, error: '教师会话已变化，请重新进入作业详情。' }); return
      }
      if (!result.ok) { this.setData({ loading: false, error: result.message }); return }
      const submission = result.submission
      const previousDraft = getTeacherReviewScoreDraft()
      const parsedDraft = parseReviewScoreInput(previousDraft?.submissionId === route.submissionId
        && previousDraft.itemId === route.itemId ? previousDraft.input : '')
      const scoreDraft = { teacherManualScoreRequired: teacherReviewManualScoreRequired(submission, result.item),
        teacherScoreInput: parsedDraft.input, teacherScoreError: parsedDraft.error }
      if (result.item.type === 'listening' || result.item.type === 'video') {
        this.setData({ teacherReviewItem: result.item, ...scoreDraft,
          teacherReviewVersion: submission.submissionVersion, teacherReviewSessionId: session.sessionId,
          teacherMediaEvidence: null })
        await this.refreshTeacherMediaEvidence()
        return
      }
      if (result.item.type === 'exercise') {
        const evidence = submission.exerciseEvidence?.find(entry => entry.itemId === route.itemId) ?? null
        const display = teacherExerciseView(evidence)
        this.setData({ loading: false, teacherReviewItem: result.item, ...scoreDraft,
          teacherReviewSessionId: session.sessionId,
          teacherReviewVersion: submission.submissionVersion, teacherExercise: evidence,
          teacherExerciseChoices: display.choices, teacherAnswerLabel: display.answerLabel,
          teacherCorrectLabel: display.correctLabel, teacherVerdict: display.verdict })
        return
      }
      const answer = submission.answers.find(entry => entry.itemId === route.itemId)?.value
      const value = answer !== null && typeof answer === 'object' && !Array.isArray(answer)
        ? answer as Record<string, unknown> : null
      const recordingId = value?.kind === 'recording' && typeof value.recordingId === 'string'
        ? value.recordingId : ''
      const durationMs = typeof value?.durationMs === 'number' && Number.isFinite(value.durationMs)
        ? value.durationMs : 0
      this.setData({ loading: false, teacherReviewItem: result.item, ...scoreDraft,
        teacherReviewSessionId: session.sessionId,
        teacherReviewVersion: submission.submissionVersion, teacherRecordingId: recordingId,
        teacherRecordingDuration: durationMs > 0 ? formatRecordingDuration(durationMs) : '未记录',
        teacherRecordingState: recordingId ? 'error' : 'missing' })
      if (!recordingId) return
      const media = await getTaskRecordingMediaState(session.user.id, recordingId)
      if (this.data.teacherReviewRoute?.submissionId !== route.submissionId
        || getSession()?.sessionId !== session.sessionId) return
      this.setData({ teacherRecordingState: !media.ok ? 'error'
        : media.data.mediaExpired ? 'expired' : 'available' })
    },
    async refreshTeacherMediaEvidence() {
      const route = this.data.teacherReviewRoute
      const session = getSession()
      if (!route || !session || (session.activeRole ?? session.user.role) !== 'teacher') {
        this.setData({ loading: false, error: '当前教师授权已失效，请重新进入作业详情' }); return
      }
      stopTeacherMediaAudio()
      this.setData({ loading: true, error: '', teacherMediaPlaybackError: '', teacherMediaPlaying: false })
      const result = await getTeacherTaskMediaReviewEvidence(session.user.id, route.submissionId, route.itemId)
      const current = getSession()
      if (this.data.teacherReviewRoute?.submissionId !== route.submissionId
        || this.data.teacherReviewRoute?.itemId !== route.itemId
        || current?.sessionId !== session.sessionId) return
      if (!result.ok || result.data.submissionId !== route.submissionId
        || result.data.itemId !== route.itemId
        || (result.data.kind !== 'listening' && result.data.kind !== 'video')) {
        this.setData({ loading: false, error: result.ok ? '媒体提交证据与当前内容不一致' : result.error.message }); return
      }
      this.setData({ loading: false, teacherMediaEvidence: result.data,
        teacherMediaQuestions: teacherMediaQuestionRows(result.data.questions),
        teacherMediaProgress: teacherMediaProgressLabel(result.data) })
    },
    playTeacherMediaAudio(startMs: number, endMs: number | null) {
      const evidence = this.data.teacherMediaEvidence
      if (!evidence || evidence.kind !== 'listening' || !evidence.sourcePlayback.available
        || !evidence.sourcePlayback.temporaryUrl) {
        this.setData({ teacherMediaPlaybackError: '当前音频不可试听，请刷新授权地址' }); return
      }
      if (!evidence.sourcePlayback.expiresAt
        || Date.parse(evidence.sourcePlayback.expiresAt) <= Date.now() + 5000) {
        this.setData({ teacherMediaPlaybackError: '试听地址已过期，请刷新后重试' }); return
      }
      stopTeacherMediaAudio()
      const player = wx.createInnerAudioContext()
      teacherMediaAudio = player
      let started = false
      player.onCanplay(() => {
        if (started || teacherMediaAudio !== player) return
        started = true
        if (startMs > 0) player.seek(startMs / 1000)
        else player.play()
      })
      player.onSeeked(() => { if (teacherMediaAudio === player) player.play() })
      player.onTimeUpdate(() => {
        if (endMs !== null && player.currentTime * 1000 >= endMs) {
          stopTeacherMediaAudio(); this.setData({ teacherMediaPlaying: false })
        }
      })
      player.onEnded(() => { stopTeacherMediaAudio(); this.setData({ teacherMediaPlaying: false }) })
      player.onError(() => { stopTeacherMediaAudio(); this.setData({ teacherMediaPlaying: false,
        teacherMediaPlaybackError: '音频试听失败，请刷新授权地址后重试' }) })
      player.src = evidence.sourcePlayback.temporaryUrl
      this.setData({ teacherMediaPlaying: true, teacherMediaPlaybackError: '' })
    },
    toggleTeacherMediaSource() {
      if (this.data.teacherMediaPlaying) {
        stopTeacherMediaAudio(); this.setData({ teacherMediaPlaying: false }); return
      }
      this.playTeacherMediaAudio(0, null)
    },
    playTeacherMediaClip(event: WechatMiniprogram.TouchEvent) {
      const questionId = event.currentTarget.dataset.questionId as string
      const clip = this.data.teacherMediaQuestions.find(item => item.questionId === questionId)?.clip
      if (!clip) { this.setData({ teacherMediaPlaybackError: '本题片段未记录' }); return }
      this.playTeacherMediaAudio(clip.startMs, clip.endMs)
    },
    onTeacherMediaVideoError() {
      this.setData({ teacherMediaPlaybackError: '视频试听失败或地址已过期，请刷新授权地址' })
    },
    onTeacherReviewScore(event: WechatMiniprogram.Input) {
      const route = this.data.teacherReviewRoute
      if (!this.data.teacherReviewMode || !this.data.teacherManualScoreRequired || !route) return
      const parsed = parseReviewScoreInput(event.detail.value)
      setTeacherReviewScoreDraft({ submissionId: route.submissionId, itemId: route.itemId, input: parsed.input })
      this.setData({ teacherScoreInput: parsed.input, teacherScoreError: parsed.error })
    },
    async playTeacherRecording() {
      const recordingId = this.data.teacherRecordingId
      const session = getSession()
      if (!this.data.teacherReviewMode || !session || !recordingId || this.data.teacherRecordingState !== 'available') return
      const result = await getTaskRecordingPlayback(session.user.id, recordingId)
      if (!result.ok) { wx.showToast({ title: result.error.message, icon: 'none' }); return }
      const audio = wx.createInnerAudioContext()
      audio.src = result.data.temporaryUrl
      audio.onEnded(() => audio.destroy())
      audio.onError(() => { audio.destroy(); wx.showToast({ title: '录音试听失败，请重试', icon: 'none' }) })
      audio.play()
    },
    async loadDetail(refresh = false) {
      if (this.data.teacherPreviewMode) { await this.loadTeacherPreview(); return }
      if (this.data.teacherReviewMode) { await this.loadTeacherReview(); return }
      const session = getSession(); const taskId = getCurrentTaskId()
      if (!session || !taskId) { wx.navigateBack(); return }
      if (this.data.activeTaskMediaItemId) {
        activeTaskMediaAudio?.destroy(); activeTaskMediaAudio = null
        if (this.data.activeTaskMediaKind === 'video' || this.data.activeTaskMediaKind === 'dubbing') {
          wx.createVideoContext('task-media-video', this).pause()
        }
        this.setData({ activeTaskMediaItemId: '', activeTaskMediaKind: '',
          activeTaskMediaSnapshot: null, activeTaskMediaPlayback: null,
          taskMediaPlaying: false, taskMediaEarMode: false,
          activeTaskMediaAnswers: {}, activeTaskMediaQuestions: [],
          taskMediaPendingHeartbeat: null, taskMediaHeartbeatBusy: false,
          taskMediaFinishPending: false })
      }
      this.setData({ loading: true, error: '' })
      const result = await getTaskDetail(session.user.id, taskId)
      if (getSession()?.sessionId !== session.sessionId || getCurrentTaskId() !== taskId) return
      if (!result.ok) {
        this.setData(refresh === true ? { loading: false, writeError: `任务状态刷新失败：${result.error.message}；当前输入已保留` }
          : { loading: false, error: result.error.message }); return
      }
      const assignment = result.data.assignment
      const redoWindow = assignment.status === 'redo_required' || Boolean(assignment.redoDueAt)
      const reuseSubmission = !(redoWindow && result.data.submission?.status === 'returned')
      const answers = new Map(reuseSubmission ? result.data.submission?.answers.map(item => [item.taskItemId, item.structuredValue]) ?? [] : [])
      const readingPageCounts = new Map(result.data.readingPageProgress?.map(item => [item.itemId, item.completedPageCount]) ?? [])
      const completionInputs = result.data.task.items.flatMap((item): CompletionInput[] => {
        const rule = item.completionRuleData
        if (!rule) return []
        if (item.type === 'listening' || item.type === 'video' || item.type === 'dubbing') return []
        const previous = answers.get(item.id)
        const priorQuestionResponse = previous?.kind === 'exercise' && item.exerciseQuestion
          ? previous.questionResponses?.find(response => response.questionId === item.exerciseQuestion?.questionId)?.response : undefined
        const exerciseResponse = typeof priorQuestionResponse === 'string' ? priorQuestionResponse : ''
        const exerciseSelectedOptions = Array.isArray(priorQuestionResponse) ? [...priorQuestionResponse] : []
        const requiredCount = rule.kind === 'reading_pages'
          ? rule.requiredPageCount
          : rule.kind === 'vocabulary_words' ? rule.requiredWordCount
            : rule.kind === 'exercise_questions' ? rule.requiredQuestionCount : 1
        const recordingId = previous?.kind === 'recording' && result.data.assignment.status !== 'redo_required'
          ? previous.recordingId : ''
        return [{
          itemId: item.id,
          ...(item.resourceId === undefined ? {} : { resourceId: item.resourceId }),
          type: item.type,
          title: item.title,
          requiredCount,
          ...(rule.kind === 'reading_pages' && rule.pageIds ? { pageIds: [...rule.pageIds] } : {}),
          ...(item.readingPageNumbers ? { pageNumbers: [...item.readingPageNumbers] } : {}),
          pageRangeLabel: item.readingPageNumbers?.length ? `（第 ${item.readingPageNumbers.join('、')} 页）` : '',
          readingVerified: !item.resourceId || (rule.kind === 'reading_pages' && Boolean(rule.pageIds?.length)
            && (readingPageCounts.get(item.id) ?? 0) >= rule.requiredPageCount),
          vocabularyVerified: !item.resourceId,
          completedPageCount: rule.kind === 'reading_pages' && rule.pageIds
            ? String(readingPageCounts.get(item.id) ?? 0)
            : previous?.kind === 'reading' ? String(previous.completedPageCount) : '',
          completedWordCount: previous?.kind === 'vocabulary' ? String(previous.completedWordCount) : '',
          correctWordCount: previous?.kind === 'vocabulary' ? String(previous.correctWordCount) : '',
          answeredQuestionCount: previous?.kind === 'exercise' ? String(previous.answeredQuestionCount) : '',
          ...(item.exerciseQuestion === undefined ? {} : { exerciseQuestion: item.exerciseQuestion }),
          exerciseResponse,
          exerciseSelectedOptions,
          exerciseChoices: item.exerciseQuestion?.options.map(value => ({ value,
            selected: item.exerciseQuestion?.questionType === 'multiple_choice'
              ? exerciseSelectedOptions.includes(value) : exerciseResponse === value })) ?? [],
          recordingPrompt: item.recordingPrompt ?? '',
          recordingId,
          recordingMediaAvailable: false,
          recordingMediaExpired: false,
          localRecordingPath: '',
          recordingDurationMs: previous?.kind === 'recording' && recordingId ? previous.durationMs ?? 0 : 0,
          recordingElapsedLabel: formatRecordingDuration(previous?.kind === 'recording' && recordingId ? previous.durationMs ?? 0 : 0),
          recordingSizeBytes: previous?.kind === 'recording' && recordingId ? previous.sizeBytes ?? 0 : 0,
          recordingState: recordingId ? 'submitted' : 'idle',
        }]
      })
      const learningRecord = reuseSubmission
        ? result.data.submission?.answers.find(item => item.structuredValue === undefined)?.value ?? '' : ''
       const availability = taskWriteAvailability(result.data.task, assignment, new Date().toISOString(), getRepositoryMode() === 'memory')
      const previousDetail = this.data.detail
      const retainInput = refresh === true && availability.editable && previousDetail?.task.id === taskId
        && previousDetail.assignment.redoCount === assignment.redoCount
        && previousDetail.submission?.version === result.data.submission?.version
      const previousInputs = new Map(retainInput ? this.data.completionInputs.map(item => [item.itemId, item]) : [])
      const visibleInputs = completionInputs.map(item => {
        const previous = previousInputs.get(item.itemId)
        const base = previous && !(item.resourceId && (item.type === 'reading' || item.type === 'vocabulary'))
          ? { ...item, ...previous } : item
        if (item.type !== 'exercise' || !availability.editable) return base
        const draft = readExerciseTaskDraft(exerciseTaskDraftKey(session.sessionId,
          result.data.task.id, assignment.id, assignment.redoCount, item.itemId))
        if (!draft) return base
        return { ...base, exerciseResponse: draft.response,
          exerciseSelectedOptions: draft.selectedOptions,
          answeredQuestionCount: draft.answeredQuestionCount,
          exerciseChoices: item.exerciseQuestion?.options.map(value => ({ value,
            selected: item.exerciseQuestion?.questionType === 'multiple_choice'
              ? draft.selectedOptions.includes(value) : draft.response === value })) ?? [] }
      })
      this.setData({
        detail: result.data, completionInputs: visibleInputs,
        mediaStartBusyItemId: '', mediaStartError: '',
        hasRecordingTask: visibleInputs.some(item => item.type === 'recording'),
        dueLabel: formatTaskDueAt(result.data.task.dueAt),
        selectedReadingSyncError: completionInputs.some(item => item.pageIds) && !result.data.readingPageProgress
          ? '阅读页进度暂未返回，请重试同步' : '',
        redoDueLabel: assignment.redoDueAt ? formatTaskDueAt(assignment.redoDueAt) : '',
         redoExpired: redoWindow && !availability.editable,
         editable: availability.editable && !hasUnreleasedMediaItem(result.data.task, getRepositoryMode() === 'cloudbase'),
         writeUnavailableReason: hasUnreleasedMediaItem(result.data.task, getRepositoryMode() === 'cloudbase')
           ? '此任务含尚未开放的媒体内容，需完成审核与连续播放服务后才能作答'
           : availability.reason,
         writeTimingLabel: availability.timingLabel,
         writeError: '',
         feedbackVersion: result.data.feedback && result.data.submission
           ? result.data.submission.status === 'draft' ? result.data.submission.version - 1 : result.data.submission.version : 0,
        hasUnsupportedExercise: getRepositoryMode() === 'cloudbase' && completionInputs.some(item => item.type === 'exercise' && !item.exerciseQuestion),
        hasUnreleasedMedia: hasUnreleasedMediaItem(result.data.task, getRepositoryMode() === 'cloudbase'),
        answer: retainInput ? this.data.answer : learningRecord,
      })
      try {
        await Promise.all([this.refreshReadingCompletion(), this.refreshVocabularyCompletion(),
          this.refreshTaskRecordings(), this.refreshMediaAvailability()])
        await this.refreshRecordingMediaStates()
      } catch (_error: unknown) {
        this.setData({ loading: false, error: '任务进度暂时无法核对，请重试' })
        return
      }
      if (getSession()?.sessionId !== session.sessionId || this.data.detail?.task.id !== taskId) return
      this.setData({ loading: false })
      if (refresh) void this.saveReturnedMediaProgress()
    },
    async refreshMediaAvailability() {
      const session = getSession(), detail = this.data.detail
      if (!session || !detail || this.data.teacherReviewMode || this.data.teacherPreviewMode) return
      const items = detail.task.items.filter(item => item.type === 'listening'
        || item.type === 'video' || item.type === 'dubbing')
      if (!items.length) { this.setData({ mediaAvailability: [], otherMediaAvailability: [] }); return }
      const rows = await Promise.all(items.map(async item => {
        const snapshot = item.mediaSnapshot
        if (!snapshot || snapshot.kind !== item.type) return { itemId: item.id, title: item.title,
          ready: false, hasSnapshot: false, progressFraction: 0, progressComplete: false,
          progressLabel: '媒体进度不可用',
          label: '任务媒体快照缺失，请联系老师处理' }
        const result = await getTaskMediaPlayback(session.user.id, detail.task.id, item.id)
        if (!result.ok) return { itemId: item.id, title: item.title, ready: false, hasSnapshot: true,
          progressFraction: 0, progressComplete: false, progressLabel: '待播放 · 答案待核对',
          label: '媒体播放服务尚未就绪，暂不可作答' }
        const playback = result.data
        const playbackReady = taskMediaPlaybackReady(snapshot, playback, Date.now())
        const confirmedMs = Number.isSafeInteger(playback.confirmedThroughMs)
          ? Math.max(0, Math.min(snapshot.durationMs, playback.confirmedThroughMs)) : 0
        const playbackFraction = item.type === 'video'
          ? Math.min(1, confirmedMs / Math.max(1, snapshot.durationMs * 0.9))
          : Math.min(1, confirmedMs / Math.max(1, snapshot.durationMs))
        const answers = { ...savedTaskMediaAnswers(detail, item.id, snapshot),
          ...readTaskMediaDraft(taskMediaDraftKey(session.sessionId, detail.task.id,
            detail.assignment.id, detail.assignment.redoCount, item.id, snapshot.mediaVersion)) }
        const answerCount = snapshot.kind === 'dubbing' ? 0 : snapshot.questionIds.filter(questionId => {
          const answer = answers[questionId]
          return typeof answer === 'string' ? Boolean(answer.trim())
            : Array.isArray(answer) && answer.some(value => typeof value === 'string' && value.trim())
        }).length
        const localFinalWorkId = snapshot.kind === 'dubbing'
          ? sealedTaskDubbingWorkId(readTaskDubbingLocalDraft(session.user.id,
            session.sessionId, detail.task.id, item.id, 0)?.work ?? null, detail.task.id,
            item.id, detail.assignment.redoCount + 1) : ''
        const cloudWork = snapshot.kind === 'dubbing' && !localFinalWorkId
          ? await findSubmittedTaskDubbingWork(session.user.id, detail.task.id,
            item.id, detail.assignment.redoCount + 1) : null
        if (cloudWork && !cloudWork.ok) return { itemId: item.id, title: item.title,
          ready: false, hasSnapshot: true, progressFraction: playbackFraction / 2,
          progressComplete: false, progressLabel: '配音状态待核对',
          label: '配音状态暂时无法核对，请稍后刷新' }
        const savedValue = detail.submission?.status === 'draft'
          ? detail.submission.answers.find(answer => answer.taskItemId === item.id)?.structuredValue : undefined
        const savedFinalWorkId = savedValue?.kind === 'dubbing' ? savedValue.finalWorkId : ''
        const finalWorkId = localFinalWorkId || (cloudWork?.ok ? cloudWork.data?.workId ?? '' : '') || savedFinalWorkId
        const answerFraction = snapshot.kind === 'dubbing'
          ? Number(Boolean(finalWorkId))
          : snapshot.questionIds.length ? answerCount / snapshot.questionIds.length : 1
        const complete = taskMediaPlaybackCompleted(snapshot, playback)
          && taskMediaAnswersComplete(snapshot, answers, finalWorkId)
        const percent = Math.round(playbackFraction * 100)
        const hasQuestions = snapshot.kind !== 'dubbing' && snapshot.questionIds.length > 0
        const progressLabel = complete ? '已完成'
          : snapshot.kind === 'dubbing'
            ? `${percent >= 100 ? '已播放' : `已播放 ${percent}%`} · ${answerFraction ? '配音已封存' : '待录制'}`
            : !hasQuestions ? `${snapshot.kind === 'video' ? '已播放' : '已听'} ${percent}%`
            : percent >= 100
              ? answerFraction === 0 ? '已听完 · 待作答'
                : answerFraction < 1 ? '已听完 · 作答中' : '已听完 · 待核对'
              : answerFraction > 0 ? `已听 ${percent}% · 已作答` : `已听 ${percent}%`
        const stateLabel = playbackReady ? '播放会话已就绪，请按顺序播放并完成作答'
          : playback.status === 'processing' ? '媒体仍在处理中，请稍后刷新'
            : playback.status === 'expired' ? '媒体地址已失效，请刷新任务'
              : playback.reason === 'SESSION_NOT_STARTED' ? '点击进入播放，系统会记录有效进度'
                : '媒体暂不可用，请联系老师处理'
        return { itemId: item.id, title: item.title, ready: playbackReady, hasSnapshot: true,
          progressFraction: mediaTaskProgressFraction(playbackFraction, answerFraction,
            snapshot.kind === 'dubbing' || snapshot.questionIds.length > 0, complete),
          progressComplete: complete, progressLabel, label: stateLabel }
      }))
      if (this.data.detail?.task.id !== detail.task.id
        || this.data.detail.task.version !== detail.task.version
        || this.data.detail.assignment.id !== detail.assignment.id
        || getSession()?.sessionId !== session.sessionId) return
      this.setData({ mediaAvailability: rows,
        otherMediaAvailability: rows.filter(row => detail.task.items.find(item => item.id === row.itemId)?.type !== 'listening') })
    },
    openTaskContent(event: WechatMiniprogram.TouchEvent) {
      const itemId = event.currentTarget.dataset.id as string
      const detail = this.data.detail
      const item = detail?.task.items.find(entry => entry.id === itemId)
      if (!detail || !item || this.data.teacherReviewMode || this.data.teacherPreviewMode) return
      if (item.type === 'reading') { if (item.resourceId) this.openReading(event); return }
      if (item.type === 'vocabulary') { if (item.resourceId) this.openVocabulary(event); return }
      const path = item.type === 'listening' ? '/subpackages/student-media/listening-task/listening-task'
        : item.type === 'video' ? '/subpackages/student-media/video-task/video-task'
          : item.type === 'dubbing' ? '/subpackages/student-media/dubbing/dubbing'
            : item.type === 'exercise' ? '/subpackages/student/exercise-task/exercise-task'
              : item.type === 'recording' ? '/subpackages/student-media/recording-task/recording-task' : ''
      if (!path) return
      wx.navigateTo({ url: `${path}?taskId=${encodeURIComponent(detail.task.id)}&itemId=${encodeURIComponent(itemId)}` })
    },
    async startTaskMediaSession(event: WechatMiniprogram.TouchEvent) {
      const itemId = event.currentTarget.dataset.id as string
      const detail = this.data.detail, session = getSession()
      const item = detail?.task.items.find(entry => entry.id === itemId)
      if (!detail || !session || !item || !item.mediaSnapshot || this.data.mediaStartBusyItemId
        || !this.data.mediaAvailability.some(row => row.itemId === itemId && row.hasSnapshot)
        || (session.activeRole ?? session.user.role) !== 'student') return
      const fingerprint = JSON.stringify({ taskId: detail.task.id, itemId,
        mediaVersion: item.mediaSnapshot.mediaVersion, assignmentId: detail.assignment.id })
      const intent = prepareWriteIntent(this.data.mediaStartIntents[itemId] ?? EMPTY_WRITE_INTENT,
        fingerprint, () => createPageOperationId('begin_task_media'))
      this.setData({ mediaStartBusyItemId: itemId, mediaStartError: '',
        mediaStartIntents: { ...this.data.mediaStartIntents, [itemId]: intent } })
      const result = await beginTaskMediaSession(session.user.id, detail.task.id, itemId, intent.operationId)
      if (this.data.detail?.task.id !== detail.task.id
        || this.data.detail.assignment.id !== detail.assignment.id) return
      if (!result.ok) {
        this.setData({ mediaStartBusyItemId: '',
          mediaStartError: `${item.title}：${result.error.message}；当前作答未改变` }); return
      }
      if (!taskMediaPlaybackReady(item.mediaSnapshot, result.data, Date.now())) {
        this.setData({ mediaStartBusyItemId: '',
          mediaStartError: `${item.title}：媒体会话仍不可播放，请稍后重试` }); return
      }
      const intents = { ...this.data.mediaStartIntents }
      delete intents[itemId]
      const taskWork = item.mediaSnapshot.kind === 'dubbing'
        ? readTaskDubbingLocalDraft(session.user.id, session.sessionId,
          detail.task.id, itemId, 0)?.work : null
      const finalWorkId = sealedTaskDubbingWorkId(taskWork ?? null,
        detail.task.id, itemId, detail.assignment.redoCount + 1)
      if (this.data.activeTaskMediaKind === 'video' || this.data.activeTaskMediaKind === 'dubbing') {
        wx.createVideoContext('task-media-video', this).pause()
      }
      activeTaskMediaAudio?.destroy(); activeTaskMediaAudio = null
      lastTaskMediaObservedMs = result.data.confirmedThroughMs
      lastTaskMediaObservedAt = Date.now()
      const answers = readTaskMediaDraft(taskMediaDraftKey(session.sessionId, detail.task.id,
        detail.assignment.id, detail.assignment.redoCount, itemId, item.mediaSnapshot.mediaVersion))
      this.setData({ mediaStartBusyItemId: '', mediaStartIntents: intents,
        mediaStartError: '', mediaAvailability: this.data.mediaAvailability.map(row => row.itemId === itemId
          ? { ...row, ready: true, label: '播放会话已准备；提交时会核对连续播放证据' } : row),
        activeTaskMediaItemId: itemId, activeTaskMediaKind: item.mediaSnapshot.kind,
        activeTaskMediaSnapshot: item.mediaSnapshot, activeTaskMediaPlayback: result.data,
        taskMediaPlaying: false, taskMediaEarMode: false,
        taskMediaSpeed: readLearningSpeed(session.user.id), taskMediaCurrentMs: result.data.confirmedThroughMs,
        taskMediaLastReportedMs: result.data.confirmedThroughMs,
        taskMediaConfirmedMs: result.data.confirmedThroughMs,
        taskMediaCurrentLabel: formatRecordingDuration(result.data.confirmedThroughMs),
        taskMediaDurationLabel: formatRecordingDuration(item.mediaSnapshot.durationMs),
        taskMediaSubtitle: '',
        taskMediaFinalWorkId: finalWorkId,
        taskMediaPositionPercent: Math.round(result.data.confirmedThroughMs * 100 / item.mediaSnapshot.durationMs),
        taskMediaConfirmedPercent: Math.round(result.data.confirmedThroughMs * 100 / item.mediaSnapshot.durationMs),
        taskMediaCompleted: false,
        taskMediaError: '', taskMediaWarning: '', taskMediaHeartbeatBusy: false,
        taskMediaPendingHeartbeat: null, taskMediaFinishPending: false,
        taskMediaPendingVideoSeekMs: null,
        taskMediaPendingVideoSeekAt: 0,
        activeTaskMediaAnswers: answers,
        activeTaskMediaQuestions: mediaQuestionRows(item.mediaSnapshot, answers),
        taskMediaDraftError: '' })
    },
    rememberTaskMediaAnswers(answers: MediaQuestionAnswers) {
      const detail = this.data.detail, session = getSession()
      const snapshot = this.data.activeTaskMediaSnapshot, itemId = this.data.activeTaskMediaItemId
      if (!detail || !session || !snapshot || !itemId || this.data.teacherPreviewMode) return
      const key = taskMediaDraftKey(session.sessionId, detail.task.id,
        detail.assignment.id, detail.assignment.redoCount, itemId, snapshot.mediaVersion)
      if (!writeTaskMediaDraft(key, answers)) {
        this.setData({ taskMediaDraftError: '本机持久保存失败，返回任务详情后请先同步作答' })
      }
    },
    chooseTaskMediaOption(event: WechatMiniprogram.TouchEvent) {
      const snapshot = this.data.activeTaskMediaSnapshot
      if (!snapshot || this.data.taskMediaEarMode || this.data.teacherReviewMode || this.data.teacherPreviewMode) return
      const questionId = event.currentTarget.dataset.questionId as string
      const value = event.currentTarget.dataset.value as string
      const question = snapshot.questions.find(item => item.questionId === questionId)
      if (!question || !question.options.includes(value)
        || (question.questionType !== 'single_choice' && question.questionType !== 'multiple_choice')) return
      const old = this.data.activeTaskMediaAnswers[questionId]
      const answer = question.questionType === 'single_choice' ? value
        : Array.isArray(old) ? old.includes(value) ? old.filter(item => item !== value)
          : [...old, value] : [value]
      const answers = { ...this.data.activeTaskMediaAnswers, [questionId]: answer }
      this.setData({ activeTaskMediaAnswers: answers,
        activeTaskMediaQuestions: mediaQuestionRows(snapshot, answers), taskMediaDraftError: '' })
      this.rememberTaskMediaAnswers(answers)
    },
    onTaskMediaTextAnswer(event: WechatMiniprogram.Input) {
      const snapshot = this.data.activeTaskMediaSnapshot
      if (!snapshot || this.data.taskMediaEarMode || this.data.teacherReviewMode || this.data.teacherPreviewMode) return
      const questionId = event.currentTarget.dataset.questionId as string
      const question = snapshot.questions.find(item => item.questionId === questionId)
      if (!question || (question.questionType !== 'fill' && question.questionType !== 'subjective')) return
      const answers = { ...this.data.activeTaskMediaAnswers, [questionId]: event.detail.value }
      this.setData({ activeTaskMediaAnswers: answers,
        activeTaskMediaQuestions: mediaQuestionRows(snapshot, answers), taskMediaDraftError: '' })
      this.rememberTaskMediaAnswers(answers)
    },
    pauseTaskMedia() {
      activeTaskMediaAudio?.pause()
      if (this.data.activeTaskMediaKind === 'video' || this.data.activeTaskMediaKind === 'dubbing') {
        wx.createVideoContext('task-media-video', this).pause()
      }
      this.setData({ taskMediaPlaying: false })
    },
    async refreshTaskMediaPlayback(): Promise<boolean> {
      const session = getSession(), detail = this.data.detail
      const snapshot = this.data.activeTaskMediaSnapshot, playback = this.data.activeTaskMediaPlayback
      const itemId = this.data.activeTaskMediaItemId
      if (!session || !detail || !snapshot || !playback || !itemId) return false
      if (Date.parse(playback.expiresAt ?? '') > Date.now() + 5000
        && taskMediaPlaybackReady(snapshot, playback, Date.now())) return true
      const refreshed = await getTaskMediaPlayback(session.user.id, detail.task.id, itemId)
      if (!refreshed.ok || !taskMediaPlaybackReady(snapshot, refreshed.data, Date.now())) {
        this.pauseTaskMedia()
        this.setData({ taskMediaError: '播放地址或会话已失效，请重新核对任务媒体' })
        return false
      }
      activeTaskMediaAudio?.destroy(); activeTaskMediaAudio = null
      const confirmedMs = refreshed.data.confirmedThroughMs
      this.setData({ activeTaskMediaPlayback: refreshed.data,
        taskMediaConfirmedMs: confirmedMs, taskMediaLastReportedMs: confirmedMs,
        taskMediaConfirmedPercent: Math.round(confirmedMs * 100 / snapshot.durationMs),
        taskMediaCurrentMs: Math.min(this.data.taskMediaCurrentMs, confirmedMs),
        taskMediaError: '' })
      return true
    },
    async toggleTaskMediaPlayback() {
      const snapshot = this.data.activeTaskMediaSnapshot
      if (!snapshot || this.data.taskMediaHeartbeatBusy) return
      if (this.data.taskMediaPlaying) { this.pauseTaskMedia(); return }
      if (this.data.taskMediaPendingHeartbeat) {
        this.setData({ taskMediaError: '播放证据尚未同步，请先重试' }); return
      }
      if (!await this.refreshTaskMediaPlayback()) return
      const playback = this.data.activeTaskMediaPlayback
      if (!playback?.temporaryUrl) return
      const replayFromStart = this.data.taskMediaCurrentMs >= snapshot.durationMs
        && this.data.taskMediaConfirmedMs >= snapshot.durationMs
      const startMs = replayFromStart ? 0
        : Math.min(this.data.taskMediaCurrentMs, this.data.taskMediaConfirmedMs)
      if (replayFromStart) this.setData({ taskMediaCurrentMs: 0,
        taskMediaCurrentLabel: '00:00', taskMediaPositionPercent: 0 })
      if (snapshot.kind === 'listening') {
        if (!activeTaskMediaAudio) {
          const audio = wx.createInnerAudioContext()
          activeTaskMediaAudio = audio
          audio.playbackRate = this.data.taskMediaSpeed
          audio.onCanplay(() => {
            if (activeTaskMediaAudio !== audio) return
            audio.seek(Math.min(this.data.taskMediaCurrentMs, this.data.taskMediaConfirmedMs) / 1000)
            this.setData({ taskMediaBuffering: false })
          })
          audio.onTimeUpdate(() => { if (activeTaskMediaAudio === audio) {
            this.observeTaskMediaPosition(Math.round(audio.currentTime * 1000)) } })
          audio.onWaiting(() => this.setData({ taskMediaBuffering: true }))
          audio.onError(() => { if (activeTaskMediaAudio !== audio) return
            audio.destroy(); activeTaskMediaAudio = null
            this.setData({ taskMediaPlaying: false, taskMediaBuffering: false,
              taskMediaError: '音频播放失败，已保留服务端确认位置' }) })
          audio.onEnded(() => { if (activeTaskMediaAudio === audio) this.finishTaskMediaPlayback() })
          audio.src = playback.temporaryUrl
        }
        activeTaskMediaAudio.seek(startMs / 1000)
        activeTaskMediaAudio.play()
      } else {
        const video = wx.createVideoContext('task-media-video', this)
        const speed = nativeVideoSpeed(this.data.taskMediaSpeed)
        if (speed.fallback) { this.setData({ taskMediaSpeed: 1 });
          wx.showToast({ title: '视频不支持 0.75 倍，已使用 1 倍', icon: 'none' }) }
        video.playbackRate(speed.speed)
        const targetMs = startMs
        this.setData({ taskMediaPendingVideoSeekMs: targetMs,
          taskMediaPendingVideoSeekAt: Date.now() })
        video.seek(targetMs / 1000)
        video.play()
      }
      lastTaskMediaObservedMs = startMs
      lastTaskMediaObservedAt = Date.now()
      this.setData({ taskMediaPlaying: true, taskMediaError: '', taskMediaWarning: '' })
    },
    onTaskVideoPlay() { this.setData({ taskMediaPlaying: true, taskMediaBuffering: false });
      lastTaskMediaObservedMs = this.data.taskMediaCurrentMs; lastTaskMediaObservedAt = Date.now() },
    onTaskVideoPause() { this.setData({ taskMediaPlaying: false }) },
    onTaskVideoError() { this.pauseTaskMedia(); this.setData({ taskMediaError: '视频播放失败，已保留已确认进度' }) },
    onTaskVideoEnded() { this.finishTaskMediaPlayback() },
    finishTaskMediaPlayback() {
      const snapshot = this.data.activeTaskMediaSnapshot
      if (!snapshot || !this.data.activeTaskMediaPlayback?.sessionId) return
      this.pauseTaskMedia()
      this.setData({ taskMediaCurrentMs: snapshot.durationMs,
        taskMediaCurrentLabel: formatRecordingDuration(snapshot.durationMs),
        taskMediaPositionPercent: 100, taskMediaClipEndMs: 0,
        taskMediaFinishPending: true })
      void this.flushTaskMediaCompletion()
    },
    async flushTaskMediaCompletion() {
      const snapshot = this.data.activeTaskMediaSnapshot
      const playback = this.data.activeTaskMediaPlayback
      if (!this.data.taskMediaFinishPending || !snapshot || !playback?.sessionId
        || this.data.taskMediaHeartbeatBusy || this.data.taskMediaPendingHeartbeat) return
      if (this.data.taskMediaLastReportedMs >= snapshot.durationMs) {
        this.setData({ taskMediaFinishPending: false })
        return
      }
      this.setData({ taskMediaFinishPending: false })
      await this.sendTaskMediaHeartbeat({ sessionId: playback.sessionId,
        playedFromMs: this.data.taskMediaLastReportedMs,
        playedToMs: snapshot.durationMs, positionMs: snapshot.durationMs,
        operationId: createPageOperationId('task_media_finish') })
    },
    onTaskVideoTimeUpdate(event: WechatMiniprogram.CustomEvent<{ currentTime: number }>) {
      if (this.data.activeTaskMediaKind === 'video' || this.data.activeTaskMediaKind === 'dubbing') {
        const currentMs = Math.round(event.detail.currentTime * 1000)
        const pending = this.data.taskMediaPendingVideoSeekMs
        if (pending !== null) {
          if (Math.abs(currentMs - pending) > 750
            && Date.now() - this.data.taskMediaPendingVideoSeekAt < 3000) return
          this.setData({ taskMediaPendingVideoSeekMs: null, taskMediaPendingVideoSeekAt: 0 })
          lastTaskMediaObservedMs = currentMs
          lastTaskMediaObservedAt = Date.now()
        }
        this.observeTaskMediaPosition(currentMs)
      }
    },
    observeTaskMediaPosition(positionMs: number) {
      const snapshot = this.data.activeTaskMediaSnapshot
      if (!snapshot || !this.data.taskMediaPlaying || !Number.isSafeInteger(positionMs)) return
      const currentMs = Math.max(0, Math.min(snapshot.durationMs, positionMs))
      const now = Date.now()
      if (lastTaskMediaObservedAt > 0 && currentMs - lastTaskMediaObservedMs
        > Math.max(0, now - lastTaskMediaObservedAt) * 2 + 1500
        && currentMs > this.data.taskMediaConfirmedMs) {
        this.pauseTaskMedia()
        this.setData({ taskMediaWarning: '任务需按顺序播放，已回到服务端确认位置' })
        this.seekTaskMediaTo(this.data.taskMediaConfirmedMs)
        return
      }
      lastTaskMediaObservedMs = currentMs
      lastTaskMediaObservedAt = now
      this.setData({ taskMediaCurrentMs: currentMs,
        taskMediaCurrentLabel: formatRecordingDuration(currentMs),
        taskMediaPositionPercent: Math.round(currentMs * 100 / snapshot.durationMs) })
      if ((snapshot.kind === 'video' || snapshot.kind === 'dubbing') && !this.data.taskMediaEarMode) {
        const subtitle = snapshot.subtitleCues?.find(cue => cue.startMs <= currentMs
          && cue.endMs > currentMs)?.text ?? ''
        if (subtitle !== this.data.taskMediaSubtitle) this.setData({ taskMediaSubtitle: subtitle })
      }
      if (this.data.taskMediaClipEndMs && currentMs >= this.data.taskMediaClipEndMs) {
        this.pauseTaskMedia(); this.setData({ taskMediaClipEndMs: 0 })
      }
      if (!this.data.taskMediaHeartbeatBusy && !this.data.taskMediaPendingHeartbeat
        && currentMs - this.data.taskMediaLastReportedMs >= 2000) {
        const playback = this.data.activeTaskMediaPlayback
        if (!playback?.sessionId) return
        void this.sendTaskMediaHeartbeat({ sessionId: playback.sessionId,
          playedFromMs: this.data.taskMediaLastReportedMs, playedToMs: currentMs,
          positionMs: currentMs, operationId: createPageOperationId('task_media_heartbeat') })
      }
    },
    async sendTaskMediaHeartbeat(pending: PendingTaskMediaHeartbeat) {
      const session = getSession(), snapshot = this.data.activeTaskMediaSnapshot
      if (!session || !snapshot || this.data.taskMediaHeartbeatBusy) return
      this.setData({ taskMediaHeartbeatBusy: true, taskMediaPendingHeartbeat: pending })
      const result = await reportTaskMediaHeartbeat(session.user.id, pending.sessionId,
        pending.playedFromMs, pending.playedToMs, pending.positionMs, pending.operationId)
      if (this.data.activeTaskMediaPlayback?.sessionId !== pending.sessionId) return
      if (!result.ok || result.data.sessionId !== pending.sessionId
        || !Number.isSafeInteger(result.data.confirmedThroughMs)
        || result.data.confirmedThroughMs < this.data.taskMediaConfirmedMs
        || result.data.confirmedThroughMs > snapshot.durationMs) {
        this.pauseTaskMedia()
        this.setData({ taskMediaHeartbeatBusy: false,
          taskMediaError: '播放进度同步失败，当前作答已保留；请重试',
          taskMediaPendingHeartbeat: pending })
        return
      }
      const confirmedMs = result.data.confirmedThroughMs
      this.setData({ taskMediaHeartbeatBusy: false, taskMediaPendingHeartbeat: null,
        taskMediaConfirmedMs: confirmedMs, taskMediaLastReportedMs: confirmedMs,
        taskMediaCompleted: result.data.completed === true,
        taskMediaConfirmedPercent: Math.round(confirmedMs * 100 / snapshot.durationMs),
        activeTaskMediaPlayback: { ...this.data.activeTaskMediaPlayback,
          confirmedThroughMs: confirmedMs }, taskMediaError: '' })
      if (this.data.taskMediaFinishPending) void this.flushTaskMediaCompletion()
    },
    seekTaskMediaTo(positionMs: number) {
      const seconds = Math.max(0, positionMs / 1000)
      if (this.data.activeTaskMediaKind === 'listening') activeTaskMediaAudio?.seek(seconds)
      else {
        this.setData({ taskMediaPendingVideoSeekMs: positionMs,
          taskMediaPendingVideoSeekAt: Date.now() })
        wx.createVideoContext('task-media-video', this).seek(seconds)
      }
      const duration = this.data.activeTaskMediaSnapshot?.durationMs ?? 1
      this.setData({ taskMediaCurrentMs: positionMs,
        taskMediaCurrentLabel: formatRecordingDuration(positionMs),
        taskMediaPositionPercent: Math.round(positionMs * 100 / duration) })
      lastTaskMediaObservedMs = positionMs; lastTaskMediaObservedAt = Date.now()
    },
    seekTaskMedia(event: WechatMiniprogram.CustomEvent<{ percent: number }>) {
      const snapshot = this.data.activeTaskMediaSnapshot, playback = this.data.activeTaskMediaPlayback
      if (!snapshot || !playback) return
      const requestedMs = snapshot.durationMs * event.detail.percent / 100
      const targetMs = taskMediaSeekTarget(requestedMs, snapshot, playback)
      if (targetMs < requestedMs) this.setData({ taskMediaWarning: '任务需按顺序播放，已回到服务端确认位置' })
      this.seekTaskMediaTo(targetMs)
    },
    blockTaskMediaSeek() { this.setData({ taskMediaWarning: '任务需按顺序播放，未验证区间不可跳播' }) },
    toggleTaskMediaEarMode() { this.setData({ taskMediaEarMode: !this.data.taskMediaEarMode,
      taskMediaSubtitle: '' }) },
    chooseTaskMediaSpeed() {
      wx.showActionSheet({ itemList: LEARNING_SPEEDS.map(speed =>
        `${speed === 1 || speed === 2 ? speed.toFixed(1) : speed}×`), success: result => {
        const selected = LEARNING_SPEEDS[result.tapIndex]
        if (!selected) return
        const videoSpeed = this.data.activeTaskMediaKind === 'listening'
          ? { speed: selected, fallback: false } : nativeVideoSpeed(selected)
        const speed = videoSpeed.speed
        try {
          if (this.data.activeTaskMediaKind === 'listening') {
            if (activeTaskMediaAudio) activeTaskMediaAudio.playbackRate = speed
          } else wx.createVideoContext('task-media-video', this).playbackRate(speed)
        } catch (_error: unknown) {
          this.setData({ taskMediaError: '当前设备无法切换倍速，已保留原播放状态' }); return
        }
        this.setData({ taskMediaSpeed: speed })
        const session = getSession()
        if (session) saveLearningSpeed(session.user.id, speed)
        if (videoSpeed.fallback) wx.showToast({ title: '视频不支持 0.75 倍，已使用 1 倍', icon: 'none' })
      } })
    },
    async retryTaskMedia() {
      const pending = this.data.taskMediaPendingHeartbeat
      if (pending) { await this.sendTaskMediaHeartbeat(pending); return }
      if (await this.refreshTaskMediaPlayback()) this.setData({ taskMediaError: '' })
    },
    playTaskMediaClip(event: WechatMiniprogram.TouchEvent) {
      const questionId = event.currentTarget.dataset.id as string
      const snapshot = this.data.activeTaskMediaSnapshot, playback = this.data.activeTaskMediaPlayback
      if (!snapshot || !playback || snapshot.kind !== 'listening') return
      const clip = snapshot.clips.find(item => item.questionId === questionId)
      if (!clip) { this.setData({ taskMediaError: '本题缺少已审核音频片段' }); return }
      if (clip.startMs > playback.confirmedThroughMs) {
        this.setData({ taskMediaError: '请先顺序播放到本题，再重听该片段' }); return
      }
      this.seekTaskMediaTo(clip.startMs)
      this.setData({ taskMediaClipEndMs: clip.endMs }, () => { if (!this.data.taskMediaPlaying) {
        void this.toggleTaskMediaPlayback() } })
    },
    openTaskDubbing() {
      const detail = this.data.detail, snapshot = this.data.activeTaskMediaSnapshot,
        playback = this.data.activeTaskMediaPlayback
      if (!detail || !snapshot || snapshot.kind !== 'dubbing' || !playback
        || !this.data.activeTaskMediaItemId) return
      if (playback.confirmedThroughMs < snapshot.durationMs) {
        this.setData({ taskMediaWarning: '请先顺序播放完整示范视频，再录制任务配音' }); return
      }
      this.pauseTaskMedia()
      wx.navigateTo({ url: `/subpackages/student-media/dubbing/dubbing?taskId=${encodeURIComponent(detail.task.id)}`
        + `&itemId=${encodeURIComponent(this.data.activeTaskMediaItemId)}` })
    },
    jumpToFirstIncomplete() {
      const detail = this.data.detail
      if (!detail) return
      const progress = taskProgress(this.data.completionInputs, detail.assignment.status)
      const itemId = firstIncompleteTaskItemId(detail.task, this.data.completionInputs, progress.byItem)
      const index = detail.task.items.findIndex(item => item.id === itemId)
      if (index < 0) { wx.showToast({ title: '任务项已完成，请核对后提交', icon: 'none' }); return }
      this.scrollToTaskItem(index)
    },
    scrollToTaskItem(index: number) {
      const detail = this.data.detail
      if (!detail || !Number.isInteger(index) || index < 0 || index >= detail.task.items.length) return
      const item = detail.task.items[index]
      if (item.type === 'exercise') {
        const groupKey = taskExerciseGroupKey(item)
        const firstId = detail.task.items.find(candidate => candidate.type === 'exercise'
          && taskExerciseGroupKey(candidate) === groupKey)?.id ?? item.id
        const visibleIndex = this.data.requirementItems.findIndex(requirement => requirement.id === firstId)
        wx.pageScrollTo({ selector: `#requirement-item-${Math.max(0, visibleIndex)}`, duration: 250 })
        return
      }
      const answerHere = this.data.editable && (item.type === 'recording' || !item.resourceId)
      wx.pageScrollTo({ selector: `#${answerHere ? 'answer' : 'requirement'}-item-${index}`, duration: 250 })
    },
    async refreshTaskReadingProof() {
      const session = getSession()
      const taskId = this.data.detail?.task.id
      if (!session || !taskId || !this.data.completionInputs.some(item => item.type === 'reading' && item.pageIds)) return
      const result = await getTaskDetail(session.user.id, taskId)
      if (this.data.detail?.task.id !== taskId) return
      if (!result.ok || !result.data.readingPageProgress) {
        this.setData({ selectedReadingSyncError: result.ok ? '阅读页进度暂未返回，请重试同步' : result.error.message })
        return
      }
      const counts = new Map(result.data.readingPageProgress.map(item => [item.itemId, item.completedPageCount]))
      this.setData({ selectedReadingSyncError: '', completionInputs: this.data.completionInputs.map(item =>
        item.type === 'reading' && item.pageIds ? { ...item,
          completedPageCount: String(counts.get(item.itemId) ?? 0),
          readingVerified: (counts.get(item.itemId) ?? 0) >= item.requiredCount } : item) })
    },
    async refreshRecordingMediaStates() {
      const session = getSession()
      const taskId = this.data.detail?.task.id
      if (!session || !taskId) return
      const recordingItems = this.data.completionInputs.filter(item => item.type === 'recording' && item.recordingId)
      const states = await Promise.all(recordingItems.map(async item => ({ itemId: item.itemId,
        recordingId: item.recordingId,
        result: await getTaskRecordingMediaState(session.user.id, item.recordingId) })))
      if (this.data.detail?.task.id !== taskId) return
      const byItem = new Map(states.map(item => [item.itemId, item]))
      this.setData({ completionInputs: this.data.completionInputs.map(item => {
        const state = byItem.get(item.itemId)
        if (!state || state.recordingId !== item.recordingId) return item
        return { ...item, recordingMediaAvailable: state.result.ok && !state.result.data.mediaExpired,
          recordingMediaExpired: state.result.ok && state.result.data.mediaExpired }
      }) })
    },
    refreshRedoWindow() {
      const detail = this.data.detail
      if (!detail) return
      const availability = taskWriteAvailability(detail.task, detail.assignment, new Date().toISOString(), getRepositoryMode() === 'memory')
      const redoWindow = detail.assignment.status === 'redo_required' || Boolean(detail.assignment.redoDueAt)
      this.setData({ redoExpired: redoWindow && !availability.editable, editable: availability.editable,
        writeUnavailableReason: availability.reason, writeTimingLabel: availability.timingLabel })
    },
    canEditCurrentRedo(): boolean {
      const detail = this.data.detail
      if (!detail) return false
      const availability = taskWriteAvailability(detail.task, detail.assignment, new Date().toISOString(), getRepositoryMode() === 'memory')
      this.setData({ editable: availability.editable, writeUnavailableReason: availability.reason,
        writeTimingLabel: availability.timingLabel })
      if (!availability.editable) this.setData({ writeError: availability.reason })
      return availability.editable
    },
    async refreshReadingCompletion() {
      const session = getSession()
      if (!session || !this.data.detail) return
      const readingItems = this.data.completionInputs.filter(item => item.type === 'reading' && item.resourceId && !item.pageIds)
      if (!readingItems.length) return
      const progress = await Promise.all(readingItems.map(async item => ({ itemId: item.itemId, result: await getReadingProgress(session.user.id, item.resourceId!) })))
      const pageCounts = new Map(progress.flatMap(item => item.result.ok && item.result.data.hasSavedProgress ? [[item.itemId, item.result.data.pageNumber] as const] : []))
      this.setData({ readingSyncError: progress.some(item => !item.result.ok) ? '阅读进度同步失败，已保留当前内容' : '', completionInputs: this.data.completionInputs.map(item => {
        if (item.type !== 'reading' || !item.resourceId || item.pageIds) return item
        const pageNumber = pageCounts.get(item.itemId)
        return pageNumber === undefined ? { ...item, readingVerified: false } : { ...item, completedPageCount: String(Math.min(pageNumber, item.requiredCount)), readingVerified: true }
      }) })
    },
    async refreshVocabularyCompletion() {
      const session = getSession()
      if (!session || !this.data.detail) return
      if (!this.data.editable) return
      const vocabularyItems = this.data.completionInputs.filter(item => item.type === 'vocabulary' && item.resourceId)
      if (!vocabularyItems.length) return
      if (getRepositoryMode() === 'cloudbase') {
        const taskId = this.data.detail.task.id
        const verified = await Promise.all(vocabularyItems.map(async item => {
          const taskItem = this.data.detail?.task.items.find(candidate => candidate.id === item.itemId)
          if (taskItem?.snapshotSchemaVersion === 2) {
            const wordIds = taskItem.vocabularyWordIds
            if (!wordIds?.length) return { itemId: item.itemId, completed: null, correct: null }
            const summary = await getPackAttemptSummary(session.user.id, { packId: item.resourceId!, taskId, itemId: item.itemId })
            if (!summary.ok || summary.data.words.length !== wordIds.length
              || !wordIds.every(wordId => summary.data.words.some(word => word.wordId === wordId))) {
              return { itemId: item.itemId, completed: null, correct: null }
            }
            return { itemId: item.itemId,
              completed: summary.data.words.filter(word => word.firstCorrect !== null).length,
              correct: summary.data.words.filter(word => word.firstCorrect === true).length }
          }
          const old = await getVocabularyProgress(session.user.id, item.resourceId!)
          return old.ok && old.data
            ? { itemId: item.itemId, completed: old.data.completedCount, correct: old.data.correctCount }
            : { itemId: item.itemId, completed: null, correct: null }
        }))
        const counts = new Map(verified.map(item => [item.itemId, item] as const))
        this.setData({ vocabularySyncError: verified.some(item => item.completed === null) ? '单词进度同步失败，请重试' : '',
          completionInputs: this.data.completionInputs.map(item => {
            if (item.type !== 'vocabulary' || !item.resourceId) return item
            const count = counts.get(item.itemId)
            return count?.completed === null || count?.completed === undefined || count.correct === null
              ? { ...item, completedWordCount: '', correctWordCount: '', vocabularyVerified: false }
              : { ...item, completedWordCount: String(count.completed), correctWordCount: String(count.correct), vocabularyVerified: true }
          }) })
        return
      }
      const progress = await Promise.all(vocabularyItems.map(async item => ({ itemId: item.itemId, result: await getVocabularyProgress(session.user.id, item.resourceId!) })))
      const counts = new Map(progress.flatMap(item => item.result.ok && item.result.data
        ? [[item.itemId, { completed: item.result.data.completedCount, correct: item.result.data.correctCount }] as const] : []))
      this.setData({ vocabularySyncError: progress.some(item => !item.result.ok) ? '单词进度同步失败，请重试' : '',
        completionInputs: this.data.completionInputs.map(item => {
          if (item.type !== 'vocabulary' || !item.resourceId) return item
          const count = counts.get(item.itemId)
          return count === undefined
            ? { ...item, completedWordCount: '', correctWordCount: '', vocabularyVerified: false }
            : { ...item, completedWordCount: String(count.completed), correctWordCount: String(count.correct), vocabularyVerified: true }
        }) })
    },
    async refreshTaskRecordings() {
      const session = getSession()
      const taskId = this.data.detail?.task.id
      if (!session || !taskId || !this.data.editable) return
      const currentSubmissionVersion = this.data.detail?.submission?.status === 'draft'
        ? this.data.detail.submission.version : (this.data.detail?.submission?.version ?? 0) + 1
      const recordingItems = this.data.completionInputs.filter(item => item.type === 'recording')
      if (!recordingItems.length) return
      const results = await Promise.all(recordingItems.map(async item => ({ itemId: item.itemId,
        result: await listTaskRecordings(session.user.id, taskId, item.itemId) })))
      if (this.data.detail?.task.id !== taskId) return
      const drafts = { ...this.data.recordingDrafts }
      const submitted = new Map<string, TaskRecordingView>()
      for (const entry of results) {
        if (!entry.result.ok) continue
        const ordered = entry.result.data.filter(recording => recording.submissionVersion === currentSubmissionVersion)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        const latestDraft = ordered.find(recording => recording.status === 'draft')
        const latestSubmitted = ordered.find(recording => recording.status === 'submitted')
        if (latestDraft) drafts[entry.itemId] = latestDraft
        if (latestSubmitted) submitted.set(entry.itemId, latestSubmitted)
      }
      this.setData({ recordingDrafts: drafts,
        recordingError: results.some(entry => !entry.result.ok)
          ? '录音进度同步失败，已保留当前内容；可稍后重试' : this.data.recordingError,
        completionInputs: this.data.completionInputs.map(item => {
          const recording = submitted.get(item.itemId)
          if (!recording || item.type !== 'recording' || item.localRecordingPath || item.recordingId) return item
          return { ...item, recordingId: recording.id, recordingState: 'submitted' as const,
            recordingMediaAvailable: !recording.mediaExpired, recordingMediaExpired: Boolean(recording.mediaExpired),
            recordingDurationMs: recording.durationMs ?? 0,
            recordingElapsedLabel: formatRecordingDuration(recording.durationMs ?? 0),
            recordingSizeBytes: recording.sizeBytes ?? 0 }
        }) })
    },
    openVocabulary(event: WechatMiniprogram.TouchEvent) {
      if (getRepositoryMode() === 'cloudbase' && !this.data.editable) {
        wx.showToast({ title: '任务已提交，请查看本次结果', icon: 'none' }); return
      }
      const item = this.data.detail?.task.items.find(candidate => candidate.id === event.currentTarget.dataset.id)
      if (!item?.resourceId) { wx.showToast({ title: '单词资源暂不可用', icon: 'none' }); return }
      const taskId = this.data.detail?.task.id ?? ''
      wx.navigateTo({ url: `/subpackages/student/vocabulary/vocabulary?packId=${encodeURIComponent(item.resourceId)}&taskId=${encodeURIComponent(taskId)}&itemId=${encodeURIComponent(item.id)}` })
    },
    openReading(event: WechatMiniprogram.TouchEvent) {
      const itemId = event.currentTarget.dataset.id as string
      const item = this.data.detail?.task.items.find(candidate => candidate.id === itemId)
      if (!item?.resourceId) { wx.showToast({ title: '阅读资源暂不可用', icon: 'none' }); return }
      const taskId = this.data.detail?.task.id ?? ''
      const requiredCount = item.completionRuleData?.kind === 'reading_pages' ? item.completionRuleData.requiredPageCount : 0
      setCurrentBookId(item.resourceId)
      const startPage = item.readingPageNumbers?.[0]
      wx.navigateTo({ url: `/subpackages/student/reading-detail/reading-detail?bookId=${encodeURIComponent(item.resourceId)}&taskId=${encodeURIComponent(taskId)}&itemId=${encodeURIComponent(item.id)}&requiredPageCount=${requiredCount}${startPage ? `&startPageNumber=${startPage}` : ''}` })
    },
    onAnswer(event: WechatMiniprogram.Input) {
      this.setData({ answer: event.detail.value, draftIntent: clearWriteIntent(), submitIntent: clearWriteIntent() })
    },
    onCompletionInput(event: WechatMiniprogram.Input) {
      const itemId = event.currentTarget.dataset.id as string
      if (this.data.completionInputs.some(item => item.itemId === itemId && item.resourceId
        && (item.type === 'reading' || item.type === 'vocabulary'))) return
      const field = event.currentTarget.dataset.field as keyof Pick<CompletionInput, 'completedPageCount' | 'completedWordCount' | 'correctWordCount' | 'answeredQuestionCount'>
      this.setData({
        completionInputs: this.data.completionInputs.map(item => item.itemId === itemId ? { ...item, [field]: event.detail.value } : item),
        draftIntent: clearWriteIntent(),
        submitIntent: clearWriteIntent(),
      })
    },
    onExerciseResponse(event: WechatMiniprogram.Input) {
      const itemId = event.currentTarget.dataset.id as string
      this.setData({ completionInputs: this.data.completionInputs.map(item => item.itemId === itemId
        ? { ...item, exerciseResponse: event.detail.value } : item),
      draftIntent: clearWriteIntent(), submitIntent: clearWriteIntent() })
    },
    chooseExerciseOption(event: WechatMiniprogram.TouchEvent) {
      const itemId = event.currentTarget.dataset.id as string
      const value = event.currentTarget.dataset.value as string
      this.setData({ completionInputs: this.data.completionInputs.map(item => {
        if (item.itemId !== itemId || !item.exerciseQuestion || !item.exerciseQuestion.options.includes(value)) return item
        const multiple = item.exerciseQuestion.questionType === 'multiple_choice'
        const selected = multiple
          ? item.exerciseSelectedOptions.includes(value) ? item.exerciseSelectedOptions.filter(option => option !== value) : [...item.exerciseSelectedOptions, value]
          : []
        const response = multiple ? '' : value
        return { ...item, exerciseSelectedOptions: selected, exerciseResponse: response,
          exerciseChoices: item.exerciseChoices.map(choice => ({ ...choice, selected: multiple ? selected.includes(choice.value) : response === choice.value })) }
      }), draftIntent: clearWriteIntent(), submitIntent: clearWriteIntent() })
    },
    async startRecording(event: WechatMiniprogram.TouchEvent) {
      const itemId = event.currentTarget.dataset.id as string
      const item = this.data.completionInputs.find(candidate => candidate.itemId === itemId && candidate.type === 'recording')
      if (!item || !this.data.editable || this.data.activeRecordingItemId || this.data.submitting
        || item.recordingState === 'uploading') return
      if (getRepositoryMode() !== 'cloudbase') {
        this.setData({ recordingError: '录音任务需要可信云端服务，当前演示模式不可录制提交' }); return
      }
      try { await wx.authorize({ scope: 'scope.record' }) }
      catch (_error: unknown) { this.setData({ recordingError: '请在微信设置中允许使用麦克风后重试' }); return }
      this.setData({ activeRecordingItemId: itemId, recordingError: '',
        completionInputs: this.data.completionInputs.map(candidate => candidate.itemId === itemId
          ? { ...candidate, recordingState: 'recording' as const, recordingElapsedLabel: '00:00' } : candidate) })
      try {
        getTaskRecorder().start({ duration: 300000, sampleRate: 16000, encodeBitRate: 64000,
          numberOfChannels: 1, format: 'mp3' })
        stopTaskRecordingTimer()
        taskRecordingStartedAtMs = Date.now()
        taskRecordingTimer = setInterval(() => {
          if (this.data.activeRecordingItemId !== itemId || taskRecordingStartedAtMs === null) {
            stopTaskRecordingTimer()
            return
          }
          const label = formatRecordingDuration(Math.min(300000, Date.now() - taskRecordingStartedAtMs))
          const current = this.data.completionInputs.find(candidate => candidate.itemId === itemId)
          if (current?.recordingElapsedLabel !== label) this.setData({
            completionInputs: this.data.completionInputs.map(candidate => candidate.itemId === itemId
              ? { ...candidate, recordingElapsedLabel: label } : candidate),
          })
        }, 250)
      } catch (_error: unknown) {
        stopTaskRecordingTimer()
        this.setData({ activeRecordingItemId: '', recordingError: '录音未能开始，请重试',
          completionInputs: this.data.completionInputs.map(candidate => candidate.itemId === itemId
            ? { ...candidate, recordingState: 'idle' as const, recordingElapsedLabel: '00:00' } : candidate) })
      }
    },
    stopRecording() { if (this.data.activeRecordingItemId) { stopTaskRecordingTimer(); getTaskRecorder().stop() } },
    onRecordingStopped(result: RecorderStop) {
      const itemId = this.data.activeRecordingItemId
      if (!itemId) return
      stopTaskRecordingTimer()
      const recordingIssue = recordingMediaIssue(result.duration, result.fileSize, result.tempFilePath)
      this.setData({ activeRecordingItemId: '',
        recordingError: recordingIssue,
        completionInputs: this.data.completionInputs.map(item => item.itemId === itemId ? {
          ...item, recordingState: result.tempFilePath ? recordingIssue ? 'invalid' as const : 'local' as const : 'idle' as const,
          localRecordingPath: result.tempFilePath,
          recordingDurationMs: result.duration, recordingSizeBytes: result.fileSize, recordingId: '',
          recordingElapsedLabel: formatRecordingDuration(result.duration),
          recordingMediaAvailable: false, recordingMediaExpired: false,
        } : item), draftIntent: clearWriteIntent(), submitIntent: clearWriteIntent() })
    },
    onRecordingFailed() {
      const itemId = this.data.activeRecordingItemId
      if (!itemId) return
      stopTaskRecordingTimer()
      this.setData({ activeRecordingItemId: '', recordingError: '录音失败，请重试',
        completionInputs: this.data.completionInputs.map(item => item.itemId === itemId
          ? { ...item, recordingState: 'idle' as const, recordingElapsedLabel: '00:00' } : item) })
    },
    playLocalRecording(event: WechatMiniprogram.TouchEvent) {
      const item = this.data.completionInputs.find(candidate => candidate.itemId === event.currentTarget.dataset.id)
      if (!item?.localRecordingPath) return
      const audio = wx.createInnerAudioContext()
      audio.src = item.localRecordingPath
      audio.onEnded(() => audio.destroy())
      audio.onError(() => { audio.destroy(); wx.showToast({ title: '试听失败，请重试', icon: 'none' }) })
      audio.play()
    },
    async playSubmittedRecording(event: WechatMiniprogram.TouchEvent) {
      const session = getSession()
      const item = this.data.completionInputs.find(candidate => candidate.itemId === event.currentTarget.dataset.id)
      if (!session || !item?.recordingId || !item.recordingMediaAvailable) return
      const result = await getTaskRecordingPlayback(session.user.id, item.recordingId)
      if (!result.ok) { this.setData({ recordingError: result.error.message }); return }
      const audio = wx.createInnerAudioContext()
      audio.src = result.data.temporaryUrl
      audio.onEnded(() => audio.destroy())
      audio.onError(() => { audio.destroy(); wx.showToast({ title: '试听失败，请重试', icon: 'none' }) })
      audio.play()
    },
    redoRecording(event: WechatMiniprogram.TouchEvent) {
      const itemId = event.currentTarget.dataset.id as string
      if (!this.data.editable || this.data.activeRecordingItemId) return
      wx.showModal({ title: '重新录制？', content: '本页当前录音将替换为新录音，已提交的历史版本保留。',
        confirmText: '重录', success: answer => {
          if (!answer.confirm) return
          this.setData({ recordingError: '',
            completionInputs: this.data.completionInputs.map(item => item.itemId === itemId ? {
              ...item, localRecordingPath: '', recordingDurationMs: 0, recordingElapsedLabel: '00:00', recordingSizeBytes: 0,
              recordingId: '', recordingState: 'idle' as const,
              recordingMediaAvailable: false, recordingMediaExpired: false,
            } : item),
            recordingDrafts: { ...this.data.recordingDrafts, [itemId]: undefined },
            recordingBeginIntents: { ...this.data.recordingBeginIntents, [itemId]: clearWriteIntent() },
            recordingSubmitIntents: { ...this.data.recordingSubmitIntents, [itemId]: clearWriteIntent() },
            draftIntent: clearWriteIntent(), submitIntent: clearWriteIntent() })
        } })
    },
    async uploadRecording(event: WechatMiniprogram.TouchEvent) {
      const itemId = event.currentTarget.dataset.id as string
      const item = this.data.completionInputs.find(candidate => candidate.itemId === itemId && candidate.type === 'recording')
      const session = getSession()
      const taskId = this.data.detail?.task.id
      if (!session || !taskId || !item || !this.data.editable || item.recordingState !== 'local'
        || !item.localRecordingPath || this.data.activeRecordingItemId) return
      const recordingIssue = recordingMediaIssue(item.recordingDurationMs, item.recordingSizeBytes,
        item.localRecordingPath)
      if (recordingIssue) { this.recordingUploadFailed(itemId, recordingIssue, true); return }
      this.setData({ recordingError: '', completionInputs: this.data.completionInputs.map(candidate =>
        candidate.itemId === itemId ? { ...candidate, recordingState: 'uploading' as const } : candidate) })
      let draft = this.data.recordingDrafts[itemId]
      if (!draft || draft.status !== 'draft') {
        const beginIntent = prepareWriteIntent(this.data.recordingBeginIntents[itemId] ?? EMPTY_WRITE_INTENT,
          `${taskId}:${itemId}`, () => createPageOperationId('begin_task_recording'))
        this.setData({ recordingBeginIntents: { ...this.data.recordingBeginIntents, [itemId]: beginIntent } })
        const begun = await beginTaskRecording(session.user.id, taskId, itemId, beginIntent.operationId)
        if (!begun.ok) { this.recordingUploadFailed(itemId, begun.error.message); return }
        draft = begun.data
        this.setData({ recordingDrafts: { ...this.data.recordingDrafts, [itemId]: draft },
          recordingBeginIntents: { ...this.data.recordingBeginIntents, [itemId]: clearWriteIntent() } })
      }
      let stagingFileId: string
      try { stagingFileId = (await wx.cloud.uploadFile({ cloudPath: draft.stagingPath,
        filePath: item.localRecordingPath })).fileID }
      catch (_error: unknown) { this.recordingUploadFailed(itemId, '上传失败，录音已保留，可重试'); return }
      const fingerprint = JSON.stringify({ recordingId: draft.id, stagingFileId, version: draft.version })
      const submitIntent = prepareWriteIntent(this.data.recordingSubmitIntents[itemId] ?? EMPTY_WRITE_INTENT,
        fingerprint, () => createPageOperationId('seal_task_recording'))
      this.setData({ recordingSubmitIntents: { ...this.data.recordingSubmitIntents, [itemId]: submitIntent } })
      const submitted = await submitTaskRecording(session.user.id, draft.id, stagingFileId,
        draft.version, submitIntent.operationId)
      if (!submitted.ok) {
        this.recordingUploadFailed(itemId, submitted.error.code === 'MEDIA_INVALID'
          ? '云端无法识别本次录音文件，请重新录制'
          : `${submitted.error.message}，录音已保留，可重试`, submitted.error.code === 'MEDIA_INVALID')
        return
      }
      this.setData({ recordingError: '',
        recordingDrafts: { ...this.data.recordingDrafts, [itemId]: submitted.data },
        recordingSubmitIntents: { ...this.data.recordingSubmitIntents, [itemId]: clearWriteIntent() },
        completionInputs: this.data.completionInputs.map(candidate => candidate.itemId === itemId ? {
          ...candidate, recordingId: submitted.data.id, recordingDurationMs: submitted.data.durationMs ?? 0,
          recordingElapsedLabel: formatRecordingDuration(submitted.data.durationMs ?? 0),
          recordingSizeBytes: submitted.data.sizeBytes ?? 0, recordingState: 'submitted' as const,
          recordingMediaAvailable: true, recordingMediaExpired: false,
        } : candidate), draftIntent: clearWriteIntent(), submitIntent: clearWriteIntent() })
      wx.showToast({ title: '录音已上传，请提交任务', icon: 'success' })
    },
    recordingUploadFailed(itemId: string, message: string, invalid = false) {
      this.setData({ recordingError: message, completionInputs: this.data.completionInputs.map(item =>
        item.itemId === itemId ? { ...item, recordingState: invalid ? 'invalid' as const : 'local' as const } : item) })
    },
    structuredAnswers(requireComplete: boolean): StructuredSubmissionAnswer[] | null {
      const answers: StructuredSubmissionAnswer[] = []
      for (const item of this.data.completionInputs) {
        if (item.type === 'reading') {
          if (requireComplete && !item.readingVerified) return null
          const count = parseCount(item.completedPageCount)
          if (count === null) { if (requireComplete) return null; continue }
          if (requireComplete && count < item.requiredCount) return null
          answers.push({ itemId: item.itemId, value: { kind: 'reading', completedPageCount: count } })
        } else if (item.type === 'vocabulary') {
          if (requireComplete && !item.vocabularyVerified) return null
          const completed = parseCount(item.completedWordCount)
          const correct = parseCount(item.correctWordCount)
          if (completed === null || correct === null) { if (requireComplete) return null; continue }
          if (correct > completed || (requireComplete && completed < item.requiredCount)) return null
          answers.push({ itemId: item.itemId, value: { kind: 'vocabulary', completedWordCount: completed, correctWordCount: correct } })
        } else if (item.type === 'recording') {
          if (!item.recordingId) { if (requireComplete) return null; continue }
          answers.push({ itemId: item.itemId, value: { kind: 'recording', recordingId: item.recordingId } })
        } else {
          if (item.exerciseQuestion) {
            const response = item.exerciseQuestion.questionType === 'multiple_choice'
              ? item.exerciseSelectedOptions : item.exerciseResponse.trim()
            if (typeof response === 'string' ? !response : response.length === 0) {
              if (requireComplete) return null
              continue
            }
            answers.push({ itemId: item.itemId, value: { kind: 'exercise', answeredQuestionCount: 1,
              questionResponses: [{ questionId: item.exerciseQuestion.questionId, response }] } })
            continue
          }
          if (requireComplete && getRepositoryMode() === 'cloudbase') return null
          const count = parseCount(item.answeredQuestionCount)
          if (count === null) { if (requireComplete) return null; continue }
          if (requireComplete && count < item.requiredCount) return null
          answers.push({ itemId: item.itemId, value: { kind: 'exercise', answeredQuestionCount: count } })
        }
      }
      return answers.length > 0 ? answers : null
    },
    incompleteRequirementMessage(): string {
      for (const item of this.data.completionInputs) {
        if (item.type === 'reading') {
          if (!item.readingVerified || (parseCount(item.completedPageCount) ?? 0) < item.requiredCount)
            return `请先完成“${item.title}”的阅读要求并同步进度`
        } else if (item.type === 'vocabulary') {
          if (!item.vocabularyVerified || (parseCount(item.completedWordCount) ?? 0) < item.requiredCount)
            return `请先完成“${item.title}”的单词练习并同步进度`
          if ((parseCount(item.correctWordCount) ?? 0) > (parseCount(item.completedWordCount) ?? 0))
            return `请核对“${item.title}”的首次正确词数`
        } else if (item.type === 'recording') {
          if (!item.recordingId) return `请先上传“${item.title}”的有效录音`
        } else if (item.exerciseQuestion) {
          if (item.exerciseQuestion.questionType === 'multiple_choice'
            ? item.exerciseSelectedOptions.length === 0 : !item.exerciseResponse.trim())
            return `请先完成“${item.title}”的作答`
        } else if ((parseCount(item.answeredQuestionCount) ?? 0) < item.requiredCount) {
          return `请先完成“${item.title}”的习题要求`
        }
      }
      return '请先完成全部任务要求'
    },
    invalidDraftInputMessage(): string {
      for (const item of this.data.completionInputs) {
        if (item.type === 'reading' && !item.resourceId && item.completedPageCount.trim()
          && parseCount(item.completedPageCount) === null) return `请核对“${item.title}”的完成页数`
        if (item.type === 'vocabulary' && !item.resourceId) {
          const completed = item.completedWordCount.trim() ? parseCount(item.completedWordCount) : null
          const correct = item.correctWordCount.trim() ? parseCount(item.correctWordCount) : null
          if ((item.completedWordCount.trim() && completed === null)
            || (item.correctWordCount.trim() && correct === null)
            || (completed !== null && correct !== null && correct > completed)) return `请核对“${item.title}”的完成词数`
        }
        if (item.type === 'exercise' && !item.exerciseQuestion && item.answeredQuestionCount.trim()
          && parseCount(item.answeredQuestionCount) === null) return `请核对“${item.title}”的已答题数`
      }
      return ''
    },
    async collectTaskMediaAnswers(requireComplete: boolean): Promise<{
      answers: StructuredSubmissionAnswer[]; error: string
    }> {
      const detail = this.data.detail, session = getSession()
      if (!detail || !session || (session.activeRole ?? session.user.role) !== 'student') {
        return { answers: [], error: '学生会话已失效，请重新进入任务' }
      }
      const answers: StructuredSubmissionAnswer[] = []
      for (const item of detail.task.items) {
        if (item.type !== 'listening' && item.type !== 'video' && item.type !== 'dubbing') continue
        const snapshot = item.mediaSnapshot
        if (!snapshot || snapshot.kind !== item.type) {
          return { answers: [], error: `“${item.title}”缺少已发布媒体快照，请联系老师` }
        }
        let result = await getTaskMediaPlayback(session.user.id, detail.task.id, item.id)
        if (result.ok && !taskMediaPlaybackReady(snapshot, result.data, Date.now())
          && (result.data.status === 'expired' || result.data.status === 'unavailable'
            || result.data.status === 'ready')) {
          result = await beginTaskMediaSession(session.user.id, detail.task.id, item.id,
            createPageOperationId('renew_task_media_submit'))
        }
        const currentSession = getSession(), currentDetail = this.data.detail
        if (currentSession?.sessionId !== session.sessionId
          || currentSession.user.id !== session.user.id
          || currentDetail?.task.id !== detail.task.id
          || currentDetail.task.version !== detail.task.version
          || currentDetail.assignment.id !== detail.assignment.id
          || currentDetail.assignment.redoCount !== detail.assignment.redoCount) {
          return { answers: [], error: '任务或会话已变化，请重新打开当前作业' }
        }
        if (!result.ok || !taskMediaPlaybackReady(snapshot, result.data, Date.now())) {
          if (!requireComplete) continue
          return { answers: [], error: `“${item.title}”播放会话不可用；本机答案已保留，请重新核对媒体状态` }
        }
        if (requireComplete && !taskMediaSubmissionReady(snapshot, result.data, Date.now())) {
          return { answers: [], error: `请先顺序播放完成“${item.title}”，再提交任务` }
        }
        const draftQuestionAnswers = readTaskMediaDraft(taskMediaDraftKey(session.sessionId,
          detail.task.id, detail.assignment.id, detail.assignment.redoCount,
          item.id, snapshot.mediaVersion))
        const questionAnswers = { ...savedTaskMediaAnswers(detail, item.id, snapshot),
          ...(item.id === this.data.activeTaskMediaItemId ? this.data.activeTaskMediaAnswers : {}),
          ...draftQuestionAnswers }
        const work = item.type === 'dubbing'
          ? readTaskDubbingLocalDraft(session.user.id, session.sessionId,
            detail.task.id, item.id, 0)?.work ?? null : null
        const localFinalWorkId = sealedTaskDubbingWorkId(work, detail.task.id,
          item.id, detail.assignment.redoCount + 1)
        const cloudWork = item.type === 'dubbing' && !localFinalWorkId
          ? await findSubmittedTaskDubbingWork(session.user.id, detail.task.id,
            item.id, detail.assignment.redoCount + 1) : null
        if (cloudWork && !cloudWork.ok) return { answers: [],
          error: `“${item.title}”配音状态暂时无法核对，请稍后重试` }
        const finalWorkId = localFinalWorkId || (cloudWork?.ok ? cloudWork.data?.workId ?? '' : '')
        const value = requireComplete
          ? mediaSubmissionValue(snapshot, result.data.sessionId ?? '', questionAnswers, finalWorkId)
          : mediaDraftValue(snapshot, result.data.sessionId ?? '', questionAnswers, finalWorkId)
        if (!value) {
          if (requireComplete) return { answers: [], error: item.type === 'dubbing'
            ? `请先封存本轮“${item.title}”配音作品` : `请完成“${item.title}”的全部题目` }
          continue
        }
        answers.push({ itemId: item.id, value })
      }
      return { answers, error: '' }
    },
    async saveReturnedMediaProgress() {
      const detail = this.data.detail, session = getSession()
      if (!detail || !session || !this.data.editable || this.data.saving || this.data.submitting
        || this.data.teacherPreviewMode || this.data.teacherReviewMode) return
      this.setData({ saving: true })
      const media = await this.collectTaskMediaAnswers(false)
      if (media.error || !media.answers.length || this.data.detail !== detail
        || getSession()?.sessionId !== session.sessionId) {
        this.setData({ saving: false })
        return
      }
      const saved = new Map((detail.submission?.status === 'draft' ? detail.submission.answers : [])
        .flatMap(answer => answer.structuredValue
          ? [[answer.taskItemId, answer.structuredValue] as const] : []))
      const changed = media.answers.some(answer =>
        JSON.stringify(saved.get(answer.itemId)) !== JSON.stringify(answer.value))
      if (!changed) { this.setData({ saving: false }); return }
      for (const answer of this.structuredAnswers(false) ?? []) saved.set(answer.itemId, answer.value)
      for (const answer of media.answers) saved.set(answer.itemId, answer.value)
      const expectedVersion = detail.submission?.version ?? 0
      const assignmentVersion = detail.assignment.version
      const draftVersion = activeDraftRecordVersion(detail.submission)
      this.setData({ writeError: '' })
      const result = await saveDraft(session.user.id, {
        operationId: createPageOperationId('save_media_progress'), expectedVersion,
        taskId: detail.task.id, answer: this.data.answer, assignmentVersion, draftVersion,
        structuredAnswers: [...saved].map(([itemId, value]) => ({ itemId, value })),
      })
      if (this.data.detail !== detail || getSession()?.sessionId !== session.sessionId) {
        this.setData({ saving: false })
        return
      }
      if (!result.ok) {
        this.setData({ saving: false, writeError: `进度自动保存失败：${result.error.message}；请点击“保存草稿”重试` })
        return
      }
      this.setData({ saving: false, writeError: '', detail: {
        ...detail, assignment: { ...detail.assignment,
          version: result.data.assignmentVersion ?? detail.assignment.version },
        submission: result.data,
      } })
    },
    async onSave() {
      if (this.data.teacherPreviewMode) return
      const session = getSession(); const taskId = this.data.detail?.task.id
      if (!session || !taskId || this.data.saving || this.data.submitting) return
      if (this.data.hasUnreleasedMedia) { this.setData({ writeError: '媒体任务尚未开放，当前不能保存作答' }); return }
      if (!this.canEditCurrentRedo()) return
      const invalidInput = this.invalidDraftInputMessage()
      if (invalidInput) { this.setData({ writeError: `${invalidInput}，草稿尚未保存` }); return }
      const expectedVersion = this.data.detail?.submission?.version ?? 0
      let structuredAnswers: StructuredSubmissionAnswer[] | undefined
      if (this.data.completionInputs.length) {
        const collected = this.structuredAnswers(false)
        if (collected) structuredAnswers = collected
      }
      const media = await this.collectTaskMediaAnswers(false)
      if (media.error) { this.setData({ writeError: media.error }); return }
      structuredAnswers = [...(structuredAnswers ?? []), ...media.answers]
      if (!structuredAnswers.length && !this.data.answer.trim()) {
        this.setData({ writeError: this.data.detail?.task.items.some(item => item.type === 'listening'
          || item.type === 'video' || item.type === 'dubbing')
          ? '媒体答案已暂存本机；请先核对播放会话，再保存云端草稿'
          : '请先填写至少一项作答或学习记录，再保存草稿' }); return
      }
      const assignmentVersion = this.data.detail?.assignment.version
      const draftVersion = activeDraftRecordVersion(this.data.detail?.submission)
      const intentFingerprint = JSON.stringify({ taskId, answer: this.data.answer.trim(), expectedVersion, assignmentVersion, draftVersion, structuredAnswers })
      const draftIntent = prepareWriteIntent(this.data.draftIntent, intentFingerprint, () => createPageOperationId('save_draft'))
      this.setData({ saving: true, draftIntent, writeError: '' })
      const result = await saveDraft(session.user.id, {
        operationId: draftIntent.operationId, expectedVersion, taskId, answer: this.data.answer,
        assignmentVersion, draftVersion, structuredAnswers,
      })
      if (!result.ok) {
        this.setData({ saving: false, writeError: result.error.message })
        return
      }
      this.setData({
        saving: false, writeError: '',
        detail: this.data.detail ? {
          ...this.data.detail,
          assignment: { ...this.data.detail.assignment, version: result.data.assignmentVersion ?? this.data.detail.assignment.version },
          submission: result.data,
        } : this.data.detail,
        draftIntent: clearWriteIntent(),
        submitIntent: clearWriteIntent(),
      })
      const mediaCount = this.data.detail?.task.items.filter(item => item.type === 'listening'
        || item.type === 'video' || item.type === 'dubbing').length ?? 0
      wx.showToast({ title: media.answers.length < mediaCount
        ? '草稿已保存，媒体答案仍暂存本机' : '已填写内容已保存', icon: 'none' })
    },
    async onSubmit() {
      if (this.data.teacherPreviewMode) return
      const session = getSession(); const taskId = this.data.detail?.task.id
      if (!session || !taskId || this.data.submitting) return
      if (this.data.saving) {
        this.setData({ writeError: '作答正在同步，请稍后再提交' }); return
      }
      if (this.data.hasUnreleasedMedia) { this.setData({ writeError: '媒体任务尚未开放，当前不能提交' }); return }
      if (!this.canEditCurrentRedo()) return
      if (this.data.hasUnsupportedExercise) { this.setData({ writeError: '习题内容暂不可作答，请联系老师' }); return }
      let structuredAnswers: StructuredSubmissionAnswer[] | undefined
      if (this.data.completionInputs.length) {
        const collected = this.structuredAnswers(true)
        if (!collected) { this.setData({ writeError: this.incompleteRequirementMessage() }); this.jumpToFirstIncomplete(); return }
        structuredAnswers = collected
      }
      const media = await this.collectTaskMediaAnswers(true)
      if (media.error) { this.setData({ writeError: media.error }); return }
      structuredAnswers = [...(structuredAnswers ?? []), ...media.answers]
      if (!structuredAnswers.length && !this.data.answer.trim()) { this.setData({ writeError: '请先填写本次完成情况' }); return }
      const itemCount = this.data.detail?.task.items.length ?? 0
      const confirmed = await new Promise<boolean>(resolve => wx.showModal({
        title: '确认提交作业？',
        content: `“${this.data.detail?.task.title ?? '本次作业'}”共 ${itemCount} 项，已完成 ${itemCount} 项。提交后等待老师检查，本轮作答将锁定。`,
        confirmText: '确认提交', cancelText: '继续检查',
        success: result => resolve(result.confirm), fail: () => resolve(false),
      }))
      if (!confirmed || !this.canEditCurrentRedo()) return
      const expectedVersion = this.data.detail?.submission?.version ?? 0
      const assignmentVersion = this.data.detail?.assignment.version
      const draftVersion = activeDraftRecordVersion(this.data.detail?.submission)
      const intentFingerprint = JSON.stringify({ taskId, answer: this.data.answer.trim(), expectedVersion, assignmentVersion, draftVersion, structuredAnswers })
      const submitIntent = prepareWriteIntent(this.data.submitIntent, intentFingerprint, () => createPageOperationId('submit_task'))
      this.setData({ submitting: true, submitIntent, writeError: '' })
      const result = await submitTask(session.user.id, {
        operationId: submitIntent.operationId, expectedVersion, taskId, answer: this.data.answer,
        assignmentVersion, draftVersion, structuredAnswers,
      })
      this.setData({ submitting: false }); if (!result.ok) { this.setData({ writeError: result.error.message }); return }
      this.setData({ submitIntent: clearWriteIntent(), draftIntent: clearWriteIntent() })
      notifyStudentTaskSubmitted(session.sessionId, taskId)
      wx.showToast({ title: '提交成功，等待老师点评', icon: 'success' }); this.loadDetail()
    },
  },
})

function parseCount(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null
  const count = Number(value)
  return Number.isSafeInteger(count) && count >= 0 ? count : null
}
