import { describe, expect, it, vi } from 'vitest';
import { ADMIN_SESSION_AUDIENCE } from '../src/cloud/admin-cloud-contract';
import { createAdminSessionClient, MemoryAdminSessionStore } from '../src/cloud/admin-session-client';
import {
  ADMIN_SESSION_FUNCTION_NAME,
  type AdminSessionFunctionInvoker,
  type AdminSessionWireRequest,
} from '../src/cloud/admin-session-contract';
import { createAdminSessionTransport } from '../src/cloud/admin-session-transport';

const NOW = new Date('2026-09-17T04:00:00.000Z');
const SESSION = {
  audience: ADMIN_SESSION_AUDIENCE,
  token: 'as1.admin-session-token-for-tests',
  expiresAt: '2026-09-17T06:00:00.000Z',
} as const;

function success(data: unknown): Record<string, unknown> {
  return {
    ok: true,
    data,
    meta: {
      requestId: 'req_admin_session_001',
      serverTime: '2026-09-17T04:00:01.000Z',
      apiVersion: 'm1.v1',
    },
  };
}

function setup(result: unknown) {
  const invoke = vi.fn(async (_name: typeof ADMIN_SESSION_FUNCTION_NAME, _request: AdminSessionWireRequest) => result);
  const invoker: AdminSessionFunctionInvoker = { invoke };
  const store = new MemoryAdminSessionStore(() => NOW);
  const transport = createAdminSessionTransport({ invoker, now: () => NOW });
  const client = createAdminSessionClient({ transport, store, now: () => NOW });
  return { client, invoke, store };
}

describe('admin-session 客户端与内存会话', () => {
  it('bootstrap 使用无业务令牌的严格 m1.v1 信封并保存后台会话', async () => {
    const { client, invoke, store } = setup(success(SESSION));

    expect(await client.bootstrap()).toEqual({
      ok: true,
      data: SESSION,
      requestId: 'req_admin_session_001',
    });
    expect(invoke).toHaveBeenCalledWith(ADMIN_SESSION_FUNCTION_NAME, {
      apiVersion: 'm1.v1',
      action: 'bootstrap',
      payload: {},
    });
    expect(await store.current()).toEqual(SESSION);
  });

  it('refresh 与 getCurrentSession 使用当前 admin-console token 并替换内存值', async () => {
    const rotated = { ...SESSION, token: 'as1.rotated-admin-session-token' };
    const refreshSetup = setup(success(rotated));
    await refreshSetup.store.save(SESSION);

    expect(await refreshSetup.client.refresh()).toMatchObject({ ok: true, data: rotated });
    expect(refreshSetup.invoke).toHaveBeenCalledWith(ADMIN_SESSION_FUNCTION_NAME, {
      apiVersion: 'm1.v1',
      action: 'refresh',
      payload: {},
      businessSessionToken: SESSION.token,
    });
    expect(await refreshSetup.store.current()).toEqual(rotated);

    const currentSetup = setup(success(SESSION));
    await currentSetup.store.save(SESSION);
    expect(await currentSetup.client.getCurrentSession()).toMatchObject({ ok: true, data: SESSION });
    expect(currentSetup.invoke.mock.calls[0]?.[1]).toMatchObject({
      action: 'getCurrentSession',
      businessSessionToken: SESSION.token,
    });
  });

  it('拒绝非 admin-console audience 与已过期响应并清空原会话', async () => {
    const wrongAudience = setup(success({ ...SESSION, audience: 'mini-program' }));
    await wrongAudience.store.save(SESSION);
    expect(await wrongAudience.client.refresh()).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
    expect(await wrongAudience.store.current()).toBeNull();

    const expired = setup(success({ ...SESSION, expiresAt: '2026-09-17T03:59:59.000Z' }));
    await expired.store.save(SESSION);
    expect(await expired.client.refresh()).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
    expect(await expired.store.current()).toBeNull();
  });

  it('本地过期会话在调用前清除并失败关闭', async () => {
    const { client, invoke, store } = setup(success(SESSION));
    await store.save({ ...SESSION, expiresAt: '2026-09-17T03:59:59.000Z' });

    expect(await client.getCurrentSession()).toEqual({
      ok: false,
      error: { code: 'UNAUTHENTICATED', message: '后台登录状态已失效，请重新登录。', retryable: false },
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(await store.current()).toBeNull();
  });

  it('拒绝响应额外字段且不会保留旧令牌', async () => {
    const { client, store } = setup({ ...success(SESSION), platformTrace: 'must-not-reach-ui' });
    await store.save(SESSION);

    expect(await client.refresh()).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
    expect(await store.current()).toBeNull();
  });

  it('平台异常和服务端详情只映射为本地安全文案并清空令牌', async () => {
    const invoke = vi.fn(async () => { throw new Error('provider token and internal path'); });
    const store = new MemoryAdminSessionStore(() => NOW);
    await store.save(SESSION);
    const client = createAdminSessionClient({
      transport: createAdminSessionTransport({ invoker: { invoke }, now: () => NOW }),
      store,
      now: () => NOW,
    });

    expect(await client.refresh()).toEqual({
      ok: false,
      error: { code: 'NETWORK_ERROR', message: '网络连接异常，请稍后重试。', retryable: true },
    });
    expect(await store.current()).toBeNull();

    const denied = setup({
      ok: false,
      error: {
        code: 'FORBIDDEN',
        message: 'raw provider identity detail',
        retryable: true,
        fieldErrors: { identity: 'raw subject and collection detail' },
      },
      meta: { requestId: 'req_denied', serverTime: '2026-09-17T04:00:01.000Z', apiVersion: 'm1.v1' },
    });
    await denied.store.save(SESSION);
    expect(await denied.client.refresh()).toEqual({
      ok: false,
      error: { code: 'FORBIDDEN', message: '当前账号不能进入管理后台。', retryable: false },
      requestId: 'req_denied',
    });
    expect(await denied.store.current()).toBeNull();
  });

  it('logout 携带 token 与 operationId，成功或失败后均清空会话', async () => {
    const completed = setup(success(null));
    await completed.store.save(SESSION);

    expect(await completed.client.logout('logout_operation_001')).toEqual({
      ok: true,
      data: null,
      requestId: 'req_admin_session_001',
    });
    expect(completed.invoke).toHaveBeenCalledWith(ADMIN_SESSION_FUNCTION_NAME, {
      apiVersion: 'm1.v1',
      action: 'logout',
      payload: {},
      businessSessionToken: SESSION.token,
      operationId: 'logout_operation_001',
    });
    expect(await completed.store.current()).toBeNull();

    const invalid = setup(success(null));
    await invalid.store.save(SESSION);
    expect(await invalid.client.logout('short')).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(await invalid.store.current()).toBeNull();
  });

  it('内存存储返回副本且页面刷新后不会持久化令牌', async () => {
    const first = new MemoryAdminSessionStore(() => NOW);
    await first.save(SESSION);
    const returned = await first.current();
    expect(returned).toEqual(SESSION);
    expect(returned).not.toBe(SESSION);

    const afterReload = new MemoryAdminSessionStore(() => NOW);
    expect(await afterReload.current()).toBeNull();
  });
});
