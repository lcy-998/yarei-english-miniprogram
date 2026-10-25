import { createHash, randomUUID } from 'node:crypto';
import type { DocumentDatabasePort, VersionedDocument } from '../repositories/document-database-port';
import type { TeacherMediaDraftPort } from './draft-service';
import { TEACHER_MEDIA_COLLECTIONS, projectTeacherMediaRecord,
  teacherMediaDocument } from './document-review-port';
import type { TeacherMediaRecord } from './review-service';

export class DocumentTeacherMediaDraftPort implements TeacherMediaDraftPort {
  public constructor(private readonly database: DocumentDatabasePort) {}

  public async hasCurrentTeacherClassGrant(organizationId: string, teacherId: string,
    classId: string, permission: 'media.upload'): Promise<boolean> {
    const grants = await this.database.find(TEACHER_MEDIA_COLLECTIONS.grants,
      { organizationId, teacherId, classId, status: 'active', deletedAt: null });
    return grants.some(grant => Array.isArray(grant.permissions) && grant.permissions.includes(permission));
  }

  public async find(organizationId: string, mediaId: string): Promise<TeacherMediaRecord | null> {
    return projectTeacherMediaRecord(await this.database.get(TEACHER_MEDIA_COLLECTIONS.records, mediaId),
      organizationId);
  }

  public async findSealReceipt(organizationId: string, teacherId: string,
    operationId: string): Promise<Readonly<{ fingerprint: string; record: TeacherMediaRecord }> | null> {
    const receipt = await this.database.get(TEACHER_MEDIA_COLLECTIONS.operations,
      operationDocumentId('seal', organizationId, teacherId, operationId));
    if (!receipt || receipt.organizationId !== organizationId || receipt.actorId !== teacherId
      || typeof receipt.fingerprint !== 'string' || typeof receipt.mediaId !== 'string') return null;
    const record = await this.find(organizationId, receipt.mediaId);
    return record && record.ownerTeacherId === teacherId
      ? { fingerprint: receipt.fingerprint, record } : null;
  }

  public create(record: TeacherMediaRecord,
    operationId: string): Promise<TeacherMediaRecord> {
    return this.database.runTransaction(async tx => {
      const receiptId = operationDocumentId('begin', record.organizationId, record.ownerTeacherId, operationId);
      const fingerprint = createHash('sha256').update(JSON.stringify({ ...record,
        id: null, stagingPath: null })).digest('hex');
      const prior = await tx.get(TEACHER_MEDIA_COLLECTIONS.operations, receiptId);
      if (prior) {
        if (prior.fingerprint !== fingerprint || typeof prior.mediaId !== 'string') {
          throw new Error('MEDIA_BEGIN_OPERATION_CONFLICT');
        }
        const existing = projectTeacherMediaRecord(await tx.get(TEACHER_MEDIA_COLLECTIONS.records,
          prior.mediaId), record.organizationId);
        if (!existing) throw new Error('MEDIA_BEGIN_RECEIPT_INVALID');
        return existing;
      }
      if (!await tx.create(TEACHER_MEDIA_COLLECTIONS.records, teacherMediaDocument(record))) {
        throw new Error('MEDIA_DRAFT_CONFLICT');
      }
      if (!await tx.create(TEACHER_MEDIA_COLLECTIONS.operations, {
        _id: receiptId, organizationId: record.organizationId,
        schemaVersion: 1, version: 1, deletedAt: null,
        actorId: record.ownerTeacherId, operationId, action: 'begin', mediaId: record.id,
        fingerprint,
      })) throw new Error('MEDIA_DRAFT_RECEIPT_CONFLICT');
      await appendAudit(tx, record.organizationId, record.ownerTeacherId, record.id,
        'teacher_media.begin', record.recordVersion);
      return record;
    });
  }

  public replace(record: TeacherMediaRecord, expectedVersion: number,
    operationId: string, fingerprint: string): Promise<TeacherMediaRecord | null> {
    return this.database.runTransaction(async tx => {
      const receiptId = operationDocumentId('seal', record.organizationId, record.ownerTeacherId, operationId);
      const prior = await tx.get(TEACHER_MEDIA_COLLECTIONS.operations, receiptId);
      if (prior) return prior.fingerprint === fingerprint && prior.mediaId === record.id
        ? projectTeacherMediaRecord(await tx.get(TEACHER_MEDIA_COLLECTIONS.records, record.id),
          record.organizationId) : null;
      const current = projectTeacherMediaRecord(await tx.get(TEACHER_MEDIA_COLLECTIONS.records,
        record.id), record.organizationId);
      if (!current || current.recordVersion !== expectedVersion
        || current.ownerTeacherId !== record.ownerTeacherId
        || (current.status !== 'draft' && current.status !== 'rejected')) return null;
      if (!await tx.replace(TEACHER_MEDIA_COLLECTIONS.records, record.id, expectedVersion,
        teacherMediaDocument(record))) return null;
      if (!await tx.create(TEACHER_MEDIA_COLLECTIONS.operations, {
        _id: receiptId, organizationId: record.organizationId,
        schemaVersion: 1, version: 1, deletedAt: null,
        actorId: record.ownerTeacherId, operationId, action: 'seal', mediaId: record.id,
        fingerprint,
      })) throw new Error('MEDIA_SEAL_RECEIPT_CONFLICT');
      await appendAudit(tx, record.organizationId, record.ownerTeacherId, record.id,
        'teacher_media.seal', record.recordVersion);
      return record;
    });
  }

  public nextId(): string { return `teacher_media_${randomUUID()}`; }
}

async function appendAudit(tx: import('../repositories/document-database-port').DocumentDatabaseTransactionPort,
  organizationId: string, actorId: string, mediaId: string, action: string,
  recordVersion: number): Promise<void> {
  const id = `teacher_media_audit_${randomUUID()}`;
  const entry: VersionedDocument = { _id: id, organizationId, schemaVersion: 1,
    version: 1, deletedAt: null, requestId: id, actorUserId: actorId,
    actorRole: 'teacher', action, targetType: 'teacher_media', targetId: mediaId,
    result: 'succeeded', errorCode: null,
    occurredAt: new Date().toISOString(), metadata: { recordVersion } };
  if (!await tx.append(TEACHER_MEDIA_COLLECTIONS.audit, entry)) throw new Error('MEDIA_AUDIT_FAILED');
}

function operationDocumentId(action: string, organizationId: string, actorId: string,
  operationId: string): string {
  return `teacher_media_op_${createHash('sha256').update(JSON.stringify([
    action, organizationId, actorId, operationId,
  ])).digest('hex').slice(0, 40)}`;
}
