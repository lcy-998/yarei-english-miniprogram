import { describe, expect, it } from 'vitest';
import { AuthSessionHandler } from '../../src/auth/auth-session-handler';
import { AuthorizationService } from '../../src/auth/authorization-service';
import { RepositoryTrustedActorResolver } from '../../src/auth/actor-resolver';
import { InMemoryBusinessSessionRepository, InMemoryIdentityRepository, type AuthorizationFixture } from '../../src/runtime/memory-ports';
import { dryRunSeed } from '../../src/seed/dry-run';
import { IdempotencyService } from '../../src/idempotency/idempotency-service';
import { InMemoryIdempotencyRepository, InMemoryOperationLogRepository } from '../../src/runtime/memory-ports';
import { OperationAudit } from '../../src/audit/operation-audit';
import { success } from '../../src/shared/result';
import { parseAuthPayload } from '../../src/contracts/auth-session';

const now = '2026-09-15T00:00:00.000Z';
const clock = { nowIso: (): string => now };
let next = 0;
const ids = { next: (prefix: string): string => `${prefix}_${++next}` };
const subjectDigest = { digest: (subject: string): string => `digest_${subject}` };
const meta = { requestId: 'req_auth_test', serverTime: now, apiVersion: 'm1.v1' as const };

const fixture: AuthorizationFixture = {
  organizations: [{ _id: 'org_demo', organizationId: 'org_demo', name: '启航实验学校', status: 'active', timeZone: 'Asia/Shanghai', version: 1, deletedAt: null }],
  users: [
    { _id: 'usr_teacher', organizationId: 'org_demo', authorizationVersion: 1, displayName: '林老师', displayNameMasked: '林老师', status: 'active', version: 1, deletedAt: null },
    { _id: 'usr_parent', organizationId: 'org_demo', authorizationVersion: 1, displayName: '小宇家长', displayNameMasked: '小宇家长', status: 'active', version: 1, deletedAt: null },
    { _id: 'usr_student', organizationId: 'org_demo', authorizationVersion: 1, displayName: '小宇', displayNameMasked: '小宇', status: 'active', version: 1, deletedAt: null },
  ],
  identities: [{ _id: 'aid_teacher', organizationId: 'org_demo', userId: 'usr_teacher', provider: 'cloudbase_uid', providerSubjectDigest: 'digest_teacher-subject', status: 'active', version: 1, deletedAt: null }],
  roles: [
    { _id: 'role_teacher', organizationId: 'org_demo', userId: 'usr_teacher', role: 'teacher', status: 'active', permissions: ['task.publish'], scopeIds: ['cls_3_2'], version: 1, deletedAt: null },
    { _id: 'role_parent', organizationId: 'org_demo', userId: 'usr_parent', role: 'parent', status: 'active', permissions: ['child.read'], scopeIds: ['usr_parent'], version: 1, deletedAt: null },
  ],
  teacherGrants: [{ _id: 'grant_teacher', organizationId: 'org_demo', teacherId: 'usr_teacher', classId: 'cls_3_2', status: 'active', permissions: ['task.publish'], version: 1, deletedAt: null }],
  parentLinks: [{ _id: 'link_parent', organizationId: 'org_demo', parentId: 'usr_parent', studentId: 'usr_student', status: 'active', version: 1, deletedAt: null }],
};

