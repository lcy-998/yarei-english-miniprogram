export interface StatsFilters {
  readonly startsOn: string;
  readonly endsOn: string;
  readonly classId?: string;
  readonly studentId?: string;
}

export interface StatsTaskDetail {
  readonly taskId: string;
  readonly taskTitle: string;
  readonly studentId: string;
  readonly studentName: string;
  readonly classId: string;
  readonly className: string;
  readonly dueOn: string;
  readonly status: string;
  readonly submittedAt: string | null;
  readonly isLate: boolean;
  readonly submissionCount: number;
  readonly score: number | null;
}

export interface StatsSummary {
  readonly assignedCount: number;
  readonly completedCount: number;
  readonly completionRate: number | null;
  readonly overdueCount: number;
  readonly taskSubmissionCount: number;
  readonly averageScore: number | null;
  readonly learningMinutes: null;
  readonly practiceAccuracy: null;
  readonly dubbingCount: number | null;
  readonly shadowingCount: null;
}

export interface StatsView {
  readonly filters: StatsFilters;
  readonly periodBasis: 'taskDueDate';
  readonly classes: readonly Readonly<{ id: string; name: string }>[];
  readonly students: readonly Readonly<{ id: string; name: string; classId: string }>[];
  readonly summary: StatsSummary;
  readonly details: readonly StatsTaskDetail[];
  readonly canExport: boolean;
}

export interface StatsExport {
  readonly fileName: string;
  readonly csv: string;
}
