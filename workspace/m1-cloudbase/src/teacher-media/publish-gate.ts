export type TeacherMediaTaskKind = 'listening' | 'video' | 'dubbing';

export interface TeacherMediaClip {
  readonly questionId: string;
  readonly segmentId: string;
  readonly startMs: number;
  readonly endMs: number;
}

export interface TeacherMediaQuestionView {
  readonly questionId: string;
  readonly questionType: 'single_choice' | 'multiple_choice' | 'fill' | 'subjective';
  readonly stem: string;
  readonly options: readonly string[];
}

export interface TeacherMediaSubtitleCue {
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
  readonly translationText?: string;
}

/** Stored only in the trusted publication snapshot; never projected to student task detail. */
export interface TeacherMediaAnswerKey {
  readonly questionId: string;
  readonly correctAnswer: string | readonly string[] | null;
  readonly explanation: string;
}

export interface TeacherMediaCandidate {
  readonly id: string;
  readonly organizationId: string;
  readonly title: string;
  readonly kind: TeacherMediaTaskKind;
  readonly version: number;
  readonly status: 'draft' | 'transcoding' | 'pending_review' | 'rejected' | 'approved' | 'published' | 'offline';
  readonly reviewVersion: number | null;
  readonly reviewedBy: string | null;
  readonly reviewedAt: string | null;
  readonly copyrightStatus: 'unverified' | 'verified';
  readonly copyrightEvidenceKey: string | null;
  readonly scanStatus: 'pending' | 'clean' | 'failed';
  readonly transcodeStatus: 'pending' | 'ready' | 'failed';
  /** Raw upload must pass malware screening before any decoder/transcoder consumes it. */
  readonly sourceScanEvidence: Readonly<{ engine: 'clamav' | 'ci'; signatureVersion: string;
    scannedAt: string; scannedSha256: string; reportId: string }> | null;
  /** Final output is scanned again before becoming task media. */
  readonly scanEvidence: Readonly<{ engine: 'clamav' | 'ci'; signatureVersion: string;
    scannedAt: string; scannedSha256: string; reportId: string }> | null;
  readonly transcodeEvidence: Readonly<{ engine: 'ffmpeg' | 'ci'; engineVersion: string;
    transcodedAt: string; sourceSha256: string; outputSha256: string;
    outputAssetKey: string }> | null;
  /** Private teacher uploads may use the separate direct-MP4 gate. */
  readonly directUploadEvidence?: Readonly<{ verifiedAt: string; mediaSha256: string;
    mediaAssetKey: string; durationMs: number; videoCodec: 'h264'; audioCodec: 'aac' | 'none' }> | null;
  readonly mediaAssetKey: string;
  readonly mediaSha256: string;
  readonly durationMs: number;
  readonly allowedClassIds: readonly string[];
  /** Set only by the controlled central import after all required checks pass. */
  readonly catalogScope?: 'all_teachers';
  readonly questionIds: readonly string[];
  readonly questions: readonly TeacherMediaQuestionView[];
  readonly answerKeys: readonly TeacherMediaAnswerKey[];
  readonly clips: readonly TeacherMediaClip[];
  readonly subtitleAssetKey?: string;
  readonly subtitleCues?: readonly TeacherMediaSubtitleCue[];
  /** True only after server-side continuous progress and no-forward validation is live. */
  readonly continuousPlaybackEnforced: boolean;
}

export interface FrozenTeacherMediaSnapshot {
  readonly mediaId: string;
  readonly kind: TeacherMediaTaskKind;
  readonly mediaVersion: number;
  readonly reviewVersion: number;
  readonly mediaAssetKey: string;
  readonly mediaSha256: string;
  readonly durationMs: number;
  readonly questionIds: readonly string[];
  readonly questions: readonly TeacherMediaQuestionView[];
  readonly answerKeys: readonly TeacherMediaAnswerKey[];
  readonly clips: readonly TeacherMediaClip[];
  readonly subtitleAssetKey?: string;
  readonly subtitleCues?: readonly TeacherMediaSubtitleCue[];
  readonly continuousPlaybackEnforced: true;
}

export type TeacherMediaGateResult =
  | Readonly<{ ready: true; snapshot: FrozenTeacherMediaSnapshot }>
  | Readonly<{ ready: false; reason: 'UNAUTHORIZED' | 'UNREVIEWED' | 'MEDIA_INVALID' | 'MAPPING_INCOMPLETE' | 'PLAYBACK_UNAVAILABLE' }>;

