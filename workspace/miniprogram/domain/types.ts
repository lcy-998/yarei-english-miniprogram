export type Role = 'student' | 'teacher' | 'parent'
export type NotificationFilter = 'all' | 'task' | 'feedback' | 'checkin'
export interface InboxNotice {
  id: string
  kind: 'task_published' | 'activity_published' | 'task_due' | 'task_returned' | 'task_reviewed' | 'checkin_reminder'
  title: string
  summary: string
  occurredAt: string
  target: { kind: 'student_task' | 'parent_task' | 'teacher_task' | 'student_activity'; id: string; childId?: string }
  readAt: string | null
}
export interface InboxPage { items: InboxNotice[]; unreadCount: number; total: number; hasMore: boolean }
export type TaskStatus = 'draft' | 'scheduled' | 'active' | 'expired' | 'withdrawn' | 'closed' | 'completed'
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

export interface StudentClassView {
  id: string
  name: string
  organizationName: string
  grade: string
  term: string
  studentCount: number
  teacherNames: string[]
}

export type SchoolQuestionType = 'single_choice' | 'multiple_choice' | 'fill' | 'subjective'

export interface SchoolQuestionFilters {
  grade?: string
  textbook?: string
  unit?: string
  knowledgePoint?: string
  questionType?: SchoolQuestionType
  difficulty?: string
  keyword?: string
  targetClassIds?: string[]
}

export interface SchoolQuestionSummary {
  id: string
  title: string
  grade: string
  textbook?: string
  unit?: string
  knowledgePoint?: string
  questionType: SchoolQuestionType
  difficulty?: string
  stemSummary: string
  contentVersion: string
}

export interface SchoolQuestionDetail extends SchoolQuestionSummary {
  stem: string
  options: string[]
  correctAnswer: unknown
  explanation: string
}

export interface SchoolQuestionPage {
  items: SchoolQuestionSummary[]
  nextOffset: number | null
}

export interface SchoolQuestionFacet {
  grade: string
  textbook?: string
  unit?: string
  knowledgePoint?: string
  questionType: SchoolQuestionType
  difficulty?: string
}

export interface TaskCatalogFilters {
  type: 'reading' | 'vocabulary'
  category?: 'original' | 'synchronized' | 'picture_book' | 'current_events' | 'chapter_book'
  source?: TaskCatalogListItem['source']
  grade?: string
  term?: string
  textbook?: string
  unit?: string
  difficulty?: string
  keyword?: string
  targetClassIds?: string[]
}

export interface TaskCatalogListItem {
  id: string
  type: TaskCatalogFilters['type']
  title: string
  source: 'reading_book' | 'synchronized_textbook' | 'word_pack'
  category?: TaskCatalogFilters['category']
  grade: string
  term?: string
  textbook?: string
  unit?: string
  difficulty?: string
  contentVersion: string
  requiredCount: number
}

export interface TaskCatalogFacet {
  source: TaskCatalogListItem['source']
  grade: string
  term?: string
  textbook?: string
  unit?: string
  difficulty?: string
}

export interface StudentCatalogFilters {
  type: 'reading' | 'vocabulary'
  category?: 'original' | 'synchronized' | 'picture_book' | 'current_events' | 'chapter_book'
  grade?: string
  textbook?: string
  unit?: string
  difficulty?: string
  theme?: string
  keyword?: string
}
export interface StudentCatalogItem {
  id: string
  type: StudentCatalogFilters['type']
  title: string
  category?: StudentCatalogFilters['category']
  grade: string
  textbook?: string
  unit?: string
  difficulty?: string
  theme?: string
  contentVersion: string
  itemCount: number
}
export interface StudentCatalogPage { items: StudentCatalogItem[]; total: number; nextOffset: number | null }
export interface StudentCatalogFacet {
  category?: StudentCatalogFilters['category']
  grade: string
  textbook?: string
  unit?: string
  difficulty?: string
  theme?: string
}

export interface TextbookChapter { id: string; title: string; lessons: Array<{ id: string; title: string }> }
export interface TextbookSummary { id: string; title: string; grade: string; term: string; edition: string;
  contentVersion: string; chapters: TextbookChapter[] }
