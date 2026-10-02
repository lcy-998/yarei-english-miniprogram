import { describe, expect, it, vi } from 'vitest';
import type { ActivityService } from '../../src/activity/activity-service';
import type { ActivityEntity } from '../../src/activity/types';
import { NotificationMaintenance } from '../../src/notification/maintenance';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import type { VersionedDocument } from '../../src/repositories/document-database-port';
import type { JsonValue } from '../../src/shared/protocol';
import { createMaintenanceTimerFunction } from '../../functions/maintenance-timer';

const org = 'org_qihang_demo';
const studentId = 'student_xiaoyu_demo';
const parentId = 'parent_xiaoyu_demo';
const classId = 'class_grade3_demo';
const activityId = 'activity_reading_demo';
const now = '2026-09-26T12:30:00.000Z'; // 20:30 in Asia/Shanghai

function document(id: string, data: Record<string, JsonValue>, organizationId = org): VersionedDocument {
  return { _id: id, organizationId, schemaVersion: 1, version: 1, deletedAt: null, ...data };
}
function activityStub(complete: boolean | null) {
  const mock = { getMyDay: vi.fn(async () => ({ complete })), finalizeActivity: vi.fn(async () => ({})) };
  return mock as unknown as Pick<ActivityService, 'getMyDay' | 'finalizeActivity'>;
}
function dailyInstances(id: string, startsOn: string, endsOn: string): ActivityEntity['dailyInstances'] {
  const days: { id: string; date: string; classId: string; activityVersion: number; createdAt: string }[] = [];
  for (let at = Date.parse(`${startsOn}T00:00:00.000Z`); at <= Date.parse(`${endsOn}T00:00:00.000Z`); at += 86400000) {
    const date = new Date(at).toISOString().slice(0, 10);
    days.push({ id: `${id}:${date}`, date, classId, activityVersion: 1, createdAt: '2026-09-25T02:00:00.000Z' });
  }
  return days;
}
function fixture(at = now, taskCount = 1, endsOn = '2026-09-27') {
  const activityEntity: ActivityEntity = { id: activityId, organizationId: org, creatorTeacherId: 'teacher_lin_demo',
    title: '21 天阅读打卡', description: '', status: 'published',
    schedule: { classId, schoolTimeZone: 'Asia/Shanghai', startsOn: '2026-09-25', endsOn,
      restDates: [], conditions: [{ kind: 'reading', resourceId: 'read_zoo_demo' }] },
    participants: [{ studentId, displayNameMasked: '小宇' }],
    conditionSnapshots: [{ kind: 'reading', resourceId: 'read_zoo_demo', contentVersion: 'demo-v1', pageIds: ['page_1'] }],
    dailyInstances: dailyInstances(activityId, '2026-09-25', endsOn),
    version: 1, createdAt: '2026-09-25T01:00:00.000Z', updatedAt: '2026-09-25T02:00:00.000Z',
    publishedAt: '2026-09-25T02:00:00.000Z', closedAt: null };
  const tasks = Array.from({ length: taskCount }, (_, index) => document(`task_${index}`, {
    title: '动物主题听说练习', status: index === 0 ? 'active' : 'draft',
    visibility: 'visible', publishedAt: '2026-09-25T02:00:00.000Z', dueAt: '2026-09-27T06:00:00.000Z',
  }));
  const database = new FakeDocumentDatabase({
    organizations: [document(org, { status: 'active', timeZone: 'Asia/Shanghai' })],
    users: [document(studentId, { status: 'active' }), document(parentId, { status: 'active' })],
    class_memberships: [document('membership_1', { studentId, classId, status: 'active' })],
    parent_student_links: [document('parent_link_1', { studentId, parentId, status: 'active' })],
    tasks,
    task_assignments: [document('assignment_1', { id: 'assignment_1', taskId: 'task_0', studentId,
      classId, status: 'in_progress' })],
    checkin_activities: [document(activityId, { classId, endsOn, creatorTeacherId: activityEntity.creatorTeacherId,
      status: 'published', payload: activityEntity as unknown as JsonValue })],
  });
  const activity = activityStub(false);
  const maintenance = new NotificationMaintenance(database, { nowIso: () => at },
    { next: prefix => `${prefix}_demo` }, activity);
  return { database, maintenance, activity };
}

