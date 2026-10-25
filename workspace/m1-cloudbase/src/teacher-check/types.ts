import type { TaskRecord } from '../task-core/types';

export interface TeacherCheckFilters {
  readonly type?: 'classroom' | 'checkin';
  readonly classId?: string;
  readonly status?: TaskRecord['status'];
  readonly startsOn?: string;
  readonly endsOn?: string;
  readonly keyword?: string;
}

export interface TeacherCheckItem {
  readonly id: string;
  readonly kind: 'classroom' | 'checkin';
  readonly title: string;
  readonly status: TaskRecord['status'];
  readonly startsOn: string;
  readonly dueOn: string;
  readonly classIds: readonly string[];
  readonly completedCount: number | null;
  readonly totalCount: number;
  readonly pendingReviewCount: number;
  readonly restDayCount: number;
  readonly version: number;
  readonly canDeleteDraft: boolean;
}

export interface TeacherCheckPage {
  readonly classes: readonly Readonly<{ id: string; name: string }> [];
  readonly items: readonly TeacherCheckItem[];
  readonly total: number;
  readonly nextOffset: number | null;
}
