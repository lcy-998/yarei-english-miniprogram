import { describe, expect, it } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { validateOrganizationAdminRequest } from '../../src/contracts/org-content-functions';
import { InMemoryOrgContentIdempotency } from '../../src/org-content/idempotency';
import { InMemoryOrgContentRepository } from '../../src/org-content/in-memory-repository';
import { OrganizationService } from '../../src/org-content/organization-service';
import type { OrganizationAuditEntity, RoleAssignmentEntity } from '../../src/org-content/types';
import { InMemoryTaskQueryRepository } from '../../src/task-query/memory-repository';

const ORG_ID = 'org_demo_alpha';
const OTHER_ORG_ID = 'org_demo_beta';
const CLASS_A = 'cls_demo_a';
const CLASS_B = 'cls_demo_b';
const NOW = '2026-09-17T08:00:00.000Z';

function actor(permissions: readonly string[], scopeIds: readonly string[], role: TrustedActorContext['actorRole'] = 'admin'): TrustedActorContext {
  return {
    requestId: 'req_admin_read', sessionId: 'ses_admin_read', actorUserId: 'usr_admin_demo', actorRole: role,
    organizationId: ORG_ID, platformSubjectDigest: 'digest_admin_read', permissions, scopeIds, authzVersion: 1,
  };
}

function assignment(id: string, userId: string, scopeIds: readonly string[], organizationId = ORG_ID): RoleAssignmentEntity {
  return {
    id, organizationId, userId, role: 'teacher', status: 'active', permissions: ['class.read'],
    scopeType: 'classes', scopeIds, grantedBy: 'usr_admin_demo', grantedAt: NOW, version: 1,
  };
}

function audit(id: string, organizationId: string, classId: string, metadata: OrganizationAuditEntity['metadata']): OrganizationAuditEntity {
  return {
    id, organizationId, requestId: `req_${id}`, actorUserId: 'usr_admin_demo', actorRole: 'admin',
    action: 'role.assigned', targetType: 'role_assignment', targetId: `role_${id}`,
    result: 'succeeded', errorCode: null, metadata: { classId, ...metadata }, occurredAt: NOW,
  };
}

function createService() {
  const repository = new InMemoryOrgContentRepository({
    organizations: [
      { id: ORG_ID, name: '虚构甲学校', status: 'active', timeZone: 'Asia/Shanghai', version: 1 },
      { id: OTHER_ORG_ID, name: '虚构乙学校', status: 'active', timeZone: 'Asia/Shanghai', version: 1 },
    ],
    classes: [
      { id: CLASS_A, organizationId: ORG_ID, name: '演示一班', grade: '三年级', term: '上学期', status: 'active', version: 1 },
      { id: CLASS_B, organizationId: ORG_ID, name: '演示二班', grade: '三年级', term: '上学期', status: 'active', version: 1 },
    ],
    users: [
      { id: 'usr_admin_demo', organizationId: ORG_ID, authorizationVersion: 1, displayName: '演示管理员', displayNameMasked: '演**', roles: ['admin'], status: 'active', version: 1 },
      { id: 'usr_student_a', organizationId: ORG_ID, authorizationVersion: 1, displayName: '演示学生甲', displayNameMasked: '演**', roles: ['student'], status: 'active', version: 1 },
      { id: 'usr_student_b', organizationId: ORG_ID, authorizationVersion: 1, displayName: '演示学生乙', displayNameMasked: '演**', roles: ['student'], status: 'active', version: 1 },
    ],
    memberships: [
      { id: 'mem_a', organizationId: ORG_ID, classId: CLASS_A, studentId: 'usr_student_a', status: 'active', version: 1 },
      { id: 'mem_b', organizationId: ORG_ID, classId: CLASS_B, studentId: 'usr_student_b', status: 'active', version: 1 },
    ],
    roleAssignments: [
      assignment('role_a1', 'usr_teacher_a1', [CLASS_A]),
      assignment('role_a2', 'usr_teacher_a2', [CLASS_A]),
      assignment('role_b', 'usr_teacher_b', [CLASS_B]),
      assignment('role_other', 'usr_teacher_other', ['cls_other'], OTHER_ORG_ID),
    ],
    organizationAudits: [
      audit('audit_a', ORG_ID, CLASS_A, {
        role: 'teacher', reason: '不得返回的自由文本', mobile: '13800000000', token: 'secret-token', stack: 'private-stack',
      }),
      audit('audit_b', ORG_ID, CLASS_B, { role: 'teacher' }),
      audit('audit_other', OTHER_ORG_ID, 'cls_other', { role: 'teacher' }),
    ],
  });
  return new OrganizationService(
    repository,
    { nowIso: () => NOW },
    { next: (prefix) => `${prefix}_test` },
    new InMemoryOrgContentIdempotency(),
    new InMemoryTaskQueryRepository({}),
  );
}

