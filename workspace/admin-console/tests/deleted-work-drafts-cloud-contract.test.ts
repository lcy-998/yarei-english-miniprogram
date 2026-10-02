import { describe, expect, it, vi } from 'vitest';
import { ADMIN_FUNCTION_NAME, ADMIN_SESSION_AUDIENCE,
  type AdminFunctionInvoker, type OrganizationAdminWireRequest } from '../src/cloud/admin-cloud-contract';
import { createAdminCloudTransport } from '../src/cloud/admin-cloud-transport';
import { createOrganizationAdminClient } from '../src/cloud/organization-admin-client';

const NOW = new Date('2026-09-27T08:00:00.000Z');
const SESSION = { audience: ADMIN_SESSION_AUDIENCE, token: 'admin-work-draft-test-token',
  expiresAt: '2026-09-27T10:00:00.000Z' } as const;
const STUDENT_ID = 'student-demo-001';
const WORK_ID = 'work-demo-001';
const DRAFT = { id: WORK_ID, studentId: STUDENT_ID, materialId: 'material-demo-001',
  materialTitle: '虚构配音片段', version: 3, deletedAt: '2026-09-26T08:00:00.000Z',
  recoverableUntil: '2026-10-03T08:00:00.000Z', stagingCleanupStatus: 'none',
  restorable: true, blockedReason: null } as const;
function success(data: unknown): unknown {
  return { ok: true, data, meta: { requestId: 'req_work_001',
    serverTime: NOW.toISOString(), apiVersion: 'm1.v1' } };
}
function setup(result: unknown, session: unknown = SESSION) {
  const invoke = vi.fn(async (_name: typeof ADMIN_FUNCTION_NAME, _request: OrganizationAdminWireRequest) => result);
  const invoker: AdminFunctionInvoker = { invoke };
  const transport = createAdminCloudTransport({ invoker,
    sessions: { current: async () => session }, now: () => NOW });
  return { invoke, transport, client: createOrganizationAdminClient(transport) };
}

describe('A-03 已删作品草稿云端合约', () => {
  it('按学生记录分页，只向独立后台发送令牌和最小查询字段', async () => {
    const { client, invoke } = setup(success({ items: [DRAFT], nextOffset: null }));
    expect(await client.listDeletedWorkDrafts({ studentId: STUDENT_ID, page: { limit: 20, offset: 0 } }))
      .toMatchObject({ ok: true, data: { items: [{ id: WORK_ID, materialTitle: '虚构配音片段' }], nextOffset: null } });
    expect(invoke).toHaveBeenCalledWith(ADMIN_FUNCTION_NAME, { apiVersion: 'm1.v1',
      action: 'listDeletedWorkDrafts', payload: { studentId: STUDENT_ID, page: { limit: 20, offset: 0 } },
      businessSessionToken: SESSION.token });
    expect(JSON.stringify(invoke.mock.calls)).not.toContain('organizationId');
  });

  it('恢复只发送学生、作品、原因及顶层版本和操作标识', async () => {
    const restored = { id: WORK_ID, studentId: STUDENT_ID, materialId: DRAFT.materialId,
      version: 4, restoredAt: NOW.toISOString(), restoredByUserId: 'admin-demo-001' };
    const { client, invoke } = setup(success(restored));
    expect(await client.restoreWorkDraft({ studentId: STUDENT_ID, workId: WORK_ID,
      reason: '核对后恢复虚构草稿', expectedVersion: 3, operationId: 'restore-work-001' }))
      .toMatchObject({ ok: true, data: restored });
    expect(invoke).toHaveBeenCalledWith(ADMIN_FUNCTION_NAME, { apiVersion: 'm1.v1',
      action: 'restoreWorkDraft', payload: { studentId: STUDENT_ID, workId: WORK_ID,
        reason: '核对后恢复虚构草稿' }, businessSessionToken: SESSION.token,
      expectedVersion: 3, operationId: 'restore-work-001' });
  });

  it('拒绝非后台会话、越界分页和无原因恢复，不发起云调用', async () => {
    const mini = setup(success({ items: [], nextOffset: null }), { ...SESSION, audience: 'mini-program' });
    expect(await mini.client.listDeletedWorkDrafts({ studentId: STUDENT_ID,
      page: { limit: 20, offset: 0 } })).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
    expect(mini.invoke).not.toHaveBeenCalled();

    const { client, invoke } = setup(success({ items: [], nextOffset: null }));
    expect(await client.listDeletedWorkDrafts({ studentId: STUDENT_ID,
      page: { limit: 51, offset: 0 } })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(await client.restoreWorkDraft({ studentId: STUDENT_ID, workId: WORK_ID,
      reason: ' ', expectedVersion: 3, operationId: 'restore-work-001' }))
      .toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('拒绝跨学生摘要、媒体地址、错误恢复状态和额外恢复字段', async () => {
    const crossStudent = setup(success({ items: [{ ...DRAFT, studentId: 'student-other' }], nextOffset: null }));
    expect(await crossStudent.client.listDeletedWorkDrafts({ studentId: STUDENT_ID,
      page: { limit: 20, offset: 0 } })).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
    const media = setup(success({ items: [{ ...DRAFT, fileId: 'cloud://hidden-media' }], nextOffset: null }));
    expect(await media.client.listDeletedWorkDrafts({ studentId: STUDENT_ID,
      page: { limit: 20, offset: 0 } })).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
    const blocked = setup(success({ items: [{ ...DRAFT, restorable: true, blockedReason: 'expired' }], nextOffset: null }));
    expect(await blocked.client.listDeletedWorkDrafts({ studentId: STUDENT_ID,
      page: { limit: 20, offset: 0 } })).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
    const restored = setup(success({ id: WORK_ID, studentId: STUDENT_ID, materialId: DRAFT.materialId,
      version: 4, restoredAt: NOW.toISOString(), restoredByUserId: 'admin-demo-001', fileId: 'cloud://hidden-media' }));
    expect(await restored.client.restoreWorkDraft({ studentId: STUDENT_ID, workId: WORK_ID,
      reason: '核对后恢复虚构草稿', expectedVersion: 3, operationId: 'restore-work-001' }))
      .toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
  });

  it('角色解析接受明确 student_work.restore 权限', async () => {
    const role = { id: 'role-demo-admin', userId: 'admin-demo-001', role: 'admin', status: 'active',
      permissions: ['organization.read', 'student_work.restore'], scopeType: 'organization',
      scopeIds: ['school-demo-001'], version: 1 };
    const { client } = setup(success({ items: [role], total: 1, nextOffset: null }));
    expect(await client.listRoleAssignments({ page: { limit: 20, offset: 0 } }))
      .toMatchObject({ ok: true, data: { items: [{ permissions: ['organization.read', 'student_work.restore'] }] } });
  });
});
