import type { JsonObject } from '../shared/protocol';
import type {
  AssignmentStatus,
  ReviewFeedbackRecord,
  SubmissionAnswer,
  SubmissionRecord,
  TaskAssignmentRecord,
  TaskRecord,
} from '../task-core/types';

export interface QueryTeacherGrantRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly teacherId: string;
  readonly classId: string;
  readonly className: string;
  readonly permissions: readonly string[];
  readonly status: 'active' | 'revoked';
}

export interface QueryResourceOptionRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly title: string;
  readonly type: 'reading' | 'vocabulary' | 'exercise';
  readonly status: 'draft' | 'published' | 'offline';
  readonly allowedClassIds: readonly string[];
}

export interface PageRequest {
  readonly limit: number;
  readonly cursor?: string;
}

/**
 * Opaque capability boundary for pagination and short-lived query previews.
 * The local implementation keeps payloads server-side; a deployed adapter can
 * replace it with authenticated encryption or an HMAC-backed encoding.
 */
export interface CursorCodec {
  encode(payload: string): string;
  decode(token: string): string | null;
}

export interface PageResult<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly nextCursor: string | null;
}

export interface TeacherTaskFilters {
  readonly classId?: string;
  readonly status?: TaskRecord['status'];
  readonly keyword?: string;
}

export interface CompletionFilters {
  readonly classId?: string;
  readonly status?: AssignmentStatus;
}

export interface StudentTaskFilters {
  readonly status?: AssignmentStatus;
  readonly keyword?: string;
}

export interface ReviewTaskFilters {
  readonly classId?: string;
  readonly status?: 'pending' | 'reviewed';
  readonly keyword?: string;
}

export interface TeacherTaskListItem {
  readonly taskId: string;
  readonly title: string;
  readonly status: TaskRecord['status'];
  readonly startsAt: string;
  readonly dueAt: string;
  readonly classIds: readonly string[];
  readonly completedCount: number;
  readonly totalCount: number;
  readonly pendingReviewCount: number;
  readonly version: number;
}

export interface TeacherWorkbenchView {
  readonly date: string;
  readonly classIds: readonly string[];
  readonly activeTaskCount: number;
  readonly pendingReviewCount: number;
  readonly pendingCommentCount: number;
  readonly recentTasks: readonly TeacherTaskListItem[];
}

export interface TaskDraftOptions {
  readonly classes: readonly Readonly<{ id: string; name: string }>[];
  readonly resources: readonly Readonly<{
    id: string;
    title: string;
    type: QueryResourceOptionRecord['type'];
    allowedClassIds: readonly string[];
    completionRule: JsonObject;
    scoringRule: JsonObject;
  }>[];
}

export interface StudentTaskPreview {
  readonly taskId: string | null;
  readonly title: string;
  readonly description: string | null;
  readonly startsAt: string;
  readonly dueAt: string;
  readonly classIds: readonly string[];
  readonly items: readonly SafeTaskItemView[];
  readonly version: number;
}

export interface CompletionListItem {
  readonly assignmentId: string;
  readonly studentId: string;
  readonly classId: string;
  readonly status: AssignmentStatus;
  readonly submittedAt: string | null;
  readonly latestSubmissionId: string | null;
  readonly latestSubmissionVersion: number;
  readonly isLate: boolean;
  readonly reviewedAt: string | null;
}

export interface TaskCompletionView {
  readonly task: TeacherTaskListItem;
  readonly counts: Readonly<Record<AssignmentStatus, number>>;
  readonly assignments: PageResult<CompletionListItem>;
}

export interface StudentTaskListItem {
  readonly taskId: string;
  readonly title: string;
  readonly status: AssignmentStatus;
  readonly startsAt: string;
  readonly dueAt: string;
  readonly submittedAt: string | null;
  readonly isLate: boolean;
}

export interface StudentHomeView {
  readonly localDate: string;
  readonly completedCount: number;
  readonly totalCount: number;
  readonly nextTask: StudentTaskListItem | null;
}

export interface ParentTaskListItem extends StudentTaskListItem {
  readonly feedbackId: string | null;
  readonly feedbackPublishedAt: string | null;
}

