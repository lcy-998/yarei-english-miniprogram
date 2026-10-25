export interface StatsFilters {
  startsOn: string
  endsOn: string
  classId?: string
  studentId?: string
}

export interface StatsTaskDetail {
  taskId: string
  taskTitle: string
  studentId: string
  studentName: string
  classId: string
  className: string
  dueOn: string
  status: string
  submittedAt: string | null
  isLate: boolean
  submissionCount: number
  score: number | null
}

export interface StatsLearningEvent {
  kind: 'phonics' | 'checkin'
  sourceId: string
  sourceTitle: string
  studentId: string
  studentName: string
  classId: string
  className: string
  occurredOn: string
  occurredAt: string | null
  firstCorrect?: boolean
  supplemented?: boolean
}

export interface StatsView {
  filters: StatsFilters
  periodBasis: 'taskDueDate'
  learningPeriodBasis: 'eventSchoolDate'
  classes: Array<{ id: string; name: string }>
  students: Array<{ id: string; name: string; classId: string }>
  summary: {
    assignedCount: number
    completedCount: number
    completionRate: number | null
    overdueCount: number
    taskSubmissionCount: number
    averageScore: number | null
    learningMinutes: null
    phonicsPracticeCount: number | null
    practiceAccuracy: number | null
    checkinCompletedDays: number | null
    checkinEvidenceStatus: 'available' | 'partial' | 'unavailable'
    dubbingCount: number | null
    shadowingCount: null
  }
  details: StatsTaskDetail[]
  learningEvents: StatsLearningEvent[]
  canExport: boolean
}

export interface StatsExport { fileName: string; csv: string }
