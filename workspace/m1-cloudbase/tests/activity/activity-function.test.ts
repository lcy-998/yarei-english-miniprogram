import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createActivityCommandFunction, main as unconfiguredCommand } from '../../functions/activity-command';
import { createActivityQueryFunction, main as unconfiguredQuery } from '../../functions/activity-query';
import type { TrustedActorContext, TrustedActorResolver } from '../../src/auth/trusted-actor';
import { ActivityService } from '../../src/activity/activity-service';
import { InMemoryActivityRepository } from '../../src/activity/memory-repository';
import type { CloudBaseRuntimePort } from '../../src/runtime/ports';

const organizationId = 'org_activity_function';
const classId = 'class_activity_function';
const teacherId = 'teacher_activity_function';
const studentId = 'student_activity_function';
const teacher: TrustedActorContext = { requestId: 'request_teacher', sessionId: 'session_teacher', actorUserId: teacherId,
  actorRole: 'teacher', organizationId, platformSubjectDigest: 'digest_teacher', permissions: ['task.publish', 'task.read'],
  scopeIds: [classId], authzVersion: 1 };
const student: TrustedActorContext = { ...teacher, requestId: 'request_student', sessionId: 'session_student',
  actorUserId: studentId, actorRole: 'student', permissions: [], scopeIds: [] };
let currentTime = '2026-09-26T04:00:00.000Z';
const clock = { nowIso: () => currentTime };
const requestIds = { next: () => 'request_activity_result' };
let idSequence = 0;
const ids = { next: (prefix: string) => `${prefix}_function_${++idSequence}` };

function service(): ActivityService {
  return new ActivityService(new InMemoryActivityRepository({
    organizations: [{ id: organizationId, status: 'active', timeZone: 'Asia/Shanghai' }],
    classes: [{ id: classId, organizationId, status: 'active' }],
    grants: [{ organizationId, teacherId, classId, status: 'active', permissions: ['task.publish', 'task.read'] }],
    memberships: [{ organizationId, classId, studentId, status: 'active' }],
    users: [{ id: studentId, organizationId, status: 'active', displayNameMasked: '小宇' }],
    resources: [{ id: 'read_demo', organizationId, type: 'reading', status: 'published', contentVersion: 'demo-v1', pageIds: ['page_1'],
      visibility: { type: 'classes', classIds: [classId] } }],
  }), clock, ids);
}

function boundary(functionName: CloudBaseRuntimePort['functionName'], actor: TrustedActorContext) {
  const runtime: CloudBaseRuntimePort = { functionName,
    getPlatformSubject: vi.fn(async () => ({ subject: 'platform_subject', loginType: 'USERNAME' as const, isAuthenticated: true })),
    getBusinessSessionId: vi.fn(async () => 'trusted_session_id') };
  const actorResolver: TrustedActorResolver = { resolve: vi.fn(async () => actor) };
  return { runtime, actorResolver, clock, requestIds };
}

const draftPayload = { title: '虚构阅读打卡', classId, startsOn: '2026-09-27', endsOn: '2026-09-29',
  restDates: ['2026-09-28'], conditions: [{ kind: 'reading', resourceId: 'read_demo' }] };

