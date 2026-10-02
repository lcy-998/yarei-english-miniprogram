import { performance } from 'node:perf_hooks';
import { describe, expect, it, vi } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { ActivityService } from '../../src/activity/activity-service';
import { DocumentActivityRepository } from '../../src/activity/document-repository';
import type { ActivityEntity } from '../../src/activity/types';
import { NotificationMaintenance } from '../../src/notification/maintenance';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import type { VersionedDocument } from '../../src/repositories/document-database-port';
import type { JsonValue } from '../../src/shared/protocol';

const ORG = 'org_qihang_capacity_demo';
const CLASS = 'class_capacity_demo';
const ACTIVITY = 'z_activity_500_demo';
const STUDENTS = Array.from({ length: 500 }, (_, index) => `student_capacity_${String(index + 1).padStart(3, '0')}`);
const PARTICIPANTS = STUDENTS.map((studentId, index) => ({ studentId, displayNameMasked: `学员${String(index + 1).padStart(3, '0')}` }));
const STARTS_ON = '2026-09-26';
const ENDS_ON = '2026-09-28';
const CLOCK_WINDOW = '2026-09-28T16:02:00.000Z'; // 09-29 00:02 Asia/Shanghai
const CLOCK_MISSED = '2026-09-28T16:06:00.000Z'; // 09-29 00:06 Asia/Shanghai

function document(id: string, data: Record<string, JsonValue>): VersionedDocument {
  return { _id: id, organizationId: ORG, schemaVersion: 1, version: 1, deletedAt: null, ...data };
}
function publishedActivity(): ActivityEntity {
  return { id: ACTIVITY, organizationId: ORG, creatorTeacherId: 'teacher_capacity_demo',
    title: '虚构 500 人阅读打卡', description: '', status: 'published',
    schedule: { classId: CLASS, startsOn: STARTS_ON, endsOn: ENDS_ON, schoolTimeZone: 'Asia/Shanghai',
      restDates: ['2026-09-27'], conditions: [{ kind: 'reading', resourceId: 'read_capacity_demo' }] },
    participants: PARTICIPANTS,
    conditionSnapshots: [{ kind: 'reading', resourceId: 'read_capacity_demo', contentVersion: 'demo-v1',
      pageIds: ['page_1', 'page_2'] }],
    dailyInstances: [STARTS_ON, ENDS_ON].map(date => ({ id: `${ACTIVITY}:${date}`, date,
      classId: CLASS, activityVersion: 1, createdAt: '2026-09-25T01:00:00.000Z' })),
    version: 1, createdAt: '2026-09-25T00:00:00.000Z', updatedAt: '2026-09-25T01:00:00.000Z',
    publishedAt: '2026-09-25T01:00:00.000Z', closedAt: null };
}
function fixture(options: Readonly<{ activitiesAhead?: number; withEvidence?: boolean; legacyIndex?: boolean }> = {}) {
  const activity = publishedActivity();
  const priorActivities = Array.from({ length: options.activitiesAhead ?? 0 }, (_, index) => {
    const id = `a_activity_${String(index).padStart(3, '0')}`;
    const dates = Array.from({ length: 35 }, (_, dayIndex) => {
      const day = new Date('2026-09-26T00:00:00.000Z');
      day.setUTCDate(day.getUTCDate() + dayIndex);
      return day.toISOString().slice(0, 10);
    }).filter(date => date !== '2026-09-27');
    const payload: ActivityEntity = { ...activity, id, title: `虚构进行中活动 ${index}`,
      participants: [{ studentId: STUDENTS[0]!, displayNameMasked: '学员001' }],
      schedule: { ...activity.schedule, endsOn: '2026-10-30' },
      dailyInstances: dates.map(date => ({ id: `${id}:${date}`, date, classId: CLASS,
        activityVersion: 1, createdAt: '2026-09-25T01:00:00.000Z' })) };
    return document(id, { classId: CLASS, creatorTeacherId: payload.creatorTeacherId,
      status: 'published', endsOn: '2026-10-30', payload: payload as unknown as JsonValue });
  });
  const readingEvents = options.withEvidence
    ? STUDENTS.slice(0, 250).flatMap((studentId) => ['page_1', 'page_2'].map((pageId, index) => document(
      `page_event_${studentId}_${pageId}`, { id: `page_event_${studentId}_${pageId}`,
        studentId, resourceId: 'read_capacity_demo', chapterId: 'chapter_1', pageId,
        pageNumber: index + 1, progressVersion: 1, contentVersion: 'demo-v1',
        operationId: `read_${studentId}_${pageId}`, visitedAt: '2026-09-26T08:00:00.000Z' })))
    : [];
  const database = new FakeDocumentDatabase({
    organizations: [document(ORG, { status: 'active', timeZone: 'Asia/Shanghai' })],
    users: [document(STUDENTS[0]!, { id: STUDENTS[0]!, status: 'active', displayNameMasked: '学员001' })],
    class_memberships: [document('membership_capacity_001', { studentId: STUDENTS[0]!, classId: CLASS, status: 'active' })],
    checkin_activities: [...priorActivities, document(ACTIVITY, { classId: CLASS,
      ...(options.legacyIndex ? {} : { endsOn: ENDS_ON }),
      creatorTeacherId: activity.creatorTeacherId, status: 'published', payload: activity as unknown as JsonValue })],
    reading_page_events: readingEvents,
  });
  let now = CLOCK_WINDOW;
  const clock = { nowIso: () => now };
  const ids = { next: (prefix: string) => `${prefix}_capacity_demo` };
  const maintenance = new NotificationMaintenance(database, clock, ids);
  const activityService = new ActivityService(new DocumentActivityRepository(database), clock, ids);
  const actor: TrustedActorContext = { requestId: 'request_capacity_student', sessionId: 'session_capacity_student',
    actorUserId: STUDENTS[0]!, actorRole: 'student', organizationId: ORG,
    platformSubjectDigest: 'digest_capacity_student', permissions: [], scopeIds: [], authzVersion: 1 };
  return { database, maintenance, activityService, actor, setNow: (value: string) => { now = value; } };
}