export interface ClassTextbookItem { textbookId: string; chapterIds: string[]; lessonIds: string[]; contentVersion: string }
export interface ClassTextbookConfig { id: string; organizationId: string; classId: string; status: 'draft' | 'published';
  textbooks: ClassTextbookItem[]; note: string; publishedTextbooks: ClassTextbookItem[]; publishedNote: string;
  version: number; createdAt: string; updatedAt: string; publishedAt: string | null }
export interface TeacherTextbookClass { id: string; name: string; grade: string; term: string; studentCount: number;
  config: ClassTextbookConfig | null }
export interface TextbookFilters { grade?: string; term?: string; edition?: string; unit?: string; lesson?: string; keyword?: string }
export interface TextbookPage { items: TextbookSummary[]; nextOffset: number | null }
export interface TextbookCenterLayout { classTextbooksEnabled: boolean; synchronizedTextbooksEnabled: boolean;
  visibleClassIds: string[]; dashboardFields: Array<'grade' | 'studentCount' | 'configuredBookCount' | 'progress' | 'updatedAt'> }

export type ActivityDailyCondition =
  | { kind: 'reading'; resourceId: string }
  | { kind: 'vocabulary'; resourceId: string; requiredWordCount: number }
  | { kind: 'exercise'; resourceId: string; minimumScore: number }
  | { kind: 'work'; resourceId: string }

export interface ActivityDraftInput {
  activityId?: string
  title: string
  description?: string
  classId: string
  startsOn: string
  endsOn: string
  restDates: string[]
  conditions: ActivityDailyCondition[]
}

export interface ActivityView {
  id: string
  organizationId: string
  creatorTeacherId: string
  title: string
  description: string
  schedule: { classId: string; startsOn: string; endsOn: string; restDates: string[];
    conditions: ActivityDailyCondition[]; schoolTimeZone: string }
  status: 'draft' | 'published' | 'closed'
  participants: Array<{ studentId: string; displayNameMasked: string }>
  conditionSnapshots: Array<{ kind: ActivityDailyCondition['kind']; resourceId: string; contentVersion: string;
    pageIds?: string[]; wordIds?: string[]; questionIds?: string[] }>
  restDayChanges?: Array<{ id: string; date: string; reason: string; teacherId: string;
    changedAt: string; activityVersion: number }>
  version: number
  createdAt: string
  updatedAt: string
  publishedAt: string | null
  closedAt: string | null
}

export interface ActivityDayView {
  activityId: string
  date: string
  restDay: boolean
  complete: boolean | null
  evidenceStatus: 'available' | 'not_available'
  verifiedConditions: number
  totalConditions: number
  completedAt: string | null
  supplemented: boolean
  conditionProgress?: Array<{ index: number; kind: ActivityDailyCondition['kind']; resourceId: string;
    complete: boolean; completedAt: string | null }>
}

export interface ActivityOverrideView {
  id: string
  organizationId: string
  activityId: string
  studentId: string
  classId: string
  date: string
  active: boolean
  reason: string
  teacherId: string
  changedAt: string
  version: number
}

export interface ActivityOverrideState {
  activityId: string
  studentId: string
  date: string
  version: number
  active: boolean
  reason: string | null
  changedAt: string | null
}

export interface ActivityLeaderboardView {
  activityId: string
  title: string
  startsOn: string
  endsOn: string
  schoolToday: string
  restDayCount: number
  updatedAt: string
  evidenceStatus: 'available' | 'not_available'
  leaderboard: { classId: string; effectiveDayCount: number; finalized: boolean;
    ranks: Array<{ studentId: string; displayNameMasked: string; completedDays: number; rank: number }> } | null
  myRank: { studentId: string; displayNameMasked: string; completedDays: number; rank: number } | null
}

