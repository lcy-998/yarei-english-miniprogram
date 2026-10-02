import { describe, expect, it, vi } from 'vitest';
import { MemoryTaskActivityClient } from '../src/services/memory-task-activities';
import { createTaskActivityClient } from '../src/cloud/task-activity-client';
import { MemoryAdminSessionStore } from '../src/cloud/admin-session-client';
import { selectTaskActivityClient } from '../src/services/task-activity-models';
import type { CloudBaseBrowserApp } from '../src/cloud/cloudbase-admin-runtime';

const date = new Date();
const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const filters = { startsOn: '2026-01-01', endsOn: day };
const allowed = { actorId: 'admin-zhou', actorName: '周老师', schoolIds: ['school-demo-001'],
  permissions: ['dashboard.view', 'organization.edit'] as const };

describe('M2 A-07 本地管理切片', () => {
  it('类型筛选与 CSV 使用同一数据，本地停用明确不可用且保留原记录', async () => {
    const client = new MemoryTaskActivityClient({ ...allowed, permissions: [...allowed.permissions] });
    const all = await client.list(filters, { limit: 20, offset: 0 });
    expect(all).toMatchObject({ ok: true, data: { total: 3 } });
    const filtered = await client.list({ ...filters, kind: 'classroom' }, { limit: 20, offset: 0 });
    expect(filtered).toMatchObject({ ok: true, data: { total: 1, items: [{ completionRate: 67,
      pendingReviewCount: 1, pendingCommentCount: 1 }] } });
    const csv = await client.exportCsv({ ...filters, kind: 'classroom' });
    if (!csv.ok) throw new Error('expected CSV');
    expect(csv.data.csv).toContain('动物主题阅读与单词');
    expect(csv.data.csv).not.toContain('七日阅读打卡');
    const stopped = await client.stop({ kind: 'classroom', id: 'task-demo-animals', expectedVersion: 1,
      operationId: 'op_1', reason: '虚构教学调整' });
    expect(stopped).toMatchObject({ ok: false, code: 'SERVICE_UNAVAILABLE' });
    expect(await client.detail('classroom', 'task-demo-animals')).toMatchObject({ ok: true, data: { item: { status: 'active' } } });
  });

  it('管理员无学校范围或管理权限时拒绝读取或停用', async () => {
    const noSchool = new MemoryTaskActivityClient({ ...allowed, schoolIds: [], permissions: [...allowed.permissions] });
    expect(await noSchool.list(filters, { limit: 20, offset: 0 })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    const otherSchool = new MemoryTaskActivityClient({ ...allowed, schoolIds: ['school-other'], permissions: [...allowed.permissions] });
    expect(await otherSchool.list(filters, { limit: 20, offset: 0 })).toMatchObject({ ok: true, data: { total: 0 } });
    const readOnly = new MemoryTaskActivityClient({ ...allowed, permissions: ['dashboard.view'] });
    expect(await readOnly.stop({ kind: 'template', id: 'template-demo-reading', expectedVersion: 1,
      operationId: 'op_1', reason: '虚构原因' })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });
});

describe('M2 A-07 云端管理员会话边界', () => {
  it('云端模式保持云端客户端，即使业务会话随后失效也不回退虚构数据', async () => {
    const now = new Date('2026-09-26T00:00:00Z');
    const sessions = new MemoryAdminSessionStore(() => now);
    const callFunction = vi.fn();
    const app = { callFunction, auth: () => ({ signInWithPassword: async () => ({}) }) } as CloudBaseBrowserApp;
    const cloud = createTaskActivityClient(app, sessions, () => now);
    const memory = new MemoryTaskActivityClient({ ...allowed, permissions: [...allowed.permissions] });
    const selected = selectTaskActivityClient(memory, cloud, true);
    expect(selected).toBe(cloud);
    expect(await selected.list(filters, { limit: 20, offset: 0 })).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' });
    expect(callFunction).not.toHaveBeenCalled();
  });

  it('只发送后台 token、当前筛选和版本；无有效后台会话拒绝调用', async () => {
    const now = new Date('2026-09-26T00:00:00Z');
    const sessions = new MemoryAdminSessionStore(() => now);
    const callFunction = vi.fn(async () => ({ result: { ok: true,
      data: { items: [], total: 0, nextOffset: null },
      meta: { requestId: 'req', serverTime: now.toISOString(), apiVersion: 'm1.v1' } } }));
    const app = { callFunction, auth: () => ({ signInWithPassword: async () => ({}) }) } as CloudBaseBrowserApp;
    const client = createTaskActivityClient(app, sessions, () => now);
    expect(await client.list(filters, { limit: 20, offset: 0 })).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' });
    expect(callFunction).not.toHaveBeenCalled();
    await sessions.save({ audience: 'admin-console', token: 'as1.virtual-admin-token',
      expiresAt: '2026-09-26T01:00:00Z' });
    expect(await client.list(filters, { limit: 20, offset: 0 })).toMatchObject({ ok: true, data: { total: 0 } });
    expect(callFunction).toHaveBeenCalledWith({ name: 'admin-task-activity-query', parse: true,
      data: { apiVersion: 'm1.v1', action: 'list', payload: { filters, page: { limit: 20, offset: 0 } },
        businessSessionToken: 'as1.virtual-admin-token' } });
    expect(JSON.stringify(callFunction.mock.calls)).not.toContain('actorUserId');
  });
});
