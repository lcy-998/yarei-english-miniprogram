import { describe, expect, it } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import type { TaskAssignmentRecord, TaskRecord } from '../../src/task-core/types';
import { DocumentTaskMediaPlaybackPort, TASK_MEDIA_COLLECTIONS,
} from '../../src/task-media/document-playback-port';
import { TaskMediaPlaybackService } from '../../src/task-media/playback-service';
import type { FrozenTeacherMediaSnapshot } from '../../src/teacher-media/publish-gate';

const student: TrustedActorContext = { requestId: 'req_student', sessionId: 'session_student',
  actorUserId: 'student_demo', actorRole: 'student', organizationId: 'org_demo',
  platformSubjectDigest: 'digest_demo', permissions: [], scopeIds: ['student_demo'], authzVersion: 1 };
const snapshot: FrozenTeacherMediaSnapshot = { mediaId: 'media_demo', kind: 'video',
  mediaVersion: 2, reviewVersion: 2, mediaAssetKey: 'cloud://private/video.mp4',
  mediaSha256: 'a'.repeat(64), durationMs: 10000,
  questionIds: [], questions: [], answerKeys: [], clips: [], continuousPlaybackEnforced: true };
const task: TaskRecord = { id: 'task_demo', organizationId: 'org_demo', creatorTeacherId: 'teacher_demo',
  title: '虚构视频任务', deliveryType: 'classroom', status: 'active', targetType: 'classes',
  targetClassIds: ['class_demo'], targetStudentIds: ['student_demo'],
  startsAt: '2026-10-03T00:00:00+08:00', dueAt: '2026-10-04T00:00:00+08:00',
  latePolicy: { allowLate: true, lateDays: 7 }, description: null, teacherNote: null,
  itemRefs: [{ id: 'item_demo', resourceId: 'media_demo', order: 1 }],
  items: [{ id: 'item_demo', resourceId: 'media_demo', resourceVersion: 2,
    snapshotSchemaVersion: 2, resourceSnapshot: { title: '虚构视频', type: 'video', payload: {} },
    completionRule: { kind: 'video', durationMs: 10000, questionIds: [] },
    scoringRule: { kind: 'completion_only' }, order: 1, mediaSnapshot: snapshot }],
  publishedAt: '2026-10-03T00:00:00+08:00', deadlineExtendedAt: null, visibility: 'visible',
  withdrawnAt: null, withdrawnBy: null, withdrawReason: null,
  recycledAt: null, recycledBy: null, recycleReason: null, recoverableUntil: null,
  version: 2, publication: null, publishOperationId: 'operation_publish' };
const assignment: TaskAssignmentRecord = { id: 'assignment_demo', organizationId: 'org_demo',
  taskId: 'task_demo', studentId: 'student_demo', classId: 'class_demo', status: 'in_progress',
  latestSubmissionId: null, latestSubmissionVersion: 0, redoCount: 0, redoDueAt: null,
  isLate: false, submittedAt: null, reviewedAt: null, version: 1 };

describe('M3 document media session adapter', () => {
  it('reads only an assigned published snapshot and atomically stores idempotent progress', async () => {
    const db = new FakeDocumentDatabase({});
    let nowMs = Date.parse('2026-10-03T08:00:00+08:00');
    const reader = { async findTask() { return task; }, async findAssignment() { return assignment; } };
    const port = new DocumentTaskMediaPlaybackPort(reader, db,
      { async temporaryUrl() { return 'https://example.invalid/video' } },
      { nowIso: () => new Date(nowMs).toISOString() });
    const service = new TaskMediaPlaybackService(port, { nowIso: () => new Date(nowMs).toISOString() });
    const opened = await service.begin(student, 'task_demo', 'item_demo', 'operation_begin');
    expect(opened).toMatchObject({ ok: true, data: { status: 'ready', confirmedThroughMs: 0 } });
    if (!opened.ok || !opened.data.sessionId) throw new Error('session expected');
    const sessionId = opened.data.sessionId;
    expect(await service.begin(student, 'task_demo', 'item_demo', 'operation_begin'))
      .toMatchObject({ ok: true, data: { sessionId } });
    nowMs += 1000;
    const beat = await service.heartbeat(student, { sessionId, playedFromMs: 0,
      playedToMs: 2000, positionMs: 2000, operationId: 'operation_beat' });
    expect(beat).toMatchObject({ ok: true, data: { confirmedThroughMs: 2000 } });
    expect(await service.heartbeat(student, { sessionId, playedFromMs: 0,
      playedToMs: 2000, positionMs: 2000, operationId: 'operation_beat' })).toEqual(beat);
    expect(db.snapshot()[TASK_MEDIA_COLLECTIONS.sessions]).toHaveLength(1);
    expect(db.snapshot()[TASK_MEDIA_COLLECTIONS.operations]).toHaveLength(2);
    expect(JSON.stringify(db.snapshot())).not.toContain('cloud://');
  });

  it('does not issue a session for another student or an unpublished task', async () => {
    const db = new FakeDocumentDatabase({});
    const port = new DocumentTaskMediaPlaybackPort({ async findTask() { return { ...task, publishedAt: null }; },
      async findAssignment() { return assignment; } }, db,
    { async temporaryUrl() { return 'https://example.invalid/video' } },
    { nowIso: () => '2026-10-03T08:00:00+08:00' });
    const service = new TaskMediaPlaybackService(port, { nowIso: () => '2026-10-03T08:00:00+08:00' });
    expect(await service.begin(student, 'task_demo', 'item_demo', 'operation_begin'))
      .toEqual({ ok: false, code: 'FORBIDDEN' });
    expect(await service.begin({ ...student, actorUserId: 'student_other' },
      'task_demo', 'item_demo', 'operation_other')).toEqual({ ok: false, code: 'FORBIDDEN' });
  });

  it('keeps an assigned old task playable from its frozen media snapshot after source removal', async () => {
    const db = new FakeDocumentDatabase({ learning_resources: [{ _id: 'media_demo',
      organizationId: 'org_demo', schemaVersion: 1, version: 3, deletedAt: null,
      type: 'video', status: 'offline', title: '已下架源' }] });
    const signed: string[] = [];
    const port = new DocumentTaskMediaPlaybackPort({ async findTask() { return task; },
      async findAssignment() { return assignment; } }, db,
    { async temporaryUrl(fileId: string) { signed.push(fileId); return 'https://example.invalid/frozen-video'; } },
    { nowIso: () => '2026-10-03T08:00:00+08:00' });
    const service = new TaskMediaPlaybackService(port,
      { nowIso: () => '2026-10-03T08:00:00+08:00' });
    expect(await service.begin(student, task.id, 'item_demo', 'operation_frozen_media'))
      .toMatchObject({ ok: true, data: { status: 'ready',
        temporaryUrl: 'https://example.invalid/frozen-video' } });
    expect(signed).toEqual([snapshot.mediaAssetKey]);
    expect(await service.begin({ ...student, actorUserId: 'student_other' },
      task.id, 'item_demo', 'operation_other_media')).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(signed).toHaveLength(1);
  });
});
