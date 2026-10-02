import type { TrustedActorContext } from '../auth/trusted-actor';
import type { DocumentDatabasePort, VersionedDocument } from '../repositories/document-database-port';
import { hashHex } from '../shared/request-summary';
import type { ErrorCode } from '../shared/protocol';
import { projectStudentWork } from './document-repository';

const WORKS = 'student_works';
const MATERIALS = 'learning_resources';
const RECEIPTS = 'student_work_operations';
const AUDIT = 'operation_logs';
const RECOVERY_MS = 7 * 24 * 60 * 60 * 1000;

export type RestoreBlockReason = 'expired' | 'cleanup_locked' | 'staging_deleted' | 'invalid_record';
export interface DeletedWorkDraftSummary {
  readonly id: string;
  readonly studentId: string;
  readonly materialId: string;
  readonly materialTitle: string | null;
  readonly version: number;
  readonly deletedAt: string;
  readonly recoverableUntil: string;
  readonly stagingCleanupStatus: 'none' | 'deleting' | 'deleted' | 'unknown';
  readonly restorable: boolean;
  readonly blockedReason: RestoreBlockReason | null;
}
export interface DeletedWorkDraftPage {
  readonly items: readonly DeletedWorkDraftSummary[];
  readonly nextOffset: number | null;
}
export interface RestoredWorkDraftView {
  readonly id: string;
  readonly studentId: string;
  readonly materialId: string;
  readonly version: number;
  readonly restoredAt: string;
  readonly restoredByUserId: string;
}

export class StudentWorkAdminError extends Error {
  public constructor(public readonly code: ErrorCode,
    public readonly fieldMessage?: string) { super(code); this.name = 'StudentWorkAdminError'; }
}

