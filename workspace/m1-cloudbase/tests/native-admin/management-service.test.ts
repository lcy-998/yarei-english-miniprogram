import { describe, expect, it } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import { DocumentNativeAdminGrantRepository, nativeAdminGrantId } from '../../src/native-admin/document-grant-repository';
import { NativeAdminManagementService } from '../../src/native-admin/management-service';

const actor: TrustedActorContext = { requestId: 'req_manager', sessionId: 'ses_manager',
  actorUserId: 'teacher_manager', actorRole: 'teacher', organizationId: 'org_demo',
  platformSubjectDigest: 'digest_manager', permissions: ['task.read'], scopeIds: ['class_other'],
  authzVersion: 2 };

function fixture(organizationWide = false) {
  const base = { organizationId: 'org_demo', schemaVersion: 1 as const,
    version: 1, deletedAt: null };
  const database = new FakeDocumentDatabase({
    users: [
      { _id: 'teacher_manager', ...base, version: 2, status: 'active', authorizationVersion: 2 },
      { _id: 'teacher_target', ...base, status: 'active', authorizationVersion: 1 },
      { _id: 'student_one', ...base, displayName: '虚构学员甲', status: 'active', authorizationVersion: 1 },
      { _id: 'student_other', ...base, displayName: '虚构学员乙', status: 'active', authorizationVersion: 1 },
      { _id: 'parent_one', ...base, displayName: '虚构家长甲', status: 'active', authorizationVersion: 1 },
    ],
    native_admin_grants: [{ _id: nativeAdminGrantId('org_demo', 'teacher_manager'),
      ...base, teacherId: 'teacher_manager', status: 'active',
      permissions: ['organization.manage', 'user.manage'],
      scope: { organizationWide, classIds: organizationWide ? [] : ['class_one'] } }],
    classes: [
      { _id: 'class_one', ...base, name: '虚构一班', grade: 3, term: '秋季', status: 'active' },
      { _id: 'class_other', ...base, name: '虚构二班', grade: 4, term: '秋季', status: 'active' },
    ],
    role_assignments: [
      { _id: 'role_target', ...base, userId: 'teacher_target', role: 'teacher', status: 'active' },
      { _id: 'role_student_one', ...base, userId: 'student_one', role: 'student', status: 'active' },
      { _id: 'role_student_other', ...base, userId: 'student_other', role: 'student', status: 'active' },
    ],
    class_memberships: [
      { _id: 'member_one', ...base, classId: 'class_one', studentId: 'student_one', status: 'active' },
      { _id: 'member_other', ...base, classId: 'class_other', studentId: 'student_other', status: 'active' },
    ],
    parent_student_links: [{ _id: 'link_one', ...base, parentId: 'parent_one', studentId: 'student_one',
      status: 'active', confirmedAt: '2026-10-03T08:00:00+08:00' }],
  });
  const grants = new DocumentNativeAdminGrantRepository(database);
  return { database, service: new NativeAdminManagementService(database, grants,
    { nowIso: () => '2026-10-03T08:00:00+08:00' }) };
}

