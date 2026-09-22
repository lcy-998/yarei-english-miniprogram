import {
  ADMIN_SESSION_AUDIENCE,
  type AdminCloudError,
  type AdminCloudResult,
  type AdminConsoleSession,
  type AdminSessionSource,
} from './admin-cloud-contract';
import type { AdminSessionTransport } from './admin-session-contract';

export interface AdminSessionStore extends AdminSessionSource {
  save(session: AdminConsoleSession): Promise<void>;
  clear(): Promise<void>;
}

export interface AdminSessionClient {
  bootstrap(): Promise<AdminCloudResult<AdminConsoleSession>>;
  refresh(): Promise<AdminCloudResult<AdminConsoleSession>>;
  getCurrentSession(): Promise<AdminCloudResult<AdminConsoleSession>>;
  logout(operationId: string): Promise<AdminCloudResult<null>>;
}

/** Volatile by design: closing or reloading the page drops the bearer token. */
export class MemoryAdminSessionStore implements AdminSessionStore {
  private session: AdminConsoleSession | null = null;

  public constructor(private readonly now: () => Date = () => new Date()) {}

  public async current(): Promise<AdminConsoleSession | null> {
    if (this.session === null) return null;
    if (Date.parse(this.session.expiresAt) <= this.now().getTime()) {
      this.session = null;
      return null;
    }
    return { ...this.session };
  }

  public async save(session: AdminConsoleSession): Promise<void> {
    this.session = { ...session };
  }

  public async clear(): Promise<void> {
    this.session = null;
  }
}

export function createAdminSessionClient(options: Readonly<{
  transport: AdminSessionTransport;
  store: AdminSessionStore;
  now?: () => Date;
}>): AdminSessionClient {
  const now = options.now ?? (() => new Date());
  return {
    bootstrap: () => runSessionAction(options, { action: 'bootstrap' }),
    refresh: () => runAuthenticatedSessionAction(options, 'refresh', now),
    getCurrentSession: () => runAuthenticatedSessionAction(options, 'getCurrentSession', now),
    logout: async (operationId) => {
      const session = await readSessionOrClear(options.store, now());
      if (session === null) return unauthenticated();
      const result = await options.transport.invoke({
        action: 'logout',
        businessSessionToken: session.token,
        operationId,
      });
      await clearQuietly(options.store);
      if (!result.ok) return result;
      return result.data === null
        ? { ok: true, data: null, ...(result.requestId === undefined ? {} : { requestId: result.requestId }) }
        : internalFailure(result.requestId);
    },
  };
}

async function runAuthenticatedSessionAction(
  options: Readonly<{ transport: AdminSessionTransport; store: AdminSessionStore }>,
  action: 'refresh' | 'getCurrentSession',
  now: () => Date,
): Promise<AdminCloudResult<AdminConsoleSession>> {
  const session = await readSessionOrClear(options.store, now());
  if (session === null) return unauthenticated();
  return runSessionAction(options, { action, businessSessionToken: session.token });
}

async function runSessionAction(
  options: Readonly<{ transport: AdminSessionTransport; store: AdminSessionStore }>,
  call: Parameters<AdminSessionTransport['invoke']>[0],
): Promise<AdminCloudResult<AdminConsoleSession>> {
  let result: Awaited<ReturnType<AdminSessionTransport['invoke']>>;
  try {
    result = await options.transport.invoke(call);
  } catch {
    await clearQuietly(options.store);
    return serviceUnavailable();
  }
  if (!result.ok || result.data === null || result.data.audience !== ADMIN_SESSION_AUDIENCE) {
    await clearQuietly(options.store);
    return result.ok ? internalFailure(result.requestId) : result;
  }
  try {
    await options.store.save(result.data);
  } catch {
    await clearQuietly(options.store);
    return serviceUnavailable(result.requestId);
  }
  return { ok: true, data: { ...result.data }, ...(result.requestId === undefined ? {} : { requestId: result.requestId }) };
}

async function readSessionOrClear(store: AdminSessionStore, now: Date): Promise<AdminConsoleSession | null> {
  try {
    const value = await store.current();
    if (!isUsableSession(value, now)) {
      await clearQuietly(store);
      return null;
    }
    return value;
  } catch {
    await clearQuietly(store);
    return null;
  }
}

function isUsableSession(value: unknown, now: Date): value is AdminConsoleSession {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const session = value as Record<string, unknown>;
  return Object.keys(session).length === 3
    && session.audience === ADMIN_SESSION_AUDIENCE
    && typeof session.token === 'string'
    && session.token.length >= 1
    && session.token.length <= 256
    && /^[A-Za-z0-9._~:-]+$/.test(session.token)
    && typeof session.expiresAt === 'string'
    && Number.isFinite(Date.parse(session.expiresAt))
    && Date.parse(session.expiresAt) > now.getTime();
}

async function clearQuietly(store: AdminSessionStore): Promise<void> {
  try {
    await store.clear();
  } catch {
    // A custom store must not make a failed credential look usable.
  }
}

function unauthenticated(): AdminCloudResult<never> {
  return failed({ code: 'UNAUTHENTICATED', message: '后台登录状态已失效，请重新登录。', retryable: false });
}

function serviceUnavailable(requestId?: string): AdminCloudResult<never> {
  return failed({ code: 'SERVICE_UNAVAILABLE', message: '后台登录服务尚未配置或暂不可用。', retryable: true }, requestId);
}

function internalFailure(requestId?: string): AdminCloudResult<never> {
  return failed({ code: 'INTERNAL_ERROR', message: '后台登录服务处理失败，请稍后重试。', retryable: true }, requestId);
}

function failed(error: AdminCloudError, requestId?: string): AdminCloudResult<never> {
  return { ok: false, error, ...(requestId === undefined ? {} : { requestId }) };
}
