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
  className?: string
}

export interface ParentStudentLink {
  id: string
  parentId: string
  studentId: string
  status: 'active' | 'revoked'
  version?: number
  confirmedAt?: string
}

export interface TaskItem {
  id: string
  type: 'reading' | 'vocabulary' | 'exercise'
  title: string
  completionRule: string
  completionRuleData?: TaskCompletionRule
}

export type TaskCompletionRule =
  | { kind: 'reading_pages'; requiredPageCount: number }
  | { kind: 'vocabulary_words'; requiredWordCount: number }
  | { kind: 'exercise_questions'; requiredQuestionCount: number }

export type TaskCompletionValue =
  | { kind: 'reading'; completedPageCount: number }
  | { kind: 'vocabulary'; completedWordCount: number; correctWordCount: number }
  | { kind: 'exercise'; answeredQuestionCount: number; correctQuestionCount?: number }

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
  redoDueAt?: string
  submittedAt?: string
  reviewedAt?: string
  version?: number
}

export interface SubmissionAnswer {
  taskItemId: string
  value: string
  structuredValue?: TaskCompletionValue
}

export interface Submission {
  id: string
  assignmentId: string
  studentId: string
  version: number
  status: SubmissionStatus
  answers: SubmissionAnswer[]
  submittedAt?: string
  recordVersion?: number
  assignmentVersion?: number
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

export type WriteOperationKind = 'publish_task' | 'save_submission_draft' | 'submit_task' | 'publish_review'

export interface WriteOperationReceipt {
  operationId: string
  kind: WriteOperationKind
  actorUserId: string
  fingerprint: string
  result: Task | Submission | ReviewFeedback
}

export interface AppState {
  users: UserAccount[]
  parentStudentLinks: ParentStudentLink[]
  tasks: Task[]
  assignments: TaskAssignment[]
  submissions: Submission[]
  feedback: ReviewFeedback[]
  operationReceipts: WriteOperationReceipt[]
  bindingCodes: Array<{ id: string; studentId: string; code: string; status: 'active' | 'locked' | 'used'; attemptCount: number; expiresAt: string }>
  relationshipOperationReceipts: Array<{ operationId: string; fingerprint: string; result: ParentChildLinkView | null }>
  readingProgress: ReadingProgress[]
  vocabularyProgress: VocabularyProgress[]
  learningOperationReceipts: Array<{ operationId: string; fingerprint: string; result: ReadingProgress | VocabularyProgress }>
}

export interface ServiceError {
  code: 'VALIDATION_ERROR' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'RESOURCE_OFFLINE' | 'TASK_NOT_SUBMITTABLE' | 'REDO_LIMIT_REACHED' | 'DUPLICATE_OPERATION' | 'NETWORK_ERROR' | 'SERVICE_UNAVAILABLE' | 'INTERNAL_ERROR'
  message: string
  retryable: boolean
  fieldErrors?: Record<string, string>
}

export interface ServiceResponseMeta { requestId: string; serverTime: string; apiVersion: 'm1.v1' }

export type ServiceResult<T> = { ok: true; data: T; meta?: ServiceResponseMeta } | { ok: false; error: ServiceError; meta?: ServiceResponseMeta }

export interface Session {
  sessionId: string
  user: UserAccount
  availableRoles?: Role[]
  activeRole?: Role | null
}

export interface ParentChildLinkView {
  linkId: string
  linkVersion: number
  childId: string
  displayName: string
  displayNameMasked: string
  studentNumber?: string | null
  classId?: string | null
  className?: string | null
  confirmedAt: string | null
}

export interface ReadingListItem {
  id: string
  title: string
  category: 'original' | 'textbook' | 'picture' | 'picture_book' | 'current' | 'chapter'
  grade: string
  difficulty: string
  contentVersion: string
}

export interface ReadingPage {
  id: string
  pageNumber: number
  order: number
  thumbnailAssetKey: string
  imageAssetKey: string
  width: number
  height: number
  assetVersion: string
}

export interface ReadingChapter { id: string; title: string; order: number; pages: ReadingPage[] }
export interface ReadingResource extends ReadingListItem {
  presentation: 'page_images_only'
  textVisibility: { ocrExposed: false; standaloneBodyExposed: false }
  chapters: ReadingChapter[]
}

export interface VocabularyWord {
  id: string
  word: string
  syllables: string[]
  syllableDisplay?: string
  meaning: string
  example?: string
}

export interface VocabularyPack {
  id: string
  title: string
  grade: string
  unit: string
  contentVersion: string
  words: VocabularyWord[]
}

export interface ReadingProgress {
  id: string
  resourceId: string
  chapterId: string
  pageId: string
  pageNumber: number
  favorite: boolean
  version: number
  updatedAt: string
}

export interface VocabularyProgress {
  id: string
  packId: string
  completedCount: number
  correctCount: number
  correctRate: number
  wrongWordIds: string[]
  version: number
  updatedAt: string
}

export type TeacherStudentStatusFilter = 'all' | 'normal' | 'attention' | 'disabled'
export interface TeacherStudentClassOption { id: string; name: string; grade: string; term: string }
export interface TeacherStudentPerformanceSummary {
  assignedCount: number; completedCount: number; overdueCount: number; redoCount: number
  completionRate: number; averageScore: number | null
}
export interface TeacherStudentListItem {
  studentId: string; displayName: string; studentNumber: string
  accountStatus: 'active' | 'disabled'; needsAttention: boolean
  classInfo: TeacherStudentClassOption; performance: TeacherStudentPerformanceSummary
}
export interface TeacherStudentPage {
  classes: TeacherStudentClassOption[]; items: TeacherStudentListItem[]; total: number; nextCursor: string | null
}
export interface TeacherStudentParentSummary { linkId: string; displayNameMasked: string; mobileMasked: string | null; confirmedAt: string }
export interface TeacherStudentTaskItem { taskId: string; title: string; status: AssignmentStatus; submittedAt: string | null; score: number | null }
export interface TeacherStudentDetail {
  studentId: string; displayName: string; studentNumber: string
  accountStatus: 'active' | 'disabled'; needsAttention: boolean
  classInfo: TeacherStudentClassOption; parents: TeacherStudentParentSummary[]
  performance: TeacherStudentPerformanceSummary; recentTasks: TeacherStudentTaskItem[]
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
