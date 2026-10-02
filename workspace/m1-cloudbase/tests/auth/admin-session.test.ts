import { describe, expect, it } from 'vitest';
import { createAdminSessionFunction } from '../../functions/admin-session/function-entry';
import { createOrganizationAdminFunction, type OrganizationAdminHandler } from '../../functions/organization-admin/function-entry';
import { RepositoryTrustedActorResolver } from '../../src/auth/actor-resolver';
import { AdminSessionHandler } from '../../src/auth/admin-session-handler';
import { AuthSessionHandler } from '../../src/auth/auth-session-handler';
import { createCloudBaseRuntimeAdapter } from '../../src/runtime/cloudbase-runtime-adapter';
import { InMemoryBusinessSessionRepository, InMemoryIdentityRepository, type AuthorizationFixture } from '../../src/runtime/memory-ports';
import { createNodeCryptoCapabilities, type NodeCryptoSecrets } from '../../src/runtime/node-crypto-capabilities';
import { DocumentDatabasePlatformError } from '../../src/repositories/document-database-port';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import { StudentWorkAdminService } from '../../src/student-work/admin-service';
import type { BusinessSessionRepository } from '../../src/runtime/ports';
import type { RoleAssignmentRecord, UserRecord } from '../../src/runtime/records';

const SECRETS: NodeCryptoSecrets = {
  subjectPepper: 'xLZ7Jfj7ZK7LnJboPz9Dxmx_eZoFluu0GP41XIlNexg',
  cursorSigningKey: 'OT8k4PnWA7uAhuYjuwKZ-YRTScyXBqT-TrY8lajrQFo',
  batchReviewSigningKey: 'sUoMvbbbt15vCssMUucx__5Mxiw6KJ4VW9DPsu556zw',
  businessSessionEncryptionKey: 'ZiNCgxJRwwC2qvCFDR6Qi8FRp_tfvTHJMtHTw6qf5OM',
  bindingCodeDerivationKey: '8UNshhTqqghCVaTK-eguMzHeliVfP4NFd7DpqgxZJ_s',
  bindingCodePepper: 'KE_5Tyfgmss5dUoMVvyTeRMCy3cic32iyaEA9yXdVcw',
};

const SUBJECT = 'cloudbase:username:admin-uid-demo';
const PLATFORM_IDENTITY = { subject: SUBJECT, loginType: 'USERNAME' as const, isAuthenticated: true };

