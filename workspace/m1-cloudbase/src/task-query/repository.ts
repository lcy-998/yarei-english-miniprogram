import type { ReviewFeedbackRecord, SubmissionRecord, TaskAssignmentRecord, TaskRecord } from '../task-core/types';
import type { QueryResourceOptionRecord, QueryTeacherGrantRecord } from './types';
import type { VocabularyAttemptRecord } from '../vocabulary-evidence/types';
import type { ReadingPageEventRecord } from '../learning-progress/types';

export interface TaskQueryRepository {
  listActiveTeacherGrants(organizationId: string, teacherId: string): Promise<readonly QueryTeacherGrantRecord[]>;
  listTasks(organizationId: string): Promise<readonly TaskRecord[]>;
  findTask(organizationId: string, taskId: string): Promise<TaskRecord | null>;
  listAssignments(organizationId: string): Promise<readonly TaskAssignmentRecord[]>;
  findAssignment(organizationId: string, taskId: string, studentId: string): Promise<TaskAssignmentRecord | null>;
  findAssignmentById(organizationId: string, assignmentId: string): Promise<TaskAssignmentRecord | null>;
  listSubmissions(organizationId: string): Promise<readonly SubmissionRecord[]>;
  listTaskSubmissions(organizationId: string, taskId: string): Promise<readonly SubmissionRecord[]>;
  findDraftSubmission(organizationId: string, assignmentId: string, submissionVersion: number): Promise<SubmissionRecord | null>;
  findSubmission(organizationId: string, submissionId: string): Promise<SubmissionRecord | null>;
  findFeedback(organizationId: string, submissionId: string): Promise<ReviewFeedbackRecord | null>;
  listVocabularyAttempts(organizationId: string, studentId: string, packId: string, taskId: string,
    itemId: string, round: number, contentVersion: string): Promise<readonly VocabularyAttemptRecord[]>;
  listReadingPageEvents(organizationId: string, studentId: string, resourceId: string): Promise<readonly ReadingPageEventRecord[]>;
  listPublishedResourceOptions(organizationId: string): Promise<readonly QueryResourceOptionRecord[]>;
  findPublishedResourceOption(organizationId: string, resourceId: string): Promise<QueryResourceOptionRecord | null>;
}
