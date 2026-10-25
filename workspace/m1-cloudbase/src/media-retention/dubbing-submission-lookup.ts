import type { VersionedDocument } from '../repositories/document-database-port';
import type { TaskQueryRepository } from '../task-query/repository';

/** Only the formal submission containing this exact final work starts task dubbing retention. */
export class TaskDubbingSubmissionLookup {
  public constructor(private readonly tasks: Pick<TaskQueryRepository, 'listTaskSubmissions'>) {}

  public async submittedAt(work: VersionedDocument): Promise<string | null> {
    if (typeof work.taskId !== 'string' || typeof work.assignmentId !== 'string'
      || typeof work.studentId !== 'string' || typeof work.itemId !== 'string'
      || !Number.isSafeInteger(work.round)) return null;
    const submissions = await this.tasks.listTaskSubmissions(work.organizationId, work.taskId);
    const match = submissions.find(submission => submission.organizationId === work.organizationId
      && submission.taskId === work.taskId && submission.assignmentId === work.assignmentId
      && submission.studentId === work.studentId && submission.submissionVersion === work.round
      && submission.status !== 'draft' && submission.submittedAt !== null
      && submission.answers.some(answer => answer.itemId === work.itemId
        && typeof answer.value === 'object' && answer.value !== null && !Array.isArray(answer.value)
        && (answer.value as Record<string, unknown>).kind === 'dubbing'
        && (answer.value as Record<string, unknown>).finalWorkId === work._id));
    return match?.submittedAt ?? null;
  }
}
