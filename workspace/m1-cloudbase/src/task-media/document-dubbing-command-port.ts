import { createHash, randomUUID } from 'node:crypto';
import type { TrustedActorContext } from '../auth/trusted-actor';
import type { DocumentDatabasePort, VersionedDocument } from '../repositories/document-database-port';
import type { TaskDubbingWorkPort, TaskDubbingWorkRecord } from './dubbing-work-service';
import { TASK_DUBBING_WORKS_COLLECTION } from './document-work-port';
import type { AssignedTaskMedia } from './playback-service';

export const TASK_DUBBING_WORK_OPERATIONS_COLLECTION = 'task_dubbing_work_operations';

export class DocumentTaskDubbingCommandPort implements TaskDubbingWorkPort {
  public constructor(private readonly database: DocumentDatabasePort,
    private readonly assigned: Readonly<{ findAssignedMedia(actor: TrustedActorContext,
      taskId: string, itemId: string): Promise<AssignedTaskMedia | null> }>,
    private readonly storage: Pick<TaskDubbingWorkPort, 'inspectAndSeal'>) {}

  public findAssignedMedia(actor: TrustedActorContext, taskId: string,
    itemId: string): Promise<AssignedTaskMedia | null> {
    return this.assigned.findAssignedMedia(actor, taskId, itemId);
  }

  public async findWork(workId: string): Promise<TaskDubbingWorkRecord | null> {
    return project(await this.database.get(TASK_DUBBING_WORKS_COLLECTION, workId));
  }

  public createWork(record: TaskDubbingWorkRecord,
    operationId: string): Promise<TaskDubbingWorkRecord> {
    return this.database.runTransaction(async tx => {
      const receiptId = operationDocumentId('begin', record.organizationId, record.studentId, operationId);
      const prior = await tx.get(TASK_DUBBING_WORK_OPERATIONS_COLLECTION, receiptId);
      if (prior) {
        const work = project(await tx.get(TASK_DUBBING_WORKS_COLLECTION, String(prior.workId)));
        if (!work) throw new Error('DUBBING_BEGIN_RECEIPT_INVALID');
        return work;
      }
      if (!await tx.create(TASK_DUBBING_WORKS_COLLECTION, toDocument(record))) {
        throw new Error('DUBBING_WORK_CONFLICT');
      }
      if (!await tx.create(TASK_DUBBING_WORK_OPERATIONS_COLLECTION, {
        _id: receiptId, organizationId: record.organizationId, schemaVersion: 1,
        version: 1, deletedAt: null, studentId: record.studentId,
        taskId: record.taskId, itemId: record.itemId, round: record.round,
        workId: record.id, operationId, action: 'begin', occurredAt: record.createdAt,
      })) throw new Error('DUBBING_BEGIN_RECEIPT_CONFLICT');
      return record;
    });
  }

  public async findSealReceipt(organizationId: string, studentId: string,
    operationId: string): Promise<Readonly<{ fingerprint: string; work: TaskDubbingWorkRecord }> | null> {
    const receipt = await this.database.get(TASK_DUBBING_WORK_OPERATIONS_COLLECTION,
      operationDocumentId('seal', organizationId, studentId, operationId));
    if (!receipt || receipt.organizationId !== organizationId || receipt.studentId !== studentId
      || typeof receipt.fingerprint !== 'string' || typeof receipt.workId !== 'string') return null;
    const work = await this.findWork(receipt.workId);
    return work && work.organizationId === organizationId && work.studentId === studentId
      ? { fingerprint: receipt.fingerprint, work } : null;
  }

