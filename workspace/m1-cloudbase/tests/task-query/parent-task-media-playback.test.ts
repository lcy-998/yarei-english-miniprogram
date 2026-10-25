import { describe, expect, it } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { InMemoryIdentityRepository } from '../../src/runtime/memory-ports';
import type { ParentStudentLinkRecord } from '../../src/runtime/records';
import type { SubmissionRecord, TaskAssignmentRecord, TaskRecord } from '../../src/task-core/types';
import { InMemoryTaskQueryRepository } from '../../src/task-query/memory-repository';
import { ParentTaskMediaPlaybackService } from '../../src/task-query/parent-task-media-playback';
import { DocumentParentTaskMediaAudit } from '../../src/task-query/parent-playback-audit';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import { validateParentQueryRequest } from '../../src/contracts/task-core-functions';
import type { SealedTaskDubbingWork } from '../../src/task-media/submission-evidence';

const org = 'org_qihang_demo';
const childId = 'usr_student_g3_01';
const taskId = 'task_listening_demo';
const assignmentId = 'assignment_listening_demo';
const itemId = 'item_listening_demo';
const actor: TrustedActorContext = { actorRole: 'parent', actorUserId: 'usr_parent_demo_01',
  organizationId: org, requestId: 'request_parent_media', sessionId: 'session_parent',
  platformSubjectDigest: 'digest_parent', permissions: ['child.read'], scopeIds: [], authzVersion: 1 };
const input = { childId, taskId, assignmentId, submissionVersion: 1, itemId };

