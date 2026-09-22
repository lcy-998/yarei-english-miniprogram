import { describe, expect, it } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { InMemoryOrgContentIdempotency } from '../../src/org-content/idempotency';
import { InMemoryOrgContentRepository } from '../../src/org-content/in-memory-repository';
import type { ClassEntity } from '../../src/org-content/types';
import type { VersionedDocument } from '../../src/repositories/document-database-port';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import {
  ORG_CONTENT_COLLECTIONS,
  createOrgContentDocumentPersistence,
} from '../../src/repositories/org-content-document-adapter';
import { TeacherStudentCommandService } from '../../src/teacher-students/command-service';

const ORGANIZATION_ID = 'org_demo';
const TEACHER_ID = 'teacher_lin';
const STUDENT_ID = 'student_xiaoyu';
const SOURCE_CLASS_ID = 'class_three_two';
const TARGET_CLASS_ID = 'class_four_one';
const NOW = '2026-09-17T10:00:00.000+08:00';
const clock = { nowIso: (): string => NOW };

const actor: TrustedActorContext = {
  requestId: 'request_teacher_student_command',
  sessionId: 'session_teacher',
  actorUserId: TEACHER_ID,
  actorRole: 'teacher',
  organizationId: ORGANIZATION_ID,
  platformSubjectDigest: 'digest_teacher',
  permissions: ['student.read', 'student.manage'],
  scopeIds: [SOURCE_CLASS_ID, TARGET_CLASS_ID],
  authzVersion: 3,
};

function createFixture(repository = new InMemoryOrgContentRepository({
  organizations: [{ id: ORGANIZATION_ID, name: '启航实验学校', status: 'active', timeZone: 'Asia/Shanghai', version: 1 }],
  classes: [
    { id: SOURCE_CLASS_ID, organizationId: ORGANIZATION_ID, name: '三年级 2 班', grade: '三年级', term: '上学期', status: 'active', version: 4 },
    { id: TARGET_CLASS_ID, organizationId: ORGANIZATION_ID, name: '四年级 1 班', grade: '四年级', term: '上学期', status: 'active', version: 2 },
  ],
  users: [{
    id: STUDENT_ID,
    organizationId: ORGANIZATION_ID,
    authorizationVersion: 5,
    displayName: '小宇',
    displayNameMasked: '小*',
    studentNumber: 'STU-DEMO-0032',
    roles: ['student'],
    status: 'active',
    version: 7,
  }],
  memberships: [{
    id: 'membership_source',
    organizationId: ORGANIZATION_ID,
    classId: SOURCE_CLASS_ID,
    studentId: STUDENT_ID,
    status: 'active',
    joinedAt: '2026-09-01T08:00:00.000+08:00',
    version: 3,
  }],
  teacherGrants: [SOURCE_CLASS_ID, TARGET_CLASS_ID].map((classId) => ({
    id: `grant_${classId}`,
    organizationId: ORGANIZATION_ID,
    teacherId: TEACHER_ID,
    classId,
    permissions: ['student.read', 'student.manage'] as const,
    status: 'active' as const,
    grantedBy: 'admin_demo',
    grantedAt: '2026-09-01T08:00:00.000+08:00',
    version: 1,
  })),
})) {
  let idSequence = 0;
  const ids = { next: (prefix: string): string => `${prefix}_${++idSequence}` };
  const service = new TeacherStudentCommandService(
    repository,
    clock,
    ids,
    new InMemoryOrgContentIdempotency(),
  );
  return { repository, service };
}

