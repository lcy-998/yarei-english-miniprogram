import { createHash, randomUUID } from 'node:crypto';
import type { DocumentDatabasePort, DocumentDatabaseTransactionPort,
  VersionedDocument } from '../repositories/document-database-port';
import type { TeacherMediaOperationReceipt, TeacherMediaRecord,
  TeacherMediaTransaction, TeacherMediaUnitOfWork } from './review-service';

export const TEACHER_MEDIA_COLLECTIONS = {
  records: 'teacher_media_records', operations: 'teacher_media_operations',
  grants: 'teacher_class_grants', audit: 'operation_logs',
  resources: 'learning_resources',
} as const;

export class DocumentTeacherMediaUnitOfWork implements TeacherMediaUnitOfWork {
  public constructor(private readonly database: DocumentDatabasePort) {}

  public transaction<T>(work: (transaction: TeacherMediaTransaction) => Promise<T>): Promise<T> {
    return this.database.runTransaction(tx => work(new DocumentTeacherMediaTransaction(tx)));
  }
}

class DocumentTeacherMediaTransaction implements TeacherMediaTransaction {
  public constructor(private readonly tx: DocumentDatabaseTransactionPort) {}

  public async find(organizationId: string, mediaId: string): Promise<TeacherMediaRecord | null> {
    return projectMedia(await this.tx.get(TEACHER_MEDIA_COLLECTIONS.records, mediaId), organizationId);
  }

  public async save(record: TeacherMediaRecord, expectedRecordVersion: number): Promise<boolean> {
    const current = await this.tx.get(TEACHER_MEDIA_COLLECTIONS.records, record.id);
    if (!current || current.organizationId !== record.organizationId
      || current.version !== expectedRecordVersion) return false;
    const saved = await this.tx.replace(TEACHER_MEDIA_COLLECTIONS.records, record.id,
      expectedRecordVersion, mediaDocument(record));
    if (!saved) return false;
    if (record.status === 'published') {
      const oldResource = await this.tx.get(TEACHER_MEDIA_COLLECTIONS.resources, record.id);
      if (oldResource && (oldResource.organizationId !== record.organizationId
        || oldResource.deletedAt !== null || oldResource.type !== record.kind
        || !Number.isSafeInteger(oldResource.contentVersion)
        || Number(oldResource.contentVersion) >= record.version)) {
        throw new Error('TEACHER_MEDIA_RESOURCE_VERSION_CONFLICT');
      }
      const next = resourceDocument(record, oldResource?.version ?? 0);
      const published = oldResource
        ? await this.tx.replace(TEACHER_MEDIA_COLLECTIONS.resources, record.id, oldResource.version, next)
        : await this.tx.create(TEACHER_MEDIA_COLLECTIONS.resources, next);
      if (!published) throw new Error('TEACHER_MEDIA_RESOURCE_CONFLICT');
    }
    return true;
  }

  public async findReceipt(organizationId: string, actorId: string,
    operationId: string): Promise<TeacherMediaOperationReceipt | null> {
    const document = await this.tx.get(TEACHER_MEDIA_COLLECTIONS.operations,
      receiptId(organizationId, actorId, operationId));
    if (!document || document.organizationId !== organizationId
      || document.actorId !== actorId || document.operationId !== operationId
      || typeof document.fingerprint !== 'string'
      || typeof document.result !== 'object' || document.result === null
      || Array.isArray(document.result)) return null;
    const result = projectMediaResult(document.result, organizationId);
    return result ? { fingerprint: document.fingerprint, result } : null;
  }

  public saveReceipt(organizationId: string, actorId: string, operationId: string,
    receipt: TeacherMediaOperationReceipt): Promise<boolean> {
    return this.tx.create(TEACHER_MEDIA_COLLECTIONS.operations, {
      _id: receiptId(organizationId, actorId, operationId), organizationId,
      schemaVersion: 1, version: 1, deletedAt: null, actorId, operationId,
      fingerprint: receipt.fingerprint, result: toJsonRecord(receipt.result),
    });
  }

  public async hasCurrentTeacherClassGrant(organizationId: string, teacherId: string,
    classId: string, permission: string): Promise<boolean> {
    const grants = await this.tx.find(TEACHER_MEDIA_COLLECTIONS.grants, {
      organizationId, teacherId, classId, status: 'active', deletedAt: null,
    });
    return grants.some(grant => Array.isArray(grant.permissions)
      && grant.permissions.includes(permission));
  }

  public async appendAudit(entry: Readonly<{ organizationId: string; actorId: string;
    mediaId: string; action: string; result: 'succeeded' | 'denied';
    reasonProvided: boolean; occurredAt: string }>): Promise<void> {
    const auditId = `teacher_media_audit_${randomUUID()}`;
    if (!await this.tx.append(TEACHER_MEDIA_COLLECTIONS.audit, {
      _id: auditId, organizationId: entry.organizationId, schemaVersion: 1,
      version: 1, deletedAt: null, requestId: auditId,
      actorUserId: entry.actorId, actorRole: 'teacher',
      action: `teacher_media.${entry.action}`, targetType: 'teacher_media',
      targetId: entry.mediaId, result: entry.result,
      errorCode: entry.result === 'denied' ? 'FORBIDDEN' : null,
      occurredAt: entry.occurredAt,
      metadata: { reasonProvided: entry.reasonProvided },
    })) throw new Error('TEACHER_MEDIA_AUDIT_FAILED');
  }
}

