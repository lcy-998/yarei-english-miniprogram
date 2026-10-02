import { assignmentDocumentId } from '../repositories/task-core-document-adapter';
import { isSubmittable } from '../task-core/task-core-service';
import type { TaskAssignmentRecord, TaskRecord } from '../task-core/types';
import type { DocumentDatabasePort, DocumentDatabaseTransactionPort, VersionedDocument } from '../repositories/document-database-port';
import { hashHex } from '../shared/request-summary';
import type { JsonValue } from '../shared/protocol';
import type { VocabularyEvidenceTransaction, VocabularyEvidenceUnitOfWork } from './repository';
import { VocabularyEvidenceError, type VocabularyAttemptReceipt, type VocabularyAttemptRecord,
  type VocabularyEvidenceScope, type VocabularyWordSnapshot } from './types';

export const VOCABULARY_EVIDENCE_COLLECTIONS = {
  resources: 'learning_resources', memberships: 'class_memberships', tasks: 'tasks', assignments: 'task_assignments',
  attempts: 'vocabulary_attempts', receipts: 'vocabulary_attempt_operations',
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function json(value: object): JsonValue { return JSON.parse(JSON.stringify(value)) as JsonValue; }
function visible(document: VersionedDocument | null, organizationId: string): document is VersionedDocument {
  return document !== null && document.organizationId === organizationId && document.deletedAt === null;
}
function contentVersion(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  return null;
}
function words(value: unknown): VocabularyWordSnapshot[] | null {
  if (!Array.isArray(value) || !value.length) return null;
  const result: VocabularyWordSnapshot[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== 'string' || !item.id.trim()
      || typeof item.word !== 'string' || !item.word.trim()) return null;
    result.push({ id: item.id, spelling: item.word });
  }
  return new Set(result.map(item => item.id)).size === result.length ? result : null;
}
function receiptId(organizationId: string, studentId: string, operationId: string): string {
  return `word_attempt_operation_${hashHex(JSON.stringify([organizationId, studentId, operationId]))}`;
}
function projectAttempt(value: unknown): VocabularyAttemptRecord | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.organizationId !== 'string'
    || typeof value.studentId !== 'string' || typeof value.packId !== 'string'
    || (value.taskId !== null && typeof value.taskId !== 'string')
    || (value.itemId !== null && typeof value.itemId !== 'string')
    || !Number.isSafeInteger(value.round) || Number(value.round) < 0
    || typeof value.contentVersion !== 'string' || typeof value.wordId !== 'string'
    || typeof value.studentInput !== 'string' || typeof value.isCorrect !== 'boolean'
    || typeof value.firstAttempt !== 'boolean' || !Number.isSafeInteger(value.attemptNumber)
    || Number(value.attemptNumber) < 1 || typeof value.attemptedAt !== 'string'
    || !Number.isFinite(Date.parse(value.attemptedAt))) return null;
  return { id: value.id, organizationId: value.organizationId, studentId: value.studentId,
    packId: value.packId, taskId: value.taskId, itemId: value.itemId,
    round: Number(value.round), contentVersion: value.contentVersion, wordId: value.wordId,
    studentInput: value.studentInput, isCorrect: value.isCorrect, firstAttempt: value.firstAttempt,
    attemptNumber: Number(value.attemptNumber), attemptedAt: value.attemptedAt };
}

class DocumentVocabularyEvidenceTransaction implements VocabularyEvidenceTransaction {
  public constructor(private readonly database: DocumentDatabaseTransactionPort) {}

  public async findAutonomousScope(organizationId: string, studentId: string,
    packId: string): Promise<VocabularyEvidenceScope | null> {
    const document = await this.database.get(VOCABULARY_EVIDENCE_COLLECTIONS.resources, packId);
    if (!visible(document, organizationId) || document.type !== 'vocabulary') return null;
    const version = contentVersion(document.contentVersion);
    const payload = isRecord(document.payload) ? document.payload : null;
    const wordEntries = words(document.words ?? payload?.words);
    if (!version || !wordEntries) return null;
    let authorized = Array.isArray(document.allowedStudentIds) && document.allowedStudentIds.includes(studentId);
    if (!authorized && isRecord(document.visibility)) {
      const memberships = await this.database.find(VOCABULARY_EVIDENCE_COLLECTIONS.memberships, { organizationId,
        studentId, status: 'active', deletedAt: null });
      authorized = memberships.some(item => document.visibility && isRecord(document.visibility)
        && (document.visibility.type === 'organization' || (document.visibility.type === 'classes'
          && Array.isArray(document.visibility.classIds) && document.visibility.classIds.includes(item.classId))));
    }
    if (!authorized) return null;
    return { organizationId, studentId, packId, contentVersion: version, words: wordEntries,
      taskId: null, itemId: null, round: 0, status: document.status === 'published' ? 'available' : 'locked' };
  }

