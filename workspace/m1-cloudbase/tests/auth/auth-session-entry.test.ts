import { describe, expect, it } from 'vitest';
import { createAuthSessionFunction } from '../../functions/auth-session';
import { AuthSessionHandler } from '../../src/auth/auth-session-handler';
import { InMemoryBusinessSessionRepository, InMemoryIdentityRepository, type AuthorizationFixture } from '../../src/runtime/memory-ports';
import { createCloudBaseRuntimeAdapter, createOpaqueSessionIdSource } from '../../src/runtime/cloudbase-runtime-adapter';
import { DocumentDatabasePlatformError } from '../../src/repositories/document-database-port';
import type { BusinessSessionRepository, CloudBaseRuntimePort, IdentityRepository } from '../../src/runtime/ports';
import type { BusinessSessionRecord, RoleAssignmentRecord, UserRecord } from '../../src/runtime/records';

const now = '2026-09-16T00:00:00.000Z';
const clock = { nowIso: (): string => now };
const digest = { digest: (subject: string): string => `digest_${subject}` };

const fixture: AuthorizationFixture = {
  organizations: [{ _id: 'org_demo', organizationId: 'org_demo', name: '启航实验学校', status: 'active', timeZone: 'Asia/Shanghai', version: 1, deletedAt: null }],
  users: [{ _id: 'usr_teacher', organizationId: 'org_demo', authorizationVersion: 1, displayName: '林老师', displayNameMasked: '林老师', status: 'active', version: 1, deletedAt: null }],
  identities: [{ _id: 'aid_teacher', organizationId: 'org_demo', userId: 'usr_teacher', provider: 'cloudbase_uid', providerSubjectDigest: 'digest_trusted-subject', status: 'active', version: 1, deletedAt: null }],
  roles: [
    { _id: 'role_teacher', organizationId: 'org_demo', userId: 'usr_teacher', role: 'teacher', status: 'active', permissions: ['task.publish'], scopeIds: ['cls_3_2'], version: 1, deletedAt: null },
    { _id: 'role_admin', organizationId: 'org_demo', userId: 'usr_teacher', role: 'admin', status: 'active', permissions: ['organization.manage'], scopeIds: ['org_demo'], version: 1, deletedAt: null },
  ],
  teacherGrants: [],
  parentLinks: [],
};

function createHarness(subject = 'trusted-subject', authorizationFixture: AuthorizationFixture = fixture) {
  let sessionId: string | null = null;
  let sessionSequence = 0;
  let requestSequence = 0;
  const sessions = new InMemoryBusinessSessionRepository();
  const handler = new AuthSessionHandler(
    new InMemoryIdentityRepository(authorizationFixture),
    sessions,
    digest,
    clock,
    { next: (prefix: string): string => `${prefix}_${++sessionSequence}` },
  );
  const runtime: CloudBaseRuntimePort = {
    functionName: 'auth-session',
    getPlatformSubject: async () => ({ subject, loginType: 'USERNAME', isAuthenticated: true }),
    getBusinessSessionId: async () => sessionId,
  };
  const main = createAuthSessionFunction({
    runtime,
    handler,
    clock,
    requestIds: { next: (): string => `req_auth_${++requestSequence}` },
  });
  return { main, setSessionId: (value: string | null): void => { sessionId = value; } };
}

