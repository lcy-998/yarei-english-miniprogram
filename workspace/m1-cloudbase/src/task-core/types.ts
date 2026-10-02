import type { JsonObject, JsonValue } from '../shared/protocol';

export type LearningResourceType = 'reading' | 'vocabulary' | 'exercise' | 'recording';

export interface LearningResourceRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly type: LearningResourceType;
  readonly title: string;
  readonly contentVersion: number;
  readonly status: 'draft' | 'published' | 'offline';
  readonly visibility: 'organization' | 'classes';
  readonly allowedClassIds: readonly string[];
  readonly payload: JsonObject;
}

export interface ClassMembershipRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly classId: string;
  readonly studentId: string;
  readonly status: 'active' | 'inactive';
}

export interface TaskItemReference {
  readonly id: string;
  readonly resourceId: string;
  readonly completionRule?: JsonObject;
  readonly scoringRule?: JsonObject;
  readonly order: number;
}

export interface FrozenTaskItem {
  readonly id: string;
  readonly resourceId: string;
  readonly resourceVersion: number;
  readonly snapshotSchemaVersion: 1 | 2;
  readonly resourceSnapshot: Readonly<{
    title: string;
    type: LearningResourceType;
    payload: JsonObject;
  }>;
  readonly completionRule: JsonObject;
  readonly scoringRule: JsonObject;
  readonly order: number;
}

export interface LatePolicy {
  readonly allowLate: boolean;
  readonly lateDays: number;
}

export interface TaskRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly creatorTeacherId: string;
  readonly title: string;
  readonly deliveryType: 'classroom';
  readonly status: 'draft' | 'scheduled' | 'active' | 'expired' | 'withdrawn' | 'closed' | 'completed';
  readonly targetType: 'classes' | 'students';
  readonly targetClassIds: readonly string[];
  readonly targetStudentIds: readonly string[];
  readonly startsAt: string;
  readonly dueAt: string;
  readonly latePolicy: LatePolicy;
  readonly description: string | null;
  readonly teacherNote: string | null;
  readonly itemRefs: readonly TaskItemReference[];
  readonly items: readonly FrozenTaskItem[];
  /** Server-owned lineage for drafts copied from a published content snapshot. */
  readonly copiedFromTaskId?: string | null;
  readonly copiedFromTemplateId?: string | null;
  readonly publishedAt: string | null;
  readonly deadlineExtendedAt: string | null;
  readonly visibility: 'visible' | 'recycled';
  readonly withdrawnAt: string | null;
  readonly withdrawnBy: string | null;
  readonly withdrawReason: string | null;
  readonly recycledAt: string | null;
  readonly recycledBy: string | null;
  readonly recycleReason: string | null;
  readonly recoverableUntil: string | null;
  readonly version: number;
  /** A hidden, resumable roster materialization; draft tasks remain invisible to students. */
  readonly publication?: Readonly<{
    operationId: string;
    originalVersion: number;
    nextIndex: number;
    entries: readonly Readonly<{ studentId: string; classId: string }>[];
    classMembershipGuards: readonly Readonly<{ classId: string; expectedVersion: number }>[];
  }> | null;
  readonly publishOperationId?: string | null;
}

export type AssignmentStatus =
  | 'not_started'
  | 'in_progress'
  | 'awaiting_review'
  | 'completed'
  | 'redo_required'
  | 'overdue';

export interface TaskAssignmentRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly taskId: string;
  readonly studentId: string;
  readonly classId: string;
  readonly status: AssignmentStatus;
  readonly latestSubmissionId: string | null;
  readonly latestSubmissionVersion: number;
  readonly redoCount: number;
  readonly redoDueAt: string | null;
  readonly isLate: boolean;
  readonly submittedAt: string | null;
  readonly reviewedAt: string | null;
  readonly version: number;
}

export interface SubmissionAnswer {
  readonly itemId: string;
  readonly value: JsonValue;
}

export type ReadingCompletionResult = Readonly<{
  kind: 'reading';
  completedPageCount: number;
}>;

export type VocabularyCompletionResult = Readonly<{
  kind: 'vocabulary';
  completedWordCount: number;
  correctWordCount: number;
}>;

export type ExerciseCompletionResult = Readonly<{
  kind: 'exercise';
  answeredQuestionCount: number;
}>;

export type TaskCompletionResult = ReadingCompletionResult | VocabularyCompletionResult | ExerciseCompletionResult;

export interface SubmissionRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly taskId: string;
  readonly assignmentId: string;
  readonly studentId: string;
  readonly submissionVersion: number;
  readonly recordVersion: number;
  readonly status: 'draft' | 'submitted' | 'reviewed' | 'returned';
  readonly answers: readonly SubmissionAnswer[];
  readonly isLate: boolean;
  readonly submittedAt: string | null;
  readonly supersedesSubmissionId: string | null;
}

export interface ReviewFeedbackRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly taskId: string;
  readonly assignmentId: string;
  readonly submissionId: string;
  readonly submissionVersion: number;
  readonly teacherId: string;
  readonly decision: 'approved' | 'returned';
  readonly score: number | null;
  readonly itemScores?: readonly Readonly<{ itemId: string; score: number }>[];
  readonly originalAutomaticScore?: number | null;
  readonly overrideReason?: string | null;
  readonly textComment: string | null;
  readonly returnReason: string | null;
  readonly publishedAt: string;
  readonly source: 'manual';
}

export interface SaveTaskDraftInput {
  readonly taskId?: string;
  readonly title: string;
  readonly itemRefs: readonly TaskItemReference[];
  readonly targetType?: 'classes' | 'students';
  readonly targetClassIds: readonly string[];
  readonly targetStudentIds?: readonly string[];
  readonly startsAt: string;
  readonly dueAt: string;
  readonly latePolicy: LatePolicy;
  readonly description?: string;
  readonly teacherNote?: string;
}

export interface UpdatePublishedTaskInput {
  readonly taskId: string;
  readonly title?: string;
  readonly itemRefs?: readonly TaskItemReference[];
  readonly targetType?: 'classes' | 'students';
  readonly targetClassIds?: readonly string[];
  readonly targetStudentIds?: readonly string[];
  readonly startsAt?: string;
  readonly dueAt?: string;
  readonly latePolicy?: LatePolicy;
  readonly description?: string;
  readonly teacherNote?: string;
}

export interface ParentTaskResultView {
  readonly taskId: string;
  readonly title: string;
  readonly studentId: string;
  readonly assignmentStatus: AssignmentStatus;
  readonly automaticScore?: number | null;
  readonly submission: Readonly<{
    id: string;
    version: number;
    answers: readonly SubmissionAnswer[];
    submittedAt: string;
  }> | null;
  readonly feedback: Readonly<{
    id: string;
    decision: 'approved' | 'returned';
    score: number | null;
    textComment: string | null;
    returnReason: string | null;
    publishedAt: string;
  }> | null;
}

export interface TeacherSubmissionReviewView {
  readonly taskId: string;
  readonly taskTitle: string;
  readonly assignmentId: string;
  readonly assignmentVersion: number;
  readonly studentId: string;
  readonly submissionId: string;
  readonly submissionVersion: number;
  readonly answers: readonly SubmissionAnswer[];
  readonly isLate: boolean;
  readonly submittedAt: string;
}
