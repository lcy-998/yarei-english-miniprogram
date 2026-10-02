import type { DocumentDatabasePort, VersionedDocument } from '../repositories/document-database-port';

const ORGANIZATION_ID = 'org_qihang_demo';
const ADMIN_USER_ID = 'usr_admin_demo_01';
const ADMIN_ROLE_ID = 'rol_admin_demo_01';
const REQUEST_ID = 'm2_demo_admin_restore_grant_20260927';
const AUDIT_ID = `audit:${ORGANIZATION_ID}:${REQUEST_ID}`;
const RESTORE_PERMISSION = 'student_work.restore';

/** One exact nonproduction bootstrap grant; ordinary admin self-grant remains forbidden. */
export async function grantM2DemoAdminRestorePermission(
  database: DocumentDatabasePort,
  occurredAt: string,
): Promise<'granted' | 'already_granted'> {
  if (!Number.isFinite(Date.parse(occurredAt)) || !occurredAt.endsWith('Z')) {
    throw new Error('Invalid grant time.');
  }
  return database.runTransaction(async tx => {
    const role = await tx.get('role_assignments', ADMIN_ROLE_ID);
    const user = await tx.get('users', ADMIN_USER_ID);
    const audit = await tx.get('operation_logs', AUDIT_ID);
    if (role === null || user === null || role.organizationId !== ORGANIZATION_ID
      || user.organizationId !== ORGANIZATION_ID || role.userId !== ADMIN_USER_ID
      || role.role !== 'admin' || role.status !== 'active' || user.status !== 'active'
      || role.scopeType !== 'organization' || !Array.isArray(role.scopeIds)
      || !role.scopeIds.includes(ORGANIZATION_ID) || !Array.isArray(role.permissions)
      || !role.permissions.includes('authorization.manage') || role.deletedAt !== null
      || user.deletedAt !== null) throw new Error('Demo administrator precondition failed.');
    if (role.permissions.includes(RESTORE_PERMISSION)) {
      if (audit === null || audit.action !== 'role.assigned' || audit.targetId !== ADMIN_ROLE_ID
        || audit.metadata === null || typeof audit.metadata !== 'object'
        || (audit.metadata as Record<string, unknown>).permission !== RESTORE_PERMISSION) {
        throw new Error('Demo administrator grant exists without its audit.');
      }
      return 'already_granted';
    }
    if (role.version !== 1 || user.version !== 1 || user.authorizationVersion !== 1
      || audit !== null || typeof user.displayName !== 'string'
      || typeof user.displayNameMasked !== 'string') {
      throw new Error('Demo administrator version or audit precondition failed.');
    }
    const updatedRole: VersionedDocument = {
      _id: ADMIN_ROLE_ID, organizationId: ORGANIZATION_ID, schemaVersion: 1, version: 2,
      deletedAt: null, userId: ADMIN_USER_ID, role: 'admin', status: 'active',
      permissions: [...role.permissions, RESTORE_PERMISSION], scopeType: 'organization',
      scopeIds: [...role.scopeIds], grantedBy: 'system_m2_nonproduction', grantedAt: occurredAt,
    };
    const updatedUser: VersionedDocument = {
      _id: ADMIN_USER_ID, organizationId: ORGANIZATION_ID, schemaVersion: 1, version: 2,
      deletedAt: null, authorizationVersion: 2, displayName: user.displayName,
      displayNameMasked: user.displayNameMasked, status: 'active',
    };
    const auditRow: VersionedDocument = {
      _id: AUDIT_ID, id: AUDIT_ID, organizationId: ORGANIZATION_ID,
      schemaVersion: 1, version: 1, deletedAt: null, requestId: REQUEST_ID,
      actorUserId: null, actorRole: null, action: 'role.assigned', targetType: 'role_assignment',
      targetId: ADMIN_ROLE_ID, result: 'succeeded', errorCode: null,
      metadata: { source: 'authorized_m2_nonproduction_deployment',
        permission: RESTORE_PERMISSION, reason: 'A-03 七天已删草稿恢复联调' }, occurredAt,
    };
    if (!await tx.replace('role_assignments', ADMIN_ROLE_ID, 1, updatedRole)
      || !await tx.replace('users', ADMIN_USER_ID, 1, updatedUser)
      || !await tx.create('operation_logs', auditRow)) {
      throw new Error('Demo administrator grant transaction failed.');
    }
    return 'granted';
  });
}
