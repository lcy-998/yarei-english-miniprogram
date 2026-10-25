import type { M3TaskMediaPlaybackView, M3TaskMediaSnapshotView, SchoolQuestionType } from '../domain/types'
import type { TeacherTaskMediaReviewEvidenceView } from '../domain/teacher-media'
import type { TeacherReviewSubmissionView } from '../services/cloudbase-app-service'
import { getTeacherReviewScoreDraft, setTeacherReviewScoreDraft } from '../session/session'
import { parseReviewScoreInput } from './review-task-state'
import { teacherMediaProgressLabel, teacherMediaQuestionRows } from './teacher-task-media-view'
import type { TeacherReviewRoute } from './teacher-review-item'

export function teacherReviewScoreState(route: TeacherReviewRoute,
  submission: TeacherReviewSubmissionView) {
  const scoring = submission.scoringItems?.find(item => item.itemId === route.itemId)
  const draft = getTeacherReviewScoreDraft()
  const parsed = parseReviewScoreInput(draft?.submissionId === route.submissionId
    && draft.itemId === route.itemId ? draft.input : '')
  return { teacherScoreRequired: scoring?.teacherScoreRequired ?? false,
    teacherScoreInput: parsed.input, teacherScoreError: parsed.error }
}

export function updateTeacherReviewScore(route: TeacherReviewRoute, raw: string) {
  const parsed = parseReviewScoreInput(raw)
  setTeacherReviewScoreDraft({ submissionId: route.submissionId, itemId: route.itemId,
    input: parsed.input })
  return { teacherScoreInput: parsed.input, teacherScoreError: parsed.error }
}

function questionType(value: string): SchoolQuestionType {
  return value === 'single_choice' || value === 'multiple_choice'
    || value === 'fill' || value === 'subjective' ? value : 'subjective'
}

/** Reuses the student's media layout with evidence from an authorized submission. */
export function teacherReviewMediaView(evidence: TeacherTaskMediaReviewEvidenceView) {
  const snapshot: M3TaskMediaSnapshotView = {
    kind: evidence.kind, mediaId: evidence.itemId, mediaVersion: evidence.mediaVersion,
    reviewVersion: 0, durationMs: evidence.durationMs,
    questionIds: evidence.questions.map(item => item.questionId),
    questions: evidence.questions.map(item => ({ questionId: item.questionId,
      questionType: questionType(item.questionType), stem: item.stem, options: [...item.options] })),
    clips: evidence.questions.flatMap(item => item.clip ? [{ questionId: item.questionId,
      ...item.clip }] : []),
    subtitleAvailable: evidence.subtitleCues.length > 0,
    subtitleCues: evidence.subtitleCues.map(cue => ({ ...cue })),
    continuousPlaybackEnforced: true,
  }
  const playback: M3TaskMediaPlaybackView = {
    status: evidence.sourcePlayback.available ? 'ready' : 'unavailable',
    mediaId: evidence.itemId, mediaVersion: evidence.mediaVersion,
    sessionId: null, temporaryUrl: evidence.sourcePlayback.temporaryUrl,
    expiresAt: evidence.sourcePlayback.expiresAt, confirmedThroughMs: 0,
    seekForwardAllowed: false,
  }
  const reviewRows = teacherMediaQuestionRows(evidence.questions)
  const questions = evidence.questions.map((item, index) => {
    const row = reviewRows[index]!
    const type = questionType(item.questionType)
    return { questionId: item.questionId, stem: item.stem,
      questionType: type,
      typeLabel: type === 'single_choice' ? '单选题' : type === 'multiple_choice' ? '多选题'
        : type === 'fill' ? '填空题' : '问答题',
      choiceQuestion: type === 'single_choice' || type === 'multiple_choice',
      options: row.options, answerText: row.responseLabel,
      responseLabel: row.responseLabel, correctLabel: row.correctLabel,
      verdict: row.verdict, explanation: row.explanation,
      clip: row.clip, clipLabel: row.clipLabel,
    }
  })
  return { snapshot, playback, questions,
    progressLabel: teacherMediaProgressLabel(evidence) }
}
