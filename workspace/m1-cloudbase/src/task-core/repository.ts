import type {
  ClassMembershipRecord,
  LearningResourceRecord,
  ReviewFeedbackRecord,
  SubmissionRecord,
  TaskAssignmentRecord,
  TaskRecord,
} from './types';
import type { IdempotencyRecord, OperationLogRecord, TeacherClassGrantRecord } from '../runtime/records';
import type { ReadingPageEventRecord, ReadingProgressRecord, VocabularyProgressRecord } from '../learning-progress/types';
import type { VocabularyAttemptRecord } from '../vocabulary-evidence/types';
import type { TaskRecordingRecord } from '../task-recording/types';
import type { TaskTemplate } from '../task-template/types';

export interface ClassMembershipGuardRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly status: 'active' | 'archived';
  readonly version: number;
}

export interface TaskCoreReader {
  findResource(organizationId: string, resourceId: string): Promise<LearningResourceRecord | null>;
  findReadingProgress(organizationId: string, studentId: string, resourceId: string): Promise<ReadingProgressRecord | null>;
  listReadingPageEvents(organizationId: string, studentId: string, resourceId: string): Promise<readonly ReadingPageEventRecord[]>;
  findVocabularyProgress(organizationId: string, studentId: string, packId: string): Promise<VocabularyProgressRecord | null>;
  listVocabularyAttempts(organizationId: string, studentId: string, packId: string, taskId: string,
    itemId: string, round: number, contentVersion: string): Promise<readonly VocabularyAttemptRecord[]>;
  findTaskRecording(organizationId: string, recordingId: string): Promise<TaskRecordingRecord | null>;
  listActiveClassMemberships(organizationId: string, classIds: readonly string[]): Promise<readonly ClassMembershipRecord[]>;
  listActiveStudentMemberships(organizationId: string, studentIds: readonly string[]): Promise<readonly ClassMembershipRecord[]>;
  listActiveTeacherGrants(organizationId: string, teacherId: string, classIds: readonly string[]): Promise<readonly TeacherClassGrantRecord[]>;
  findClassMembershipGuard(organizationId: string, classId: string): Promise<ClassMembershipGuardRecord | null>;

  findTask(organizationId: string, taskId: string): Promise<TaskRecord | null>;
  findTemplate(organizationId: string, templateId: string): Promise<TaskTemplate | null>;
  findAssignment(organizationId: string, taskId: string, studentId: string): Promise<TaskAssignmentRecord | null>;
  findAssignmentById(organizationId: string, assignmentId: string): Promise<TaskAssignmentRecord | null>;
  listTaskAssignments(organizationId: string, taskId: string): Promise<readonly TaskAssignmentRecord[]>;
  findSubmission(organizationId: string, submissionId: string): Promise<SubmissionRecord | null>;
  listTaskSubmissions(organizationId: string, taskId: string): Promise<readonly SubmissionRecord[]>;
  findDraftSubmission(organizationId: string, assignmentId: string, submissionVersion: number): Promise<SubmissionRecord | null>;
  findFeedbackBySubmission(organizationId: string, submissionId: string): Promise<ReviewFeedbackRecord | null>;
  findIdempotencyRecord(recordId: string): Promise<IdempotencyRecord | null>;
}

/**
 * Every write used by a task command is exposed only through the transaction
 * handle. A CloudBase adapter must bind these methods to the same native
 * database transaction; delegating idempotency or audit to another store does
 * not satisfy this port.
 */
export interface TaskCoreTransaction extends TaskCoreReader {
  findActiveTeacherGrant(organizationId: string, teacherId: string, classId: string): Promise<TeacherClassGrantRecord | null>;

  saveTask(task: TaskRecord): Promise<void>;
  saveTemplate(template: TaskTemplate): Promise<void>;
  saveAssignment(assignment: TaskAssignmentRecord): Promise<void>;
  deleteAssignment(assignment: TaskAssignmentRecord): Promise<void>;
  saveSubmission(submission: SubmissionRecord): Promise<void>;
  saveFeedback(feedback: ReviewFeedbackRecord): Promise<void>;

  createIdempotencyRecord(record: IdempotencyRecord): Promise<boolean>;
  replaceIdempotencyRecord(record: IdempotencyRecord): Promise<void>;
  appendOperationLog(entry: OperationLogRecord): Promise<void>;
}

export interface TaskCoreUnitOfWork extends TaskCoreReader {
  runTransaction<T>(scope: TaskCoreTransactionScope, work: (transaction: TaskCoreTransaction) => Promise<T>): Promise<T>;
}

/**
 * Candidate documents resolved before entering a native document transaction.
 * Class-target membership snapshots additionally carry the pre-read
 * `classes.version`; membership writers must increment that version atomically.
 */
export interface TaskCoreTransactionScope {
  readonly organizationId: string;
  readonly resourceIds: readonly string[];
  readonly templateIds?: readonly string[];
  readonly membershipIds: readonly string[];
  readonly teacherGrantIds: readonly string[];
  readonly assignmentIds: readonly string[];
  readonly submissionIds: readonly string[];
  readonly classMembershipGuards: readonly Readonly<{ classId: string; expectedVersion: number }>[];
}

/** @deprecated Prefer TaskCoreUnitOfWork; retained as a source-compatible name. */
export type TaskCoreRepository = TaskCoreUnitOfWork;
