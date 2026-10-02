import { describe, expect, it } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { DocumentNotificationRepository } from '../../src/notification/document-repository';
import { NotificationService } from '../../src/notification/service';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import type { VersionedDocument } from '../../src/repositories/document-database-port';
import type { JsonValue } from '../../src/shared/protocol';
import { hashHex } from '../../src/shared/request-summary';
import type { ActivityEntity } from '../../src/activity/types';

const org = 'org_qihang_demo';
const studentId = 'student_xiaoyu_demo';
const parentId = 'parent_xiaoyu_demo';
const teacherId = 'teacher_lin_demo';
const classId = 'class_grade3_demo';
const now = '2026-09-26T02:00:00.000Z';
const dueId = `notice_${hashHex(JSON.stringify([org, 'student', studentId, 'task_due',
  'task_1:student_xiaoyu_demo:2026-09-26T12:00:00.000Z']))}`;
const checkinId = `notice_${hashHex(JSON.stringify([org, 'student', studentId, 'checkin_reminder',
  'activity_1:2026-09-26']))}`;

const student: TrustedActorContext = { requestId: 'req_student', sessionId: 'session_student', actorUserId: studentId,
  actorRole: 'student', organizationId: org, platformSubjectDigest: 'digest_student', permissions: [], scopeIds: [], authzVersion: 1 };
const parent: TrustedActorContext = { ...student, actorUserId: parentId, actorRole: 'parent' };
const teacher: TrustedActorContext = { ...student, actorUserId: teacherId, actorRole: 'teacher',
  permissions: ['task.read'], scopeIds: [classId] };

function document(id: string, data: Record<string, JsonValue>): VersionedDocument {
  return { _id: id, organizationId: org, schemaVersion: 1, version: 1, deletedAt: null, ...data };
}

function fixture() {
  const activity: ActivityEntity = { id: 'activity_1', organizationId: org, creatorTeacherId: teacherId,
    title: '21 天阅读打卡', description: '', status: 'published',
    schedule: { classId, schoolTimeZone: 'Asia/Shanghai', startsOn: '2026-09-25', endsOn: '2026-10-15',
      restDates: [], conditions: [{ kind: 'reading', resourceId: 'read_zoo_demo' }] },
    participants: [{ studentId, displayNameMasked: '小宇' }],
    conditionSnapshots: [{ kind: 'reading', resourceId: 'read_zoo_demo', contentVersion: 'demo-v1', pageIds: ['page_1'] }],
    dailyInstances: Array.from({ length: 21 }, (_, index) => {
      const day = new Date('2026-09-25T00:00:00.000Z');
      day.setUTCDate(day.getUTCDate() + index);
      const date = day.toISOString().slice(0, 10);
      return { id: `activity_1:${date}`, date, classId, activityVersion: 1,
        createdAt: '2026-09-25T03:00:00.000Z' };
    }),
    version: 1, createdAt: '2026-09-25T01:00:00.000Z', updatedAt: '2026-09-25T03:00:00.000Z',
    publishedAt: '2026-09-25T03:00:00.000Z', closedAt: null };
  const database = new FakeDocumentDatabase({
    organizations: [document(org, { status: 'active' })],
    users: [document(studentId, { status: 'active' }), document(parentId, { status: 'active' }),
      document(teacherId, { status: 'active' })],
    class_memberships: [document('member_1', { studentId, classId, status: 'active' })],
    parent_student_links: [document('link_1', { parentId, studentId, status: 'active' })],
    teacher_class_grants: [document('grant_1', { teacherId, classId, status: 'active', permissions: ['task.read'] })],
    tasks: [document('task_1', { creatorTeacherId: teacherId, title: '动物主题听说练习',
      status: 'active', visibility: 'visible', targetClassIds: [classId],
      publishedAt: '2026-09-25T06:00:00.000Z', dueAt: '2026-09-26T12:00:00.000Z' })],
    task_assignments: [document('assignment_1', { taskId: 'task_1', studentId, classId,
      status: 'redo_required' })],
    review_feedback: [document('feedback_1', { taskId: 'task_1', assignmentId: 'assignment_1',
      decision: 'returned', publishedAt: '2026-09-26T01:00:00.000Z' })],
    checkin_activities: [document('activity_1', { classId, creatorTeacherId: teacherId,
      status: 'published', payload: activity as unknown as JsonValue })],
    notification_events: [
      document(dueId, { recipientUserId: studentId, recipientRole: 'student',
        sourceStudentId: studentId, kind: 'task_due', title: '任务即将截止', summary: '动物主题听说练习',
        occurredAt: '2026-09-25T12:00:00.000Z', target: { kind: 'student_task', id: 'task_1' } }),
      document(checkinId, { recipientUserId: studentId, recipientRole: 'student',
        sourceStudentId: studentId, kind: 'checkin_reminder', title: '今日打卡提醒', summary: '21 天阅读打卡',
        occurredAt: '2026-09-26T00:00:00.000Z', target: { kind: 'student_activity', id: 'activity_1' } }),
    ],
  });
  return { database, service: new NotificationService(new DocumentNotificationRepository(database), { nowIso: () => now }) };
}

