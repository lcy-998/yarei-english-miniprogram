import type { TrustedActorContext } from '../auth/trusted-actor';
import type { AssignedTaskMedia } from './playback-service';
import { dubbingAudioExpired } from '../media-retention/policy';

export interface TaskDubbingWorkRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly studentId: string;
  readonly assignmentId: string;
  readonly round: number;
  readonly taskId: string;
  readonly itemId: string;
  readonly mediaId: string;
  readonly mediaVersion: number;
  readonly stagingPath: string;
  readonly status: 'draft' | 'submitted';
  readonly recording: Readonly<{ mediaId: string; fileId: string; contentSha256: string;
    durationMs: number; sizeBytes: number; serverReadable: true }> | null;
  readonly version: number;
  readonly createdAt: string;
  readonly submittedAt: string | null;
}

export interface TaskDubbingWorkView {
  readonly workId: string;
  readonly taskId: string;
  readonly itemId: string;
  readonly round: number;
  readonly stagingPath: string;
  readonly status: 'draft' | 'submitted';
  readonly durationMs: number | null;
  readonly submittedAt: string | null;
  readonly version: number;
}

export interface TaskDubbingWorkPort {
  findAssignedMedia(actor: TrustedActorContext, taskId: string, itemId: string): Promise<AssignedTaskMedia | null>;
  findWork(workId: string): Promise<TaskDubbingWorkRecord | null>;
  createWork(record: TaskDubbingWorkRecord, operationId: string): Promise<TaskDubbingWorkRecord>;
  findSealReceipt(organizationId: string, studentId: string, operationId: string): Promise<Readonly<{
    fingerprint: string; work: TaskDubbingWorkRecord }> | null>;
  sealWork(record: TaskDubbingWorkRecord, expectedVersion: number,
    operationId: string, fingerprint: string): Promise<TaskDubbingWorkRecord | null>;
  inspectAndSeal(stagingPath: string, stagingFileId: string): Promise<Readonly<{
    fileId: string; contentSha256: string; durationMs: number; sizeBytes: number;
  }> | null>;
  nextId(): string;
}

export type TaskDubbingResult = Readonly<{ ok: true; data: TaskDubbingWorkView }>
  | Readonly<{ ok: false; code: 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION_ERROR'
    | 'CONFLICT' | 'MEDIA_INVALID' }>;

/** Classroom dubbing works are separate from autonomous S-07 works and bound to one submission round. */
export class TaskDubbingWorkService {
  public constructor(private readonly port: TaskDubbingWorkPort,
    private readonly clock: Readonly<{ nowIso(): string }>) {}

  public async begin(actor: TrustedActorContext, taskId: string, itemId: string,
    operationId: string): Promise<TaskDubbingResult> {
    if (!validId(taskId) || !validId(itemId) || !validId(operationId)) return fail('VALIDATION_ERROR');
    const assigned = await this.assigned(actor, taskId, itemId);
    if (!assigned) return fail('FORBIDDEN');
    const id = this.port.nextId();
    const work = await this.port.createWork({ id, organizationId: actor.organizationId,
      studentId: actor.actorUserId, assignmentId: assigned.assignmentId, round: assigned.round,
      taskId, itemId, mediaId: assigned.snapshot.mediaId, mediaVersion: assigned.snapshot.mediaVersion,
      stagingPath: `task-dubbing/staging/${actor.organizationId}/${actor.actorUserId}/${taskId}/${itemId}/${id}`,
      status: 'draft', recording: null, version: 1, createdAt: this.clock.nowIso(),
      submittedAt: null }, operationId);
    return this.matches(work, assigned) ? { ok: true, data: project(work) } : fail('CONFLICT');
  }

  public async seal(actor: TrustedActorContext, workId: string, stagingFileId: string,
    expectedVersion: number, operationId: string): Promise<TaskDubbingResult> {
    if (!validId(workId) || !validId(operationId) || !Number.isSafeInteger(expectedVersion)
      || expectedVersion < 1 || typeof stagingFileId !== 'string'
      || !stagingFileId.startsWith('cloud://')) return fail('VALIDATION_ERROR');
    const current = await this.port.findWork(workId);
    if (!current) return fail('NOT_FOUND');
    const assigned = await this.assigned(actor, current.taskId, current.itemId);
    if (!assigned || !this.matches(current, assigned)) return fail('FORBIDDEN');
    const fingerprint = JSON.stringify([workId, stagingFileId, expectedVersion]);
    const receipt = await this.port.findSealReceipt(actor.organizationId, actor.actorUserId, operationId);
    if (receipt) return receipt.fingerprint === fingerprint && this.matches(receipt.work, assigned)
      ? { ok: true, data: project(receipt.work) } : fail('CONFLICT');
    if (current.status !== 'draft' || current.version !== expectedVersion
      || dubbingAudioExpired(current.createdAt, this.clock.nowIso())) return fail('CONFLICT');
    const sealed = await this.port.inspectAndSeal(current.stagingPath, stagingFileId);
    if (!sealed || !sealed.fileId.startsWith('cloud://')
      || !/^[a-f0-9]{64}$/i.test(sealed.contentSha256)
      || !Number.isSafeInteger(sealed.durationMs) || sealed.durationMs < 1000 || sealed.durationMs > 300000
      || !Number.isSafeInteger(sealed.sizeBytes) || sealed.sizeBytes < 1
      || sealed.sizeBytes > 20 * 1024 * 1024) return fail('MEDIA_INVALID');
    const next = await this.port.sealWork({ ...current, status: 'submitted',
      recording: { mediaId: workId, fileId: sealed.fileId,
        contentSha256: sealed.contentSha256.toLowerCase(), durationMs: sealed.durationMs,
        sizeBytes: sealed.sizeBytes, serverReadable: true }, version: current.version + 1,
      submittedAt: this.clock.nowIso(),
    }, expectedVersion, operationId, fingerprint);
    return next && this.matches(next, assigned) ? { ok: true, data: project(next) } : fail('CONFLICT');
  }

  private async assigned(actor: TrustedActorContext, taskId: string,
    itemId: string): Promise<AssignedTaskMedia | null> {
    if (actor.actorRole !== 'student') return null;
    const row = await this.port.findAssignedMedia(actor, taskId, itemId);
    return row && row.organizationId === actor.organizationId && row.studentId === actor.actorUserId
      && row.taskId === taskId && row.itemId === itemId && row.writable
      && row.snapshot.kind === 'dubbing' ? row : null;
  }

  private matches(work: TaskDubbingWorkRecord, assigned: AssignedTaskMedia): boolean {
    return work.organizationId === assigned.organizationId && work.studentId === assigned.studentId
      && work.assignmentId === assigned.assignmentId && work.round === assigned.round
      && work.taskId === assigned.taskId && work.itemId === assigned.itemId
      && work.mediaId === assigned.snapshot.mediaId && work.mediaVersion === assigned.snapshot.mediaVersion;
  }
}

function project(work: TaskDubbingWorkRecord): TaskDubbingWorkView {
  return { workId: work.id, taskId: work.taskId, itemId: work.itemId,
    round: work.round, stagingPath: work.stagingPath, status: work.status,
    durationMs: work.recording?.durationMs ?? null, submittedAt: work.submittedAt,
    version: work.version };
}
function validId(value: string): boolean { return /^[A-Za-z0-9_-]{1,128}$/.test(value); }
function fail(code: Extract<TaskDubbingResult, { ok: false }>['code']): TaskDubbingResult {
  return { ok: false, code };
}
