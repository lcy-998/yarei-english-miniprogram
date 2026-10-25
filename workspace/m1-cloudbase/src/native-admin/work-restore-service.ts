import type { TrustedActorContext } from '../auth/trusted-actor';
import type { DocumentDatabasePort, DocumentDatabaseTransactionPort,
  VersionedDocument } from '../repositories/document-database-port';
import { hashHex } from '../shared/request-summary';
import { projectStudentWork } from '../student-work/document-repository';
import { authorizeNativeAdmin, type NativeAdminGrantReader,
  type NativeAdminGrant } from './authorization';
import { nativeAdminGrantId } from './document-grant-repository';

const RECOVERY_MS = 7 * 24 * 60 * 60 * 1000;
export type NativeRestoreBlock = 'expired' | 'cleanup_locked' | 'staging_deleted' | 'invalid_record';
export interface NativeDeletedWorkPage {
  items: Array<{ id: string; studentId: string; materialTitle: string | null;
    deletedAt: string; recoverableUntil: string; restorable: boolean;
    blockedReason: NativeRestoreBlock | null; version: number }>;
  nextOffset: number | null;
}
export interface NativeRestoredWork {
  id: string; studentId: string; materialId: string; version: number;
  restoredAt: string; restoredByUserId: string;
}
export class NativeWorkRestoreError extends Error {
  public constructor(public readonly code: 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION_ERROR'
    | 'SERVICE_UNAVAILABLE') { super(code); }
}

export class NativeAdminWorkRestoreService {
  public constructor(private readonly database: DocumentDatabasePort,
    private readonly grants: NativeAdminGrantReader,
    private readonly clock: Readonly<{ nowIso(): string }>) {}

