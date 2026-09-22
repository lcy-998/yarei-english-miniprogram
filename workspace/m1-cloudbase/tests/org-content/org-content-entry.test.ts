import { describe, expect, it, vi } from 'vitest';
import { createContentQueryFunction, main as unconfiguredContentQuery } from '../../functions/content-query';
import type { ContentQueryHandler } from '../../functions/content-query/function-entry';
import { createOrganizationAdminFunction, main as unconfiguredOrganizationAdmin } from '../../functions/organization-admin';
import type { OrganizationAdminHandler } from '../../functions/organization-admin/function-entry';
import { createRelationshipCommandFunction, main as unconfiguredRelationshipCommand } from '../../functions/relationship-command';
import type { RelationshipCommandHandler } from '../../functions/relationship-command/function-entry';
import type { TrustedActorContext, TrustedActorResolver } from '../../src/auth/trusted-actor';
import {
  OrgContentError,
  type BindingCodeIssueView,
  type ClassSafeView,
  type ParentStudentLinkView,
  type ReadingListItemView,
  type ReadingResourceView,
  type RoleAssignmentSafeView,
  type TeacherClassGrantEntity,
  type UserSafeView,
  type VocabularyPackView,
} from '../../src/org-content/types';
import type { CloudBaseRuntimePort } from '../../src/runtime/ports';
import type { FunctionName } from '../../src/shared/protocol';

const teacherActor: TrustedActorContext = {
  requestId: 'req_actor_teacher',
  sessionId: 'session_teacher',
  actorUserId: 'user_teacher_lin',
  actorRole: 'teacher',
  organizationId: 'org_demo',
  platformSubjectDigest: 'digest_teacher',
  permissions: ['class.read', 'student.read', 'student.bind-code.issue', 'content.read'],
  scopeIds: ['class_grade3_2'],
  authzVersion: 1,
};

const parentActor: TrustedActorContext = {
  ...teacherActor,
  requestId: 'req_actor_parent',
  sessionId: 'session_parent',
  actorUserId: 'user_parent_demo',
  actorRole: 'parent',
  platformSubjectDigest: 'digest_parent',
  permissions: ['child.bind', 'child.unbind'],
  scopeIds: ['user_parent_demo'],
};

const adminActor: TrustedActorContext = {
  ...teacherActor,
  requestId: 'req_actor_admin',
  sessionId: 'session_admin',
  actorUserId: 'user_admin_demo',
  actorRole: 'admin',
  platformSubjectDigest: 'digest_admin',
  permissions: ['class.read', 'user.read', 'authorization.manage', 'student.bind-code.issue'],
  scopeIds: ['org_demo'],
};

const clock = { nowIso: (): string => '2026-09-16T03:00:00.000Z' };

function createBoundary(functionName: FunctionName, actor: TrustedActorContext | null) {
  let requestSequence = 0;
  const runtime: CloudBaseRuntimePort = {
    functionName,
    getPlatformSubject: vi.fn(async () => ({ subject: 'trusted-platform-subject', loginType: 'USERNAME' as const, isAuthenticated: true })),
    getBusinessSessionId: vi.fn(async () => 'session_from_runtime'),
  };
  const actorResolver: TrustedActorResolver = { resolve: vi.fn(async () => actor) };
  return {
    runtime,
    actorResolver,
    clock,
    requestIds: { next: (): string => `req_boundary_${++requestSequence}` },
  };
}

const child: UserSafeView = {
  id: 'user_student_xiaoyu',
  displayName: '小宇',
  displayNameMasked: '小*',
  studentNumber: 'STU-DEMO-0032',
  roles: ['student'],
  status: 'active',
  version: 1,
};

const link: ParentStudentLinkView = {
  id: 'link_demo',
  child,
  confirmedAt: '2026-09-16T03:00:00.000Z',
  version: 1,
};

function relationshipHandler(): RelationshipCommandHandler {
  return {
    issueBindingCode: vi.fn(async (): Promise<BindingCodeIssueView> => ({ code: '482731', expiresAt: '2026-09-17T03:00:00.000Z' })),
    bindChild: vi.fn(async (): Promise<ParentStudentLinkView> => link),
    unbindChild: vi.fn(async (): Promise<void> => undefined),
  };
}

