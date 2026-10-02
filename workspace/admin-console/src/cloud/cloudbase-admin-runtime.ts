import type { AdminCloudResult, AdminConsoleSession, AdminFunctionInvoker } from './admin-cloud-contract';
import { createAdminCloudTransport } from './admin-cloud-transport';
import { createAdminSessionClient, MemoryAdminSessionStore, type AdminSessionClient, type AdminSessionStore } from './admin-session-client';
import type { AdminSessionFunctionInvoker } from './admin-session-contract';
import { createAdminSessionTransport } from './admin-session-transport';
import { createOrganizationAdminClient, type OrganizationAdminClient } from './organization-admin-client';
import { createTaskActivityClient } from './task-activity-client';
import type { TaskActivityClient } from '../services/task-activity-models';
import { createAdminTextbookClient, type AdminTextbookClient } from './admin-textbook-client';

export interface CloudBaseBrowserAuthResponse {
  readonly data?: unknown;
  readonly error?: unknown;
}

export interface CloudBaseBrowserAuth {
  signInWithPassword(input: Readonly<{ phone: string; password: string }>): Promise<CloudBaseBrowserAuthResponse>;
  signOut?(): Promise<unknown>;
}

export interface CloudBaseBrowserApp {
  auth(options: Readonly<{ persistence: 'local' }>): CloudBaseBrowserAuth;
  callFunction(options: Readonly<{ name: string; data: object; parse: true }>): Promise<Readonly<{ result?: unknown }>>;
}

export interface CloudBaseBrowserSdk {
  init(configuration: Readonly<{ env: string }>): CloudBaseBrowserApp;
}

export interface CloudBaseAdminRuntime {
  readonly sessions: AdminSessionClient;
  readonly organization: OrganizationAdminClient;
  readonly taskActivities: TaskActivityClient;
  readonly textbooks: AdminTextbookClient;
  signInWithPassword(input: Readonly<{ mobile: string; password: string }>): Promise<AdminCloudResult<null>>;
  signOutPlatform(): Promise<void>;
}

/**
 * Creates the standalone-admin CloudBase boundary without performing a login
 * or function invocation. Callers must explicitly supply the approved env ID
 * and invoke signInWithPassword before bootstrapping an admin business session.
 */
export function createCloudBaseAdminRuntime(options: Readonly<{
  sdk: CloudBaseBrowserSdk;
  environmentId: string;
  sessionStore?: AdminSessionStore;
  now?: () => Date;
}>): CloudBaseAdminRuntime {
  if (!isEnvironmentId(options.environmentId)) throw new Error('CLOUDBASE_ENVIRONMENT_ID_INVALID');
  const app = options.sdk.init({ env: options.environmentId });
  if (!isApp(app)) throw new Error('CLOUDBASE_BROWSER_CAPABILITY_UNAVAILABLE');
  const auth = app.auth({ persistence: 'local' });
  if (!isAuth(auth)) throw new Error('CLOUDBASE_BROWSER_AUTH_CAPABILITY_UNAVAILABLE');

  const invoker = createFunctionInvoker(app);
  const store = options.sessionStore ?? new MemoryAdminSessionStore(options.now);
  const sessionTransport = createAdminSessionTransport({ invoker, now: options.now });
  const sessions = createAdminSessionClient({ transport: sessionTransport, store, now: options.now });
  const organization = createOrganizationAdminClient(createAdminCloudTransport({ invoker, sessions: store, now: options.now }));
  const taskActivities = createTaskActivityClient(app, store, options.now);
  const textbooks = createAdminTextbookClient(app, sessions);

  return {
    sessions,
    organization,
    taskActivities,
    textbooks,
    async signInWithPassword(input) {
      if (!isMobile(input.mobile) || !isPassword(input.password)) return failed('VALIDATION_ERROR', '请输入有效的手机号和密码。');
      await clearQuietly(store);
      try {
        const response = await auth.signInWithPassword({ phone: input.mobile, password: input.password });
        if (!isRecord(response) || response.error !== undefined && response.error !== null || response.data === undefined || response.data === null) {
          return failed('UNAUTHENTICATED', '手机号或密码错误，或当前账号不可用。');
        }
        return { ok: true, data: null };
      } catch {
        return failed('NETWORK_ERROR', '网络连接异常，请稍后重试。');
      }
    },
    async signOutPlatform() {
      await clearQuietly(store);
      if (typeof auth.signOut !== 'function') return;
      try {
        await auth.signOut();
      } catch {
        // The volatile business session is already cleared. Do not surface SDK details.
      }
    },
  };
}

function createFunctionInvoker(app: CloudBaseBrowserApp): AdminFunctionInvoker & AdminSessionFunctionInvoker {
  return {
    async invoke(name, request) {
      const response = await app.callFunction({ name, data: request, parse: true });
      return response.result;
    },
  };
}

function isEnvironmentId(value: string): boolean {
  return typeof value === 'string' && /^[a-z][a-z0-9-]{2,63}$/.test(value);
}

function isApp(value: unknown): value is CloudBaseBrowserApp {
  return isRecord(value) && typeof value.auth === 'function' && typeof value.callFunction === 'function';
}

function isAuth(value: unknown): value is CloudBaseBrowserAuth {
  return isRecord(value) && typeof value.signInWithPassword === 'function';
}

function isMobile(value: string): boolean {
  return /^1\d{10}$/.test(value);
}

function isPassword(value: string): boolean {
  return typeof value === 'string' && value.length >= 1 && value.length <= 256;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function clearQuietly(store: AdminSessionStore): Promise<void> {
  try {
    await store.clear();
  } catch {
    // A custom storage failure must not preserve a potentially stale session.
  }
}

function failed(code: 'VALIDATION_ERROR' | 'UNAUTHENTICATED' | 'NETWORK_ERROR', message: string): AdminCloudResult<never> {
  return {
    ok: false,
    error: {
      code,
      message,
      retryable: code === 'NETWORK_ERROR',
    },
  };
}
