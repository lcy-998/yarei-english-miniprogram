import type { M3TaskMediaPlaybackView, M3TaskMediaSnapshotView, TaskCompletionValue, TaskDetailView,
  TaskDubbingWorkView } from '../domain/types'
import { confirmedSeekTarget } from '../pages/student/student-media-preferences'

export function taskMediaPlaybackReady(snapshot: M3TaskMediaSnapshotView,
  playback: M3TaskMediaPlaybackView, nowMs: number): boolean {
  return snapshot.continuousPlaybackEnforced === true && playback.status === 'ready'
    && snapshot.mediaId === playback.mediaId && snapshot.mediaVersion === playback.mediaVersion
    && playback.seekForwardAllowed === false && typeof playback.sessionId === 'string'
    && playback.sessionId.length > 0 && typeof playback.temporaryUrl === 'string'
    && playback.temporaryUrl.startsWith('https://') && typeof playback.expiresAt === 'string'
    && Date.parse(playback.expiresAt) > nowMs
    && Number.isSafeInteger(snapshot.durationMs) && snapshot.durationMs > 0
    && Number.isSafeInteger(playback.confirmedThroughMs)
    && playback.confirmedThroughMs >= 0 && playback.confirmedThroughMs <= snapshot.durationMs
}

export function taskMediaSeekTarget(requestedMs: number, snapshot: M3TaskMediaSnapshotView,
  playback: M3TaskMediaPlaybackView): number {
  return Math.round(confirmedSeekTarget(requestedMs, snapshot.durationMs,
    playback.confirmedThroughMs, true))
}

/** Only the server-confirmed continuous position can unlock formal submission. */
export function taskMediaSubmissionReady(snapshot: M3TaskMediaSnapshotView,
  playback: M3TaskMediaPlaybackView, nowMs: number): boolean {
  if (!taskMediaPlaybackReady(snapshot, playback, nowMs)) return false
  const requiredMs = snapshot.kind === 'video' ? Math.ceil(snapshot.durationMs * 0.9) : snapshot.durationMs
  return playback.confirmedThroughMs >= requiredMs
}

/** Completion survives expiry of the temporary playback URL; the confirmed position is server-owned. */
export function taskMediaPlaybackCompleted(snapshot: M3TaskMediaSnapshotView,
  playback: M3TaskMediaPlaybackView): boolean {
  if (snapshot.continuousPlaybackEnforced !== true
    || snapshot.mediaId !== playback.mediaId || snapshot.mediaVersion !== playback.mediaVersion
    || playback.seekForwardAllowed !== false
    || (playback.status !== 'ready' && playback.status !== 'expired')
    || !Number.isSafeInteger(snapshot.durationMs) || snapshot.durationMs <= 0
    || !Number.isSafeInteger(playback.confirmedThroughMs)
    || playback.confirmedThroughMs < 0 || playback.confirmedThroughMs > snapshot.durationMs) return false
  const requiredMs = snapshot.kind === 'video'
    ? Math.ceil(snapshot.durationMs * 0.9) : snapshot.durationMs
  return playback.confirmedThroughMs >= requiredMs
}

export function taskMediaAnswersComplete(snapshot: M3TaskMediaSnapshotView,
  answers: MediaQuestionAnswers, finalWorkId = ''): boolean {
  if (snapshot.kind === 'dubbing') return Boolean(finalWorkId.trim())
  return snapshot.questionIds.every(questionId => {
    const answer = answers[questionId]
    return typeof answer === 'string' ? Boolean(answer.trim())
      : Array.isArray(answer) && answer.length > 0
        && answer.every(value => typeof value === 'string' && value.trim().length > 0)
  })
}

export function sealedTaskDubbingWorkId(work: TaskDubbingWorkView | null,
  taskId: string, itemId: string, round: number): string {
  return work?.status === 'submitted' && work.taskId === taskId
    && work.itemId === itemId && work.round === round ? work.workId : ''
}

export function listeningClipForQuestion(snapshot: M3TaskMediaSnapshotView,
  questionId: string): Readonly<{ segmentId: string; startMs: number; endMs: number }> | null {
  if (snapshot.kind !== 'listening' || !snapshot.questionIds.includes(questionId)) return null
  const clip = snapshot.clips.find(item => item.questionId === questionId)
  if (!clip || !clip.segmentId || !Number.isSafeInteger(clip.startMs)
    || !Number.isSafeInteger(clip.endMs) || clip.startMs < 0
    || clip.endMs <= clip.startMs || clip.endMs > snapshot.durationMs) return null
  return { segmentId: clip.segmentId, startMs: clip.startMs, endMs: clip.endMs }
}

