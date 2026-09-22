import { afterEach, describe, expect, it } from 'vitest';
import { createAuthSessionFunction } from '../../functions/auth-session/function-entry';
import {
  bootstrapCloudBaseNodeDeployment,
  CLOUDBASE_JS_SDK_PACKAGE,
  CLOUDBASE_JS_SDK_VERSION,
  createCloudBaseNodeDeploymentProvider,
  type CloudBaseNodeSdkModulePort,
  type CloudBaseNodeDeploymentOptions,
} from '../../functions/shared/cloudbase-node-deployment-bootstrap';
import {
  createDefaultCloudBaseAuthFunction,
  installCloudBaseRuntimeProvider,
} from '../../functions/shared/default-cloudbase-function';
import { createUnconfiguredFunction } from '../../functions/shared/unconfigured-function';
import { AUTH_SESSION_ACTIONS, validateAuthRequest } from '../../src/contracts/auth-session';
import { IDENTITY_SESSION_COLLECTIONS } from '../../src/repositories/identity-session-document-adapter';
import type { VersionedDocument } from '../../src/repositories/document-database-port';
import { createOpaqueSessionIdSource } from '../../src/runtime/cloudbase-runtime-adapter';
import type { JsonValue } from '../../src/shared/protocol';
import { NativeDatabaseDouble } from '../support/native-database-double';

const NOW = '2026-09-16T12:00:00.000+08:00';
const ORGANIZATION_ID = 'org_demo';
const USER_ID = 'student_demo';
const UID = 'uid_demo';
const DIGEST = `digest:cloudbase:username:${UID}`;

declare const require: (moduleName: string) => unknown;

afterEach(() => installCloudBaseRuntimeProvider(null));

describe('CloudBase Node deployment bootstrap', () => {
  it('matches the installed maintained JS SDK Node runtime shape without making a cloud request', () => {
    const loaded = require(CLOUDBASE_JS_SDK_PACKAGE) as Readonly<Record<string, unknown>>;
    expect(loaded.version).toBe(CLOUDBASE_JS_SDK_VERSION);
    expect(typeof loaded.init).toBe('function');
    expect(typeof loaded.getCloudbaseContext).toBe('function');

    const sdk = loaded as unknown as CloudBaseNodeSdkModulePort;
    const app = sdk.init({ env: 'env_sdk_shape_test' });
    expect(typeof app.auth).toBe('function');
    expect(typeof app.auth().getUserInfo).toBe('function');
    expect(typeof app.database().collection).toBe('function');
    expect(typeof app.database().runTransaction).toBe('function');
  });

  it('initializes the official server SDK without an envId and exposes current UID plus database once', async () => {
    const database = identityDatabase();
    const initializationOptions: unknown[] = [];
    let databaseCalls = 0;
    let authCalls = 0;
    let userInfoCalls = 0;
    let activeUid = UID;
    const provider = createCloudBaseNodeDeploymentProvider(options({
      getCloudbaseContext: () => ({ TCB_ENV: 'env_current_runtime' }),
      init: (input) => {
        initializationOptions.push(input);
        return {
          auth: () => {
            authCalls += 1;
            return { getUserInfo: () => { userInfoCalls += 1; return { uid: ` ${activeUid} `, openId: 'ignored' }; } };
          },
          database: () => { databaseCalls += 1; return database; },
        };
      },
    }));

    const capabilities = await provider('auth-session');
    expect(CLOUDBASE_JS_SDK_PACKAGE).toBe('@cloudbase/node-sdk');
    expect(CLOUDBASE_JS_SDK_VERSION).toBe('3.18.3');
    expect(initializationOptions).toEqual([{ env: 'env_current_runtime' }]);
    expect(databaseCalls).toBe(1);
    expect(capabilities?.sdk.getWXContext()).toEqual({ UID });
    activeUid = 'uid_second_warm_request';
    expect(capabilities?.sdk.getWXContext()).toEqual({ UID: activeUid });
    expect(authCalls).toBe(2);
    expect(userInfoCalls).toBe(2);
    expect(await capabilities?.documents?.get(IDENTITY_SESSION_COLLECTIONS.users, USER_ID))
      .toMatchObject({ _id: USER_ID, authorizationVersion: 1 });
  });

  it('falls back to customUserId for CloudBase account types that omit uid', async () => {
    const provider = createCloudBaseNodeDeploymentProvider(options({
      getCloudbaseContext: () => ({ TCB_ENV: 'env_current_runtime' }),
      init: () => ({
        auth: () => ({ getUserInfo: () => ({ customUserId: ` ${UID} ` }) }),
        database: () => identityDatabase(),
      }),
    }));

    expect((await provider('auth-session'))?.sdk.getWXContext()).toEqual({ UID });
  });

  it('keeps the caller unauthenticated when server user info has no stable id', async () => {
    const provider = createCloudBaseNodeDeploymentProvider(options({
      getCloudbaseContext: () => ({ TCB_ENV: 'env_current_runtime' }),
      init: () => ({
        auth: () => ({ getUserInfo: () => ({ customUserId: '   ' }) }),
        database: () => identityDatabase(),
      }),
    }));

    expect((await provider('auth-session'))?.sdk.getWXContext()).toEqual({ UID: undefined });
  });

  it('uses an explicit deployment environment fallback when CloudBase context omits TCB_ENV', async () => {
    const initializationOptions: unknown[] = [];
    const provider = createCloudBaseNodeDeploymentProvider({
      ...options({
        getCloudbaseContext: () => ({}),
        init: (input) => {
          initializationOptions.push(input);
          return {
            auth: () => ({ getUserInfo: () => ({ uid: UID }) }),
            database: () => identityDatabase(),
          };
        },
      }),
      environmentId: 'env_from_process_fallback',
    });

    expect(initializationOptions).toEqual([{ env: 'env_from_process_fallback' }]);
    expect((await provider('auth-session'))?.sdk.getWXContext()).toEqual({ UID });
  });

  it('installs a cold-start provider that can bootstrap a persistent auth session', async () => {
    const database = identityDatabase();
    bootstrapCloudBaseNodeDeployment(options({
      getCloudbaseContext: () => ({ TCB_ENV: 'env_current_runtime' }),
      init: () => ({
        auth: () => ({ getUserInfo: () => ({ uid: UID }) }),
        database: () => database,
      }),
    }));

    const result = await authMain()({ apiVersion: 'm1.v1', action: 'bootstrap', payload: {} });
    expect(result).toMatchObject({
      ok: true,
      data: { sessionId: 'ses_deployment', userId: USER_ID, roles: ['student'] },
    });
  });

  it('fails closed before installation when the module or a secret-bearing port is missing', () => {
    const valid = options({
      getCloudbaseContext: () => ({ TCB_ENV: 'env_current_runtime' }),
      init: () => ({ auth: () => ({ getUserInfo: () => ({ uid: UID }) }), database: () => identityDatabase() }),
    });
    expect(() => createCloudBaseNodeDeploymentProvider({ ...valid, loadSdk: () => ({}) }))
      .toThrow('CloudBase deployment capabilities are unavailable.');
    expect(() => createCloudBaseNodeDeploymentProvider({
      ...valid,
      cryptography: { ...valid.cryptography, queryCursorCodec: undefined },
    } as unknown as CloudBaseNodeDeploymentOptions)).toThrow('CloudBase deployment capabilities are unavailable.');
  });
});

