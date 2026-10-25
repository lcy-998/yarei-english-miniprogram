import { describe, expect, it } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import { NativeAdminManagementService } from '../../src/native-admin/management-service';
import { NativeAdminDataService } from '../../src/native-admin/data-service';
import { DocumentNativeAdminGrantRepository, nativeAdminGrantId } from '../../src/native-admin/document-grant-repository';
import { validateNativeAdminManagementRequest } from '../../functions/native-admin-management-command/function-entry';
import { validateNativeAdminQueryRequest } from '../../functions/native-admin-query/function-entry';

const actor: TrustedActorContext = { requestId: 'request_manager', sessionId: 'session_manager',
  actorUserId: 'teacher_manager', actorRole: 'teacher', organizationId: 'org_demo',
  platformSubjectDigest: 'digest_manager', permissions: [], scopeIds: [], authzVersion: 2 };

function fixture(organizationWide = true, existingCount = 0, studentLinkCount = 0) {
  const base = { organizationId: 'org_demo', schemaVersion: 1 as const, version: 1, deletedAt: null };
  const database = new FakeDocumentDatabase({
    organizations: [{ ...base, _id: 'org_demo', name: '启航实验学校', status: 'active' }],
    users: [
      { ...base, _id: 'teacher_manager', status: 'active', authorizationVersion: 2 },
      { ...base, _id: 'student_one', displayName: '虚构学员甲', status: 'active', authorizationVersion: 1,
        mobileMasked: '138****0001', lastLoginAt: '2026-10-06T10:00:00+08:00' },
      { ...base, _id: 'parent_one', displayName: '虚构家长甲', status: 'active', authorizationVersion: 1 },
    ],
    native_admin_grants: [{ ...base, _id: nativeAdminGrantId('org_demo', 'teacher_manager'),
      teacherId: 'teacher_manager', status: 'active', permissions: ['organization.manage', 'user.manage'],
      scope: { organizationWide, classIds: organizationWide ? [] : ['class_other'] } }],
    classes: [{ ...base, _id: 'class_one', name: '三年级 2 班', status: 'active' }],
    class_memberships: [{ ...base, _id: 'member_one', classId: 'class_one', studentId: 'student_one', status: 'active' }],
    role_assignments: [
      { ...base, _id: 'role_student', userId: 'student_one', role: 'student', status: 'active' },
      { ...base, _id: 'role_parent', userId: 'parent_one', role: 'parent', status: 'active' },
    ],
    parent_student_links: [
      ...Array.from({ length: existingCount }, (_, index) => ({ ...base,
        _id: `link_existing_${index}`, parentId: 'parent_one', studentId: `student_existing_${index}`, status: 'active' })),
      ...Array.from({ length: studentLinkCount }, (_, index) => ({ ...base,
        _id: `link_student_${index}`, parentId: `parent_existing_${index}`, studentId: 'student_one', status: 'active' })),
    ],
  });
  const grants = new DocumentNativeAdminGrantRepository(database);
  return { database, management: new NativeAdminManagementService(database, grants,
    { nowIso: () => '2026-10-06T12:00:00+08:00' }), data: new NativeAdminDataService(grants, database) };
}

describe('A-02 current school and A-03 parent binding completion', () => {
  it('reads and renames only the current school, once with audit and version protection', async () => {
    const { data, management, database } = fixture();
    expect(await data.getOrganization(actor)).toMatchObject({ id: 'org_demo', name: '启航实验学校' });
    const input = { name: '启航实验学校（虚构）', reason: '更新虚构学校名' };
    const first = await management.updateOrganization(actor, input, 1, 'operation_school_update');
    expect(first.version).toBe(2);
    expect(await management.updateOrganization(actor, input, 1, 'operation_school_update')).toEqual(first);
    await expect(management.updateOrganization(actor, input, 1, 'operation_school_stale')).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(database.snapshot().operation_logs).toHaveLength(1);
    await expect(fixture(false).management.updateOrganization(actor, input, 1, 'operation_school_denied')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('binds existing same-school roles once and serializes the limit on both user rows', async () => {
    const { management, database } = fixture();
    const input = { parentId: 'parent_one', studentId: 'student_one', reason: '确认虚构家长关系' };
    const first = await management.bindParentLink(actor, input, 0, 'operation_bind_parent');
    expect(await management.bindParentLink(actor, input, 0, 'operation_bind_parent')).toEqual(first);
    expect(database.snapshot().parent_student_links).toHaveLength(1);
    expect(database.snapshot().users?.find(row => row._id === 'parent_one')?.version).toBe(2);
    await expect(management.bindParentLink(actor, input, 0, 'operation_bind_duplicate')).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(fixture(false).management.bindParentLink(actor, input, 0, 'operation_bind_cross_class')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(fixture(true, 5).management.bindParentLink(actor, input, 0, 'operation_bind_limit')).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(fixture(true, 0, 3).management.bindParentLink(actor, input, 0, 'operation_student_limit')).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(management.bindParentLink({ ...actor, authzVersion: 1 }, input, 0, 'operation_bind_old_session')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects swapped roles and cross-school identities without leaving a link or audit', async () => {
    const { management, database } = fixture();
    await expect(management.bindParentLink(actor, { parentId: 'student_one', studentId: 'parent_one',
      reason: '角色反转尝试' }, 0, 'operation_bind_wrong_roles')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await database.runTransaction(async tx => {
      const parent = await tx.get('users', 'parent_one');
      if (!parent) throw new Error('missing fixture');
      await tx.replace('users', parent._id, parent.version, { ...parent, organizationId: 'org_other', version: 2 });
    });
    await expect(management.bindParentLink(actor, { parentId: 'parent_one', studentId: 'student_one',
      reason: '越校尝试' }, 0, 'operation_bind_cross_school')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(database.snapshot().parent_student_links).toHaveLength(0);
    expect(database.snapshot().operation_logs ?? []).toHaveLength(0);
  });

  it('filters the full user result before pagination and projects only safe metadata', async () => {
    const { data } = fixture();
    const page = await data.listUsers(actor, '', 1, 0, '', 'student');
    expect(page.nextOffset).toBeNull();
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ id: 'student_one', role: 'student',
      classNames: ['三年级 2 班'], mobileMasked: '138****0001', lastLoginAt: '2026-10-06T10:00:00+08:00' });
    expect(page.items[0]).not.toHaveProperty('mobile');
    expect(await data.listUsers(actor, '', 1, 0, '不存在', 'student')).toMatchObject({ items: [], nextOffset: null });
  });

  it('strictly rejects caller-supplied organization, role escalation and binding versions', () => {
    expect(validateNativeAdminQueryRequest({ action: 'getOrganization', payload: { organizationId: 'other' } }).ok).toBe(false);
    expect(validateNativeAdminQueryRequest({ action: 'listUsers', payload: { classId: '', role: 'superadmin', page: { limit: 20, offset: 0 } } }).ok).toBe(false);
    expect(validateNativeAdminManagementRequest({ action: 'bindParentLink', expectedVersion: 1, operationId: 'operation_invalid_bind',
      payload: { parentId: 'parent_one', studentId: 'student_one', reason: '虚构校验' } }).ok).toBe(false);
  });
});
