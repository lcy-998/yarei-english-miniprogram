import { AuthorizationService } from '../auth/authorization-service';
import type { TrustedActorContext } from '../auth/trusted-actor';
import { originalAudioExpired } from '../media-retention/policy';
import type { IdentityRepository } from '../runtime/ports';
import type { TaskRecordingPlaybackPort, TaskRecordingUnitOfWork } from '../task-recording/repository';
import type { TaskRecordingRecord } from '../task-recording/types';
import type { TaskQueryRepository } from './repository';

export interface ParentMediaPlaybackView {
  readonly status: 'ready' | 'expired' | 'unavailable';
  readonly durationMs: number | null;
  readonly playback: Readonly<{ temporaryUrl: string; expiresAt: string }> | null;
}

export interface ParentPlaybackAuditPort {
  record(actor: TrustedActorContext, recording: TaskRecordingRecord, at: string): Promise<void>;
}

export class ParentMediaError extends Error {
  public constructor(public readonly code: 'VALIDATION_ERROR' | 'NOT_FOUND' | 'SERVICE_UNAVAILABLE') {
    super(code); this.name = 'ParentMediaError';
  }
}

function validId(value: string): boolean { return /^[A-Za-z0-9_-]{1,256}$/.test(value); }
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** No media ID crosses the parent request/response boundary. */
export class ParentMediaPlaybackService {
  private readonly authorization: AuthorizationService;

  public constructor(private readonly tasks: TaskQueryRepository,
    private readonly recordings: TaskRecordingUnitOfWork,
    identities: IdentityRepository,
    private readonly playback: TaskRecordingPlaybackPort | null,
    private readonly audit: ParentPlaybackAuditPort | null,
    private readonly clock: { nowIso(): string }) {
    this.authorization = new AuthorizationService(identities);
  }

  public async getRecording(actor: TrustedActorContext, input: Readonly<{
    childId: string; taskId: string; assignmentId: string; submissionVersion: number; itemId: string;
  }>): Promise<ParentMediaPlaybackView> {
    if (![input.childId, input.taskId, input.assignmentId, input.itemId].every(validId)
      || !Number.isSafeInteger(input.submissionVersion) || input.submissionVersion < 1) {
      throw new ParentMediaError('VALIDATION_ERROR');
    }
    if (!(await this.authorization.canParentReadStudent(actor, input.childId)).allowed) {
      throw new ParentMediaError('NOT_FOUND');
    }
    const [task, assignment, submissions] = await Promise.all([
      this.tasks.findTask(actor.organizationId, input.taskId),
      this.tasks.findAssignmentById(actor.organizationId, input.assignmentId),
      this.tasks.listTaskSubmissions(actor.organizationId, input.taskId),
    ]);
    const submitted = submissions.find(item => item.assignmentId === input.assignmentId
      && item.studentId === input.childId && item.taskId === input.taskId
      && item.submissionVersion === input.submissionVersion && item.submittedAt !== null);
    const taskItem = task?.items.find(item => item.id === input.itemId && item.resourceSnapshot.type === 'recording');
    if (!task || task.status === 'draft' || task.status === 'withdrawn' || !taskItem
      || !assignment || assignment.taskId !== input.taskId || assignment.studentId !== input.childId
      || !submitted) throw new ParentMediaError('NOT_FOUND');
    const answer = submitted.answers.find(item => item.itemId === input.itemId);
    if (!answer || !record(answer.value) || answer.value.kind !== 'recording'
      || typeof answer.value.recordingId !== 'string') throw new ParentMediaError('NOT_FOUND');
    const recordingId = answer.value.recordingId;
    const recording = await this.recordings.transaction(transaction =>
      transaction.findRecording(actor.organizationId, recordingId));
    if (!recording || recording.status !== 'submitted' || recording.organizationId !== actor.organizationId
      || recording.studentId !== input.childId || recording.taskId !== input.taskId
      || recording.assignmentId !== input.assignmentId || recording.submissionVersion !== input.submissionVersion
      || recording.classId !== assignment.classId || recording.itemId !== input.itemId
      || recording.resourceVersion !== taskItem.resourceVersion || recording.submittedAt === null
      || Date.parse(recording.submittedAt) > Date.parse(submitted.submittedAt as string)) {
      throw new ParentMediaError('NOT_FOUND');
    }
    const expired = Boolean(recording.mediaDeletedAt)
      || originalAudioExpired(submitted.submittedAt, this.clock.nowIso());
    if (expired) return { status: 'expired', durationMs: recording.durationMs, playback: null };
    if (!recording.fileId?.startsWith('cloud://')) {
      return { status: 'unavailable', durationMs: recording.durationMs, playback: null };
    }
    if (!this.playback || !this.audit) throw new ParentMediaError('SERVICE_UNAVAILABLE');
    let temporaryUrl: string;
    try { temporaryUrl = await this.playback.temporaryUrl(recording.fileId); }
    catch { throw new ParentMediaError('SERVICE_UNAVAILABLE'); }
    if (!/^https:\/\//.test(temporaryUrl)) throw new ParentMediaError('SERVICE_UNAVAILABLE');
    if (!(await this.authorization.canParentReadStudent(actor, input.childId)).allowed) {
      throw new ParentMediaError('NOT_FOUND');
    }
    await this.audit.record(actor, recording, this.clock.nowIso());
    return { status: 'ready', durationMs: recording.durationMs,
      playback: { temporaryUrl, expiresAt: new Date(Date.parse(this.clock.nowIso()) + 60_000).toISOString() } };
  }
}
