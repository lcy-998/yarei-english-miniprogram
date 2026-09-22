import { afterEach, describe, expect, it } from 'vitest';
import { AUTH_SESSION_ACTIONS, validateAuthRequest } from '../../src/contracts/auth-session';
import { ADMIN_SESSION_ACTIONS, validateAdminSessionRequest } from '../../src/contracts/admin-session';
import type { VersionedDocument } from '../../src/repositories/document-database-port';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import { IDENTITY_SESSION_COLLECTIONS } from '../../src/repositories/identity-session-document-adapter';
import { createOpaqueSessionIdSource } from '../../src/runtime/cloudbase-runtime-adapter';
import type { JsonValue } from '../../src/shared/protocol';
import { createAuthSessionFunction } from '../../functions/auth-session/function-entry';
import { createAdminSessionFunction } from '../../functions/admin-session/function-entry';
import {
  createDefaultCloudBaseAdminSessionFunction,
  createDefaultCloudBaseAuthFunction,
  installCloudBaseRuntimeProvider,
} from '../../functions/shared/default-cloudbase-function';
import {
  createIdentitySessionRuntimeCapabilities,
  type IdentitySessionCapabilityOptions,
} from '../../functions/shared/identity-session-capabilities';
import { createUnconfiguredFunction } from '../../functions/shared/unconfigured-function';

const NOW = '2026-09-16T12:00:00.000+08:00';
const ORGANIZATION_ID = 'org_demo';
const USER_ID = 'student_demo';
const UID = 'uid_demo';
const SUBJECT = `cloudbase:username:${UID}`;
const DIGEST = `digest:${SUBJECT}`;

afterEach(() => installCloudBaseRuntimeProvider(null));