function receiptId(organizationId: string, actorId: string, operationId: string): string {
  return `teacher_media_op_${createHash('sha256').update(JSON.stringify([
    organizationId, actorId, operationId,
  ])).digest('hex').slice(0, 40)}`;
}

export function teacherMediaDocument(record: TeacherMediaRecord): VersionedDocument {
  return { _id: record.id, organizationId: record.organizationId, schemaVersion: 1,
    version: record.recordVersion, deletedAt: null, mediaVersion: record.version,
    ownerTeacherId: record.ownerTeacherId, title: record.title,
    ...(record.stagingPath === undefined ? {} : { stagingPath: record.stagingPath }),
    kind: record.kind, status: record.status,
    reviewVersion: record.reviewVersion, reviewedBy: record.reviewedBy,
    reviewedAt: record.reviewedAt, rejectionReason: record.rejectionReason,
    copyrightStatus: record.copyrightStatus,
    copyrightEvidenceKey: record.copyrightEvidenceKey, scanStatus: record.scanStatus,
    transcodeStatus: record.transcodeStatus,
    sourceScanEvidence: record.sourceScanEvidence === null ? null : { ...record.sourceScanEvidence },
    scanEvidence: record.scanEvidence === null ? null : { ...record.scanEvidence },
    transcodeEvidence: record.transcodeEvidence === null ? null : { ...record.transcodeEvidence },
    mediaAssetKey: record.mediaAssetKey,
    mediaSha256: record.mediaSha256, durationMs: record.durationMs,
    allowedClassIds: [...record.allowedClassIds], questionIds: [...record.questionIds],
    questions: record.questions.map(question => ({ ...question, options: [...question.options] })),
    answerKeys: record.answerKeys.map(answer => ({ ...answer,
      correctAnswer: Array.isArray(answer.correctAnswer) ? [...answer.correctAnswer] : answer.correctAnswer })),
    clips: record.clips.map(clip => ({ ...clip })),
    ...(record.subtitleAssetKey === undefined ? {} : { subtitleAssetKey: record.subtitleAssetKey }),
    ...(record.subtitleCues === undefined ? {} : { subtitleCues: record.subtitleCues.map(cue => ({ ...cue })) }),
    continuousPlaybackEnforced: record.continuousPlaybackEnforced };
}

function resourceDocument(record: TeacherMediaRecord,
  previousVersion: number): VersionedDocument {
  return { _id: record.id, organizationId: record.organizationId,
    schemaVersion: 1, version: previousVersion + 1, deletedAt: null,
    type: record.kind, title: record.title, contentVersion: record.version,
    status: 'published', visibility: { type: 'classes', classIds: [...record.allowedClassIds] },
    allowedClassIds: [...record.allowedClassIds],
    copyrightStatus: record.copyrightStatus,
    payload: { teacherMedia: toJsonRecord(record) },
  };
}

export function projectTeacherMediaRecord(document: VersionedDocument | null,
  organizationId: string): TeacherMediaRecord | null {
  if (!document || document.organizationId !== organizationId || document.deletedAt !== null) return null;
  return projectMediaResult({ ...document, id: document._id,
    version: document.mediaVersion, recordVersion: document.version }, organizationId);
}

const mediaDocument = teacherMediaDocument;
const projectMedia = projectTeacherMediaRecord;

function projectMediaResult(value: unknown, organizationId: string): TeacherMediaRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.organizationId !== organizationId || typeof row.id !== 'string'
    || typeof row.title !== 'string' || !row.title.trim()
    || (row.stagingPath !== undefined && typeof row.stagingPath !== 'string')
    || (row.copyrightEvidenceKey !== null && typeof row.copyrightEvidenceKey !== 'string')
    || (row.sourceScanEvidence !== null && (typeof row.sourceScanEvidence !== 'object'
      || Array.isArray(row.sourceScanEvidence)))
    || (row.scanEvidence !== null && (typeof row.scanEvidence !== 'object' || Array.isArray(row.scanEvidence)))
    || (row.transcodeEvidence !== null && (typeof row.transcodeEvidence !== 'object' || Array.isArray(row.transcodeEvidence)))
    || typeof row.ownerTeacherId !== 'string' || !Number.isSafeInteger(row.version)
    || !Number.isSafeInteger(row.recordVersion) || !Array.isArray(row.allowedClassIds)
    || !Array.isArray(row.questionIds) || !Array.isArray(row.questions)
    || !Array.isArray(row.answerKeys) || !Array.isArray(row.clips)) return null;
  return JSON.parse(JSON.stringify(row)) as TeacherMediaRecord;
}

function toJsonRecord(value: object): Record<string, import('../shared/protocol').JsonValue> {
  return JSON.parse(JSON.stringify(value)) as Record<string, import('../shared/protocol').JsonValue>;
}
