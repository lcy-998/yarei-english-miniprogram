import { createHash, randomUUID } from 'node:crypto';
import type { TrustedActorContext } from '../auth/trusted-actor';
import type { DocumentDatabasePort, VersionedDocument } from '../repositories/document-database-port';
import type { TaskCoreReader } from '../task-core/repository';
import type { ReviewVoiceDraft, ReviewVoicePort, ReviewVoiceTarget } from './service';

export const REVIEW_VOICE_COLLECTIONS = {
  drafts: 'review_voice_drafts', operations: 'review_voice_operations',
} as const;

type ReviewTaskReader = Pick<TaskCoreReader,
  'findSubmission' | 'findAssignmentById' | 'listActiveTeacherGrants'>;
type SealStorage = Pick<ReviewVoicePort, 'inspectAndSeal'>;

/** Persistent teacher voice draft and operation receipts; all collections remain ADMINONLY. */
export class DocumentReviewVoicePort implements ReviewVoicePort {
  public constructor(private readonly tasks: ReviewTaskReader,
    private readonly database: DocumentDatabasePort,
    private readonly storage: SealStorage) {}

  public async findTarget(actor: TrustedActorContext,
    submissionId: string): Promise<ReviewVoiceTarget | null> {
    if (actor.actorRole !== 'teacher' || !actor.permissions.includes('submission.review')) return null;
    const submission = await this.tasks.findSubmission(actor.organizationId, submissionId);
    if (!submission || submission.status !== 'submitted') return null;
    const assignment = await this.tasks.findAssignmentById(actor.organizationId, submission.assignmentId);
    if (!assignment || assignment.latestSubmissionId !== submission.id
      || assignment.status !== 'awaiting_review' || !actor.scopeIds.includes(assignment.classId)) return null;
    const grants = await this.tasks.listActiveTeacherGrants(actor.organizationId,
      actor.actorUserId, [assignment.classId]);
    if (!grants.some(grant => grant.status === 'active' && grant.classId === assignment.classId
      && grant.permissions.includes('submission.review'))) return null;
    return { organizationId: actor.organizationId, taskId: submission.taskId,
      assignmentId: assignment.id, submissionId: submission.id,
      submissionVersion: submission.submissionVersion, classId: assignment.classId,
      status: 'submitted' };
  }

  public async findDraft(recordingId: string): Promise<ReviewVoiceDraft | null> {
    return projectDraft(await this.database.get(REVIEW_VOICE_COLLECTIONS.drafts, recordingId));
  }

  public async findSealReceipt(organizationId: string, teacherId: string,
    operationId: string): Promise<Readonly<{ fingerprint: string; draft: ReviewVoiceDraft }> | null> {
    const receipt = await this.database.get(REVIEW_VOICE_COLLECTIONS.operations,
      operationDocumentId('seal', organizationId, teacherId, operationId));
    if (!receipt || receipt.organizationId !== organizationId || receipt.teacherId !== teacherId
      || typeof receipt.fingerprint !== 'string' || typeof receipt.recordingId !== 'string') return null;
    const draft = await this.findDraft(receipt.recordingId);
    return draft && draft.organizationId === organizationId && draft.teacherId === teacherId
      ? { fingerprint: receipt.fingerprint, draft } : null;
  }

  public createDraft(draft: ReviewVoiceDraft, operationId: string): Promise<ReviewVoiceDraft> {
    return this.database.runTransaction(async tx => {
      const receiptId = operationDocumentId('begin', draft.organizationId, draft.teacherId, operationId);
      const prior = await tx.get(REVIEW_VOICE_COLLECTIONS.operations, receiptId);
      if (prior) {
        const replay = projectDraft(await tx.get(REVIEW_VOICE_COLLECTIONS.drafts, String(prior.recordingId)));
        if (!replay) throw new Error('REVIEW_VOICE_RECEIPT_INVALID');
        return replay;
      }
      if (!await tx.create(REVIEW_VOICE_COLLECTIONS.drafts, toDocument(draft))) {
        throw new Error('REVIEW_VOICE_DRAFT_CONFLICT');
      }
      if (!await tx.create(REVIEW_VOICE_COLLECTIONS.operations, {
        _id: receiptId, organizationId: draft.organizationId, schemaVersion: 1,
        version: 1, deletedAt: null, teacherId: draft.teacherId, operationId,
        recordingId: draft.id, submissionId: draft.submissionId,
        action: 'begin', occurredAt: draft.createdAt,
      })) throw new Error('REVIEW_VOICE_RECEIPT_CONFLICT');
      return draft;
    });
  }