/** Called again at publication time; no client-provided readiness flags are trusted. */
export function freezeTeacherMediaForTask(candidate: TeacherMediaCandidate,
  organizationId: string, targetClassIds: readonly string[],
  policy: 'central' | 'teacher_private' = 'central'): TeacherMediaGateResult {
  if (!Array.isArray(candidate.allowedClassIds) || candidate.organizationId !== organizationId || targetClassIds.length === 0
    || (policy !== 'teacher_private' && candidate.catalogScope !== 'all_teachers'
      && targetClassIds.some(id => !candidate.allowedClassIds.includes(id)))) return { ready: false, reason: 'UNAUTHORIZED' };
  if (typeof candidate.title !== 'string' || !candidate.title.trim()
    || (policy === 'central' && (typeof candidate.copyrightEvidenceKey !== 'string'
      || !candidate.copyrightEvidenceKey.startsWith('cloud://')))
    || (policy === 'central' && (candidate.scanStatus !== 'clean' || candidate.transcodeStatus !== 'ready'))
    || typeof candidate.mediaAssetKey !== 'string' || !candidate.mediaAssetKey.startsWith('cloud://')
    || !/^[a-f0-9]{64}$/i.test(candidate.mediaSha256)
    || !Number.isSafeInteger(candidate.durationMs) || candidate.durationMs < 1000
    || candidate.durationMs > 30 * 60 * 1000) return { ready: false, reason: 'MEDIA_INVALID' };
  if (policy === 'central' ? !validProcessingEvidence(candidate)
    : !validProcessingEvidence(candidate) && !validDirectUploadEvidence(candidate)) {
    return { ready: false, reason: 'MEDIA_INVALID' };
  }
  if (!candidate.continuousPlaybackEnforced) return { ready: false, reason: 'PLAYBACK_UNAVAILABLE' };
  if (!Array.isArray(candidate.questionIds) || !Array.isArray(candidate.questions)
    || !Array.isArray(candidate.answerKeys) || !Array.isArray(candidate.clips)) {
    return { ready: false, reason: 'MAPPING_INCOMPLETE' };
  }
  if (!uniqueNonemptyOrEmpty(candidate.questionIds)
    || candidate.questions.length !== candidate.questionIds.length
    || candidate.answerKeys.length !== candidate.questionIds.length
    || candidate.questions.some((question, index) => !question || typeof question !== 'object'
      || question.questionId !== candidate.questionIds[index]
      || !validQuestionOptions(question) || !question.stem.trim())
    || candidate.answerKeys.some((answer, index) => !answer || typeof answer !== 'object'
      || answer.questionId !== candidate.questionIds[index]
      || !validAnswerKey(candidate.questions[index]!, answer))) {
    return { ready: false, reason: 'MAPPING_INCOMPLETE' };
  }
  if (candidate.kind !== 'listening' && candidate.kind !== 'video' && candidate.kind !== 'dubbing') {
    return { ready: false, reason: 'MAPPING_INCOMPLETE' };
  }
  if (candidate.kind === 'listening') {
    if (candidate.questionIds.length < 3 || candidate.questionIds.length > 10
      || !uniqueNonempty(candidate.questionIds) || candidate.clips.length !== candidate.questionIds.length
      || candidate.clips.some(clip => !clip || typeof clip !== 'object')
      || !uniqueNonempty(candidate.clips.map(clip => clip.questionId))
      || !uniqueNonempty(candidate.clips.map(clip => clip.segmentId))
      || candidate.clips.some(clip => !clip || typeof clip !== 'object'
        || !candidate.questionIds.includes(clip.questionId)
        || !Number.isSafeInteger(clip.startMs) || !Number.isSafeInteger(clip.endMs)
        || clip.startMs < 0 || clip.endMs > candidate.durationMs || clip.startMs >= clip.endMs)) {
      return { ready: false, reason: 'MAPPING_INCOMPLETE' };
    }
  } else if (candidate.clips.length > 0) {
    return { ready: false, reason: 'MAPPING_INCOMPLETE' };
  }
  if (candidate.kind === 'dubbing' && (candidate.questionIds.length > 0
    || !candidate.subtitleAssetKey?.startsWith('cloud://')
    || !validSubtitleCues(candidate.subtitleCues, candidate.durationMs))) {
    return { ready: false, reason: 'MEDIA_INVALID' };
  }
  if (candidate.status !== 'published' || candidate.reviewVersion !== candidate.version
    || typeof candidate.reviewedBy !== 'string' || !candidate.reviewedBy.trim()
    || typeof candidate.reviewedAt !== 'string' || !Number.isFinite(Date.parse(candidate.reviewedAt))
    || (policy === 'central' && candidate.copyrightStatus !== 'verified')) {
    return { ready: false, reason: 'UNREVIEWED' };
  }
  return { ready: true, snapshot: {
    mediaId: candidate.id, kind: candidate.kind, mediaVersion: candidate.version,
    reviewVersion: candidate.reviewVersion, mediaAssetKey: candidate.mediaAssetKey,
    mediaSha256: candidate.mediaSha256, durationMs: candidate.durationMs,
    questionIds: [...candidate.questionIds], questions: candidate.questions.map(question => ({
      ...question, options: [...question.options],
    })), answerKeys: candidate.answerKeys.map(answer => ({ ...answer,
      correctAnswer: Array.isArray(answer.correctAnswer) ? [...answer.correctAnswer] : answer.correctAnswer,
    })), clips: candidate.clips.map(clip => ({ ...clip })),
    ...(candidate.subtitleAssetKey === undefined ? {} : { subtitleAssetKey: candidate.subtitleAssetKey }),
    ...(candidate.subtitleCues === undefined ? {} : { subtitleCues: candidate.subtitleCues.map(cue => ({ ...cue })) }),
    continuousPlaybackEnforced: true,
  } };
}

