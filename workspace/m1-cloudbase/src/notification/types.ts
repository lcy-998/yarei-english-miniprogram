export type NotificationKind = 'task_published' | 'activity_published' | 'task_due' | 'task_returned' | 'task_reviewed' | 'checkin_reminder';
export type NotificationTarget = Readonly<{ kind: 'student_task' | 'parent_task' | 'teacher_task' | 'student_activity'; id: string;
  childId?: string }>;

export interface InboxNotice {
  readonly id: string;
  readonly kind: NotificationKind;
  readonly title: string;
  readonly summary: string;
  readonly occurredAt: string;
  readonly target: NotificationTarget;
  readonly readAt: string | null;
}

export interface ScheduledNoticeRecord extends InboxNotice {
  readonly organizationId: string;
  readonly recipientUserId: string;
  readonly recipientRole: 'student' | 'parent';
  readonly sourceStudentId: string;
}

export interface InboxPage {
  readonly items: readonly InboxNotice[];
  readonly unreadCount: number;
  readonly total: number;
  readonly hasMore: boolean;
}

export interface TaskNoticeFact {
  readonly taskId: string;
  readonly title: string;
  readonly publishedAt: string;
  readonly dueAt: string;
  readonly studentId: string;
  readonly assignmentStatus: string;
  readonly feedback: readonly Readonly<{
    id: string; decision: 'approved' | 'returned'; publishedAt: string;
  }>[];
}

export interface ActivityNoticeFact {
  readonly id: string;
  readonly title: string;
  readonly studentId: string;
  readonly schoolTimeZone: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly restDates: readonly string[];
  readonly publishedAt: string;
}

export class NotificationError extends Error {
  public constructor(public readonly code: 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION_ERROR' | 'SERVICE_UNAVAILABLE') {
    super(code);
    this.name = 'NotificationError';
  }
}
