import { describe, expect, it, vi } from 'vitest';
import { createOrganizationAdminFunction, type OrganizationAdminHandler } from '../../functions/organization-admin/function-entry';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { validateOrganizationAdminRequest } from '../../src/contracts/org-content-functions';
import type { QuestionAdminService } from '../../src/question-admin/service';
import type { StudentWorkAdminService } from '../../src/student-work/admin-service';

const actor: TrustedActorContext = { requestId: 'request_admin_restore', sessionId: 'admin_session',
  actorUserId: 'admin_demo', actorRole: 'admin', organizationId: 'org_demo',
  platformSubjectDigest: 'digest_admin', permissions: ['student_work.restore'],
  scopeIds: ['org_demo'], authzVersion: 1 };

function entry(current = actor) {
  const studentWorks = { listDeletedDrafts: vi.fn(async () => ({ items: [{ id: 'work_demo' }], nextOffset: null })),
    restoreDraft: vi.fn(async () => ({ id: 'work_demo', studentId: 'student_demo', materialId: 'material_demo',
      version: 3, restoredAt: '2026-09-27T09:00:00+08:00', restoredByUserId: current.actorUserId })) };
  const main = createOrganizationAdminFunction({
    runtime: { functionName: 'organization-admin',
      getPlatformSubject: async () => ({ subject: 'platform_admin', loginType: 'USERNAME', isAuthenticated: true }),
      getBusinessSessionId: async () => 'admin_session' },
    actorResolver: { resolve: async () => current },
    clock: { nowIso: () => '2026-09-27T09:00:00+08:00' },
    requestIds: { next: () => 'request_admin_result' },
    handler: {} as OrganizationAdminHandler, questions: {} as QuestionAdminService,
    studentWorks: studentWorks as unknown as StudentWorkAdminService,
  });
  return { main, studentWorks };
}

describe('A-03 organization-admin recovery contract', () => {
  it('dispatches only exact list and versioned restore payloads', async () => {
    const { main, studentWorks } = entry();
    const list = { apiVersion: 'm1.v1' as const, action: 'listDeletedWorkDrafts' as const,
      payload: { studentId: 'student_demo', page: { limit: 20, offset: 0 } } };
    expect(await main(list)).toMatchObject({ ok: true, data: { items: [{ id: 'work_demo' }] } });
    expect(studentWorks.listDeletedDrafts).toHaveBeenCalledWith(actor, 'student_demo', { limit: 20, offset: 0 });
    expect(await main({ ...list, operationId: 'operation_illegal_query' }))
      .toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(await main({ ...list, payload: { ...list.payload, organizationId: 'org_other' } }))
      .toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    const restore = { apiVersion: 'm1.v1' as const, action: 'restoreWorkDraft' as const,
      payload: { studentId: 'student_demo', workId: 'work_demo', reason: '核对误删记录' },
      expectedVersion: 2, operationId: 'operation_restore_function_1' };
    expect(await main(restore)).toMatchObject({ ok: true, data: { id: 'work_demo', version: 3 } });
    expect(studentWorks.restoreDraft).toHaveBeenCalledWith(actor, { action: 'restoreWorkDraft',
      ...restore.payload, expectedVersion: 2, operationId: restore.operationId });
    expect(await main({ ...restore, payload: { ...restore.payload, stagingFileId: 'cloud://forged.mp3' } }))
      .toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(await main({ ...restore, expectedVersion: 0 }))
      .toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
  });

  it('accepts the explicit permission in role assignments without granting it by default', () => {
    const validated = validateOrganizationAdminRequest({ apiVersion: 'm1.v1', action: 'assignRole',
      payload: { userId: 'admin_demo', role: 'admin', permissions: ['student_work.restore'],
        scopeType: 'organization', scopeIds: ['org_demo'], reason: '授权恢复误删草稿' },
      expectedVersion: 1, operationId: 'operation_assign_restore_role_1' });
    expect(validated).toMatchObject({ ok: true, value: { permissions: ['student_work.restore'] } });
  });
});
