import { describe, expect, it } from 'vitest';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import type { VersionedDocument } from '../../src/repositories/document-database-port';
import { grantM2DemoAdminRestorePermission } from '../../src/seed/m2-demo-admin-grant';

const org = 'org_qihang_demo';
const role: VersionedDocument = { _id: 'rol_admin_demo_01', organizationId: org,
  schemaVersion: 1, version: 1, deletedAt: null, userId: 'usr_admin_demo_01', role: 'admin',
  status: 'active', permissions: ['organization.read', 'authorization.manage'],
  scopeType: 'organization', scopeIds: [org], grantedBy: 'system_seed', grantedAt: '2026-09-01T00:00:00Z' };
const user: VersionedDocument = { _id: 'usr_admin_demo_01', organizationId: org,
  schemaVersion: 1, version: 1, deletedAt: null, authorizationVersion: 1,
  displayName: '虚构管理员', displayNameMasked: '虚构*', status: 'active' };

describe('M2 fictitious admin restore grant', () => {
  it('updates exact permission and authorization version with one system audit, then is idempotent', async () => {
    const database = new FakeDocumentDatabase({ role_assignments: [role], users: [user] });
    expect(await grantM2DemoAdminRestorePermission(database, '2026-09-27T11:00:00Z'))
      .toBe('granted');
    const updated = await database.get('role_assignments', role._id);
    const updatedUser = await database.get('users', user._id);
    const audits = database.snapshot().operation_logs;
    expect(updated).toMatchObject({ version: 2,
      permissions: ['organization.read', 'authorization.manage', 'student_work.restore'] });
    expect(updatedUser).toMatchObject({ version: 2, authorizationVersion: 2 });
    expect(audits).toHaveLength(1);
    expect(audits?.[0]).toMatchObject({ actorUserId: null, actorRole: null,
      action: 'role.assigned', targetId: role._id,
      metadata: { source: 'authorized_m2_nonproduction_deployment', permission: 'student_work.restore' } });
    expect(await grantM2DemoAdminRestorePermission(database, '2026-09-27T12:00:00Z'))
      .toBe('already_granted');
    expect(database.snapshot().operation_logs).toHaveLength(1);
  });

  it('rejects changed or unscoped target records without partial writes', async () => {
    const database = new FakeDocumentDatabase({ role_assignments: [{ ...role, version: 2 }], users: [user] });
    await expect(grantM2DemoAdminRestorePermission(database, '2026-09-27T11:00:00Z'))
      .rejects.toThrow('version');
    expect(database.snapshot().operation_logs ?? []).toHaveLength(0);
    expect(await database.get('users', user._id)).toEqual(user);
    const unscoped = new FakeDocumentDatabase({ role_assignments: [{ ...role, scopeIds: ['other_org'] }],
      users: [user] });
    await expect(grantM2DemoAdminRestorePermission(unscoped, '2026-09-27T11:00:00Z'))
      .rejects.toThrow('precondition');
  });
});
