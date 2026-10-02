import { describe, expect, it } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { ContentQueryService } from '../../src/org-content/content-service';
import { InMemoryOrgContentIdempotency } from '../../src/org-content/idempotency';
import { InMemoryOrgContentRepository, type OrgContentFixture } from '../../src/org-content/in-memory-repository';
import { OrganizationService } from '../../src/org-content/organization-service';
import { RelationshipService } from '../../src/org-content/relationship-service';
import {
  OrgContentError,
  type BindingCodeEntity,
  type ParentStudentLinkEntity,
  type ReadingResourceEntity,
  type UserEntity,
  type VocabularyResourceEntity,
} from '../../src/org-content/types';

const ORG_ID = 'org_qihang';
const OTHER_ORG_ID = 'org_other';
const CLASS_ID = 'cls_grade3_2';
const OTHER_CLASS_ID = 'cls_grade4_1';
const STUDENT_ID = 'usr_student_xiaoyu';
const PARENT_ID = 'usr_parent_xiaoyu';
const TEACHER_ID = 'usr_teacher_lin';
const ADMIN_ID = 'usr_admin_zhou';
const NOW = '2026-09-16T01:00:00.000Z';

function actor(
  actorUserId: string,
  actorRole: TrustedActorContext['actorRole'],
  permissions: readonly string[],
  scopeIds: readonly string[],
  organizationId = ORG_ID,
): TrustedActorContext {
  return {
    requestId: `req_${actorUserId}`,
    sessionId: `ses_${actorUserId}`,
    actorUserId,
    actorRole,
    organizationId,
    platformSubjectDigest: `subject_${actorUserId}`,
    permissions,
    scopeIds,
    authzVersion: 1,
  };
}

let idCounter = 0;
const ids = { next: (prefix: string): string => `${prefix}_${++idCounter}` };
const clock = { nowIso: (): string => NOW };
const codes = { nextSixDigits: (): string => '482731' };
const digests = {
  digest(value: string): string {
    let hash = 17;
    for (let index = 0; index < value.length; index += 1) hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
    return `digest_${hash.toString(16)}`;
  },
};

function baseUsers(): readonly UserEntity[] {
  return [
    { id: STUDENT_ID, organizationId: ORG_ID, authorizationVersion: 1, displayName: '小宇', displayNameMasked: '小宇', studentNumber: 'STU-DEMO-0032', roles: ['student'], status: 'active', version: 1 },
    { id: PARENT_ID, organizationId: ORG_ID, authorizationVersion: 1, displayName: '小宇家长', displayNameMasked: '小宇家长', mobileMasked: '138****0001', roles: ['parent'], status: 'active', version: 1 },
    { id: TEACHER_ID, organizationId: ORG_ID, authorizationVersion: 1, displayName: '林老师', displayNameMasked: '林老师', mobileMasked: '139****0002', roles: ['teacher'], status: 'active', version: 1 },
    { id: ADMIN_ID, organizationId: ORG_ID, authorizationVersion: 1, displayName: '周老师', displayNameMasked: '周老师', roles: ['admin'], status: 'active', version: 1 },
  ];
}

function baseFixture(overrides: OrgContentFixture = {}): OrgContentFixture {
  return {
    organizations: overrides.organizations ?? [
      { id: ORG_ID, name: '启航实验学校', status: 'active', timeZone: 'Asia/Shanghai', version: 1 },
      { id: OTHER_ORG_ID, name: '远航演示学校', status: 'active', timeZone: 'Asia/Shanghai', version: 1 },
    ],
    classes: overrides.classes ?? [
      { id: CLASS_ID, organizationId: ORG_ID, name: '三年级 2 班', grade: '三年级', term: '上学期', status: 'active', version: 1 },
      { id: OTHER_CLASS_ID, organizationId: ORG_ID, name: '四年级 1 班', grade: '四年级', term: '上学期', status: 'active', version: 1 },
    ],
    users: overrides.users ?? baseUsers(),
    memberships: overrides.memberships ?? [
      { id: 'mem_xiaoyu', organizationId: ORG_ID, classId: CLASS_ID, studentId: STUDENT_ID, status: 'active', version: 1 },
    ],
    teacherGrants: overrides.teacherGrants ?? [
      {
        id: 'grant_lin_3_2', organizationId: ORG_ID, teacherId: TEACHER_ID, classId: CLASS_ID,
        permissions: ['class.read', 'student.read', 'student.bind-code.issue', 'content.read'], status: 'active',
        grantedBy: ADMIN_ID, grantedAt: NOW, version: 1,
      },
    ],
    parentLinks: overrides.parentLinks ?? [],
    bindingCodes: overrides.bindingCodes ?? [],
    resources: overrides.resources ?? [],
    relationshipAudits: overrides.relationshipAudits ?? [],
  };
}