function task(kind: 'listening' | 'video' | 'dubbing' = 'listening'): TaskRecord {
  return { id: taskId, organizationId: org, creatorTeacherId: 'usr_teacher_demo_01',
    title: '虚构媒体任务', deliveryType: 'classroom', status: 'active', targetType: 'students',
    targetClassIds: ['cls_grade3_2'], targetStudentIds: [childId],
    startsAt: '2026-10-01T00:00:00.000Z', dueAt: '2026-10-04T00:00:00.000Z',
    latePolicy: { allowLate: true, lateDays: 7 }, description: null, teacherNote: null,
    itemRefs: [], items: [{ id: itemId, resourceId: 'media_demo', resourceVersion: 3,
      snapshotSchemaVersion: 2, resourceSnapshot: { title: '虚构媒体', type: kind, payload: {} },
      mediaSnapshot: { mediaId: 'media_demo', kind, mediaVersion: 3, reviewVersion: 3,
        mediaAssetKey: 'cloud://private/teacher-media.mp3', mediaSha256: 'a'.repeat(64),
        durationMs: 10000,
        questionIds: kind === 'listening' ? ['q1'] : [],
        questions: kind === 'listening' ? [{ questionId: 'q1', questionType: 'single_choice',
          stem: 'Which animal?', options: ['cat', 'dog'] }] : [],
        answerKeys: kind === 'listening' ? [{ questionId: 'q1', correctAnswer: 'cat', explanation: 'private' }] : [],
        clips: kind === 'listening' ? [{ questionId: 'q1', segmentId: 'segment_1',
          startMs: 1000, endMs: 4000 }] : [],
        continuousPlaybackEnforced: true },
      completionRule: { kind }, scoringRule: { kind: 'manual', maxScore: 100 }, order: 1 }],
    publishedAt: '2026-10-01T00:00:00.000Z', deadlineExtendedAt: null,
    visibility: 'visible', withdrawnAt: null, withdrawnBy: null, withdrawReason: null,
    recycledAt: null, recycledBy: null, recycleReason: null, recoverableUntil: null, version: 1 };
}
function assignment(): TaskAssignmentRecord {
  return { id: assignmentId, organizationId: org, taskId, studentId: childId,
    classId: 'cls_grade3_2', status: 'completed', latestSubmissionId: 'submission_media_demo',
    latestSubmissionVersion: 1, redoCount: 0, redoDueAt: null, isLate: false,
    submittedAt: '2026-10-02T01:00:00.000Z', reviewedAt: null, version: 1 };
}
function submission(kind: 'listening' | 'video' | 'dubbing' = 'listening'): SubmissionRecord {
  return { id: 'submission_media_demo', organizationId: org, taskId, assignmentId, studentId: childId,
    submissionVersion: 1, recordVersion: 1, status: 'submitted', answers: [{ itemId, value: {
      kind, mediaSessionId: 'private_session', mediaId: 'media_demo', mediaVersion: 3,
      questionResponses: kind === 'listening' ? [{ questionId: 'q1', response: 'cat' }] : [],
      ...(kind === 'listening' ? { verifiedPlayedSegmentIds: ['segment_1'],
        answeredQuestionIds: ['q1'], correctQuestionIds: ['q1'] } : {}),
      ...(kind === 'video' ? { verifiedRanges: [{ startMs: 0, endMs: 9000 }],
        answeredQuestionIds: [], correctQuestionIds: [] } : {}),
      ...(kind === 'dubbing' ? { finalWorkId: 'private_work', recording: {
        mediaId: 'recording_demo', durationMs: 2300, sizeBytes: 12000, serverReadable: true,
      } } : {}),
    } }], isLate: false, submittedAt: '2026-10-02T01:00:00.000Z', supersedesSubmissionId: null };
}
function sealedWork(): SealedTaskDubbingWork {
  return { id: 'private_work', organizationId: org, studentId: childId,
    assignmentId, round: 1, taskId, itemId, mediaId: 'media_demo', mediaVersion: 3,
    status: 'submitted', fileId: 'cloud://private/child-work.mp3',
    contentSha256: 'b'.repeat(64), mediaDeletedAt: null,
    recording: { mediaId: 'recording_demo', durationMs: 2300,
      sizeBytes: 12000, serverReadable: true } };
}
function harness(kind: 'listening' | 'video' | 'dubbing' = 'listening', revokeDuringPlayback = false,
  initialWork: SealedTaskDubbingWork | null = sealedWork(), now = '2026-10-03T01:00:00.000Z') {
  const links: ParentStudentLinkRecord[] = [{ _id: 'link_parent_demo', organizationId: org,
    parentId: actor.actorUserId, studentId: childId, status: 'active', version: 1, deletedAt: null }];
  const identities = new InMemoryIdentityRepository({ organizations: [], users: [], identities: [],
    roles: [], teacherGrants: [], parentLinks: links });
  const tasks = new InMemoryTaskQueryRepository({ tasks: [task(kind)], assignments: [assignment()],
    submissions: [submission(kind)], feedback: [] });
  const plays: string[] = [];
  const audits: string[] = [];
  let currentWork = initialWork;
  let afterSign = () => {};
  const service = new ParentTaskMediaPlaybackService(tasks, identities,
    { temporaryUrl: async fileId => { plays.push(fileId);
      if (revokeDuringPlayback) links[0] = { ...links[0], status: 'revoked', version: 2 };
      afterSign();
      return 'https://media.example.invalid/task'; } },
    { record: async (_actor, _task, _item, _version, mediaId) => { audits.push(mediaId); } },
    { nowIso: () => now }, { findTaskDubbingWork: async () => currentWork });
  return { service, links, plays, audits,
    setWork: (work: SealedTaskDubbingWork | null) => { currentWork = work; },
    onSign: (callback: () => void) => { afterSign = callback; } };
}