describe('auth-session 可注入本地函数入口', () => {
  it('uses an envelope token for bootstrap, role selection, current session, and revocation', async () => {
    const sessions = new InMemoryBusinessSessionRepository();
    let sessionSequence = 0;
    const platformFixture: AuthorizationFixture = {
      ...fixture,
      identities: [{
        ...fixture.identities[0],
        providerSubjectDigest: 'digest_cloudbase:username:trusted-subject',
      }],
    };
    const runtime = createCloudBaseRuntimeAdapter({
      functionName: 'auth-session',
      sdk: { getWXContext: () => ({ UID: 'trusted-subject' }) },
      businessSession: createOpaqueSessionIdSource(),
    });
    const main = createAuthSessionFunction({
      runtime,
      handler: new AuthSessionHandler(
        new InMemoryIdentityRepository(platformFixture), sessions, digest, clock,
        { next: prefix => `${prefix}_native_${++sessionSequence}` },
      ),
      clock,
      requestIds: { next: () => `req_native_${sessionSequence}` },
    });

    const bootstrap = await main({ apiVersion: 'm1.v1', action: 'bootstrap', payload: {} });
    if (!bootstrap.ok || !isSessionView(bootstrap.data)) throw new Error('bootstrap expected to succeed');
    const token = bootstrap.data.sessionId;
    expect(await main({
      apiVersion: 'm1.v1', action: 'selectRole', payload: { role: 'teacher' }, businessSessionToken: token,
    })).toMatchObject({ ok: true, data: { activeRole: 'teacher' } });
    expect(await main({
      apiVersion: 'm1.v1', action: 'getCurrentSession', payload: {}, businessSessionToken: token,
    })).toMatchObject({ ok: true, data: { sessionId: token, activeRole: 'teacher' } });
    expect(await main({
      apiVersion: 'm1.v1', action: 'logout', payload: {}, businessSessionToken: token, operationId: 'op_logout_native_0001',
    })).toMatchObject({ ok: true, data: null });
    expect(await main({
      apiVersion: 'm1.v1', action: 'getCurrentSession', payload: {}, businessSessionToken: token,
    })).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
  });

  it('仅使用 runtime 身份和 session，并为每次调用生成唯一 requestId', async () => {
    const harness = createHarness();
    const forged = await harness.main({
      apiVersion: 'm1.v1', action: 'bootstrap', payload: { actorUserId: 'usr_forged' },
    });
    expect(forged).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' }, meta: { requestId: 'req_auth_1' } });

    const first = await harness.main({ apiVersion: 'm1.v1', action: 'bootstrap', payload: {} });
    expect(first).toMatchObject({
      ok: true,
      data: { userId: 'usr_teacher', activeRole: null, roles: ['teacher'] },
      meta: { requestId: 'req_auth_2' },
    });
    if (!first.ok || !isSessionView(first.data)) throw new Error('bootstrap expected to succeed');
    harness.setSessionId(first.data.sessionId);

    const selected = await harness.main({ apiVersion: 'm1.v1', action: 'selectRole', payload: { role: 'teacher' } });
    expect(selected).toMatchObject({ ok: true, data: { activeRole: 'teacher' }, meta: { requestId: 'req_auth_3' } });
    expect(selected.meta.requestId).not.toBe(first.meta.requestId);
  });

  it('bootstrap 重试复用活动会话，logout 重试稳定，退出后再创建新会话', async () => {
    const harness = createHarness();
    const first = await harness.main({ apiVersion: 'm1.v1', action: 'bootstrap', payload: {} });
    const retry = await harness.main({ apiVersion: 'm1.v1', action: 'bootstrap', payload: {} });
    if (!first.ok || !retry.ok || !isSessionView(first.data) || !isSessionView(retry.data)) throw new Error('bootstrap expected to succeed');
    expect(retry.data.sessionId).toBe(first.data.sessionId);
    harness.setSessionId(first.data.sessionId);

    expect(await harness.main({ apiVersion: 'm1.v1', action: 'logout', payload: {} })).toMatchObject({
      ok: false, error: { code: 'VALIDATION_ERROR', fieldErrors: { operationId: expect.any(String) } },
    });
    expect(await harness.main({ apiVersion: 'm1.v1', action: 'logout', payload: {}, operationId: 'op_logout_0001' })).toMatchObject({ ok: true, data: null });
    expect(await harness.main({ apiVersion: 'm1.v1', action: 'logout', payload: {}, operationId: 'op_logout_0001' })).toMatchObject({ ok: true, data: null });

    harness.setSessionId(null);
    const afterLogout = await harness.main({ apiVersion: 'm1.v1', action: 'bootstrap', payload: {} });
    if (!afterLogout.ok || !isSessionView(afterLogout.data)) throw new Error('bootstrap expected to succeed');
    expect(afterLogout.data.sessionId).not.toBe(first.data.sessionId);
  });

  it('bootstrap 遇到一次会话事务冲突后重试并成功', async () => {
    const stableSessions = new InMemoryBusinessSessionRepository();
    let starts = 0;
    const sessions: BusinessSessionRepository = {
      startOrResume: async (candidate, startedAt) => {
        starts += 1;
        if (starts === 1) throw new DocumentDatabasePlatformError('conflict', 'test-only conflict');
        return stableSessions.startOrResume(candidate, startedAt);
      },
      find: (sessionId) => stableSessions.find(sessionId),
      replace: (session, expectedVersion) => stableSessions.replace(session, expectedVersion),
    };
    const handler = new AuthSessionHandler(
      new InMemoryIdentityRepository(fixture),
      sessions,
      digest,
      clock,
      { next: (prefix: string): string => `${prefix}_retry` },
    );

    await expect(handler.handle(
      { action: 'bootstrap', payload: {} },
      { subject: 'trusted-subject', loginType: 'USERNAME', isAuthenticated: true },
      null,
      { requestId: 'req_bootstrap_retry', serverTime: now, apiVersion: 'm1.v1' },
    )).resolves.toMatchObject({ ok: true, data: { activeRole: null, roles: ['teacher'] } });
    expect(starts).toBe(2);
  });

  it('bootstrap 遇到一次身份解析事务冲突后重试并成功', async () => {
    const stableIdentities = new InMemoryIdentityRepository(fixture);
    let identityReads = 0;
    const identities: IdentityRepository = {
      findIdentityByDigest: async (digestValue) => {
        identityReads += 1;
        if (identityReads === 1) throw new DocumentDatabasePlatformError('conflict', 'test-only conflict');
        return stableIdentities.findIdentityByDigest(digestValue);
      },
      findUser: (userId, organizationId) => stableIdentities.findUser(userId, organizationId),
      findOrganization: (organizationId) => stableIdentities.findOrganization(organizationId),
      listActiveRoles: (userId, organizationId) => stableIdentities.listActiveRoles(userId, organizationId),
      findActiveTeacherGrant: (organizationId, teacherId, classId) => stableIdentities.findActiveTeacherGrant(organizationId, teacherId, classId),
      findActiveParentLink: (organizationId, parentId, studentId) => stableIdentities.findActiveParentLink(organizationId, parentId, studentId),
      listActiveParentLinks: (organizationId, parentId) => stableIdentities.listActiveParentLinks(organizationId, parentId),
    };
    const handler = new AuthSessionHandler(
      identities,
      new InMemoryBusinessSessionRepository(),
      digest,
      clock,
      { next: (prefix: string): string => `${prefix}_identity_retry` },
    );

    await expect(handler.handle(
      { action: 'bootstrap', payload: {} },
      { subject: 'trusted-subject', loginType: 'USERNAME', isAuthenticated: true },
      null,
      { requestId: 'req_identity_retry', serverTime: now, apiVersion: 'm1.v1' },
    )).resolves.toMatchObject({ ok: true, data: { activeRole: null, roles: ['teacher'] } });
    expect(identityReads).toBe(2);
  });

  it('角色列表异常变化时仍不会保留已经撤销的当前角色', async () => {
    const roles: RoleAssignmentRecord[] = [
      { _id: 'role_teacher', organizationId: 'org_demo', userId: 'usr_teacher', role: 'teacher', status: 'active', permissions: ['task.publish'], scopeIds: ['cls_3_2'], version: 1, deletedAt: null },
      { _id: 'role_parent', organizationId: 'org_demo', userId: 'usr_teacher', role: 'parent', status: 'active', permissions: ['child.read'], scopeIds: ['usr_teacher'], version: 1, deletedAt: null },
    ];
    const harness = createHarness('trusted-subject', { ...fixture, roles });
    const bootstrap = await harness.main({ apiVersion: 'm1.v1', action: 'bootstrap', payload: {} });
    if (!bootstrap.ok || !isSessionView(bootstrap.data)) throw new Error('bootstrap expected to succeed');
    harness.setSessionId(bootstrap.data.sessionId);
    expect(await harness.main({ apiVersion: 'm1.v1', action: 'selectRole', payload: { role: 'teacher' } })).toMatchObject({ ok: true, data: { activeRole: 'teacher' } });

    roles[0] = { ...roles[0], status: 'revoked' };
    expect(await harness.main({ apiVersion: 'm1.v1', action: 'getCurrentSession', payload: {} })).toMatchObject({
      ok: true,
      data: { activeRole: null, roles: ['parent'] },
    });
  });

  it('bootstrap、selectRole 和当前会话只绑定用户级 authorizationVersion', async () => {
    const users: UserRecord[] = [{ ...fixture.users[0], authorizationVersion: 7 }];
    const roles: RoleAssignmentRecord[] = [
      { ...fixture.roles[0], version: 2 },
      {
        _id: 'role_parent', organizationId: 'org_demo', userId: 'usr_teacher', role: 'parent',
        status: 'active', permissions: ['child.read'], scopeIds: ['usr_teacher'], version: 99, deletedAt: null,
      },
    ];
    const sessions = new InMemoryBusinessSessionRepository();
    const handler = new AuthSessionHandler(
      new InMemoryIdentityRepository({ ...fixture, users, roles }), sessions, digest, clock,
      { next: () => 'session_user_authz' },
    );
    const identity = { subject: 'trusted-subject', loginType: 'USERNAME' as const, isAuthenticated: true };
    const bootstrap = await handler.handle(
      { action: 'bootstrap', payload: {} }, identity, null,
      { requestId: 'request_user_authz_bootstrap', serverTime: now, apiVersion: 'm1.v1' },
    );
    if (!bootstrap.ok || !isSessionView(bootstrap.data)) throw new Error('bootstrap expected to succeed');
    await expect(sessions.find(bootstrap.data.sessionId)).resolves.toMatchObject({ authzVersion: 7 });

    roles[0] = { ...roles[0], version: 150 };
    await expect(handler.handle(
      { action: 'selectRole', payload: { role: 'teacher' } }, identity, bootstrap.data.sessionId,
      { requestId: 'request_user_authz_select', serverTime: now, apiVersion: 'm1.v1' },
    )).resolves.toMatchObject({ ok: true, data: { activeRole: 'teacher' } });

    users[0] = { ...users[0], authorizationVersion: 8 };
    await expect(handler.handle(
      { action: 'getCurrentSession', payload: {} }, identity, bootstrap.data.sessionId,
      { requestId: 'request_user_authz_current', serverTime: now, apiVersion: 'm1.v1' },
    )).resolves.toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
  });

  it('logout 提交撤销后，迟到的 selectRole CAS 失败且不能复活会话', async () => {
    const sessions = new PausingBusinessSessionRepository(new InMemoryBusinessSessionRepository());
    let sessionSequence = 0;
    const handler = new AuthSessionHandler(
      new InMemoryIdentityRepository(fixture), sessions, digest, clock,
      { next: (prefix: string): string => `${prefix}_race_${++sessionSequence}` },
    );
    const identity = { subject: 'trusted-subject', loginType: 'USERNAME' as const, isAuthenticated: true };
    const bootstrap = await handler.handle(
      { action: 'bootstrap', payload: {} }, identity, null,
      { requestId: 'req_race_bootstrap', serverTime: now, apiVersion: 'm1.v1' },
    );
    if (!bootstrap.ok || !isSessionView(bootstrap.data)) throw new Error('bootstrap expected to succeed');

    const selectReachedCas = sessions.pauseNextReplace();
    const selectRole = handler.handle(
      { action: 'selectRole', payload: { role: 'teacher' } }, identity, bootstrap.data.sessionId,
      { requestId: 'req_race_select', serverTime: now, apiVersion: 'm1.v1' },
    );
    await selectReachedCas;

    const logout = await handler.handle(
      { action: 'logout', payload: {} }, identity, bootstrap.data.sessionId,
      { requestId: 'req_race_logout', serverTime: now, apiVersion: 'm1.v1' },
    );
    expect(logout).toMatchObject({ ok: true, data: null });
    sessions.resumeReplace();

    expect(await selectRole).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect(await sessions.find(bootstrap.data.sessionId)).toMatchObject({ revokedAt: now, role: null, recordVersion: 2 });
  });

  it('拒绝顶层未知字段、未知平台身份和无业务映射的已认证主体', async () => {
    const harness = createHarness();
    expect(await harness.main({ apiVersion: 'm1.v1', action: 'bootstrap', payload: {}, sessionId: 'ses_forged' })).toMatchObject({
      ok: false, error: { code: 'VALIDATION_ERROR', fieldErrors: { sessionId: expect.any(String) } },
    });

    const unknownLoginRuntime: CloudBaseRuntimePort = {
      functionName: 'auth-session',
      getPlatformSubject: async () => ({ subject: 'trusted-subject', loginType: 'UNKNOWN', isAuthenticated: true }),
      getBusinessSessionId: async () => null,
    };
    const handler = new AuthSessionHandler(new InMemoryIdentityRepository(fixture), new InMemoryBusinessSessionRepository(), digest, clock, { next: () => 'ses_unused' });
    const unknownLogin = createAuthSessionFunction({ runtime: unknownLoginRuntime, handler, clock, requestIds: { next: () => 'req_unknown_login' } });
    expect(await unknownLogin({ apiVersion: 'm1.v1', action: 'bootstrap', payload: {} })).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });

    const unmapped = createHarness('not-mapped');
    expect(await unmapped.main({ apiVersion: 'm1.v1', action: 'bootstrap', payload: {} })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });

  it('将 runtime 与 handler 异常映射为安全错误，不回传原始异常', async () => {
    const sessions = new InMemoryBusinessSessionRepository();
    const handler = new AuthSessionHandler(new InMemoryIdentityRepository(fixture), sessions, digest, clock, { next: () => 'ses_unused' });
    const brokenRuntime: CloudBaseRuntimePort = {
      functionName: 'auth-session',
      getPlatformSubject: async () => { throw new Error('sensitive runtime detail'); },
      getBusinessSessionId: async () => null,
    };
    const runtimeFailure = createAuthSessionFunction({ runtime: brokenRuntime, handler, clock, requestIds: { next: () => 'req_runtime_error' } });
    const runtimeResult = await runtimeFailure({ apiVersion: 'm1.v1', action: 'bootstrap', payload: {} });
    expect(runtimeResult).toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE', retryable: true } });
    expect(JSON.stringify(runtimeResult)).not.toContain('sensitive runtime detail');

    const throwingHandler = new AuthSessionHandler(
      new InMemoryIdentityRepository(fixture), sessions,
      { digest: () => { throw new Error('sensitive repository detail'); } },
      clock,
      { next: () => 'ses_unused' },
    );
    const goodRuntime: CloudBaseRuntimePort = {
      functionName: 'auth-session',
      getPlatformSubject: async () => ({ subject: 'trusted-subject', loginType: 'USERNAME', isAuthenticated: true }),
      getBusinessSessionId: async () => null,
    };
    const handlerFailure = createAuthSessionFunction({ runtime: goodRuntime, handler: throwingHandler, clock, requestIds: { next: () => 'req_handler_error' } });
    const handlerResult = await handlerFailure({ apiVersion: 'm1.v1', action: 'bootstrap', payload: {} });
    expect(handlerResult).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR', retryable: true } });
    expect(JSON.stringify(handlerResult)).not.toContain('sensitive repository detail');
  });
});