describe('organization-admin A-01/A-04 read actions', () => {
  it('严格拒绝客户端 actor/org 注入、嵌套额外字段、越界分页和超长时间窗', () => {
    const base = { apiVersion: 'm1.v1' as const, operationId: undefined, expectedVersion: undefined };
    expect(validateOrganizationAdminRequest({ ...base, action: 'listRoleAssignments', payload: {
      filter: { organizationId: OTHER_ORG_ID }, page: { limit: 20, offset: 0 },
    } })).toMatchObject({ ok: false, fieldErrors: { 'filter.organizationId': '不支持的字段。' } });
    expect(validateOrganizationAdminRequest({ ...base, action: 'listAuditLogs', payload: {
      filter: {}, page: { limit: 51, offset: 0 },
    } })).toMatchObject({ ok: false, fieldErrors: { 'page.limit': expect.any(String) } });
    expect(validateOrganizationAdminRequest({ ...base, action: 'getDashboardOverview', payload: {
      from: '2026-08-01T00:00:00.000Z', to: '2026-09-17T00:00:00.000Z',
    } })).toMatchObject({ ok: false, fieldErrors: { to: expect.any(String) } });
  });

  it('角色列表按可信 scope 隔离且分页 total/nextOffset 语义稳定', async () => {
    const service = createService();
    const scoped = actor(['authorization.manage'], [CLASS_A]);
    const first = await service.listRoleAssignments(scoped, {}, { limit: 1, offset: 0 });
    expect(first).toEqual({ items: [expect.objectContaining({ id: 'role_a1' })], total: 2, nextOffset: 1 });
    const second = await service.listRoleAssignments(scoped, {}, { limit: 1, offset: 1 });
    expect(second).toEqual({ items: [expect.objectContaining({ id: 'role_a2' })], total: 2, nextOffset: null });
    expect(JSON.stringify([first, second])).not.toContain('role_b');
    expect(JSON.stringify([first, second])).not.toContain('role_other');
    await expect(service.listRoleAssignments(actor([], [ORG_ID]), {}, { limit: 20, offset: 0 }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('审计列表按租户和 class scope 隔离，metadata 固定投影不泄漏敏感或自由文本字段', async () => {
    const service = createService();
    const result = await service.listAuditLogs(actor(['audit.read'], [CLASS_A]), {}, { limit: 20, offset: 0 });
    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({ id: 'audit_a', metadata: { classId: CLASS_A, role: 'teacher' } });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('audit_b');
    expect(serialized).not.toContain('audit_other');
    expect(serialized).not.toContain('不得返回');
    expect(serialized).not.toContain('13800000000');
    expect(serialized).not.toContain('secret-token');
    expect(serialized).not.toContain('private-stack');
  });

  it('概览仅聚合可信 class scope，缺少任务查询能力时安全关闭', async () => {
    const service = createService();
    const overview = await service.getDashboardOverview(actor(['organization.read'], [CLASS_A]), {});
    expect(overview).toMatchObject({
      range: { to: NOW },
      counts: { organizationCount: 1, classCount: 1, activeUserCount: 1, taskCount: 0 },
      completion: { assignmentCount: 0, completedCount: 0, completionRate: 0 },
    });
    const unavailable = new OrganizationService(
      new InMemoryOrgContentRepository(), { nowIso: () => NOW }, { next: () => 'id' }, new InMemoryOrgContentIdempotency(),
    );
    await expect(unavailable.getDashboardOverview(actor(['organization.read'], [ORG_ID]), {}))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });
});
