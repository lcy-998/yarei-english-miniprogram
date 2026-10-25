import { describe, expect, it } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import { authorizeNativeAdmin } from '../../src/native-admin/authorization';
import { DocumentNativeAdminGrantRepository, NATIVE_ADMIN_COLLECTIONS,
  nativeAdminGrantId } from '../../src/native-admin/document-grant-repository';
import { NativeAdminGrantService } from '../../src/native-admin/grant-service';

const organizationId = 'org_demo';
const teacherId = 'teacher_demo';
const actor: TrustedActorContext = { requestId: 'req_admin', sessionId: 'ses_admin',
  actorUserId: 'admin_demo', actorRole: 'admin', organizationId,
  platformSubjectDigest: 'digest_admin', permissions: ['authorization.manage',
    'organization.read', 'media.review'], scopeIds: [organizationId], authzVersion: 1 };

describe('native management per-account grant writes', () => {
  it('atomically grants, bumps authorization version, audits and revokes', async () => {
    const database = new FakeDocumentDatabase({
      [NATIVE_ADMIN_COLLECTIONS.users]: [{ _id: teacherId, organizationId, schemaVersion: 1,
        version: 1, authorizationVersion: 1, deletedAt: null, status: 'active' }],
      [NATIVE_ADMIN_COLLECTIONS.roles]: [{ _id: 'role_teacher_demo', organizationId, schemaVersion: 1,
        version: 1, deletedAt: null, userId: teacherId, role: 'teacher', status: 'active' }],
      [NATIVE_ADMIN_COLLECTIONS.classes]: [{ _id: 'class_demo', organizationId, schemaVersion: 1,
        version: 1, deletedAt: null, status: 'active' }],
    });
    const repository = new DocumentNativeAdminGrantRepository(database);
    let auditSequence = 0;
    const service = new NativeAdminGrantService(repository,
      { nowIso: () => '2026-10-02T08:00:00+08:00' }, { next: () => `native_audit_demo_${++auditSequence}` });
    const granted = await service.setGrant(actor, teacherId, { status: 'active',
      permissions: ['dashboard.read', 'media.review'],
      scope: { organizationWide: false, classIds: ['class_demo'] } },
    0, 1, '指定教师获得媒体审核', 'operation_native_grant_demo');
    expect(granted).toMatchObject({ status: 'active', version: 1,
      permissions: ['dashboard.read', 'media.review'] });
    expect(await service.setGrant(actor, teacherId, { status: 'active',
      permissions: ['dashboard.read', 'media.review'],
      scope: { organizationWide: false, classIds: ['class_demo'] } },
    0, 1, '指定教师获得媒体审核', 'operation_native_grant_demo')).toEqual(granted);
    const teacherSession: TrustedActorContext = { ...actor, actorRole: 'teacher', actorUserId: teacherId,
      sessionId: 'ses_teacher', authzVersion: 1 };
    expect(await authorizeNativeAdmin(repository, teacherSession, 'media.review', 'class_demo'))
      .toEqual({ allowed: false, reason: 'FORBIDDEN' });
    expect(await authorizeNativeAdmin(repository, { ...teacherSession, authzVersion: 2 },
      'media.review', 'class_demo')).toMatchObject({ allowed: true });
    const revoked = await service.setGrant(actor, teacherId, { status: 'revoked', permissions: [],
      scope: { organizationWide: false, classIds: [] } },
    1, 2, '移除媒体审核权限', 'operation_native_revoke_demo');
    expect(revoked).toMatchObject({ status: 'revoked', version: 2, permissions: [] });
    expect(await authorizeNativeAdmin(repository, { ...teacherSession, authzVersion: 2 },
      'media.review', 'class_demo')).toEqual({ allowed: false, reason: 'FORBIDDEN' });
    expect(database.snapshot()[NATIVE_ADMIN_COLLECTIONS.audit]?.map(row => row.action))
      .toEqual(['native_admin.granted', 'native_admin.revoked']);
    expect(database.snapshot()[NATIVE_ADMIN_COLLECTIONS.users]?.[0])
      .toMatchObject({ authorizationVersion: 3, version: 3 });
  });

  it('rejects self grant and scope escalation before writing', async () => {
    const database = new FakeDocumentDatabase();
    const service = new NativeAdminGrantService(new DocumentNativeAdminGrantRepository(database),
      { nowIso: () => '2026-10-02T08:00:00+08:00' }, { next: () => 'audit_demo' });
    await expect(service.setGrant({ ...actor, actorUserId: teacherId }, teacherId,
      { status: 'active', permissions: ['dashboard.read', 'media.review'],
        scope: { organizationWide: false, classIds: ['class_demo'] } },
      0, 1, '自我授权', 'operation_self_grant'))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.setGrant({ ...actor, scopeIds: ['class_other'] }, teacherId,
      { status: 'active', permissions: ['dashboard.read', 'media.review'],
        scope: { organizationWide: false, classIds: ['class_demo'] } },
      0, 1, '越权授权', 'operation_scope_grant'))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('lets a separately authorized teacher delegate only within the live grant', async () => {
    const managerId = 'teacher_manager';
    const targetId = 'teacher_target';
    const database = new FakeDocumentDatabase({
      [NATIVE_ADMIN_COLLECTIONS.users]: [
        { _id: managerId, organizationId, schemaVersion: 1, version: 2,
          authorizationVersion: 2, deletedAt: null, status: 'active' },
        { _id: targetId, organizationId, schemaVersion: 1, version: 1,
          authorizationVersion: 1, deletedAt: null, status: 'active' },
      ],
      [NATIVE_ADMIN_COLLECTIONS.roles]: [{ _id: 'role_target', organizationId, schemaVersion: 1,
        version: 1, deletedAt: null, userId: targetId, role: 'teacher', status: 'active' }],
      [NATIVE_ADMIN_COLLECTIONS.classes]: [
        { _id: 'class_one', organizationId, schemaVersion: 1, version: 1, deletedAt: null, status: 'active' },
        { _id: 'class_other', organizationId, schemaVersion: 1, version: 1, deletedAt: null, status: 'active' },
      ],
      [NATIVE_ADMIN_COLLECTIONS.grants]: [{ _id: nativeAdminGrantId(organizationId, managerId),
        organizationId, schemaVersion: 1, version: 1, deletedAt: null, teacherId: managerId,
        status: 'active', permissions: ['authorization.manage', 'dashboard.read', 'media.review'],
        scope: { organizationWide: false, classIds: ['class_one'] } }],
    });
    const repository = new DocumentNativeAdminGrantRepository(database);
    const service = new NativeAdminGrantService(repository,
      { nowIso: () => '2026-10-03T08:00:00+08:00' }, { next: () => 'audit_teacher_delegate' }, repository);
    const manager: TrustedActorContext = { ...actor, actorUserId: managerId,
      actorRole: 'teacher', sessionId: 'ses_manager', authzVersion: 2,
      permissions: ['task.read'], scopeIds: ['class_other'] };
    const request = { status: 'active' as const, permissions: ['dashboard.read', 'media.review'] as const,
      scope: { organizationWide: false, classIds: ['class_one'] } };
    expect(await service.setGrant(manager, targetId, request, 0, 1,
      '指定虚构教师审核本班媒体', 'operation_teacher_grant')).toMatchObject({ version: 1 });
    await expect(service.setGrant(manager, managerId, request, 0, 2,
      '自我授权', 'operation_teacher_self')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.setGrant(manager, targetId, { ...request,
      scope: { organizationWide: false, classIds: ['class_other'] } }, 1, 2,
    '越班授权', 'operation_teacher_cross')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.setGrant({ ...manager, authzVersion: 1 }, targetId, request, 1, 2,
      '旧会话授权', 'operation_teacher_old')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
