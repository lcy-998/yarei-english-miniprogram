import { ReviewAssignmentView, generateTeacherSuggestion, getTeacherSuggestion, getAutomaticTeacherSuggestion, getCompletion, getReviewSubmission, getTeacherTasks, previewTeacherTask, reviewSubmission } from '../services/app-service'
import { getCurrentAssignmentId, getCurrentTaskId, getSession, getTeacherReviewScoreDraft, setCurrentTaskId, setTeacherReviewScoreDraft, takeTeacherReviewScoreDraft } from '../session/session'
import { EMPTY_WRITE_INTENT, WriteIntentState, createPageOperationId, prepareWriteIntent } from '../shared/write-intent'
import { TeacherExerciseEvidence, TeacherSubmissionAnswer, TeacherSubmissionDetailRow, TeacherTaskItemSummary, TeacherVocabularyEvidence, teacherSubmissionDetails } from '../shared/teacher-submission-detail'
import { ReviewScoringItem, ReviewTaskOption, currentReviewTaskFirst, filterReviewRowsByClass, parseReviewScoreInput, previewWeightedReviewScore, reviewClassOptions, reviewEvidenceReady, reviewScoreForConfirmation, reviewTaskOptions, selectReviewRows, selectedReviewTaskId, updateManualScoreDraft } from '../shared/review-task-state'
import { getTaskRecordingMediaState } from '../services/task-recording-service'
import { beginReviewVoiceRecording, sealReviewVoiceRecording } from '../services/review-voice-service'
import type { ReviewVoiceDraftView } from '../../../domain/types'
import { formatRecordingDuration } from '../shared/recording-duration'
import { exerciseReviewGroups } from '../shared/exercise-review-groups'

let teacherVoiceRecorder: ReturnType<typeof wx.getRecorderManager> | null = null
let teacherVoiceRecorderBound = false
let activeTeacherVoiceCapture: { stop: (result: { duration: number; fileSize: number; tempFilePath: string }) => void;
  error: () => void } | null = null
let teacherVoiceTimer: ReturnType<typeof setInterval> | null = null
let teacherVoicePlayer: ReturnType<typeof wx.createInnerAudioContext> | null = null
let automaticAiPollTimer: ReturnType<typeof setTimeout> | null = null

function clearAutomaticAiPoll() {
  if (automaticAiPollTimer !== null) clearTimeout(automaticAiPollTimer)
  automaticAiPollTimer = null
}

function clearTeacherVoiceTimer() {
  if (teacherVoiceTimer !== null) clearInterval(teacherVoiceTimer)
  teacherVoiceTimer = null
}

function bindTeacherVoiceRecorder(): ReturnType<typeof wx.getRecorderManager> | null {
  if (typeof wx === 'undefined' || typeof wx.getRecorderManager !== 'function') return null
  teacherVoiceRecorder ??= wx.getRecorderManager()
  if (teacherVoiceRecorderBound) return teacherVoiceRecorder
  teacherVoiceRecorderBound = true
  teacherVoiceRecorder.onStop(result => {
    const capture = activeTeacherVoiceCapture
    activeTeacherVoiceCapture = null
    clearTeacherVoiceTimer()
    capture?.stop(result)
  })
  teacherVoiceRecorder.onError(() => {
    const capture = activeTeacherVoiceCapture
    activeTeacherVoiceCapture = null
    clearTeacherVoiceTimer()
    capture?.error()
  })
  return teacherVoiceRecorder
}

export interface ManualScoreRow { id: string; title: string; input: string; score: number | null; error: string;
  questionLevel?: boolean }
interface ReviewReadingPage { itemId: string; pageId: string; pageNumber: number; chapterTitle: string;
  imageAssetKey: string; thumbnailAssetKey: string; verified: boolean }
interface ReviewDetailRow extends TeacherSubmissionDetailRow { readingPages?: ReviewReadingPage[];
  exerciseGroupItemIds?: string[] }

export function manualScoreRowsFor(items: readonly TeacherTaskItemSummary[], answers: readonly TeacherSubmissionAnswer[],
  evidence: readonly TeacherExerciseEvidence[], previous: readonly ManualScoreRow[],
  scoringItems: readonly ReviewScoringItem[] = []): ManualScoreRow[] {
  const answered = new Set(answers.map(answer => answer.itemId))
  const subjective = evidence.some(item => item.questionType === 'subjective' && item.recorded)
  const hasRecording = items.some(item => item.type === 'recording' || item.type === 'dubbing')
  const manualScoreIds = new Set(scoringItems.filter(item => item.teacherScoreRequired).map(item => item.itemId))
  if (!subjective && !hasRecording && !manualScoreIds.size) return []
  return items.filter(item => answered.has(item.id) && (manualScoreIds.has(item.id)
    || item.type === 'recording' || item.type === 'dubbing'
    || item.type === 'exercise' && (evidence.find(entry => entry.itemId === item.id)?.questionType === 'subjective'
      || !evidence.some(entry => entry.itemId === item.id)))).map(item => {
    const prior = previous.find(row => row.id === item.id)
    return { id: item.id, title: item.title, input: prior?.input ?? '', score: prior?.score ?? null,
      error: prior?.error ?? '', ...(item.type === 'video' ? { questionLevel: true } : {}) }
  })
}