describe('identity/session runtime capability factory', () => {
  it('lets default auth composition resume the same session after a cold start without touching sdk.database', async () => {
    const documents = identityDatabase();
    let sdkDatabaseCalls = 0;
    const firstCapabilities = capabilities(documents, 'cold_a', () => { sdkDatabaseCalls += 1; });
    installCloudBaseRuntimeProvider(() => firstCapabilities);
    const firstMain = createAuthDefault();

    const bootstrapped = await firstMain({ apiVersion: 'm1.v1', action: 'bootstrap', payload: {} });
    expect(bootstrapped).toMatchObject({
      ok: true,
      data: { sessionId: 'ses_cold_a', userId: USER_ID, activeRole: null, roles: ['student'] },
    });
    if (!bootstrapped.ok || bootstrapped.data === null) throw new Error('bootstrap expected');
    const selected = await firstMain({
      apiVersion: 'm1.v1',
      action: 'selectRole',
      payload: { role: 'student' },
      businessSessionToken: bootstrapped.data.sessionId,
    });
    expect(selected).toMatchObject({ ok: true, data: { activeRole: 'student' } });

    const secondCapabilities = capabilities(documents, 'cold_b', () => { sdkDatabaseCalls += 1; });
    installCloudBaseRuntimeProvider(() => secondCapabilities);
    const secondMain = createAuthDefault();
    const resumed = await secondMain({ apiVersion: 'm1.v1', action: 'bootstrap', payload: {} });
    expect(resumed).toMatchObject({
      ok: true,
      data: { sessionId: 'ses_cold_a', activeRole: 'student', roles: ['student'] },
    });
    const current = await secondMain({
      apiVersion: 'm1.v1',
      action: 'getCurrentSession',
      payload: {},
      businessSessionToken: 'ses_cold_a',
    });
    expect(current).toMatchObject({ ok: true, data: { sessionId: 'ses_cold_a', activeRole: 'student' } });
    expect(documents.snapshot()[IDENTITY_SESSION_COLLECTIONS.sessions]).toHaveLength(1);
    expect(sdkDatabaseCalls).toBe(0);
  });

  it('fails closed through the default main when an explicit cryptography/id capability is absent', async () => {
    const documents = identityDatabase();
    const valid = capabilityOptions(documents, 'missing');
    const missingIdentifiers = {
      ...valid,
      cryptography: { ...valid.cryptography, identifiers: undefined },
    } as unknown as IdentitySessionCapabilityOptions;
    installCloudBaseRuntimeProvider(() => createIdentitySessionRuntimeCapabilities(missingIdentifiers));

    const result = await createAuthDefault()({ apiVersion: 'm1.v1', action: 'bootstrap', payload: {} });
    expect(result).toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } });
    if (result.ok) throw new Error('unavailable result expected');
    expect(result.error.message).not.toContain('identifier');
  });

  it('builds the default persistent admin-session composition and fails closed without an issuing codec', async () => {
    const documents = adminIdentityDatabase();
    const codec = audienceSessionCodec();
    const options = capabilityOptions(documents, 'admin');
    const capabilities = createIdentitySessionRuntimeCapabilities({
      ...options,
      cryptography: { ...options.cryptography, businessSession: codec },
    });
    installCloudBaseRuntimeProvider((functionName) => functionName === 'admin-session' ? capabilities : null);
    const main = createAdminDefault();

    const bootstrapped = await main({ apiVersion: 'm1.v1', action: 'bootstrap', payload: {} });
    expect(bootstrapped).toMatchObject({
      ok: true,
      data: {
        audience: 'admin-console',
        token: 'admin:admin_ses_admin',
        expiresAt: '2026-09-16T06:00:00.000Z',
      },
    });
    expect(documents.snapshot()[IDENTITY_SESSION_COLLECTIONS.sessions]).toEqual([
      expect.objectContaining({ audience: 'admin-console', role: 'admin', authzVersion: 3 }),
    ]);
    expect(await main({
      apiVersion: 'm1.v1', action: 'getCurrentSession', payload: {},
      businessSessionToken: 'admin:admin_ses_admin',
    })).toMatchObject({ ok: true, data: { audience: 'admin-console' } });

    const withoutIssue = {
      ...capabilities,
      businessSession: { getBusinessSessionId: codec.getBusinessSessionId },
    };
    installCloudBaseRuntimeProvider(() => withoutIssue);
    expect(await createAdminDefault()({ apiVersion: 'm1.v1', action: 'bootstrap', payload: {} }))
      .toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } });
  });

  it('requires every injected sdk, document, clock, request-id, digest, id and token-source port', () => {
    const valid = capabilityOptions(identityDatabase(), 'required');
    const invalid: readonly IdentitySessionCapabilityOptions[] = [
      { ...valid, sdk: undefined } as unknown as IdentitySessionCapabilityOptions,
      { ...valid, documents: undefined } as unknown as IdentitySessionCapabilityOptions,
      { ...valid, clock: undefined } as unknown as IdentitySessionCapabilityOptions,
      { ...valid, requestIds: undefined } as unknown as IdentitySessionCapabilityOptions,
      { ...valid, cryptography: { ...valid.cryptography, subjectDigest: undefined } } as unknown as IdentitySessionCapabilityOptions,
      { ...valid, cryptography: { ...valid.cryptography, identifiers: undefined } } as unknown as IdentitySessionCapabilityOptions,
      { ...valid, cryptography: { ...valid.cryptography, businessSession: undefined } } as unknown as IdentitySessionCapabilityOptions,
    ];

    for (const options of invalid) {
      expect(() => createIdentitySessionRuntimeCapabilities(options))
        .toThrow('Identity/session runtime capabilities are unavailable.');
    }
  });
});

function createAuthDefault() {
  const unavailable = createUnconfiguredFunction(
    'auth-session',
    AUTH_SESSION_ACTIONS,
    (_action, _payload, request) => {
      const validated = validateAuthRequest(request);
      return validated.ok ? null : validated.fieldErrors;
    },
  );
  return createDefaultCloudBaseAuthFunction(
    unavailable,
    (_capabilities, dependencies) => createAuthSessionFunction(dependencies),
  );
}

function createAdminDefault() {
  const unavailable = createUnconfiguredFunction(
    'admin-session',
    ADMIN_SESSION_ACTIONS,
    (_action, _payload, request) => {
      const validated = validateAdminSessionRequest(request);
      return validated.ok ? null : validated.fieldErrors;
    },
  );
  return createDefaultCloudBaseAdminSessionFunction(
    unavailable,
    (_capabilities, dependencies) => createAdminSessionFunction(dependencies),
  );
}