function validId(value: string): boolean {
  return typeof value === 'string' && !!value.trim() && value.length <= 128;
}
function validOperation(value: string): boolean {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(value);
}
function instant(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function cleanupStatus(value: unknown): DeletedWorkDraftSummary['stagingCleanupStatus'] {
  if (value === undefined || value === null) return 'none';
  return value === 'deleting' || value === 'deleted' ? value : 'unknown';
}
function blocked(document: VersionedDocument, nowMs: number): RestoreBlockReason | null {
  const work = projectStudentWork({ ...document, version: document.version });
  const deletedMs = instant(document.deletedAt);
  const deadlineMs = instant(document.recoverableUntil);
  if (!work || work.status !== 'draft' || work.recoveryState !== 'deleted'
    || work.id !== document._id || work.studentId !== document.studentId
    || work.deletedByUserId !== work.studentId || work.fileId !== null
    || work.contentSha256 !== null || work.submittedAt !== null
    || work.stagingPath !== `student-works/staging/${hashHex(JSON.stringify([work.organizationId, work.studentId]))}/${work.id}.mp3`
    || deletedMs === null || deadlineMs === null || deadlineMs < deletedMs + RECOVERY_MS) {
    return 'invalid_record';
  }
  if (document.stagingMediaDeletedAt !== undefined && document.stagingMediaDeletedAt !== null) {
    return 'staging_deleted';
  }
  if (cleanupStatus(document.stagingCleanupStatus) !== 'none') return 'cleanup_locked';
  return nowMs >= deadlineMs ? 'expired' : null;
}
function summary(document: VersionedDocument, nowMs: number, materialTitle: string | null): DeletedWorkDraftSummary {
  if (typeof document.id !== 'string' || document.id !== document._id
    || typeof document.studentId !== 'string' || typeof document.materialId !== 'string'
    || typeof document.deletedAt !== 'string' || typeof document.recoverableUntil !== 'string') {
    throw new StudentWorkAdminError('SERVICE_UNAVAILABLE');
  }
  const blockedReason = blocked(document, nowMs);
  return { id: document.id, studentId: document.studentId, materialId: document.materialId, materialTitle,
    version: document.version, deletedAt: document.deletedAt,
    recoverableUntil: document.recoverableUntil,
    stagingCleanupStatus: cleanupStatus(document.stagingCleanupStatus),
    restorable: blockedReason === null, blockedReason };
}
function restoreReceiptId(actor: TrustedActorContext, operationId: string): string {
  return `student_work_restore_${hashHex(JSON.stringify([actor.organizationId, actor.actorUserId, operationId]))}`;
}

/** Administrator-only recovery of S-12 soft-deleted, unsubmitted works. */
export class StudentWorkAdminService {
  public constructor(private readonly database: DocumentDatabasePort,
    private readonly clock: { nowIso(): string }) {}

  public async listDeletedDrafts(actor: TrustedActorContext, studentId: string,
    page: Readonly<{ limit: number; offset: number }>): Promise<DeletedWorkDraftPage> {
    this.authorize(actor);
    if (!validId(studentId) || !Number.isSafeInteger(page.limit) || page.limit < 1 || page.limit > 50
      || !Number.isSafeInteger(page.offset) || page.offset < 0 || page.offset > 10000) {
      throw new StudentWorkAdminError('VALIDATION_ERROR');
    }
    const nowMs = instant(this.clock.nowIso());
    if (nowMs === null) throw new StudentWorkAdminError('SERVICE_UNAVAILABLE');
    const result = await this.database.findPage(WORKS, { organizationId: actor.organizationId,
      studentId, status: 'draft', recoveryState: 'deleted' }, page);
    const items = await Promise.all(result.items.map(async item => {
      if (item.organizationId !== actor.organizationId || item.studentId !== studentId
        || item.status !== 'draft' || item.recoveryState !== 'deleted') {
        throw new StudentWorkAdminError('SERVICE_UNAVAILABLE');
      }
      const material = await this.database.get(MATERIALS, String(item.materialId));
      const materialTitle = material?.organizationId === actor.organizationId
        && material.type === 'work' && material._id === item.materialId
        && typeof material.title === 'string' && material.title.trim()
        ? material.title : null;
      return summary(item, nowMs, materialTitle);
    }));
    return { items, nextOffset: result.hasMore ? page.offset + page.limit : null };
  }

  public async restoreDraft(actor: TrustedActorContext, input: Readonly<{ studentId: string; workId: string;
    expectedVersion: number; operationId: string; reason: string }>): Promise<RestoredWorkDraftView> {
    this.authorize(actor);
    const reason = input.reason?.trim();
    if (!validId(input.studentId) || !validId(input.workId) || !validOperation(input.operationId)
      || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1
      || !reason || reason.length > 200) throw new StudentWorkAdminError('VALIDATION_ERROR');
    const now = this.clock.nowIso();
    const nowMs = instant(now);
    if (nowMs === null) throw new StudentWorkAdminError('SERVICE_UNAVAILABLE');
    const fingerprint = hashHex(JSON.stringify([input.studentId, input.workId,
      input.expectedVersion, reason, actor.actorUserId]));
    return this.database.runTransaction(async tx => {
      const receiptId = restoreReceiptId(actor, input.operationId);
      const prior = await tx.get(RECEIPTS, receiptId);
      if (prior) {
        if (prior.organizationId !== actor.organizationId || prior.actorUserId !== actor.actorUserId
          || prior.fingerprint !== fingerprint || prior.action !== 'restoreDraft'
          || typeof prior.result !== 'object' || prior.result === null || Array.isArray(prior.result)) {
          throw new StudentWorkAdminError('CONFLICT');
        }
        const result = prior.result as unknown as RestoredWorkDraftView;
        if (result.id !== input.workId || result.studentId !== input.studentId
          || result.restoredByUserId !== actor.actorUserId || !validId(result.materialId)
          || !Number.isSafeInteger(result.version) || result.version !== input.expectedVersion + 1
          || instant(result.restoredAt) === null) throw new StudentWorkAdminError('CONFLICT');
        return result;
      }
      const current = await tx.get(WORKS, input.workId);
      if (!current || current.organizationId !== actor.organizationId || current.studentId !== input.studentId) {
        throw new StudentWorkAdminError('NOT_FOUND');
      }
      if (current.status !== 'draft') throw new StudentWorkAdminError('CONFLICT', '已提交作品不可按草稿恢复。');
      if (current.version !== input.expectedVersion) throw new StudentWorkAdminError('CONFLICT', '草稿版本已变化，请刷新后重试。');
      if (current.deletedAt === null || current.recoveryState !== 'deleted') {
        throw new StudentWorkAdminError('CONFLICT', '草稿已恢复。');
      }
      const block = blocked(current, nowMs);
      if (block === 'expired') throw new StudentWorkAdminError('CONFLICT', '七天恢复期限已过。');
      if (block === 'cleanup_locked') throw new StudentWorkAdminError('CONFLICT', '暂存文件清理已锁定。');
      if (block === 'staging_deleted') throw new StudentWorkAdminError('CONFLICT', '暂存文件已清理。');
      if (block !== null) throw new StudentWorkAdminError('CONFLICT', '草稿记录不符合恢复条件。');
      const next: VersionedDocument = { ...current, version: current.version + 1,
        deletedAt: null, recoverableUntil: null, deletedByUserId: null,
        recoveryState: 'active', restoredAt: now, restoredByUserId: actor.actorUserId };
      if (!await tx.replace(WORKS, input.workId, current.version, next)) throw new StudentWorkAdminError('CONFLICT');
      const result: RestoredWorkDraftView = { id: input.workId, studentId: input.studentId,
        materialId: String(current.materialId), version: next.version,
        restoredAt: now, restoredByUserId: actor.actorUserId };
      if (!await tx.create(RECEIPTS, { _id: receiptId, organizationId: actor.organizationId,
        schemaVersion: 1, version: 1, deletedAt: null, studentId: input.studentId,
        actorUserId: actor.actorUserId, action: 'restoreDraft', operationId: input.operationId,
        requestId: actor.requestId, fingerprint, reason, occurredAt: now,
        result: result as unknown as Record<string, string | number> })) {
        throw new StudentWorkAdminError('CONFLICT');
      }
      const auditId = `audit_${hashHex(JSON.stringify([actor.organizationId, actor.actorUserId, input.operationId]))}`;
      if (!await tx.append(AUDIT, { _id: auditId, organizationId: actor.organizationId,
        schemaVersion: 1, version: 1, deletedAt: null, id: auditId,
        requestId: actor.requestId, actorUserId: actor.actorUserId, actorRole: 'admin',
        action: 'student_work.restoreDraft', targetType: 'student_work', targetId: input.workId,
        result: 'succeeded', errorCode: null, occurredAt: now,
        metadata: { reasonProvided: true, affectedCount: 1 } })) {
        throw new StudentWorkAdminError('CONFLICT');
      }
      return result;
    });
  }

  private authorize(actor: TrustedActorContext): void {
    if (actor.actorRole !== 'admin' || !actor.permissions.includes('student_work.restore')
      || !actor.scopeIds.includes(actor.organizationId)) throw new StudentWorkAdminError('FORBIDDEN');
  }
}
