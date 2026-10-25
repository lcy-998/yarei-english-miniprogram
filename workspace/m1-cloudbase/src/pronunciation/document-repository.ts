import { createHash } from 'node:crypto';
import type { TrustedActorContext } from '../auth/trusted-actor';
import type { JsonValue } from '../shared/protocol';
import type { DocumentDatabasePort, DocumentDatabaseTransactionPort, VersionedDocument } from '../repositories/document-database-port';
import type { PronunciationTransaction, PronunciationUnitOfWork } from './repository';
import { PronunciationError, type PronunciationReceipt, type PronunciationRecording } from './types';

export const PRONUNCIATION_COLLECTIONS = {
  recordings: 'pronunciation_recordings', operations: 'pronunciation_operations',
} as const;

const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
const receiptId = (organizationId: string, actorId: string, operationId: string): string =>
  `pronunciation_operation_${digest(JSON.stringify([organizationId, actorId, operationId]))}`;
const json = (value: object): Record<string, JsonValue> => JSON.parse(JSON.stringify(value)) as Record<string, JsonValue>;

function visible(value: VersionedDocument | null, organizationId: string): value is VersionedDocument {
  return value !== null && value.organizationId === organizationId && value.deletedAt === null;
}

function project(value: unknown): PronunciationRecording | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string' || typeof record.organizationId !== 'string'
    || typeof record.studentId !== 'string' || !record.source || typeof record.source !== 'object'
    || typeof record.referenceSha256 !== 'string' || typeof record.stagingPath !== 'string'
    || !['draft', 'sealed', 'processing', 'scored', 'unreliable', 'failed'].includes(String(record.status))
    || !Number.isSafeInteger(record.version) || typeof record.createdAt !== 'string') return null;
  return record as unknown as PronunciationRecording;
}

class DocumentPronunciationTransaction implements PronunciationTransaction {
  public constructor(private readonly documents: DocumentDatabaseTransactionPort) {}

  public async findRecording(organizationId: string, recordingId: string): Promise<PronunciationRecording | null> {
    const document = await this.documents.get(PRONUNCIATION_COLLECTIONS.recordings, recordingId);
    if (!visible(document, organizationId)) return null;
    const record = project(document);
    if (!record || record.id !== recordingId) throw new PronunciationError('SERVICE_UNAVAILABLE');
    return record;
  }

  public async listRecordings(organizationId: string, studentId: string): Promise<readonly PronunciationRecording[]> {
    const documents = await this.documents.find(PRONUNCIATION_COLLECTIONS.recordings,
      { organizationId, studentId, deletedAt: null });
    return documents.map(document => {
      const record = project(document);
      if (!record || record.studentId !== studentId) throw new PronunciationError('SERVICE_UNAVAILABLE');
      return record;
    });
  }

  public async listSubmissionRecordings(organizationId: string, taskId: string, assignmentId: string,
    submissionVersion: number): Promise<readonly PronunciationRecording[]> {
    const documents = await this.documents.find(PRONUNCIATION_COLLECTIONS.recordings,
      { organizationId, taskId, assignmentId, submissionVersion, deletedAt: null });
    return documents.map(document => {
      const record = project(document);
      if (!record || record.source.taskId !== taskId || record.source.assignmentId !== assignmentId
        || record.source.submissionVersion !== submissionVersion) throw new PronunciationError('SERVICE_UNAVAILABLE');
      return record;
    });
  }

  public async saveRecording(record: PronunciationRecording, expectedVersion: number): Promise<boolean> {
    const document: VersionedDocument = { _id: record.id, organizationId: record.organizationId,
      schemaVersion: 1, version: record.version, deletedAt: null, ...json(record),
      taskId: record.source.taskId, assignmentId: record.source.assignmentId,
      submissionVersion: record.source.submissionVersion };
    return expectedVersion === 0
      ? this.documents.create(PRONUNCIATION_COLLECTIONS.recordings, document)
      : this.documents.replace(PRONUNCIATION_COLLECTIONS.recordings, record.id, expectedVersion, document);
  }

