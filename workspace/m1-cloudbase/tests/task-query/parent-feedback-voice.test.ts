import { describe, expect, it } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { InMemoryIdentityRepository } from '../../src/runtime/memory-ports';
import type { ParentStudentLinkRecord } from '../../src/runtime/records';
import type { ReviewFeedbackRecord, SubmissionRecord, TaskAssignmentRecord, TaskRecord } from '../../src/task-core/types';
import { InMemoryTaskQueryRepository } from '../../src/task-query/memory-repository';
import { ParentFeedbackVoiceService, parentVoiceCommentSummary } from '../../src/task-query/parent-feedback-voice';
import { DocumentParentFeedbackVoiceAudit } from '../../src/task-query/parent-playback-audit';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';

const org = 'org_qihang_demo';
const childId = 'usr_student_g3_01';
const parentId = 'usr_parent_demo_01';
const taskId = 'task_demo';
const assignmentId = 'assignment_demo';
const submissionId = 'submission_demo';
const feedbackId = 'feedback_demo';
const publishedAt = '2026-10-03T01:00:00.000Z';
const actor: TrustedActorContext = { actorRole: 'parent', actorUserId: parentId,
  organizationId: org, requestId: 'request_voice_demo', sessionId: 'session_parent',
  platformSubjectDigest: 'digest_parent', permissions: ['child.read'], scopeIds: [], authzVersion: 1 };

function task(): TaskRecord {
  return { id: taskId, organizationId: org, creatorTeacherId: 'usr_teacher_demo_01',
    title: '虚构课堂任务', deliveryType: 'classroom', status: 'active', targetType: 'students',
    targetClassIds: ['cls_grade3_2'], targetStudentIds: [childId],
    startsAt: '2026-10-01T00:00:00.000Z', dueAt: '2026-10-04T00:00:00.000Z',
    latePolicy: { allowLate: true, lateDays: 7 }, description: null, teacherNote: null,
    itemRefs: [], items: [], publishedAt: '2026-10-01T00:00:00.000Z', deadlineExtendedAt: null,
    visibility: 'visible', withdrawnAt: null, withdrawnBy: null, withdrawReason: null,
    recycledAt: null, recycledBy: null, recycleReason: null, recoverableUntil: null, version: 1 };
}
function assignment(): TaskAssignmentRecord {
  return { id: assignmentId, organizationId: org, taskId, studentId: childId,
    classId: 'cls_grade3_2', status: 'completed', latestSubmissionId: submissionId,
    latestSubmissionVersion: 1, redoCount: 0, redoDueAt: null, isLate: false,
    submittedAt: '2026-10-02T01:00:00.000Z', reviewedAt: publishedAt, version: 1 };
}
function submission(): SubmissionRecord {
  return { id: submissionId, organizationId: org, taskId, assignmentId, studentId: childId,
    submissionVersion: 1, recordVersion: 1, status: 'reviewed', answers: [],
    isLate: false, submittedAt: '2026-10-02T01:00:00.000Z', supersedesSubmissionId: null };
}
function feedback(): ReviewFeedbackRecord {
  return { id: feedbackId, organizationId: org, taskId, assignmentId, submissionId,
    submissionVersion: 1, teacherId: 'usr_teacher_demo_01', decision: 'approved', score: 88,
    textComment: '虚构文字点评', returnReason: null, publishedAt, source: 'manual',
    voiceComment: { recordingId: 'private_voice_recording', fileId: 'cloud://private/voice',
      durationMs: 2300, mediaVersion: 1, sha256: 'a'.repeat(64) } } as ReviewFeedbackRecord;
}
const input = { childId, taskId, assignmentId, submissionVersion: 1, feedbackId };

