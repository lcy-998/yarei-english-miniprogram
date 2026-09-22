import { describe, expect, it, vi } from 'vitest';
import {
  ADMIN_FUNCTION_NAME,
  ADMIN_SESSION_AUDIENCE,
  type AdminFunctionInvoker,
  type OrganizationAdminWireRequest,
} from '../src/cloud/admin-cloud-contract';
import { createAdminCloudTransport } from '../src/cloud/admin-cloud-transport';
import { createOrganizationAdminClient } from '../src/cloud/organization-admin-client';

const NOW = new Date('2026-09-17T04:00:00.000Z');
const SESSION = {
  audience: ADMIN_SESSION_AUDIENCE,
  token: 'admin-session-token-for-read-tests',
  expiresAt: '2026-09-17T06:00:00.000Z',
} as const;
const PAGE = { limit: 20, offset: 0 } as const;

function success(data: unknown): unknown {
  return {
    ok: true,
    data,
    meta: { requestId: 'req_admin_read_001', serverTime: '2026-09-17T04:00:01.000Z', apiVersion: 'm1.v1' },
  };
}

function setup(result: unknown) {
  const invoke = vi.fn(async (_name: typeof ADMIN_FUNCTION_NAME, _request: OrganizationAdminWireRequest) => result);
  const invoker: AdminFunctionInvoker = { invoke };
  const transport = createAdminCloudTransport({ invoker, sessions: { current: async () => SESSION }, now: () => NOW });
  return { invoke, transport, client: createOrganizationAdminClient(transport) };
}

const DASHBOARD = {
  range: { from: '2026-09-10T04:00:00.000Z', to: '2026-09-17T04:00:00.000Z' },
  counts: { organizationCount: 1, classCount: 2, activeUserCount: 35, taskCount: 4 },
  completion: { assignmentCount: 30, completedCount: 24, completionRate: 80 },
  anomalies: { overdueCount: 2, pendingReviewCount: 3 },
} as const;

const ROLE = {
  id: 'role_demo', userId: 'usr_teacher_demo', role: 'teacher', status: 'active',
  permissions: ['class.read', 'audit.read'], scopeType: 'classes', scopeIds: ['cls_demo'], version: 2,
} as const;

const AUDIT = {
  id: 'audit_demo', requestId: 'req_audit_demo', actorUserId: 'usr_admin_demo', actorRole: 'admin',
  action: 'role.assigned', targetType: 'role_assignment', targetId: 'role_demo', result: 'succeeded', errorCode: null,
  metadata: { classId: 'cls_demo', role: 'teacher', permissionCount: 2, reasonProvided: true },
  occurredAt: '2026-09-17T03:00:00.000Z',
} as const;

describe('A-01/A-04 管理端云读取合约', () => {
  it('概览查询发送可选 ISO 时间窗并严格解析嵌套统计', async () => {
    const { client, invoke } = setup(success(DASHBOARD));
    const range = { from: DASHBOARD.range.from, to: DASHBOARD.range.to };

    expect(await client.getDashboardOverview(range)).toEqual({ ok: true, data: DASHBOARD, requestId: 'req_admin_read_001' });
    expect(invoke).toHaveBeenCalledWith(ADMIN_FUNCTION_NAME, {
      apiVersion: 'm1.v1', action: 'getDashboardOverview', payload: range, businessSessionToken: SESSION.token,
    });
  });

  it('本地拒绝缺半边、无时区和超过 31 天的概览时间窗', async () => {
    const { client, invoke } = setup(success(DASHBOARD));

    expect(await client.getDashboardOverview({ from: DASHBOARD.range.from })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(await client.getDashboardOverview({ from: '2026-09-01T00:00:00', to: '2026-09-02T00:00:00' })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(await client.getDashboardOverview({ from: '2026-08-01T00:00:00.000Z', to: '2026-09-17T00:00:00.000Z' })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('角色分页使用 exact filter/page 并接受 audit.read 权限', async () => {
    const { client, invoke } = setup(success({ items: [ROLE], total: 1, nextOffset: null }));
    const filter = { role: 'teacher' as const, status: 'active' as const, scopeType: 'classes' as const };

    expect(await client.listRoleAssignments({ filter, page: PAGE })).toMatchObject({
      ok: true, data: { items: [{ id: 'role_demo', permissions: ['class.read', 'audit.read'] }], total: 1, nextOffset: null },
    });
    expect(invoke.mock.calls[0]?.[1]).toMatchObject({
      action: 'listRoleAssignments', payload: { filter, page: PAGE }, businessSessionToken: SESSION.token,
    });
  });

  it('审计分页只接受固定 filter 和 metadata 白名单', async () => {
    const { client, invoke } = setup(success({ items: [AUDIT], total: 1, nextOffset: null }));
    const filter = { result: 'succeeded' as const, from: '2026-09-16T00:00:00.000Z', to: '2026-09-17T04:00:00.000Z' };

    expect(await client.listAuditLogs({ filter, page: PAGE })).toMatchObject({
      ok: true, data: { items: [{ id: 'audit_demo', metadata: AUDIT.metadata }], total: 1, nextOffset: null },
    });
    expect(invoke.mock.calls[0]?.[1]).toMatchObject({ action: 'listAuditLogs', payload: { filter, page: PAGE } });
  });

  it('拒绝嵌套额外请求字段和越界分页，且不会调用云函数', async () => {
    const { transport, invoke } = setup(success({ items: [], total: 0, nextOffset: null }));

    expect(await transport.invoke({
      action: 'listRoleAssignments', payload: { filter: { organizationId: 'org_other' }, page: PAGE },
    } as never)).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(await transport.invoke({
      action: 'listAuditLogs', payload: { filter: {}, page: { limit: 51, offset: 0 } },
    } as never)).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('服务端额外字段、坏分页、坏时间和敏感 metadata 全部失败关闭', async () => {
    const extra = setup(success({ ...DASHBOARD, rawUserIds: ['usr_private'] }));
    expect(await extra.client.getDashboardOverview()).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });

    const badTime = setup(success({ ...DASHBOARD, range: { ...DASHBOARD.range, to: 'not-a-time' } }));
    expect(await badTime.client.getDashboardOverview()).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });

    const badPage = setup(success({ items: [ROLE], total: 2, nextOffset: null }));
    expect(await badPage.client.listRoleAssignments({ page: PAGE })).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });

    const sensitive = setup(success({
      items: [{ ...AUDIT, metadata: { ...AUDIT.metadata, mobile: '13800000000' } }], total: 1, nextOffset: null,
    }));
    expect(await sensitive.client.listAuditLogs({ page: PAGE })).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });

    const itemExtra = setup(success({
      items: [{ ...AUDIT, stack: 'private-stack' }], total: 1, nextOffset: null,
    }));
    expect(await itemExtra.client.listAuditLogs({ page: PAGE })).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
  });
});