Component({
  data: {
    loading: true,
    error: '',
    taskId: '',
    taskVersion: 0,
    taskOptions: [] as ReviewTaskOption[],
    orderedTaskOptions: [] as ReviewTaskOption[],
    rows: [] as ReviewAssignmentView[],
    baseRows: [] as ReviewAssignmentView[],
    visibleRows: [] as ReviewAssignmentView[],
    activeRow: null as ReviewAssignmentView | null,
    activeRowId: '',
    activeRowIndex: 0,
    readOnlyMode: false,
    openedFromAssignment: false,
    publishedFeedback: null as { decision: 'approved' | 'returned'; score: number | null; textComment: string | null; returnReason: string | null;
      originalAutomaticScore?: number | null; overrideReason?: string | null;
      itemScores?: Array<{ itemId: string; score: number }> } | null,
    taskTitle: '',
    submittedLabel: '',
    selectedSubmissionId: '',
    selectedSubmissionVersion: 0,
    submissionHistory: [] as Array<{ id: string; version: number; status: string; submittedAt: string }>,
    viewingHistory: false,
    displayedScore: '--',
    displayedScoreLabel: '得分待读取',
    taskItems: [] as TeacherTaskItemSummary[],
    hasRecordingTask: false,
    activeAnswers: [] as TeacherSubmissionAnswer[],
    activeExerciseEvidence: [] as TeacherExerciseEvidence[],
    activeVocabularyEvidence: [] as TeacherVocabularyEvidence[],
    detailRows: [] as ReviewDetailRow[],
    readingPages: [] as ReviewReadingPage[],
    recordingMediaStates: {} as Record<string, 'available' | 'expired' | 'unknown'>,
    taskItemsLoading: false,
    submissionLoading: false,
    taskItemsError: '',
    submissionError: '',
    classFilter: 'all',
    classOptions: [] as Array<{ id: string; label: string; count: number }>,
    quickPhrases: ['完成得很好', '继续保持', '注意细节'],
    starValues: [1, 2, 3, 4, 5],
    comment: '',
    aiSuggestion: null as { id: string; text: string; generationNumber: number; remainingRegenerations: number } | null,
    aiSuggestionLoading: false,
    aiSuggestionOperationId: '',
    aiAutomaticStatus: 'checking' as 'checking' | 'processing' | 'ready' | 'failed' | 'insufficient_evidence' | 'not_started',
    aiAutoPollAttempts: 0,
    aiSuggestionAdopted: false,
    score: null as number | null,
    automaticScore: null as number | null,
    scoreInput: '',
    scoreError: '',
    manualScoreRows: [] as ManualScoreRow[],
    questionScoreDrafts: {} as Record<string, Record<string, Record<string, string>>>,
    historyManualScoreRows: [] as ManualScoreRow[],
    scorePreview: '',
    scoringItems: [] as ReviewScoringItem[],
    scoringBreakdown: [] as Array<{ id: string; title: string; weight: string; score: string }>,
    reviewedItemScoreRows: [] as Array<{ id: string; title: string; score: number }>,
    overrideReason: '',
    reviewingId: '',
    reviewIntents: {} as Record<string, WriteIntentState>,
    voiceState: 'idle' as 'idle' | 'recording' | 'local' | 'uploading' | 'sealed',
    voiceLocalPath: '', voiceDurationMs: 0, voiceDurationLabel: '0:00', voiceError: '',
    voiceDraft: null as ReviewVoiceDraftView | null, voiceRecordingId: '',
    voicePlaying: false,
    voiceBeginIntent: EMPTY_WRITE_INTENT as WriteIntentState,
    voiceSealIntent: EMPTY_WRITE_INTENT as WriteIntentState,
  },
  lifetimes: {
    attached() { this.setData({ taskId: getCurrentTaskId() }); this.loadRows() },
    detached() {
      clearAutomaticAiPoll()
      const wasRecording = this.data.voiceState === 'recording'
      activeTeacherVoiceCapture = null
      clearTeacherVoiceTimer()
      if (wasRecording) teacherVoiceRecorder?.stop()
      teacherVoicePlayer?.destroy()
      teacherVoicePlayer = null
    },
  },
  pageLifetimes: { show() { this.restoreTeacherReviewScoreDraft() } },
  methods: {
    async loadAutomaticAiSuggestion(submissionId: string) {
      const session = getSession()
      if (!session || session.user.role !== 'teacher' || this.data.selectedSubmissionId !== submissionId
        || this.data.viewingHistory || this.data.readOnlyMode || this.data.publishedFeedback
        || this.data.aiSuggestionOperationId) return
      const result = await getAutomaticTeacherSuggestion(session.user.id, submissionId)
      if (this.data.selectedSubmissionId !== submissionId || this.data.aiSuggestionOperationId
        || getSession()?.sessionId !== session.sessionId) return
      if (!result.ok) { this.setData({ aiAutomaticStatus: 'failed' }); return }
      if (result.data.status === 'trial') {
        this.setData({ aiAutomaticStatus: 'ready',
          ...(this.data.aiSuggestion ? {} : { aiSuggestion: result.data, aiSuggestionAdopted: false }) })
        return
      }
      const attempts = this.data.aiAutoPollAttempts + 1
      const waitingForDispatch = result.data.status === 'not_started' && attempts <= 6
      this.setData({ aiAutomaticStatus: waitingForDispatch ? 'checking' : result.data.status,
        aiAutoPollAttempts: attempts })
      if (result.data.status === 'processing' || waitingForDispatch) {
        clearAutomaticAiPoll()
        automaticAiPollTimer = setTimeout(() => this.loadAutomaticAiSuggestion(submissionId), 5000)
      }
    },
    async generateAiSuggestion() {
      const session = getSession()
      const submissionId = this.data.selectedSubmissionId
      if (!session || session.user.role !== 'teacher' || !submissionId || this.data.viewingHistory
        || this.data.readOnlyMode || this.data.aiSuggestionLoading || this.data.aiAutomaticStatus === 'processing') return
      clearAutomaticAiPoll()
      const operationId = this.data.aiSuggestionOperationId || createPageOperationId('teacher_ai_suggestion')
      this.setData({ aiSuggestionLoading: true, aiSuggestionOperationId: operationId })
      const result = await generateTeacherSuggestion(session.user.id, submissionId,
        operationId)
      const current = () => {
        const latest = getSession()
        return latest?.user.id === session.user.id && latest.sessionId === session.sessionId
          && this.data.selectedSubmissionId === submissionId && this.data.aiSuggestionOperationId === operationId
      }
      if (!current()) return
      if (result.ok) {
        this.setData({ aiSuggestionLoading: false, aiSuggestionOperationId: '',
          aiSuggestion: result.data, aiSuggestionAdopted: false })
        return
      }
      if (!['NETWORK_ERROR', 'SERVICE_UNAVAILABLE'].includes(result.error.code)) {
        this.setData({ aiSuggestionLoading: false, aiSuggestionOperationId: '' })
        wx.showToast({ title: result.error.message || 'AI 点评暂时不可用', icon: 'none' })
        return
      }
      const deadline = Date.now() + 195_000
      while (Date.now() < deadline && current()) {
        await new Promise<void>(resolve => setTimeout(resolve, 5_000))
        if (!current()) return
        const status = await getTeacherSuggestion(session.user.id, submissionId, operationId)
        if (!current()) return
        if (!status.ok) {
          if (status.error.code === 'NETWORK_ERROR' || status.error.code === 'SERVICE_UNAVAILABLE'
            || status.error.code === 'NOT_FOUND') continue
          this.setData({ aiSuggestionLoading: false, aiSuggestionOperationId: '' })
          wx.showToast({ title: status.error.message || 'AI 点评暂时不可用', icon: 'none' })
          return
        }
        if (status.data.status === 'processing') continue
        if (status.data.status === 'insufficient_evidence') {
          this.setData({ aiSuggestionLoading: false, aiSuggestionOperationId: '' })
          wx.showToast({ title: '缺少可核对的具体作答，建议查看作答后手动补充评语', icon: 'none' })
          return
        }
        if (status.data.status === 'failed' || status.data.status === 'not_started') {
          this.setData({ aiSuggestionLoading: false, aiSuggestionOperationId: '' })
          wx.showToast({ title: '建议生成未成功，可重新生成或人工点评', icon: 'none' })
          return
        }
        this.setData({ aiSuggestionLoading: false, aiSuggestionOperationId: '',
          aiSuggestion: status.data, aiSuggestionAdopted: false })
        return
      }
      if (current()) {
        this.setData({ aiSuggestionLoading: false })
        wx.showToast({ title: '仍在生成，可稍后重试；已有评语会保留', icon: 'none' })
      }
    },
    adoptAiSuggestion() {
      const suggestion = this.data.aiSuggestion
      if (!suggestion) return
      this.setData({ comment: suggestion.text, aiSuggestionAdopted: true })
    },
    discardAiSuggestion() { this.setData({ aiSuggestion: null, aiSuggestionAdopted: false }) },
    startVoiceComment() {
      const row = this.data.activeRow
      if (!row?.submissionId || this.data.readOnlyMode || this.data.viewingHistory
        || this.data.voiceState === 'recording' || this.data.voiceState === 'uploading') return
      const recorder = bindTeacherVoiceRecorder()
      if (!recorder) { this.setData({ voiceError: '当前设备无法录音，请稍后重试' }); return }
      teacherVoicePlayer?.destroy()
      teacherVoicePlayer = null
      this.setData({ voiceState: 'recording', voiceError: '', voiceDurationMs: 0,
        voiceDurationLabel: '0:00', voiceLocalPath: '', voiceDraft: null, voiceRecordingId: '',
        voicePlaying: false })
      const startedAt = Date.now()
      activeTeacherVoiceCapture = {
        stop: result => {
          if (result.duration < 1000 || result.duration > 300000 || result.fileSize <= 0
            || result.fileSize > 20 * 1024 * 1024 || !result.tempFilePath) {
            this.setData({ voiceState: 'idle', voiceError: '录音须为 1 秒至 5 分钟、20 MB 以内' })
            return
          }
          this.setData({ voiceState: 'local', voiceLocalPath: result.tempFilePath,
            voiceDurationMs: result.duration, voiceDurationLabel: formatRecordingDuration(result.duration),
            voiceError: '' })
        },
        error: () => this.setData({ voiceState: 'idle', voiceError: '无法录音，请检查麦克风权限后重试' }),
      }
      teacherVoiceTimer = setInterval(() => {
        const duration = Math.min(Date.now() - startedAt, 300000)
        this.setData({ voiceDurationMs: duration, voiceDurationLabel: formatRecordingDuration(duration) })
      }, 1000)
      recorder.start({ duration: 300000, sampleRate: 16000, numberOfChannels: 1,
        encodeBitRate: 48000, format: 'mp3' })
    },
    stopVoiceComment() {
      if (this.data.voiceState === 'recording') teacherVoiceRecorder?.stop()
    },
    toggleVoicePreview() {
      if (!this.data.voiceLocalPath || this.data.voiceState === 'recording'
        || this.data.voiceState === 'uploading') return
      if (teacherVoicePlayer) {
        teacherVoicePlayer.destroy()
        teacherVoicePlayer = null
        this.setData({ voicePlaying: false })
        return
      }
      const player = wx.createInnerAudioContext()
      teacherVoicePlayer = player
      player.src = this.data.voiceLocalPath
      player.onEnded(() => { player.destroy(); if (teacherVoicePlayer === player) teacherVoicePlayer = null
        this.setData({ voicePlaying: false }) })
      player.onError(() => { player.destroy(); if (teacherVoicePlayer === player) teacherVoicePlayer = null
        this.setData({ voicePlaying: false, voiceError: '本机录音无法播放，请重新录制' }) })
      this.setData({ voicePlaying: true })
      player.play()
    },
    async sealVoiceComment() {
      const session = getSession()
      const submissionId = this.data.selectedSubmissionId
      if (!session || session.user.role !== 'teacher' || !submissionId || !this.data.voiceLocalPath
        || this.data.voiceState !== 'local' || this.data.readOnlyMode || this.data.viewingHistory) return
      this.setData({ voiceState: 'uploading', voiceError: '' })
      const beginIntent = prepareWriteIntent(this.data.voiceBeginIntent, submissionId,
        () => createPageOperationId('begin_review_voice'))
      this.setData({ voiceBeginIntent: beginIntent })
      let draft = this.data.voiceDraft
      if (!draft || draft.submissionId !== submissionId || draft.status !== 'draft') {
        const begun = await beginReviewVoiceRecording(session.user.id, submissionId, beginIntent.operationId)
        if (!begun.ok) {
          this.setData({ voiceState: 'local', voiceError: begun.error.message }); return
        }
        draft = begun.data
        this.setData({ voiceDraft: draft })
      }
      let stagingFileId: string
      try {
        stagingFileId = (await wx.cloud.uploadFile({ cloudPath: draft.stagingPath,
          filePath: this.data.voiceLocalPath })).fileID
      } catch (_error: unknown) {
        this.setData({ voiceState: 'local', voiceError: '上传失败，本机录音已保留，可重试' }); return
      }
      const sealIntent = prepareWriteIntent(this.data.voiceSealIntent,
        `${draft.recordingId}:${draft.version}:${stagingFileId}`,
        () => createPageOperationId('seal_review_voice'))
      this.setData({ voiceSealIntent: sealIntent })
      const sealed = await sealReviewVoiceRecording(session.user.id, draft.recordingId,
        stagingFileId, draft.version, sealIntent.operationId)
      if (!sealed.ok) {
        this.setData({ voiceState: 'local', voiceError: sealed.error.message }); return
      }
      this.setData({ voiceState: 'sealed', voiceDraft: sealed.data,
        voiceRecordingId: sealed.data.recordingId, voiceError: '' })
    },
    restoreTeacherReviewScoreDraft() {
      const draft = getTeacherReviewScoreDraft()
      if (!draft || draft.submissionId !== this.data.selectedSubmissionId || this.data.viewingHistory
        || !this.data.manualScoreRows.some(row => row.id === draft.itemId)) return
      takeTeacherReviewScoreDraft()
      const inputs = draft.inputs ?? { [draft.itemId]: draft.input }
      const rows = Object.entries(inputs).reduce((current, [itemId, input]) =>
        updateManualScoreDraft(current, itemId, input), this.data.manualScoreRows)
      this.setData({ manualScoreRows: rows,
        ...(draft.questionInputs ? { questionScoreDrafts: { ...this.data.questionScoreDrafts,
          [draft.submissionId]: { ...this.data.questionScoreDrafts[draft.submissionId],
            [draft.itemId]: draft.questionInputs } } } : {}),
        reviewIntents: {} }, () => this.refreshScorePreview())
    },
    async loadRows() {
      const session = getSession()
      if (!session) return
      this.setData({ loading: true, error: '' })
      const tasks = await getTeacherTasks(session.user.id)
      const requestedAssignmentId = getCurrentAssignmentId()
      const openedFromAssignment = Boolean(requestedAssignmentId)
      if (!tasks.ok && !openedFromAssignment) { this.setData({ loading: false, error: tasks.error.message }); return }
      const taskOptions = tasks.ok ? reviewTaskOptions(tasks.data.tasks, tasks.data.pendingByTask) : []
      const taskId = openedFromAssignment ? this.data.taskId : selectedReviewTaskId(taskOptions, this.data.taskId)
      if (!taskId) {
        if (!openedFromAssignment) setCurrentTaskId('')
        this.setData({ loading: false, taskId: '', taskVersion: 0, taskOptions, orderedTaskOptions: [], rows: [], baseRows: [], visibleRows: [], activeRow: null, activeRowId: '', activeRowIndex: 0, taskTitle: '', classOptions: [], classFilter: 'all', openedFromAssignment: false, readOnlyMode: false, publishedFeedback: null, taskItems: [], hasRecordingTask: false, activeAnswers: [], detailRows: [], readingPages: [], manualScoreRows: [], reviewedItemScoreRows: [], taskItemsLoading: false, submissionLoading: false, submittedLabel: '', comment: '', score: null, scoreInput: '', scoreError: '', reviewIntents: {} })
        return
      }
      const result = await getCompletion(session.user.id, taskId)
      if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
      const selection = selectReviewRows(result.data, requestedAssignmentId)
      const rows = selection.rows
      const classOptions = reviewClassOptions(rows)
      const classFilter = !openedFromAssignment && taskId === this.data.taskId && classOptions.some(option => option.id === this.data.classFilter) ? this.data.classFilter : 'all'
      const visibleRows = filterReviewRowsByClass(rows, classFilter)
      const firstIndex = classFilter === 'all' ? selection.activeIndex : 0
      const activeRow = visibleRows[firstIndex] ?? null
      const task = tasks.ok ? tasks.data.tasks.find(item => item.id === taskId) : undefined
      setCurrentTaskId(taskId)
      this.setData({ loading: false, taskId, taskVersion: task?.version ?? 0, taskOptions, orderedTaskOptions: currentReviewTaskFirst(taskOptions, taskId), rows: visibleRows, baseRows: rows, visibleRows, activeRow, activeRowId: activeRow?.assignmentId ?? '', activeRowIndex: firstIndex, readOnlyMode: selection.readOnlyMode, openedFromAssignment, publishedFeedback: null, taskTitle: task?.title ?? '', classOptions, classFilter, taskItems: [], hasRecordingTask: false, activeAnswers: [], detailRows: [], readingPages: [], manualScoreRows: [], reviewedItemScoreRows: [], taskItemsError: '', submissionError: '', taskItemsLoading: Boolean(activeRow), submissionLoading: Boolean(activeRow), comment: '', score: null, scoreInput: '', scoreError: '' }, () => {
        this.loadActiveSubmission()
      })
    },
    async loadTaskItems(taskId: string, version: number) {
      const session = getSession()
      if (!session) return
      const result = await previewTeacherTask(session.user.id, taskId, version)
      if (this.data.taskId !== taskId) return
      if (!result.ok) { this.setData({ taskItemsLoading: false, taskItemsError: result.error.message }); return }
      this.setData({ taskItemsLoading: false, taskItemsError: '', hasRecordingTask: result.data.items.some(item => item.type === 'recording'),
        taskItems: result.data.items.map(item => ({ id: item.id, title: item.title, type: item.type, completionRule: item.completionRule })) }, () => {
          this.refreshDetailRows()
          if (this.data.selectedSubmissionId) this.refreshRecordingMediaStates(this.data.selectedSubmissionId)
        })
    },
    refreshDetailRows() {
      const manualScoreRows = manualScoreRowsFor(this.data.taskItems, this.data.activeAnswers,
        this.data.activeExerciseEvidence, this.data.manualScoreRows, this.data.scoringItems)
      const reviewedItemScoreRows = (this.data.publishedFeedback?.itemScores ?? []).map(item => ({
        id: item.itemId, title: this.data.taskItems.find(taskItem => taskItem.id === item.itemId)?.title ?? item.itemId,
        score: item.score }))
      const itemRows: ReviewDetailRow[] = teacherSubmissionDetails(this.data.taskItems, this.data.activeAnswers,
        this.data.activeAnswers.length ? this.data.activeExerciseEvidence : [],
        this.data.activeAnswers.length ? this.data.activeVocabularyEvidence : []).map(row => {
          if (row.typeLabel === '阅读') {
            const answer = this.data.activeAnswers.find(item => item.itemId === row.id)?.value
            const value = answer !== null && typeof answer === 'object' && !Array.isArray(answer)
              ? answer as Record<string, unknown> : null
            const visits = Array.isArray(value?.verifiedPageEvents) ? value.verifiedPageEvents : []
            return { ...row, readingPages: this.data.readingPages.filter(page => page.itemId === row.id)
              .map(page => ({ ...page, verified: visits.some(entry => {
                if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return false
                const event = entry as Record<string, unknown>
                return event.pageId === page.pageId && event.pageNumber === page.pageNumber
                  && typeof event.visitedAt === 'string' && Number.isFinite(Date.parse(event.visitedAt))
              }) })) }
          }
          if (!row.recordingId) return row
          const state = this.data.recordingMediaStates[row.recordingId] ?? 'unknown'
          if (state === 'available') return row
          return { ...row, detail: state === 'expired'
            ? '录音已过保留期；提交、成绩和点评记录仍保留。'
            : '正在核对录音保留状态；提交记录仍保留。', recordingId: undefined }
        })
      const byId = new Map(itemRows.map(row => [row.id, row]))
      const detailRows = exerciseReviewGroups(this.data.taskItems).flatMap(group => {
        const rows = group.itemIds.flatMap(id => byId.get(id) ? [byId.get(id)!] : [])
        if (!rows.length) return []
        if (group.type !== 'exercise' || rows.length < 2) return rows
        const recorded = rows.filter(row => row.exercise?.recorded).length
        return [{ ...rows[0], title: group.title,
          result: `共 ${rows.length} 题 · ${recorded} 题已记录作答`,
          detail: '点开后连续查看这份习题的原答与判定。',
          tone: rows.every(row => row.tone === 'success') ? 'success' as const : 'neutral' as const,
          exerciseGroupItemIds: group.itemIds }]
      })
      this.setData({ manualScoreRows, reviewedItemScoreRows, detailRows }, () => this.refreshScorePreview())
    },
    refreshScorePreview() {
      const items = this.data.scoringItems
      const preview = previewWeightedReviewScore(items, this.data.manualScoreRows)
      const scores = new Map(this.data.manualScoreRows.map(row => [row.id, row.score]))
      this.setData({ scorePreview: preview === null ? '' : String(preview),
        ...(!this.data.readOnlyMode && !this.data.viewingHistory
          ? { displayedScore: preview === null ? '--' : String(preview),
            displayedScoreLabel: preview === null ? '总分待评分' : '预计总分' } : {}),
        scoringBreakdown: items.map(item => ({ id: item.itemId,
          title: this.data.taskItems.find(taskItem => taskItem.id === item.itemId)?.title ?? item.itemId,
          weight: `${Number(item.weightPercent.toFixed(1))}%`,
          score: (item.teacherScoreRequired ? scores.get(item.itemId) : item.automaticScore) === null
            || (item.teacherScoreRequired && scores.get(item.itemId) === undefined)
            ? '待评分' : `${item.teacherScoreRequired ? scores.get(item.itemId) : item.automaticScore} 分` })) })
    },
    async refreshRecordingMediaStates(submissionId: string) {
      const session = getSession()
      if (!session) return
      const rows = teacherSubmissionDetails(this.data.taskItems, this.data.activeAnswers)
      const ids = rows.flatMap(row => row.recordingId ? [row.recordingId] : [])
      const states = await Promise.all(ids.map(async id => ({ id,
        result: await getTaskRecordingMediaState(session.user.id, id) })))
      if (this.data.selectedSubmissionId !== submissionId) return
      this.setData({ recordingMediaStates: Object.fromEntries(states.map(({ id, result }) =>
        [id, result.ok ? result.data.mediaExpired ? 'expired' : 'available' : 'unknown'])) },
      () => this.refreshDetailRows())
    },
    async loadActiveSubmission(submissionId?: string) {
      clearAutomaticAiPoll()
      const session = getSession()
      const row = this.data.activeRow
      const taskId = this.data.taskId
      if (!session || !row?.submissionId) { this.setData({ activeAnswers: [], detailRows: [], readingPages: [], taskItemsLoading: false, manualScoreRows: [],
        reviewedItemScoreRows: [], automaticScore: null, submittedLabel: '', publishedFeedback: null, submissionLoading: false }); return }
      const requestedId = typeof submissionId === 'string' ? submissionId : row.submissionId
      const viewingHistory = requestedId !== row.submissionId
      this.setData({ automaticScore: null, selectedSubmissionId: requestedId, viewingHistory,
        aiSuggestion: null, aiSuggestionAdopted: false, aiSuggestionLoading: false,
        aiSuggestionOperationId: '', aiAutomaticStatus: 'checking', aiAutoPollAttempts: 0,
        recordingMediaStates: {}, scoringItems: [], scorePreview: '', scoringBreakdown: [],
        manualScoreRows: viewingHistory ? [] : this.data.historyManualScoreRows.length
          ? this.data.historyManualScoreRows : this.data.manualScoreRows,
        historyManualScoreRows: viewingHistory ? this.data.historyManualScoreRows : [], reviewedItemScoreRows: [],
        displayedScore: '--', displayedScoreLabel: '得分待读取',
        ...(viewingHistory ? {} : { selectedSubmissionVersion: row.submissionVersion ?? 0, submissionHistory: [] }),
        submissionLoading: true, submissionError: '' })
      const result = await getReviewSubmission(session.user.id, requestedId)
      if (this.data.taskId !== taskId || this.data.activeRowId !== row.assignmentId
        || this.data.selectedSubmissionId !== requestedId) return
      if (!result.ok) { this.setData({ activeAnswers: [], detailRows: [], submittedLabel: '提交详情读取失败', taskItemsLoading: false, submissionLoading: false, submissionError: result.error.message }); return }
      const snapshotItems = result.data.taskItems?.sort((left, right) => left.order - right.order)
        .map(item => ({ id: item.id, title: item.title, type: item.type, completionRule: item.completionRule }))
      this.setData({
        taskTitle: result.data.taskTitle,
        submittedLabel: result.data.submittedAt ? new Date(result.data.submittedAt).toLocaleString('zh-CN') : '提交时间未提供',
        selectedSubmissionVersion: result.data.submissionVersion,
        submissionHistory: result.data.submissionHistory ?? [{ id: row.submissionId, version: row.submissionVersion ?? 1,
          status: 'submitted', submittedAt: result.data.submittedAt }],
        viewingHistory: requestedId !== row.submissionId,
        displayedScore: String(result.data.feedback?.score ?? result.data.automaticScore ?? '--'),
        displayedScoreLabel: result.data.feedback?.score !== null && result.data.feedback?.score !== undefined
          ? '教师正式分' : result.data.automaticScore !== null && result.data.automaticScore !== undefined
            ? '系统参考分' : '暂无分数',
        activeAnswers: result.data.answers,
        ...(snapshotItems === undefined ? {} : { taskItems: snapshotItems,
          hasRecordingTask: snapshotItems.some(item => item.type === 'recording') }),
        readingPages: (result.data.readingPages ?? []).map(page => ({ ...page, verified: false })),
        activeExerciseEvidence: result.data.exerciseEvidence ?? [],
        scoringItems: result.data.scoringItems ?? [],
        activeVocabularyEvidence: result.data.vocabularyEvidence ?? [],
        automaticScore: result.data.automaticScore ?? null,
        ...(!viewingHistory && !result.data.feedback && !this.data.scoreInput
          && !(result.data.scoringItems ?? []).some(item => item.teacherScoreRequired)
          && result.data.automaticScore !== null && result.data.automaticScore !== undefined
          ? { score: result.data.automaticScore, scoreInput: String(result.data.automaticScore) } : {}),
        publishedFeedback: result.data.feedback ? { decision: result.data.feedback.decision, score: result.data.feedback.score,
          textComment: result.data.feedback.textComment, returnReason: result.data.feedback.returnReason,
          originalAutomaticScore: result.data.feedback.originalAutomaticScore,
          overrideReason: result.data.feedback.overrideReason,
          itemScores: result.data.feedback.itemScores } : null,
        submissionLoading: false,
        taskItemsLoading: snapshotItems === undefined && this.data.taskVersion > 0,
        taskItemsError: snapshotItems === undefined && this.data.taskVersion === 0
          ? '该提交没有可读取的任务内容快照。' : '',
        submissionError: '',
      }, () => { this.refreshDetailRows(); this.refreshRecordingMediaStates(requestedId)
        if (!viewingHistory && !result.data.feedback) this.loadAutomaticAiSuggestion(requestedId)
        if (snapshotItems === undefined && this.data.taskVersion > 0) this.loadTaskItems(taskId, this.data.taskVersion)
      })
    },
    selectSubmissionVersion(event: WechatMiniprogram.TouchEvent) {
      const submissionId = event.currentTarget.dataset.id as string
      if (this.data.reviewingId || !this.data.submissionHistory.some(item => item.id === submissionId)
        || submissionId === this.data.selectedSubmissionId) return
      this.confirmDraftSwitch(() => {
        setTeacherReviewScoreDraft(null)
        if (!this.data.viewingHistory) {
          this.setData({ historyManualScoreRows: this.data.manualScoreRows.map(row => ({ ...row })) },
            () => this.loadActiveSubmission(submissionId))
          return
        }
        this.loadActiveSubmission(submissionId)
      })
    },
    retrySubmissionDetail() { this.loadActiveSubmission(this.data.selectedSubmissionId || undefined) },
    onComment(event: WechatMiniprogram.Input) {
      this.setData({ comment: event.detail.value, reviewIntents: {} })
    },
    onOverrideReason(event: WechatMiniprogram.Input) {
      this.setData({ overrideReason: event.detail.value, reviewIntents: {} })
    },
    onScore(event: WechatMiniprogram.Input) {
      const parsed = parseReviewScoreInput(event.detail.value)
      this.setData({ score: parsed.score, scoreInput: parsed.input, scoreError: parsed.error, reviewIntents: {} })
    },
    onManualItemScore(event: WechatMiniprogram.Input) {
      const id = event.currentTarget.dataset.id as string
      if (this.data.manualScoreRows.find(row => row.id === id)?.questionLevel) return
      this.setData({ manualScoreRows: updateManualScoreDraft(this.data.manualScoreRows, id, event.detail.value), reviewIntents: {} },
      () => this.refreshScorePreview())
    },
    setScore(event: WechatMiniprogram.TouchEvent) {
      const parsed = parseReviewScoreInput(String(event.currentTarget.dataset.score))
      this.setData({ score: parsed.score, scoreInput: parsed.input, scoreError: parsed.error, reviewIntents: {} })
    },
    clearScore() { this.setData({ score: null, scoreInput: '', scoreError: '', reviewIntents: {} }) },
    usePhrase(event: WechatMiniprogram.TouchEvent) { this.setData({ comment: event.currentTarget.dataset.phrase as string, reviewIntents: {} }) },
    confirmDraftSwitch(next: () => void) {
      if (this.data.reviewingId) return
      const proceed = () => {
        teacherVoicePlayer?.destroy()
        teacherVoicePlayer = null
        if (this.data.voiceState === 'recording') {
          activeTeacherVoiceCapture = null
          clearTeacherVoiceTimer()
          teacherVoiceRecorder?.stop()
        }
        setTeacherReviewScoreDraft(null)
        this.setData({ overrideReason: '', automaticScore: null, voiceState: 'idle',
          voiceLocalPath: '', voiceDurationMs: 0, voiceDurationLabel: '0:00', voiceError: '',
          voiceDraft: null, voiceRecordingId: '', voicePlaying: false,
          voiceBeginIntent: EMPTY_WRITE_INTENT,
          voiceSealIntent: EMPTY_WRITE_INTENT })
        next()
      }
      if (!this.data.comment.trim()
        && (this.data.score === null || this.data.score === this.data.automaticScore)
        && !this.data.overrideReason.trim()
        && !this.data.manualScoreRows.some(row => row.input.trim())
        && this.data.voiceState === 'idle') { proceed(); return }
      wx.showModal({ title: '放弃当前点评？', content: '未发布的评语、评分和录音会丢失。',
        confirmText: '放弃', cancelText: '继续编辑', success: result => { if (result.confirm) proceed() } })
    },
    selectTask(event: WechatMiniprogram.TouchEvent) {
      const taskId = event.currentTarget.dataset.id as string
      if (!this.data.taskOptions.some(option => option.id === taskId)) return
      if (taskId === this.data.taskId) return
      this.confirmDraftSwitch(() => this.setData({ taskId, classFilter: 'all', comment: '', score: null, scoreInput: '', scoreError: '', reviewIntents: {} }, () => this.loadRows()))
    },
    selectClassFilter(event: WechatMiniprogram.TouchEvent) {
      const id = event.currentTarget.dataset.id as string
      if (id === this.data.classFilter) return
      const visibleRows = filterReviewRowsByClass(this.data.baseRows, id)
      const activeRow = visibleRows[0] ?? null
      this.confirmDraftSwitch(() => this.setData({ classFilter: id, visibleRows, rows: visibleRows, activeRow, activeRowId: activeRow?.assignmentId ?? '', activeRowIndex: 0, readOnlyMode: Boolean(activeRow && activeRow.status !== 'awaiting_review'), publishedFeedback: null, activeAnswers: [], detailRows: [], submissionError: '', submissionLoading: Boolean(activeRow), comment: '', score: null, scoreInput: '', scoreError: '', manualScoreRows: [], historyManualScoreRows: [], reviewIntents: {} }, () => this.loadActiveSubmission()))
    },
    selectStudent(event: WechatMiniprogram.TouchEvent) {
      this.activateStudent(Number(event.currentTarget.dataset.index))
    },
    activateStudent(index: number) {
      const activeRow = this.data.visibleRows[index] ?? null
      if (!activeRow || activeRow.assignmentId === this.data.activeRowId) return
      this.confirmDraftSwitch(() => this.setData({ activeRow, activeRowId: activeRow.assignmentId, activeRowIndex: index, readOnlyMode: activeRow.status !== 'awaiting_review', publishedFeedback: null, activeAnswers: [], detailRows: [], submissionError: '', submissionLoading: true, comment: '', score: null, scoreInput: '', scoreError: '', manualScoreRows: [], historyManualScoreRows: [], reviewIntents: {} }, () => this.loadActiveSubmission()))
    },
    openReviewItem(event: WechatMiniprogram.TouchEvent) {
      if (!this.data.activeRow || this.data.submissionLoading || this.data.taskItemsLoading
        || this.data.submissionError || this.data.taskItemsError) return
      const itemId = event.currentTarget.dataset.id as string
      const item = this.data.taskItems.find(candidate => candidate.id === itemId)
      const submissionId = this.data.selectedSubmissionId
      const detailRow = this.data.detailRows.find(row => row.id === itemId)
      if (!item || !submissionId || !detailRow) return
      const manualRow = this.data.manualScoreRows.find(row => row.id === itemId)
        ?? this.data.manualScoreRows.find(row => detailRow.exerciseGroupItemIds?.includes(row.id))
      setTeacherReviewScoreDraft(manualRow ? { submissionId, itemId: manualRow.id, input: manualRow.input,
        inputs: Object.fromEntries(this.data.manualScoreRows.map(row => [row.id, row.input])),
        ...(this.data.questionScoreDrafts[submissionId]?.[itemId]
          ? { questionInputs: this.data.questionScoreDrafts[submissionId][itemId] } : {}) } : null)
      const path = item.type === 'reading' ? '/subpackages/student/reading-detail/reading-detail'
        : item.type === 'vocabulary' ? '/subpackages/student/vocabulary/vocabulary'
          : item.type === 'dubbing' ? '/subpackages/student-media/dubbing/dubbing'
            : item.type === 'listening' ? '/subpackages/student-media/listening-task/listening-task'
              : item.type === 'video' ? '/subpackages/student-media/video-task/video-task'
                : item.type === 'exercise' ? '/subpackages/student/exercise-task/exercise-task'
                  : '/subpackages/student-media/recording-task/recording-task'
      wx.navigateTo({ url: `${path}?teacherReview=1&submissionId=${encodeURIComponent(submissionId)}&itemId=${encodeURIComponent(itemId)}${item.type === 'exercise' && detailRow.exerciseGroupItemIds?.length ? '&group=1' : ''}` })
    },
    async publishReview(row: ReviewAssignmentView, decision: 'approved' | 'returned') {
      const session = getSession()
      if (!session || this.data.reviewingId || this.data.viewingHistory) return
      if (!row.submissionId || row.submissionVersion === undefined || row.status !== 'awaiting_review') {
        wx.showToast({ title: '请选择一条待点评提交', icon: 'none' })
        return
      }
      if (!reviewEvidenceReady(this.data, row.submissionId)) {
        wx.showToast({ title: '作业详情读取失败，请先重试', icon: 'none' }); return
      }
      if (this.data.scoreError) { wx.showToast({ title: this.data.scoreError, icon: 'none' }); return }
      if (this.data.voiceState === 'recording' || this.data.voiceState === 'uploading'
        || this.data.voiceState === 'local') {
        wx.showToast({ title: '请先结束并封存语音评语', icon: 'none' }); return
      }
      const voiceRecordingId = this.data.voiceState === 'sealed'
        && this.data.voiceDraft?.submissionId === row.submissionId
        && this.data.voiceDraft.submissionVersion === row.submissionVersion
        ? this.data.voiceRecordingId : ''
      if (this.data.voiceState === 'sealed' && !voiceRecordingId) {
        wx.showToast({ title: '语音与当前提交不一致，请重新录制', icon: 'none' }); return
      }
      const manualScores = this.data.manualScoreRows.map(row => ({ itemId: row.id, score: row.score }))
      if (manualScores.some(item => item.score === null)) {
        wx.showToast({ title: '请完成每项主观内容评分', icon: 'none' }); return
      }
      if (manualScores.length && this.data.scoringItems.length
        && previewWeightedReviewScore(this.data.scoringItems, this.data.manualScoreRows) === null) {
        wx.showToast({ title: '总分暂无法核对，请重新读取作业', icon: 'none' }); return
      }
      if (decision === 'returned' && !this.data.comment.trim()) {
        wx.showToast({ title: '退回重做必须填写原因', icon: 'none' })
        return
      }
      if (decision === 'returned' && !manualScores.length && this.data.score === null) {
        wx.showToast({ title: '退回前请先评分', icon: 'none' }); return
      }
      if (decision === 'approved' && !this.data.comment.trim() && this.data.score === null
        && !manualScores.length && !voiceRecordingId) {
        wx.showToast({ title: '请先填写评语或评分', icon: 'none' })
        return
      }
      if (this.data.hasRecordingTask && !manualScores.length) {
        wx.showToast({ title: '请先读取录音作答并逐项评分', icon: 'none' }); return
      }
      if (this.data.automaticScore !== null && this.data.score !== null
        && this.data.score !== this.data.automaticScore && !this.data.overrideReason.trim()) {
        wx.showToast({ title: '覆盖自动分请填写原因', icon: 'none' }); return
      }
      if (decision === 'approved') {
        const score = reviewScoreForConfirmation(this.data.manualScoreRows, this.data.scoringItems,
          this.data.score, this.data.automaticScore)
        const confirmed = await new Promise<boolean>(resolve => wx.showModal({ title: '确认发布点评',
          content: `${row.studentName} · 第 ${row.submissionVersion} 次提交\n${score === null ? '最终分数当前无法预览' : `将发布 ${score} 分`}\n评语：${this.data.comment.trim() || '无'}${voiceRecordingId ? '\n包含语音评语' : ''}`,
          confirmText: '确认发布', cancelText: '继续编辑', success: result => resolve(result.confirm), fail: () => resolve(false) }))
        if (!confirmed || this.data.reviewingId || this.data.activeRowId !== row.assignmentId
          || this.data.selectedSubmissionId !== row.submissionId || this.data.viewingHistory) return
      }
      const intentKey = `${row.assignmentId}:${decision}`
      const itemScores = manualScores.length
        ? manualScores.map(item => ({ itemId: item.itemId, score: item.score! })) : undefined
      const intentFingerprint = JSON.stringify({ taskId: this.data.taskId, assignmentId: row.assignmentId, submissionId: row.submissionId, submissionVersion: row.submissionVersion, decision, score: this.data.score, itemScores, comment: this.data.comment.trim(), voiceRecordingId, overrideReason: this.data.overrideReason.trim() })
      const currentIntent = this.data.reviewIntents[intentKey] ?? EMPTY_WRITE_INTENT
      const reviewIntent = prepareWriteIntent(currentIntent, intentFingerprint, () => createPageOperationId('publish_review'))
      this.setData({ reviewingId: row.assignmentId, reviewIntents: { ...this.data.reviewIntents, [intentKey]: reviewIntent } })
      const result = await reviewSubmission(session.user.id, {
        operationId: reviewIntent.operationId,
        expectedVersion: row.submissionVersion,
        taskId: this.data.taskId,
        assignmentId: row.assignmentId,
        decision,
        ...(itemScores === undefined && this.data.score !== null ? { score: this.data.score } : {}),
        ...(itemScores === undefined ? {} : { itemScores }),
        ...(this.data.overrideReason.trim() ? { overrideReason: this.data.overrideReason.trim() } : {}),
        comment: this.data.comment,
        ...(this.data.aiSuggestionAdopted && this.data.aiSuggestion ? { aiSuggestionId: this.data.aiSuggestion.id } : {}),
        ...(voiceRecordingId ? { voiceRecordingId } : {}),
      })
      this.setData({ reviewingId: '' })
      if (!result.ok) { wx.showToast({ title: result.error.message, icon: 'none' }); return }
      setTeacherReviewScoreDraft(null)
      this.setData({ reviewIntents: {}, comment: '', score: null, scoreInput: '', scoreError: '', overrideReason: '',
        voiceState: 'idle', voiceLocalPath: '', voiceDurationMs: 0, voiceDurationLabel: '0:00',
        voiceDraft: null, voiceRecordingId: '', voicePlaying: false,
        voiceBeginIntent: EMPTY_WRITE_INTENT,
        voiceSealIntent: EMPTY_WRITE_INTENT })
      wx.showToast({ title: decision === 'approved' ? '点评已发布' : '已退回重做', icon: 'success' })
      this.loadRows()
    },
    async approve() {
      if (this.data.activeRow) await this.publishReview(this.data.activeRow, 'approved')
    },
    async returned() {
      const row = this.data.activeRow
      if (!row || this.data.reviewingId || this.data.submissionLoading || this.data.taskItemsLoading
        || this.data.submissionError || this.data.taskItemsError || this.data.viewingHistory) {
        if (row) wx.showToast({ title: '请先读取当前作业详情', icon: 'none' })
        return
      }
      if (!this.data.comment.trim()) { wx.showToast({ title: '退回重做必须填写原因', icon: 'none' }); return }
      const score = this.data.manualScoreRows.length
        ? previewWeightedReviewScore(this.data.scoringItems, this.data.manualScoreRows) : this.data.score
      if (this.data.scoreError || this.data.manualScoreRows.some(item => item.score === null)
        || score === null && (!this.data.manualScoreRows.length || this.data.scoringItems.length > 0)) {
        wx.showToast({ title: '请完成评分并核对总分', icon: 'none' }); return
      }
      wx.showModal({ title: '确认退回重做',
        content: `${row.studentName} · ${score === null ? '总分由服务端计算，当前无法预览' : `${score} 分`}\n退回原因：${this.data.comment.trim()}\n确认后学生需重新完成作业。`,
        confirmText: '确认退回', success: async result => { if (result.confirm) await this.publishReview(row, 'returned') } })
    },
  },
})
