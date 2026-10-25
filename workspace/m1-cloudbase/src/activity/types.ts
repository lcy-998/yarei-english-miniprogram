import type { ActivityLeaderboard, ActivityParticipant, ActivityRank, ActivitySchedule, DailyCondition } from '../task-core/activity-rules';
import type { ReviewFeedbackRecord, SubmissionRecord, TaskAssignmentRecord, TaskRecord } from '../task-core/types';

export interface ActivityEntity {
  readonly id: string;
  readonly organizationId: string;
  readonly creatorTeacherId: string;
  readonly title: string;
  readonly description: string;
  readonly schedule: ActivitySchedule;
  readonly status: 'draft' | 'published' | 'closed';
  readonly participants: readonly ActivityParticipant[];
  readonly conditionSnapshots: readonly ActivityConditionSnapshot[];
  /** One immutable occurrence per effective school day; participants and rules live in the published parent snapshot. */
  readonly dailyInstances: readonly ActivityDailyInstance[];
  /** Append-only audit for rest days added after publication; absent on older records. */
  readonly restDayChanges?: readonly ActivityRestDayChange[];
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly publishedAt: string | null;
  readonly closedAt: string | null;
  readonly visibility?: 'visible' | 'recycled';
  readonly recycledAt?: string | null;
  readonly recycledBy?: string | null;
  readonly recycleReason?: string | null;
  readonly recoverableUntil?: string | null;
}

export interface ActivityRestDayChange {
  readonly id: string;
  readonly date: string;
  readonly reason: string;
  readonly teacherId: string;
  readonly changedAt: string;
  readonly activityVersion: number;
}

export interface ActivityDailyInstance {
  readonly id: string;
  readonly date: string;
  readonly classId: string;
  readonly activityVersion: number;
  readonly createdAt: string;
}

export interface ActivityConditionSnapshot {
  readonly kind: DailyCondition['kind'];
  readonly resourceId: string;
  readonly contentVersion: string;
  readonly pageIds?: readonly string[];
  readonly wordIds?: readonly string[];
  readonly questionIds?: readonly string[];
}

export interface ActivityDayView {
  readonly activityId: string;
  readonly date: string;
  readonly restDay: boolean;
  readonly complete: boolean | null;
  readonly evidenceStatus: 'available' | 'not_available';
  readonly verifiedConditions: number;
  readonly totalConditions: number;
  readonly completedAt: string | null;
  readonly supplemented: boolean;
  /** Present for a live day with verifiable evidence; historical snapshots only retain the aggregate. */
  readonly conditionProgress?: readonly ActivityConditionProgress[];
}

export interface VerifiedActivityDayEvent {
  readonly activityId: string;
  readonly activityTitle: string;
  readonly classId: string;
  readonly studentId: string;
  readonly date: string;
  readonly supplemented: boolean;
}

export interface VerifiedActivityDayPage {
  readonly evidenceStatus: 'available' | 'partial';
  readonly events: readonly VerifiedActivityDayEvent[];
}

export interface TeacherActivityProgressView {
  readonly activityId: string;
  readonly date: string;
  readonly schoolToday: string;
  readonly restDay: boolean;
  readonly evidenceStatus: 'available' | 'not_available';
  readonly completedCount: number | null;
  readonly participantCount: number;
  readonly updatedAt: string;
  readonly rows: readonly Readonly<{
    studentId: string;
    displayNameMasked: string;
    complete: boolean | null;
    supplemented: boolean;
    completedDays: number;
    consecutiveDays: number;
    missingConditions: readonly DailyCondition['kind'][];
    evidenceDetailAvailable: boolean;
  }>[];
  readonly nextOffset: number | null;
}

export interface ActivityConditionProgress {
  readonly index: number;
  readonly kind: ActivityConditionSnapshot['kind'];
  readonly resourceId: string;
  readonly complete: boolean;
  readonly completedAt: string | null;
}

export interface ActivityOverrideRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly activityId: string;
  readonly studentId: string;
  readonly classId: string;
  readonly date: string;
  readonly active: boolean;
  readonly reason: string;
  readonly teacherId: string;
  readonly changedAt: string;
  readonly version: number;
}

