import type { M3TaskMediaPlaybackView, M3TaskMediaSnapshotView } from '../domain/types'
import type { TeacherAssetPreview } from '../domain/teacher-media'

/** A display-only view of an authorised asset for the student task pages. */
export function teacherMediaTaskPreview(asset: TeacherAssetPreview): {
  snapshot: M3TaskMediaSnapshotView
  playback: M3TaskMediaPlaybackView
  questions: Array<{ questionId: string; stem: string; questionType: string;
    typeLabel: string; choiceQuestion: boolean;
    options: Array<{ value: string; selected: boolean }>; answerText: string }>
} {
  return {
    snapshot: {
      kind: asset.kind, mediaId: asset.id, mediaVersion: asset.contentVersion,
      reviewVersion: 0, durationMs: asset.durationMs,
      questionIds: asset.questions.map(question => question.questionId),
      questions: [], clips: asset.clips, subtitleAvailable: asset.subtitles.length > 0,
      subtitleCues: asset.subtitles, continuousPlaybackEnforced: true,
    },
    playback: {
      status: 'ready', mediaId: asset.id, mediaVersion: asset.contentVersion,
      sessionId: null, temporaryUrl: asset.playback.temporaryUrl,
      expiresAt: asset.playback.expiresAt, confirmedThroughMs: 0,
      seekForwardAllowed: false,
    },
    questions: asset.questions.map(question => ({
      questionId: question.questionId, stem: question.stem,
      questionType: 'preview', typeLabel: question.options.length ? '选择题' : '文字作答',
      choiceQuestion: question.options.length > 0,
      options: question.options.map(value => ({ value, selected: false })), answerText: '',
    })),
  }
}