export interface TaskCatalogPage {
  items: TaskCatalogListItem[]
  nextOffset: number | null
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
  resourceId?: string
  type: 'reading' | 'vocabulary' | 'exercise' | 'recording'
  title: string
  completionRule: string
  completionRuleData?: TaskCompletionRule
  readingPageNumbers?: number[]
  recordingPrompt?: string
  snapshotSchemaVersion?: 1 | 2
  vocabularyWordIds?: string[]
  vocabularyPack?: VocabularyPack
  exerciseQuestion?: { questionId: string; questionType: SchoolQuestionType; stem: string; options: string[] }
}

export type TaskCompletionRule =
  | { kind: 'reading_pages'; requiredPageCount: number; pageIds?: string[] }
  | { kind: 'vocabulary_words'; requiredWordCount: number }
  | { kind: 'exercise_questions'; requiredQuestionCount: number }
  | { kind: 'recording_upload' }

export type TaskCompletionValue =
  | { kind: 'reading'; completedPageCount: number }
  | { kind: 'vocabulary'; completedWordCount: number; correctWordCount: number }
  | { kind: 'exercise'; answeredQuestionCount: number; correctQuestionCount?: number; questionResponses?: Array<{
      questionId: string; response: string | string[]; isCorrect?: boolean
    }> }
  | { kind: 'recording'; recordingId: string; durationMs?: number; sizeBytes?: number }

export interface Task {
  id: string
  title: string
  deliveryType: 'classroom'
  status: TaskStatus
  creatorTeacherId: string
  classId: string
  classIds?: string[]
  startsAt: string
  dueAt: string
  latePolicy?: { allowLate: boolean; lateDays: number }
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
  automaticScore?: number | null
}

export interface ReviewFeedback {
  id: string
  assignmentId: string
  submissionId: string
  teacherId: string
  decision: ReviewDecision
  score?: number
  itemScores?: Array<{ itemId: string; score: number }>
  textComment?: string
  returnReason?: string
  publishedAt: string
  originalAutomaticScore?: number | null
  overrideReason?: string | null
}

export interface MemoryExerciseSnapshot {
  taskId: string
  itemId: string
  question: SchoolQuestionDetail
}

export type WriteOperationKind = 'publish_task' | 'save_teacher_draft' | 'save_submission_draft' | 'submit_task' | 'publish_review'

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
  exerciseSnapshots?: MemoryExerciseSnapshot[]
}

