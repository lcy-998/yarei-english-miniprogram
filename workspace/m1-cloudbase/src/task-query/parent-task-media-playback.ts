import { AuthorizationService } from '../auth/authorization-service';
import type { TrustedActorContext } from '../auth/trusted-actor';
import type { IdentityRepository } from '../runtime/ports';
import type { TaskRecordingPlaybackPort } from '../task-recording/repository';
import { dubbingAudioExpired } from '../media-retention/policy';
import type { TaskMediaSubmissionPort, SealedTaskDubbingWork } from '../task-media/submission-evidence';
import type { TaskQueryRepository } from './repository';
import { parentSafeAnswers } from './parent-answer-projection';

export interface ParentTaskMediaPlaybackView {
  readonly kind: 'listening' | 'video' | 'dubbing';
  readonly status: 'ready' | 'expired' | 'unavailable';
  readonly durationMs: number | null;
  readonly playback: Readonly<{ temporaryUrl: string; expiresAt: string }> | null;
  readonly clips?: readonly Readonly<{ questionId: string; startMs: number; endMs: number }>[];
}

export interface ParentTaskMediaAudit {
  record(actor: TrustedActorContext, taskId: string, itemId: string,
    submissionVersion: number, mediaId: string, at: string): Promise<void>;
}

export class ParentTaskMediaError extends Error {
  public constructor(public readonly code: 'VALIDATION_ERROR' | 'NOT_FOUND' | 'SERVICE_UNAVAILABLE') {
    super(code); this.name = 'ParentTaskMediaError';
  }
}
function validId(value: string): boolean { return /^[A-Za-z0-9_-]{1,256}$/.test(value); }
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Parent playback never opens a student media session or records student progress. */
export class ParentTaskMediaPlaybackService {
  private readonly authorization: AuthorizationService;
  public constructor(private readonly tasks: TaskQueryRepository, identities: IdentityRepository,
    private readonly playback: TaskRecordingPlaybackPort | null,
    private readonly audit: ParentTaskMediaAudit | null,
    private readonly clock: { nowIso(): string },
    private readonly works: TaskMediaSubmissionPort | null = null) {
    this.authorization = new AuthorizationService(identities);
  }