function isSessionView(value: unknown): value is Readonly<{ sessionId: string }> {
  return typeof value === 'object' && value !== null && 'sessionId' in value && typeof value.sessionId === 'string';
}

class PausingBusinessSessionRepository implements BusinessSessionRepository {
  private pauseArmed = false;
  private replaceReached: Promise<void> = Promise.resolve();
  private releaseReplace: Promise<void> = Promise.resolve();
  private signalReached: (() => void) | null = null;
  private signalRelease: (() => void) | null = null;

  public constructor(private readonly delegate: BusinessSessionRepository) {}

  public pauseNextReplace(): Promise<void> {
    this.pauseArmed = true;
    this.replaceReached = new Promise<void>((resolve) => { this.signalReached = resolve; });
    this.releaseReplace = new Promise<void>((resolve) => { this.signalRelease = resolve; });
    return this.replaceReached;
  }

  public resumeReplace(): void {
    this.signalRelease?.();
  }

  public startOrResume(session: BusinessSessionRecord, nowIso: string): Promise<BusinessSessionRecord> {
    return this.delegate.startOrResume(session, nowIso);
  }

  public find(sessionId: string): Promise<BusinessSessionRecord | null> {
    return this.delegate.find(sessionId);
  }

  public async replace(session: BusinessSessionRecord, expectedRecordVersion: number): Promise<boolean> {
    if (this.pauseArmed) {
      this.pauseArmed = false;
      this.signalReached?.();
      await this.releaseReplace;
    }
    return this.delegate.replace(session, expectedRecordVersion);
  }
}
