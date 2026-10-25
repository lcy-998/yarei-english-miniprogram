import { describe, expect, it } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { DocumentPronunciationSource } from '../../src/pronunciation/source-adapter';
import type { IdentityRepository } from '../../src/runtime/ports';
import type { TaskQueryRepository } from '../../src/task-query/repository';
import type { LearningProgressRepository } from '../../src/learning-progress/repository';
import type { DocumentDatabasePort } from '../../src/repositories/document-database-port';

const parent: TrustedActorContext = { requestId: 'request_parent_virtual_01',
  sessionId: 'session_parent_virtual_01', actorUserId: 'parent_virtual_01', actorRole: 'parent',
  organizationId: 'org_virtual_01', platformSubjectDigest: 'a'.repeat(64),
  permissions: ['child.read'], scopeIds: [], authzVersion: 1 };
const input = { studentId: 'student_virtual_01', taskId: 'task_virtual_01',
  assignmentId: 'assignment_virtual_01', submissionVersion: 1, itemId: 'item_virtual_01' };

describe('M3 parent formal pronunciation source lookup', () => {
  it('checks current parent link once and reads only the submitted item references', async () => {
    let linked = true;
    let linkReads = 0;
    let submissionReads = 0;
    const identities = { async findActiveParentLink() { linkReads += 1;
      return linked ? { studentId: input.studentId } : null; } } as unknown as IdentityRepository;
    const submissions = [{ organizationId: parent.organizationId, taskId: input.taskId,
      assignmentId: input.assignmentId, studentId: input.studentId,
      submissionVersion: 1, status: 'submitted', submittedAt: '2026-10-03T10:00:00+08:00',
      answers: [
        { itemId: input.itemId, value: { recordingId: 'pronunciation_virtual_01' } },
        { itemId: input.itemId, value: { recordingId: 'pronunciation_virtual_02' } },
        { itemId: 'other_item_virtual_01', value: { recordingId: 'foreign_virtual_01' } },
      ] }];
    const taskStub = { listTaskSubmissions: async () => { submissionReads += 1; return submissions; } };
    const tasks: TaskQueryRepository = taskStub as unknown as TaskQueryRepository;
    const source = new DocumentPronunciationSource(tasks, {} as LearningProgressRepository,
      {} as DocumentDatabasePort, identities, { nowIso: () => '2026-10-03T11:00:00+08:00' });
    expect(await source.parentSubmissionRecordingIds(parent, input)).toEqual({
      submittedAt: '2026-10-03T10:00:00+08:00',
      recordingIds: ['pronunciation_virtual_01', 'pronunciation_virtual_02'],
    });
    expect(linkReads).toBe(1);
    expect(submissionReads).toBe(1);
    linked = false;
    expect(await source.parentSubmissionRecordingIds(parent, input)).toBeNull();
    expect(submissionReads).toBe(1);
  });
});