  public async listDeleted(actor: TrustedActorContext, studentId: string, limit: number,
    offset: number): Promise<NativeDeletedWorkPage> {
    validId(studentId);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50
      || !Number.isSafeInteger(offset) || offset < 0 || offset > 10000) {
      throw new NativeWorkRestoreError('VALIDATION_ERROR');
    }
    const scope = await this.authorize(actor);
    await this.requireStudentScope(this.database, actor, studentId, scope);
    const now = Date.parse(this.clock.nowIso());
    if (!Number.isFinite(now)) throw new NativeWorkRestoreError('SERVICE_UNAVAILABLE');
    const page = await this.database.findPage('student_works', { organizationId: actor.organizationId,
      studentId, status: 'draft', recoveryState: 'deleted' }, { limit, offset });
    const items = await Promise.all(page.items.map(async row => {
      if (row.organizationId !== actor.organizationId || row.studentId !== studentId) {
        throw new NativeWorkRestoreError('SERVICE_UNAVAILABLE');
      }
      const material = typeof row.materialId === 'string'
        ? await this.database.get('learning_resources', row.materialId) : null;
      const block = restoreBlock(row, now);
      return { id: row._id, studentId, materialTitle: material?.organizationId === actor.organizationId
        && typeof material.title === 'string' ? material.title : null,
      deletedAt: typeof row.deletedAt === 'string' ? row.deletedAt : '',
      recoverableUntil: typeof row.recoverableUntil === 'string' ? row.recoverableUntil : '',
      restorable: block === null, blockedReason: block, version: row.version };
    }));
    // A revocation during the read must not release the already projected rows.
    await this.authorize(actor);
    return { items, nextOffset: page.hasMore ? offset + limit : null };
  }

  public async restore(actor: TrustedActorContext, input: Readonly<{ studentId: string; workId: string;
    reason: string }>, expectedVersion: number, operationId: string): Promise<NativeRestoredWork> {
    validId(input.studentId);
    validId(input.workId);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1
      || !/^[A-Za-z0-9_-]{8,128}$/.test(operationId)
      || !input.reason.trim() || input.reason.length > 200) throw new NativeWorkRestoreError('VALIDATION_ERROR');
    await this.authorize(actor);
    const nowIso = this.clock.nowIso();
    const now = Date.parse(nowIso);
    if (!Number.isFinite(now)) throw new NativeWorkRestoreError('SERVICE_UNAVAILABLE');
    const fingerprint = hashHex(JSON.stringify([input.studentId, input.workId,
      input.reason.trim(), expectedVersion]));
    return this.database.runTransaction(async tx => {
      const scope = await this.liveGuard(tx, actor);
      await this.requireStudentScope(tx, actor, input.studentId, scope);
      const receiptId = `native_work_restore_${hashHex(JSON.stringify([
        actor.organizationId, actor.actorUserId, operationId]))}`;
      const prior = await tx.get('student_work_operations', receiptId);
      if (prior) {
        if (prior.organizationId !== actor.organizationId || prior.actorUserId !== actor.actorUserId
          || prior.fingerprint !== fingerprint || typeof prior.result !== 'object'
          || prior.result === null || Array.isArray(prior.result)) throw new NativeWorkRestoreError('CONFLICT');
        return prior.result as unknown as NativeRestoredWork;
      }
      const work = await tx.get('student_works', input.workId);
      if (!work || work.organizationId !== actor.organizationId || work.studentId !== input.studentId) {
        throw new NativeWorkRestoreError('NOT_FOUND');
      }
      if (work.version !== expectedVersion || work.status !== 'draft'
        || work.recoveryState !== 'deleted' || work.deletedAt === null) {
        throw new NativeWorkRestoreError('CONFLICT');
      }
      if (restoreBlock(work, now) !== null) throw new NativeWorkRestoreError('CONFLICT');
      const next: VersionedDocument = { ...work, version: work.version + 1,
        deletedAt: null, recoverableUntil: null, deletedByUserId: null,
        recoveryState: 'active', restoredAt: nowIso, restoredByUserId: actor.actorUserId };
      if (!await tx.replace('student_works', work._id, work.version, next)) {
        throw new NativeWorkRestoreError('CONFLICT');
      }
      const result: NativeRestoredWork = { id: work._id, studentId: input.studentId,
        materialId: String(work.materialId), version: next.version,
        restoredAt: nowIso, restoredByUserId: actor.actorUserId };
      if (!await tx.create('student_work_operations', { _id: receiptId,
        organizationId: actor.organizationId, schemaVersion: 1, version: 1, deletedAt: null,
        actorUserId: actor.actorUserId, action: 'nativeRestoreDraft', operationId,
        fingerprint, result: JSON.parse(JSON.stringify(result)) })) throw new NativeWorkRestoreError('CONFLICT');
      const auditId = `native_work_restore_audit_${hashHex(JSON.stringify([
        actor.organizationId, actor.actorUserId, operationId]))}`;
      if (!await tx.append('operation_logs', { _id: auditId,
        organizationId: actor.organizationId, schemaVersion: 1, version: 1, deletedAt: null,
        requestId: actor.requestId, actorUserId: actor.actorUserId, actorRole: 'teacher',
        action: 'student_work.restoreDraft', targetType: 'student_work', targetId: work._id,
        result: 'succeeded', errorCode: null, occurredAt: nowIso,
        metadata: { reasonProvided: true, affectedCount: 1, operationId } })) {
        throw new NativeWorkRestoreError('CONFLICT');
      }
      return result;
    });
  }

  private async authorize(actor: TrustedActorContext): Promise<NativeAdminGrant['scope']> {
    const [users, restore] = await Promise.all([
      authorizeNativeAdmin(this.grants, actor, 'user.manage'),
      authorizeNativeAdmin(this.grants, actor, 'student_work.restore'),
    ]);
    if (!users.allowed || !restore.allowed) throw new NativeWorkRestoreError('FORBIDDEN');
    if (users.grantVersion !== restore.grantVersion) throw new NativeWorkRestoreError('FORBIDDEN');
    return restore.scope;
  }

  private async requireStudentScope(reader: Pick<DocumentDatabasePort, 'find'>,
    actor: TrustedActorContext, studentId: string, scope: NativeAdminGrant['scope']): Promise<void> {
    if (scope.organizationWide) return;
    const memberships = await reader.find('class_memberships', { organizationId: actor.organizationId,
      studentId, status: 'active', deletedAt: null });
    if (!memberships.length || memberships.some(row => typeof row.classId !== 'string'
      || !scope.classIds.includes(row.classId))) throw new NativeWorkRestoreError('FORBIDDEN');
  }

  private async liveGuard(tx: DocumentDatabaseTransactionPort,
    actor: TrustedActorContext): Promise<NativeAdminGrant['scope']> {
    const user = await tx.get('users', actor.actorUserId);
    const grant = await tx.get('native_admin_grants', nativeAdminGrantId(actor.organizationId, actor.actorUserId));
    if (actor.actorRole !== 'teacher' || !user || user.organizationId !== actor.organizationId
      || user.deletedAt !== null || user.status !== 'active'
      || user.authorizationVersion !== actor.authzVersion
      || !grant || grant.organizationId !== actor.organizationId || grant.deletedAt !== null
      || grant.status !== 'active' || !Array.isArray(grant.permissions)
      || !grant.permissions.includes('user.manage')
      || !grant.permissions.includes('student_work.restore')) throw new NativeWorkRestoreError('FORBIDDEN');
    const scope = typeof grant.scope === 'object' && grant.scope !== null
      && !Array.isArray(grant.scope) ? grant.scope as Record<string, unknown> : null;
    if (!scope || typeof scope.organizationWide !== 'boolean' || !Array.isArray(scope.classIds)
      || scope.classIds.some(id => typeof id !== 'string')) throw new NativeWorkRestoreError('FORBIDDEN');
    return { organizationWide: scope.organizationWide,
      classIds: scope.classIds as string[] };
  }
}

function restoreBlock(document: VersionedDocument, nowMs: number): NativeRestoreBlock | null {
  const work = projectStudentWork({ ...document, version: document.version });
  const deleted = typeof document.deletedAt === 'string' ? Date.parse(document.deletedAt) : NaN;
  const until = typeof document.recoverableUntil === 'string' ? Date.parse(document.recoverableUntil) : NaN;
  if (!work || work.status !== 'draft' || work.recoveryState !== 'deleted'
    || work.id !== document._id || work.studentId !== document.studentId
    || work.deletedByUserId !== work.studentId || work.fileId !== null
    || work.contentSha256 !== null || work.submittedAt !== null
    || work.stagingPath !== `student-works/staging/${hashHex(JSON.stringify([
      work.organizationId, work.studentId]))}/${work.id}.mp3`
    || !Number.isFinite(deleted) || !Number.isFinite(until)
    || until !== deleted + RECOVERY_MS) return 'invalid_record';
  if (document.stagingMediaDeletedAt !== undefined && document.stagingMediaDeletedAt !== null) {
    return 'staging_deleted';
  }
  if (document.stagingCleanupStatus !== undefined && document.stagingCleanupStatus !== null
    && document.stagingCleanupStatus !== 'none') return 'cleanup_locked';
  return nowMs >= until ? 'expired' : null;
}
function validId(value: string): void {
  if (typeof value !== 'string' || !value.trim() || value.length > 128) {
    throw new NativeWorkRestoreError('VALIDATION_ERROR');
  }
}
