import { createHash } from 'node:crypto';
import type { TrustedActorContext } from '../auth/trusted-actor';
import type { OperationLogRecord } from '../runtime/records';
import { authorizeNativeAdmin, NATIVE_ADMIN_PERMISSIONS,
  type NativeAdminGrant, type NativeAdminGrantReader, type NativeAdminPermission } from './authorization';

export interface NativeAdminGrantUser {
  readonly id: string;
  readonly organizationId: string;
  readonly status: 'active' | 'disabled';
  readonly authorizationVersion: number;
  readonly version: number;
}

export interface NativeAdminGrantTransaction {
  findUser(organizationId: string, userId: string): Promise<NativeAdminGrantUser | null>;
  hasActiveTeacherRole(organizationId: string, userId: string): Promise<boolean>;
  classIsActive(organizationId: string, classId: string): Promise<boolean>;
  findGrant(organizationId: string, teacherId: string): Promise<NativeAdminGrant | null>;
  saveGrant(grant: NativeAdminGrant, expectedVersion: number): Promise<boolean>;
  bumpUserAuthorization(user: NativeAdminGrantUser): Promise<boolean>;
  findReceipt(organizationId: string, actorId: string, operationId: string): Promise<Readonly<{
    fingerprint: string; result: NativeAdminGrant;
  }> | null>;
  saveReceipt(organizationId: string, actorId: string, operationId: string, fingerprint: string,
    result: NativeAdminGrant): Promise<boolean>;
  appendAudit(entry: OperationLogRecord): Promise<void>;
}

export interface NativeAdminGrantUnitOfWork {
  transaction<T>(work: (transaction: NativeAdminGrantTransaction) => Promise<T>): Promise<T>;
}

export class NativeAdminGrantError extends Error {
  public constructor(public readonly code: 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION_ERROR') {
    super(code);
  }
}

export class NativeAdminGrantService {
  public constructor(private readonly repository: NativeAdminGrantUnitOfWork,
    private readonly clock: Readonly<{ nowIso(): string }>,
    private readonly ids: Readonly<{ next(prefix: string): string }>,
    private readonly actorGrants?: NativeAdminGrantReader) {}

