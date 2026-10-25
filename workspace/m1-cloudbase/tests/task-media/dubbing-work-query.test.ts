import { describe, expect, it } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import type { TaskAssignmentRecord, TaskRecord, SubmissionRecord } from '../../src/task-core/types';
import { TaskDubbingWorkQueryService } from '../../src/task-media/dubbing-work-query';

const student: TrustedActorContext = { requestId: 'req_student', sessionId: 'ses_student',
  actorUserId: 'student_demo', actorRole: 'student', organizationId: 'org_demo',
  platformSubjectDigest: 'digest_demo', permissions: [], scopeIds: ['student_demo'], authzVersion: 1 };

describe('S-12 task dubbing safe own-work listing', () => {
  it('shows only own formal task work summary and no private storage keys', async () => {
    const db = new FakeDocumentDatabase({ task_dubbing_works: [{ _id: 'work_demo',
      organizationId: 'org_demo', schemaVersion: 1, version: 2, deletedAt: null,
      studentId: 'student_demo', assignmentId: 'assignment_demo', round: 1,
      taskId: 'task_demo', itemId: 'item_demo', mediaId: 'media_demo', mediaVersion: 2,
      status: 'submitted', submittedAt: '2026-10-03T08:00:00+08:00',
      recording: { mediaId: 'recording_demo', durationMs: 3000, sizeBytes: 1024, serverReadable: true },
      fileId: 'cloud://private/task-work.mp3', contentSha256: 'a'.repeat(64),
      mediaDeletedAt: null, stagingPath: 'task-dubbing/staging/private', createdAt: '2026-10-03T07:00:00+08:00',
    }] });
    const task = { title: '虚构任务配音' } as TaskRecord;
    const assignment = { id: 'assignment_demo', latestSubmissionId: 'submission_demo' } as TaskAssignmentRecord;
    const submission = { status: 'submitted', submissionVersion: 1,
      submittedAt: '2026-10-03T08:00:00+08:00', answers: [
      { itemId: 'item_demo', value: { kind: 'dubbing', finalWorkId: 'work_demo' } },
    ] } as SubmissionRecord;
    const service = new TaskDubbingWorkQueryService(db, {
      async findTask() { return task; }, async findAssignment() { return assignment; },
      async findSubmission() { return submission; },
    }, undefined, { nowIso: () => '2026-10-04T08:00:00+08:00' });
    const result = await service.listMine(student, 0, 20);
    expect(result).toMatchObject({ items: [{ workId: 'work_demo', taskTitle: '虚构任务配音',
      status: 'formal', durationMs: 3000, playbackAvailable: true }] });
    const json = JSON.stringify(result);
    expect(json).not.toContain('cloud://');
    expect(json).not.toContain('contentSha256');
    expect(await service.listMine({ ...student, actorRole: 'parent' }, 0, 20)).toBeNull();
    let now = Date.parse('2026-10-04T08:00:00+08:00');
    const playback = new TaskDubbingWorkQueryService(db, {
      async findTask() { return task; }, async findAssignment() { return assignment; },
      async findSubmission() { return { ...submission,
        submittedAt: '2026-10-03T08:00:00+08:00' }; },
    }, { async temporaryUrl() { return 'https://example.invalid/private-work' } },
    { nowIso: () => new Date(now).toISOString() });
    expect(await playback.getPlayback(student, 'work_demo'))
      .toMatchObject({ workId: 'work_demo', status: 'formal', durationMs: 3000,
        temporaryUrl: 'https://example.invalid/private-work' });
    expect(db.snapshot().operation_logs).toHaveLength(1);
    expect(await playback.getPlayback({ ...student, actorUserId: 'student_other' }, 'work_demo')).toBeNull();
    now = Date.parse('2027-04-03T08:00:00+08:00');
    expect(await playback.getPlayback(student, 'work_demo')).toBeNull();
  });
});
