import { hashHex } from '../shared/request-summary';
import type { TrustedActorContext } from '../auth/trusted-actor';
import { AuthorizationService } from '../auth/authorization-service';
import type { IdentityRepository } from '../runtime/ports';
import { isSubmittable } from '../task-core/task-core-service';
import type { TaskQueryRepository } from '../task-query/repository';
import type { TaskRecordingAccessAuditPort, TaskRecordingPlaybackPort, TaskRecordingSealPort,
  TaskRecordingUnitOfWork } from './repository';
import { TaskRecordingError, type TaskRecordingRecord } from './types';
import { originalAudioExpired } from '../media-retention/policy';

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_DURATION_MS = 5 * 60 * 1000;
const validOperation = (value: string): boolean => /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(value);

export class TaskRecordingService {
  private readonly authorization: AuthorizationService;
  public constructor(private readonly recordings: TaskRecordingUnitOfWork,
    private readonly tasks: TaskQueryRepository, identities: IdentityRepository,
    private readonly seal: TaskRecordingSealPort | null,
    private readonly playback: TaskRecordingPlaybackPort | null,
    private readonly clock: { nowIso(): string },
    private readonly ids: { next(prefix: string): string },
    private readonly audit: TaskRecordingAccessAuditPort | null = null) {
    this.authorization = new AuthorizationService(identities);
  }

