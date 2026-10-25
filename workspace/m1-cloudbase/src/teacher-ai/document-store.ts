import { createHash } from 'node:crypto';
import type { DocumentDatabasePort, VersionedDocument } from '../repositories/document-database-port';
import { DocumentDatabasePlatformError } from '../repositories/document-database-port';
import type { TeacherSuggestionRecord, TeacherSuggestionReservation, TeacherSuggestionStore } from './types';

export const TEACHER_SUGGESTION_COLLECTION = 'teacher_ai_suggestions';

const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
const operationDocumentId = (organizationId: string, teacherId: string, operationId: string): string =>
  `teacher_suggestion_${hash(JSON.stringify([organizationId, teacherId, operationId])).slice(0, 40)}`;
const counterDocumentId = (organizationId: string, teacherId: string, submissionId: string,
  submissionVersion: number): string => `teacher_suggestion_counter_${hash(JSON.stringify(
  [organizationId, teacherId, submissionId, submissionVersion])).slice(0, 40)}`;

function documentFor(record: TeacherSuggestionRecord): VersionedDocument {
  return { _id: record.id, organizationId: record.organizationId, schemaVersion: 1,
    version: record.version, deletedAt: null, recordKind: 'suggestion', teacherId: record.teacherId,
    taskId: record.taskId, submissionId: record.submissionId, submissionVersion: record.submissionVersion,
    assignmentVersion: record.assignmentVersion, operationId: record.operationId,
    evidenceDigest: record.evidenceDigest, modelVersion: record.modelVersion,
    promptVersion: record.promptVersion, text: record.text, citedFactIds: [...record.citedFactIds],
    status: record.status, generationNumber: record.generationNumber,
    failureReason: record.failureReason ?? null, createdAt: record.createdAt };
}

function project(value: VersionedDocument | null, organizationId: string,
  teacherId: string): TeacherSuggestionRecord | null {
  if (value === null || value.organizationId !== organizationId || value.deletedAt !== null
    || value.recordKind !== 'suggestion' || value.teacherId !== teacherId
    || typeof value._id !== 'string' || typeof value.taskId !== 'string'
    || typeof value.submissionId !== 'string' || typeof value.submissionVersion !== 'number'
    || !Number.isSafeInteger(value.submissionVersion) || typeof value.assignmentVersion !== 'number'
    || !Number.isSafeInteger(value.assignmentVersion) || typeof value.operationId !== 'string'
    || typeof value.evidenceDigest !== 'string' || typeof value.modelVersion !== 'string'
    || typeof value.promptVersion !== 'string'
    || (value.status !== 'processing' && value.status !== 'trial' && value.status !== 'failed')
    || typeof value.generationNumber !== 'number' || !Number.isSafeInteger(value.generationNumber)
    || typeof value.version !== 'number' || !Number.isSafeInteger(value.version)
    || typeof value.createdAt !== 'string' || !Array.isArray(value.citedFactIds)
    || !value.citedFactIds.every(id => typeof id === 'string')
    || (value.text !== null && typeof value.text !== 'string')) return null;
  return { id: value._id, organizationId, teacherId, taskId: value.taskId,
    submissionId: value.submissionId, submissionVersion: value.submissionVersion,
    assignmentVersion: value.assignmentVersion, operationId: value.operationId,
    evidenceDigest: value.evidenceDigest, modelVersion: value.modelVersion,
    promptVersion: value.promptVersion, text: value.text, citedFactIds: value.citedFactIds,
    status: value.status, generationNumber: value.generationNumber,
    failureReason: typeof value.failureReason === 'string' ? value.failureReason : null,
    version: value.version, createdAt: value.createdAt };
}

export class DocumentTeacherSuggestionStore implements TeacherSuggestionStore {
  public constructor(private readonly documents: DocumentDatabasePort) {}

  public async find(organizationId: string, teacherId: string,
    operationId: string): Promise<TeacherSuggestionRecord | null> {
    return project(await this.documents.get(TEACHER_SUGGESTION_COLLECTION,
      operationDocumentId(organizationId, teacherId, operationId)), organizationId, teacherId);
  }

  public async findById(organizationId: string, teacherId: string,
    suggestionId: string): Promise<TeacherSuggestionRecord | null> {
    return project(await this.documents.get(TEACHER_SUGGESTION_COLLECTION, suggestionId), organizationId, teacherId);
  }

