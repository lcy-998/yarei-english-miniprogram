import type { JsonValue } from '../shared/protocol';
import { hashHex } from '../shared/request-summary';
import type { DocumentDatabasePort, DocumentDatabaseTransactionPort, VersionedDocument } from '../repositories/document-database-port';
import type { StudentWorkTransaction, StudentWorkUnitOfWork } from './repository';
import { StudentWorkError, type StudentWork, type WorkMaterial, type WorkReceipt } from './types';

export const STUDENT_WORK_COLLECTIONS = {
  users: 'users', classes: 'classes', memberships: 'class_memberships',
  materials: 'learning_resources', works: 'student_works', receipts: 'student_work_operations',
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function json(value: object): JsonValue { return JSON.parse(JSON.stringify(value)) as JsonValue; }
function visible(document: VersionedDocument | null, organizationId: string): document is VersionedDocument {
  return document !== null && document.organizationId === organizationId && document.deletedAt === null;
}
function receiptId(organizationId: string, studentId: string, operationId: string): string {
  return `student_work_operation_${hashHex(JSON.stringify([organizationId, studentId, operationId]))}`;
}
function contentVersion(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  return null;
}
function projectMaterial(document: VersionedDocument, organizationId: string): WorkMaterial | null {
  if (!visible(document, organizationId) || document.type !== 'work'
    || typeof document.id !== 'string' || typeof document.title !== 'string'
    || (document.status !== 'published' && document.status !== 'draft' && document.status !== 'offline')
    || !isRecord(document.payload) || typeof document.payload.demonstrationFileId !== 'string'
    || typeof document.payload.subtitle !== 'string' || !isRecord(document.visibility)) return null;
  const version = contentVersion(document.contentVersion);
  if (!version) return null;
  const visibility = document.visibility.type === 'organization' ? { type: 'organization' as const }
    : document.visibility.type === 'classes' && Array.isArray(document.visibility.classIds)
      && document.visibility.classIds.every(item => typeof item === 'string')
      ? { type: 'classes' as const, classIds: document.visibility.classIds as string[] } : null;
  return visibility ? { id: document.id, organizationId, title: document.title, contentVersion: version,
    status: document.status, visibility,
    demonstrationFileId: document.payload.demonstrationFileId, subtitle: document.payload.subtitle,
    ...(typeof document.grade === 'string' && document.grade.trim() ? { grade: document.grade.trim() }
      : typeof document.payload.grade === 'string' && document.payload.grade.trim()
        ? { grade: document.payload.grade.trim() } : {}),
    ...(typeof document.textbook === 'string' && document.textbook.trim() ? { textbook: document.textbook.trim() }
      : typeof document.payload.textbook === 'string' && document.payload.textbook.trim()
        ? { textbook: document.payload.textbook.trim() } : {}),
    ...(typeof document.unit === 'string' && document.unit.trim() ? { unit: document.unit.trim() }
      : typeof document.payload.unit === 'string' && document.payload.unit.trim()
        ? { unit: document.payload.unit.trim() } : {}) } : null;
}
export function projectStudentWork(value: unknown): StudentWork | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.organizationId !== 'string'
    || typeof value.studentId !== 'string' || typeof value.classId !== 'string'
    || typeof value.materialId !== 'string' || typeof value.materialVersion !== 'string'
    || typeof value.stagingPath !== 'string' || (value.status !== 'draft' && value.status !== 'submitted')
    || (value.fileId !== null && typeof value.fileId !== 'string')
    || (value.contentSha256 !== null && typeof value.contentSha256 !== 'string')
    || (value.sizeBytes !== null && (!Number.isSafeInteger(value.sizeBytes) || Number(value.sizeBytes) < 1))
    || (value.durationMs !== null && (!Number.isSafeInteger(value.durationMs) || Number(value.durationMs) < 1))
    || typeof value.note !== 'string' || !Number.isSafeInteger(value.version) || Number(value.version) < 1
    || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))
    || (value.submittedAt !== null && (typeof value.submittedAt !== 'string'
      || !Number.isFinite(Date.parse(value.submittedAt))))
    || (value.deletedAt !== undefined && value.deletedAt !== null
      && (typeof value.deletedAt !== 'string' || !Number.isFinite(Date.parse(value.deletedAt))))
    || (value.deletedAt !== undefined && value.deletedAt !== null
      && (typeof value.recoverableUntil !== 'string'
        || !Number.isFinite(Date.parse(value.recoverableUntil))
        || typeof value.deletedByUserId !== 'string' || !value.deletedByUserId.trim()))
    || (value.recoveryState !== undefined && value.recoveryState !== 'active'
      && value.recoveryState !== 'deleted')
    || (value.mediaDeletedAt !== undefined && value.mediaDeletedAt !== null
      && (typeof value.mediaDeletedAt !== 'string' || !Number.isFinite(Date.parse(value.mediaDeletedAt))))) return null;
  return { id: value.id, organizationId: value.organizationId, studentId: value.studentId,
    classId: value.classId, materialId: value.materialId, materialVersion: value.materialVersion,
    stagingPath: value.stagingPath, status: value.status, fileId: value.fileId,
    contentSha256: value.contentSha256,
    sizeBytes: value.sizeBytes === null ? null : Number(value.sizeBytes),
    durationMs: value.durationMs === null ? null : Number(value.durationMs),
    note: value.note, version: Number(value.version), createdAt: value.createdAt,
    submittedAt: value.submittedAt,
    deletedAt: value.deletedAt === undefined ? null : value.deletedAt as string | null,
    recoverableUntil: value.recoverableUntil === undefined ? null : value.recoverableUntil as string | null,
    deletedByUserId: value.deletedByUserId === undefined ? null : value.deletedByUserId as string | null,
    ...(value.recoveryState === 'active' || value.recoveryState === 'deleted'
      ? { recoveryState: value.recoveryState } : {}),
    mediaDeletedAt: value.mediaDeletedAt === undefined ? null : value.mediaDeletedAt as string | null };
}

