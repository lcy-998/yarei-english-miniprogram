import { describe, expect, it } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { AdminTaskActivityService } from '../../src/admin-task-activity/service';
import { AdminTaskActivityWriteRepository } from '../../src/admin-task-activity/write-repository';
import { InMemoryActivityRepository } from '../../src/activity/memory-repository';
import { DocumentActivityRepository } from '../../src/activity/document-repository';
import { InMemoryOrgContentRepository } from '../../src/org-content/in-memory-repository';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import type { VersionedDocument } from '../../src/repositories/document-database-port';
import { InMemoryTaskQueryRepository } from '../../src/task-query/memory-repository';
import { InMemoryTemplateRepository } from '../../src/task-template/memory-repository';
import type { TaskRecord, TaskAssignmentRecord } from '../../src/task-core/types';
import type { ActivityEntity } from '../../src/activity/types';
import { activityDays } from '../../src/task-core/activity-rules';
import type { TaskTemplate } from '../../src/task-template/types';
import { validateAdminTaskActivityCommandRequest, validateAdminTaskActivityQueryRequest } from '../../src/contracts/admin-task-activity-functions';

const now = '2026-09-26T12:00:00.000+08:00';
const admin: TrustedActorContext = { requestId: 'req', sessionId: 'ses', actorUserId: 'admin_1',
  actorRole: 'admin', organizationId: 'org_1', platformSubjectDigest: 'digest',
  permissions: ['organization.read', 'organization.manage'], scopeIds: ['org_1'], authzVersion: 1 };
const filters = { startsOn: '2026-09-01', endsOn: '2026-09-30' };

const task: TaskRecord = { id: 'task_1', organizationId: 'org_1', creatorTeacherId: 'teacher_1',
  title: '=公式任务', deliveryType: 'classroom', status: 'active', targetType: 'classes',
  targetClassIds: ['class_1'], targetStudentIds: [], startsAt: '2026-09-20T08:00:00.000+08:00',
  dueAt: '2026-09-27T20:00:00.000+08:00', latePolicy: { allowLate: true, lateDays: 7 },
  description: null, teacherNote: '私密备注', itemRefs: [], items: [], publishedAt: now,
  deadlineExtendedAt: null, visibility: 'visible', withdrawnAt: null, withdrawnBy: null,
  withdrawReason: null, recycledAt: null, recycledBy: null, recycleReason: null, recoverableUntil: null, version: 1 };
const assignment: TaskAssignmentRecord = { id: 'assignment_1', organizationId: 'org_1', taskId: 'task_1',
  studentId: 'student_1', classId: 'class_1', status: 'awaiting_review', latestSubmissionId: null,
  latestSubmissionVersion: 0, redoCount: 0, redoDueAt: null, isLate: false,
  submittedAt: null, reviewedAt: null, version: 1 };
const activity: ActivityEntity = { id: 'activity_1', organizationId: 'org_1', creatorTeacherId: 'teacher_1',
  title: '虚构阅读打卡', description: '', status: 'draft', schedule: { classId: 'class_1',
    startsOn: '2026-09-21', endsOn: '2026-09-28', restDates: [], conditions: [], schoolTimeZone: 'Asia/Shanghai' },
  participants: [], conditionSnapshots: [], dailyInstances: [], version: 1, createdAt: now, updatedAt: now,
  publishedAt: null, closedAt: null };
const template: TaskTemplate = { id: 'template_1', organizationId: 'org_1', ownerTeacherId: 'teacher_1',
  scope: 'personal', title: '虚构模板', description: '', itemRefs: [], items: [],
  status: 'active', useCount: 0, version: 1, createdAt: now, updatedAt: now };

function service() {
  const organization = new InMemoryOrgContentRepository({ organizations: [{ id: 'org_1', name: '虚构学校',
    status: 'active', timeZone: 'Asia/Shanghai', version: 1 }], classes: [{ id: 'class_1', organizationId: 'org_1',
    name: '三年级 2 班', grade: '三年级', term: '上学期', status: 'active', version: 1 }],
  users: [{ id: 'teacher_1', organizationId: 'org_1', authorizationVersion: 1,
    displayName: '林老师', displayNameMasked: '林*师', roles: ['teacher'], status: 'active', version: 1 }] });
  const tasks = new InMemoryTaskQueryRepository({ tasks: [task], assignments: [assignment] });
  let count = 0;
  return new AdminTaskActivityService({ organization, tasks,
    activities: new InMemoryActivityRepository({ activities: [activity] }),
    templates: new InMemoryTemplateRepository({ templates: [template] }),
    writes: new AdminTaskActivityWriteRepository(new FakeDocumentDatabase()),
    clock: { nowIso: () => now }, requestIds: { next: () => `req_${++count}` } });
}