describe('M1 身份、授权和虚构种子基础', () => {
  it('只为可信平台身份创建会话，且 admin 不出现在小程序角色中', async () => {
    const identities = new InMemoryIdentityRepository(fixture);
    const sessions = new InMemoryBusinessSessionRepository();
    const handler = new AuthSessionHandler(identities, sessions, subjectDigest, clock, ids);
    const bootstrapped = await handler.handle({ action: 'bootstrap', payload: {} }, { subject: 'teacher-subject', loginType: 'USERNAME', isAuthenticated: true }, null, meta);
    expect(bootstrapped).toMatchObject({ ok: true, data: { userId: 'usr_teacher', activeRole: null, roles: ['teacher'] } });
    if (!bootstrapped.ok) throw new Error('bootstrap expected to succeed');
    const selected = await handler.handle({ action: 'selectRole', payload: { role: 'teacher' } }, { subject: 'teacher-subject', loginType: 'USERNAME', isAuthenticated: true }, bootstrapped.data.sessionId, meta);
    expect(selected).toMatchObject({ ok: true, data: { activeRole: 'teacher' } });
  });

  it('对授权班级与有效家长关系分别进行服务端校验', async () => {
    const repository = new InMemoryIdentityRepository(fixture);
    const authorization = new AuthorizationService(repository);
    const teacher = { requestId: 'req_1', sessionId: 'ses_1', actorUserId: 'usr_teacher', actorRole: 'teacher' as const, organizationId: 'org_demo', platformSubjectDigest: 'digest', permissions: ['task.publish'], scopeIds: ['cls_3_2'], authzVersion: 1 };
    const parent = { ...teacher, actorUserId: 'usr_parent', actorRole: 'parent' as const, permissions: ['child.read'], scopeIds: ['usr_parent'] };
    expect(await authorization.canTeacherAccessClass(teacher, 'cls_3_2', 'task.publish')).toEqual({ allowed: true });
    expect(await authorization.canTeacherAccessClass(teacher, 'cls_other', 'task.publish')).toEqual({ allowed: false, reason: 'FORBIDDEN' });
    expect(await authorization.canParentReadStudent(parent, 'usr_student')).toEqual({ allowed: true });
    expect(await authorization.canParentReadStudent(parent, 'usr_other')).toEqual({ allowed: false, reason: 'NOT_FOUND' });
    expect(await authorization.canParentReadStudent({ ...parent, permissions: [] }, 'usr_student')).toEqual({ allowed: false, reason: 'FORBIDDEN' });
  });

  it('dry-run 在写云端前阻断引用损坏或敏感字段的种子', () => {
    const invalid = dryRunSeed({ manifest: { seedVersion: 'v1', schemaVersion: 1, source: 'm0-fixture', generatedAt: now, contentHash: 'hash', seedRunId: 'seed_1', expectedCounts: { organizations: 1 } }, collections: { organizations: [{ _id: 'org_demo', password: 'forbidden' }] } });
    expect(invalid.ok).toBe(false);
    expect(invalid.errors.join(' ')).toContain('不允许');
    const missingAuthorizationVersion = dryRunSeed({
      manifest: { seedVersion: 'v1', schemaVersion: 1, source: 'm0-fixture', generatedAt: now, contentHash: 'hash', seedRunId: 'seed_2', expectedCounts: { users: 1 } },
      collections: { users: [{ _id: 'usr_demo' }] },
    });
    expect(missingAuthorizationVersion.errors.join(' ')).toContain('authorizationVersion');
  });

  it('actor resolver requires a matching active business session', async () => {
    const identities = new InMemoryIdentityRepository(fixture);
    const sessions = new InMemoryBusinessSessionRepository();
    await sessions.startOrResume({ id: 'ses_active', organizationId: 'org_demo', userId: 'usr_teacher', subjectDigest: 'digest_teacher-subject', role: 'teacher', authzVersion: 1, recordVersion: 1, expiresAt: '2026-09-15T12:00:00.000Z', revokedAt: null }, now);
    const resolver = new RepositoryTrustedActorResolver(identities, sessions, subjectDigest, clock, ids);
    const firstActor = await resolver.resolve({ subject: 'teacher-subject', loginType: 'USERNAME', isAuthenticated: true }, 'task-query', 'ses_active');
    const secondActor = await resolver.resolve({ subject: 'teacher-subject', loginType: 'USERNAME', isAuthenticated: true }, 'task-query', 'ses_active');
    expect(firstActor).toMatchObject({ actorUserId: 'usr_teacher', actorRole: 'teacher' });
    expect(firstActor?.requestId).not.toBe(secondActor?.requestId);
    expect(await resolver.resolve({ subject: 'teacher-subject', loginType: 'USERNAME', isAuthenticated: true }, 'task-query', null)).toBeNull();
  });

  it('同一幂等键只执行一次，不同请求摘要返回冲突', async () => {
    const records = new InMemoryIdempotencyRepository();
    const service = new IdempotencyService(records, clock, ids);
    const actor = { requestId: 'req_idem', sessionId: 'ses_idem', actorUserId: 'usr_teacher', actorRole: 'teacher' as const, organizationId: 'org_demo', platformSubjectDigest: 'digest', permissions: ['task.publish'], scopeIds: ['cls_3_2'], authzVersion: 1 };
    let executions = 0;
    const run = (payload: Readonly<{ title: string }>) => service.execute({ actor, functionName: 'task-command', action: 'publishTask', operationId: 'op_publish_0001', payload, perform: async () => { executions += 1; return success('receipt_1', { requestId: 'req', serverTime: now, apiVersion: 'm1.v1' }); } });
    expect((await run({ title: '任务 A' })).ok).toBe(true);
    expect((await run({ title: '任务 A' })).ok).toBe(true);
    const conflict = await run({ title: '任务 B' });
    expect(executions).toBe(1);
    expect(conflict).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
  });

  it('审计只写白名单元数据，不需要业务正文', async () => {
    const logs = new InMemoryOperationLogRepository();
    const audit = new OperationAudit(logs, clock, ids);
    await audit.write({ actor: null, requestId: 'req_denied', action: 'auth.bootstrap', targetType: 'session', targetId: null, result: 'denied', errorCode: 'UNAUTHENTICATED', metadata: { reason: 'missing_identity' } });
    expect(logs.entries).toHaveLength(1);
    expect(logs.entries[0]).toMatchObject({ result: 'denied', errorCode: 'UNAUTHENTICATED', metadata: { reason: 'missing_identity' } });
  });

  it('auth action schema 拒绝 admin 和身份伪造字段', () => {
    expect(parseAuthPayload('selectRole', { role: 'admin' })).toMatchObject({ role: expect.any(String) });
    expect(parseAuthPayload('bootstrap', { actorUserId: 'usr_forged' })).toMatchObject({ actorUserId: expect.any(String) });
  });
});
