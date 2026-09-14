export type Role = 'student' | 'teacher' | 'parent'
export type TaskStatus = 'draft' | 'scheduled' | 'active' | 'expired' | 'completed'
export type AssignmentStatus = 'not_started' | 'in_progress' | 'awaiting_review' | 'completed' | 'redo_required' | 'overdue'
export type SubmissionStatus = 'draft' | 'submitted' | 'reviewed' | 'returned'
export type ReviewDecision = 'approved' | 'returned'

export interface UserAccount {
  id: string
  displayName: string
  role: Role
  classId?: string
}

export interface TaskItem {
  id: string
  type: 'reading' | 'vocabulary' | 'exercise'
  title: string
  completionRule: string
}

export interface Task {
  id: string
  title: string
  deliveryType: 'classroom'
  status: TaskStatus
  creatorTeacherId: string
  classId: string
  startsAt: string
  dueAt: string
  description: string
  items: TaskItem[]
  version: number
}

export interface TaskAssignment {
  id: string
  taskId: string
  studentId: string
  classId: string
  status: AssignmentStatus
  progressPercent: number
  latestSubmissionId?: string
  redoCount: number
  submittedAt?: string
  reviewedAt?: string
}

export interface SubmissionAnswer {
  taskItemId: string
  value: string
}

export interface Submission {
  id: string
  assignmentId: string
  studentId: string
  version: number
  status: SubmissionStatus
  answers: SubmissionAnswer[]
  submittedAt?: string
}

export interface ReviewFeedback {
  id: string
  assignmentId: string
  submissionId: string
  teacherId: string
  decision: ReviewDecision
  score?: number
  textComment?: string
  returnReason?: string
  publishedAt: string
}

export interface AppState {
  users: UserAccount[]
  tasks: Task[]
  assignments: TaskAssignment[]
  submissions: Submission[]
  feedback: ReviewFeedback[]
}

export interface ServiceError {
  code: 'VALIDATION_ERROR' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'NETWORK_ERROR'
  message: string
  retryable: boolean
}

export type ServiceResult<T> = { ok: true; data: T } | { ok: false; error: ServiceError }

export interface Session {
  sessionId: string
  user: UserAccount
}

export interface HomeView {
  user: UserAccount
  task: Task | null
  assignment: TaskAssignment | null
  completedCount: number
  totalCount: number
}

export interface TaskDetailView {
  task: Task
  assignment: TaskAssignment
  submission?: Submission
  feedback?: ReviewFeedback
}