  public async findReceipt(organizationId: string, actorId: string,
    operationId: string): Promise<PronunciationReceipt | null> {
    const document = await this.documents.get(PRONUNCIATION_COLLECTIONS.operations,
      receiptId(organizationId, actorId, operationId));
    if (!visible(document, organizationId) || document.actorId !== actorId || document.operationId !== operationId
      || typeof document.fingerprint !== 'string' || typeof document.recordingId !== 'string') return null;
    return { organizationId, actorId, operationId, fingerprint: document.fingerprint,
      recordingId: document.recordingId };
  }

  public saveReceipt(receipt: PronunciationReceipt): Promise<boolean> {
    return this.documents.create(PRONUNCIATION_COLLECTIONS.operations, {
      _id: receiptId(receipt.organizationId, receipt.actorId, receipt.operationId),
      organizationId: receipt.organizationId, schemaVersion: 1, version: 1, deletedAt: null,
      actorId: receipt.actorId, operationId: receipt.operationId,
      fingerprint: receipt.fingerprint, recordingId: receipt.recordingId,
    });
  }

  public appendAudit(actor: TrustedActorContext, action: string, recordingId: string, occurredAt: string,
    metadata: Readonly<Record<string, string | number | boolean | null>>): Promise<boolean> {
    return this.documents.append('operation_logs', { _id: `audit:${actor.organizationId}:${actor.requestId}:${action}`,
      id: `pronunciation_audit_${digest(JSON.stringify([actor.requestId, action]))}`,
      organizationId: actor.organizationId, schemaVersion: 1, version: 1, deletedAt: null,
      requestId: actor.requestId, actorUserId: actor.actorUserId, actorRole: actor.actorRole,
      action, targetType: action === 'pronunciation.listParentEvidence' ? 'task' : 'pronunciation_recording',
      targetId: recordingId,
      result: 'succeeded', errorCode: null, occurredAt, metadata: json(metadata) });
  }

  public appendWorkerAudit(organizationId: string, action: string, recordingId: string,
    operationId: string, occurredAt: string,
    metadata: Readonly<Record<string, string | number | boolean | null>>): Promise<boolean> {
    const key = digest(JSON.stringify([organizationId, recordingId, operationId, action, occurredAt]));
    return this.documents.append('operation_logs', { _id: `audit:${organizationId}:${key}`,
      id: `pronunciation_worker_audit_${key}`, organizationId, schemaVersion: 1, version: 1,
      deletedAt: null, requestId: `worker_${key}`, actorUserId: 'server-maintenance', actorRole: 'system',
      action, targetType: 'pronunciation_recording', targetId: recordingId,
      result: 'succeeded', errorCode: null, occurredAt, metadata: json(metadata) });
  }
}

export class DocumentPronunciationRepository implements PronunciationUnitOfWork {
  public constructor(private readonly documents: DocumentDatabasePort) {}
  public transaction<T>(work: (transaction: PronunciationTransaction) => Promise<T>): Promise<T> {
    return this.documents.runTransaction(transaction => work(new DocumentPronunciationTransaction(transaction)));
  }

  /** Server-only pending outbox page; it exposes no file ID, text or media URL. */
  public async listPending(organizationId: string, offset: number, limit = 25) {
    if (!organizationId || !Number.isSafeInteger(offset) || offset < 0
      || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
      throw new PronunciationError('VALIDATION_ERROR');
    }
    const page = await this.documents.findPage(PRONUNCIATION_COLLECTIONS.recordings,
      { organizationId, status: 'processing', dispatchState: 'pending', deletedAt: null },
      { limit, offset });
    const jobs = page.items.map(document => {
      const record = project(document);
      if (!record || record.organizationId !== organizationId || record.status !== 'processing'
        || record.dispatchState !== 'pending' || !record.scoreOperationId) {
        throw new PronunciationError('SERVICE_UNAVAILABLE');
      }
      return { organizationId, studentId: record.studentId,
        recordingId: record.id, operationId: record.scoreOperationId };
    });
    return { jobs, hasMore: page.hasMore };
  }
}