  public async setGrant(actor: TrustedActorContext, teacherId: string,
    requested: Readonly<{ status: 'active' | 'revoked'; permissions: readonly NativeAdminPermission[];
      scope: NativeAdminGrant['scope'] }>, expectedGrantVersion: number,
    expectedUserVersion: number, reason: string, operationId: string): Promise<NativeAdminGrant> {
    if (teacherId === actor.actorUserId) throw new NativeAdminGrantError('FORBIDDEN');
    const adminActor = actor.actorRole === 'admin' && actor.permissions.includes('authorization.manage');
    let teacherGrant: NativeAdminGrant | null = null;
    if (!adminActor) {
      if (actor.actorRole !== 'teacher' || !this.actorGrants) throw new NativeAdminGrantError('FORBIDDEN');
      const decision = await authorizeNativeAdmin(this.actorGrants, actor, 'authorization.manage');
      if (!decision.allowed) throw new NativeAdminGrantError('FORBIDDEN');
      teacherGrant = await this.actorGrants.findGrant(actor.organizationId, actor.actorUserId);
      if (!teacherGrant || teacherGrant.status !== 'active' || teacherGrant.version !== decision.grantVersion) {
        throw new NativeAdminGrantError('FORBIDDEN');
      }
    }
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(teacherId)
      || !/^[A-Za-z0-9_-]{8,128}$/.test(operationId)
      || !Number.isSafeInteger(expectedGrantVersion) || expectedGrantVersion < 0
      || !Number.isSafeInteger(expectedUserVersion) || expectedUserVersion < 1
      || !reason.trim() || reason.length > 200
      || (requested.status !== 'active' && requested.status !== 'revoked')
      || !Array.isArray(requested.permissions)
      || requested.permissions.some(permission => !NATIVE_ADMIN_PERMISSIONS.includes(permission)
        || permission === 'textbook.manage' || permission === 'task.manage'
        || permission === 'student_work.restore')
      || new Set(requested.permissions).size !== requested.permissions.length
      || typeof requested.scope.organizationWide !== 'boolean'
      || !Array.isArray(requested.scope.classIds)
      || requested.scope.classIds.some(classId => typeof classId !== 'string'
        || !/^[A-Za-z0-9_-]{1,128}$/.test(classId))
      || new Set(requested.scope.classIds).size !== requested.scope.classIds.length) {
      throw new NativeAdminGrantError('VALIDATION_ERROR');
    }
    const active = requested.status === 'active';
    if (active && (!requested.permissions.includes('dashboard.read')
      || (!requested.scope.organizationWide && requested.scope.classIds.length === 0))) {
      throw new NativeAdminGrantError('VALIDATION_ERROR');
    }
    const permissions = active ? [...requested.permissions] : [];
    const scope = active ? { organizationWide: requested.scope.organizationWide,
      classIds: [...requested.scope.classIds] } : { organizationWide: false, classIds: [] };
    for (const permission of permissions) {
      const required = permission === 'dashboard.read' ? 'organization.read' : permission;
      if (adminActor ? !actor.permissions.includes(required)
        : !teacherGrant?.permissions.includes(permission)) throw new NativeAdminGrantError('FORBIDDEN');
    }
    const authority = adminActor
      ? { organizationWide: actor.scopeIds.includes(actor.organizationId), classIds: actor.scopeIds }
      : teacherGrant!.scope;
    if (scope.organizationWide && !authority.organizationWide) {
      throw new NativeAdminGrantError('FORBIDDEN');
    }
    if (!authority.organizationWide
      && scope.classIds.some(classId => !authority.classIds.includes(classId))) {
      throw new NativeAdminGrantError('FORBIDDEN');
    }
    const fingerprint = createHash('sha256').update(JSON.stringify({ teacherId, status: requested.status,
      permissions, scope, expectedGrantVersion, expectedUserVersion, reason: reason.trim() })).digest('hex');
    return this.repository.transaction(async transaction => {
      const user = await transaction.findUser(actor.organizationId, teacherId);
      const current = await transaction.findGrant(actor.organizationId, teacherId);
      const teacherRole = await transaction.hasActiveTeacherRole(actor.organizationId, teacherId);
      const currentActor = adminActor ? null
        : await transaction.findUser(actor.organizationId, actor.actorUserId);
      const currentActorGrant = adminActor ? null
        : await transaction.findGrant(actor.organizationId, actor.actorUserId);
      if (!user || user.status !== 'active' || !teacherRole) throw new NativeAdminGrantError('NOT_FOUND');
      if (!adminActor && (!currentActor || currentActor.status !== 'active'
        || currentActor.authorizationVersion !== actor.authzVersion
        || !currentActorGrant || currentActorGrant.status !== 'active'
        || currentActorGrant.version !== teacherGrant!.version
        || !currentActorGrant.permissions.includes('authorization.manage'))) {
        throw new NativeAdminGrantError('FORBIDDEN');
      }
      const liveAuthority = adminActor ? authority : currentActorGrant!.scope;
      if (current && !liveAuthority.organizationWide
        && (current.scope.organizationWide
          || current.scope.classIds.some(classId => !liveAuthority.classIds.includes(classId)))) {
        throw new NativeAdminGrantError('FORBIDDEN');
      }
      if (!adminActor && current?.permissions.some(permission =>
        !currentActorGrant!.permissions.includes(permission))) throw new NativeAdminGrantError('FORBIDDEN');
      if (!adminActor && permissions.some(permission =>
        !currentActorGrant!.permissions.includes(permission))) throw new NativeAdminGrantError('FORBIDDEN');
      if (scope.organizationWide && !liveAuthority.organizationWide
        || !liveAuthority.organizationWide && scope.classIds.some(classId =>
          !liveAuthority.classIds.includes(classId))) throw new NativeAdminGrantError('FORBIDDEN');
      for (const classId of scope.classIds) {
        if (!await transaction.classIsActive(actor.organizationId, classId)) {
          throw new NativeAdminGrantError('NOT_FOUND');
        }
      }
      const prior = await transaction.findReceipt(actor.organizationId, actor.actorUserId, operationId);
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new NativeAdminGrantError('CONFLICT');
        return prior.result;
      }
      if (user.version !== expectedUserVersion || (current?.version ?? 0) !== expectedGrantVersion) {
        throw new NativeAdminGrantError('CONFLICT');
      }
      const next: NativeAdminGrant = { organizationId: actor.organizationId, teacherId,
        status: requested.status, permissions, scope, version: expectedGrantVersion + 1 };
      if (!await transaction.saveGrant(next, expectedGrantVersion)
        || !await transaction.bumpUserAuthorization(user)
        || !await transaction.saveReceipt(actor.organizationId, actor.actorUserId, operationId,
          fingerprint, next)) throw new NativeAdminGrantError('CONFLICT');
      await transaction.appendAudit({ id: this.ids.next('native_admin_audit'), organizationId: actor.organizationId,
        requestId: actor.requestId, actorUserId: actor.actorUserId, actorRole: actor.actorRole,
        action: requested.status === 'revoked' ? 'native_admin.revoked' : 'native_admin.granted',
        targetType: 'native_admin_grant', targetId: teacherId, result: 'succeeded',
        errorCode: null, occurredAt: this.clock.nowIso(), metadata: { operationId,
          previousGrantVersion: expectedGrantVersion, nextGrantVersion: next.version,
          nextAuthorizationVersion: user.authorizationVersion + 1, reason: reason.trim() } });
      return next;
    });
  }
}