function relationshipService(repository: InMemoryOrgContentRepository): RelationshipService {
  return new RelationshipService(repository, clock, ids, codes, digests, new InMemoryOrgContentIdempotency());
}

function expectCode(error: unknown, code: OrgContentError['code']): void {
  expect(error).toBeInstanceOf(OrgContentError);
  expect((error as OrgContentError).code).toBe(code);
}

describe('组织安全视图与教师班级授权', () => {
  it('管理员和教师都必须同时具备 permission 与 scope，且用户视图不暴露完整手机号', async () => {
    const repository = new InMemoryOrgContentRepository(baseFixture());
    const service = new OrganizationService(repository, clock, ids, new InMemoryOrgContentIdempotency());
    const admin = actor(ADMIN_ID, 'admin', ['organization.read', 'class.read', 'user.read'], [ORG_ID]);
    const teacher = actor(TEACHER_ID, 'teacher', ['class.read', 'student.read'], [CLASS_ID]);

    expect(await service.listOrganizations(admin)).toEqual([
      { id: ORG_ID, name: '启航实验学校', status: 'active', timeZone: 'Asia/Shanghai', version: 1 },
    ]);
    expect((await service.listClasses(teacher)).map((item) => item.id)).toEqual([CLASS_ID]);
    const students = await service.listUsersForClass(teacher, CLASS_ID);
    expect(students).toHaveLength(1);
    expect(students[0]).toMatchObject({ id: STUDENT_ID, studentNumber: 'STU-DEMO-0032' });
    expect(JSON.stringify(students)).not.toContain('13800000001');

    expect(await service.listClasses(actor(TEACHER_ID, 'teacher', ['class.read'], []))).toEqual([]);
    await expect(service.listUsersForClass(actor(ADMIN_ID, 'admin', [], [ORG_ID]), CLASS_ID)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('管理员授权和撤销教师班级时同样校验具体权限与 scope，撤销立即生效', async () => {
    const repository = new InMemoryOrgContentRepository(baseFixture({ teacherGrants: [] }));
    const service = new OrganizationService(repository, clock, ids, new InMemoryOrgContentIdempotency());
    const scopedAdmin = actor(ADMIN_ID, 'admin', ['authorization.manage'], [CLASS_ID]);
    const grant = await service.grantTeacherClass(scopedAdmin, TEACHER_ID, CLASS_ID, ['class.read', 'student.read'], 1, '教学授权', 'op_grant_1');
    expect(grant).toMatchObject({ status: 'active', permissions: ['class.read', 'student.read'] });

    const teacher = actor(TEACHER_ID, 'teacher', ['class.read', 'student.read'], [CLASS_ID]);
    expect(await service.listClasses(teacher)).toHaveLength(1);
    await service.revokeTeacherClass(scopedAdmin, TEACHER_ID, CLASS_ID, grant.version, '撤销教学授权', 'op_revoke_1');
    expect(await service.listClasses(teacher)).toEqual([]);
    expect(repository.debugSnapshot().organizationAudits.map((entry) => entry.action)).toEqual([
      'teacher_class.granted',
      'teacher_class.revoked',
    ]);

    await expect(service.grantTeacherClass(actor(ADMIN_ID, 'admin', [], [CLASS_ID]), TEACHER_ID, CLASS_ID, ['class.read'], 1, '无权限测试', 'op_grant_denied_1'))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.grantTeacherClass(actor(ADMIN_ID, 'admin', ['authorization.manage'], []), TEACHER_ID, CLASS_ID, ['class.read'], 1, '越权测试', 'op_grant_denied_2'))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('绑定码和家长关系事务', () => {
  it('只返回一次 6 位明文，仓储仅保存摘要且精确 24 小时后失效', async () => {
    const repository = new InMemoryOrgContentRepository(baseFixture());
    const service = relationshipService(repository);
    const teacher = actor(TEACHER_ID, 'teacher', ['student.bind-code.issue'], [CLASS_ID]);
    const issued = await service.issueBindingCode(teacher, STUDENT_ID, 'op_issue_storage');

    expect(issued).toEqual({ code: '482731', expiresAt: '2026-09-17T01:00:00.000Z' });
    const stored = repository.debugSnapshot().bindingCodes[0];
    expect(stored.codeDigest).not.toBe(issued.code);
    expect(JSON.stringify(stored)).not.toContain(issued.code);
    expect(Object.prototype.hasOwnProperty.call(stored, 'code')).toBe(false);
  });

  it('并发错误尝试在事务内原子累计，第 5 次立即锁定且正确码也不能重放', async () => {
    const repository = new InMemoryOrgContentRepository(baseFixture());
    const service = relationshipService(repository);
    await service.issueBindingCode(actor(TEACHER_ID, 'teacher', ['student.bind-code.issue'], [CLASS_ID]), STUDENT_ID, 'op_issue_attempts');
    const parent = actor(PARENT_ID, 'parent', ['child.bind'], [PARENT_ID]);

    const failures = await Promise.all(Array.from({ length: 5 }, async (_, index) => {
      try {
        await service.bindChild(parent, 'STU-DEMO-0032', '000000', `op_wrong_${index}`);
        return 'unexpected-success';
      } catch (error: unknown) {
        expectCode(error, 'VALIDATION_ERROR');
        return 'rejected';
      }
    }));
    expect(failures).toEqual(['rejected', 'rejected', 'rejected', 'rejected', 'rejected']);
    expect(repository.debugSnapshot().bindingCodes[0]).toMatchObject({ attemptCount: 5, status: 'locked', version: 6 });
    await expect(service.bindChild(parent, 'STU-DEMO-0032', '482731', 'op_after_locked')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(repository.debugSnapshot().parentLinks).toHaveLength(0);
  });

  it('绑定成功同时消费码并保留确认记录，解绑后下一次读取立即失权但孩子数据不删除', async () => {
    const repository = new InMemoryOrgContentRepository(baseFixture());
    const service = relationshipService(repository);
    await service.issueBindingCode(actor(TEACHER_ID, 'teacher', ['student.bind-code.issue'], [CLASS_ID]), STUDENT_ID, 'op_issue_success');
    const parentForBind = actor(PARENT_ID, 'parent', ['child.bind', 'child.read', 'child.unbind'], [PARENT_ID]);
    const linked = await service.bindChild(parentForBind, 'STU-DEMO-0032', '482731', 'op_bind_success');

    expect(linked).toMatchObject({ child: { id: STUDENT_ID }, confirmedAt: NOW, version: 1 });
    expect(repository.debugSnapshot().bindingCodes[0]).toMatchObject({ status: 'used', usedByParentId: PARENT_ID });
    expect(repository.debugSnapshot().parentLinks[0]).toMatchObject({
      confirmedBy: TEACHER_ID,
      confirmedAt: NOW,
      confirmationSource: 'binding_code',
    });
    await expect(service.bindChild(parentForBind, 'STU-DEMO-0032', '482731', 'op_bind_replay_different_intent')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(await service.getLinkedChild(parentForBind, STUDENT_ID)).toMatchObject({ child: { id: STUDENT_ID } });
    await expect(service.getLinkedChild({ ...parentForBind, permissions: ['child.bind', 'child.unbind'] }, STUDENT_ID))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    await service.unbindChild(parentForBind, STUDENT_ID, linked.version, '家长主动解除演示关系', 'op_unbind_success');
    await expect(service.getLinkedChild(parentForBind, STUDENT_ID)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await repository.findUser(ORG_ID, STUDENT_ID)).toMatchObject({ id: STUDENT_ID, status: 'active' });
    expect(repository.debugSnapshot().relationshipAudits.map((entry) => entry.action)).toContain('parent_student.unbound');
  });

  it('过期码在消费事务中标记 expired，且不创建关系', async () => {
    const expiredCode: BindingCodeEntity = {
      id: 'code_expired', organizationId: ORG_ID, studentId: STUDENT_ID,
      codeDigest: digests.digest(`${ORG_ID}:${STUDENT_ID}:482731`), status: 'active', attemptCount: 0,
      expiresAt: '2026-09-16T00:59:59.999Z', createdBy: TEACHER_ID, createdAt: '2026-09-15T00:59:59.999Z', version: 1,
    };
    const repository = new InMemoryOrgContentRepository(baseFixture({ bindingCodes: [expiredCode] }));
    const service = relationshipService(repository);
    await expect(service.bindChild(actor(PARENT_ID, 'parent', ['child.bind'], [PARENT_ID]), 'STU-DEMO-0032', '482731', 'op_bind_expired'))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(repository.debugSnapshot().bindingCodes[0]).toMatchObject({ status: 'expired', version: 2 });
    expect(repository.debugSnapshot().parentLinks).toHaveLength(0);
  });

  it('事务强制家长最多 5 个孩子、学生最多 3 个家长', async () => {
    const extraStudents: UserEntity[] = Array.from({ length: 6 }, (_, index) => ({
      id: `usr_student_${index}`, organizationId: ORG_ID, displayName: `演示学生${index}`, displayNameMasked: `演示学生${index}`,
      studentNumber: `STU-DEMO-10${index}`, roles: ['student'], status: 'active', authorizationVersion: 1, version: 1,
    }));
    const fiveLinks: ParentStudentLinkEntity[] = extraStudents.slice(0, 5).map((student, index) => ({
      id: `link_existing_${index}`, organizationId: ORG_ID, parentId: PARENT_ID, studentId: student.id,
      status: 'active', confirmedBy: TEACHER_ID, confirmedAt: NOW, confirmationSource: 'binding_code', version: 1,
    }));
    const target = extraStudents[5];
    const targetCode: BindingCodeEntity = {
      id: 'code_limit_parent', organizationId: ORG_ID, studentId: target.id,
      codeDigest: digests.digest(`${ORG_ID}:${target.id}:482731`), status: 'active', attemptCount: 0,
      expiresAt: '2026-09-17T01:00:00.000Z', createdBy: TEACHER_ID, createdAt: NOW, version: 1,
    };
    const parentLimitRepository = new InMemoryOrgContentRepository(baseFixture({
      users: [...baseUsers(), ...extraStudents],
      memberships: extraStudents.map((student, index) => ({ id: `mem_${index}`, organizationId: ORG_ID, classId: CLASS_ID, studentId: student.id, status: 'active' as const, version: 1 })),
      parentLinks: fiveLinks,
      bindingCodes: [targetCode],
    }));
    await expect(relationshipService(parentLimitRepository).bindChild(actor(PARENT_ID, 'parent', ['child.bind'], [PARENT_ID]), target.studentNumber ?? '', '482731', 'op_parent_limit'))
      .rejects.toMatchObject({ code: 'CONFLICT' });
    expect(parentLimitRepository.debugSnapshot().relationshipAudits.at(-1)).toMatchObject({
      result: 'denied', errorCode: 'CONFLICT', metadata: { reasonCode: 'parent_limit' },
    });

    const otherParents: UserEntity[] = Array.from({ length: 3 }, (_, index) => ({
      id: `usr_parent_${index}`, organizationId: ORG_ID, displayName: `演示家长${index}`, displayNameMasked: `演示家长${index}`,
      roles: ['parent'], status: 'active', authorizationVersion: 1, version: 1,
    }));
    const threeLinks: ParentStudentLinkEntity[] = otherParents.map((parent, index) => ({
      id: `link_student_limit_${index}`, organizationId: ORG_ID, parentId: parent.id, studentId: STUDENT_ID,
      status: 'active', confirmedBy: TEACHER_ID, confirmedAt: NOW, confirmationSource: 'binding_code', version: 1,
    }));
    const studentLimitCode: BindingCodeEntity = {
      id: 'code_limit_student', organizationId: ORG_ID, studentId: STUDENT_ID,
      codeDigest: digests.digest(`${ORG_ID}:${STUDENT_ID}:482731`), status: 'active', attemptCount: 0,
      expiresAt: '2026-09-17T01:00:00.000Z', createdBy: TEACHER_ID, createdAt: NOW, version: 1,
    };
    const studentLimitRepository = new InMemoryOrgContentRepository(baseFixture({
      users: [...baseUsers(), ...otherParents], parentLinks: threeLinks, bindingCodes: [studentLimitCode],
    }));
    await expect(relationshipService(studentLimitRepository).bindChild(actor(PARENT_ID, 'parent', ['child.bind'], [PARENT_ID]), 'STU-DEMO-0032', '482731', 'op_student_limit'))
      .rejects.toMatchObject({ code: 'CONFLICT' });
    expect(studentLimitRepository.debugSnapshot().relationshipAudits.at(-1)).toMatchObject({
      result: 'denied', errorCode: 'CONFLICT', metadata: { reasonCode: 'student_limit' },
    });
  });

  it('教师仅凭角色或 actor permission 不足以跨班生成绑定码', async () => {
    const repository = new InMemoryOrgContentRepository(baseFixture());
    const service = relationshipService(repository);
    await expect(service.issueBindingCode(actor(TEACHER_ID, 'teacher', ['student.bind-code.issue'], [OTHER_CLASS_ID]), STUDENT_ID, 'op_issue_bad_scope'))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.issueBindingCode(actor(TEACHER_ID, 'teacher', [], [CLASS_ID]), STUDENT_ID, 'op_issue_bad_permission'))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(repository.debugSnapshot().relationshipAudits.filter((entry) => entry.result === 'denied')).toHaveLength(2);
  });

  it('不存在的 studentNumber 与错误码使用相同外部错误，不透露学生是否存在', async () => {
    const repository = new InMemoryOrgContentRepository(baseFixture());
    const service = relationshipService(repository);
    await service.issueBindingCode(actor(TEACHER_ID, 'teacher', ['student.bind-code.issue'], [CLASS_ID]), STUDENT_ID, 'op_issue_enumeration');
    const parent = actor(PARENT_ID, 'parent', ['child.bind'], [PARENT_ID]);

    await expect(service.bindChild(parent, 'STU-NOT-EXIST', '482731', 'op_unknown_student')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(service.bindChild(parent, 'STU-DEMO-0032', '000000', 'op_wrong_code_safe')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(repository.debugSnapshot().relationshipAudits.filter((entry) => entry.result === 'denied')).toHaveLength(2);
  });
});

describe('组织与关系 command 幂等边界', () => {
  it('同键同请求返回第一次结果，同键异请求冲突，且绑定/解绑不重复写', async () => {
    const repository = new InMemoryOrgContentRepository(baseFixture());
    const idempotency = new InMemoryOrgContentIdempotency();
    const service = new RelationshipService(repository, clock, ids, codes, digests, idempotency);
    const teacher = actor(TEACHER_ID, 'teacher', ['student.bind-code.issue'], [CLASS_ID]);
    const parent = actor(PARENT_ID, 'parent', ['child.bind', 'child.unbind'], [PARENT_ID]);

    const firstIssue = await service.issueBindingCode(teacher, STUDENT_ID, 'op_idem_issue');
    const repeatedIssue = await service.issueBindingCode(teacher, STUDENT_ID, 'op_idem_issue');
    expect(repeatedIssue).toEqual(firstIssue);
    expect(repository.debugSnapshot().bindingCodes).toHaveLength(1);
    await expect(service.issueBindingCode(teacher, 'usr_student_other', 'op_idem_issue')).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(repository.debugSnapshot().relationshipAudits.at(-1)).toMatchObject({
      result: 'denied', errorCode: 'CONFLICT', metadata: { reasonCode: 'CONFLICT' },
    });

    const firstBind = await service.bindChild(parent, 'STU-DEMO-0032', firstIssue.code, 'op_idem_bind');
    const repeatedBind = await service.bindChild(parent, 'STU-DEMO-0032', firstIssue.code, 'op_idem_bind');
    expect(repeatedBind).toEqual(firstBind);
    expect(repository.debugSnapshot().parentLinks).toHaveLength(1);

    await service.unbindChild(parent, STUDENT_ID, firstBind.version, '幂等解绑演示', 'op_idem_unbind');
    await service.unbindChild(parent, STUDENT_ID, firstBind.version, '幂等解绑演示', 'op_idem_unbind');
    expect(repository.debugSnapshot().parentLinks[0]).toMatchObject({ status: 'revoked', version: 2 });
    expect(repository.debugSnapshot().relationshipAudits.filter((entry) => entry.action === 'parent_student.unbound' && entry.result === 'succeeded')).toHaveLength(1);
  });

  it('教师班级授权与撤销同样具备幂等结果和异请求冲突', async () => {
    const repository = new InMemoryOrgContentRepository(baseFixture({ teacherGrants: [] }));
    const service = new OrganizationService(repository, clock, ids, new InMemoryOrgContentIdempotency());
    const admin = actor(ADMIN_ID, 'admin', ['authorization.manage'], [CLASS_ID]);

    const granted = await service.grantTeacherClass(admin, TEACHER_ID, CLASS_ID, ['class.read'], 1, '授权演示', 'op_idem_grant');
    expect(await service.grantTeacherClass(admin, TEACHER_ID, CLASS_ID, ['class.read'], 1, '授权演示', 'op_idem_grant')).toEqual(granted);
    await expect(service.grantTeacherClass(admin, TEACHER_ID, CLASS_ID, ['student.read'], 1, '授权演示', 'op_idem_grant')).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(repository.debugSnapshot().organizationAudits.filter((entry) => entry.action === 'teacher_class.granted' && entry.result === 'succeeded')).toHaveLength(1);
    expect(repository.debugSnapshot().organizationAudits.filter((entry) => entry.action === 'teacher_class.granted' && entry.result === 'denied')).toHaveLength(1);

    const revoked = await service.revokeTeacherClass(admin, TEACHER_ID, CLASS_ID, granted.version, '撤销演示', 'op_idem_revoke');
    expect(await service.revokeTeacherClass(admin, TEACHER_ID, CLASS_ID, granted.version, '撤销演示', 'op_idem_revoke')).toEqual(revoked);
    expect(repository.debugSnapshot().organizationAudits.filter((entry) => entry.action === 'teacher_class.revoked' && entry.result === 'succeeded')).toHaveLength(1);
  });
});

describe('基础阅读和单词授权查询', () => {
  const publishedReading: ReadingResourceEntity = {
    id: 'read_zoo', organizationId: ORG_ID, type: 'reading', title: 'A Day at the Zoo', contentVersion: 'demo-v1',
    status: 'published', visibility: { type: 'classes', classIds: [CLASS_ID] }, copyrightStatus: 'demo',
    category: 'picture_book', grade: '三年级', difficulty: '基础', searchText: 'private search text',
    chapters: [{
      id: 'chapter_1', title: 'At the Gate', order: 1,
      pages: [{
        id: 'page_1', pageNumber: 1, order: 1, thumbnailAssetKey: 'demo/read-zoo/thumb-1', imageAssetKey: 'demo/read-zoo/page-1',
        width: 1600, height: 1200, assetVersion: 'img-v1', ocrText: 'OCR private text', bodyBlocks: ['private body block'],
      }],
    }],
  };
  const offlineReading: ReadingResourceEntity = { ...publishedReading, id: 'read_offline', title: 'Offline Demo', status: 'offline' };
  const otherOrganizationReading: ReadingResourceEntity = { ...publishedReading, id: 'read_other_org', organizationId: OTHER_ORG_ID, title: 'Other School Book' };
  const vocabulary: VocabularyResourceEntity = {
    id: 'vocab_animals', organizationId: ORG_ID, type: 'vocabulary', title: 'Unit 3 Animals', contentVersion: 'demo-v1',
    status: 'published', visibility: { type: 'classes', classIds: [CLASS_ID] }, copyrightStatus: 'demo', grade: '三年级', unit: 'Unit 3',
    words: [{ id: 'word_tiger', word: 'tiger', meaning: '老虎', example: 'A tiger is at the zoo.', syllables: ['ti', 'ger'] }],
  };

  it('仅列出同组织、已上架且班级授权的资源，offline 和跨组织详情均不可枚举', async () => {
    const repository = new InMemoryOrgContentRepository(baseFixture({ resources: [publishedReading, offlineReading, otherOrganizationReading, vocabulary] }));
    const service = new ContentQueryService(repository);
    const student = actor(STUDENT_ID, 'student', ['content.read'], [STUDENT_ID]);

    expect((await service.listReadingResources(student)).map((item) => item.id)).toEqual(['read_zoo']);
    expect((await service.listVocabularyPacks(student)).map((item) => item.id)).toEqual(['vocab_animals']);
    await expect(service.getReadingResource(student, 'read_offline')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.getReadingResource(student, 'read_other_org')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('阅读详情只映射章节、页码和页图，显式声明不暴露 OCR 或独立正文块', async () => {
    const repository = new InMemoryOrgContentRepository(baseFixture({ resources: [publishedReading] }));
    const service = new ContentQueryService(repository);
    const detail = await service.getReadingResource(actor(STUDENT_ID, 'student', ['content.read'], [STUDENT_ID]), 'read_zoo');
    const serialized = JSON.stringify(detail);

    expect(detail).toMatchObject({
      presentation: 'page_images_only',
      textVisibility: { ocrExposed: false, standaloneBodyExposed: false },
      chapters: [{ pages: [{ pageNumber: 1, imageAssetKey: 'demo/read-zoo/page-1', width: 1600, height: 1200 }] }],
    });
    expect(serialized).not.toContain('OCR private text');
    expect(serialized).not.toContain('private body block');
    expect(serialized).not.toContain('private search text');
    expect(serialized).not.toContain('ocrText');
    expect(serialized).not.toContain('bodyBlocks');
  });

  it('教师内容访问同时要求 actor permission、scope 和当前班级 grant', async () => {
    const repository = new InMemoryOrgContentRepository(baseFixture({ resources: [publishedReading, vocabulary] }));
    const service = new ContentQueryService(repository);
    const teacher = actor(TEACHER_ID, 'teacher', ['content.read'], [CLASS_ID]);
    expect(await service.getVocabularyPack(teacher, 'vocab_animals')).toMatchObject({ title: 'Unit 3 Animals' });

    await expect(service.getReadingResource(actor(TEACHER_ID, 'teacher', [], [CLASS_ID]), 'read_zoo'))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.getReadingResource(actor(TEACHER_ID, 'teacher', ['content.read'], [OTHER_CLASS_ID]), 'read_zoo'))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('M2 学生本人班级查询', () => {
  it('只返回当前有效班级与教师脱敏名称，不返回手机号或其他班级', async () => {
    const service = new ContentQueryService(new InMemoryOrgContentRepository(baseFixture()));
    const view = await service.getMyClass(actor(STUDENT_ID, 'student', [], [STUDENT_ID]));
    expect(view).toEqual({ id: CLASS_ID, name: '三年级 2 班', organizationName: '启航实验学校', grade: '三年级', term: '上学期', studentCount: 1, teacherNames: ['林老师'] });
    expect(JSON.stringify(view)).not.toContain('139****0002');
    expect(JSON.stringify(view)).not.toContain(OTHER_CLASS_ID);
  });

  it('无班级、重复有效班级或非学生身份均失败', async () => {
    const student = actor(STUDENT_ID, 'student', [], [STUDENT_ID]);
    const noClass = new ContentQueryService(new InMemoryOrgContentRepository(baseFixture({ memberships: [] })));
    await expect(noClass.getMyClass(student)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const duplicate = new ContentQueryService(new InMemoryOrgContentRepository(baseFixture({ memberships: [
      { id: 'mem_one', organizationId: ORG_ID, classId: CLASS_ID, studentId: STUDENT_ID, status: 'active', version: 1 },
      { id: 'mem_two', organizationId: ORG_ID, classId: OTHER_CLASS_ID, studentId: STUDENT_ID, status: 'active', version: 1 },
    ] })));
    await expect(duplicate.getMyClass(student)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(duplicate.getMyClass(actor(PARENT_ID, 'parent', ['child.read'], [PARENT_ID]))).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
