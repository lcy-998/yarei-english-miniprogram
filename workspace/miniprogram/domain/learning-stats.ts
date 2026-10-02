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

export interface StatsView {
  filters: StatsFilters
  periodBasis: 'taskDueDate'
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
    practiceAccuracy: null
    dubbingCount: number | null
    shadowingCount: null
  }
  details: StatsTaskDetail[]
  canExport: boolean
}

export interface StatsExport { fileName: string; csv: string }
