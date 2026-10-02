import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { TaskRecordingService } from '../../src/task-recording/service';
import { TaskRecordingCatalogService } from '../../src/task-recording/catalog-service';
import { validateTaskRecordingQueryRequest } from '../../src/contracts/task-recording-functions';
import { CloudBaseTaskRecordingSeal } from '../../src/task-recording/cloudbase-seal';
import { InMemoryTaskRecordingRepository } from '../../src/task-recording/memory-repository';
import { DocumentTaskRecordingAccessAudit } from '../../src/task-recording/document-repository';
import type { TaskRecordingSealPort } from '../../src/task-recording/repository';
import type { TaskRecordingAccessAuditPort } from '../../src/task-recording/repository';
import { TaskRecordingError } from '../../src/task-recording/types';
import { InMemoryIdentityRepository } from '../../src/runtime/memory-ports';
import { InMemoryTaskQueryRepository } from '../../src/task-query/memory-repository';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import type { VersionedDocument } from '../../src/repositories/document-database-port';
import type { TaskRecord, TaskAssignmentRecord, SubmissionRecord } from '../../src/task-core/types';
import { automaticTaskScore } from '../../src/task-core/task-score';

const now = '2026-09-26T12:00:00.000+08:00';
const teacher: TrustedActorContext = { requestId: 'req_teacher', sessionId: 'ses_teacher',
  actorUserId: 'teacher_1', actorRole: 'teacher', organizationId: 'org_1',
  platformSubjectDigest: 'digest_teacher', permissions: ['task.publish', 'content.read', 'submission.review'],
  scopeIds: ['class_1'], authzVersion: 1 };
const student: TrustedActorContext = { ...teacher, actorUserId: 'student_1', actorRole: 'student',
  permissions: [], scopeIds: ['student_1'] };
const task: TaskRecord = { id: 'task_1', organizationId: 'org_1', creatorTeacherId: 'teacher_1',
  title: '虚构朗读任务', deliveryType: 'classroom', status: 'active', targetType: 'classes',
  targetClassIds: ['class_1'], targetStudentIds: [], startsAt: '2026-09-26T08:00:00.000+08:00',
  dueAt: '2026-09-27T20:00:00.000+08:00', latePolicy: { allowLate: true, lateDays: 7 },
  description: null, teacherNote: null, itemRefs: [{ id: 'item_1', resourceId: 'prompt_1', order: 1 }],
  items: [{ id: 'item_1', resourceId: 'prompt_1', resourceVersion: 1, snapshotSchemaVersion: 1,
    resourceSnapshot: { type: 'recording', title: '虚构朗读提示', payload: {
      promptKind: 'text', promptText: '请朗读：The cat is happy.', requiresVideo: false } },
    completionRule: { kind: 'recording_upload' }, scoringRule: { kind: 'manual', maxScore: 100 }, order: 1 }],
  publishedAt: '2026-09-26T08:00:00.000+08:00', deadlineExtendedAt: null, visibility: 'visible',
  withdrawnAt: null, withdrawnBy: null, withdrawReason: null, recycledAt: null, recycledBy: null,
  recycleReason: null, recoverableUntil: null, version: 2 };
const assignment: TaskAssignmentRecord = { id: 'assignment_1', organizationId: 'org_1', taskId: 'task_1',
  studentId: 'student_1', classId: 'class_1', status: 'not_started', latestSubmissionId: null,
  latestSubmissionVersion: 0, redoCount: 0, redoDueAt: null, isLate: false,
  submittedAt: null, reviewedAt: null, version: 1 };

