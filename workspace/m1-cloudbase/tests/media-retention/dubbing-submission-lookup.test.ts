import { describe, expect, it } from 'vitest';
import { TaskDubbingSubmissionLookup } from '../../src/media-retention/dubbing-submission-lookup';
import type { TaskQueryRepository } from '../../src/task-query/repository';
import type { VersionedDocument } from '../../src/repositories/document-database-port';

describe('task dubbing retention anchor', () => {
  it('uses only the formal submission that cites the exact final work', async () => {
    const work = { _id: 'work_12345678', organizationId: 'org_demo',
      schemaVersion: 1, version: 1, deletedAt: null, taskId: 'task_demo',
      assignmentId: 'assignment_demo', studentId: 'student_demo', itemId: 'item_demo', round: 1,
    } as VersionedDocument;
    const submission = { organizationId: 'org_demo', taskId: 'task_demo',
      assignmentId: 'assignment_demo', studentId: 'student_demo', submissionVersion: 1,
      status: 'submitted', submittedAt: '2026-10-01T00:00:00.000Z',
      answers: [{ itemId: 'item_demo', value: { kind: 'dubbing', finalWorkId: 'work_12345678' } }],
    };
    let cited = true;
    const tasks = { async listTaskSubmissions() {
      return [{ ...submission, answers: cited ? submission.answers
        : [{ itemId: 'item_demo', value: { kind: 'dubbing', finalWorkId: 'other_work' } }] }];
    } } as unknown as Pick<TaskQueryRepository, 'listTaskSubmissions'>;
    const lookup = new TaskDubbingSubmissionLookup(tasks);
    expect(await lookup.submittedAt(work)).toBe(submission.submittedAt);
    cited = false;
    expect(await lookup.submittedAt(work)).toBeNull();
  });
});