export interface ActivityOverrideReceipt {
  readonly organizationId: string;
  readonly actorUserId: string;
  readonly operationId: string;
  readonly fingerprint: string;
  readonly result: ActivityOverrideRecord;
}

export interface ActivityOverrideState {
  readonly activityId: string;
  readonly studentId: string;
  readonly date: string;
  readonly version: number;
  readonly active: boolean;
  readonly reason: string | null;
  readonly changedAt: string | null;
}

export interface ActivityLeaderboardView {
  readonly activityId: string;
  readonly title: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly schoolToday: string;
  readonly restDayCount: number;
  readonly updatedAt: string;
  readonly evidenceStatus: 'available' | 'not_available';
  readonly leaderboard: ActivityLeaderboard | null;
  readonly myRank: ActivityRank | null;
}

export interface ActivityFinalSnapshot {
  readonly organizationId: string;
  readonly activityId: string;
  readonly activityVersion: number;
  readonly lockedAt: string;
  readonly leaderboard: ActivityLeaderboard;
  readonly completedDatesByStudent: Readonly<Record<string, readonly string[]>>;
  readonly supplementedDatesByStudent: Readonly<Record<string, readonly string[]>>;
  /** Added in M3; older locked boards legitimately lack per-condition detail. */
  readonly conditionDetailComplete?: true;
  readonly conditionStatusByStudentDay?: Readonly<Record<string, readonly boolean[]>>;
}

export interface ActivityExerciseSource {
  readonly task: TaskRecord;
  readonly assignment: TaskAssignmentRecord;
  readonly submission: SubmissionRecord;
  readonly feedback: ReviewFeedbackRecord | null;
}

/** A published classroom task that a participant can still submit for one daily exercise condition. */
export interface ActivityExerciseOpportunity {
  readonly taskId: string;
  readonly resourceVersion: string;
  readonly startsAt: string;
  readonly dueAt: string;
  readonly lateDays: number;
  readonly studentIds: readonly string[];
}

export interface ActivityDraftInput {
  readonly activityId?: string;
  readonly title: string;
  readonly description?: string;
  readonly classId: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly restDates: readonly string[];
  readonly conditions: readonly DailyCondition[];
}

export interface ActivityOperationReceipt {
  readonly organizationId: string;
  readonly actorUserId: string;
  readonly action: 'saveDraft' | 'publish' | 'addFutureRestDay' | 'close' | 'deleteDraft' | 'recycle';
  readonly operationId: string;
  readonly fingerprint: string;
  readonly result: ActivityEntity;
}

export type ActivityErrorCode = 'VALIDATION_ERROR' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'RESOURCE_OFFLINE' | 'ACTIVITY_PENDING_REVIEW' | 'SERVICE_UNAVAILABLE';

export class ActivityError extends Error {
  public constructor(public readonly code: ActivityErrorCode) {
    super(code);
    this.name = 'ActivityError';
  }
}

export interface ActivityOrganization { readonly id: string; readonly status: 'active' | 'disabled'; readonly timeZone: string }
export interface ActivityClass { readonly id: string; readonly organizationId: string; readonly status: 'active' | 'archived' }
export interface ActivityGrant { readonly organizationId: string; readonly teacherId: string; readonly classId: string; readonly status: 'active' | 'revoked'; readonly permissions: readonly string[] }
export interface ActivityMembership { readonly organizationId: string; readonly studentId: string; readonly classId: string; readonly status: 'active' | 'inactive' | 'transferred' }
export interface ActivityUser { readonly id: string; readonly organizationId: string; readonly status: 'active' | 'disabled'; readonly displayNameMasked: string }
export interface ActivityConditionResource {
  readonly id: string;
  readonly organizationId: string;
  readonly type: 'reading' | 'vocabulary' | 'exercise' | 'work';
  readonly status: 'published' | 'offline' | 'draft';
  readonly contentVersion: string;
  readonly pageIds?: readonly string[];
  readonly wordIds?: readonly string[];
  readonly questionIds?: readonly string[];
  readonly visibility: { readonly type: 'organization' } | { readonly type: 'classes'; readonly classIds: readonly string[] };
}
