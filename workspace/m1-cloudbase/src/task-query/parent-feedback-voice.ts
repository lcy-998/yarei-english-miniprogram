import { AuthorizationService } from '../auth/authorization-service';
import type { TrustedActorContext } from '../auth/trusted-actor';
import type { IdentityRepository } from '../runtime/ports';
import type { ReviewFeedbackRecord } from '../task-core/types';
import type { TaskRecordingPlaybackPort } from '../task-recording/repository';
import type { TaskQueryRepository } from './repository';
import { teacherVoiceCommentExpired } from '../media-retention/policy';

interface PrivateVoiceComment {
  readonly recordingId: string;
  readonly fileId: string;
  readonly durationMs: number;
  readonly mediaVersion: number;
  readonly sha256: string;
  readonly mediaDeletedAt?: string | null;
}

export interface ParentVoiceCommentSummary {
  readonly available: boolean;
  readonly durationMs: number | null;
}

export interface ParentFeedbackVoicePlayback {
  readonly feedbackId: string;
  readonly temporaryUrl: string;
  readonly expiresAt: string;
  readonly durationMs: number;
}

export interface ParentFeedbackVoiceAudit {
  record(actor: TrustedActorContext, feedbackId: string, submissionVersion: number, at: string): Promise<void>;
}

export class ParentFeedbackVoiceError extends Error {
  public constructor(public readonly code: 'VALIDATION_ERROR' | 'NOT_FOUND' | 'SERVICE_UNAVAILABLE') {
    super(code); this.name = 'ParentFeedbackVoiceError';
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function privateVoice(feedback: ReviewFeedbackRecord): PrivateVoiceComment | null {
  const value = feedback.voiceComment;
  if (!record(value) || typeof value.recordingId !== 'string' || !value.recordingId.trim()
    || typeof value.fileId !== 'string' || !value.fileId.startsWith('cloud://')
    || !Number.isSafeInteger(value.durationMs) || Number(value.durationMs) < 1
    || !Number.isSafeInteger(value.mediaVersion) || Number(value.mediaVersion) < 1
    || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(value.sha256)
    || value.mediaDeletedAt !== undefined && value.mediaDeletedAt !== null) return null;
  return { recordingId: value.recordingId, fileId: value.fileId,
    durationMs: Number(value.durationMs), mediaVersion: Number(value.mediaVersion), sha256: value.sha256 };
}

/** The parent DTO never includes the private recording/file identifiers. */
export function parentVoiceCommentSummary(feedback: ReviewFeedbackRecord,
  at = feedback.publishedAt ?? ''): ParentVoiceCommentSummary | undefined {
  if (!('voiceComment' in feedback)) return undefined;
  const voice = privateVoice(feedback);
  return voice && !teacherVoiceCommentExpired(feedback.publishedAt, at)
    ? { available: true, durationMs: voice.durationMs }
    : { available: false, durationMs: null };
}

function validId(value: string): boolean { return /^[A-Za-z0-9_-]{1,256}$/.test(value); }

export class ParentFeedbackVoiceService {
  private readonly authorization: AuthorizationService;
  public constructor(private readonly tasks: TaskQueryRepository,
    identities: IdentityRepository,
    private readonly playback: TaskRecordingPlaybackPort | null,
    private readonly audit: ParentFeedbackVoiceAudit | null,
    private readonly clock: { nowIso(): string }) {
    this.authorization = new AuthorizationService(identities);
  }

  public async getPlayback(actor: TrustedActorContext, input: Readonly<{
    childId: string; taskId: string; assignmentId: string; submissionVersion: number; feedbackId: string;
  }>): Promise<ParentFeedbackVoicePlayback> {
    if (![input.childId, input.taskId, input.assignmentId, input.feedbackId].every(validId)
      || !Number.isSafeInteger(input.submissionVersion) || input.submissionVersion < 1) {
      throw new ParentFeedbackVoiceError('VALIDATION_ERROR');
    }
    if (!(await this.authorization.canParentReadStudent(actor, input.childId)).allowed) {
      throw new ParentFeedbackVoiceError('NOT_FOUND');
    }
    const [task, assignment, submissions] = await Promise.all([
      this.tasks.findTask(actor.organizationId, input.taskId),
      this.tasks.findAssignmentById(actor.organizationId, input.assignmentId),
      this.tasks.listTaskSubmissions(actor.organizationId, input.taskId),
    ]);
    const submitted = submissions.find(item => item.assignmentId === input.assignmentId
      && item.studentId === input.childId && item.taskId === input.taskId
      && item.submissionVersion === input.submissionVersion && item.submittedAt !== null);
    if (!task || task.status === 'draft' || task.status === 'withdrawn' || !assignment
      || assignment.taskId !== input.taskId || assignment.studentId !== input.childId || !submitted) {
      throw new ParentFeedbackVoiceError('NOT_FOUND');
    }
    const feedback = await this.tasks.findFeedback(actor.organizationId, submitted.id);
    if (!feedback || feedback.id !== input.feedbackId || feedback.submissionVersion !== input.submissionVersion
      || feedback.assignmentId !== input.assignmentId || feedback.taskId !== input.taskId
      || !feedback.publishedAt) throw new ParentFeedbackVoiceError('NOT_FOUND');
    const voice = privateVoice(feedback);
    if (!voice || teacherVoiceCommentExpired(feedback.publishedAt, this.clock.nowIso())) {
      throw new ParentFeedbackVoiceError('NOT_FOUND');
    }
    if (!this.playback || !this.audit) throw new ParentFeedbackVoiceError('SERVICE_UNAVAILABLE');
    let temporaryUrl: string;
    try { temporaryUrl = await this.playback.temporaryUrl(voice.fileId); }
    catch { throw new ParentFeedbackVoiceError('SERVICE_UNAVAILABLE'); }
    if (!/^https:\/\//.test(temporaryUrl)) throw new ParentFeedbackVoiceError('SERVICE_UNAVAILABLE');
    const latestFeedback = await this.tasks.findFeedback(actor.organizationId, submitted.id);
    const latestVoice = latestFeedback ? privateVoice(latestFeedback) : null;
    if (!latestFeedback || latestFeedback.id !== feedback.id || !latestVoice
      || latestVoice.fileId !== voice.fileId || latestVoice.sha256 !== voice.sha256) {
      throw new ParentFeedbackVoiceError('NOT_FOUND');
    }
    if (!(await this.authorization.canParentReadStudent(actor, input.childId)).allowed) {
      throw new ParentFeedbackVoiceError('NOT_FOUND');
    }
    if (teacherVoiceCommentExpired(feedback.publishedAt, this.clock.nowIso())) {
      throw new ParentFeedbackVoiceError('NOT_FOUND');
    }
    await this.audit.record(actor, feedback.id, input.submissionVersion, this.clock.nowIso());
    return { feedbackId: feedback.id, temporaryUrl,
      expiresAt: new Date(Date.parse(this.clock.nowIso()) + 60_000).toISOString(), durationMs: voice.durationMs };
  }
}
