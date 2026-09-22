import { describe, expect, it, vi } from 'vitest';
import { ADMIN_FUNCTION_NAME, ADMIN_SESSION_AUDIENCE } from '../src/cloud/admin-cloud-contract';
import { createCloudBaseAdminRuntime, type CloudBaseBrowserSdk } from '../src/cloud/cloudbase-admin-runtime';

const NOW = new Date('2026-09-19T08:00:00.000Z');
const SESSION = {
  audience: ADMIN_SESSION_AUDIENCE,
  token: 'as1.admin-cloud-runtime-test-token',
  expiresAt: '2026-09-19T10:00:00.000Z',
} as const;

function setup(options: Readonly<{ authResponse?: unknown; authError?: unknown; functionResult?: unknown; signOut?: () => Promise<unknown> }> = {}) {
  const signInWithPassword = vi.fn(async () => options.authError === undefined
    ? options.authResponse ?? { data: { uid: 'uid_virtual_admin' } }
    : Promise.reject(options.authError));
  const callFunction = vi.fn(async () => ({ result: options.functionResult ?? success(SESSION) }));
  const auth = { signInWithPassword, ...(options.signOut === undefined ? {} : { signOut: options.signOut }) };
  const init = vi.fn(() => ({ auth: vi.fn(() => auth), callFunction }));
  const sdk: CloudBaseBrowserSdk = { init };
  const runtime = createCloudBaseAdminRuntime({ sdk, environmentId: 'yarei-m1-dev', now: () => NOW });
  return { runtime, init, auth, signInWithPassword, callFunction };
}

function success(data: unknown): unknown {
  return {
    ok: true,
    data,
    meta: { requestId: 'req_runtime_001', serverTime: NOW.toISOString(), apiVersion: 'm1.v1' },
  };
}

describe('CloudBase 管理后台运行时', () => {
  it('仅在显式创建时初始化指定环境；创建本身不登录或调用函数', () => {
    const { init, signInWithPassword, callFunction } = setup();

    expect(init).toHaveBeenCalledWith({ env: 'yarei-m1-dev' });
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(callFunction).not.toHaveBeenCalled();
  });

  it('平台密码登录成功后，后台 bootstrap 使用同一 SDK app 且不把密码发送给函数', async () => {
    const { runtime, signInWithPassword, callFunction } = setup();

    expect(await runtime.signInWithPassword({ mobile: '13800000001', password: 'Virtual-test-password-2026' })).toEqual({ ok: true, data: null });
    expect(signInWithPassword).toHaveBeenCalledWith({ phone: '13800000001', password: 'Virtual-test-password-2026' });
    expect(await runtime.sessions.bootstrap()).toMatchObject({ ok: true, data: SESSION });
    expect(callFunction).toHaveBeenCalledWith({
      name: 'admin-session',
      data: { apiVersion: 'm1.v1', action: 'bootstrap', payload: {} },
      parse: true,
    });
    expect(JSON.stringify(callFunction.mock.calls)).not.toContain('Virtual-test-password-2026');
  });

  it('认证失败、响应异常和参数错误均安全失败，不调用后台函数', async () => {
    const rejected = setup({ authResponse: { error: { code: 'INVALID_PASSWORD', trace: 'secret provider detail' } } });
    expect(await rejected.runtime.signInWithPassword({ mobile: '13800000001', password: 'wrong-password' })).toMatchObject({
      ok: false, error: { code: 'UNAUTHENTICATED', message: '手机号或密码错误，或当前账号不可用。' },
    });
    expect(rejected.callFunction).not.toHaveBeenCalled();

    const malformed = setup({ authResponse: { data: null } });
    expect(await malformed.runtime.signInWithPassword({ mobile: '13800000001', password: 'valid-password' })).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });

    const invalid = setup();
    expect(await invalid.runtime.signInWithPassword({ mobile: 'not-a-phone', password: '' })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(invalid.signInWithPassword).not.toHaveBeenCalled();
  });

  it('退出会先清除易失后台会话，再尽力退出平台认证且不抛出 SDK 细节', async () => {
    const signOut = vi.fn(async () => { throw new Error('provider token detail'); });
    const { runtime } = setup({ signOut });
    await runtime.signInWithPassword({ mobile: '13800000001', password: 'Virtual-test-password-2026' });
    await runtime.sessions.bootstrap();

    await runtime.signOutPlatform();

    expect(signOut).toHaveBeenCalledOnce();
    expect(await runtime.sessions.getCurrentSession()).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
  });

  it('拒绝没有配置、过短或包含非法字符的环境标识', () => {
    const sdk = { init: vi.fn() } as unknown as CloudBaseBrowserSdk;
    expect(() => createCloudBaseAdminRuntime({ sdk, environmentId: '', now: () => NOW })).toThrow('CLOUDBASE_ENVIRONMENT_ID_INVALID');
    expect(() => createCloudBaseAdminRuntime({ sdk, environmentId: 'ab', now: () => NOW })).toThrow('CLOUDBASE_ENVIRONMENT_ID_INVALID');
    expect(() => createCloudBaseAdminRuntime({ sdk, environmentId: 'yarei_m1', now: () => NOW })).toThrow('CLOUDBASE_ENVIRONMENT_ID_INVALID');
    expect(sdk.init).not.toHaveBeenCalled();
  });
});
