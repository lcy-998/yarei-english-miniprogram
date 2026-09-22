import { afterEach, describe, expect, it } from 'vitest';
import { CONTENT_QUERY_ACTIONS, validateContentQueryRequest } from '../../src/contracts/org-content-functions';
import { InMemoryBusinessSessionRepository, InMemoryIdentityRepository, type AuthorizationFixture } from '../../src/runtime/memory-ports';
import { createContentQueryFunction, type ContentQueryHandler } from '../../functions/content-query/function-entry';
import {
  createDefaultCloudBaseFunction,
  installCloudBaseRuntimeProvider,
  requireCloudBaseHandler,
} from '../../functions/shared/default-cloudbase-function';
import { createUnconfiguredFunction } from '../../functions/shared/unconfigured-function';
import { NativeDatabaseDouble } from '../support/native-database-double';

const NOW = '2026-09-16T00:00:00.000Z';
const SUBJECT = 'cloudbase:username:uid_demo';
const DIGEST = `digest:${SUBJECT}`;

const fixture: AuthorizationFixture = {
  organizations: [{
    _id: 'org_demo', organizationId: 'org_demo', name: '启航实验学校', status: 'active',
    timeZone: 'Asia/Shanghai', version: 1, deletedAt: null,
  }],
  users: [{
    _id: 'usr_student', organizationId: 'org_demo', authorizationVersion: 1, displayName: '小宇', displayNameMasked: '小*',
    status: 'active', version: 1, deletedAt: null,
  }],
  identities: [{
    _id: 'identity_student', organizationId: 'org_demo', userId: 'usr_student', provider: 'cloudbase_uid',
    providerSubjectDigest: DIGEST, status: 'active', version: 1, deletedAt: null,
  }],
  roles: [{
    _id: 'role_student', organizationId: 'org_demo', userId: 'usr_student', role: 'student',
    status: 'active', permissions: ['content.read'], scopeIds: ['usr_student'], version: 1, deletedAt: null,
  }],
  teacherGrants: [],
  parentLinks: [],
};

const handler: ContentQueryHandler = {
  listReadingResources: async () => [{
    id: 'reading_demo', title: 'A Day at the Zoo', category: 'picture_book', grade: '三年级',
    difficulty: '入门', contentVersion: 'demo-v1',
  }],
  getReadingResource: async () => {
    throw new Error('not used');
  },
  listVocabularyPacks: async () => [],
  getVocabularyPack: async () => {
    throw new Error('not used');
  },
};

afterEach(() => installCloudBaseRuntimeProvider(null));