describe('M1 TCH-001 教师学员命令核心', () => {
  it('仅在当前 student.manage 授权班级编辑基础资料，并幂等返回第一次结果', async () => {
    const { repository, service } = createFixture();
    const command = {
      studentId: STUDENT_ID,
      classId: SOURCE_CLASS_ID,
      displayName: '虚构新姓名',
      expectedUserVersion: 7,
      expectedMembershipVersion: 3,
      reason: '更正演示资料',
      operationId: 'operation_student_profile_0001',
    } as const;
    const first = await service.updateProfile(actor, command);
    const replay = await service.updateProfile(actor, command);

    expect(first).toEqual(replay);
    expect(first).toMatchObject({ displayName: '虚构新姓名', userVersion: 8, membershipVersion: 3, classVersion: 4 });
    const snapshot = repository.debugSnapshot();
    expect(snapshot.users).toEqual([expect.objectContaining({
      id: STUDENT_ID,
      displayName: '虚构新姓名',
      displayNameMasked: '虚**',
      authorizationVersion: 5,
      version: 8,
    })]);
    expect(snapshot.organizationAudits).toHaveLength(1);
    expect(snapshot.organizationAudits[0]).toMatchObject({
      action: 'student.profile.updated',
      result: 'succeeded',
      metadata: { classId: SOURCE_CLASS_ID, reasonProvided: true },
    });
    expect(JSON.stringify(snapshot.organizationAudits)).not.toContain('更正演示资料');
    expect(JSON.stringify(snapshot.organizationAudits)).not.toContain('虚构新姓名');
  });

  it('停用和恢复同时更新账号、membership、班级 guard 与 authorizationVersion', async () => {
    const { repository, service } = createFixture();
    const disabled = await service.setStatus(actor, {
      studentId: STUDENT_ID,
      classId: SOURCE_CLASS_ID,
      status: 'disabled',
      expectedUserVersion: 7,
      expectedMembershipVersion: 3,
      expectedClassVersion: 4,
      reason: '暂停演示账号',
      operationId: 'operation_student_disable_0001',
    });
    expect(disabled).toMatchObject({ accountStatus: 'disabled', userVersion: 8, membershipVersion: 4, classVersion: 5 });
    expect(repository.debugSnapshot()).toMatchObject({
      users: [{ status: 'disabled', authorizationVersion: 6, version: 8 }],
      memberships: [{ status: 'inactive', leftAt: NOW, version: 4 }],
      classes: [expect.objectContaining({ id: SOURCE_CLASS_ID, version: 5 }), expect.anything()],
    });

    const restored = await service.setStatus(actor, {
      studentId: STUDENT_ID,
      classId: SOURCE_CLASS_ID,
      status: 'active',
      expectedUserVersion: 8,
      expectedMembershipVersion: 4,
      expectedClassVersion: 5,
      reason: '恢复演示账号',
      operationId: 'operation_student_restore_0001',
    });
    expect(restored).toMatchObject({ accountStatus: 'active', userVersion: 9, membershipVersion: 5, classVersion: 6 });
    const snapshot = repository.debugSnapshot();
    expect(snapshot.users[0]).toMatchObject({ status: 'active', authorizationVersion: 7, version: 9 });
    expect(snapshot.memberships[0]).toMatchObject({ status: 'active', joinedAt: NOW, version: 5 });
    expect(snapshot.memberships[0]).not.toHaveProperty('leftAt');
    expect(snapshot.organizationAudits.map((entry) => entry.action)).toEqual(['student.disabled', 'student.restored']);
  });

  it('转班要求同时拥有源班与目标班管理授权，并原子推进双班 guard', async () => {
    const { repository, service } = createFixture();
    const receipt = await service.transfer(actor, {
      studentId: STUDENT_ID,
      sourceClassId: SOURCE_CLASS_ID,
      targetClassId: TARGET_CLASS_ID,
      expectedUserVersion: 7,
      expectedMembershipVersion: 3,
      expectedTargetMembershipVersion: 0,
      expectedSourceClassVersion: 4,
      expectedTargetClassVersion: 2,
      reason: '按虚构教学安排转班',
      operationId: 'operation_student_transfer_0001',
    });
    expect(receipt).toMatchObject({
      studentId: STUDENT_ID,
      classId: TARGET_CLASS_ID,
      sourceClassId: SOURCE_CLASS_ID,
      userVersion: 8,
      membershipVersion: 1,
      classVersion: 3,
      sourceClassVersion: 5,
    });
    const snapshot = repository.debugSnapshot();
    expect(snapshot.users[0]).toMatchObject({ authorizationVersion: 6, version: 8 });
    expect(snapshot.memberships).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'membership_source', status: 'transferred', leftAt: NOW, version: 4 }),
      expect.objectContaining({ classId: TARGET_CLASS_ID, status: 'active', joinedAt: NOW, version: 1 }),
    ]));
    expect(snapshot.classes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: SOURCE_CLASS_ID, version: 5 }),
      expect.objectContaining({ id: TARGET_CLASS_ID, version: 3 }),
    ]));
    expect(snapshot.organizationAudits).toEqual([
      expect.objectContaining({ action: 'student.transferred', targetType: 'class_membership', result: 'succeeded' }),
    ]);
  });

  it('目标班缺少实时授权或版本过期时拒绝且不留下部分写入', async () => {
    const { repository, service } = createFixture();
    await repository.transaction(async (transaction) => {
      const grant = await transaction.findActiveTeacherGrant(ORGANIZATION_ID, TEACHER_ID, TARGET_CLASS_ID);
      if (grant === null) throw new Error('missing target grant fixture');
      await transaction.saveTeacherGrant({ ...grant, status: 'revoked', revokedAt: NOW, version: grant.version + 1 });
    });
    const before = repository.debugSnapshot();
    await expect(service.transfer(actor, {
      studentId: STUDENT_ID,
      sourceClassId: SOURCE_CLASS_ID,
      targetClassId: TARGET_CLASS_ID,
      expectedUserVersion: 7,
      expectedMembershipVersion: 3,
      expectedTargetMembershipVersion: 0,
      expectedSourceClassVersion: 4,
      expectedTargetClassVersion: 2,
      reason: '无权转入目标班',
      operationId: 'operation_student_transfer_forbidden_0001',
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const after = repository.debugSnapshot();
    expect(after.users).toEqual(before.users);
    expect(after.memberships).toEqual(before.memberships);
    expect(after.classes).toEqual(before.classes);
    expect(after.organizationAudits).toEqual([
      expect.objectContaining({ action: 'student.transferred', result: 'denied', errorCode: 'FORBIDDEN' }),
    ]);
  });

  it('同一 operationId 更换请求内容返回冲突，且不重复执行首次写入', async () => {
    const { repository, service } = createFixture();
    const base = {
      studentId: STUDENT_ID,
      classId: SOURCE_CLASS_ID,
      displayName: '虚构姓名甲',
      expectedUserVersion: 7,
      expectedMembershipVersion: 3,
      reason: '更正资料',
      operationId: 'operation_student_profile_conflict_0001',
    } as const;
    await service.updateProfile(actor, base);
    await expect(service.updateProfile(actor, { ...base, displayName: '虚构姓名乙' }))
      .rejects.toMatchObject({ code: 'CONFLICT' });
    const snapshot = repository.debugSnapshot();
    expect(snapshot.users[0]).toMatchObject({ displayName: '虚构姓名甲', version: 8 });
    expect(snapshot.organizationAudits).toEqual([
      expect.objectContaining({ result: 'succeeded' }),
      expect.objectContaining({ result: 'denied', errorCode: 'CONFLICT' }),
    ]);
  });
});

class FailingClassSaveRepository extends InMemoryOrgContentRepository {
  public override async saveClass(classEntity: ClassEntity): Promise<void> {
    if (classEntity.version > 4) throw new Error('simulated storage failure');
    return super.saveClass(classEntity);
  }
}

describe('M1 TCH-001 命令事务回滚', () => {
  it('事务中途失败时回滚已写 membership，并只留下安全失败审计', async () => {
    const repository = new FailingClassSaveRepository({
      organizations: [{ id: ORGANIZATION_ID, name: '启航实验学校', status: 'active', timeZone: 'Asia/Shanghai', version: 1 }],
      classes: [
        { id: SOURCE_CLASS_ID, organizationId: ORGANIZATION_ID, name: '三年级 2 班', grade: '三年级', term: '上学期', status: 'active', version: 4 },
        { id: TARGET_CLASS_ID, organizationId: ORGANIZATION_ID, name: '四年级 1 班', grade: '四年级', term: '上学期', status: 'active', version: 2 },
      ],
      users: [{ id: STUDENT_ID, organizationId: ORGANIZATION_ID, authorizationVersion: 5, displayName: '小宇', displayNameMasked: '小*', roles: ['student'], status: 'active', version: 7 }],
      memberships: [{ id: 'membership_source', organizationId: ORGANIZATION_ID, classId: SOURCE_CLASS_ID, studentId: STUDENT_ID, status: 'active', version: 3 }],
      teacherGrants: [SOURCE_CLASS_ID, TARGET_CLASS_ID].map((classId) => ({ id: `grant_${classId}`, organizationId: ORGANIZATION_ID, teacherId: TEACHER_ID, classId, permissions: ['student.manage'] as const, status: 'active' as const, grantedBy: 'admin_demo', grantedAt: NOW, version: 1 })),
    });
    const { service } = createFixture(repository);
    const before = repository.debugSnapshot();
    await expect(service.transfer(actor, {
      studentId: STUDENT_ID,
      sourceClassId: SOURCE_CLASS_ID,
      targetClassId: TARGET_CLASS_ID,
      expectedUserVersion: 7,
      expectedMembershipVersion: 3,
      expectedTargetMembershipVersion: 0,
      expectedSourceClassVersion: 4,
      expectedTargetClassVersion: 2,
      reason: '验证事务回滚',
      operationId: 'operation_student_transfer_failure_0001',
    })).rejects.toThrow('simulated storage failure');
    const after = repository.debugSnapshot();
    expect(after.users).toEqual(before.users);
    expect(after.memberships).toEqual(before.memberships);
    expect(after.classes).toEqual(before.classes);
    expect(after.organizationAudits).toEqual([
      expect.objectContaining({ action: 'student.transferred', result: 'failed', errorCode: 'INTERNAL_ERROR' }),
    ]);
  });
});

describe('M1 TCH-001 文档数据库原子持久化', () => {
  it('转班、幂等结果和审计在同一事务提交，冷启动重放不重复写入', async () => {
    const database = new FakeDocumentDatabase({
      [ORG_CONTENT_COLLECTIONS.classes]: [
        document(SOURCE_CLASS_ID, { name: '三年级 2 班', grade: '三年级', term: '上学期', status: 'active' }, 4),
        document(TARGET_CLASS_ID, { name: '四年级 1 班', grade: '四年级', term: '上学期', status: 'active' }, 2),
      ],
      [ORG_CONTENT_COLLECTIONS.users]: [document(STUDENT_ID, {
        authorizationVersion: 5,
        displayName: '小宇',
        displayNameMasked: '小*',
        studentNumber: 'STU-DEMO-0032',
        status: 'active',
      }, 7)],
      [ORG_CONTENT_COLLECTIONS.roles]: [document('role_student', {
        userId: STUDENT_ID,
        role: 'student',
        status: 'active',
        permissions: ['content.read', 'task.read'],
        scopeType: 'self',
        scopeIds: [STUDENT_ID],
        grantedBy: 'admin_demo',
        grantedAt: NOW,
      })],
      [ORG_CONTENT_COLLECTIONS.memberships]: [document('membership_source', {
        classId: SOURCE_CLASS_ID,
        studentId: STUDENT_ID,
        status: 'active',
        joinedAt: '2026-09-01T08:00:00.000+08:00',
      }, 3)],
      [ORG_CONTENT_COLLECTIONS.teacherGrants]: [SOURCE_CLASS_ID, TARGET_CLASS_ID].map((classId) => document(
        `grant_${classId}`,
        {
          teacherId: TEACHER_ID,
          classId,
          permissions: ['student.manage'],
          status: 'active',
          grantedBy: 'admin_demo',
          grantedAt: NOW,
        },
      )),
    });
    const command = {
      studentId: STUDENT_ID,
      sourceClassId: SOURCE_CLASS_ID,
      targetClassId: TARGET_CLASS_ID,
      expectedUserVersion: 7,
      expectedMembershipVersion: 3,
      expectedTargetMembershipVersion: 0,
      expectedSourceClassVersion: 4,
      expectedTargetClassVersion: 2,
      reason: '验证文档事务',
      operationId: 'operation_student_transfer_document_0001',
    } as const;
    const firstPersistence = createOrgContentDocumentPersistence(database);
    const first = new TeacherStudentCommandService(
      firstPersistence.repository,
      clock,
      { next: (prefix) => `${prefix}_document` },
      firstPersistence.idempotency,
    );
    const receipt = await first.transfer(actor, command);
    const secondPersistence = createOrgContentDocumentPersistence(database);
    const coldStart = new TeacherStudentCommandService(
      secondPersistence.repository,
      clock,
      { next: (prefix) => `${prefix}_unused` },
      secondPersistence.idempotency,
    );
    await expect(coldStart.transfer(actor, command)).resolves.toEqual(receipt);

    const snapshot = database.snapshot();
    expect(snapshot[ORG_CONTENT_COLLECTIONS.memberships]).toEqual(expect.arrayContaining([
      expect.objectContaining({ _id: 'membership_source', status: 'transferred', version: 4 }),
      expect.objectContaining({ _id: 'mem_document', classId: TARGET_CLASS_ID, status: 'active', version: 1 }),
    ]));
    expect(snapshot[ORG_CONTENT_COLLECTIONS.idempotency]).toHaveLength(1);
    expect(snapshot[ORG_CONTENT_COLLECTIONS.organizationAudits]).toEqual([
      expect.objectContaining({ action: 'student.transferred', result: 'succeeded' }),
    ]);
  });
});

function document(
  id: string,
  fields: Readonly<Record<string, unknown>>,
  version = 1,
): VersionedDocument {
  return {
    _id: id,
    organizationId: ORGANIZATION_ID,
    schemaVersion: 1,
    createdAt: NOW,
    updatedAt: NOW,
    createdBy: 'system_demo',
    updatedBy: 'system_demo',
    version,
    deletedAt: null,
    deletedBy: null,
    deleteReason: null,
    ...fields,
  };
}