function harness(seal?: TaskRecordingSealPort, submissions: readonly SubmissionRecord[] = [],
  audit: TaskRecordingAccessAuditPort | null = null) {
  let currentNow = now;
  const recordings = new InMemoryTaskRecordingRepository();
  const tasks = new InMemoryTaskQueryRepository({ teacherGrants: [{ id: 'grant_1', organizationId: 'org_1',
    teacherId: 'teacher_1', classId: 'class_1', className: '三年级 2 班',
    permissions: ['task.publish', 'content.read', 'submission.review'], status: 'active' }],
    tasks: [task], assignments: [assignment], submissions });
  const identities = new InMemoryIdentityRepository({ organizations: [], users: [], identities: [], roles: [],
    teacherGrants: [{ _id: 'grant_1', organizationId: 'org_1', teacherId: 'teacher_1', classId: 'class_1',
      status: 'active', permissions: ['submission.review'], version: 1, deletedAt: null }], parentLinks: [] });
  const service = new TaskRecordingService(recordings, tasks, identities, seal ?? {
    inspectAndSeal: async () => ({ fileId: 'cloud://virtual-env/task-recordings/private/sealed.mp3',
      contentSha256: 'a'.repeat(64), sizeBytes: 12000, durationMs: 3600, codec: 'mp3' }),
  }, { temporaryUrl: async () => 'https://example.invalid/temporary.mp3' },
  { nowIso: () => currentNow }, { next: () => 'task_recording_demo_1' }, audit);
  return { service, recordings, tasks, setNow: (value: string) => { currentNow = value; } };
}