export interface ServiceError {
  code: 'VALIDATION_ERROR' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'RESOURCE_OFFLINE' | 'MEDIA_INVALID' | 'TASK_NOT_SUBMITTABLE' | 'REDO_LIMIT_REACHED' | 'DUPLICATE_OPERATION' | 'NETWORK_ERROR' | 'SERVICE_UNAVAILABLE' | 'INTERNAL_ERROR'
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
  textbook?: string
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

export interface VocabularyAttemptView {
  id: string
  packId: string
  taskId: string | null
  itemId: string | null
  round: number
  contentVersion: string
  wordId: string
  studentInput: string
  isCorrect: boolean
  firstAttempt: boolean
  attemptNumber: number
  attemptedAt: string
}

export interface VocabularyAttemptState {
  wordId: string
  firstCorrect: boolean | null
  version: number
  attempts: VocabularyAttemptView[]
}

export interface VocabularyWordAttemptSummary {
  wordId: string
  firstCorrect: boolean | null
  lastCorrect: boolean | null
  version: number
}

export interface VocabularyPackAttemptSummary {
  packId: string
  contentVersion: string
  round: number
  words: VocabularyWordAttemptSummary[]
}

export interface VocabularyPackScope {
  packId: string
  taskId?: string
  itemId?: string
}

export interface VocabularyAnswerScope extends VocabularyPackScope {
  wordId: string
  taskId?: string
  itemId?: string
}

export interface VocabularyAnswerInput extends VocabularyAnswerScope {
  studentInput: string
}

export interface WorkMaterial {
  id: string
  title: string
  contentVersion: string
  subtitle: string
  grade?: string
  textbook?: string
  unit?: string
}
export interface WorkMaterialFilters { grade?: string; textbook?: string; unit?: string }
export interface WorkMaterialFacet extends WorkMaterialFilters {}
export interface WorkMaterialPage { items: WorkMaterial[]; total: number; nextOffset: number | null }

export interface StudentWork {
  id: string
  materialId: string
  materialVersion: string
  stagingPath: string
  status: 'draft' | 'submitted'
  fileId: string | null
  sizeBytes: number | null
  durationMs: number | null
  note: string
  version: number
  createdAt: string
  submittedAt: string | null
  deletedAt?: string | null
  recoverableUntil?: string | null
  deletedByUserId?: string | null
  mediaDeletedAt?: string | null
  mediaExpired?: boolean
}

export interface WorkPlayback {
  workId: string
  temporaryUrl: string
  expiresAt: string
}

export interface MaterialPlayback {
  materialId: string
  temporaryUrl: string
  expiresAt: string
}

export interface PhonicsCourseListItem {
  id: string
  title: string
  grade: string
  unit: string
  contentVersion: string
  phonemeCount: number
  questionCount: number
}

export interface PhonicsCourseView {
  id: string
  title: string
  grade: string
  unit: string
  contentVersion: string
  phonemes: Array<{ id: string; label: string; examples: string[]; exampleLabel?: string; audioAvailable: boolean }>
  questions: Array<{ id: string; stem: string; options: Array<{ id: string; text: string }> }>
}

export interface PhonicsCourseState {
  courseId: string
  contentVersion: string
  currentRound: number
  completedCount: number
  firstCorrectCount: number
  score: number | null
  history: Array<{ round: number; score: number; completedAt: string }>
  wrongQuestionIds: string[]
  questions: Array<{ questionId: string; firstCorrect: boolean | null; lastCorrect: boolean | null; version: number }>
}

export interface PhonicsAnswerView {
  round: number
  questionId: string
  selectedOptionId: string
  correctOptionId: string
  explanation: string
  isCorrect: boolean
  firstAttempt: boolean
  attemptNumber: number
  attemptedAt: string
}

export interface PhonicsAudioView { courseId: string; phonemeId: string; temporaryUrl: string; expiresAt: string }

export interface TaskTemplateView {
  id: string
  organizationId: string
  ownerTeacherId: string | null
  scope: 'system' | 'personal'
  title: string
  description: string
  itemRefs: Array<{ id: string; resourceId: string; completionRule: Record<string, unknown>;
    scoringRule: Record<string, unknown>; order: number }>
  items: Array<{ id: string; resourceId: string; resourceVersion: number;
    resourceSnapshot: { title: string; type: 'reading' | 'vocabulary' | 'exercise' | 'recording'; payload: Record<string, unknown> };
    completionRule: Record<string, unknown>; scoringRule: Record<string, unknown>; order: number }>
  status: 'active' | 'deleted'
  useCount: number
  version: number
  createdAt: string
  updatedAt: string
}

export interface TaskTemplateInput {
  templateId?: string
  title: string
  description: string
  itemRefs: TaskTemplateView['itemRefs']
}

export type TeacherStudentStatusFilter = 'all' | 'active' | 'normal' | 'attention' | 'disabled'
export interface TeacherStudentClassOption { id: string; name: string; grade: string; term: string; version?: number }
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
  userVersion?: number; membershipVersion?: number; membershipVersions?: Record<string, number>
}

export interface HomeView {
  user: UserAccount
  task: Task | null
  assignment: TaskAssignment | null
  completedCount: number
  totalCount: number
  todayTasks?: HomeTaskSummary[]
}

export interface HomeTaskSummary {
  taskId: string
  title: string
  status: AssignmentStatus
  startsAt: string
  dueAt: string
  redoDueAt?: string | null
}

export interface TaskDetailView {
  task: Task
  assignment: TaskAssignment
  readingPageProgress?: Array<{ itemId: string; completedPageCount: number }>
  automaticScore?: number | null
  submission?: Submission
  submissionHistory?: Array<{ version: number; status: SubmissionStatus; submittedAt: string;
    answers?: SubmissionAnswer[]; feedback?: ReviewFeedback }>
  feedback?: ReviewFeedback
}