class DocumentStudentWorkTransaction implements StudentWorkTransaction {
  public constructor(private readonly documents: DocumentDatabaseTransactionPort) {}
  public async findActiveClassId(organizationId: string, studentId: string): Promise<string | null> {
    const user = await this.documents.get(STUDENT_WORK_COLLECTIONS.users, studentId);
    if (!visible(user, organizationId) || user.status !== 'active') return null;
    const memberships = await this.documents.find(STUDENT_WORK_COLLECTIONS.memberships, { organizationId,
      studentId, status: 'active', deletedAt: null });
    if (memberships.length !== 1 || typeof memberships[0]?.classId !== 'string') return null;
    const classId = memberships[0].classId;
    const classRecord = await this.documents.get(STUDENT_WORK_COLLECTIONS.classes, classId);
    return visible(classRecord, organizationId) && classRecord.status === 'active' ? classId : null;
  }
  public async findMaterial(organizationId: string, materialId: string): Promise<WorkMaterial | null> {
    const document = await this.documents.get(STUDENT_WORK_COLLECTIONS.materials, materialId);
    return document ? projectMaterial(document, organizationId) : null;
  }
  public async listMaterials(organizationId: string): Promise<readonly WorkMaterial[]> {
    const documents = await this.documents.find(STUDENT_WORK_COLLECTIONS.materials, { organizationId,
      type: 'work', deletedAt: null });
    return documents.map(document => projectMaterial(document, organizationId)).filter((item): item is WorkMaterial => item !== null);
  }
  public async findWork(organizationId: string, workId: string): Promise<StudentWork | null> {
    const document = await this.documents.get(STUDENT_WORK_COLLECTIONS.works, workId);
    if (!visible(document, organizationId)) return null;
    const work = projectStudentWork({ ...document, version: document.version });
    if (!work || work.id !== workId) throw new StudentWorkError('SERVICE_UNAVAILABLE');
    return work;
  }
  public async listStudentWorks(organizationId: string, studentId: string): Promise<readonly StudentWork[]> {
    const documents = await this.documents.find(STUDENT_WORK_COLLECTIONS.works, { organizationId,
      studentId, deletedAt: null });
    return documents.map(document => {
      const work = projectStudentWork({ ...document, version: document.version });
      if (!work || work.organizationId !== organizationId || work.studentId !== studentId) {
        throw new StudentWorkError('SERVICE_UNAVAILABLE');
      }
      return work;
    });
  }
  public async saveWork(work: StudentWork, expectedVersion: number): Promise<boolean> {
    const document: VersionedDocument = { _id: work.id, organizationId: work.organizationId,
      schemaVersion: 1, version: work.version, deletedAt: work.deletedAt ?? null,
      ...json(work) as Record<string, JsonValue> };
    return expectedVersion === 0
      ? this.documents.create(STUDENT_WORK_COLLECTIONS.works, document)
      : this.documents.replace(STUDENT_WORK_COLLECTIONS.works, work.id, expectedVersion, document);
  }
  public async findReceipt(organizationId: string, studentId: string, operationId: string): Promise<WorkReceipt | null> {
    const document = await this.documents.get(STUDENT_WORK_COLLECTIONS.receipts,
      receiptId(organizationId, studentId, operationId));
    if (!visible(document, organizationId) || document.studentId !== studentId
      || document.operationId !== operationId || typeof document.fingerprint !== 'string') return null;
    const result = projectStudentWork(document.result);
    if (!result || result.organizationId !== organizationId || result.studentId !== studentId) {
      throw new StudentWorkError('SERVICE_UNAVAILABLE');
    }
    return { organizationId, studentId, operationId, fingerprint: document.fingerprint, result,
      ...(document.action === 'deleteDraft' ? { action: 'deleteDraft' as const } : {}),
      ...(typeof document.occurredAt === 'string' ? { occurredAt: document.occurredAt } : {}) };
  }
  public async saveReceipt(receipt: WorkReceipt): Promise<boolean> {
    return this.documents.create(STUDENT_WORK_COLLECTIONS.receipts, {
      _id: receiptId(receipt.organizationId, receipt.studentId, receipt.operationId),
      organizationId: receipt.organizationId, schemaVersion: 1, version: 1, deletedAt: null,
      studentId: receipt.studentId, operationId: receipt.operationId,
      fingerprint: receipt.fingerprint, result: json(receipt.result),
      ...(receipt.action ? { action: receipt.action } : {}),
      ...(receipt.occurredAt ? { occurredAt: receipt.occurredAt } : {}),
    });
  }
}

export class DocumentStudentWorkRepository implements StudentWorkUnitOfWork {
  public constructor(private readonly documents: DocumentDatabasePort) {}
  public async transaction<T>(work: (transaction: StudentWorkTransaction) => Promise<T>): Promise<T> {
    return this.documents.runTransaction(async documents => work(new DocumentStudentWorkTransaction(documents)));
  }
}
