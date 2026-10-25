import type { TrustedActorContext } from '../auth/trusted-actor';
import type { DocumentDatabasePort, VersionedDocument } from '../repositories/document-database-port';
import { authorizeNativeAdmin, NATIVE_ADMIN_PERMISSIONS,
  type NativeAdminGrant, type NativeAdminGrantReader, type NativeAdminPermission } from './authorization';

export interface NativeAdminGrantCandidatePage {
  readonly items: readonly Readonly<{
    teacherId: string;
    displayName: string;
    userVersion: number;
    authorizationVersion: number;
    grantVersion: number;
    grantStatus: 'none' | 'active' | 'revoked';
    permissions: readonly NativeAdminPermission[];
    scope: NativeAdminGrant['scope'];
  }>[];
  readonly nextOffset: number | null;
}

export class NativeAdminGrantCandidateError extends Error {
  public constructor(public readonly code: 'FORBIDDEN' | 'VALIDATION_ERROR' | 'SERVICE_UNAVAILABLE') {
    super(code);
  }
}

function isVisible(row: VersionedDocument, organizationId: string): boolean {
  return row.organizationId === organizationId && row.deletedAt === null;
}

function grantScope(row: VersionedDocument): NativeAdminGrant['scope'] | null {
  if (typeof row.scope !== 'object' || row.scope === null || Array.isArray(row.scope)) return null;
  const scope = row.scope as Record<string, unknown>;
  if (typeof scope.organizationWide !== 'boolean' || !Array.isArray(scope.classIds)
    || !scope.classIds.every(id => typeof id === 'string')) return null;
  return { organizationWide: scope.organizationWide, classIds: [...scope.classIds] as string[] };
}

/** Returns only teachers the actor may grant within the actor's current management scope. */
export class NativeAdminGrantCandidateService {
  public constructor(private readonly grants: NativeAdminGrantReader,
    private readonly database: DocumentDatabasePort) {}

  public async list(actor: TrustedActorContext, limit: number, offset: number,
    query = ''): Promise<NativeAdminGrantCandidatePage> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50
      || !Number.isSafeInteger(offset) || offset < 0 || offset > 10000
      || typeof query !== 'string' || query.length > 100) {
      throw new NativeAdminGrantCandidateError('VALIDATION_ERROR');
    }
    const decision = await authorizeNativeAdmin(this.grants, actor, 'authorization.manage');
    if (!decision.allowed) throw new NativeAdminGrantCandidateError('FORBIDDEN');
    const actorGrant = await this.grants.findGrant(actor.organizationId, actor.actorUserId);
    if (!actorGrant || actorGrant.status !== 'active' || actorGrant.version !== decision.grantVersion) {
      throw new NativeAdminGrantCandidateError('FORBIDDEN');
    }
    const [users, roles, assignments, existingGrants] = await Promise.all([
      this.database.find('users', { organizationId: actor.organizationId, deletedAt: null, status: 'active' }),
      this.database.find('role_assignments', { organizationId: actor.organizationId,
        deletedAt: null, role: 'teacher', status: 'active' }),
      decision.scope.organizationWide ? Promise.resolve([] as readonly VersionedDocument[])
        : this.database.find('teacher_class_grants', { organizationId: actor.organizationId,
          deletedAt: null, status: 'active' }),
      this.database.find('native_admin_grants', { organizationId: actor.organizationId, deletedAt: null }),
    ]);
    if ([users, roles, assignments, existingGrants].some(rows => rows.length > 10000)) {
      throw new NativeAdminGrantCandidateError('SERVICE_UNAVAILABLE');
    }
    const roleCounts = new Map<string, number>();
    for (const row of roles) {
      if (!isVisible(row, actor.organizationId) || typeof row.userId !== 'string') continue;
      roleCounts.set(row.userId, (roleCounts.get(row.userId) ?? 0) + 1);
    }
    const scopedTeacherIds = new Set(assignments.filter(row => isVisible(row, actor.organizationId)
      && typeof row.teacherId === 'string' && typeof row.classId === 'string'
      && decision.scope.classIds.includes(row.classId)).map(row => String(row.teacherId)));
    const grantByTeacher = new Map(existingGrants.filter(row => isVisible(row, actor.organizationId)
      && typeof row.teacherId === 'string').map(row => [String(row.teacherId), row] as const));
    const needle = query.trim().toLocaleLowerCase();
    const candidates = users.filter(row => isVisible(row, actor.organizationId)
      && row.status === 'active' && row._id !== actor.actorUserId
      && Number.isSafeInteger(row.version) && row.version >= 1
      && Number.isSafeInteger(row.authorizationVersion) && Number(row.authorizationVersion) >= 1
      && roleCounts.get(row._id) === 1
      && (decision.scope.organizationWide || scopedTeacherIds.has(row._id))
      && (!needle || [row._id, row.displayNameMasked].some(value =>
        typeof value === 'string' && value.toLocaleLowerCase().includes(needle))))
      .filter(row => {
        const existing = grantByTeacher.get(row._id);
        if (!existing) return true;
        if (existing.status !== 'active' && existing.status !== 'revoked'
          || !Number.isSafeInteger(existing.version) || existing.version < 1
          || !Array.isArray(existing.permissions)
          || existing.permissions.some(permission => typeof permission !== 'string'
            || !NATIVE_ADMIN_PERMISSIONS.includes(permission as NativeAdminPermission)
            || !actorGrant.permissions.includes(permission as NativeAdminPermission))) return false;
        const scope = grantScope(existing);
        return scope !== null && (decision.scope.organizationWide
          || !scope.organizationWide && scope.classIds.every(id => decision.scope.classIds.includes(id)));
      })
      .sort((left, right) => left._id.localeCompare(right._id));
    const items = candidates.slice(offset, offset + limit).map(row => {
      const existing = grantByTeacher.get(row._id);
      const scope = existing ? grantScope(existing)! : { organizationWide: false, classIds: [] };
      const permissions = existing && Array.isArray(existing.permissions)
        ? existing.permissions.filter((value): value is NativeAdminPermission =>
          typeof value === 'string' && NATIVE_ADMIN_PERMISSIONS.includes(value as NativeAdminPermission))
        : [];
      return { teacherId: row._id,
        displayName: typeof row.displayNameMasked === 'string' && row.displayNameMasked.trim()
          ? row.displayNameMasked : row._id,
        userVersion: row.version, authorizationVersion: Number(row.authorizationVersion),
        grantVersion: existing?.version ?? 0,
        grantStatus: existing ? existing.status as 'active' | 'revoked' : 'none' as const,
        permissions, scope };
    });
    return { items, nextOffset: offset + limit < candidates.length ? offset + limit : null };
  }
}