describe('独立管理后台服务端会话', () => {
  it('签发独立 audience 的短时会话，并支持复核、刷新和退出', async () => {
    const harness = createHarness();
    const bootstrapped = await harness.handler.handle(
      { action: 'bootstrap' },
      PLATFORM_IDENTITY,
      null,
      harness.meta('bootstrap'),
    );
    expect(bootstrapped).toMatchObject({
      ok: true,
      data: {
        audience: 'admin-console',
        token: expect.stringMatching(/^as1\./),
        expiresAt: '2026-09-17T02:00:00.000Z',
      },
    });
    if (!bootstrapped.ok || bootstrapped.data === null) throw new Error('admin bootstrap expected');
    expect(Object.keys(bootstrapped.data).sort()).toEqual(['audience', 'expiresAt', 'token']);
    const token = bootstrapped.data.token;
    const sessionId = harness.crypto.businessSession.getBusinessSessionId(token, 'admin-console');
    expect(sessionId).toMatch(/^admin_ses_/);
    expect(harness.crypto.businessSession.getBusinessSessionId(token, 'mini-program')).toBeNull();

    await expect(harness.handler.handle(
      { action: 'getCurrentSession' }, PLATFORM_IDENTITY, sessionId, harness.meta('current'),
    )).resolves.toMatchObject({ ok: true, data: { audience: 'admin-console' } });

    harness.setNow('2026-09-17T01:00:00.000Z');
    const refreshed = await harness.handler.handle(
      { action: 'refresh' }, PLATFORM_IDENTITY, sessionId, harness.meta('refresh'),
    );
    expect(refreshed).toMatchObject({ ok: true, data: { expiresAt: '2026-09-17T03:00:00.000Z' } });

    expect(await harness.handler.handle(
      { action: 'logout', operationId: 'operation_admin_logout_001' },
      PLATFORM_IDENTITY,
      sessionId,
      harness.meta('logout'),
    )).toMatchObject({ ok: true, data: null });
    expect(await harness.handler.handle(
      { action: 'getCurrentSession' }, PLATFORM_IDENTITY, sessionId, harness.meta('after_logout'),
    )).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
  });

  it('用户停用、管理员撤权、授权版本变化和过期会话均失败关闭', async () => {
    const base = createHarness();
    const bootstrap = await base.handler.handle(
      { action: 'bootstrap' }, PLATFORM_IDENTITY, null, base.meta('bootstrap'),
    );
    if (!bootstrap.ok || bootstrap.data === null) throw new Error('admin bootstrap expected');
    const sessionId = base.crypto.businessSession.getBusinessSessionId(bootstrap.data.token, 'admin-console');
    if (sessionId === null) throw new Error('admin session id expected');

    const revokedRoles: RoleAssignmentRecord[] = base.fixture.roles.map((role) => (
      role.role === 'admin' ? { ...role, status: 'revoked' as const } : role
    ));
    expect(await base.handlerFor({ ...base.fixture, roles: revokedRoles }).handle(
      { action: 'getCurrentSession' }, PLATFORM_IDENTITY, sessionId, base.meta('revoked'),
    )).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });

    const disabledUsers: UserRecord[] = base.fixture.users.map((user) => ({ ...user, status: 'disabled' as const }));
    expect(await base.handlerFor({ ...base.fixture, users: disabledUsers }).handle(
      { action: 'getCurrentSession' }, PLATFORM_IDENTITY, sessionId, base.meta('disabled'),
    )).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });

    const changedUsers: UserRecord[] = base.fixture.users.map((user) => ({ ...user, authorizationVersion: 8 }));
    expect(await base.handlerFor({ ...base.fixture, users: changedUsers }).handle(
      { action: 'getCurrentSession' }, PLATFORM_IDENTITY, sessionId, base.meta('changed'),
    )).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });

    base.setNow('2026-09-17T02:00:00.000Z');
    expect(await base.handler.handle(
      { action: 'getCurrentSession' }, PLATFORM_IDENTITY, sessionId, base.meta('expired'),
    )).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
  });

  it('管理员角色不进入小程序角色列表，也不能由 selectRole 选择', async () => {
    const harness = createHarness();
    const miniHandler = new AuthSessionHandler(
      harness.identities,
      harness.sessions,
      harness.crypto.subjectDigest,
      harness.clock,
      harness.crypto.identifiers,
      harness.crypto.businessSession,
    );
    const bootstrap = await miniHandler.handle(
      { action: 'bootstrap', payload: {} }, PLATFORM_IDENTITY, null, harness.meta('mini_bootstrap'),
    );
    expect(bootstrap).toMatchObject({ ok: true, data: { roles: ['teacher'], activeRole: null } });
  });

  it('接受 admin-console transport 的 organization-admin 信封并拒绝小程序 token', async () => {
    const harness = createHarness();
    const adminSession = createAdminSessionFunction({
      runtime: createRuntime('admin-session', harness, null),
      handler: harness.handler,
      clock: harness.clock,
      requestIds: { next: () => 'req_admin_session_entry' },
    });
    const bootstrap = await adminSession({ apiVersion: 'm1.v1', action: 'bootstrap', payload: {} });
    if (!bootstrap.ok || bootstrap.data === null) throw new Error('admin bootstrap expected');

    const adminRuntime = createRuntime('organization-admin', harness, bootstrap.data.token);
    const adminMain = createOrganizationAdminFunction({
      runtime: adminRuntime,
      actorResolver: new RepositoryTrustedActorResolver(
        harness.identities,
        harness.sessions,
        harness.crypto.subjectDigest,
        harness.clock,
        { next: () => 'req_organization_admin_actor' },
      ),
      clock: harness.clock,
      requestIds: { next: () => 'req_organization_admin' },
      handler: organizationHandler(),
      studentWorks: new StudentWorkAdminService(new FakeDocumentDatabase(), harness.clock),
    });

    expect(await adminMain({
      apiVersion: 'm1.v1',
      action: 'listClasses',
      payload: {},
      businessSessionToken: bootstrap.data.token,
    })).toMatchObject({ ok: true, data: [{ id: 'cls_demo', name: '三年级 2 班' }] });
    expect(await adminMain({ apiVersion: 'm1.v1', action: 'listDeletedWorkDrafts',
      payload: { studentId: 'student_demo', page: { limit: 20, offset: 0 } },
      businessSessionToken: bootstrap.data.token })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });

    const privilegedIdentities = new InMemoryIdentityRepository({ ...harness.fixture,
      roles: harness.fixture.roles.map(role => role.role === 'admin'
        ? { ...role, permissions: [...role.permissions, 'student_work.restore'] } : role) });
    const privilegedMain = createOrganizationAdminFunction({
      runtime: adminRuntime,
      actorResolver: new RepositoryTrustedActorResolver(privilegedIdentities, harness.sessions,
        harness.crypto.subjectDigest, harness.clock, { next: () => 'req_restore_actor' }),
      clock: harness.clock, requestIds: { next: () => 'req_restore_result' },
      handler: organizationHandler(),
      studentWorks: new StudentWorkAdminService(new FakeDocumentDatabase(), harness.clock),
    });
    expect(await privilegedMain({ apiVersion: 'm1.v1', action: 'listDeletedWorkDrafts',
      payload: { studentId: 'student_demo', page: { limit: 20, offset: 0 } },
      businessSessionToken: bootstrap.data.token })).toMatchObject({ ok: true,
      data: { items: [], nextOffset: null } });

    const miniSessionId = 'ses_0123456789abcdef0123456789abcdef';
    await harness.sessions.startOrResume({
      id: miniSessionId,
      organizationId: 'org_demo',
      userId: 'usr_admin',
      subjectDigest: harness.crypto.subjectDigest.digest(SUBJECT),
      audience: 'mini-program',
      role: 'teacher',
      authzVersion: 7,
      recordVersion: 1,
      expiresAt: '2026-09-17T02:00:00.000Z',
      revokedAt: null,
    }, harness.clock.nowIso());
    const miniToken = harness.crypto.businessSession.issueBusinessSessionToken(
      miniSessionId,
      '2026-09-17T02:00:00.000Z',
      'mini-program',
    );
    const miniMain = createOrganizationAdminFunction({
      runtime: createRuntime('organization-admin', harness, miniToken),
      actorResolver: new RepositoryTrustedActorResolver(
        harness.identities, harness.sessions, harness.crypto.subjectDigest, harness.clock,
        { next: () => 'req_mini_actor' },
      ),
      clock: harness.clock,
      requestIds: { next: () => 'req_mini_transport' },
      handler: organizationHandler(),
      studentWorks: new StudentWorkAdminService(new FakeDocumentDatabase(), harness.clock),
    });
    expect(await miniMain({
      apiVersion: 'm1.v1', action: 'listClasses', payload: {}, businessSessionToken: miniToken,
    })).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
    expect(await miniMain({ apiVersion: 'm1.v1', action: 'listDeletedWorkDrafts',
      payload: { studentId: 'student_demo', page: { limit: 20, offset: 0 } },
      businessSessionToken: miniToken })).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
  });

  it.each([
    ['unavailable', 'SERVICE_UNAVAILABLE'],
    ['conflict', 'CONFLICT'],
    ['invalid-data', 'VALIDATION_ERROR'],
  ] as const)('将管理员会话的 %s 文档库故障映射为 %s', async (kind, expectedCode) => {
    const harness = createHarness();
    const sessions: BusinessSessionRepository = {
      startOrResume: async () => {
        throw new DocumentDatabasePlatformError(kind, 'test-only persistence failure');
      },
      find: async () => null,
      replace: async () => false,
    };
    const handler = new AdminSessionHandler(
      harness.identities,
      sessions,
      harness.crypto.subjectDigest,
      harness.clock,
      harness.crypto.identifiers,
      harness.crypto.businessSession,
    );
    const main = createAdminSessionFunction({
      runtime: createRuntime('admin-session', harness, null),
      handler,
      clock: harness.clock,
      requestIds: { next: () => 'req_admin_persistence_failure' },
    });

    await expect(main({ apiVersion: 'm1.v1', action: 'bootstrap', payload: {} })).resolves.toMatchObject({
      ok: false,
      error: { code: expectedCode },
    });
  });

  it('管理员 bootstrap 遇到一次会话事务冲突后重试并成功', async () => {
    const harness = createHarness();
    const stableSessions = new InMemoryBusinessSessionRepository();
    let starts = 0;
    const sessions: BusinessSessionRepository = {
      startOrResume: async (candidate, now) => {
        starts += 1;
        if (starts === 1) throw new DocumentDatabasePlatformError('conflict', 'test-only conflict');
        return stableSessions.startOrResume(candidate, now);
      },
      find: (sessionId) => stableSessions.find(sessionId),
      replace: (session, expectedVersion) => stableSessions.replace(session, expectedVersion),
    };
    const handler = new AdminSessionHandler(
      harness.identities,
      sessions,
      harness.crypto.subjectDigest,
      harness.clock,
      harness.crypto.identifiers,
      harness.crypto.businessSession,
    );

    await expect(handler.handle(
      { action: 'bootstrap' },
      PLATFORM_IDENTITY,
      null,
      harness.meta('bootstrap_retry'),
    )).resolves.toMatchObject({ ok: true, data: { audience: 'admin-console' } });
    expect(starts).toBe(2);
  });
});

