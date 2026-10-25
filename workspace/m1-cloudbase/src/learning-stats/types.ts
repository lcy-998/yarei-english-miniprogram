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
  readonly phonicsPracticeCount: number | null;
  readonly practiceAccuracy: number | null;
  readonly checkinCompletedDays: number | null;
  readonly checkinEvidenceStatus: 'available' | 'partial' | 'unavailable';
  readonly dubbingCount: number | null;
  readonly shadowingCount: null;
}

export interface StatsLearningEvent {
  readonly kind: 'phonics' | 'checkin';
  readonly sourceId: string;
  readonly sourceTitle: string;
  readonly studentId: string;
  readonly studentName: string;
  readonly classId: string;
  readonly className: string;
  readonly occurredOn: string;
  readonly occurredAt: string | null;
  readonly firstCorrect?: boolean;
  readonly supplemented?: boolean;
}

export interface StatsView {
  readonly filters: StatsFilters;
  readonly periodBasis: 'taskDueDate';
  readonly learningPeriodBasis: 'eventSchoolDate';
  readonly classes: readonly Readonly<{ id: string; name: string }>[];
  readonly students: readonly Readonly<{ id: string; name: string; classId: string }>[];
  readonly summary: StatsSummary;
  readonly details: readonly StatsTaskDetail[];
  readonly learningEvents: readonly StatsLearningEvent[];
  readonly canExport: boolean;
}

export interface StatsExport {
  readonly fileName: string;
  readonly csv: string;
}