describe('M2 trusted timer maintenance', () => {
  it('rejects forged Timer payloads without trusted server trigger source', async () => {
    const run = vi.fn(async () => ({ scannedOrganizations: 0, scannedTasks: 0, scannedActivities: 0,
      createdDueReminders: 0, createdCheckinReminders: 0, finalizedActivities: 0,
      pendingRecoveryActivities: 0 }));
    const event = { Type: 'Timer', TriggerName: 'yarei_maintenance_minute', Time: now };
    const dependencies = { maintenance: { run }, clock: { nowIso: () => now }, requestIds: { next: () => 'request_timer_demo' } };
    expect(await createMaintenanceTimerFunction({ ...dependencies, trustedTriggerSource: () => 'sdk' })(event))
      .toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(await createMaintenanceTimerFunction({ ...dependencies, trustedTriggerSource: () => null })(event))
      .toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(await createMaintenanceTimerFunction({ ...dependencies, trustedTriggerSource: () => 'timer' })
      ({ ...event, TriggerName: 'forged' })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(run).not.toHaveBeenCalled();
    expect(await createMaintenanceTimerFunction({ ...dependencies, trustedTriggerSource: () => 'timer' })(event))
      .toMatchObject({ ok: true, data: { scannedOrganizations: 0 } });
  });

  it('writes due and 20:00 incomplete reminders once with actual late trigger time', async () => {
    const { database, maintenance } = fixture();
    const first = await maintenance.run();
    expect(first).toMatchObject({ scannedOrganizations: 1, scannedTasks: 1, scannedActivities: 1,
      createdDueReminders: 2, createdCheckinReminders: 1 });
    const events = database.snapshot().notification_events ?? [];
    expect(events).toHaveLength(3);
    expect(events.every(event => event.occurredAt === now)).toBe(true);
    const second = await maintenance.run();
    expect(second).toMatchObject({ createdDueReminders: 0, createdCheckinReminders: 0 });
    expect(database.snapshot().notification_events).toHaveLength(3);
  });

  it('bounds each scan and resumes at the persisted task offset', async () => {
    const { database, maintenance } = fixture(now, 31);
    expect((await maintenance.run()).scannedTasks).toBe(25);
    expect((await maintenance.run()).scannedTasks).toBe(6);
    expect(database.snapshot().notification_events).toHaveLength(3);
  });

  it('resumes the ending-day priority cursor across ticks when more than 100 activities end together', async () => {
    const at = '2026-09-27T16:02:00.000Z';
    const seed = fixture(at, 0, '2026-09-27').database.snapshot();
    const original = seed.checkin_activities![0]!;
    const earlier = Array.from({ length: 125 }, (_, index) => {
      const id = `activity_a_${String(index).padStart(3, '0')}`;
      const payload = { ...(original.payload as unknown as ActivityEntity), id,
        dailyInstances: dailyInstances(id, '2026-09-25', '2026-09-27') };
      return document(id, { classId, endsOn: '2026-09-27', creatorTeacherId: payload.creatorTeacherId,
        status: 'published', payload: payload as unknown as JsonValue });
    });
    const database = new FakeDocumentDatabase({ ...seed, checkin_activities: [...earlier, original] });
    const activity = activityStub(false);
    const maintenance = new NotificationMaintenance(database, { nowIso: () => at },
      { next: prefix => `${prefix}_priority` }, activity);
    await maintenance.run();
    expect(activity.finalizeActivity).not.toHaveBeenCalledWith(org, activityId);
    expect(database.snapshot().maintenance_scan_state?.find(item => item._id
      === `maintenance_finalization:${org}:2026-09-27`)).toMatchObject({ offset: 100 });
    await maintenance.run();
    expect(activity.finalizeActivity).toHaveBeenCalledWith(org, activityId);
  });

  it('records missed leaderboard finalization without recalculating the current evidence', async () => {
    const late = '2026-09-27T16:06:00.000Z'; // Next local day, 00:06
    const { database, maintenance, activity } = fixture(late, 1, '2026-09-27');
    expect(await maintenance.run()).toMatchObject({ pendingRecoveryActivities: 1, finalizedActivities: 0 });
    expect(database.snapshot().checkin_finalization_recovery).toMatchObject([
      { activityId, status: 'pending', reason: 'window_missed' },
    ]);
    expect(activity.finalizeActivity).not.toHaveBeenCalled();
    expect(database.snapshot().checkin_final_boards ?? []).toHaveLength(0);
  });

  it('does not finalize or open a recovery for a closed draft that was never published', async () => {
    const late = '2026-09-27T16:06:00.000Z';
    const { database, maintenance, activity } = fixture(late, 0, '2026-09-27');
    const stored = database.snapshot().checkin_activities?.[0];
    if (!stored) throw new Error('activity document missing');
    const payload = stored.payload as unknown as ActivityEntity;
    await database.runTransaction(tx => tx.replace('checkin_activities', activityId, 1,
      { ...stored, version: 2, status: 'closed', payload: { ...payload, status: 'closed', version: 2,
        participants: [], conditionSnapshots: [], dailyInstances: [], publishedAt: null,
        closedAt: late, updatedAt: late } as unknown as JsonValue }));
    expect(await maintenance.run()).toMatchObject({ finalizedActivities: 0, pendingRecoveryActivities: 0 });
    expect(activity.finalizeActivity).not.toHaveBeenCalled();
    expect(database.snapshot().checkin_finalization_recovery ?? []).toHaveLength(0);
  });
});
