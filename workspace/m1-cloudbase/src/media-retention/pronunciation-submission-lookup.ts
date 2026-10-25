import type { VersionedDocument } from '../repositories/document-database-port';
import type { TaskQueryRepository } from '../task-query/repository';
import type { PronunciationFormalSubmissionPort } from '../pronunciation/repository';
import type { PronunciationRecording } from '../pronunciation/types';
import type { PronunciationSubmissionLookup } from './service';

/** Uses a formal task-item submission in the recording's frozen round, not a draft's planned version. */
export class TaskPronunciationSubmissionLookup implements PronunciationSubmissionLookup,
  PronunciationFormalSubmissionPort {
  public constructor(private readonly tasks: TaskQueryRepository) {}

  public async submittedAt(record: VersionedDocument | PronunciationRecording): Promise<string | null> {
    if (!record.source || typeof record.source !== 'object' || Array.isArray(record.source)) return null;
    const source = record.source as Record<string, unknown>;
    if (source.kind !== 'task' || typeof source.taskId !== 'string'
      || typeof source.assignmentId !== 'string' || typeof source.itemId !== 'string'
      || !Number.isSafeInteger(source.submissionVersion) || typeof record.studentId !== 'string') return null;
    const submissions = await this.tasks.listTaskSubmissions(record.organizationId, source.taskId);
    const matched = submissions.find(submission => submission.organizationId === record.organizationId
      && submission.taskId === source.taskId && submission.assignmentId === source.assignmentId
      && submission.studentId === record.studentId
      && submission.submissionVersion === source.submissionVersion
      && submission.status !== 'draft' && submission.submittedAt !== null
      && submission.answers.some(answer => answer.itemId === source.itemId
        && typeof answer.value === 'object' && answer.value !== null && !Array.isArray(answer.value)
        && ((answer.value as Record<string, unknown>).recordingId === record.id
          || (source.kind === 'task'
            && (answer.value as Record<string, unknown>).kind === 'reading'))));
    return matched?.submittedAt ?? null;
  }
}