describe('M3 家长正式任务媒体只读试听', () => {
  it('听力/视频只从已发布快照签短链，不创建学生播放进度', async () => {
    for (const kind of ['listening', 'video'] as const) {
      const { service, plays, audits } = harness(kind);
      const result = await service.getPlayback(actor, input);
      expect(result).toEqual({ kind, status: 'ready', durationMs: 10000,
        ...(kind === 'listening' ? { clips: [{ questionId: 'q1', startMs: 1000, endMs: 4000 }] } : {}),
        playback: { temporaryUrl: 'https://media.example.invalid/task',
          expiresAt: '2026-10-03T01:01:00.000Z' } });
      expect(plays).toEqual(['cloud://private/teacher-media.mp3']);
      expect(audits).toEqual(['media_demo']);
      expect(JSON.stringify(result)).not.toMatch(/private_session|cloud:\/\/private/);
    }
  });

  it('任务配音仅签正式版本引用的独立封存作品，不误签教师源媒体', async () => {
    const { service, plays, audits } = harness('dubbing');
    expect(await service.getPlayback(actor, input))
      .toEqual({ kind: 'dubbing', status: 'ready', durationMs: 2300,
        playback: { temporaryUrl: 'https://media.example.invalid/task',
          expiresAt: '2026-10-03T01:01:00.000Z' } });
    expect(plays).toEqual(['cloud://private/child-work.mp3']);
    expect(audits).toEqual(['media_demo']);
  });

  it('作品跨版本、错误媒体或缺封存行时拒绝，180天到期停止签发', async () => {
    for (const work of [null, { ...sealedWork(), round: 2 },
      { ...sealedWork(), mediaVersion: 4 }, { ...sealedWork(), studentId: 'another_child' }]) {
      const current = harness('dubbing', false, work);
      await expect(current.service.getPlayback(actor, input)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(current.plays).toEqual([]);
    }
    const expired = harness('dubbing', false, sealedWork(), '2027-04-01T01:00:00.000Z');
    expect(await expired.service.getPlayback(actor, input)).toEqual({ kind: 'dubbing',
      status: 'expired', durationMs: 2300, playback: null });
    expect(expired.plays).toEqual([]);
    const deleted = harness('dubbing', false, { ...sealedWork(), mediaDeletedAt: '2026-10-02T02:00:00.000Z' });
    expect(await deleted.service.getPlayback(actor, input)).toMatchObject({ status: 'expired', playback: null });
    expect(deleted.plays).toEqual([]);
  });

  it('签发期间解绑或作品清理后不返回短链', async () => {
    const revoked = harness('dubbing', true);
    await expect(revoked.service.getPlayback(actor, input)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(revoked.audits).toEqual([]);
    const deleted = harness('dubbing');
    deleted.onSign(() => deleted.setWork({ ...sealedWork(), mediaDeletedAt: '2026-10-03T01:00:00.000Z' }));
    await expect(deleted.service.getPlayback(actor, input)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(deleted.audits).toEqual([]);
  });

  it('跨孩子/错版本/签发中途解绑拒绝，客户端不能传 mediaId', async () => {
    const current = harness();
    await expect(current.service.getPlayback(actor, { ...input, childId: 'usr_student_g4_01' }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(current.service.getPlayback(actor, { ...input, submissionVersion: 2 }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    const race = harness('listening', true);
    await expect(race.service.getPlayback(actor, input)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(race.audits).toEqual([]);
    expect(validateParentQueryRequest({ apiVersion: 'm1.v1', action: 'getTaskMediaPlayback',
      payload: { ...input, mediaId: 'forged_media' } })).toMatchObject({ ok: false });
  });

  it('成功试听审计只记录任务与版本，不记录私有源路径', async () => {
    const database = new FakeDocumentDatabase({});
    await new DocumentParentTaskMediaAudit(database).record(actor, taskId, itemId, 1,
      'media_demo', '2026-10-03T01:00:00.000Z');
    const entry = await database.get('operation_logs', `audit:${org}:${actor.requestId}`);
    expect(entry).toMatchObject({ action: 'parent-query.getTaskMediaPlayback',
      targetId: 'media_demo', metadata: { taskId, itemId, submissionVersion: 1 } });
    expect(JSON.stringify(entry)).not.toMatch(/cloud:\/\/private|media\.example/);
  });
});