function capabilities(
  documents: FakeDocumentDatabase,
  suffix: string,
  onSdkDatabase: () => void,
) {
  return createIdentitySessionRuntimeCapabilities(capabilityOptions(documents, suffix, onSdkDatabase));
}

function capabilityOptions(
  documents: FakeDocumentDatabase,
  suffix: string,
  onSdkDatabase: () => void = () => undefined,
): IdentitySessionCapabilityOptions {
  let requestSequence = 0;
  return {
    sdk: {
      getWXContext: () => ({ UID }),
      database: () => {
        onSdkDatabase();
        throw new Error('Injected DocumentDatabasePort must be used.');
      },
    },
    documents,
    clock: { nowIso: () => NOW },
    requestIds: { next: () => `request_${suffix}_${++requestSequence}` },
    cryptography: {
      subjectDigest: { digest: (value) => `digest:${value}` },
      identifiers: { next: (prefix) => `${prefix}_${suffix}` },
      businessSession: createOpaqueSessionIdSource(),
    },
  };
}

function identityDatabase(): FakeDocumentDatabase {
  return new FakeDocumentDatabase({
    [IDENTITY_SESSION_COLLECTIONS.organizations]: [document(
      ORGANIZATION_ID,
      ORGANIZATION_ID,
      1,
      { name: '启航实验学校', status: 'active', timeZone: 'Asia/Shanghai' },
    )],
    [IDENTITY_SESSION_COLLECTIONS.users]: [document(USER_ID, ORGANIZATION_ID, 1, {
      authorizationVersion: 1,
      displayName: '小宇',
      displayNameMasked: '小*',
      status: 'active',
    })],
    [IDENTITY_SESSION_COLLECTIONS.identities]: [document('identity_demo', ORGANIZATION_ID, 1, {
      userId: USER_ID,
      provider: 'cloudbase_uid',
      providerSubjectDigest: DIGEST,
      status: 'active',
    })],
    [IDENTITY_SESSION_COLLECTIONS.roles]: [document('role_student', ORGANIZATION_ID, 1, {
      userId: USER_ID,
      role: 'student',
      status: 'active',
      permissions: ['content.read'],
      scopeIds: [USER_ID],
    })],
  });
}

function adminIdentityDatabase(): FakeDocumentDatabase {
  return new FakeDocumentDatabase({
    [IDENTITY_SESSION_COLLECTIONS.organizations]: [document(
      ORGANIZATION_ID,
      ORGANIZATION_ID,
      1,
      { name: '启航实验学校', status: 'active', timeZone: 'Asia/Shanghai' },
    )],
    [IDENTITY_SESSION_COLLECTIONS.users]: [document(USER_ID, ORGANIZATION_ID, 1, {
      authorizationVersion: 3,
      displayName: '周老师',
      displayNameMasked: '周老师',
      status: 'active',
    })],
    [IDENTITY_SESSION_COLLECTIONS.identities]: [document('identity_demo', ORGANIZATION_ID, 1, {
      userId: USER_ID,
      provider: 'cloudbase_uid',
      providerSubjectDigest: DIGEST,
      status: 'active',
    })],
    [IDENTITY_SESSION_COLLECTIONS.roles]: [document('role_admin', ORGANIZATION_ID, 1, {
      userId: USER_ID,
      role: 'admin',
      status: 'active',
      permissions: ['organization.read'],
      scopeIds: [ORGANIZATION_ID],
    })],
  });
}

function audienceSessionCodec() {
  return {
    issueBusinessSessionToken: (
      sessionId: string,
      _expiresAt: string,
      audience: 'mini-program' | 'admin-console' = 'mini-program',
    ) => `${audience === 'admin-console' ? 'admin' : 'mini'}:${sessionId}`,
    getBusinessSessionId: (
      token: string,
      audience: 'mini-program' | 'admin-console' = 'mini-program',
    ) => {
      const prefix = audience === 'admin-console' ? 'admin:' : 'mini:';
      return token.startsWith(prefix) ? token.slice(prefix.length) : null;
    },
  };
}

function document(
  id: string,
  organizationId: string,
  version: number,
  data: Readonly<Record<string, JsonValue>>,
): VersionedDocument {
  return {
    ...data,
    _id: id,
    organizationId,
    schemaVersion: 1,
    version,
    deletedAt: null,
  };
}
