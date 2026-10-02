export type ManagedKind = 'classroom' | 'activity' | 'template';
export interface ManagedFilters {
  readonly kind?: ManagedKind;
  readonly status?: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly keyword?: string;
}
export interface ManagedItem {
  readonly id: string;
  readonly kind: ManagedKind;
  readonly title: string;
  readonly teacherId: string | null;
  readonly teacherNameMasked: string;
  readonly classIds: readonly string[];
  readonly classNames: readonly string[];
  readonly startsAt: string | null;
  readonly dueAt: string | null;
  readonly status: string;
  readonly completedCount: number | null;
  readonly totalCount: number | null;
  readonly completionRate: number | null;
  readonly pendingReviewCount: number | null;
  readonly pendingCommentCount: number | null;
  readonly aiAssisted: false;
  readonly anomaly: string | null;
  readonly version: number;
}
export interface ManagedList { readonly items: readonly ManagedItem[]; readonly total: number;
  readonly nextOffset: number | null }
export interface ManagedDetail { readonly item: ManagedItem; readonly submissions: readonly Readonly<{
  studentId: string; studentNameMasked: string; status: string; submittedAt: string | null;
  score: number | null; hasFeedback: boolean;
}>[] }
export interface ManagedExport { readonly fileName: string; readonly csv: string }
export interface StopManagedResult { readonly id: string; readonly kind: ManagedKind; readonly status: string; readonly version: number }
export class ManagedError extends Error {
  public constructor(public readonly code: 'VALIDATION_ERROR' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'SERVICE_UNAVAILABLE') {
    super(code); this.name = 'ManagedError';
  }
}