export interface ParentChildListItem {
  readonly linkId: string;
  readonly linkVersion: number;
  readonly childId: string;
  readonly displayName: string;
  readonly displayNameMasked: string;
  readonly studentNumber: string | null;
  readonly classId: string | null;
  readonly className: string | null;
  readonly confirmedAt: string | null;
}

export interface ParentHomeView {
  readonly childId: string;
  readonly child: Readonly<{
    id: string;
    displayName: string;
    displayNameMasked: string;
    classId: string | null;
    className: string | null;
  }>;
  readonly pendingTaskCount: number;
  readonly completedTaskCount: number;
  readonly recentTasks: readonly ParentTaskListItem[];
  readonly recentFeedback: readonly Readonly<{
    feedbackId: string;
    taskId: string;
    taskTitle: string;
    decision: ReviewFeedbackRecord['decision'];
    score: number | null;
    publishedAt: string;
  }>[];
}

export interface FeedbackDetailView {
  readonly feedbackId: string;
  readonly childId: string;
  readonly taskId: string;
  readonly taskTitle: string;
  readonly submission: Readonly<{
    id: string;
    version: number;
    answers: readonly SubmissionAnswer[];
    submittedAt: string;
  }>;
  readonly feedback: Readonly<{
    decision: ReviewFeedbackRecord['decision'];
    score: number | null;
    textComment: string | null;
    returnReason: string | null;
    publishedAt: string;
  }>;
}

export interface StudentTaskDetailView {
  readonly taskId: string;
  readonly title: string;
  readonly description: string | null;
  readonly startsAt: string;
  readonly dueAt: string;
  readonly items: readonly SafeTaskItemView[];
  readonly assignment: Readonly<{
    status: AssignmentStatus;
    isLate: boolean;
    submittedAt: string | null;
    redoCount: number;
    redoDueAt: string | null;
    version: number;
  }>;
  readonly submission: Readonly<{
    id: string;
    version: number;
    status: SubmissionRecord['status'];
    answers: readonly SubmissionAnswer[];
    submittedAt: string | null;
    recordVersion: number;
    assignmentVersion: number;
  }> | null;
  readonly feedback: Readonly<{
    id: string;
    decision: ReviewFeedbackRecord['decision'];
    score: number | null;
    textComment: string | null;
    returnReason: string | null;
    publishedAt: string;
  }> | null;
}

export interface ReviewTaskListItem extends TeacherTaskListItem {
  readonly reviewedCount: number;
}

export interface ReviewSubmissionView {
  readonly taskId: string;
  readonly taskTitle: string;
  readonly assignmentId: string;
  readonly assignmentVersion: number;
  readonly studentId: string;
  readonly classId: string;
  readonly submissionId: string;
  readonly submissionVersion: number;
  readonly answers: readonly SubmissionAnswer[];
  readonly isLate: boolean;
  readonly submittedAt: string;
  readonly feedback: Readonly<{
    id: string;
    decision: ReviewFeedbackRecord['decision'];
    score: number | null;
    textComment: string | null;
    returnReason: string | null;
    publishedAt: string;
  }> | null;
}

export interface BatchReviewPreview {
  readonly previewToken: string;
  readonly previewVersion: number;
  readonly eligibleCount: number;
  readonly excludedCount: number;
  readonly commentSummary: Readonly<{ length: number }>;
}

export interface DraftPreviewInput {
  readonly title: string;
  readonly description?: string;
  readonly startsAt: string;
  readonly dueAt: string;
  readonly targetClassIds: readonly string[];
  readonly items: readonly Readonly<{
    id: string;
    resourceId: string;
    title: string;
    type: QueryResourceOptionRecord['type'];
    completionRule: JsonObject;
    scoringRule: JsonObject;
    order: number;
  }>[];
}

export type QuerySubmissionRecord = SubmissionRecord;
export type QueryAssignmentRecord = TaskAssignmentRecord;

/**
 * Intentionally excludes the arbitrary resource payload and scoring rule. Those
 * records may contain answer keys, OCR text, or internal content metadata.
 */
export interface SafeTaskItemView {
  readonly id: string;
  readonly resourceId: string;
  readonly resourceVersion: number;
  readonly snapshotSchemaVersion: 1;
  readonly title: string;
  readonly type: QueryResourceOptionRecord['type'];
  readonly completionRule: JsonObject;
  readonly order: number;
}
