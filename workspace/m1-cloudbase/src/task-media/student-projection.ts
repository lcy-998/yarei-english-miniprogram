import type { FrozenTeacherMediaSnapshot } from '../teacher-media/publish-gate';

export interface StudentTaskMediaSnapshotView {
  readonly kind: FrozenTeacherMediaSnapshot['kind'];
  readonly mediaId: string;
  readonly mediaVersion: number;
  readonly reviewVersion: number;
  readonly durationMs: number;
  readonly questionIds: readonly string[];
  readonly questions: readonly Readonly<{ questionId: string; questionType: string;
    stem: string; options: readonly string[] }>[];
  readonly clips: readonly Readonly<{ questionId: string; segmentId: string;
    startMs: number; endMs: number }>[];
  readonly subtitleAvailable: boolean;
  readonly subtitleCues?: readonly Readonly<{ startMs: number; endMs: number; text: string;
    translationText?: string }>[];
  readonly continuousPlaybackEnforced: true;
}

/** Never exposes answer keys, explanations or cloud:// paths to an unfinished student task. */
export function projectTaskMediaSnapshotForStudent(
  snapshot: FrozenTeacherMediaSnapshot): StudentTaskMediaSnapshotView {
  return { kind: snapshot.kind, mediaId: snapshot.mediaId,
    mediaVersion: snapshot.mediaVersion, reviewVersion: snapshot.reviewVersion,
    durationMs: snapshot.durationMs, questionIds: [...snapshot.questionIds],
    questions: snapshot.questions.map(question => ({ questionId: question.questionId,
      questionType: question.questionType, stem: question.stem, options: [...question.options] })),
    clips: snapshot.clips.map(clip => ({ ...clip })),
    subtitleAvailable: Boolean(snapshot.subtitleAssetKey),
    ...(snapshot.subtitleCues === undefined ? {} : { subtitleCues: snapshot.subtitleCues.map(cue => ({ ...cue })) }),
    continuousPlaybackEnforced: true };
}