describe('native A-02/A-03 protected commands', () => {
  it('updates an authorized class once with CAS, receipt and audit', async () => {
    const { database, service } = fixture();
    const input = { classId: 'class_one', name: '虚构一班新版', grade: 3,
      term: '秋季', reason: '核对班级名称' };
    const first = await service.updateClass(actor, input, 1, 'operation_update_class');
    expect(first).toMatchObject({ version: 2, name: '虚构一班新版' });
    expect(await service.updateClass(actor, input, 1, 'operation_update_class')).toEqual(first);
    expect(database.snapshot().classes?.find(row => row._id === 'class_one')).toMatchObject({ version: 2 });
    expect(database.snapshot().operation_logs?.map(row => row.action))
      .toEqual(['native_admin.class.updated']);
    await expect(service.updateClass(actor, { ...input, classId: 'class_other' }, 1,
      'operation_other_class')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('assigns another teacher only in scope and rejects self assignment', async () => {
    const { service } = fixture();
    expect(await service.assignTeacher(actor, { classId: 'class_one', teacherId: 'teacher_target',
      permissions: ['class.read', 'task.read'], reason: '安排虚构教师' }, 0,
    'operation_assign_teacher')).toMatchObject({ version: 1, classId: 'class_one' });
    await expect(service.assignTeacher(actor, { classId: 'class_one', teacherId: actor.actorUserId,
      permissions: ['class.read'], reason: '自我安排' }, 0,
    'operation_assign_self')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('updates and revokes an existing teacher assignment with its actual version', async () => {
    const { service, database } = fixture()
    const input = { classId: 'class_one', teacherId: 'teacher_target',
      permissions: ['class.read', 'task.read'] as const, reason: '安排虚构教师' }
    const assigned = await service.assignTeacher(actor, input, 0, 'operation_assign_existing')
    const changed = await service.assignTeacher(actor, { ...input, permissions: ['class.read'],
      reason: '收紧虚构教师权限' }, assigned.version, 'operation_update_assignment')
    expect(changed).toMatchObject({ version: 2, permissions: ['class.read'] })
    const revoked = await service.revokeTeacher(actor, { classId: 'class_one', teacherId: 'teacher_target',
      reason: '教师离开该班级' }, changed.version, 'operation_revoke_assignment')
    expect(revoked).toMatchObject({ version: 3, permissions: [] })
    expect(database.snapshot().teacher_class_grants?.[0]).toMatchObject({ status: 'revoked', version: 3 })
  })

  it('moves active students before disabling their class and preserves membership history', async () => {
    const { service, database } = fixture(true)
    const result = await service.archiveClass(actor, { classId: 'class_one',
      destinationClassId: 'class_other', reason: '合并虚构班级' }, 1, 1, 'operation_archive_class')
    expect(result).toMatchObject({ status: 'disabled', migratedStudentCount: 1,
      destinationClassId: 'class_other', version: 2 })
    const snapshot = database.snapshot()
    expect(snapshot.classes?.find(row => row._id === 'class_one')).toMatchObject({ status: 'disabled' })
    expect(snapshot.class_memberships?.find(row => row._id === 'member_one')).toMatchObject({ status: 'transferred' })
    expect(snapshot.class_memberships?.filter(row => row.classId === 'class_other' && row.status === 'active'))
      .toHaveLength(2)
  })

  it('refuses to disable a nonempty class without a destination', async () => {
    const { service } = fixture(true)
    await expect(service.archiveClass(actor, { classId: 'class_one', destinationClassId: null,
      reason: '停用虚构班级' }, 1, null, 'operation_archive_without_target'))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('edits only users wholly inside the granted classes and rejects stale sessions', async () => {
    const { service } = fixture();
    expect(await service.updateUser(actor, { userId: 'student_one',
      displayName: '虚构学员新名', reason: '核对演示姓名' }, 1,
    'operation_update_user')).toMatchObject({ version: 2 });
    await expect(service.updateUser(actor, { userId: 'student_other',
      displayName: '越班新名', reason: '越班尝试' }, 1,
    'operation_cross_user')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.updateUser({ ...actor, authzVersion: 1 }, { userId: 'student_one',
      displayName: '旧会话', reason: '旧会话尝试' }, 2,
    'operation_stale_user')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('disables an authorized student, revokes roles and invalidates the old session', async () => {
    const { database, service } = fixture(true)
    expect(await service.disableUser(actor, { userId: 'student_one', reason: '虚构账号结业' }, 1,
      'operation_disable_student')).toMatchObject({ status: 'disabled', version: 2 })
    const snapshot = database.snapshot()
    expect(snapshot.users?.find(row => row._id === 'student_one'))
      .toMatchObject({ status: 'disabled', authorizationVersion: 2 })
    expect(snapshot.class_memberships?.find(row => row._id === 'member_one'))
      .toMatchObject({ status: 'inactive', version: 2 })
    expect(snapshot.role_assignments?.find(row => row._id === 'role_student_one'))
      .toMatchObject({ status: 'revoked', version: 2 })
    expect(snapshot.parent_student_links?.[0]).toMatchObject({ status: 'revoked', version: 2 })
    const limited = fixture(false)
    await expect(limited.service.disableUser(actor, { userId: 'student_other', reason: '越班停用' }, 1,
      'operation_disable_cross_class')).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('unlinks a parent only for a student wholly within the granted classes', async () => {
    const { database, service } = fixture()
    expect(await service.unbindParentLink(actor, { linkId: 'link_one',
      reason: '监护关系更新' }, 1, 'operation_unbind_parent'))
      .toMatchObject({ status: 'revoked', version: 2 })
    expect(database.snapshot().parent_student_links?.[0]).toMatchObject({
      status: 'revoked', revokeReason: '监护关系更新' })
  })

  it('requires organization-wide authority to create a new class', async () => {
    const { service } = fixture();
    await expect(service.createClass(actor, { name: '新虚构班级', grade: 3,
      term: '秋季', reason: '开设班级' }, 0, 'operation_create_class'))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