function validDirectUploadEvidence(candidate: TeacherMediaCandidate): boolean {
  const proof = candidate.directUploadEvidence;
  return candidate.kind === 'video' && !!proof
    && typeof proof.verifiedAt === 'string' && Number.isFinite(Date.parse(proof.verifiedAt))
    && typeof proof.mediaSha256 === 'string'
    && proof.mediaSha256.toLowerCase() === candidate.mediaSha256.toLowerCase()
    && proof.mediaAssetKey === candidate.mediaAssetKey
    && proof.durationMs === candidate.durationMs
    && proof.videoCodec === 'h264'
    && (proof.audioCodec === 'aac' || proof.audioCodec === 'none');
}

function validProcessingEvidence(candidate: TeacherMediaCandidate): boolean {
  const scan = candidate.scanEvidence;
  const sourceScan = candidate.sourceScanEvidence;
  const transcode = candidate.transcodeEvidence;
  return !!sourceScan && !!scan && !!transcode
    && (sourceScan.engine === 'clamav' || sourceScan.engine === 'ci')
    && typeof sourceScan.signatureVersion === 'string' && sourceScan.signatureVersion.trim().length > 0
    && typeof sourceScan.reportId === 'string' && sourceScan.reportId.trim().length > 0
    && typeof sourceScan.scannedAt === 'string' && Number.isFinite(Date.parse(sourceScan.scannedAt))
    && typeof sourceScan.scannedSha256 === 'string' && /^[a-f0-9]{64}$/i.test(sourceScan.scannedSha256)
    && (scan.engine === 'clamav' || scan.engine === 'ci')
    && typeof scan.signatureVersion === 'string' && scan.signatureVersion.trim().length > 0
    && typeof scan.reportId === 'string' && scan.reportId.trim().length > 0
    && typeof scan.scannedAt === 'string' && Number.isFinite(Date.parse(scan.scannedAt))
    && typeof scan.scannedSha256 === 'string' && scan.scannedSha256.toLowerCase() === candidate.mediaSha256.toLowerCase()
    && (transcode.engine === 'ffmpeg' || transcode.engine === 'ci')
    && typeof transcode.engineVersion === 'string' && transcode.engineVersion.trim().length > 0
    && typeof transcode.transcodedAt === 'string' && Number.isFinite(Date.parse(transcode.transcodedAt))
    && Date.parse(sourceScan.scannedAt) <= Date.parse(transcode.transcodedAt)
    && typeof transcode.sourceSha256 === 'string'
    && transcode.sourceSha256.toLowerCase() === sourceScan.scannedSha256.toLowerCase()
    && Date.parse(scan.scannedAt) >= Date.parse(transcode.transcodedAt)
    && typeof transcode.outputSha256 === 'string' && transcode.outputSha256.toLowerCase() === candidate.mediaSha256.toLowerCase()
    && transcode.outputAssetKey === candidate.mediaAssetKey;
}

function validQuestionOptions(question: TeacherMediaQuestionView): boolean {
  if (!['single_choice', 'multiple_choice', 'fill', 'subjective'].includes(question.questionType)
    || typeof question.stem !== 'string') return false;
  if (!Array.isArray(question.options) || question.options.some(option => typeof option !== 'string' || !option.trim())) return false;
  return question.questionType === 'single_choice' || question.questionType === 'multiple_choice'
    ? question.options.length >= 2 : question.options.length === 0;
}

function validAnswerKey(question: TeacherMediaQuestionView, answer: TeacherMediaAnswerKey): boolean {
  if (question.questionType === 'subjective') return answer.correctAnswer === null
    && typeof answer.explanation === 'string';
  if (typeof answer.explanation !== 'string') return false;
  if (question.questionType === 'multiple_choice') {
    return Array.isArray(answer.correctAnswer) && answer.correctAnswer.length > 0
      && answer.correctAnswer.every(value => typeof value === 'string' && value.trim().length > 0
        && question.options.includes(value));
  }
  return typeof answer.correctAnswer === 'string' && answer.correctAnswer.trim().length > 0
    && (question.questionType !== 'single_choice' || question.options.includes(answer.correctAnswer));
}

function validSubtitleCues(cues: readonly TeacherMediaSubtitleCue[] | undefined, durationMs: number): boolean {
  return Array.isArray(cues) && cues.length > 0 && cues.every(cue => cue && typeof cue === 'object' &&
    Number.isSafeInteger(cue.startMs) && Number.isSafeInteger(cue.endMs)
    && cue.startMs >= 0 && cue.endMs > cue.startMs && cue.endMs <= durationMs
    && cue.text.trim().length > 0
    && (cue.translationText === undefined || typeof cue.translationText === 'string'
      && cue.translationText.trim().length <= 500));
}

function uniqueNonempty(ids: readonly string[]): boolean {
  return ids.length > 0 && uniqueNonemptyOrEmpty(ids);
}

function uniqueNonemptyOrEmpty(ids: readonly string[]): boolean {
  return ids.every(id => typeof id === 'string' && id.trim().length > 0)
    && new Set(ids).size === ids.length;
}