  public async reserve(record: Omit<TeacherSuggestionRecord, 'generationNumber' | 'version'>):
    Promise<TeacherSuggestionReservation> {
    const id = operationDocumentId(record.organizationId, record.teacherId, record.operationId);
    const counterId = counterDocumentId(record.organizationId, record.teacherId,
      record.submissionId, record.submissionVersion);
    try {
      return await this.documents.runTransaction(async transaction => {
        const existing = project(await transaction.get(TEACHER_SUGGESTION_COLLECTION, id),
          record.organizationId, record.teacherId);
        if (existing !== null) return { kind: 'existing', record: existing } as const;
        const counter = await transaction.get(TEACHER_SUGGESTION_COLLECTION, counterId);
        const generationNumber = counter?.recordKind === 'counter'
          && counter.teacherId === record.teacherId && counter.submissionId === record.submissionId
          && counter.submissionVersion === record.submissionVersion
          && Number.isSafeInteger(counter.generationCount) ? Number(counter.generationCount) + 1 : 1;
        if (generationNumber > 4) return { kind: 'limit' } as const;
        const counterDoc: VersionedDocument = { _id: counterId, organizationId: record.organizationId,
          schemaVersion: 1, version: (counter?.version ?? 0) + 1, deletedAt: null,
          recordKind: 'counter', teacherId: record.teacherId, submissionId: record.submissionId,
          submissionVersion: record.submissionVersion, generationCount: generationNumber };
        const counterSaved = counter === null
          ? await transaction.create(TEACHER_SUGGESTION_COLLECTION, counterDoc)
          : await transaction.replace(TEACHER_SUGGESTION_COLLECTION, counterId, counter.version, counterDoc);
        if (!counterSaved) throw new DocumentDatabasePlatformError('conflict', 'Suggestion generation counter changed.');
        const reserved: TeacherSuggestionRecord = { ...record, id, generationNumber, version: 1 };
        if (!await transaction.create(TEACHER_SUGGESTION_COLLECTION, documentFor(reserved))) {
          throw new DocumentDatabasePlatformError('conflict', 'Suggestion operation already exists.');
        }
        return { kind: 'reserved', record: reserved } as const;
      });
    } catch (error: unknown) {
      if (error instanceof DocumentDatabasePlatformError && error.kind === 'conflict') {
        const existing = await this.find(record.organizationId, record.teacherId, record.operationId);
        if (existing !== null) return { kind: 'existing', record: existing };
      }
      throw error;
    }
  }

  public async complete(recordId: string, expectedVersion: number, text: string,
    citedFactIds: readonly string[], completedAt: string): Promise<TeacherSuggestionRecord | null> {
    return this.documents.runTransaction(async transaction => {
      const current = await transaction.get(TEACHER_SUGGESTION_COLLECTION, recordId);
      if (current === null || current.recordKind !== 'suggestion' || current.status !== 'processing'
        || current.version !== expectedVersion || current.deletedAt !== null) return null;
      const record = project(current, current.organizationId, String(current.teacherId));
      if (record === null) return null;
      const completed: TeacherSuggestionRecord = { ...record, status: 'trial', text,
        citedFactIds: [...citedFactIds], failureReason: null, version: record.version + 1,
        createdAt: completedAt };
      return await transaction.replace(TEACHER_SUGGESTION_COLLECTION, recordId,
        record.version, documentFor(completed)) ? completed : null;
    });
  }

  public async fail(recordId: string, expectedVersion: number, failureReason: string): Promise<boolean> {
    return this.documents.runTransaction(async transaction => {
      const current = await transaction.get(TEACHER_SUGGESTION_COLLECTION, recordId);
      if (current === null || current.recordKind !== 'suggestion' || current.status !== 'processing'
        || current.version !== expectedVersion || current.deletedAt !== null) return false;
      const record = project(current, current.organizationId, String(current.teacherId));
      if (record === null) return false;
      const failed: TeacherSuggestionRecord = { ...record, status: 'failed', failureReason,
        version: record.version + 1 };
      return transaction.replace(TEACHER_SUGGESTION_COLLECTION, recordId, record.version, documentFor(failed));
    });
  }

  public async appendAudit(entry: Parameters<TeacherSuggestionStore['appendAudit']>[0]): Promise<void> {
    const digest = hash(JSON.stringify([entry.organizationId, entry.teacherId, entry.submissionId,
      entry.operationId, entry.outcome, entry.reason, entry.occurredAt]));
    const id = `audit:teacher_suggestion:${digest}`;
    const document: VersionedDocument = { _id: id, id, organizationId: entry.organizationId,
      schemaVersion: 1, version: 1, deletedAt: null, requestId: id,
      actorUserId: entry.teacherId, actorRole: 'teacher', action: 'teacher_ai.suggestion',
      targetType: 'submission', targetId: entry.submissionId, result: entry.outcome === 'rejected'
        ? 'rejected' : 'succeeded', errorCode: entry.outcome === 'rejected' ? entry.reason : null,
      occurredAt: entry.occurredAt,
      metadata: { operationId: entry.operationId, outcome: entry.outcome, reason: entry.reason } };
    await this.documents.runTransaction(transaction => transaction.append('operation_logs', document).then(() => undefined));
  }
}