function createHarness() {
  let now = '2026-09-17T00:00:00.000Z';
  const clock = { nowIso: () => now };
  const crypto = createNodeCryptoCapabilities({ secrets: SECRETS, clock });
  const fixture: AuthorizationFixture = {
    organizations: [{
      _id: 'org_demo', organizationId: 'org_demo', name: '启航实验学校', status: 'active',
      timeZone: 'Asia/Shanghai', version: 1, deletedAt: null,
    }],
    users: [{
      _id: 'usr_admin', organizationId: 'org_demo', authorizationVersion: 7,
      displayName: '周老师', displayNameMasked: '周老师', status: 'active', version: 1, deletedAt: null,
    }],
    identities: [{
      _id: 'identity_admin', organizationId: 'org_demo', userId: 'usr_admin', provider: 'cloudbase_uid',
      providerSubjectDigest: crypto.subjectDigest.digest(SUBJECT), status: 'active', version: 1, deletedAt: null,
    }],
    roles: [
      {
        _id: 'role_admin', organizationId: 'org_demo', userId: 'usr_admin', role: 'admin', status: 'active',
        permissions: ['organization.read', 'class.read'], scopeIds: ['org_demo'], version: 1, deletedAt: null,
      },
      {
        _id: 'role_teacher', organizationId: 'org_demo', userId: 'usr_admin', role: 'teacher', status: 'active',
        permissions: ['class.read'], scopeIds: ['cls_demo'], version: 1, deletedAt: null,
      },
    ],
    teacherGrants: [],
    parentLinks: [],
  };
  const sessions = new InMemoryBusinessSessionRepository();
  const identities = new InMemoryIdentityRepository(fixture);
  const handlerFor = (authorizationFixture: AuthorizationFixture) => new AdminSessionHandler(
    new InMemoryIdentityRepository(authorizationFixture), sessions, crypto.subjectDigest,
    clock, crypto.identifiers, crypto.businessSession,
  );
  return {
    fixture,
    sessions,
    identities,
    crypto,
    clock,
    handler: handlerFor(fixture),
    handlerFor,
    setNow: (value: string): void => { now = value; },
    meta: (suffix: string) => ({ requestId: `req_${suffix}`, serverTime: now, apiVersion: 'm1.v1' as const }),
  };
}

function createRuntime(
  functionName: 'admin-session' | 'organization-admin',
  harness: ReturnType<typeof createHarness>,
  token: string | null,
) {
  return createCloudBaseRuntimeAdapter({
    functionName,
    sdk: { getWXContext: () => ({ UID: 'admin-uid-demo' }) },
    businessSession: {
      getBusinessSessionId: (candidate, audience) => (
        candidate === token ? harness.crypto.businessSession.getBusinessSessionId(candidate, audience) : null
      ),
    },
  });
}

function organizationHandler(): OrganizationAdminHandler {
  const notCalled = async (): Promise<never> => { throw new Error('unexpected handler call'); };
  return {
    listClasses: async () => [{
      id: 'cls_demo', name: '三年级 2 班', grade: '三年级', term: '2026 秋季', status: 'active', version: 1,
    }],
    createClass: notCalled,
    updateClass: notCalled,
    disableClass: notCalled,
    listUsers: notCalled,
    createUser: notCalled,
    disableUser: notCalled,
    assignRole: notCalled,
    revokeRole: notCalled,
    grantTeacherClass: notCalled,
    revokeTeacherClass: notCalled,
  };
}
