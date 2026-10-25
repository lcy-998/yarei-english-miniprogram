import { describe, expect, it } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { InMemoryIdentityRepository } from '../../src/runtime/memory-ports';
import type { ParentStudentLinkRecord } from '../../src/runtime/records';
import { InMemoryTaskQueryRepository } from '../../src/task-query/memory-repository';
import { InMemoryTaskRecordingRepository } from '../../src/task-recording/memory-repository';
import type { SubmissionRecord, TaskAssignmentRecord, TaskRecord } from '../../src/task-core/types';
import type { TaskRecordingRecord } from '../../src/task-recording/types';
import { ParentMediaPlaybackService } from '../../src/task-query/parent-media-playback';
import { DocumentParentPlaybackAudit } from '../../src/task-query/parent-playback-audit';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import { validateParentQueryRequest } from '../../src/contracts/task-core-functions';

const org = 'org_qihang_demo';
const childId = 'usr_student_g3_01';
const parentId = 'usr_parent_demo_01';
const taskId = 'task_recording_demo';
const assignmentId = 'assignment_recording_demo';
const itemId = 'item_recording_demo';
const submittedAt = '2026-09-16T01:00:00.000Z';
const actor: TrustedActorContext = { actorRole: 'parent', actorUserId: parentId,
  organizationId: org, requestId: 'request_parent_playback', sessionId: 'session_parent',
  platformSubjectDigest: 'digest_parent', permissions: ['child.read'], scopeIds: [], authzVersion: 1 };

function task(): TaskRecord {
  return { id: taskId, organizationId: org, creatorTeacherId: 'usr_teacher_demo_01',
    title: '虚构朗读录音', deliveryType: 'classroom', status: 'active', targetType: 'students',
    targetClassIds: ['cls_grade3_2'], targetStudentIds: [childId],
    startsAt: '2026-09-15T00:00:00.000Z', dueAt: '2026-09-18T00:00:00.000Z',
    latePolicy: { allowLate: true, lateDays: 7 }, description: '', teacherNote: null,
    itemRefs: [], items: [{ id: itemId, resourceId: 'prompt_demo', resourceVersion: 2,
      snapshotSchemaVersion: 1, resourceSnapshot: { title: '虚构录音提示', type: 'recording', payload: {} },
      completionRule: { kind: 'recording_upload' }, scoringRule: { kind: 'manual', maxScore: 100 }, order: 1 }],
    publishedAt: '2026-09-15T00:00:00.000Z', deadlineExtendedAt: null, visibility: 'visible',
    withdrawnAt: null, withdrawnBy: null, withdrawReason: null, recycledAt: null,
    recycledBy: null, recycleReason: null, recoverableUntil: null, version: 1 };
}
function assignment(): TaskAssignmentRecord {
  return { id: assignmentId, organizationId: org, taskId, studentId: childId,
    classId: 'cls_grade3_2', status: 'completed', latestSubmissionId: 'submission_recording_demo',
    latestSubmissionVersion: 1, redoCount: 0, redoDueAt: null, isLate: false,
    submittedAt, reviewedAt: submittedAt, version: 1 };
}
function submission(): SubmissionRecord {
  return { id: 'submission_recording_demo', organizationId: org, taskId, assignmentId,
    studentId: childId, submissionVersion: 1, recordVersion: 1, status: 'reviewed',
    answers: [{ itemId, value: { kind: 'recording', recordingId: 'private_recording_demo',
      durationMs: 1500, sizeBytes: 12000 } }], isLate: false, submittedAt,
    supersedesSubmissionId: null };
}
function recording(): TaskRecordingRecord {
  return { id: 'private_recording_demo', organizationId: org, taskId, itemId, assignmentId,
    submissionVersion: 1, studentId: childId, classId: 'cls_grade3_2', resourceVersion: 2,
    stagingPath: 'private/staging', status: 'submitted', fileId: 'cloud://private/file',
    contentSha256: 'digest', sizeBytes: 12000, durationMs: 1500, version: 2,
    createdAt: submittedAt, submittedAt };
}