function harness(voiceFeedback: ReviewFeedbackRecord = feedback(), revokeDuringPlayback = false,
  now = '2026-10-03T02:00:00.000Z') {
  const links: ParentStudentLinkRecord[] = [{ _id: 'link_parent_demo', organizationId: org,
    parentId, studentId: childId, status: 'active', version: 1, deletedAt: null }];
  const identities = new InMemoryIdentityRepository({ organizations: [], users: [], identities: [],
    roles: [], teacherGrants: [], parentLinks: links });
  const tasks = new InMemoryTaskQueryRepository({ tasks: [task()], assignments: [assignment()],
    submissions: [submission()], feedback: [voiceFeedback] });
  const plays: string[] = [];
  const audits: string[] = [];
  const service = new ParentFeedbackVoiceService(tasks, identities,
    { temporaryUrl: async fileId => { plays.push(fileId);
      if (revokeDuringPlayback) links[0] = { ...links[0], status: 'revoked', version: 2 };
      return 'https://media.example.invalid/voice'; } },
    { record: async (_actor, id) => { audits.push(id); } },
    { nowIso: () => now });
  return { service, links, plays, audits };
}

describe('M3 G-05 教师正式语音评语家长只读', () => {
  it('只公开安全摘要；点击时凭当前绑定、正式反馈和版本签短链并审计', async () => {
    expect(parentVoiceCommentSummary(feedback())).toEqual({ available: true, durationMs: 2300 });
    expect(JSON.stringify(parentVoiceCommentSummary(feedback()))).not.toMatch(/private_voice|cloud:\/\//);
    const { service, plays, audits } = harness();
    const result = await service.getPlayback(actor, input);
    expect(result).toEqual({ feedbackId, temporaryUrl: 'https://media.example.invalid/voice',
      expiresAt: '2026-10-03T02:01:00.000Z', durationMs: 2300 });
    expect(plays).toEqual(['cloud://private/voice']);
    expect(audits).toEqual([feedbackId]);
    expect(JSON.stringify(result)).not.toContain('private_voice_recording');
  });

  it('无正式语音、错点评/版本及撤权均拒绝；签发途中解绑不返回地址', async () => {
    const noVoice = harness({ ...feedback(), voiceComment: undefined } as ReviewFeedbackRecord);
    await expect(noVoice.service.getPlayback(actor, input)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const current = harness();
    await expect(current.service.getPlayback(actor, { ...input, feedbackId: 'other_feedback' }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(current.service.getPlayback(actor, { ...input, submissionVersion: 2 }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    current.links[0] = { ...current.links[0], status: 'revoked', version: 2 };
    await expect(current.service.getPlayback(actor, input)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const race = harness(feedback(), true);
    await expect(race.service.getPlayback(actor, input)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(race.audits).toEqual([]);
  });

  it('家长语音试听审计不写媒体路径或地址', async () => {
    const database = new FakeDocumentDatabase({});
    await new DocumentParentFeedbackVoiceAudit(database).record(actor, feedbackId, 1, publishedAt);
    const entry = await database.get('operation_logs', `audit:${org}:${actor.requestId}`);
    expect(entry).toMatchObject({ action: 'parent-query.getChildFeedbackVoicePlayback',
      actorUserId: parentId, targetId: feedbackId, metadata: { submissionVersion: 1 } });
    expect(JSON.stringify(entry)).not.toMatch(/cloud:\/\/private|media\.example/);
  });

  it('发布满 30 天即停止语音评语试听，文字和分数摘要仍可保留', async () => {
    const before = new Date(Date.parse(publishedAt) + 30 * 86400000 - 1).toISOString();
    const after = new Date(Date.parse(publishedAt) + 30 * 86400000).toISOString();
    expect(parentVoiceCommentSummary(feedback(), before)).toMatchObject({ available: true });
    expect(parentVoiceCommentSummary(feedback(), after)).toMatchObject({ available: false });
    const expired = harness(feedback(), false, after);
    await expect(expired.service.getPlayback(actor, input)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(expired.plays).toEqual([]);
    expect(expired.audits).toEqual([]);
  });
});