  public async getPlayback(actor: TrustedActorContext, input: Readonly<{
    childId: string; taskId: string; assignmentId: string; submissionVersion: number; itemId: string;
  }>): Promise<ParentTaskMediaPlaybackView> {
    if (![input.childId, input.taskId, input.assignmentId, input.itemId].every(validId)
      || !Number.isSafeInteger(input.submissionVersion) || input.submissionVersion < 1) {
      throw new ParentTaskMediaError('VALIDATION_ERROR');
    }
    if (!(await this.authorization.canParentReadStudent(actor, input.childId)).allowed) {
      throw new ParentTaskMediaError('NOT_FOUND');
    }
    const [task, assignment, submissions] = await Promise.all([
      this.tasks.findTask(actor.organizationId, input.taskId),
      this.tasks.findAssignmentById(actor.organizationId, input.assignmentId),
      this.tasks.listTaskSubmissions(actor.organizationId, input.taskId),
    ]);
    const submission = submissions.find(item => item.assignmentId === input.assignmentId
      && item.studentId === input.childId && item.taskId === input.taskId
      && item.submissionVersion === input.submissionVersion && item.submittedAt !== null
      && item.status !== 'draft');
    const item = task?.items.find(row => row.id === input.itemId);
    const snapshot = item?.mediaSnapshot;
    if (!task || task.status === 'draft' || task.status === 'withdrawn' || !assignment
      || assignment.taskId !== input.taskId || assignment.studentId !== input.childId
      || !submission || !submission.submittedAt || !item || !snapshot
      || snapshot.kind !== item.resourceSnapshot.type || !snapshot.continuousPlaybackEnforced
      || snapshot.reviewVersion !== snapshot.mediaVersion || snapshot.mediaVersion !== item.resourceVersion
      || !/^[a-f0-9]{64}$/i.test(snapshot.mediaSha256)
      || !Number.isSafeInteger(snapshot.durationMs) || snapshot.durationMs < 1000
      || snapshot.durationMs > 30 * 60 * 1000) throw new ParentTaskMediaError('NOT_FOUND');
    const answer = submission.answers.find(row => row.itemId === input.itemId);
    if (!answer || !record(answer.value) || answer.value.kind !== snapshot.kind
      || answer.value.mediaId !== snapshot.mediaId || answer.value.mediaVersion !== snapshot.mediaVersion
      || typeof answer.value.mediaSessionId !== 'string' || !answer.value.mediaSessionId.trim()) {
      throw new ParentTaskMediaError('NOT_FOUND');
    }
    const safe = parentSafeAnswers(task, [answer], submission.submittedAt, this.clock.nowIso())[0]?.value;
    if (!record(safe) || safe.kind !== snapshot.kind) throw new ParentTaskMediaError('NOT_FOUND');
    if (snapshot.kind === 'dubbing') {
      return this.getDubbingPlayback(actor, input, snapshot.mediaId, snapshot.mediaVersion,
        answer.value, submission.submittedAt);
    }
    if (!snapshot.mediaAssetKey.startsWith('cloud://')) {
      return { kind: snapshot.kind, status: 'unavailable', durationMs: snapshot.durationMs, playback: null };
    }
    if (!this.playback || !this.audit) throw new ParentTaskMediaError('SERVICE_UNAVAILABLE');
    const clips = snapshot.kind === 'listening' ? snapshot.clips.map(clip => ({
      questionId: clip.questionId, startMs: clip.startMs, endMs: clip.endMs,
    })) : undefined;
    if (clips && (clips.length !== snapshot.questionIds.length
      || new Set(clips.map(clip => clip.questionId)).size !== clips.length
      || clips.some(clip => !snapshot.questionIds.includes(clip.questionId)
        || clip.startMs < 0 || clip.endMs <= clip.startMs || clip.endMs > snapshot.durationMs))) {
      throw new ParentTaskMediaError('NOT_FOUND');
    }
    let temporaryUrl: string;
    try { temporaryUrl = await this.playback.temporaryUrl(snapshot.mediaAssetKey); }
    catch { throw new ParentTaskMediaError('SERVICE_UNAVAILABLE'); }
    if (!/^https:\/\//.test(temporaryUrl)) throw new ParentTaskMediaError('SERVICE_UNAVAILABLE');
    if (!(await this.authorization.canParentReadStudent(actor, input.childId)).allowed) {
      throw new ParentTaskMediaError('NOT_FOUND');
    }
    await this.audit.record(actor, input.taskId, input.itemId,
      input.submissionVersion, snapshot.mediaId, this.clock.nowIso());
    return { kind: snapshot.kind, status: 'ready', durationMs: snapshot.durationMs,
      ...(clips === undefined ? {} : { clips }),
      playback: { temporaryUrl, expiresAt: new Date(Date.parse(this.clock.nowIso()) + 60_000).toISOString() } };
  }

  private async getDubbingPlayback(actor: TrustedActorContext, input: Readonly<{
    childId: string; taskId: string; assignmentId: string; submissionVersion: number; itemId: string;
  }>, mediaId: string, mediaVersion: number, answer: Record<string, unknown>,
  submittedAt: string): Promise<ParentTaskMediaPlaybackView> {
    const finalWorkId = answer.finalWorkId;
    if (typeof finalWorkId !== 'string' || !validId(finalWorkId) || !this.works) {
      return { kind: 'dubbing', status: 'unavailable', durationMs: null, playback: null };
    }
    const work = await this.works.findTaskDubbingWork(finalWorkId);
    if (!validDubbingWork(work, actor.organizationId, input, mediaId, mediaVersion, answer)) {
      throw new ParentTaskMediaError('NOT_FOUND');
    }
    if (!Number.isFinite(Date.parse(submittedAt))) throw new ParentTaskMediaError('NOT_FOUND');
    if (work.mediaDeletedAt != null || dubbingAudioExpired(submittedAt, this.clock.nowIso())) {
      return { kind: 'dubbing', status: 'expired', durationMs: work.recording.durationMs, playback: null };
    }
    if (!this.playback || !this.audit) throw new ParentTaskMediaError('SERVICE_UNAVAILABLE');
    let temporaryUrl: string;
    try { temporaryUrl = await this.playback.temporaryUrl(work.fileId); }
    catch { throw new ParentTaskMediaError('SERVICE_UNAVAILABLE'); }
    if (!/^https:\/\//.test(temporaryUrl)) throw new ParentTaskMediaError('SERVICE_UNAVAILABLE');
    const current = await this.works.findTaskDubbingWork(finalWorkId);
    if (!validDubbingWork(current, actor.organizationId, input, mediaId, mediaVersion, answer)
      || current.fileId !== work.fileId || current.contentSha256 !== work.contentSha256
      || current.mediaDeletedAt != null || dubbingAudioExpired(submittedAt, this.clock.nowIso())
      || !(await this.authorization.canParentReadStudent(actor, input.childId)).allowed) {
      throw new ParentTaskMediaError('NOT_FOUND');
    }
    await this.audit.record(actor, input.taskId, input.itemId,
      input.submissionVersion, mediaId, this.clock.nowIso());
    return { kind: 'dubbing', status: 'ready', durationMs: work.recording.durationMs,
      playback: { temporaryUrl, expiresAt: new Date(Date.parse(this.clock.nowIso()) + 60_000).toISOString() } };
  }
}

function validDubbingWork(work: SealedTaskDubbingWork | null, organizationId: string,
  input: Readonly<{ childId: string; taskId: string; assignmentId: string;
    submissionVersion: number; itemId: string }>, mediaId: string, mediaVersion: number,
  answer: Record<string, unknown>): work is SealedTaskDubbingWork {
  const recorded = record(answer.recording) ? answer.recording : null;
  return Boolean(work && work.status === 'submitted' && work.organizationId === organizationId
    && work.studentId === input.childId && work.assignmentId === input.assignmentId
    && work.round === input.submissionVersion && work.taskId === input.taskId
    && work.itemId === input.itemId && work.mediaId === mediaId && work.mediaVersion === mediaVersion
    && work.fileId.startsWith('cloud://') && /^[a-f0-9]{64}$/i.test(work.contentSha256)
    && work.recording.serverReadable === true && Number.isSafeInteger(work.recording.durationMs)
    && work.recording.durationMs >= 1000 && work.recording.durationMs <= 300000
    && Number.isSafeInteger(work.recording.sizeBytes) && work.recording.sizeBytes > 0
    && work.recording.sizeBytes <= 20 * 1024 * 1024
    && recorded && recorded.mediaId === work.recording.mediaId
    && recorded.durationMs === work.recording.durationMs
    && recorded.sizeBytes === work.recording.sizeBytes && recorded.serverReadable === true);
}
