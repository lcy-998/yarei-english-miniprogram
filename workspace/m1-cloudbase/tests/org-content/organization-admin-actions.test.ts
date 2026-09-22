import { describe, expect, it } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { InMemoryOrgContentIdempotency } from '../../src/org-content/idempotency';
import { InMemoryOrgContentRepository, type OrgContentFixture } from '../../src/org-content/in-memory-repository';
import { OrganizationService } from '../../src/org-content/organization-service';
import type { UserEntity } from '../../src/org-content/types';

const ORG_ID = 'org_qihang';
const CLASS_ID = 'cls_grade3_2';
const EMPTY_CLASS_ID = 'cls_grade4_1';
const ADMIN_ID = 'usr_admin_zhou';
const TEACHER_ID = 'usr_teacher_lin';
const STUDENT_ID = 'usr_student_xiaoyu';
const NOW = '2026-09-16T08:00:00.000Z';

function actor(
  userId: string,
  permissions: readonly string[],
  scopeIds: readonly string[],
): TrustedActorContext {
  return {
    requestId: `req_${userId}`,
    sessionId: `ses_${userId}`,
    actorUserId: userId,
    actorRole: 'admin',
    organizationId: ORG_ID,
    platformSubjectDigest: `digest_${userId}`,
    permissions,
    scopeIds,
    authzVersion: 1,
  };
}

function users(): readonly UserEntity[] {
  return [
    { id: ADMIN_ID, organizationId: ORG_ID, authorizationVersion: 1, displayName: '周老师', displayNameMasked: '周*', roles: ['admin'], status: 'active', version: 1 },
    { id: TEACHER_ID, organizationId: ORG_ID, authorizationVersion: 1, displayName: '林老师', displayNameMasked: '林*', mobileMasked: '139****0002', roles: ['teacher'], status: 'active', version: 1 },
    { id: STUDENT_ID, organizationId: ORG_ID, authorizationVersion: 1, displayName: '小宇', displayNameMasked: '小*', studentNumber: 'STU-DEMO-0032', roles: ['student'], status: 'active', version: 1 },
  ];
}

function fixture(overrides: OrgContentFixture = {}): OrgContentFixture {
  return {
    organizations: [{ id: ORG_ID, name: '启航实验学校', status: 'active', timeZone: 'Asia/Shanghai', version: 1 }],
    classes: overrides.classes ?? [
      { id: CLASS_ID, organizationId: ORG_ID, name: '三年级 2 班', grade: '三年级', term: '上学期', status: 'active', version: 1 },
      { id: EMPTY_CLASS_ID, organizationId: ORG_ID, name: '四年级 1 班', grade: '四年级', term: '上学期', status: 'active', version: 1 },
    ],
    users: overrides.users ?? users(),
    memberships: overrides.memberships ?? [
      { id: 'mem_xiaoyu', organizationId: ORG_ID, classId: CLASS_ID, studentId: STUDENT_ID, status: 'active', version: 1 },
    ],
    roleAssignments: overrides.roleAssignments ?? [],
    teacherGrants: overrides.teacherGrants ?? [],
    organizationAudits: overrides.organizationAudits ?? [],
  };
}

let sequence = 0;
const ids = { next: (prefix: string): string => `${prefix}_${++sequence}` };
const clock = { nowIso: (): string => NOW };

function service(repository: InMemoryOrgContentRepository): OrganizationService {
  return new OrganizationService(repository, clock, ids, new InMemoryOrgContentIdempotency());
}