export type MediaQuestionAnswers = Readonly<Record<string, string | readonly string[]>>

/** Cloud drafts remain available after the login session (and local draft key) changes. */
export function savedTaskMediaAnswers(detail: TaskDetailView, itemId: string,
  snapshot: M3TaskMediaSnapshotView): Record<string, string | string[]> {
  if (detail.submission?.status !== 'draft') return {}
  const value = detail.submission.answers.find(answer => answer.taskItemId === itemId)?.structuredValue
  if (!value || value.kind !== snapshot.kind
    || (value.kind !== 'listening' && value.kind !== 'video')) return {}
  const answers: Record<string, string | string[]> = {}
  for (const response of value.questionResponses ?? []) {
    if (snapshot.questionIds.includes(response.questionId)) answers[response.questionId] =
      Array.isArray(response.response) ? [...response.response] : response.response
  }
  return answers
}

export function mediaQuestionRows(snapshot: M3TaskMediaSnapshotView,
  answers: MediaQuestionAnswers): Array<{ questionId: string; stem: string; questionType: string;
    typeLabel: string; choiceQuestion: boolean;
    options: Array<{ value: string; selected: boolean }>; answerText: string }> {
  return snapshot.questions.map(question => {
    const answer = answers[question.questionId]
    const choiceQuestion = question.questionType === 'single_choice' || question.questionType === 'multiple_choice'
    return { questionId: question.questionId, stem: question.stem,
      questionType: question.questionType,
      typeLabel: question.questionType === 'single_choice' ? '单选题'
        : question.questionType === 'multiple_choice' ? '多选题'
          : question.questionType === 'fill' ? '填空题' : '问答题',
      choiceQuestion,
      options: (choiceQuestion ? question.options : []).map(value => ({ value,
        selected: Array.isArray(answer) ? answer.includes(value) : answer === value })),
      answerText: typeof answer === 'string' ? answer : '',
    }
  })
}

/** Only original answers and a server session reference enter the submit request. */
export function mediaSubmissionValue(snapshot: M3TaskMediaSnapshotView, mediaSessionId: string,
  answers: MediaQuestionAnswers, finalWorkId = ''): TaskCompletionValue | null {
  if (!mediaSessionId.trim()) return null
  if (snapshot.kind === 'dubbing') return finalWorkId.trim()
    ? { kind: 'dubbing', mediaSessionId, finalWorkId: finalWorkId.trim() } : null
  const responses = snapshot.questionIds.map(questionId => {
    const value = answers[questionId]
    return value === undefined ? null
      : typeof value === 'string' && value.trim() ? { questionId, response: value.trim() }
        : Array.isArray(value) && value.length && value.every(part => typeof part === 'string' && part.trim())
          ? { questionId, response: [...value] } : null
  })
  if (responses.some(response => response === null)) return null
  if (snapshot.kind === 'listening') return { kind: 'listening', mediaSessionId,
    questionResponses: responses as Array<{ questionId: string; response: string | string[] }> }
  return { kind: 'video', mediaSessionId,
    ...(responses.length ? { questionResponses: responses as Array<{ questionId: string; response: string | string[] }> } : {}) }
}

/** A draft may contain fewer answers than a formal submission. */
export function mediaDraftValue(snapshot: M3TaskMediaSnapshotView, mediaSessionId: string,
  answers: MediaQuestionAnswers, finalWorkId = ''): TaskCompletionValue | null {
  if (!mediaSessionId.trim()) return null
  if (snapshot.kind === 'dubbing') return mediaSubmissionValue(snapshot, mediaSessionId, answers, finalWorkId)
  const questionResponses: Array<{ questionId: string; response: string | string[] }> = []
  for (const questionId of snapshot.questionIds) {
    const value = answers[questionId]
    if (typeof value === 'string' && value.trim()) {
      questionResponses.push({ questionId, response: value.trim() })
      continue
    }
    if (Array.isArray(value) && value.length && value.every(part => typeof part === 'string' && part.trim())) {
      questionResponses.push({ questionId, response: [...value] })
    }
  }
  if (snapshot.kind === 'listening') return questionResponses.length
    ? { kind: 'listening', mediaSessionId, questionResponses } : null
  return { kind: 'video', mediaSessionId,
    ...(questionResponses.length ? { questionResponses } : {}) }
}