describe('MSG-001 station inbox', () => {
  it('derives five event types from saved facts with unique keys and persists read state', async () => {
    const { service } = fixture();
    const first = await service.list(student, 'all', 0, 20);
    expect(first.items.map(item => item.kind)).toEqual(expect.arrayContaining([
      'task_published', 'activity_published', 'task_due', 'task_returned', 'checkin_reminder',
    ]));
    expect(new Set(first.items.map(item => item.id)).size).toBe(first.items.length);
    expect(first.items.find(item => item.kind === 'activity_published')?.target)
      .toEqual({ kind: 'student_activity', id: 'activity_1' });
    expect(first.unreadCount).toBe(first.items.length);
    const notice = first.items.find(item => item.kind === 'task_returned')!;
    expect((await service.markRead(student, notice.id)).readAt).toBe(now);
    expect((await service.markRead(student, notice.id)).readAt).toBe(now);
    expect((await service.list(student, 'all', 0, 20)).unreadCount).toBe(first.unreadCount - 1);
    await service.markAllRead(student);
    expect((await service.list(student, 'all', 0, 20)).unreadCount).toBe(0);
    expect((await service.list(student, 'feedback', 0, 20)).items.map(item => item.kind)).toEqual(['task_returned']);
    expect((await service.list(student, 'checkin', 0, 20)).items.map(item => item.kind))
      .toEqual(expect.arrayContaining(['activity_published', 'checkin_reminder']));
  });

  it('rechecks parent binding, class membership and teacher grant before listing or marking read', async () => {
    const { database, service } = fixture();
    const parentInbox = await service.list(parent, 'all', 0, 20);
    expect(parentInbox.items[0]?.target).toMatchObject({ kind: 'parent_task', childId: studentId });
    expect((await service.list(teacher, 'all', 0, 20)).items.map(item => item.kind)).toEqual(['task_published']);
    const link = (await database.get('parent_student_links', 'link_1'))!;
    await database.runTransaction(tx => tx.replace('parent_student_links', 'link_1', 1,
      { ...link, version: 2, status: 'revoked' }));
    expect((await service.list(parent, 'all', 0, 20)).items).toEqual([]);
    await expect(service.markRead(parent, parentInbox.items[0]!.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const membership = (await database.get('class_memberships', 'member_1'))!;
    await database.runTransaction(tx => tx.replace('class_memberships', 'member_1', 1,
      { ...membership, version: 2, status: 'inactive' }));
    expect((await service.list(student, 'all', 0, 20)).items).toEqual([]);
    const grant = (await database.get('teacher_class_grants', 'grant_1'))!;
    await database.runTransaction(tx => tx.replace('teacher_class_grants', 'grant_1', 1,
      { ...grant, version: 2, status: 'revoked' }));
    expect((await service.list(teacher, 'all', 0, 20)).items).toEqual([]);
  });

  it('never invents a scheduled reminder from a client query', async () => {
    const { database, service } = fixture();
    const event = (await database.get('notification_events', checkinId))!;
    await database.runTransaction(tx => tx.delete('notification_events', checkinId, event.version));
    expect((await service.list(student, 'checkin', 0, 20)).items.map(item => item.kind))
      .toEqual(['activity_published']);
  });

  it('keeps the publication notice visible while a closed activity remains readable', async () => {
    const { database, service } = fixture();
    const stored = (await database.get('checkin_activities', 'activity_1'))!;
    const payload = stored.payload as unknown as ActivityEntity;
    await database.runTransaction(tx => tx.replace('checkin_activities', 'activity_1', stored.version,
      { ...stored, status: 'closed', version: stored.version + 1,
        payload: { ...payload, status: 'closed', version: payload.version + 1, closedAt: now } as unknown as JsonValue }));
    expect((await service.list(student, 'checkin', 0, 20)).items.map(item => item.kind))
      .toEqual(expect.arrayContaining(['activity_published', 'checkin_reminder']));
  });

  it('advances the all-read watermark when newer notices arrive', async () => {
    const { database } = fixture();
    let current = now;
    const service = new NotificationService(new DocumentNotificationRepository(database),
      { nowIso: () => current });
    await service.markAllRead(student);
    expect((await service.list(student, 'all', 0, 20)).unreadCount).toBe(0);

    const later = '2026-09-26T02:30:00.000Z';
    const laterId = `notice_${hashHex(JSON.stringify([org, 'student', studentId, 'task_due',
      'task_1:student_xiaoyu_demo:2026-09-27T12:00:00.000Z']))}`;
    await database.runTransaction(tx => tx.create('notification_events', document(laterId, {
      id: laterId, recipientUserId: studentId, recipientRole: 'student', sourceStudentId: studentId,
      kind: 'task_due', title: '任务即将截止', summary: '动物主题听说练习', occurredAt: later,
      target: { kind: 'student_task', id: 'task_1' },
    })));
    current = '2026-09-26T03:00:00.000Z';
    expect((await service.list(student, 'all', 0, 20)).unreadCount).toBe(1);
    expect((await service.markAllRead(student)).readAt).toBe(current);
    expect((await service.list(student, 'all', 0, 20)).unreadCount).toBe(0);
  });
});