const readingListItem: ReadingListItemView = {
  id: 'read_zoo', title: 'A Day at the Zoo', category: 'picture_book', grade: '三年级', difficulty: '基础', contentVersion: 'demo-v1',
};

const readingDetail: ReadingResourceView = {
  ...readingListItem,
  presentation: 'page_images_only',
  textVisibility: { ocrExposed: false, standaloneBodyExposed: false },
  chapters: [],
};

const vocabularyPack: VocabularyPackView = {
  id: 'vocab_animals', title: 'Unit 3 Animals', grade: '三年级', unit: 'Unit 3', contentVersion: 'demo-v1', words: [],
};

function contentHandler(): ContentQueryHandler {
  return {
    listReadingResources: vi.fn(async () => [readingListItem]),
    getReadingResource: vi.fn(async () => readingDetail),
    listVocabularyPacks: vi.fn(async () => [vocabularyPack]),
    getVocabularyPack: vi.fn(async () => vocabularyPack),
  };
}

const classView: ClassSafeView = {
  id: 'class_grade3_2', name: '三年级 2 班', grade: '三年级', term: '第一学期', status: 'active', version: 1,
};

const grant: TeacherClassGrantEntity = {
  id: 'grant_demo', organizationId: 'org_demo', teacherId: 'user_teacher_lin', classId: 'class_grade3_2',
  permissions: ['class.read', 'student.read'], status: 'active', grantedBy: 'user_admin_demo',
  grantedAt: '2026-09-16T03:00:00.000Z', version: 1,
};

const roleAssignment: RoleAssignmentSafeView = {
  id: 'role_teacher_demo', userId: teacherActor.actorUserId, role: 'teacher', status: 'active',
  permissions: ['class.read'], scopeType: 'classes', scopeIds: [classView.id], version: 1,
};

function organizationHandler(): OrganizationAdminHandler {
  return {
    getDashboardOverview: vi.fn(async () => ({
      range: { from: '2026-09-09T03:00:00.000Z', to: clock.nowIso() },
      counts: { organizationCount: 1, classCount: 1, activeUserCount: 1, taskCount: 0 },
      completion: { assignmentCount: 0, completedCount: 0, completionRate: 0 },
      anomalies: { overdueCount: 0, pendingReviewCount: 0 },
    })),
    listRoleAssignments: vi.fn(async () => ({ items: [roleAssignment], total: 1, nextOffset: null })),
    listAuditLogs: vi.fn(async () => ({ items: [], total: 0, nextOffset: null })),
    listClasses: vi.fn(async () => [classView]),
    createClass: vi.fn(async () => classView),
    updateClass: vi.fn(async () => ({ ...classView, version: 2 })),
    disableClass: vi.fn(async () => ({ ...classView, status: 'archived' as const, version: 2 })),
    listUsers: vi.fn(async () => [child]),
    createUser: vi.fn(async () => child),
    updateUser: vi.fn(async () => ({ ...child, displayName: '演示学生二号', version: 2 })),
    disableUser: vi.fn(async () => ({ ...child, status: 'disabled' as const, version: 2 })),
    assignRole: vi.fn(async () => roleAssignment),
    revokeRole: vi.fn(async () => ({ ...roleAssignment, status: 'revoked' as const, version: 2 })),
    grantTeacherClass: vi.fn(async () => grant),
    revokeTeacherClass: vi.fn(async () => ({ ...grant, status: 'revoked' as const, revokedAt: clock.nowIso(), version: 2 })),
  };
}