function authMain() {
  const unavailable = createUnconfiguredFunction(
    'auth-session', AUTH_SESSION_ACTIONS,
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

function options(sdk: Readonly<{
  getCloudbaseContext(): Readonly<{ TCB_ENV?: unknown }>;
  init(input: Readonly<{ env: string }>): unknown;
}>): CloudBaseNodeDeploymentOptions {
  return {
    loadSdk: () => sdk,
    clock: { nowIso: () => NOW },
    requestIds: { next: () => 'request_deployment' },
    cryptography: {
      subjectDigest: { digest: (value) => `digest:${value}` },
      identifiers: { next: (prefix) => `${prefix}_deployment` },
      businessSession: createOpaqueSessionIdSource(),
      queryCursorCodec: { encode: (value) => `query:${value}`, decode: (value) => value.startsWith('query:') ? value.slice(6) : null },
      batchReviewPreviewCodec: { encode: (value) => `batch:${value}`, decode: (value) => value.startsWith('batch:') ? value.slice(6) : null },
      bindingCodes: { nextSixDigits: () => '111111', deriveSixDigits: () => '222222' },
      bindingCodeDigest: { digest: (value) => `binding:${value}` },
    },
  };
}

function identityDatabase(): NativeDatabaseDouble {
  return new NativeDatabaseDouble({
    [IDENTITY_SESSION_COLLECTIONS.organizations]: [document(ORGANIZATION_ID, ORGANIZATION_ID, {
      name: '启航实验学校', status: 'active', timeZone: 'Asia/Shanghai',
    })],
    [IDENTITY_SESSION_COLLECTIONS.users]: [document(USER_ID, ORGANIZATION_ID, {
      authorizationVersion: 1, displayName: '小宇', displayNameMasked: '小*', status: 'active',
    })],
    [IDENTITY_SESSION_COLLECTIONS.identities]: [document('identity_demo', ORGANIZATION_ID, {
      userId: USER_ID, provider: 'cloudbase_uid', providerSubjectDigest: DIGEST, status: 'active',
    })],
    [IDENTITY_SESSION_COLLECTIONS.roles]: [document('role_student', ORGANIZATION_ID, {
      userId: USER_ID, role: 'student', status: 'active', permissions: ['content.read'], scopeIds: [USER_ID],
    })],
  });
}

function document(
  id: string,
  organizationId: string,
  data: Readonly<Record<string, JsonValue>>,
): VersionedDocument {
  return { ...data, _id: id, organizationId, schemaVersion: 1, version: 1, deletedAt: null };
}