  public async begin(actor: TrustedActorContext, taskId: string, itemId: string,
    operationId: string): Promise<TaskRecordingRecord> {
    this.studentOnly(actor);
    if (!validOperation(operationId) || !taskId.trim() || !itemId.trim()) throw new TaskRecordingError('VALIDATION_ERROR');
    const scope = await this.requireTaskScope(actor, taskId, itemId);
    const fingerprint = JSON.stringify({ action: 'begin', taskId, itemId });
    return this.recordings.transaction(async (transaction) => {
      const prior = await transaction.findReceipt(actor.organizationId, actor.actorUserId, operationId);
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new TaskRecordingError('CONFLICT');
        return prior.result;
      }
      const id = this.ids.next('task_recording');
      if (!/^[A-Za-z0-9_-]{8,128}$/.test(id)) throw new TaskRecordingError('SERVICE_UNAVAILABLE');
      const digest = hashHex(JSON.stringify([actor.organizationId, actor.actorUserId]));
      const record: TaskRecordingRecord = { id, organizationId: actor.organizationId, taskId, itemId,
        assignmentId: scope.assignment.id, submissionVersion: scope.assignment.latestSubmissionVersion + 1,
        studentId: actor.actorUserId, classId: scope.assignment.classId,
        resourceVersion: scope.item.resourceVersion,
        stagingPath: `task-recordings/staging/${digest}/${id}.mp3`,
        status: 'draft', fileId: null, contentSha256: null, sizeBytes: null, durationMs: null,
        version: 1, createdAt: this.clock.nowIso(), submittedAt: null };
      if (!await transaction.saveRecording(record, 0)
        || !await transaction.saveReceipt({ organizationId: actor.organizationId,
          actorId: actor.actorUserId, operationId, fingerprint, result: record })) throw new TaskRecordingError('CONFLICT');
      return record;
    });
  }

  public async submit(actor: TrustedActorContext, recordingId: string, stagingFileId: string,
    expectedVersion: number, operationId: string): Promise<TaskRecordingRecord> {
    this.studentOnly(actor);
    if (!validOperation(operationId) || !recordingId.trim() || !stagingFileId.trim()
      || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new TaskRecordingError('VALIDATION_ERROR');
    const fingerprint = JSON.stringify({ action: 'submit', recordingId, stagingFileId, expectedVersion });
    const prepared = await this.recordings.transaction(async (transaction) => {
      const prior = await transaction.findReceipt(actor.organizationId, actor.actorUserId, operationId);
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new TaskRecordingError('CONFLICT');
        return { completed: prior.result } as const;
      }
      const recording = await transaction.findRecording(actor.organizationId, recordingId);
      if (!recording || recording.studentId !== actor.actorUserId) throw new TaskRecordingError('NOT_FOUND');
      if (recording.status !== 'draft' || recording.version !== expectedVersion) throw new TaskRecordingError('CONFLICT');
      await this.requireRecordingScope(actor, recording);
      return { recording } as const;
    });
    if ('completed' in prepared && prepared.completed) return prepared.completed;
    if (!this.seal) throw new TaskRecordingError('SERVICE_UNAVAILABLE');
    const sealed = await this.seal.inspectAndSeal({ stagingFileId, stagingPath: prepared.recording.stagingPath,
      organizationId: actor.organizationId, studentId: actor.actorUserId, recordingId });
    if (!sealed.fileId || !/^[a-f0-9]{64}$/.test(sealed.contentSha256)
      || !Number.isSafeInteger(sealed.sizeBytes) || sealed.sizeBytes < 1 || sealed.sizeBytes > MAX_BYTES
      || !Number.isSafeInteger(sealed.durationMs) || sealed.durationMs < 1000 || sealed.durationMs > MAX_DURATION_MS
      || sealed.codec !== 'mp3') throw new TaskRecordingError('MEDIA_INVALID');
    return this.recordings.transaction(async (transaction) => {
      const prior = await transaction.findReceipt(actor.organizationId, actor.actorUserId, operationId);
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new TaskRecordingError('CONFLICT');
        return prior.result;
      }
      const current = await transaction.findRecording(actor.organizationId, recordingId);
      if (!current || current.studentId !== actor.actorUserId || current.status !== 'draft'
        || current.version !== expectedVersion || current.stagingPath !== prepared.recording.stagingPath) {
        throw new TaskRecordingError('CONFLICT');
      }
      await this.requireRecordingScope(actor, current);
      const result: TaskRecordingRecord = { ...current, status: 'submitted', fileId: sealed.fileId,
        contentSha256: sealed.contentSha256, sizeBytes: sealed.sizeBytes, durationMs: sealed.durationMs,
        version: expectedVersion + 1, submittedAt: this.clock.nowIso() };
      if (!await transaction.saveRecording(result, expectedVersion)
        || !await transaction.saveReceipt({ organizationId: actor.organizationId, actorId: actor.actorUserId,
          operationId, fingerprint, result })) throw new TaskRecordingError('CONFLICT');
      return result;
    });
  }

  public async listMyRound(actor: TrustedActorContext, taskId: string, itemId: string): Promise<readonly TaskRecordingRecord[]> {
    this.studentOnly(actor);
    const scope = await this.requireTaskScope(actor, taskId, itemId);
    return (await this.recordings.transaction((transaction) => transaction.listMyRecordings(actor.organizationId,
      actor.actorUserId, taskId, itemId, scope.assignment.latestSubmissionVersion + 1)))
      .map(recording => ({ ...recording, mediaExpired: Boolean(recording.mediaDeletedAt)
        || originalAudioExpired(recording.submittedAt, this.clock.nowIso()) }));
  }

  public async temporaryPlayback(actor: TrustedActorContext, recordingId: string): Promise<Readonly<{
    recordingId: string; temporaryUrl: string; expiresAt: string }>> {
    const recording = await this.authorizedSubmittedRecording(actor, recordingId);
    if (recording.mediaDeletedAt || originalAudioExpired(recording.submittedAt, this.clock.nowIso())) {
      throw new TaskRecordingError('NOT_FOUND');
    }
    if (!this.playback || (actor.actorRole === 'teacher' && !this.audit)) throw new TaskRecordingError('SERVICE_UNAVAILABLE');
    const temporaryUrl = await this.playback.temporaryUrl(recording.fileId!);
    if (!/^https:\/\//.test(temporaryUrl)) throw new TaskRecordingError('SERVICE_UNAVAILABLE');
    if (actor.actorRole === 'teacher') await this.audit!.recordTeacherPlayback(actor, recording, this.clock.nowIso());
    return { recordingId, temporaryUrl, expiresAt: new Date(Date.parse(this.clock.nowIso()) + 60000).toISOString() };
  }

  public async getMediaState(actor: TrustedActorContext, recordingId: string): Promise<Readonly<{
    recordingId: string; mediaDeletedAt: string | null; mediaExpired: boolean }>> {
    const recording = await this.authorizedSubmittedRecording(actor, recordingId);
    return { recordingId, mediaDeletedAt: recording.mediaDeletedAt ?? null,
      mediaExpired: Boolean(recording.mediaDeletedAt)
        || originalAudioExpired(recording.submittedAt, this.clock.nowIso()) };
  }

  private async authorizedSubmittedRecording(actor: TrustedActorContext, recordingId: string): Promise<TaskRecordingRecord> {
    if (!recordingId.trim()) throw new TaskRecordingError('VALIDATION_ERROR');
    const recording = await this.recordings.transaction((transaction) => transaction.findRecording(actor.organizationId, recordingId));
    if (!recording || recording.status !== 'submitted' || !recording.fileId) throw new TaskRecordingError('NOT_FOUND');
    if (actor.actorRole === 'student') {
      if (recording.studentId !== actor.actorUserId) throw new TaskRecordingError('NOT_FOUND');
    } else if (actor.actorRole === 'teacher') {
      if (!(await this.authorization.canTeacherAccessClass(actor, recording.classId, 'submission.review')).allowed) {
        throw new TaskRecordingError('NOT_FOUND');
      }
      const submissions = await this.tasks.listTaskSubmissions(actor.organizationId, recording.taskId);
      if (!submissions.some((submission) => submission.studentId === recording.studentId
        && submission.assignmentId === recording.assignmentId
        && submission.submissionVersion === recording.submissionVersion
        && submission.submittedAt !== null
        && submission.answers.some((answer) => answer.itemId === recording.itemId
          && typeof answer.value === 'object' && answer.value !== null && !Array.isArray(answer.value)
          && (answer.value as Record<string, unknown>).recordingId === recording.id))) throw new TaskRecordingError('NOT_FOUND');
    } else throw new TaskRecordingError('FORBIDDEN');
    return recording;
  }

  private studentOnly(actor: TrustedActorContext): void {
    if (actor.actorRole !== 'student') throw new TaskRecordingError('FORBIDDEN');
  }
  private async requireTaskScope(actor: TrustedActorContext, taskId: string, itemId: string) {
    const [assignment, task] = await Promise.all([
      this.tasks.findAssignment(actor.organizationId, taskId, actor.actorUserId),
      this.tasks.findTask(actor.organizationId, taskId),
    ]);
    if (!assignment || !task || task.visibility !== 'visible') throw new TaskRecordingError('NOT_FOUND');
    const item = task.items.find((candidate) => candidate.id === itemId && candidate.resourceSnapshot.type === 'recording');
    if (!item) throw new TaskRecordingError('NOT_FOUND');
    if (!isSubmittable(task, assignment, this.clock.nowIso())) throw new TaskRecordingError('TASK_NOT_SUBMITTABLE');
    return { assignment, task, item };
  }
  private async requireRecordingScope(actor: TrustedActorContext, recording: TaskRecordingRecord): Promise<void> {
    const scope = await this.requireTaskScope(actor, recording.taskId, recording.itemId);
    if (scope.assignment.id !== recording.assignmentId || scope.assignment.classId !== recording.classId
      || recording.submissionVersion !== scope.assignment.latestSubmissionVersion + 1
      || scope.item.resourceVersion !== recording.resourceVersion) throw new TaskRecordingError('CONFLICT');
  }
}