  public sealDraft(draft: ReviewVoiceDraft, expectedVersion: number,
    operationId: string, fingerprint: string): Promise<ReviewVoiceDraft | null> {
    return this.database.runTransaction(async tx => {
      const receiptId = operationDocumentId('seal', draft.organizationId, draft.teacherId, operationId);
      const prior = await tx.get(REVIEW_VOICE_COLLECTIONS.operations, receiptId);
      if (prior) {
        if (prior.fingerprint !== fingerprint || prior.recordingId !== draft.id) return null;
        return projectDraft(await tx.get(REVIEW_VOICE_COLLECTIONS.drafts, draft.id));
      }
      const current = projectDraft(await tx.get(REVIEW_VOICE_COLLECTIONS.drafts, draft.id));
      if (!current || current.version !== expectedVersion || current.status !== 'draft'
        || current.organizationId !== draft.organizationId || current.teacherId !== draft.teacherId
        || current.submissionId !== draft.submissionId) return null;
      if (!await tx.replace(REVIEW_VOICE_COLLECTIONS.drafts, draft.id, expectedVersion, toDocument(draft))) return null;
      if (!await tx.create(REVIEW_VOICE_COLLECTIONS.operations, {
        _id: receiptId, organizationId: draft.organizationId, schemaVersion: 1,
        version: 1, deletedAt: null, teacherId: draft.teacherId, operationId,
        recordingId: draft.id, submissionId: draft.submissionId,
        action: 'seal', fingerprint, occurredAt: draft.createdAt,
      })) throw new Error('REVIEW_VOICE_RECEIPT_CONFLICT');
      return draft;
    });
  }

  public nextId(): string { return `review_voice_${randomUUID()}`; }

  public inspectAndSeal(stagingPath: string, stagingFileId: string) {
    return this.storage.inspectAndSeal(stagingPath, stagingFileId);
  }
}

function toDocument(row: ReviewVoiceDraft): VersionedDocument {
  return { _id: row.id, organizationId: row.organizationId,
    schemaVersion: 1, version: row.version, deletedAt: null,
    teacherId: row.teacherId, taskId: row.taskId,
    assignmentId: row.assignmentId, submissionId: row.submissionId,
    submissionVersion: row.submissionVersion, classId: row.classId,
    stagingPath: row.stagingPath, status: row.status,
    fileId: row.fileId, contentSha256: row.contentSha256,
    durationMs: row.durationMs, sizeBytes: row.sizeBytes,
    mediaVersion: row.mediaVersion, createdAt: row.createdAt,
    sealedAt: row.sealedAt ?? null, expiresAt: row.expiresAt };
}

function projectDraft(document: VersionedDocument | null): ReviewVoiceDraft | null {
  if (!document || document.deletedAt !== null || typeof document.teacherId !== 'string'
    || typeof document.taskId !== 'string' || typeof document.assignmentId !== 'string'
    || typeof document.submissionId !== 'string' || !Number.isSafeInteger(document.submissionVersion)
    || typeof document.classId !== 'string' || typeof document.stagingPath !== 'string'
    || (document.status !== 'draft' && document.status !== 'sealed')
    || (document.fileId !== null && typeof document.fileId !== 'string')
    || (document.contentSha256 !== null && typeof document.contentSha256 !== 'string')
    || (document.durationMs !== null && !Number.isSafeInteger(document.durationMs))
    || (document.sizeBytes !== null && !Number.isSafeInteger(document.sizeBytes))
    || !Number.isSafeInteger(document.mediaVersion) || typeof document.createdAt !== 'string'
    || typeof document.expiresAt !== 'string') return null;
  return { id: document._id, organizationId: document.organizationId,
    teacherId: document.teacherId, taskId: document.taskId,
    assignmentId: document.assignmentId, submissionId: document.submissionId,
    submissionVersion: Number(document.submissionVersion), classId: document.classId,
    stagingPath: document.stagingPath, status: document.status,
    fileId: document.fileId, contentSha256: document.contentSha256,
    durationMs: document.durationMs === null ? null : Number(document.durationMs),
    sizeBytes: document.sizeBytes === null ? null : Number(document.sizeBytes),
    mediaVersion: Number(document.mediaVersion), version: document.version,
    createdAt: document.createdAt,
    sealedAt: typeof document.sealedAt === 'string' ? document.sealedAt : null,
    expiresAt: document.expiresAt };
}

function operationDocumentId(action: string, organizationId: string, teacherId: string,
  operationId: string): string {
  return `review_voice_op_${createHash('sha256').update(JSON.stringify([
    action, organizationId, teacherId, operationId,
  ])).digest('hex').slice(0, 40)}`;
}
