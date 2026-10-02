import type { JsonValue } from '../shared/protocol';
import { hashHex } from '../shared/request-summary';
import type { DocumentDatabasePort, DocumentDatabaseTransactionPort, VersionedDocument } from '../repositories/document-database-port';
import type { TaskRecordingTransaction, TaskRecordingUnitOfWork } from './repository';
import type { TaskRecordingAccessAuditPort } from './repository';
import type { TrustedActorContext } from '../auth/trusted-actor';
import { TaskRecordingError, type TaskRecordingRecord, type TaskRecordingReceipt } from './types';

export const TASK_RECORDING_COLLECTIONS = { recordings: 'task_recordings', receipts: 'task_recording_operations' } as const;
function json(value: object): Record<string, JsonValue> { return JSON.parse(JSON.stringify(value)) as Record<string, JsonValue>; }
function visible(value: VersionedDocument | null, organizationId: string): value is VersionedDocument {
  return value !== null && value.organizationId === organizationId && value.deletedAt === null;
}
function receiptId(organizationId: string, actorId: string, operationId: string): string {
  return `task_recording_operation_${hashHex(JSON.stringify([organizationId, actorId, operationId]))}`;
}
export function projectTaskRecording(value: unknown): TaskRecordingRecord | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string' || typeof record.organizationId !== 'string'
    || typeof record.taskId !== 'string' || typeof record.itemId !== 'string'
    || typeof record.assignmentId !== 'string' || typeof record.studentId !== 'string'
    || typeof record.classId !== 'string' || typeof record.stagingPath !== 'string'
    || !Number.isSafeInteger(record.submissionVersion) || Number(record.submissionVersion) < 1
    || !Number.isSafeInteger(record.resourceVersion) || Number(record.resourceVersion) < 1
    || (record.status !== 'draft' && record.status !== 'submitted')
    || (record.fileId !== null && typeof record.fileId !== 'string')
    || (record.contentSha256 !== null && typeof record.contentSha256 !== 'string')
    || (record.sizeBytes !== null && (!Number.isSafeInteger(record.sizeBytes) || Number(record.sizeBytes) < 1))
    || (record.durationMs !== null && (!Number.isSafeInteger(record.durationMs) || Number(record.durationMs) < 1))
    || !Number.isSafeInteger(record.version) || Number(record.version) < 1
    || typeof record.createdAt !== 'string' || !Number.isFinite(Date.parse(record.createdAt))
    || (record.submittedAt !== null && (typeof record.submittedAt !== 'string'
      || !Number.isFinite(Date.parse(record.submittedAt))))
    || (record.mediaDeletedAt !== undefined && record.mediaDeletedAt !== null
      && (typeof record.mediaDeletedAt !== 'string' || !Number.isFinite(Date.parse(record.mediaDeletedAt))))) return null;
  return record as unknown as TaskRecordingRecord;
}
class DocumentTaskRecordingTransaction implements TaskRecordingTransaction {
  public constructor(private readonly documents: DocumentDatabaseTransactionPort) {}
  public async findRecording(organizationId: string, recordingId: string): Promise<TaskRecordingRecord | null> {
    const document = await this.documents.get(TASK_RECORDING_COLLECTIONS.recordings, recordingId);
    if (!visible(document, organizationId)) return null;
    const record = projectTaskRecording(document);
    if (!record || record.id !== recordingId) throw new TaskRecordingError('SERVICE_UNAVAILABLE');
    return record;
  }
  public async listMyRecordings(organizationId: string, studentId: string, taskId: string,
    itemId: string, submissionVersion: number): Promise<readonly TaskRecordingRecord[]> {
    const documents = await this.documents.find(TASK_RECORDING_COLLECTIONS.recordings, { organizationId,
      studentId, taskId, itemId, submissionVersion, deletedAt: null });
    return documents.map((document) => {
      const recording = projectTaskRecording(document);
      if (!recording || recording.organizationId !== organizationId || recording.studentId !== studentId
        || recording.taskId !== taskId || recording.itemId !== itemId) throw new TaskRecordingError('SERVICE_UNAVAILABLE');
      return recording;
    });
  }
  public async saveRecording(record: TaskRecordingRecord, expectedVersion: number): Promise<boolean> {
    const document: VersionedDocument = { _id: record.id, organizationId: record.organizationId,
      schemaVersion: 1, version: record.version, deletedAt: null, ...json(record) };
    return expectedVersion === 0
      ? this.documents.create(TASK_RECORDING_COLLECTIONS.recordings, document)
      : this.documents.replace(TASK_RECORDING_COLLECTIONS.recordings, record.id, expectedVersion, document);
  }
  public async findReceipt(organizationId: string, actorId: string, operationId: string): Promise<TaskRecordingReceipt | null> {
    const document = await this.documents.get(TASK_RECORDING_COLLECTIONS.receipts,
      receiptId(organizationId, actorId, operationId));
    if (!visible(document, organizationId) || document.actorId !== actorId || document.operationId !== operationId
      || typeof document.fingerprint !== 'string') return null;
    const result = projectTaskRecording(document.result);
    if (!result) throw new TaskRecordingError('SERVICE_UNAVAILABLE');
    return { organizationId, actorId, operationId, fingerprint: document.fingerprint, result };
  }
  public async saveReceipt(receipt: TaskRecordingReceipt): Promise<boolean> {
    return this.documents.create(TASK_RECORDING_COLLECTIONS.receipts, { _id: receiptId(receipt.organizationId,
      receipt.actorId, receipt.operationId), organizationId: receipt.organizationId, schemaVersion: 1,
      version: 1, deletedAt: null, actorId: receipt.actorId, operationId: receipt.operationId,
      fingerprint: receipt.fingerprint, result: json(receipt.result) });
  }
}
export class DocumentTaskRecordingRepository implements TaskRecordingUnitOfWork {
  public constructor(private readonly documents: DocumentDatabasePort) {}
  public transaction<T>(work: (transaction: TaskRecordingTransaction) => Promise<T>): Promise<T> {
    return this.documents.runTransaction((transaction) => work(new DocumentTaskRecordingTransaction(transaction)));
  }
}

export class DocumentTaskRecordingAccessAudit implements TaskRecordingAccessAuditPort {
  public constructor(private readonly documents: DocumentDatabasePort) {}
  public async recordTeacherPlayback(actor: TrustedActorContext, recording: TaskRecordingRecord,
    occurredAt: string): Promise<void> {
    const id = `audit:${actor.organizationId}:${actor.requestId}`;
    const appended = await this.documents.runTransaction((transaction) => transaction.append('operation_logs', {
      _id: id, schemaVersion: 1, version: 1, deletedAt: null,
      id: `recording_playback_${hashHex(JSON.stringify([actor.organizationId, actor.requestId]))}`,
      organizationId: actor.organizationId, requestId: actor.requestId,
      actorUserId: actor.actorUserId, actorRole: actor.actorRole, action: 'task-recording.getPlayback',
      targetType: 'task_recording', targetId: recording.id, result: 'succeeded', errorCode: null,
      occurredAt, metadata: { taskId: recording.taskId, itemId: recording.itemId,
        studentId: recording.studentId, submissionVersion: recording.submissionVersion },
    }));
    if (!appended) throw new TaskRecordingError('SERVICE_UNAVAILABLE');
  }
}