describe('M2 录音任务可信证据', () => {
  it('教师只看到授权且无需视频的文字提示，按页查找', async () => {
    const prompt: VersionedDocument = { _id: 'prompt_1', id: 'prompt_1', organizationId: 'org_1',
      schemaVersion: 1, version: 1, deletedAt: null, type: 'recording', status: 'published',
      title: '虚构朗读提示', contentVersion: 1, grade: '三年级', unit: 'Unit 1',
      allowedClassIds: ['class_1'], payload: { promptKind: 'text', promptText: 'The cat is happy.', requiresVideo: false } };
    const video = { ...prompt, _id: 'prompt_video', id: 'prompt_video', payload: {
      promptKind: 'text', promptText: '视频配音', requiresVideo: true } };
    const other = { ...prompt, _id: 'prompt_other', id: 'prompt_other', allowedClassIds: ['class_2'] };
    const database = new FakeDocumentDatabase({ learning_resources: [prompt, video, other] });
    const { tasks } = harness();
    const catalog = new TaskRecordingCatalogService(database, tasks);
    expect(await catalog.list(teacher, { targetClassIds: ['class_1'], keyword: 'cat', limit: 20, offset: 0 }))
      .toMatchObject({ items: [{ id: 'prompt_1' }], nextOffset: null });
    const bothClasses = { ...teacher, scopeIds: ['class_1', 'class_2'] };
    const bothTasks = new InMemoryTaskQueryRepository({ teacherGrants: [
      { id: 'grant_1', organizationId: 'org_1', teacherId: 'teacher_1', classId: 'class_1', className: '三年级 1 班',
        permissions: ['task.publish', 'content.read'], status: 'active' },
      { id: 'grant_2', organizationId: 'org_1', teacherId: 'teacher_1', classId: 'class_2', className: '三年级 2 班',
        permissions: ['task.publish', 'content.read'], status: 'active' },
    ] });
    const unionCatalog = new TaskRecordingCatalogService(database, bothTasks);
    expect((await unionCatalog.list(bothClasses, { limit: 20, offset: 0 })).items.map(item => item.id))
      .toEqual(['prompt_1', 'prompt_other']);
    expect((await unionCatalog.list(bothClasses, { targetClassIds: ['class_1', 'class_2'], limit: 20, offset: 0 })).items)
      .toEqual([]);
    await expect(unionCatalog.get(bothClasses, 'prompt_other')).resolves.toMatchObject({ id: 'prompt_other' });
    expect(validateTaskRecordingQueryRequest({ apiVersion: 'm1.v1', action: 'listPrompts', payload: {
      page: { limit: 20, offset: 0 },
    } })).toMatchObject({ ok: true, value: { action: 'listPrompts' } });
    await expect(catalog.get(teacher, 'prompt_other', ['class_1']))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(catalog.list({ ...teacher, scopeIds: [] }, { targetClassIds: ['class_1'], limit: 20, offset: 0 }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('本人当前任务可创建草稿并服务端封存；他人、无效媒体与未提交证据不能冒用', async () => {
    const { service } = harness();
    const draft = await service.begin(student, 'task_1', 'item_1', 'operation_begin_recording_1');
    expect(draft).toMatchObject({ status: 'draft', studentId: 'student_1', submissionVersion: 1 });
    expect(await service.begin(student, 'task_1', 'item_1', 'operation_begin_recording_1')).toEqual(draft);
    await expect(service.begin({ ...student, actorUserId: 'student_other' }, 'task_1', 'item_1',
      'operation_other_recording_1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.submit({ ...student, actorUserId: 'student_other' }, draft.id,
      'cloud://virtual-env/staging.mp3', 1, 'operation_other_submit_1'))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    const submitted = await service.submit(student, draft.id, 'cloud://virtual-env/staging.mp3', 1,
      'operation_submit_recording_1');
    expect(submitted).toMatchObject({ status: 'submitted', durationMs: 3600, sizeBytes: 12000 });
    expect(await service.submit(student, draft.id, 'cloud://virtual-env/staging.mp3', 1,
      'operation_submit_recording_1')).toEqual(submitted);
    expect(await service.temporaryPlayback(student, submitted.id)).toMatchObject({
      temporaryUrl: 'https://example.invalid/temporary.mp3' });
    await expect(service.temporaryPlayback(teacher, submitted.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const invalidSeal = harness({ inspectAndSeal: async () => {
      throw new TaskRecordingError('MEDIA_INVALID');
    } }).service;
    const invalidDraft = await invalidSeal.begin(student, 'task_1', 'item_1', 'operation_begin_invalid_1');
    await expect(invalidSeal.submit(student, invalidDraft.id, 'cloud://virtual-env/staging.mp3', 1,
      'operation_submit_invalid_1')).rejects.toMatchObject({ code: 'MEDIA_INVALID' });
    expect(await invalidSeal.listMyRound(student, 'task_1', 'item_1'))
      .toMatchObject([{ status: 'draft' }]);
  });

  it('封存只接受当前组织与本人摘要的 staging 路径，并写入独立私有路径', async () => {
    const ownerDigest = createHash('sha256').update(JSON.stringify(['org_1', 'student_1'])).digest('hex');
    const stagingPath = `task-recordings/staging/${ownerDigest}/recording_demo_1.mp3`;
    const uploads: string[] = [];
    const seal = new CloudBaseTaskRecordingSeal({
      downloadFile: async () => ({ fileContent: Buffer.alloc(1200, 7) }),
      uploadFile: async ({ cloudPath }) => { uploads.push(cloudPath); return { fileID: `cloud://virtual-env/${cloudPath}` }; },
    }, 'virtual-env', { read: async () => ({ durationSeconds: 3.4, codec: 'MPEG Layer 3' }) });
    const input = { stagingFileId: `cloud://virtual-env/${stagingPath}`, stagingPath,
      organizationId: 'org_1', studentId: 'student_1', recordingId: 'recording_demo_1' };
    expect(await seal.inspectAndSeal(input)).toMatchObject({ durationMs: 3400, codec: 'mp3' });
    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toMatch(new RegExp(`^task-recordings/private/${ownerDigest}/recording_demo_1/[a-f0-9]{64}\\.mp3$`));
    await expect(seal.inspectAndSeal({ ...input, studentId: 'student_other' }))
      .rejects.toMatchObject({ code: 'MEDIA_INVALID' });
    await expect(seal.inspectAndSeal({ ...input, stagingFileId: `cloud://other-env/${stagingPath}` }))
      .rejects.toMatchObject({ code: 'MEDIA_INVALID' });
    expect(uploads).toHaveLength(1);
  });

  it('服务端拒绝非 MP3、过短和超过大小限制的录音，不封存无效文件', async () => {
    const ownerDigest = createHash('sha256').update(JSON.stringify(['org_1', 'student_1'])).digest('hex');
    const stagingPath = `task-recordings/staging/${ownerDigest}/recording_demo_2.mp3`;
    const input = { stagingFileId: `cloud://virtual-env/${stagingPath}`, stagingPath,
      organizationId: 'org_1', studentId: 'student_1', recordingId: 'recording_demo_2' };
    const uploads: string[] = [];
    const storage = (content: Buffer) => ({
      downloadFile: async () => ({ fileContent: content }),
      uploadFile: async ({ cloudPath }: { cloudPath: string }) => {
        uploads.push(cloudPath); return { fileID: `cloud://virtual-env/${cloudPath}` };
      },
    });
    await expect(new CloudBaseTaskRecordingSeal(storage(Buffer.alloc(1200, 7)), 'virtual-env',
      { read: async () => ({ durationSeconds: 2, codec: 'AAC' }) }).inspectAndSeal(input))
      .rejects.toMatchObject({ code: 'MEDIA_INVALID' });
    await expect(new CloudBaseTaskRecordingSeal(storage(Buffer.alloc(1200, 7)), 'virtual-env',
      { read: async () => ({ durationSeconds: 0.5, codec: 'MPEG Layer 3' }) }).inspectAndSeal(input))
      .rejects.toMatchObject({ code: 'MEDIA_INVALID' });
    await expect(new CloudBaseTaskRecordingSeal(storage(Buffer.alloc(20 * 1024 * 1024 + 1, 7)), 'virtual-env',
      { read: async () => ({ durationSeconds: 2, codec: 'MPEG Layer 3' }) }).inspectAndSeal(input))
      .rejects.toMatchObject({ code: 'MEDIA_INVALID' });
    expect(uploads).toEqual([]);
  });

  it('教师只能试听已纳入对应提交版本的录音，试听留下审计；家长和失去班级权限的教师不能获取链接', async () => {
    const submission: SubmissionRecord = { id: 'submission_1', organizationId: 'org_1',
      taskId: task.id, assignmentId: assignment.id, studentId: student.actorUserId,
      submissionVersion: 1, recordVersion: 1, status: 'submitted',
      answers: [{ itemId: 'item_1', value: { kind: 'recording', recordingId: 'task_recording_demo_1' } }],
      isLate: false, submittedAt: now, supersedesSubmissionId: null };
    const auditEntries: string[] = [];
    const { service } = harness(undefined, [submission], { recordTeacherPlayback: async (_actor, recording) => {
      auditEntries.push(recording.id);
    } });
    const draft = await service.begin(student, task.id, 'item_1', 'operation_begin_audit_1');
    await service.submit(student, draft.id, 'cloud://virtual-env/staging.mp3', draft.version, 'operation_submit_audit_1');
    expect(await service.temporaryPlayback(teacher, draft.id)).toMatchObject({ recordingId: draft.id });
    expect(auditEntries).toEqual([draft.id]);
    await expect(service.temporaryPlayback({ ...teacher, permissions: [] }, draft.id))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.temporaryPlayback({ ...student, actorRole: 'parent' }, draft.id))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(auditEntries).toEqual([draft.id]);
  });

  it('到期后的录音保留提交记录与授权状态查询，但不再签发试听地址', async () => {
    const submission: SubmissionRecord = { id: 'submission_1', organizationId: 'org_1',
      taskId: task.id, assignmentId: assignment.id, studentId: student.actorUserId,
      submissionVersion: 1, recordVersion: 1, status: 'submitted',
      answers: [{ itemId: 'item_1', value: { kind: 'recording', recordingId: 'task_recording_demo_1' } }],
      isLate: false, submittedAt: now, supersedesSubmissionId: null };
    const { service, recordings, setNow } = harness(undefined, [submission]);
    const draft = await service.begin(student, task.id, 'item_1', 'operation_begin_retention_1');
    const sealed = await service.submit(student, draft.id, 'cloud://virtual-env/staging.mp3',
      draft.version, 'operation_submit_retention_1');
    setNow('2027-03-27T12:00:00.000+08:00');
    expect(await service.getMediaState(student, sealed.id)).toMatchObject({ mediaDeletedAt: null, mediaExpired: true });
    await expect(service.temporaryPlayback(teacher, sealed.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await recordings.transaction(async tx => {
      const current = await tx.findRecording('org_1', sealed.id);
      expect(current).not.toBeNull();
      await tx.saveRecording({ ...current!, mediaDeletedAt: '2027-03-25T00:00:00.000Z',
        version: current!.version + 1 }, current!.version);
    });
    expect(await service.getMediaState(student, sealed.id)).toMatchObject({ mediaDeletedAt: '2027-03-25T00:00:00.000Z', mediaExpired: true });
    expect(await service.getMediaState(teacher, sealed.id)).toMatchObject({ mediaDeletedAt: '2027-03-25T00:00:00.000Z', mediaExpired: true });
    await expect(service.temporaryPlayback(student, sealed.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.temporaryPlayback(teacher, sealed.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.getMediaState({ ...student, actorRole: 'parent' }, sealed.id))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('混合客观题与录音时不能把客观题自动分报成整份任务成绩', () => {
    const exerciseItem: TaskRecord['items'][number] = { id: 'item_exercise', resourceId: 'question_1',
      resourceVersion: 1, snapshotSchemaVersion: 1, order: 2,
      resourceSnapshot: { type: 'exercise', title: '虚构选择题', payload: {
        questionIds: ['question_1'], questionType: 'single_choice', stem: 'Choose A.',
        options: ['A', 'B'], correctAnswer: 'A', explanation: 'A is correct.' } },
      completionRule: { kind: 'exercise_questions', requiredQuestionCount: 1 },
      scoringRule: { kind: 'automatic', maxScore: 100, weightPercent: 50 } };
    const mixedTask: TaskRecord = { ...task, items: [{ ...task.items[0]!,
      scoringRule: { kind: 'manual', maxScore: 100, weightPercent: 50 } }, exerciseItem] };
    const submission: SubmissionRecord = { id: 'submission_1', organizationId: 'org_1',
      taskId: mixedTask.id, assignmentId: assignment.id, studentId: student.actorUserId,
      submissionVersion: 1, recordVersion: 1, status: 'submitted', isLate: false,
      answers: [{ itemId: 'item_1', value: { kind: 'recording', recordingId: 'task_recording_demo_1' } },
        { itemId: 'item_exercise', value: { kind: 'exercise', questionResponses: [{ questionId: 'question_1', response: 'A' }] } }],
      submittedAt: now, supersedesSubmissionId: null };
    expect(automaticTaskScore(mixedTask, submission)).toBeNull();
  });

  it('教师试听审计持久化到操作日志，重复请求拒绝重复写入', async () => {
    const database = new FakeDocumentDatabase();
    const audit = new DocumentTaskRecordingAccessAudit(database);
    const recording = { id: 'recording_demo_1', organizationId: 'org_1', taskId: 'task_1',
      itemId: 'item_1', assignmentId: 'assignment_1', submissionVersion: 1,
      studentId: 'student_1', classId: 'class_1', resourceVersion: 1,
      stagingPath: 'task-recordings/staging/example/recording_demo_1.mp3', status: 'submitted' as const,
      fileId: 'cloud://virtual-env/task-recordings/private/example.mp3', contentSha256: 'a'.repeat(64),
      sizeBytes: 1000, durationMs: 2000, version: 2, createdAt: now, submittedAt: now };
    await audit.recordTeacherPlayback(teacher, recording, now);
    expect(await database.find('operation_logs', { organizationId: 'org_1' })).toMatchObject([{
      action: 'task-recording.getPlayback', actorUserId: 'teacher_1', targetId: 'recording_demo_1',
      metadata: { studentId: 'student_1', submissionVersion: 1 },
    }]);
    await expect(audit.recordTeacherPlayback(teacher, recording, now))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });
});
