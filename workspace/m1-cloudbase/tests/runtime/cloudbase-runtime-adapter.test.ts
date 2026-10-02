import { describe, expect, it } from 'vitest';
import { InMemoryBusinessSessionRepository, InMemoryIdentityRepository } from '../../src/runtime/memory-ports';
import {
  createCloudBaseRuntimeAdapter,
  type CloudBasePlatformContext,
} from '../../src/runtime/cloudbase-runtime-adapter';
import {
  createCloudBaseLearningProgressFunctionInfrastructure,
  createCloudBaseTaskCoreFunctionInfrastructure,
  createCloudBaseTaskQueryFunctionInfrastructure,
  createCloudBaseTrustedFunctionInfrastructure,
} from '../../functions/shared/cloudbase-composition';
import { NativeDatabaseDouble } from '../support/native-database-double';

describe('CloudBase runtime adapter', () => {
  it('derives the authenticated principal only from a CloudBase UID', async () => {
    const runtime = createCloudBaseRuntimeAdapter({
      functionName: 'task-query',
      sdk: sdkContext({ UID: ' uid_demo ' }),
      businessSession: { getBusinessSessionId: (token) => token === 'opaque.token.demo' ? 'ses_demo_1' : null },
    });

    await expect(runtime.getPlatformSubject()).resolves.toEqual({
      subject: 'cloudbase:username:uid_demo',
      loginType: 'USERNAME',
      isAuthenticated: true,
    });
    await expect(runtime.getBusinessSessionId({ businessSessionToken: 'opaque.token.demo' })).resolves.toBe('ses_demo_1');
    await expect(runtime.getBusinessSessionId({ businessSessionToken: 'forged.token' })).resolves.toBeNull();
  });

  it('fails closed for OPENID-only and mismatched UID/OPENID contexts', async () => {
    const openIdOnly = createCloudBaseRuntimeAdapter({
      functionName: 'auth-session',
      sdk: sdkContext({ OPENID: 'openid_demo' }),
    });
    await expect(openIdOnly.getPlatformSubject()).resolves.toEqual({
      subject: '',
      loginType: 'UNKNOWN',
      isAuthenticated: false,
    });

    const mismatched = createCloudBaseRuntimeAdapter({
      functionName: 'auth-session',
      sdk: sdkContext({ UID: 'uid_demo', OPENID: 'openid_other' }),
    });
    await expect(mismatched.getPlatformSubject()).resolves.toEqual({
      subject: '',
      loginType: 'UNKNOWN',
      isAuthenticated: false,
    });
  });

  it('accepts matching UID/OPENID context but still uses UID as the only subject namespace', async () => {
    const runtime = createCloudBaseRuntimeAdapter({
      functionName: 'auth-session',
      sdk: sdkContext({ UID: ' shared_subject ', OPENID: 'shared_subject' }),
    });
    await expect(runtime.getPlatformSubject()).resolves.toEqual({
      subject: 'cloudbase:username:shared_subject',
      loginType: 'USERNAME',
      isAuthenticated: true,
    });
  });

  it('supports CloudBase username identity and fails closed without a trusted identity/session', async () => {
    const usernameRuntime = createCloudBaseRuntimeAdapter({
      functionName: 'organization-admin',
      sdk: sdkContext({ UID: 'user_demo' }),
      businessSession: { getBusinessSessionId: () => 'not a safe session token' },
    });
    await expect(usernameRuntime.getPlatformSubject()).resolves.toEqual({
      subject: 'cloudbase:username:user_demo',
      loginType: 'USERNAME',
      isAuthenticated: true,
    });
    await expect(usernameRuntime.getBusinessSessionId({ businessSessionToken: 'opaque.token.demo' })).resolves.toBeNull();

    const anonymousRuntime = createCloudBaseRuntimeAdapter({
      functionName: 'auth-session',
      sdk: sdkContext({ OPENID: ' ', UID: 42 }),
    });
    await expect(anonymousRuntime.getPlatformSubject()).resolves.toEqual({
      subject: '',
      loginType: 'UNKNOWN',
      isAuthenticated: false,
    });
    await expect(anonymousRuntime.getBusinessSessionId({ businessSessionToken: null })).resolves.toBeNull();
  });

  it('A-05/A-07 queries and commands accept only admin-console audience tokens', async () => {
    for (const functionName of ['admin-task-activity-query', 'admin-task-activity-command',
      'textbook-admin-query', 'textbook-admin-command'] as const) {
      const runtime = createCloudBaseRuntimeAdapter({ functionName, sdk: sdkContext({ UID: 'admin_demo' }),
        businessSession: { getBusinessSessionId: (token, audience) =>
          token === 'admin-token-demo' && audience === 'admin-console' ? 'ses_admin_demo' : null } });
      await expect(runtime.getBusinessSessionId({ businessSessionToken: 'admin-token-demo' }))
        .resolves.toBe('ses_admin_demo');
      await expect(runtime.getBusinessSessionId({ businessSessionToken: 'mini-token-demo' }))
        .resolves.toBeNull();
    }
  });

  it('assembles trusted runtime, actor resolver and document port without an envId or SDK import', async () => {
    const nativeDatabase = new NativeDatabaseDouble();
    const identities = new InMemoryIdentityRepository({
      organizations: [], users: [], identities: [], roles: [], teacherGrants: [], parentLinks: [],
    });
    const sessions = new InMemoryBusinessSessionRepository();
    const infrastructure = createCloudBaseTrustedFunctionInfrastructure({
      functionName: 'task-command',
      sdk: {
        getWXContext: () => ({ UID: 'uid_demo' }),
        database: () => nativeDatabase,
      },
      identities,
      sessions,
      subjectDigest: { digest: (subject) => `digest:${subject}` },
      clock: { nowIso: () => '2026-09-16T12:00:00.000+08:00' },
    });

    expect(infrastructure.runtime.functionName).toBe('task-command');
    await expect(infrastructure.runtime.getBusinessSessionId({ businessSessionToken: 'opaque.token.demo' })).resolves.toBeNull();
    await expect(infrastructure.documents.get('tasks', 'missing')).resolves.toBeNull();
    expect(infrastructure.requestIds.next()).toMatch(/^req_task_command_/);
  });

  it('assembles the transactional task-core handler for command entry factories', () => {
    const nativeDatabase = new NativeDatabaseDouble();
    const identities = new InMemoryIdentityRepository({
      organizations: [], users: [], identities: [], roles: [], teacherGrants: [], parentLinks: [],
    });
    const infrastructure = createCloudBaseTaskCoreFunctionInfrastructure({
      functionName: 'submission-command',
      sdk: {
        getWXContext: () => ({ UID: 'uid_demo' }),
        database: () => nativeDatabase,
      },
      identities,
      sessions: new InMemoryBusinessSessionRepository(),
      subjectDigest: { digest: (subject) => `digest:${subject}` },
      identifiers: { next: (prefix) => `${prefix}_demo` },
      clock: { nowIso: () => '2026-09-16T12:00:00.000+08:00' },
    });

    expect(infrastructure.runtime.functionName).toBe('submission-command');
    expect(infrastructure.handler).toBeDefined();
  });

  it('assembles one document-backed learning-progress handler for query and command entries', () => {
    const nativeDatabase = new NativeDatabaseDouble();
    const identities = new InMemoryIdentityRepository({
      organizations: [], users: [], identities: [], roles: [], teacherGrants: [], parentLinks: [],
    });
    const infrastructure = createCloudBaseLearningProgressFunctionInfrastructure({
      functionName: 'learning-progress-command',
      sdk: {
        getWXContext: () => ({ UID: 'uid_demo' }),
        database: () => nativeDatabase,
      },
      identities,
      sessions: new InMemoryBusinessSessionRepository(),
      subjectDigest: { digest: (subject) => `digest:${subject}` },
      identifiers: { next: (prefix) => `${prefix}_demo` },
      clock: { nowIso: () => '2026-09-16T12:00:00.000+08:00' },
    });

    expect(infrastructure.runtime.functionName).toBe('learning-progress-command');
    expect(infrastructure.handler).toBeDefined();
  });

  it('assembles all four persistent task-query handlers only with injected stateless codecs', () => {
    const nativeDatabase = new NativeDatabaseDouble();
    const identities = new InMemoryIdentityRepository({
      organizations: [], users: [], identities: [], roles: [], teacherGrants: [], parentLinks: [],
    });
    const codec = { encode: (value: string) => `signed.${value}`, decode: (value: string) => value.startsWith('signed.') ? value.slice(7) : null };
    const infrastructure = createCloudBaseTaskQueryFunctionInfrastructure({
      functionName: 'review-query',
      sdk: {
        getWXContext: () => ({ UID: 'uid_demo' }),
        database: () => nativeDatabase,
      },
      identities,
      sessions: new InMemoryBusinessSessionRepository(),
      subjectDigest: { digest: (subject) => `digest:${subject}` },
      cursorCodec: codec,
      batchReviewPreviewCodec: codec,
      clock: { nowIso: () => '2026-09-16T12:00:00.000+08:00' },
    });

    expect(infrastructure.teacherTaskHandler).toBeDefined();
    expect(infrastructure.studentTaskHandler).toBeDefined();
    expect(infrastructure.reviewHandler).toBeDefined();
    expect(infrastructure.parentHandler).toBeDefined();
  });
});

function sdkContext(context: CloudBasePlatformContext) {
  return { getWXContext: () => context };
}