function harness(failPlayback = false, recordingOverride?: TaskRecordingRecord,
  revokeDuringPlayback = false) {
  const links: ParentStudentLinkRecord[] = [{ _id: 'link_parent_demo', organizationId: org,
    parentId, studentId: childId, status: 'active', version: 1, deletedAt: null }];
  const identities = new InMemoryIdentityRepository({ organizations: [], users: [], identities: [],
    roles: [], teacherGrants: [], parentLinks: links });
  const tasks = new InMemoryTaskQueryRepository({ tasks: [task()], assignments: [assignment()],
    submissions: [submission()], feedback: [] });
  const recordings = new InMemoryTaskRecordingRepository({ recordings: [recordingOverride ?? recording()] });
  let now = new Date(Date.parse(submittedAt) + 59 * 86400000).toISOString();
  const playbackCalls: string[] = [];
  const audits: string[] = [];
  const service = new ParentMediaPlaybackService(tasks, recordings, identities,
    { temporaryUrl: async fileId => { playbackCalls.push(fileId);
      if (failPlayback) throw new Error('virtual network failure');
      if (revokeDuringPlayback) links[0] = { ...links[0], status: 'revoked', version: 2 };
      return 'https://media.example.invalid/temporary'; } },
    { record: async (_actor, row) => { audits.push(row.id); } }, { nowIso: () => now });
  return { service, links, playbackCalls, audits, setNow: (value: string) => { now = value; } };
}
const input = { childId, taskId, assignmentId, submissionVersion: 1, itemId };

describe('M3 家长已提交课堂录音受控试听', () => {
  it('严格拒绝客户端直接提供录音私有 ID', () => {
    expect(validateParentQueryRequest({ apiVersion: 'm1.v1', action: 'getRecordingPlayback',
      payload: input })).toMatchObject({ ok: true, value: { action: 'getRecordingPlayback', itemId } });
    expect(validateParentQueryRequest({ apiVersion: 'm1.v1', action: 'getRecordingPlayback',
      payload: { ...input, recordingId: 'private_recording_demo' } })).toMatchObject({ ok: false });
  });
  it('只由正式提交答案定位录音，签 60 秒短链并留审计，响应不含私有 ID', async () => {
    const { service, playbackCalls, audits } = harness();
    const result = await service.getRecording(actor, input);
    expect(result).toMatchObject({ status: 'ready', durationMs: 1500,
      playback: { temporaryUrl: 'https://media.example.invalid/temporary' } });
    expect(Date.parse(result.playback!.expiresAt) - Date.parse(new Date(Date.parse(submittedAt)
      + 59 * 86400000).toISOString())).toBe(60_000);
    expect(playbackCalls).toEqual(['cloud://private/file']);
    expect(audits).toEqual(['private_recording_demo']);
    expect(JSON.stringify(result)).not.toMatch(/private_recording_demo|cloud:\/\/private/);
  });

  it('满 60 天不签地址，历史时长仍可读', async () => {
    const { service, playbackCalls, audits, setNow } = harness();
    setNow(new Date(Date.parse(submittedAt) + 60 * 86400000).toISOString());
    expect(await service.getRecording(actor, input))
      .toEqual({ status: 'expired', durationMs: 1500, playback: null });
    expect(playbackCalls).toEqual([]);
    expect(audits).toEqual([]);
  });

  it('撤权、跨孩子、错作业关系及错版本均拒绝', async () => {
    const { service, links, playbackCalls } = harness();
    await expect(service.getRecording(actor, { ...input, childId: 'usr_student_g4_01' }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.getRecording(actor, { ...input, assignmentId: 'other_assignment' }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.getRecording(actor, { ...input, submissionVersion: 2 }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    links[0] = { ...links[0], status: 'revoked', version: 2 };
    await expect(service.getRecording(actor, input)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(playbackCalls).toEqual([]);
  });

  it('签发网络故障可重试且不会写成功试听审计', async () => {
    const { service, audits } = harness(true);
    await expect(service.getRecording(actor, input))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    expect(audits).toEqual([]);
  });

  it('录音跨班或文件引用不合规时不签地址', async () => {
    const wrongClass = harness(false, { ...recording(), classId: 'cls_grade4_1' });
    await expect(wrongClass.service.getRecording(actor, input)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const invalidFile = harness(false, { ...recording(), fileId: 'file:///private/audio' });
    expect(await invalidFile.service.getRecording(actor, input))
      .toEqual({ status: 'unavailable', durationMs: 1500, playback: null });
    expect(invalidFile.playbackCalls).toEqual([]);
  });

  it('签发中途解绑时不把已生成短地址返回家长', async () => {
    const { service, audits } = harness(false, undefined, true);
    await expect(service.getRecording(actor, input)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(audits).toEqual([]);
  });

  it('家长成功试听审计只记录归属与版本，不记录文件路径或URL', async () => {
    const database = new FakeDocumentDatabase({});
    await new DocumentParentPlaybackAudit(database).record(actor, recording(), submittedAt);
    const entry = await database.get('operation_logs', `audit:${org}:${actor.requestId}`);
    expect(entry).toMatchObject({ actorUserId: parentId, actorRole: 'parent',
      action: 'parent-query.getRecordingPlayback', metadata: {
        studentId: childId, taskId, itemId, submissionVersion: 1,
      } });
    expect(JSON.stringify(entry)).not.toMatch(/cloud:\/\/private|media\.example/);
  });
});
