import { describe, expect, it, vi } from 'vitest';
import { createTaskQueryFunction, type TaskQueryHandler } from '../../functions/task-query/function-entry';
import type { TrustedActorContext, TrustedActorResolver } from '../../src/auth/trusted-actor';
import type { CloudBaseRuntimePort } from '../../src/runtime/ports';
import type { TeacherCheckListService } from '../../src/teacher-check/service';
import { validateTaskQueryRequest } from '../../src/contracts/task-query-functions';

const actor: TrustedActorContext = { requestId: 'req_demo', sessionId: 'ses_demo', actorUserId: 'teacher_demo',
  actorRole: 'teacher', organizationId: 'org_demo', platformSubjectDigest: 'digest_demo',
  permissions: ['task.read'], scopeIds: ['class_demo'], authzVersion: 1 };

describe('T-07 unified query contract', () => {
  it('passes only exact server-side filters and rejects forged actor fields', async () => {
    const list = vi.fn(async () => ({ items: [], total: 0, nextOffset: null }));
    const runtime: CloudBaseRuntimePort = { functionName: 'task-query',
      getPlatformSubject: async () => ({ subject: 'platform_demo', loginType: 'USERNAME', isAuthenticated: true }),
      getBusinessSessionId: async () => 'ses_demo' };
    const actorResolver: TrustedActorResolver = { resolve: async () => actor };
    const main = createTaskQueryFunction({ runtime, actorResolver,
      clock: { nowIso: () => '2026-10-02T09:00:00+08:00' }, requestIds: { next: () => 'req_output' },
      handler: {} as TaskQueryHandler, checkList: { list } as unknown as TeacherCheckListService });
    const request = { apiVersion: 'm1.v1' as const, action: 'listTeacherCheckItems' as const,
      payload: { filters: { type: 'checkin', status: 'active', classId: 'class_demo',
        startsOn: '2026-10-01', endsOn: '2026-10-07', keyword: '动物' }, page: { limit: 20, offset: 0 } } };
    expect(await main(request)).toMatchObject({ ok: true, data: { total: 0 } });
    expect(list).toHaveBeenCalledWith(actor, request.payload.filters, request.payload.page);
    expect(validateTaskQueryRequest({ ...request, payload: { ...request.payload,
      filters: { ...request.payload.filters, actorRole: 'admin' } } })).toMatchObject({ ok: false });
    expect(validateTaskQueryRequest({ ...request, payload: { ...request.payload,
      page: { limit: 20, offset: -1 } } })).toMatchObject({ ok: false });
  });
});