describe('A-02 学校/班级管理后端动作', () => {
  it('新建、编辑、停用均校验权限、scope、版本和幂等，并阻止停用仍有学生的班级', async () => {
    const repository = new InMemoryOrgContentRepository(fixture());
    const sut = service(repository);
    const admin = actor(ADMIN_ID, ['class.read', 'class.manage'], [ORG_ID]);

    const created = await sut.createClass(admin, {
      name: '五年级 1 班', grade: '五年级', term: '上学期', reason: '新学年开班', expectedVersion: 1, operationId: 'operation_class_create_0001',
    });
    expect(await sut.createClass(admin, {
      name: '五年级 1 班', grade: '五年级', term: '上学期', reason: '新学年开班', expectedVersion: 1, operationId: 'operation_class_create_0001',
    })).toEqual(created);
    await expect(sut.createClass(admin, {
      name: '五年级 2 班', grade: '五年级', term: '上学期', reason: '复用操作标识', expectedVersion: 1, operationId: 'operation_class_create_0001',
    })).rejects.toMatchObject({ code: 'CONFLICT' });

    const updated = await sut.updateClass(admin, {
      classId: created.id, name: '五年级一班', grade: '五年级', term: '下学期', reason: '更新班级资料', expectedVersion: 1, operationId: 'operation_class_update_0001',
    });
    expect(updated).toMatchObject({ name: '五年级一班', term: '下学期', version: 2 });
    await expect(sut.updateClass(admin, {
      classId: created.id, name: '冲突名称', grade: '五年级', term: '下学期', reason: '旧版本更新', expectedVersion: 1, operationId: 'operation_class_update_stale_0001',
    })).rejects.toMatchObject({ code: 'CONFLICT' });

    await expect(sut.disableClass(admin, CLASS_ID, 1, '停用有学生班级', 'operation_class_disable_guard_0001'))
      .rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await sut.disableClass(admin, EMPTY_CLASS_ID, 1, '空班停用', 'operation_class_disable_0001'))
      .toMatchObject({ status: 'archived', version: 2 });

    const snapshot = repository.debugSnapshot();
    expect(snapshot.organizationAudits.some((entry) => entry.action === 'class.disabled' && entry.result === 'denied')).toBe(true);
    expect(snapshot.organizationAudits.filter((entry) => entry.action === 'class.created' && entry.result === 'succeeded')).toHaveLength(1);
  });
});