describe('default CloudBase function composition', () => {
  it('validates before touching runtime and fails closed when no provider exists', async () => {
    let providerCalls = 0;
    installCloudBaseRuntimeProvider(async () => {
      providerCalls += 1;
      return null;
    });
    const main = createContentDefault();

    const forged = await main({
      apiVersion: 'm1.v1', action: 'listReadingResources', payload: {}, actorUserId: 'usr_forged',
    });
    expect(forged).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(providerCalls).toBe(0);

    const unavailable = await main({ apiVersion: 'm1.v1', action: 'listReadingResources', payload: {} });
    expect(unavailable).toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } });
    expect(providerCalls).toBe(1);
  });

  it('ignores CloudBase transport context while still rejecting business-field injection', async () => {
    let providerCalls = 0;
    installCloudBaseRuntimeProvider(async () => {
      providerCalls += 1;
      return null;
    });
    const main = createContentDefault();

    const platformDecorated = await main({
      apiVersion: 'm1.v1',
      action: 'listReadingResources',
      payload: {},
      tcbContext: { uid: 'platform-added' },
    });
    expect(platformDecorated).toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } });
    expect(providerCalls).toBe(1);

    const injected = await main({
      apiVersion: 'm1.v1',
      action: 'listReadingResources',
      payload: {},
      actorUserId: 'usr_forged',
      tcbContext: { uid: 'platform-added' },
    });
    expect(injected).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(providerCalls).toBe(1);
  });

  it('maps capability/bootstrap failures to a safe unavailable response', async () => {
    installCloudBaseRuntimeProvider(() => {
      throw new Error('sdk path and secret-like runtime detail');
    });
    const result = await createContentDefault()({
      apiVersion: 'm1.v1', action: 'listReadingResources', payload: {},
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } });
    if (result.ok) throw new Error('unavailable response expected');
    expect(result.error.message).not.toContain('secret-like');
  });

  it('lazily assembles the platform actor and document bridge, then reuses the configured main', async () => {
    const sessions = new InMemoryBusinessSessionRepository();
    await sessions.startOrResume({
      id: 'ses_trusted', organizationId: 'org_demo', userId: 'usr_student', subjectDigest: DIGEST,
      role: 'student', authzVersion: 1, recordVersion: 1, expiresAt: '2026-09-17T00:00:00.000Z', revokedAt: null,
    }, NOW);
    const nativeDatabase = new NativeDatabaseDouble();
    let providerCalls = 0;
    let databaseCalls = 0;
    installCloudBaseRuntimeProvider(async (functionName) => {
      providerCalls += 1;
      expect(functionName).toBe('content-query');
      return {
        sdk: {
          getWXContext: () => ({ UID: 'uid_demo' }),
          database: () => {
            databaseCalls += 1;
            return nativeDatabase;
          },
        },
        identities: new InMemoryIdentityRepository(fixture),
        sessions,
        subjectDigest: { digest: value => `digest:${value}` },
        identifiers: { next: prefix => `${prefix}_demo` },
        clock: { nowIso: () => NOW },
        businessSession: { getBusinessSessionId: (token) => token === 'opaque.token.trusted' ? 'ses_trusted' : null },
        handlers: { 'content-query': handler },
      };
    });
    const main = createContentDefault();

    const first = await main({ apiVersion: 'm1.v1', action: 'listReadingResources', payload: {}, businessSessionToken: 'opaque.token.trusted' });
    expect(first).toMatchObject({
      ok: true,
      data: [{ id: 'reading_demo', title: 'A Day at the Zoo' }],
    });
    const second = await main({ apiVersion: 'm1.v1', action: 'listVocabularyPacks', payload: {}, businessSessionToken: 'opaque.token.trusted' });
    expect(second).toMatchObject({ ok: true, data: [] });
    expect(providerCalls).toBe(1);
    expect(databaseCalls).toBe(1);
  });

  it('rejects legacy session injection and fails closed without a server token resolver', async () => {
    const sessions = new InMemoryBusinessSessionRepository();
    await sessions.startOrResume({
      id: 'ses_client_forged', organizationId: 'org_demo', userId: 'usr_student', subjectDigest: DIGEST,
      role: 'student', authzVersion: 1, recordVersion: 1, expiresAt: '2026-09-17T00:00:00.000Z', revokedAt: null,
    }, NOW);
    installCloudBaseRuntimeProvider(() => ({
      sdk: { getWXContext: () => ({ UID: 'uid_demo' }), database: () => new NativeDatabaseDouble() },
      identities: new InMemoryIdentityRepository(fixture),
      sessions,
      subjectDigest: { digest: value => `digest:${value}` },
      identifiers: { next: prefix => `${prefix}_demo` },
      clock: { nowIso: () => NOW },
      handlers: { 'content-query': handler },
    }));
    const main = createContentDefault();

    const injected = await main({
      apiVersion: 'm1.v1', action: 'listReadingResources', payload: {}, sessionId: 'ses_client_forged',
    });
    expect(injected).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });

    const withoutTrustedIngress = await main({ apiVersion: 'm1.v1', action: 'listReadingResources', payload: {} });
    expect(withoutTrustedIngress).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
    const unresolvedOpaqueToken = await main({
      apiVersion: 'm1.v1', action: 'listReadingResources', payload: {}, businessSessionToken: 'opaque.client.token',
    });
    expect(unresolvedOpaqueToken).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
  });

  it('rejects forged tokens, cross-platform-subject replay, revoked tokens, and event actor injection', async () => {
    const sessions = new InMemoryBusinessSessionRepository();
    await sessions.startOrResume({
      id: 'ses_bound', organizationId: 'org_demo', userId: 'usr_student', subjectDigest: DIGEST,
      role: 'student', authzVersion: 1, recordVersion: 1, expiresAt: '2026-09-17T00:00:00.000Z', revokedAt: null,
    }, NOW);
    const install = (uid: string): void => installCloudBaseRuntimeProvider(() => ({
      sdk: { getWXContext: () => ({ UID: uid }), database: () => new NativeDatabaseDouble() },
      identities: new InMemoryIdentityRepository(fixture),
      sessions,
      subjectDigest: { digest: value => `digest:${value}` },
      identifiers: { next: prefix => `${prefix}_demo` },
      clock: { nowIso: () => NOW },
      businessSession: { getBusinessSessionId: token => token === 'opaque.token.bound' ? 'ses_bound' : null },
      handlers: { 'content-query': handler },
    }));

    install('uid_demo');
    const forgedTokenMain = createContentDefault();
    expect(await forgedTokenMain({
      apiVersion: 'm1.v1', action: 'listReadingResources', payload: {}, businessSessionToken: 'opaque.token.forged',
    })).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });

    install('uid_other');
    const crossSubjectMain = createContentDefault();
    expect(await crossSubjectMain({
      apiVersion: 'm1.v1', action: 'listReadingResources', payload: {}, businessSessionToken: 'opaque.token.bound',
    })).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });

    const active = await sessions.find('ses_bound');
    if (active === null) throw new Error('session fixture missing');
    await sessions.replace({ ...active, revokedAt: NOW, recordVersion: active.recordVersion + 1 }, active.recordVersion);
    install('uid_demo');
    const revokedMain = createContentDefault();
    expect(await revokedMain({
      apiVersion: 'm1.v1', action: 'listReadingResources', payload: {}, businessSessionToken: 'opaque.token.bound',
    })).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });

    expect(await revokedMain({
      apiVersion: 'm1.v1', action: 'listReadingResources', payload: {}, businessSessionToken: 'opaque.token.bound',
      actorUserId: 'usr_student', actorRole: 'student', organizationId: 'org_demo',
    })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
  });
});

function createContentDefault() {
  const unavailable = createUnconfiguredFunction(
    'content-query',
    CONTENT_QUERY_ACTIONS,
    (_action, _payload, request) => {
      const validated = validateContentQueryRequest(request);
      return validated.ok ? null : validated.fieldErrors;
    },
  );
  return createDefaultCloudBaseFunction(
    'content-query',
    unavailable,
    (capabilities, infrastructure) => createContentQueryFunction({
      ...infrastructure,
      handler: requireCloudBaseHandler(capabilities, 'content-query'),
    }),
  );
}