  public sealWork(record: TaskDubbingWorkRecord, expectedVersion: number,
    operationId: string, fingerprint: string): Promise<TaskDubbingWorkRecord | null> {
    return this.database.runTransaction(async tx => {
      const receiptId = operationDocumentId('seal', record.organizationId, record.studentId, operationId);
      const prior = await tx.get(TASK_DUBBING_WORK_OPERATIONS_COLLECTION, receiptId);
      if (prior) return prior.fingerprint === fingerprint
        ? project(await tx.get(TASK_DUBBING_WORKS_COLLECTION, String(prior.workId))) : null;
      const current = project(await tx.get(TASK_DUBBING_WORKS_COLLECTION, record.id));
      if (!current || current.version !== expectedVersion || current.status !== 'draft'
        || current.organizationId !== record.organizationId || current.studentId !== record.studentId
        || current.taskId !== record.taskId || current.itemId !== record.itemId
        || current.assignmentId !== record.assignmentId || current.round !== record.round) return null;
      if (!await tx.replace(TASK_DUBBING_WORKS_COLLECTION, record.id, expectedVersion,
        toDocument(record))) return null;
      if (!await tx.create(TASK_DUBBING_WORK_OPERATIONS_COLLECTION, {
        _id: receiptId, organizationId: record.organizationId, schemaVersion: 1,
        version: 1, deletedAt: null, studentId: record.studentId,
        taskId: record.taskId, itemId: record.itemId, round: record.round,
        workId: record.id, operationId, action: 'seal', fingerprint,
        occurredAt: record.createdAt,
      })) throw new Error('DUBBING_SEAL_RECEIPT_CONFLICT');
      return record;
    });
  }

  public inspectAndSeal(stagingPath: string, stagingFileId: string) {
    return this.storage.inspectAndSeal(stagingPath, stagingFileId);
  }

  public nextId(): string { return `task_dubbing_${randomUUID()}`; }
}

function toDocument(record: TaskDubbingWorkRecord): VersionedDocument {
  return { _id: record.id, organizationId: record.organizationId, schemaVersion: 1,
    version: record.version, deletedAt: null, studentId: record.studentId,
    assignmentId: record.assignmentId, round: record.round, taskId: record.taskId,
    itemId: record.itemId, mediaId: record.mediaId, mediaVersion: record.mediaVersion,
    stagingPath: record.stagingPath, status: record.status,
    recording: record.recording === null ? null : {
      mediaId: record.recording.mediaId, durationMs: record.recording.durationMs,
      sizeBytes: record.recording.sizeBytes, serverReadable: record.recording.serverReadable,
    },
    fileId: record.recording?.fileId ?? null,
    contentSha256: record.recording?.contentSha256 ?? null,
    mediaDeletedAt: null, createdAt: record.createdAt, submittedAt: record.submittedAt };
}

function project(row: VersionedDocument | null): TaskDubbingWorkRecord | null {
  if (!row || row.deletedAt !== null || typeof row.studentId !== 'string'
    || typeof row.assignmentId !== 'string' || !Number.isSafeInteger(row.round)
    || typeof row.taskId !== 'string' || typeof row.itemId !== 'string'
    || typeof row.mediaId !== 'string' || !Number.isSafeInteger(row.mediaVersion)
    || typeof row.stagingPath !== 'string' || typeof row.createdAt !== 'string'
    || (row.submittedAt !== null && typeof row.submittedAt !== 'string')
    || (row.status !== 'draft' && row.status !== 'submitted')) return null;
  const recording = row.status === 'submitted' && row.recording !== null
    && typeof row.recording === 'object' && !Array.isArray(row.recording)
    ? row.recording as Record<string, unknown> : null;
  if (row.status === 'submitted' && (!recording || typeof row.fileId !== 'string'
    || typeof row.contentSha256 !== 'string' || typeof recording.mediaId !== 'string'
    || !Number.isSafeInteger(recording.durationMs) || !Number.isSafeInteger(recording.sizeBytes)
    || recording.serverReadable !== true)) return null;
  return { id: row._id, organizationId: row.organizationId,
    studentId: row.studentId, assignmentId: row.assignmentId, round: Number(row.round),
    taskId: row.taskId, itemId: row.itemId, mediaId: row.mediaId,
    mediaVersion: Number(row.mediaVersion), stagingPath: row.stagingPath,
    status: row.status, recording: recording ? {
      mediaId: recording.mediaId as string, fileId: row.fileId as string,
      contentSha256: row.contentSha256 as string,
      durationMs: Number(recording.durationMs), sizeBytes: Number(recording.sizeBytes),
      serverReadable: true,
    } : null, version: row.version, createdAt: row.createdAt,
    submittedAt: row.submittedAt };
}

function operationDocumentId(action: string, organizationId: string, studentId: string,
  operationId: string): string {
  return `task_dubbing_op_${createHash('sha256').update(JSON.stringify([
    action, organizationId, studentId, operationId,
  ])).digest('hex').slice(0, 40)}`;
}