describe('M2 500-person activity finalization capacity and recovery', () => {
  it('scans one active cohort before a 500-person evening reminder', async () => {
    const { database, maintenance, setNow } = fixture();
    setNow('2026-09-28T12:00:00.000Z'); // 20:00 Asia/Shanghai
    const get = vi.spyOn(database, 'get');
    const report = await maintenance.run();
    expect(report).toMatchObject({ scannedActivities: 1, createdCheckinReminders: 1 });
    expect(get.mock.calls.filter(([collection]) => collection === 'users')).toHaveLength(0);
  });

  it('locks one final snapshot inside the school-local window and repeated ticks are idempotent', async () => {
    const { database, maintenance, activityService, actor } = fixture({ withEvidence: true });
    const started = performance.now();
    const first = await maintenance.run();
    const elapsedMs = Math.round(performance.now() - started);
    const transactionFinds = database.observedTransactionFindCount;
    expect(first).toMatchObject({ finalizedActivities: 1, pendingRecoveryActivities: 0, scannedActivities: 1 });
    const board = await activityService.getLeaderboard(actor, ACTIVITY);
    expect(board.evidenceStatus).toBe('available');
    expect(board.leaderboard?.finalized).toBe(true);
    expect(board.leaderboard?.ranks).toHaveLength(500);
    expect(database.snapshot().checkin_final_boards).toHaveLength(1);
    expect((await maintenance.run()).finalizedActivities).toBe(0);
    expect(database.snapshot().checkin_final_boards).toHaveLength(1);
    process.stdout.write(`CAPACITY_500 ${JSON.stringify({ elapsedMs, transactionFinds,
      participants: 500, evidenceEvents: 500, effectiveDays: 2, finalBoards: 1 })}\n`);
  }, 120000);

  it('prioritizes an ending activity behind 150 unrelated rows and locks it within the window', async () => {
    const { database, maintenance, activityService, actor, setNow } = fixture({ activitiesAhead: 150 });
    expect((await maintenance.run()).finalizedActivities).toBe(1);
    for (let minute = 0; minute <= 5; minute += 1) {
      setNow(`2026-09-28T16:${String(minute).padStart(2, '0')}:00.000Z`);
      await maintenance.run();
    }
    expect(database.snapshot().checkin_final_boards ?? []).toHaveLength(1);
    setNow(CLOCK_MISSED);
    const late = await maintenance.run();
    expect(late).toMatchObject({ finalizedActivities: 0, pendingRecoveryActivities: 0 });
    expect((await activityService.getLeaderboard(actor, ACTIVITY)).evidenceStatus).toBe('available');
  }, 120000);

  it('records an indexed-legacy miss for recovery without inventing a late ranking', async () => {
    const { database, maintenance, activityService, actor, setNow } = fixture({ activitiesAhead: 150, legacyIndex: true });
    for (let minute = 0; minute <= 5; minute += 1) {
      setNow(`2026-09-28T16:${String(minute).padStart(2, '0')}:00.000Z`);
      await maintenance.run();
    }
    expect(database.snapshot().checkin_final_boards ?? []).toHaveLength(0);
    setNow(CLOCK_MISSED);
    const late = await maintenance.run();
    expect(late).toMatchObject({ finalizedActivities: 0, pendingRecoveryActivities: 1 });
    expect(database.snapshot().checkin_finalization_recovery).toMatchObject([
      { activityId: ACTIVITY, status: 'pending', reason: 'window_missed' },
    ]);
    expect((await activityService.getLeaderboard(actor, ACTIVITY)).evidenceStatus).toBe('not_available');
    await expect(activityService.finalizeActivity(ORG, ACTIVITY)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(database.snapshot().checkin_final_boards ?? []).toHaveLength(0);
  }, 120000);
});
