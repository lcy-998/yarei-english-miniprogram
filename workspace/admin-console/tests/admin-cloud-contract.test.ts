import { describe, expect, it, vi } from 'vitest';
import {
  ADMIN_FUNCTION_NAME,
  ADMIN_SESSION_AUDIENCE,
  UnconfiguredAdminSessionSource,
  type AdminFunctionInvoker,
  type AdminSessionSource,
  type OrganizationAdminWireRequest,
} from '../src/cloud/admin-cloud-contract';
import { createAdminCloudTransport } from '../src/cloud/admin-cloud-transport';
import { createOrganizationAdminClient } from '../src/cloud/organization-admin-client';

const NOW = new Date('2026-09-17T04:00:00.000Z');
const VALID_SESSION = {
  audience: ADMIN_SESSION_AUDIENCE,
  token: 'admin-session-token-for-tests',
  expiresAt: '2026-09-17T06:00:00.000Z',
} as const;

function success(data: unknown): unknown {
  return {
    ok: true,
    data,
    meta: { requestId: 'req_admin_001', serverTime: '2026-09-17T04:00:01.000Z', apiVersion: 'm1.v1' },
  };
}

function setup(result: unknown, sessions: AdminSessionSource = { current: async () => VALID_SESSION }) {
  const invoke = vi.fn(async (_name: typeof ADMIN_FUNCTION_NAME, _request: OrganizationAdminWireRequest) => result);
  const invoker: AdminFunctionInvoker = { invoke };
  const transport = createAdminCloudTransport({ invoker, sessions, now: () => NOW });
  return { invoke, transport, client: createOrganizationAdminClient(transport) };
}

describe('管理后台独立云会话边界', () => {
  it('未配置会话时失败关闭且不会触发调用', async () => {
    const { invoke, client } = setup(success([]), new UnconfiguredAdminSessionSource());

    expect(await client.listClasses()).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('拒绝小程序 audience 和过期后台会话', async () => {
    const mini = setup(success([]), { current: async () => ({ ...VALID_SESSION, audience: 'mini-program' }) });
    expect(await mini.client.listClasses()).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
    expect(mini.invoke).not.toHaveBeenCalled();

    const expired = setup(success([]), { current: async () => ({ ...VALID_SESSION, expiresAt: '2026-09-17T03:59:59.000Z' }) });
    expect(await expired.client.listClasses()).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
    expect(expired.invoke).not.toHaveBeenCalled();
  });

  it('会话来源异常时返回安全错误且不会泄露原始异常', async () => {
    const { invoke, client } = setup(success([]), { current: async () => { throw new Error('storage path and token details'); } });

    expect(await client.listClasses()).toEqual({
      ok: false,
      error: { code: 'SERVICE_UNAVAILABLE', message: '后台服务尚未配置或暂不可用。', retryable: true },
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('只发送 token 和严格 organization-admin 信封，不发送客户端角色或权限结论', async () => {
    const { invoke, client } = setup(success([{ id: 'cls_demo', name: '三年级 2 班', grade: '三年级', term: '2026 秋季', status: 'active', version: 1 }]));

    expect(await client.listClasses()).toMatchObject({ ok: true, data: [{ id: 'cls_demo' }] });
    expect(invoke).toHaveBeenCalledWith(ADMIN_FUNCTION_NAME, {
      apiVersion: 'm1.v1',
      action: 'listClasses',
      payload: {},
      businessSessionToken: VALID_SESSION.token,
    });
    expect(JSON.stringify(invoke.mock.calls[0])).not.toContain('permissions');
    expect(JSON.stringify(invoke.mock.calls[0])).not.toContain('actorRole');
  });
});

describe('organization-admin transport 与 view model', () => {
  it('写请求严格分离 payload、版本和幂等键', async () => {
    const { invoke, client } = setup(success({ id: 'cls_new', name: '五年级 1 班', grade: '五年级', term: '2026 秋季', status: 'active', version: 1 }));

    const result = await client.createClass({
      name: '五年级 1 班', grade: '五年级', term: '2026 秋季', reason: '建立虚构演示班级', expectedVersion: 1, operationId: 'operation_class_001',
    });

    expect(result).toMatchObject({ ok: true, data: { id: 'cls_new' } });
    expect(invoke.mock.calls[0]?.[1]).toEqual({
      apiVersion: 'm1.v1', action: 'createClass',
      payload: { name: '五年级 1 班', grade: '五年级', term: '2026 秋季', reason: '建立虚构演示班级' },
      businessSessionToken: VALID_SESSION.token, expectedVersion: 1, operationId: 'operation_class_001',
    });
  });

  it('拒绝含额外敏感字段的响应，不把非合约数据交给页面', async () => {
    const { client } = setup(success([{
      id: 'usr_demo', displayName: '演示用户', displayNameMasked: '演**', mobileMasked: '138****0001',
      mobile: '13800000001', roles: ['student'], status: 'active', version: 1,
    }]));

    expect(await client.listUsers()).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
  });

  it('只使用本地安全错误文案，不透传服务端或平台异常详情', async () => {
    const { client } = setup({
      ok: false,
      error: { code: 'FORBIDDEN', message: 'internal collection and stack details', retryable: true },
      meta: { requestId: 'req_admin_002', serverTime: '2026-09-17T04:00:01.000Z', apiVersion: 'm1.v1' },
    });

    expect(await client.listClasses()).toEqual({
      ok: false,
      error: { code: 'FORBIDDEN', message: '当前后台账号没有执行此操作的权限。', retryable: false },
      requestId: 'req_admin_002',
    });
  });

  it('本地拒绝未知字段，避免被类型绕过后发送扩大动作', async () => {
    const { invoke, transport } = setup(success([]));
    const result = await transport.invoke({ action: 'listClasses', payload: { organizationId: 'other-org' } } as never);

    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(invoke).not.toHaveBeenCalled();
  });
});