describe('M2 trusted activity functions', () => {
  beforeEach(() => { currentTime = '2026-09-26T04:00:00.000Z'; });
  it('validates commands, binds the trusted teacher and allows only snapshotted student reads', async () => {
    const handler = service();
    const command = createActivityCommandFunction({ ...boundary('activity-command', teacher), service: handler });
    const saved = await command({ apiVersion: 'm1.v1', action: 'saveDraft', payload: draftPayload,
      expectedVersion: 0, operationId: 'operation_activity_function_draft' });
    expect(saved).toMatchObject({ ok: true, data: { status: 'draft', schedule: { schoolTimeZone: 'Asia/Shanghai' } } });
    if (!saved.ok) throw new Error('draft missing');
    expect(await command({ apiVersion: 'm1.v1', action: 'publish', payload: { activityId: saved.data.id },
      expectedVersion: 1, operationId: 'operation_activity_function_publish' }))
      .toMatchObject({ ok: true, data: { status: 'published', participants: [{ studentId }] } });
    const studentQuery = createActivityQueryFunction({ ...boundary('activity-query', student), service: handler });
    expect(await studentQuery({ apiVersion: 'm1.v1', action: 'getForStudent', payload: { activityId: saved.data.id } }))
      .toMatchObject({ ok: true, data: { id: saved.data.id } });
    expect(await studentQuery({ apiVersion: 'm1.v1', action: 'listForStudent', payload: {} }))
      .toMatchObject({ ok: true, data: [{ id: saved.data.id }] });
    expect(await studentQuery({ apiVersion: 'm1.v1', action: 'getMyDay', payload: { activityId: saved.data.id,
      date: '2026-09-27' } })).toMatchObject({ ok: true, data: { complete: false,
        evidenceStatus: 'available', verifiedConditions: 0, totalConditions: 1 } });
    currentTime = '2026-09-27T10:00:00+08:00';
    expect(await command({ apiVersion: 'm1.v1', action: 'addFutureRestDay', payload: {
      activityId: saved.data.id, date: '2026-09-29', reason: '校内活动日',
    }, expectedVersion: 2, operationId: 'operation_activity_function_rest' }))
      .toMatchObject({ ok: true, data: { version: 3, schedule: { restDates: ['2026-09-28', '2026-09-29'] },
        restDayChanges: [{ date: '2026-09-29', reason: '校内活动日' }] } });
    expect(await command({ apiVersion: 'm1.v1', action: 'setOverride', payload: {
      activityId: saved.data.id, studentId, date: '2026-09-27', active: true, reason: '核对线下作品',
    }, expectedVersion: 0, operationId: 'operation_activity_function_override' }))
      .toMatchObject({ ok: true, data: { active: true, version: 1 } });
    expect(await studentQuery({ apiVersion: 'm1.v1', action: 'getMyDay', payload: { activityId: saved.data.id,
      date: '2026-09-27' } })).toMatchObject({ ok: true, data: { complete: true, supplemented: true } });
    expect(await studentQuery({ apiVersion: 'm1.v1', action: 'getLeaderboard', payload: {
      activityId: saved.data.id,
    } })).toMatchObject({ ok: true, data: { evidenceStatus: 'available', myRank: { studentId, rank: 1 } } });
    const teacherQuery = createActivityQueryFunction({ ...boundary('activity-query', teacher), service: handler });
    expect(await teacherQuery({ apiVersion: 'm1.v1', action: 'getOverrideForTeacher', payload: {
      activityId: saved.data.id, studentId, date: '2026-09-27',
    } })).toMatchObject({ ok: true, data: { version: 1, active: true } });
    expect(await studentQuery({ apiVersion: 'm1.v1', action: 'getOverrideForTeacher', payload: {
      activityId: saved.data.id, studentId, date: '2026-09-27',
    } })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(await studentQuery({ apiVersion: 'm1.v1', action: 'getMyDay', payload: { activityId: saved.data.id,
      date: '2026-09-31' } })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(await studentQuery({ apiVersion: 'm1.v1', action: 'listForTeacher', payload: {} }))
      .toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(await teacherQuery({ apiVersion: 'm1.v1', action: 'listForStudent', payload: {} }))
      .toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(await studentQuery({ apiVersion: 'm1.v1', action: 'getForStudent', payload: { activityId: saved.data.id },
      operationId: 'operation_query_forbidden' })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
  });

  it('rejects actor injection, unapproved conditions and missing write versions before service calls', async () => {
    const command = createActivityCommandFunction({ ...boundary('activity-command', teacher), service: service() });
    expect(await command({ apiVersion: 'm1.v1', action: 'saveDraft', payload: { ...draftPayload, actorUserId: teacherId },
      expectedVersion: 0, operationId: 'operation_activity_forged_actor' }))
      .toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(await command({ apiVersion: 'm1.v1', action: 'addFutureRestDay', payload: {
      activityId: 'activity_demo', date: '2026-09-30', reason: '不可信变更', actorUserId: teacherId,
    }, expectedVersion: 2, operationId: 'operation_activity_forged_rest' }))
      .toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(await command({ apiVersion: 'm1.v1', action: 'saveDraft', payload: { ...draftPayload,
      conditions: [{ kind: 'ai_score', resourceId: 'fake_ai', minimumScore: 60 }] },
    expectedVersion: 0, operationId: 'operation_activity_ai' }))
      .toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(await command({ apiVersion: 'm1.v1', action: 'saveDraft', payload: draftPayload,
      operationId: 'operation_activity_no_version' })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(await command({ apiVersion: 'm1.v1', action: 'setOverride', payload: {
      activityId: 'activity_demo', studentId, date: '2026-09-27', active: true,
      reason: '核对线下作品', actorUserId: teacherId,
    }, expectedVersion: 0, operationId: 'operation_activity_forged_override' }))
      .toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
  });

  it('unconfigured production mains fail closed after request validation', async () => {
    expect(await unconfiguredCommand({ apiVersion: 'm1.v1', action: 'saveDraft', payload: draftPayload,
      operationId: 'operation_activity_unconfigured', expectedVersion: 0 }))
      .toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } });
    expect(await unconfiguredQuery({ apiVersion: 'm1.v1', action: 'getForStudent', payload: { activityId: 'activity_missing' } }))
      .toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } });
    expect(await unconfiguredCommand({ apiVersion: 'm1.v1', action: 'publish', payload: { activityId: 'activity_missing', actorRole: 'teacher' },
      operationId: 'operation_activity_invalid', expectedVersion: 1 }))
      .toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
  });
});