describe('M2 A-07 管理员任务与活动', () => {
  it('按组织范围和筛选查询三种布置方式，完成/待检查只来自任务关系', async () => {
    const handler = service();
    const list = await handler.list(admin, filters, { limit: 20, offset: 0 });
    expect(list).toMatchObject({ ok: true, data: { total: 3 } });
    if (!list.ok) throw new Error('expected list');
    expect(list.data.items.find((item) => item.kind === 'classroom')).toMatchObject({
      completedCount: 1, totalCount: 1, completionRate: 100, pendingReviewCount: 1,
      pendingCommentCount: 1, aiAssisted: false });
    expect(list.data.items.find((item) => item.kind === 'activity')).toMatchObject({ completionRate: null });
    expect(list.data.items.find((item) => item.kind === 'template')).toMatchObject({ completionRate: null, anomaly: '模板无内容' });
    expect(JSON.stringify(list)).not.toContain('私密备注');
    expect(await handler.list(admin, { ...filters, kind: 'activity' }, { limit: 20, offset: 0 }))
      .toMatchObject({ ok: true, data: { total: 1, items: [{ kind: 'activity' }] } });
    const exported = await handler.exportCsv(admin, { ...filters, kind: 'classroom' });
    if (!exported.ok) throw new Error('expected CSV');
    expect(exported.data.csv).toContain("'=公式任务");
    expect(exported.data.csv).not.toContain('虚构阅读打卡');
  });

  it('教师、跨组织范围及缺少管理权限不能执行管理动作', async () => {
    const handler = service();
    expect(await handler.list({ ...admin, actorRole: 'teacher' }, filters, { limit: 20, offset: 0 }))
      .toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(await handler.detail({ ...admin, scopeIds: ['org_other'] }, 'classroom', 'task_1'))
      .toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(await handler.stop({ ...admin, permissions: ['organization.read'] },
      { kind: 'classroom', id: 'task_1', expectedVersion: 1, operationId: 'op_1', reason: '虚构停用原因' }))
      .toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(validateAdminTaskActivityQueryRequest({ apiVersion: 'm1.v1', action: 'list',
      payload: { filters, page: { limit: 20, offset: 0 }, actorUserId: 'admin_1' } })).toMatchObject({ ok: false });
    expect(validateAdminTaskActivityCommandRequest({ apiVersion: 'm1.v1', action: 'stop',
      payload: { kind: 'classroom', id: 'task_1', reason: '停用', actorRole: 'admin' },
      operationId: 'op_1', expectedVersion: 1 })).toMatchObject({ ok: false });
  });

  it('停用使用版本、幂等收据和同事务审计；失败不改变原记录', async () => {
    const document: VersionedDocument = { _id: 'task_1', organizationId: 'org_1', schemaVersion: 1,
      version: 1, deletedAt: null, ...JSON.parse(JSON.stringify(task)) as Record<string, string | number | boolean | null | object> };
    const database = new FakeDocumentDatabase({ tasks: [document] });
    const writes = new AdminTaskActivityWriteRepository(database);
    const input = { organizationId: 'org_1', actorId: 'admin_1', kind: 'classroom' as const,
      id: 'task_1', expectedVersion: 1, operationId: 'op_stop_1', reason: '虚构教学安排调整', now, requestId: 'req_stop_1' };
    expect(await writes.stop(input)).toMatchObject({ status: 'closed', version: 2 });
    expect(await writes.stop(input)).toMatchObject({ status: 'closed', version: 2 });
    expect((await database.get('tasks', 'task_1'))?.status).toBe('closed');
    expect((await database.find('operation_logs', { organizationId: 'org_1' }))).toHaveLength(1);
    await expect(writes.stop({ ...input, operationId: 'op_stop_2', expectedVersion: 1 }))
      .rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await database.get('tasks', 'task_1'))?.version).toBe(2);
    expect((await database.find('operation_logs', { organizationId: 'org_1' }))).toHaveLength(1);
  });

  it('stops an activity while keeping its payload projection and daily snapshot readable', async () => {
    const readyActivity: ActivityEntity = { ...activity, schedule: { ...activity.schedule,
      conditions: [{ kind: 'reading', resourceId: 'book_demo' }] } };
    const document: VersionedDocument = { _id: readyActivity.id, organizationId: readyActivity.organizationId,
      schemaVersion: 1, version: 1, deletedAt: null, id: readyActivity.id, classId: 'class_1',
      creatorTeacherId: readyActivity.creatorTeacherId, status: 'draft', endsOn: readyActivity.schedule.endsOn,
      payload: JSON.parse(JSON.stringify(readyActivity)) as Record<string, string | number | boolean | null | object> };
    const database = new FakeDocumentDatabase({ checkin_activities: [document] });
    const writes = new AdminTaskActivityWriteRepository(database);
    const input = { organizationId: 'org_1', actorId: 'admin_1', kind: 'activity' as const,
      id: readyActivity.id, expectedVersion: 1, operationId: 'op_stop_activity',
      reason: '虚构活动调整', now, requestId: 'req_stop_activity' };
    expect(await writes.stop(input)).toMatchObject({ status: 'closed', version: 2 });
    const stored = await database.get('checkin_activities', readyActivity.id);
    expect(stored).toMatchObject({ status: 'closed', version: 2,
      payload: { status: 'closed', version: 2, closedAt: now, updatedAt: now } });
    expect(await new DocumentActivityRepository(database).transaction(transaction =>
      transaction.findActivity('org_1', readyActivity.id))).toMatchObject({ status: 'closed', version: 2 });
    expect(await writes.stop(input)).toMatchObject({ status: 'closed', version: 2 });
    expect((await database.find('operation_logs', { organizationId: 'org_1' }))).toHaveLength(1);
  });

  it('keeps published daily instances immutable after an administrator closes an activity', async () => {
    const schedule: ActivityEntity['schedule'] = { ...activity.schedule,
      conditions: [{ kind: 'reading', resourceId: 'book_demo' }] };
    const published: ActivityEntity = { ...activity, status: 'published', version: 2, schedule,
      participants: [{ studentId: 'student_1', displayNameMasked: '学员*一' }],
      conditionSnapshots: [{ kind: 'reading', resourceId: 'book_demo', contentVersion: 'v1', pageIds: ['page_1'] }],
      dailyInstances: activityDays(schedule).map(date => ({ id: `${activity.id}:${date}`, date,
        classId: schedule.classId, activityVersion: 2, createdAt: now })), publishedAt: now };
    const document: VersionedDocument = { _id: published.id, organizationId: published.organizationId,
      schemaVersion: 1, version: 2, deletedAt: null, id: published.id, classId: schedule.classId,
      creatorTeacherId: published.creatorTeacherId, status: 'published', endsOn: schedule.endsOn,
      payload: JSON.parse(JSON.stringify(published)) as Record<string, string | number | boolean | null | object> };
    const database = new FakeDocumentDatabase({ checkin_activities: [document] });
    const original = await new DocumentActivityRepository(database).transaction(transaction =>
      transaction.findActivity('org_1', published.id));
    expect(original?.dailyInstances).toHaveLength(activityDays(schedule).length);
    const result = await new AdminTaskActivityWriteRepository(database).stop({ organizationId: 'org_1',
      actorId: 'admin_1', kind: 'activity', id: published.id, expectedVersion: 2,
      operationId: 'op_stop_published_activity', reason: '虚构教学调整', now,
      requestId: 'req_stop_published_activity' });
    expect(result).toMatchObject({ status: 'closed', version: 3 });
    const closed = await new DocumentActivityRepository(database).transaction(transaction =>
      transaction.findActivity('org_1', published.id));
    expect(closed).toMatchObject({ status: 'closed', version: 3,
      dailyInstances: published.dailyInstances, participants: published.participants });
  });
});