  public async findTaskScope(organizationId: string, studentId: string, taskId: string, itemId: string,
    packId: string, nowIso: string): Promise<VocabularyEvidenceScope | null> {
    const task = await this.database.get(VOCABULARY_EVIDENCE_COLLECTIONS.tasks, taskId);
    const assignment = await this.database.get(VOCABULARY_EVIDENCE_COLLECTIONS.assignments,
      assignmentDocumentId(organizationId, taskId, studentId));
    if (!visible(task, organizationId) || !visible(assignment, organizationId)
      || assignment.studentId !== studentId || assignment.taskId !== taskId || !Array.isArray(task.items)) return null;
    const candidates = task.items.filter(item => isRecord(item) && item.id === itemId && item.resourceId === packId
      && isRecord(item.resourceSnapshot) && item.resourceSnapshot.type === 'vocabulary');
    if (candidates.length !== 1 || !isRecord(candidates[0])) return null;
    const item = candidates[0];
    const snapshot = item.resourceSnapshot;
    if (!isRecord(snapshot) || !isRecord(snapshot.payload)) return null;
    const wordEntries = words(snapshot.payload.words);
    const version = contentVersion(item.resourceVersion);
    if (!wordEntries || !version || !Number.isSafeInteger(assignment.latestSubmissionVersion)
      || Number(assignment.latestSubmissionVersion) < 0) return null;
    const validTask = typeof task.id === 'string' && task.id === taskId
      && typeof task.status === 'string' && typeof task.visibility === 'string'
      && typeof task.startsAt === 'string' && typeof task.dueAt === 'string'
      && isRecord(task.latePolicy) && typeof task.latePolicy.allowLate === 'boolean'
      && typeof task.latePolicy.lateDays === 'number';
    const validAssignment = typeof assignment.status === 'string'
      && (assignment.redoDueAt === null || typeof assignment.redoDueAt === 'string');
    if (!validTask || !validAssignment) return null;
    const locked = !isSubmittable(task as unknown as TaskRecord, assignment as unknown as TaskAssignmentRecord, nowIso);
    return { organizationId, studentId, packId, contentVersion: version, words: wordEntries,
      taskId, itemId, round: Number(assignment.latestSubmissionVersion) + 1,
      status: locked ? 'locked' : 'available' };
  }

  public async listAttempts(organizationId: string, studentId: string, packId: string, taskId: string | null,
    itemId: string | null, round: number, version: string, wordId: string): Promise<readonly VocabularyAttemptRecord[]> {
    const documents = await this.database.find(VOCABULARY_EVIDENCE_COLLECTIONS.attempts, { organizationId,
      studentId, packId, taskId, itemId, round, contentVersion: version, wordId, deletedAt: null });
    const attempts = documents.map(document => {
      const projected = projectAttempt(document);
      if (!projected || projected.organizationId !== organizationId || projected.studentId !== studentId) {
        throw new VocabularyEvidenceError('SERVICE_UNAVAILABLE');
      }
      return projected;
    });
    return attempts.sort((left, right) => left.attemptNumber - right.attemptNumber);
  }

  public async listScopeAttempts(organizationId: string, studentId: string, packId: string, taskId: string | null,
    itemId: string | null, round: number, version: string): Promise<readonly VocabularyAttemptRecord[]> {
    const documents = await this.database.find(VOCABULARY_EVIDENCE_COLLECTIONS.attempts, { organizationId,
      studentId, packId, taskId, itemId, round, contentVersion: version, deletedAt: null });
    return documents.map(document => {
      const projected = projectAttempt(document);
      if (!projected || projected.organizationId !== organizationId || projected.studentId !== studentId
        || projected.packId !== packId || projected.taskId !== taskId || projected.itemId !== itemId
        || projected.round !== round || projected.contentVersion !== version) {
        throw new VocabularyEvidenceError('SERVICE_UNAVAILABLE');
      }
      return projected;
    });
  }

  public async appendAttempt(attempt: VocabularyAttemptRecord): Promise<boolean> {
    return this.database.create(VOCABULARY_EVIDENCE_COLLECTIONS.attempts, {
      _id: attempt.id, organizationId: attempt.organizationId, schemaVersion: 1, version: 1, deletedAt: null,
      ...json(attempt) as Record<string, JsonValue>,
    });
  }

  public async findReceipt(organizationId: string, studentId: string,
    operationId: string): Promise<VocabularyAttemptReceipt | null> {
    const document = await this.database.get(VOCABULARY_EVIDENCE_COLLECTIONS.receipts,
      receiptId(organizationId, studentId, operationId));
    if (!visible(document, organizationId) || document.studentId !== studentId
      || document.operationId !== operationId || typeof document.fingerprint !== 'string') return null;
    const result = projectAttempt(document.result);
    if (!result || result.organizationId !== organizationId || result.studentId !== studentId) return null;
    return { organizationId, studentId, operationId, fingerprint: document.fingerprint, result };
  }

  public async saveReceipt(receipt: VocabularyAttemptReceipt): Promise<boolean> {
    return this.database.create(VOCABULARY_EVIDENCE_COLLECTIONS.receipts, {
      _id: receiptId(receipt.organizationId, receipt.studentId, receipt.operationId),
      organizationId: receipt.organizationId, schemaVersion: 1, version: 1, deletedAt: null,
      studentId: receipt.studentId, operationId: receipt.operationId, fingerprint: receipt.fingerprint,
      result: json(receipt.result),
    });
  }
}

export class DocumentVocabularyEvidenceRepository implements VocabularyEvidenceUnitOfWork {
  public constructor(private readonly database: DocumentDatabasePort) {}
  public transaction<T>(work: (transaction: VocabularyEvidenceTransaction) => Promise<T>): Promise<T> {
    return this.database.runTransaction(transaction => work(new DocumentVocabularyEvidenceTransaction(transaction)));
  }
}