describe('A-03 用户管理后端动作', () => {
  it('创建学生只保存脱敏手机号并原子建立班级关系，停用后关系立即失效且班级 guard 递增', async () => {
    const repository = new InMemoryOrgContentRepository(fixture());
    const sut = service(repository);
    const admin = actor(ADMIN_ID, ['user.read', 'user.manage'], [ORG_ID]);

    const created = await sut.createUser(admin, {
      displayName: '演示同学', mobile: '13800000009', role: 'student', classId: CLASS_ID,
      reason: '创建虚构学生', expectedVersion: 1, operationId: 'operation_user_create_0001',
    });
    expect(created).toMatchObject({ displayNameMasked: '演**', mobileMasked: '138****0009', roles: ['student'], classIds: [CLASS_ID] });
    expect(JSON.stringify(repository.debugSnapshot())).not.toContain('13800000009');
    expect(repository.debugSnapshot().classes.find((item) => item.id === CLASS_ID)?.version).toBe(2);

    const updated = await sut.updateUser(admin, {
      userId: created.id, displayName: '演示同学二号', reason: '修正虚构账号资料', expectedVersion: 1, operationId: 'operation_user_update_0001',
    });
    expect(updated).toMatchObject({ displayName: '演示同学二号', displayNameMasked: '演**', version: 2 });
    await expect(sut.updateUser(admin, {
      userId: created.id, displayName: '过期资料', reason: '旧版本更新', expectedVersion: 1, operationId: 'operation_user_update_stale_0001',
    })).rejects.toMatchObject({ code: 'CONFLICT' });

    const listed = await sut.listUsers(admin, { classId: CLASS_ID, role: 'student', keyword: '演示' });
    expect(listed).toEqual([expect.objectContaining({ id: created.id, mobileMasked: '138****0009' })]);

    const disabled = await sut.disableUser(admin, created.id, 2, '账号不再使用', 'operation_user_disable_0001');
    expect(disabled).toMatchObject({ status: 'disabled', version: 3 });
    expect(repository.debugSnapshot().memberships.find((item) => item.studentId === created.id)).toMatchObject({ status: 'inactive', version: 2 });
    expect(repository.debugSnapshot().classes.find((item) => item.id === CLASS_ID)?.version).toBe(3);
    await expect(sut.disableUser(admin, ADMIN_ID, 1, '尝试停用自己', 'operation_user_disable_self_0001'))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('A-04 角色和数据范围管理后端动作', () => {
  it('角色发布与撤销使用 expectedVersion，限制数据范围并防止管理员自锁', async () => {
    const repository = new InMemoryOrgContentRepository(fixture());
    const sut = service(repository);
    const admin = actor(ADMIN_ID, ['authorization.manage'], [ORG_ID]);

    const assigned = await sut.assignRole(admin, {
      userId: TEACHER_ID, role: 'teacher', permissions: ['class.read', 'student.read'], scopeType: 'classes', scopeIds: [CLASS_ID],
      reason: '配置教师数据范围', expectedVersion: 1, operationId: 'operation_role_assign_0001',
    });
    expect(assigned).toMatchObject({ role: 'teacher', status: 'active', scopeIds: [CLASS_ID], version: 1 });
    await expect(sut.assignRole(admin, {
      userId: TEACHER_ID, role: 'teacher', permissions: ['class.read'], scopeType: 'classes', scopeIds: [CLASS_ID],
      reason: '旧版本覆盖', expectedVersion: 2, operationId: 'operation_role_assign_stale_0001',
    })).rejects.toMatchObject({ code: 'CONFLICT' });

    const revoked = await sut.revokeRole(admin, TEACHER_ID, 'teacher', assigned.version, '撤销教师角色', 'operation_role_revoke_0001');
    expect(revoked).toMatchObject({ status: 'revoked', version: 2 });
    expect(repository.debugSnapshot().users.find((item) => item.id === TEACHER_ID)?.roles).not.toContain('teacher');

    await expect(sut.assignRole(admin, {
      userId: ADMIN_ID, role: 'admin', permissions: ['authorization.manage'], scopeType: 'organization', scopeIds: [ORG_ID],
      reason: '尝试修改自身权限', expectedVersion: 1, operationId: 'operation_role_self_0001',
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const classScopedAdmin = actor('usr_admin_class', ['authorization.manage'], [CLASS_ID]);
    await expect(sut.assignRole(classScopedAdmin, {
      userId: STUDENT_ID, role: 'student', permissions: ['content.read'], scopeType: 'classes', scopeIds: [EMPTY_CLASS_ID],
      reason: '越权扩大范围', expectedVersion: 1, operationId: 'operation_role_scope_0001',
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const audits = repository.debugSnapshot().organizationAudits;
    expect(audits.some((entry) => entry.action === 'role.assigned' && entry.result === 'succeeded')).toBe(true);
    expect(audits.some((entry) => entry.action === 'role.assigned' && entry.result === 'denied')).toBe(true);
  });

  it('跨角色和教师班级授权交错变更只递增用户级 authorizationVersion', async () => {
    const repository = new InMemoryOrgContentRepository(fixture({
      users: users().map((user) => user.id === TEACHER_ID
        ? { ...user, authorizationVersion: 7 }
        : user),
      roleAssignments: [{
        id: 'role_teacher_existing', organizationId: ORG_ID, userId: TEACHER_ID, role: 'teacher',
        status: 'active', permissions: ['class.read'], scopeType: 'classes', scopeIds: [CLASS_ID],
        grantedBy: ADMIN_ID, grantedAt: NOW, version: 10,
      }],
    }));
    const sut = service(repository);
    const admin = actor(ADMIN_ID, ['authorization.manage'], [ORG_ID]);

    const parent = await sut.assignRole(admin, {
      userId: TEACHER_ID, role: 'parent', permissions: ['child.read'], scopeType: 'self', scopeIds: [TEACHER_ID],
      reason: '增加家长角色', expectedVersion: 1, operationId: 'operation_role_parent_assign_0001',
    });
    expect(repository.debugSnapshot().users.find((user) => user.id === TEACHER_ID))
      .toMatchObject({ authorizationVersion: 8, version: 2 });

    await sut.assignRole(admin, {
      userId: TEACHER_ID, role: 'teacher', permissions: ['class.read', 'student.read'], scopeType: 'classes', scopeIds: [CLASS_ID],
      reason: '更新教师角色', expectedVersion: 10, operationId: 'operation_role_teacher_update_0001',
    });
    await sut.revokeRole(admin, TEACHER_ID, 'parent', parent.version, '撤销家长角色', 'operation_role_parent_revoke_0001');
    const grant = await sut.grantTeacherClass(
      admin, TEACHER_ID, CLASS_ID, ['class.read', 'student.read'], 1,
      '授予班级范围', 'operation_teacher_class_grant_0001',
    );
    await sut.revokeTeacherClass(
      admin, TEACHER_ID, CLASS_ID, grant.version,
      '撤销班级范围', 'operation_teacher_class_revoke_0001',
    );

    expect(repository.debugSnapshot().users.find((user) => user.id === TEACHER_ID))
      .toMatchObject({ authorizationVersion: 12, version: 6 });
  });
});