describe('M1 relationship-command 可注入函数入口', () => {
  it('从 runtime 与 resolver 获取可信身份并分发签发、绑定和解绑', async () => {
    const teacherBoundary = createBoundary('relationship-command', teacherActor);
    const handler = relationshipHandler();
    const teacherMain = createRelationshipCommandFunction({ ...teacherBoundary, handler });
    expect(await teacherMain({
      apiVersion: 'm1.v1', action: 'issueBindingCode', payload: { studentId: child.id }, operationId: 'operation_issue_0001',
    })).toMatchObject({ ok: true, data: { code: '482731' } });
    expect(handler.issueBindingCode).toHaveBeenCalledWith(teacherActor, child.id, 'operation_issue_0001');
    expect(teacherBoundary.actorResolver.resolve).toHaveBeenCalledWith(
      { subject: 'trusted-platform-subject', loginType: 'USERNAME', isAuthenticated: true },
      'relationship-command',
      'session_from_runtime',
    );

    const parentHandler = relationshipHandler();
    const parentMain = createRelationshipCommandFunction({ ...createBoundary('relationship-command', parentActor), handler: parentHandler });
    expect(await parentMain({
      apiVersion: 'm1.v1', action: 'bindChild', payload: { studentNumber: 'STU-DEMO-0032', code: '482731' }, operationId: 'operation_bind_0001',
    })).toMatchObject({ ok: true, data: { child: { id: child.id } } });
    expect(await parentMain({
      apiVersion: 'm1.v1', action: 'unbindChild', payload: { childId: child.id, reason: '家长主动解除演示关系' },
      expectedVersion: 1, operationId: 'operation_unbind_0001',
    })).toMatchObject({ ok: true, data: null });
    expect(parentHandler.unbindChild).toHaveBeenCalledWith(parentActor, child.id, 1, '家长主动解除演示关系', 'operation_unbind_0001');
  });

  it('严格拒绝伪造身份、未知 payload 字段和错误的 operationId/expectedVersion 组合', async () => {
    const boundary = createBoundary('relationship-command', parentActor);
    const handler = relationshipHandler();
    const main = createRelationshipCommandFunction({ ...boundary, handler });
    expect(await main({
      apiVersion: 'm1.v1', action: 'bindChild', payload: { studentNumber: 'STU-DEMO-0032', code: '482731', actorRole: 'admin' }, operationId: 'operation_bind_0002',
    })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR', fieldErrors: { actorRole: expect.any(String) } } });
    expect(await main({
      apiVersion: 'm1.v1', action: 'issueBindingCode', payload: { studentId: child.id }, expectedVersion: 1, operationId: 'operation_issue_0002',
    })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR', fieldErrors: { expectedVersion: expect.any(String) } } });
    expect(await main({
      apiVersion: 'm1.v1', action: 'unbindChild', payload: { childId: child.id, reason: '演示解绑' }, operationId: 'operation_unbind_0002',
    })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR', fieldErrors: { expectedVersion: expect.any(String) } } });
    expect(boundary.actorResolver.resolve).not.toHaveBeenCalled();
  });

  it('后台可信 admin 可签发绑定码，但客户端伪造 admin 字段无效', async () => {
    const handler = relationshipHandler();
    const main = createRelationshipCommandFunction({ ...createBoundary('relationship-command', adminActor), handler });
    expect(await main({
      apiVersion: 'm1.v1', action: 'issueBindingCode', payload: { studentId: child.id }, operationId: 'operation_admin_issue_0001',
    })).toMatchObject({ ok: true });
    expect(handler.issueBindingCode).toHaveBeenCalledWith(adminActor, child.id, 'operation_admin_issue_0001');
  });
});

describe('M1 content-query 可注入函数入口', () => {
  it('分发四个基础阅读/单词查询且查询禁止 operationId 和 expectedVersion', async () => {
    const handler = contentHandler();
    const main = createContentQueryFunction({ ...createBoundary('content-query', teacherActor), handler });
    expect(await main({ apiVersion: 'm1.v1', action: 'listReadingResources', payload: {} })).toMatchObject({ ok: true, data: [{ id: 'read_zoo' }] });
    expect(await main({ apiVersion: 'm1.v1', action: 'getReadingResource', payload: { resourceId: 'read_zoo' } })).toMatchObject({ ok: true, data: { presentation: 'page_images_only' } });
    expect(await main({ apiVersion: 'm1.v1', action: 'listVocabularyPacks', payload: {} })).toMatchObject({ ok: true, data: [{ id: 'vocab_animals' }] });
    expect(await main({ apiVersion: 'm1.v1', action: 'getVocabularyPack', payload: { resourceId: 'vocab_animals' } })).toMatchObject({ ok: true, data: { id: 'vocab_animals' } });
    expect(await main({ apiVersion: 'm1.v1', action: 'getReadingResource', payload: { resourceId: 'read_zoo' }, operationId: 'operation_query_0001' }))
      .toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR', fieldErrors: { operationId: expect.any(String) } } });
  });

  it('详情 payload 使用精确 schema，身份只由 resolver 注入', async () => {
    const boundary = createBoundary('content-query', teacherActor);
    const handler = contentHandler();
    const main = createContentQueryFunction({ ...boundary, handler });
    expect(await main({
      apiVersion: 'm1.v1', action: 'getVocabularyPack', payload: { resourceId: 'vocab_animals', organizationId: 'org_forged' },
    })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR', fieldErrors: { organizationId: expect.any(String) } } });
    expect(handler.getVocabularyPack).not.toHaveBeenCalled();
    expect(boundary.actorResolver.resolve).not.toHaveBeenCalled();
  });
});

describe('M1 organization-admin 可注入函数入口', () => {
  it('允许可信后台 admin 分发 A-02/A-03/A-04 的完整 M1 action', async () => {
    const handler = organizationHandler();
    const main = createOrganizationAdminFunction({ ...createBoundary('organization-admin', adminActor), handler });
    expect(await main({ apiVersion: 'm1.v1', action: 'getDashboardOverview', payload: {} })).toMatchObject({ ok: true, data: { counts: { organizationCount: 1 } } });
    expect(await main({ apiVersion: 'm1.v1', action: 'listRoleAssignments', payload: { filter: {}, page: { limit: 20, offset: 0 } } }))
      .toMatchObject({ ok: true, data: { total: 1, items: [{ id: roleAssignment.id }] } });
    expect(await main({ apiVersion: 'm1.v1', action: 'listAuditLogs', payload: { filter: {}, page: { limit: 20, offset: 0 } } }))
      .toMatchObject({ ok: true, data: { total: 0, items: [] } });
    expect(await main({ apiVersion: 'm1.v1', action: 'listClasses', payload: {} })).toMatchObject({ ok: true, data: [{ id: classView.id }] });
    expect(await main({ apiVersion: 'm1.v1', action: 'listUsers', payload: { classId: classView.id } })).toMatchObject({ ok: true, data: [{ id: child.id }] });
    expect(await main({
      apiVersion: 'm1.v1', action: 'createClass',
      payload: { name: '四年级 1 班', grade: '四年级', term: '上学期', reason: '新增演示班级' },
      expectedVersion: 1, operationId: 'operation_create_class_0001',
    })).toMatchObject({ ok: true, data: { id: classView.id } });
    expect(await main({
      apiVersion: 'm1.v1', action: 'updateClass',
      payload: { classId: classView.id, name: '三年级 2 班', grade: '三年级', term: '下学期', reason: '更新学期' },
      expectedVersion: 1, operationId: 'operation_update_class_0001',
    })).toMatchObject({ ok: true, data: { version: 2 } });
    expect(await main({
      apiVersion: 'm1.v1', action: 'disableClass', payload: { classId: classView.id, reason: '演示停用' },
      expectedVersion: 1, operationId: 'operation_disable_class_0001',
    })).toMatchObject({ ok: true, data: { status: 'archived' } });
    expect(await main({
      apiVersion: 'm1.v1', action: 'createUser',
      payload: { displayName: '演示学生', mobile: '13800000009', role: 'student', classId: classView.id, reason: '新建演示账号' },
      expectedVersion: 1, operationId: 'operation_create_user_0001',
    })).toMatchObject({ ok: true, data: { id: child.id } });
    expect(await main({
      apiVersion: 'm1.v1', action: 'updateUser',
      payload: { userId: child.id, displayName: '演示学生二号', reason: '修正演示账号' },
      expectedVersion: 1, operationId: 'operation_update_user_0001',
    })).toMatchObject({ ok: true, data: { displayName: '演示学生二号', version: 2 } });
    expect(await main({
      apiVersion: 'm1.v1', action: 'disableUser', payload: { userId: child.id, reason: '停用演示账号' },
      expectedVersion: 1, operationId: 'operation_disable_user_0001',
    })).toMatchObject({ ok: true, data: { status: 'disabled' } });
    expect(await main({
      apiVersion: 'm1.v1', action: 'assignRole',
      payload: { userId: teacherActor.actorUserId, role: 'teacher', permissions: ['class.read'], scopeType: 'classes', scopeIds: [classView.id], reason: '配置教学权限' },
      expectedVersion: 1, operationId: 'operation_assign_role_0001',
    })).toMatchObject({ ok: true, data: { role: 'teacher' } });
    expect(await main({
      apiVersion: 'm1.v1', action: 'revokeRole', payload: { userId: teacherActor.actorUserId, role: 'teacher', reason: '撤销教学角色' },
      expectedVersion: 1, operationId: 'operation_revoke_role_0001',
    })).toMatchObject({ ok: true, data: { status: 'revoked' } });
    expect(await main({
      apiVersion: 'm1.v1', action: 'grantTeacherClass',
      payload: { teacherId: teacherActor.actorUserId, classId: classView.id, permissions: ['class.read', 'student.read'], reason: '授权演示班级' },
      expectedVersion: 1, operationId: 'operation_grant_0001',
    })).toMatchObject({ ok: true, data: { status: 'active' } });
    expect(await main({
      apiVersion: 'm1.v1', action: 'revokeTeacherClass', payload: { teacherId: teacherActor.actorUserId, classId: classView.id, reason: '撤销演示班级' },
      expectedVersion: 1, operationId: 'operation_revoke_0001',
    })).toMatchObject({ ok: true, data: { status: 'revoked' } });
    expect(handler.grantTeacherClass).toHaveBeenCalledWith(
      adminActor,
      teacherActor.actorUserId,
      classView.id,
      ['class.read', 'student.read'],
      1,
      '授权演示班级',
      'operation_grant_0001',
    );
  });

  it('后台函数在分发前统一拒绝教师小程序会话', async () => {
    const handler = organizationHandler();
    const main = createOrganizationAdminFunction({ ...createBoundary('organization-admin', teacherActor), handler });
    const requests = [
      { apiVersion: 'm1.v1', action: 'getDashboardOverview', payload: {} },
      { apiVersion: 'm1.v1', action: 'listRoleAssignments', payload: { filter: {}, page: { limit: 20, offset: 0 } } },
      { apiVersion: 'm1.v1', action: 'listAuditLogs', payload: { filter: {}, page: { limit: 20, offset: 0 } } },
      { apiVersion: 'm1.v1', action: 'listClasses', payload: {} },
      { apiVersion: 'm1.v1', action: 'listUsers', payload: { classId: classView.id } },
      {
        apiVersion: 'm1.v1',
        action: 'grantTeacherClass',
        payload: { teacherId: teacherActor.actorUserId, classId: classView.id, permissions: ['class.read'], reason: '越权测试' },
        expectedVersion: 1, operationId: 'operation_teacher_grant_0001',
      },
      {
        apiVersion: 'm1.v1',
        action: 'revokeTeacherClass',
        payload: { teacherId: teacherActor.actorUserId, classId: classView.id, reason: '越权测试' },
        expectedVersion: 1,
        operationId: 'operation_teacher_revoke_0001',
      },
    ] as const;

    for (const request of requests) {
      expect(await main(request)).toMatchObject({ ok: false, error: { code: 'FORBIDDEN', retryable: false } });
    }
    expect(handler.listClasses).not.toHaveBeenCalled();
    expect(handler.getDashboardOverview).not.toHaveBeenCalled();
    expect(handler.listRoleAssignments).not.toHaveBeenCalled();
    expect(handler.listAuditLogs).not.toHaveBeenCalled();
    expect(handler.listUsers).not.toHaveBeenCalled();
    expect(handler.grantTeacherClass).not.toHaveBeenCalled();
    expect(handler.revokeTeacherClass).not.toHaveBeenCalled();
  });

  it('写 action 严格要求 operationId、expectedVersion、审计原因和精确 payload', async () => {
    const boundary = createBoundary('organization-admin', adminActor);
    const handler = organizationHandler();
    const main = createOrganizationAdminFunction({ ...boundary, handler });
    expect(await main({ apiVersion: 'm1.v1', action: 'createClass', payload: {} })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_ERROR', fieldErrors: { operationId: expect.any(String) } },
    });
    expect(await main({
      apiVersion: 'm1.v1', action: 'createClass', payload: { name: '演示班', grade: '三年级', term: '上学期', reason: '演示', extra: true },
      expectedVersion: 1, operationId: 'operation_create_class_bad_0001',
    })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR', fieldErrors: { extra: expect.any(String) } } });
    expect(boundary.actorResolver.resolve).not.toHaveBeenCalled();
    expect(handler.listClasses).not.toHaveBeenCalled();
  });

  it('权限数组逐项校验且查询拒绝写操作字段', async () => {
    const handler = organizationHandler();
    const main = createOrganizationAdminFunction({ ...createBoundary('organization-admin', adminActor), handler });
    expect(await main({
      apiVersion: 'm1.v1', action: 'grantTeacherClass',
      payload: { teacherId: teacherActor.actorUserId, classId: classView.id, permissions: ['class.read', 'admin.superuser'], reason: '非法权限测试' },
      expectedVersion: 1, operationId: 'operation_grant_0002',
    })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR', fieldErrors: { 'permissions[1]': expect.any(String) } } });
    expect(await main({
      apiVersion: 'm1.v1', action: 'listUsers', payload: { classId: classView.id }, expectedVersion: 1,
    })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR', fieldErrors: { expectedVersion: expect.any(String) } } });
  });
});

describe('org-content 函数安全错误和默认入口', () => {
  it('只映射受控领域错误码，隐藏未知 handler 内部细节', async () => {
    const forbiddenHandler = relationshipHandler();
    forbiddenHandler.issueBindingCode = vi.fn(async (): Promise<BindingCodeIssueView> => { throw new OrgContentError('FORBIDDEN'); });
    const forbidden = await createRelationshipCommandFunction({
      ...createBoundary('relationship-command', teacherActor),
      handler: forbiddenHandler,
    })({ apiVersion: 'm1.v1', action: 'issueBindingCode', payload: { studentId: child.id }, operationId: 'operation_error_0001' });
    expect(forbidden).toMatchObject({ ok: false, error: { code: 'FORBIDDEN', retryable: false } });

    const unknownHandler = contentHandler();
    unknownHandler.listReadingResources = vi.fn(async (): Promise<readonly ReadingListItemView[]> => {
      throw new Error('secret database detail');
    });
    const unknown = await createContentQueryFunction({
      ...createBoundary('content-query', teacherActor),
      handler: unknownHandler,
    })({ apiVersion: 'm1.v1', action: 'listReadingResources', payload: {} });
    expect(unknown).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR', retryable: true } });
    expect(JSON.stringify(unknown)).not.toContain('secret database detail');
  });

  it('无可信 actor 时拒绝；三个默认 main 对已实现合法请求仍返回 SERVICE_UNAVAILABLE', async () => {
    const handler = contentHandler();
    expect(await createContentQueryFunction({ ...createBoundary('content-query', null), handler })({
      apiVersion: 'm1.v1', action: 'listReadingResources', payload: {},
    })).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
    expect(handler.listReadingResources).not.toHaveBeenCalled();

    expect(await unconfiguredRelationshipCommand({
      apiVersion: 'm1.v1', action: 'bindChild', payload: { studentNumber: 'STU-DEMO-0032', code: '482731' }, operationId: 'operation_default_0001',
    })).toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } });
    expect(await unconfiguredContentQuery({
      apiVersion: 'm1.v1', action: 'getReadingResource', payload: { resourceId: 'read_zoo' },
    })).toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } });
    expect(await unconfiguredOrganizationAdmin({
      apiVersion: 'm1.v1', action: 'listClasses', payload: {},
    })).toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } });
    expect(await unconfiguredOrganizationAdmin({
      apiVersion: 'm1.v1', action: 'createUser', payload: {},
    })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR', fieldErrors: { operationId: expect.any(String) } } });
  });
});
