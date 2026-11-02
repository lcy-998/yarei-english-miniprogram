import type { TeacherTaskMediaReviewEvidenceView } from '../domain/teacher-media'
import type { TeacherPrivateVideo, TeacherPrivateVideoDetail,
  TeacherVideoQuestion } from '../domain/teacher-private-video'
import type { HistoricalTaskLearningView } from '../domain/types'
import {
  HomeView,
  InboxNotice,
  InboxPage,
  NotificationFilter,
  ParentChildLinkView,
  ParentRecordingPlaybackView,
  ParentFeedbackVoicePlaybackView,
  ParentTaskMediaPlaybackView,
  ReviewFeedback,
  ReadingListItem,
  ReadingProgress,
  ReadingResource,
  ReadingPronunciationSegmentsView,
  ReadingAudioMapView,
  Role,
  ServiceResult,
  Session,
  SchoolQuestionDetail,
  SchoolQuestionFilters,
  SchoolQuestionFacet,
  SchoolQuestionPage,
  SchoolQuestionType,
  TaskCatalogFilters,
  TaskCatalogListItem,
  TaskCatalogPage,
  TaskCatalogFacet,
  StudentCatalogFilters,
  StudentCatalogPage,
  StudentCatalogFacet,
  ActivityDraftInput,
  ActivityView,
  TeacherActivityProgressView,
  ActivityDayView,
  ActivityOverrideView,
  ActivityOverrideState,
  ActivityLeaderboardView,
  Submission,
  StudentClassView,
  Task,
  TaskAssignment,
  TaskCompletionRule,
  TaskCompletionValue,
  TaskDetailView,
  TaskItem,
  M3TaskMediaSnapshotView,
  M3TaskMediaPlaybackView,
  SubmittedTaskMediaPlaybackView,
  M3TaskMediaHeartbeatView,
  ReviewVoiceDraftView,
  TaskDubbingWorkView,
  MyTaskDubbingWorkPage,
  MyTaskDubbingPlaybackView,
  TeacherStudentDetail,
  TeacherStudentListItem,
  TeacherStudentPage,
  TeacherStudentStatusFilter,
  UserAccount,
  VocabularyPack,
  VocabularyProgress,
  VocabularyAttemptState,
  VocabularyPackAttemptSummary,
  VocabularyPackScope,
  VocabularyAttemptView,
  VocabularyAnswerInput,
  VocabularyAnswerScope,
  WorkMaterial,
  WorkMaterialFacet,
  WorkMaterialFilters,
  WorkMaterialPage,
  StudentWork,
  WorkPlayback,
  MaterialPlayback,
  PhonicsAnswerView,
  PhonicsAudioView,
  PhonicsCourseListItem,
  PhonicsCourseState,
  PhonicsCourseView,
  TaskTemplateInput,
  TaskTemplateView,
  TeacherTextbookClass,
  TextbookSummary,
  TextbookFilters,
  TextbookFacetValues,
  TextbookPage,
  ClassTextbookConfig,
  ClassTextbookItem,
  TextbookCenterLayout,
} from '../domain/types'
import type { TeacherAssetFacet, TeacherAssetFilters, TeacherAssetPage, TeacherAssetPreview } from '../domain/teacher-media'
import {
  CloudAuthenticationPort,
  CloudClientContextProvider,
  CloudRepositoryClient,
} from '../repositories/cloudbase/protocol'
import type { StatsExport, StatsFilters, StatsView } from '../domain/learning-stats'
import type { TeacherCheckFilters, TeacherCheckPage } from '../domain/teacher-check'
import type { ArchiveNativeAdminClassInput, AssignNativeAdminTeacherInput, CreateNativeAdminClassInput,
  NativeAdminAccessView, NativeAdminClassArchiveView, NativeAdminClassMutationView, NativeAdminClassPageView,
  NativeAdminSelectionKind, NativeAdminSelectionPageView,
  NativeAdminGrantInput, NativeAdminGrantPageView, NativeAdminGrantView,
  NativeAdminGrantCandidatePageView,
  NativeAdminDeletedWorkPageView, NativeAdminRestoredWorkView,
  NativeAdminOverviewView, NativeAdminRecordFilter, NativeAdminRecordKind, NativeAdminRecordPageView,
  NativeAdminOverviewRange,
  NativeAdminAuditPageView, NativeAdminQuestionPreviewView,
  NativeAdminUserBindingsView, UnbindNativeAdminUserInput, NativeAdminUnbindView,
  NativeAdminRecordsExportView,
  NativeAdminTeacherAssignmentView, NativeAdminUserMutationView, NativeAdminUserPageView,
  NativeAdminOrganizationView, UpdateNativeAdminOrganizationInput,
  BindNativeAdminParentLinkInput, NativeAdminBoundParentLinkView, NativeAdminUserRoleFilter,
  NativeAdminUserStatusFilter,
  CreateNativeAdminUserInput, NativeAdminCreatedUserView,
  NativeTextbookConfigView, NativeQuestionStatusView, NativeManagedStopView,
  NativeAdminMediaReviewSummaryView, NativeAdminMediaReviewInput, NativeAdminMediaActionView,
  NativeAdminMediaPreviewView, NativeAdminMediaAuditPageView,
  SaveNativeTextbookConfigInput, SetNativeTextbookConfigStatusInput,
  SetNativeQuestionVisibilityInput, NativeQuestionVisibilityView,
  SetNativeQuestionBatchStatusInput, NativeQuestionBatchStatusView,
  SetNativeQuestionStatusInput, StopNativeManagedInput,
  RevokeNativeAdminTeacherInput, UpdateNativeAdminClassInput,
  DisableNativeAdminUserInput, UpdateNativeAdminUserInput } from '../domain/native-admin'
import type { ParentHomeView, ParentTaskListFilters, ParentTaskListPage, ParentTaskListView } from './parent-task-types'
import { isLegacyParentTaskCursor, isUnsupportedParentTaskFilter,
  legacyParentTaskPage } from './parent-task-legacy-list'
import type { TeacherStudentBulkImportView } from './teacher-student-import-service'
import type { RecordingPromptFacet, RecordingPromptPage, RecordingPromptView, TaskRecordingMediaState, TaskRecordingPlayback, TaskRecordingView } from '../domain/task-recording'
import type { PronunciationRecordingDraft, PronunciationScoreView, PronunciationSource,
  SealedPronunciationRecording } from './student-pronunciation-service'
import type {
  BindChildCommand,
  PublishClassroomTaskCommand as CloudPublishTaskCommand,
  SaveReadingProgressCommand,
  SaveSubmissionDraftCommand as CloudSubmissionCommand,
  SaveVocabularyProgressCommand,
  StructuredSubmissionAnswer,
  StructuredTaskDraft,
  TaskDraftOptionsView,
  UnbindChildCommand,
} from './app-service'

export interface CloudReviewCommand {
  operationId: string
  expectedVersion: number
  taskId: string
  assignmentId?: string
  decision: 'approved' | 'returned'
  score?: number
  itemScores?: Array<{ itemId: string; score: number }>
  comment: string
  aiSuggestionId?: string
  voiceRecordingId?: string
  overrideReason?: string
}

export interface TeacherSuggestionView {
  id: string; submissionId: string; submissionVersion: number; modelVersion: string;
  promptVersion: string; text: string; generationNumber: number; remainingRegenerations: number;
  status: 'trial'; requiresTeacherConfirmation: true;
}
export type TeacherSuggestionStatusView = TeacherSuggestionView
  | Readonly<{ status: 'processing' }> | Readonly<{ status: 'failed' }>
  | Readonly<{ status: 'insufficient_evidence' }>
  | Readonly<{ status: 'not_started' }>

export interface CloudReviewAssignmentView {
  studentName: string
  classId?: string
  studentNumber?: string
  className?: string
  submittedAt?: string
  assignmentId: string
  taskId: string
  status: string
  submissionId?: string
  submissionVersion?: number
  assignmentVersion?: number
  score?: number
  comment?: string
}

export interface TeacherPronunciationEvidence extends PronunciationScoreView {
  bestScore?: Readonly<{ total: number; pronunciation: number; fluency: number; completeness: number }> | null
  durationMs: number | null
  mediaExpired: boolean
  playback: Readonly<{ temporaryUrl: string; expiresAt: string }> | null
}

export interface MyPronunciationWork {
  scoreId: string
  recordingId: string
  source: PronunciationSource
  displayTitle: string
  referencePreview: string
  status: PronunciationScoreView['status']
  experimental: true
  score: PronunciationScoreView['score'] | null
  qualityReason: string | null
  modelVersion: string | null
  algorithmVersion: string | null
  scoredAt: string | null
  expectedVersion: number
  submissionVersion: number | null
  retryable: boolean
  mediaExpired: boolean | null
  playbackAvailable: boolean
}

export interface MyPronunciationWorkPage {
  items: MyPronunciationWork[]
  nextCursor: string | null
}

export interface MyPronunciationPlayback {
  scoreId: string
  mediaExpired: boolean | null
  playback: Readonly<{ temporaryUrl: string; expiresAt: string }> | null
}

export interface ParentPronunciationEvidence {
  segmentId: string
  status: PronunciationScoreView['status']
  experimental: true
  sourceVersion: string
  submissionVersion: number | null
  modelVersion: string | null
  algorithmVersion: string | null
  scoredAt: string | null
  qualityReason: string | null
  score: null
  durationMs: number | null
  mediaExpired: boolean
  playback: null
  officialScoreAvailable: false
}

export interface ParentPronunciationEvidencePage {
  items: ParentPronunciationEvidence[]
  missingReferenceCount: number
}

export interface CloudAppService {
  listNotifications(userId: string, filter: NotificationFilter, offset: number, limit: number, days: 7 | 30 | 90): Promise<ServiceResult<InboxPage>>
  markNotificationRead(userId: string, noticeId: string, operationId: string): Promise<ServiceResult<InboxNotice>>
  markAllNotificationsRead(userId: string, operationId: string): Promise<ServiceResult<{ readAt: string }>>
  login(mobile: string, password: string): Promise<ServiceResult<Session>>
  requestPasswordResetCode(mobile: string): Promise<ServiceResult<{ expiresInMinutes: number }>>
  verifyPasswordResetCode(mobile: string, code: string): Promise<ServiceResult<{ expiresInSeconds: number }>>
  resetPassword(mobile: string, newPassword: string): Promise<ServiceResult<null>>
  listRoles(userId: string): Promise<ServiceResult<Role[]>>
  selectRole(userId: string, role: Role): Promise<ServiceResult<Session>>
  getUser(userId: string): Promise<ServiceResult<UserAccount>>
  getMyClass(userId: string): Promise<ServiceResult<StudentClassView>>
  listSchoolQuestions(userId: string, filters: SchoolQuestionFilters, limit: number, offset: number): Promise<ServiceResult<SchoolQuestionPage>>
  listSchoolQuestionFacets(userId: string, targetClassIds?: string[]): Promise<ServiceResult<SchoolQuestionFacet[]>>
  getSchoolQuestion(userId: string, resourceId: string, targetClassIds?: string[]): Promise<ServiceResult<SchoolQuestionDetail>>
  listTaskCatalogResources(userId: string, filters: TaskCatalogFilters, limit: number, offset: number): Promise<ServiceResult<TaskCatalogPage>>
  listStudentCatalog(userId: string, filters: StudentCatalogFilters, limit: number, offset: number): Promise<ServiceResult<StudentCatalogPage>>
  listStudentCatalogFacets(userId: string, type: StudentCatalogFilters['type'], category?: StudentCatalogFilters['category']): Promise<ServiceResult<StudentCatalogFacet[]>>
  listTaskCatalogFacets(userId: string, type: TaskCatalogFilters['type'], targetClassIds?: string[],
    category?: TaskCatalogFilters['category']): Promise<ServiceResult<TaskCatalogFacet[]>>
  getTaskCatalogResource(userId: string, resourceId: string, targetClassIds?: string[]): Promise<ServiceResult<TaskCatalogListItem>>
  listTeacherAssets(userId: string, filters: TeacherAssetFilters, limit: number,
    offset: number): Promise<ServiceResult<TeacherAssetPage>>
  listTeacherAssetFacets(userId: string, kind: TeacherAssetFilters['kind'],
    targetClassIds?: string[]): Promise<ServiceResult<TeacherAssetFacet[]>>
  previewTeacherAsset(userId: string, resourceId: string,
    targetClassIds?: string[]): Promise<ServiceResult<TeacherAssetPreview>>
  listMyVideos(userId: string): Promise<ServiceResult<TeacherPrivateVideo[]>>
  getMyVideoAvailability(userId: string): Promise<ServiceResult<{ enabled: boolean }>>
  getMyVideo(userId: string, id: string): Promise<ServiceResult<TeacherPrivateVideoDetail>>
  saveMyVideo(userId: string, title: string, questions: TeacherVideoQuestion[],
    id: string | undefined, expectedVersion: number | undefined,
    operationId: string): Promise<ServiceResult<TeacherPrivateVideo>>
  beginMyVideoUpload(userId: string, id: string, expectedVersion: number): Promise<ServiceResult<TeacherPrivateVideo>>
  sealMyVideo(userId: string, id: string, expectedVersion: number,
    stagingFileId: string): Promise<ServiceResult<TeacherPrivateVideo>>
  retryMyVideoProcessing(userId: string, id: string,
    expectedVersion: number): Promise<ServiceResult<TeacherPrivateVideo>>
  publishMyVideo(userId: string, id: string, expectedVersion: number): Promise<ServiceResult<TeacherPrivateVideo>>
  withdrawMyVideo(userId: string, id: string, expectedVersion: number): Promise<ServiceResult<TeacherPrivateVideo>>
  listRecordingPrompts(userId: string, targetClassIds: string[] | undefined, keyword: string,
    limit: number, offset: number, filters?: { grade?: string; unit?: string }): Promise<ServiceResult<RecordingPromptPage>>
  listRecordingPromptFacets(userId: string, targetClassIds?: string[]): Promise<ServiceResult<RecordingPromptFacet[]>>
  getRecordingPrompt(userId: string, promptId: string, targetClassIds?: string[]): Promise<ServiceResult<RecordingPromptView>>
  beginTaskRecording(userId: string, taskId: string, itemId: string, operationId: string): Promise<ServiceResult<TaskRecordingView>>
  submitTaskRecording(userId: string, recordingId: string, stagingFileId: string, expectedVersion: number,
    operationId: string): Promise<ServiceResult<TaskRecordingView>>
  listTaskRecordings(userId: string, taskId: string, itemId: string): Promise<ServiceResult<TaskRecordingView[]>>
  getTaskRecordingPlayback(userId: string, recordingId: string): Promise<ServiceResult<TaskRecordingPlayback>>
  getTaskRecordingMediaState(userId: string, recordingId: string): Promise<ServiceResult<TaskRecordingMediaState>>
  beginPronunciationRecording(userId: string, source: PronunciationSource,
    operationId: string): Promise<ServiceResult<PronunciationRecordingDraft>>
  sealPronunciationRecording(userId: string, recordingId: string, stagingFileId: string,
    expectedVersion: 1, operationId: string): Promise<ServiceResult<SealedPronunciationRecording>>
  beginPronunciationScore(userId: string, recordingId: string,
    expectedVersion: number, operationId: string): Promise<ServiceResult<PronunciationScoreView>>
  getPronunciationScore(userId: string, scoreId: string): Promise<ServiceResult<PronunciationScoreView>>
  listPronunciationAttempts(userId: string, source: PronunciationSource): Promise<ServiceResult<PronunciationScoreView[]>>
  listMyPronunciationWorks(userId: string, cursor: string | null, limit: number): Promise<ServiceResult<MyPronunciationWorkPage>>
  getMyPronunciationPlayback(userId: string, recordingId: string): Promise<ServiceResult<MyPronunciationPlayback>>
  getTeacherPronunciationEvidence(userId: string, input: Readonly<{ taskId: string; assignmentId: string;
    submissionVersion: number; itemId: string; segmentId: string }>): Promise<ServiceResult<TeacherPronunciationEvidence>>
  getParentPronunciationEvidence(userId: string, input: Readonly<{ studentId: string; taskId: string;
    assignmentId: string; submissionVersion: number; itemId: string;
    segmentId: string }>): Promise<ServiceResult<ParentPronunciationEvidence>>
  listParentPronunciationEvidence(userId: string, input: Readonly<{ studentId: string; taskId: string;
    assignmentId: string; submissionVersion: number; itemId: string }>): Promise<ServiceResult<ParentPronunciationEvidencePage>>
  getTeacherTextbookCenterSettings(userId: string): Promise<ServiceResult<TextbookCenterLayout>>
  listTeacherTextbookClasses(userId: string): Promise<ServiceResult<TeacherTextbookClass[]>>
  getTeacherTextbookClass(userId: string, classId: string): Promise<ServiceResult<TeacherTextbookClass>>
  listSynchronizedTextbooks(userId: string, filters: TextbookFilters, limit: number, offset: number, targetClassId?: string): Promise<ServiceResult<TextbookPage>>
  listSynchronizedTextbookFacets(userId: string, filters: TextbookFilters, targetClassId?: string): Promise<ServiceResult<TextbookFacetValues>>
  getSynchronizedTextbook(userId: string, textbookId: string, targetClassId?: string): Promise<ServiceResult<TextbookSummary>>
  saveClassTextbooks(userId: string, classId: string, textbooks: ClassTextbookItem[], note: string,
    expectedVersion: number, operationId: string, publish: boolean): Promise<ServiceResult<ClassTextbookConfig>>
  saveActivityDraft(userId: string, draft: ActivityDraftInput, expectedVersion: number, operationId: string): Promise<ServiceResult<ActivityView>>
  publishActivity(userId: string, activityId: string, expectedVersion: number, operationId: string): Promise<ServiceResult<ActivityView>>
  closeActivity(userId: string, activityId: string, expectedVersion: number, reason: string,
    operationId: string): Promise<ServiceResult<ActivityView>>
  deleteActivityDraft(userId: string, activityId: string, expectedVersion: number, reason: string,
    operationId: string): Promise<ServiceResult<ActivityView>>
  recycleActivity(userId: string, activityId: string, expectedVersion: number, reason: string,
    operationId: string): Promise<ServiceResult<ActivityView>>
  addActivityFutureRestDay(userId: string, activityId: string, date: string, reason: string,
    expectedVersion: number, operationId: string): Promise<ServiceResult<ActivityView>>
  listTeacherActivities(userId: string): Promise<ServiceResult<ActivityView[]>>
  getTeacherActivityProgress(userId: string, activityId: string, date: string, limit: number, offset: number,
    keyword?: string, completion?: 'all' | 'complete' | 'incomplete'): Promise<ServiceResult<TeacherActivityProgressView>>
  listStudentActivities(userId: string): Promise<ServiceResult<ActivityView[]>>
  getStudentActivity(userId: string, activityId: string): Promise<ServiceResult<ActivityView>>
  getMyActivityDay(userId: string, activityId: string, date: string): Promise<ServiceResult<ActivityDayView>>
  setActivityOverride(userId: string, input: { activityId: string; studentId: string; date: string;
    active: boolean; reason: string }, expectedVersion: number, operationId: string): Promise<ServiceResult<ActivityOverrideView>>
  getActivityOverrideForTeacher(userId: string, activityId: string, studentId: string, date: string): Promise<ServiceResult<ActivityOverrideState>>
  getActivityLeaderboard(userId: string, activityId: string): Promise<ServiceResult<ActivityLeaderboardView>>
  updateProfile(userId: string, displayName: string): Promise<ServiceResult<UserAccount>>
  getHome(userId: string): Promise<ServiceResult<HomeView>>
  getTaskDetail(userId: string, taskId: string): Promise<ServiceResult<TaskDetailView>>
  beginTaskMediaSession(userId: string, taskId: string, itemId: string,
    operationId: string): Promise<ServiceResult<M3TaskMediaPlaybackView>>
  reportTaskMediaHeartbeat(userId: string, sessionId: string, playedFromMs: number,
    playedToMs: number, positionMs: number, operationId: string): Promise<ServiceResult<M3TaskMediaHeartbeatView>>
  getTaskMediaPlayback(userId: string, taskId: string,
    itemId: string): Promise<ServiceResult<M3TaskMediaPlaybackView>>
  getSubmittedTaskMediaPlayback(userId: string, taskId: string, itemId: string,
    submissionVersion: number): Promise<ServiceResult<SubmittedTaskMediaPlaybackView>>
  beginTaskDubbingWork(userId: string, taskId: string, itemId: string,
    operationId: string): Promise<ServiceResult<TaskDubbingWorkView>>
  sealTaskDubbingWork(userId: string, workId: string, stagingFileId: string,
    expectedVersion: number, operationId: string): Promise<ServiceResult<TaskDubbingWorkView>>
  listMyTaskDubbingWorks(userId: string, offset: number,
    limit: number): Promise<ServiceResult<MyTaskDubbingWorkPage>>
  getTaskDubbingPlayback(userId: string, workId: string): Promise<ServiceResult<MyTaskDubbingPlaybackView>>
  listStudentTasks(userId: string): Promise<ServiceResult<TaskDetailView[]>>
  saveDraft(userId: string, command: CloudSubmissionCommand): Promise<ServiceResult<Submission>>
  submitTask(userId: string, command: CloudSubmissionCommand): Promise<ServiceResult<Submission>>
  getTeacherTasks(userId: string): Promise<ServiceResult<TeacherTasksView>>
  getNativeAdminAccess(userId: string): Promise<ServiceResult<NativeAdminAccessView>>
  getNativeAdminOrganization(userId: string): Promise<ServiceResult<NativeAdminOrganizationView>>
  updateNativeAdminOrganization(userId: string, input: UpdateNativeAdminOrganizationInput,
    expectedVersion: number, operationId: string): Promise<ServiceResult<NativeAdminOrganizationView>>
  bindNativeAdminParentLink(userId: string, input: BindNativeAdminParentLinkInput,
    operationId: string): Promise<ServiceResult<NativeAdminBoundParentLinkView>>
  createNativeAdminUser(userId: string, input: CreateNativeAdminUserInput,
    operationId: string): Promise<ServiceResult<NativeAdminCreatedUserView>>
  getNativeAdminOverview(userId: string, range?: NativeAdminOverviewRange): Promise<ServiceResult<NativeAdminOverviewView>>
  listNativeAdminClasses(userId: string, limit: number, offset: number, query?: string): Promise<ServiceResult<NativeAdminClassPageView>>
  listNativeAdminSelectionOptions(userId: string, kind: NativeAdminSelectionKind, classId: string,
    limit: number, offset: number, query?: string): Promise<ServiceResult<NativeAdminSelectionPageView>>
  listNativeAdminUsers(userId: string, classId: string, limit: number, offset: number,
    query?: string, role?: NativeAdminUserRoleFilter,
    status?: NativeAdminUserStatusFilter): Promise<ServiceResult<NativeAdminUserPageView>>
  listNativeAdminGrants(userId: string, limit: number, offset: number, query?: string): Promise<ServiceResult<NativeAdminGrantPageView>>
  listNativeAdminGrantCandidates(userId: string, limit: number, offset: number,
    query?: string): Promise<ServiceResult<NativeAdminGrantCandidatePageView>>
  listNativeAdminAudit(userId: string, limit: number, offset: number): Promise<ServiceResult<NativeAdminAuditPageView>>
  getNativeAdminQuestionPreview(userId: string, questionId: string): Promise<ServiceResult<NativeAdminQuestionPreviewView>>
  getNativeAdminUserBindings(userId: string, targetUserId: string): Promise<ServiceResult<NativeAdminUserBindingsView>>
  setNativeAdminGrant(userId: string, input: NativeAdminGrantInput,
    expectedGrantVersion: number, operationId: string): Promise<ServiceResult<NativeAdminGrantView>>
  listNativeAdminRecords(userId: string, kind: NativeAdminRecordKind,
    limit: number, offset: number, filter?: NativeAdminRecordFilter): Promise<ServiceResult<NativeAdminRecordPageView>>
  exportNativeAdminRecords(userId: string, kind: 'tasks', filter?: NativeAdminRecordFilter): Promise<ServiceResult<NativeAdminRecordsExportView>>
  createNativeAdminClass(userId: string, input: CreateNativeAdminClassInput,
    expectedVersion: number, operationId: string): Promise<ServiceResult<NativeAdminClassMutationView>>
  updateNativeAdminClass(userId: string, input: UpdateNativeAdminClassInput,
    expectedVersion: number, operationId: string): Promise<ServiceResult<NativeAdminClassMutationView>>
  archiveNativeAdminClass(userId: string, input: ArchiveNativeAdminClassInput,
    expectedVersion: number, destinationExpectedVersion: number | null,
    operationId: string): Promise<ServiceResult<NativeAdminClassArchiveView>>
  assignNativeAdminTeacher(userId: string, input: AssignNativeAdminTeacherInput,
    expectedVersion: number, operationId: string): Promise<ServiceResult<NativeAdminTeacherAssignmentView>>
  revokeNativeAdminTeacher(userId: string, input: RevokeNativeAdminTeacherInput,
    expectedVersion: number, operationId: string): Promise<ServiceResult<NativeAdminTeacherAssignmentView>>
  updateNativeAdminUser(userId: string, input: UpdateNativeAdminUserInput,
    expectedVersion: number, operationId: string): Promise<ServiceResult<NativeAdminUserMutationView>>
  disableNativeAdminUser(userId: string, input: DisableNativeAdminUserInput,
    expectedVersion: number, operationId: string): Promise<ServiceResult<NativeAdminUserMutationView>>
  unbindNativeAdminUser(userId: string, input: UnbindNativeAdminUserInput,
    expectedVersion: number, operationId: string): Promise<ServiceResult<NativeAdminUnbindView>>
  listNativeAdminDeletedWorks(userId: string, studentId: string,
    limit: number, offset: number): Promise<ServiceResult<NativeAdminDeletedWorkPageView>>
  restoreNativeAdminWork(userId: string, input: Readonly<{ studentId: string; workId: string; reason: string }>,
    expectedVersion: number, operationId: string): Promise<ServiceResult<NativeAdminRestoredWorkView>>
  saveNativeTextbookConfig(userId: string, input: SaveNativeTextbookConfigInput,
    expectedVersion: number, operationId: string): Promise<ServiceResult<NativeTextbookConfigView>>
  setNativeTextbookConfigStatus(userId: string, input: SetNativeTextbookConfigStatusInput,
    expectedVersion: number, operationId: string): Promise<ServiceResult<NativeTextbookConfigView>>
  setNativeQuestionStatus(userId: string, input: SetNativeQuestionStatusInput,
    expectedVersion: number, operationId: string): Promise<ServiceResult<NativeQuestionStatusView>>
  setNativeQuestionVisibility(userId: string, input: SetNativeQuestionVisibilityInput,
    expectedVersion: number, operationId: string): Promise<ServiceResult<NativeQuestionVisibilityView>>
  setNativeQuestionBatchStatus(userId: string, input: SetNativeQuestionBatchStatusInput,
    operationId: string): Promise<ServiceResult<NativeQuestionBatchStatusView>>
  stopNativeManaged(userId: string, input: StopNativeManagedInput,
    expectedVersion: number, operationId: string): Promise<ServiceResult<NativeManagedStopView>>
  getNativeAdminMediaReview(userId: string, mediaId: string): Promise<ServiceResult<NativeAdminMediaReviewSummaryView>>
  getNativeAdminMediaPreview(userId: string, mediaId: string): Promise<ServiceResult<NativeAdminMediaPreviewView>>
  listNativeAdminMediaAudit(userId: string, mediaId: string, limit: number,
    offset: number): Promise<ServiceResult<NativeAdminMediaAuditPageView>>
  reportNativeAdminMediaIssue(userId: string, mediaId: string, reason: string,
    expectedVersion: number, operationId: string): Promise<ServiceResult<NativeAdminMediaActionView>>
  reviewNativeAdminMedia(userId: string, input: NativeAdminMediaReviewInput,
    expectedVersion: number, operationId: string): Promise<ServiceResult<NativeAdminMediaActionView>>
  publishNativeAdminMedia(userId: string, mediaId: string,
    expectedVersion: number, operationId: string): Promise<ServiceResult<NativeAdminMediaActionView>>
  unpublishNativeAdminMedia(userId: string, mediaId: string, reason: string,
    expectedVersion: number, operationId: string): Promise<ServiceResult<NativeAdminMediaActionView>>
  listTeacherCheckItems(userId: string, filters: TeacherCheckFilters, limit: number,
    offset: number): Promise<ServiceResult<TeacherCheckPage>>
  getTeacherWorkbench(userId: string, date: string, classId?: string): Promise<ServiceResult<TeacherWorkbenchView>>
  previewTeacherTask(userId: string, taskId: string, version: number): Promise<ServiceResult<TeacherTaskPreviewView>>
  getTeacherTaskForEdit(userId: string, taskId: string): Promise<ServiceResult<TeacherTaskEditView>>
  copyTeacherTaskSnapshot(userId: string, sourceTaskId: string, sourceVersion: number, operationId: string): Promise<ServiceResult<{ taskId: string; version: number }>>
  updatePublishedTeacherTask(userId: string, command: CloudPublishTaskCommand, status: Task['status'], previousDueAt: string): Promise<ServiceResult<{ taskId: string; version: number }>>
  updateTeacherTaskDescription(userId: string, taskId: string, version: number, description: string, operationId: string): Promise<ServiceResult<{ taskId: string; version: number }>>
  recycleTeacherTask(userId: string, taskId: string, version: number, reason: string, operationId: string): Promise<ServiceResult<{ taskId: string }>>
  deleteTeacherDraftTask(userId: string, taskId: string, version: number, reason: string,
    operationId: string): Promise<ServiceResult<{ taskId: string; deleted: true }>>
  getDraftOptions(userId: string, nowIso: string, catalogMode?: 'selector'): Promise<ServiceResult<TaskDraftOptionsView>>
  getCompletion(userId: string, taskId: string): Promise<ServiceResult<CloudReviewAssignmentView[]>>
  getReviewSubmission(userId: string, submissionId: string): Promise<ServiceResult<TeacherReviewSubmissionView>>
  generateTeacherSuggestion(userId: string, submissionId: string, operationId: string): Promise<ServiceResult<TeacherSuggestionView>>
  getTeacherSuggestion(userId: string, submissionId: string, generationOperationId: string): Promise<ServiceResult<TeacherSuggestionStatusView>>
  getAutomaticTeacherSuggestion(userId: string, submissionId: string): Promise<ServiceResult<TeacherSuggestionStatusView>>
  getTeacherTaskMediaReviewEvidence(userId: string, submissionId: string,
    itemId: string): Promise<ServiceResult<TeacherTaskMediaReviewEvidenceView>>
  previewBatchComment(userId: string, taskId: string, submissionIds: readonly string[], comment: string): Promise<ServiceResult<BatchCommentPreview>>
  publishBatchComment(userId: string, previewToken: string, previewVersion: number, textComment: string,
    operationId: string): Promise<ServiceResult<BatchCommentReceipt>>
  listTeacherStudents(userId: string, filters: Readonly<{ classId?: string; keyword?: string; status: TeacherStudentStatusFilter }>, cursor?: string): Promise<ServiceResult<TeacherStudentPage>>
  importTeacherStudents(userId: string, csvBase64: string, operationId: string): Promise<ServiceResult<TeacherStudentBulkImportView>>
  getTeacherStudent(userId: string, studentId: string): Promise<ServiceResult<TeacherStudentDetail>>
  updateTeacherStudent(userId: string, command: TeacherStudentUpdateCommand): Promise<ServiceResult<TeacherStudentMutationView>>
  setTeacherStudentStatus(userId: string, command: TeacherStudentStatusCommand): Promise<ServiceResult<TeacherStudentMutationView>>
  transferTeacherStudent(userId: string, command: TeacherStudentTransferCommand): Promise<ServiceResult<TeacherStudentMutationView>>
  publishClassroomTask(userId: string, command: CloudPublishTaskCommand): Promise<ServiceResult<Task>>
  saveTeacherTaskDraft(userId: string, command: CloudPublishTaskCommand): Promise<ServiceResult<Task>>
  reviewSubmission(userId: string, command: CloudReviewCommand): Promise<ServiceResult<ReviewFeedback>>
  beginReviewVoiceRecording(userId: string, submissionId: string,
    operationId: string): Promise<ServiceResult<ReviewVoiceDraftView>>
  sealReviewVoiceRecording(userId: string, recordingId: string, stagingFileId: string,
    expectedVersion: number, operationId: string): Promise<ServiceResult<ReviewVoiceDraftView>>
  listParentChildren(userId: string): Promise<ServiceResult<ParentChildLinkView[]>>
  bindChild(userId: string, command: BindChildCommand): Promise<ServiceResult<ParentChildLinkView>>
  unbindChild(userId: string, command: UnbindChildCommand): Promise<ServiceResult<null>>
  getParentHome(userId: string): Promise<ServiceResult<ParentHomeView>>
  listParentTasks(userId: string, filters: ParentTaskListFilters,
    page: Readonly<{ limit: number; cursor?: string }>): Promise<ServiceResult<ParentTaskListPage>>
  getParentTask(userId: string, taskId: string): Promise<ServiceResult<TaskDetailView>>
  getParentFeedback(userId: string, taskId: string): Promise<ServiceResult<ReviewFeedback>>
  getParentRecordingPlayback(userId: string, input: Readonly<{ childId: string; taskId: string;
    assignmentId: string; submissionVersion: number; itemId: string }>): Promise<ServiceResult<ParentRecordingPlaybackView>>
  getParentFeedbackVoicePlayback(userId: string, input: Readonly<{ childId: string; taskId: string;
    assignmentId: string; submissionVersion: number; feedbackId: string }>): Promise<ServiceResult<ParentFeedbackVoicePlaybackView>>
  getParentTaskMediaPlayback(userId: string, input: Readonly<{ childId: string; taskId: string;
    assignmentId: string; submissionVersion: number; itemId: string }>): Promise<ServiceResult<ParentTaskMediaPlaybackView>>
  getTeacherStats(userId: string, filters: StatsFilters): Promise<ServiceResult<StatsView>>
  getParentStats(userId: string, childId: string, filters: StatsFilters): Promise<ServiceResult<StatsView>>
  exportTeacherStats(userId: string, filters: StatsFilters): Promise<ServiceResult<StatsExport>>
  listReadingResources(userId: string): Promise<ServiceResult<ReadingListItem[]>>
  getReadingResource(userId: string, resourceId: string): Promise<ServiceResult<ReadingResource>>
  getReadingPronunciationSegments(userId: string, resourceId: string): Promise<ServiceResult<ReadingPronunciationSegmentsView>>
  getReadingAudioMap(userId: string, resourceId: string, chapterId: string): Promise<ServiceResult<ReadingAudioMapView>>
  listVocabularyPacks(userId: string): Promise<ServiceResult<VocabularyPack[]>>
  getVocabularyPack(userId: string, resourceId: string): Promise<ServiceResult<VocabularyPack>>
  getHistoricalTaskLearning(userId: string, taskId: string,
    itemId: string): Promise<ServiceResult<HistoricalTaskLearningView>>
  getReadingProgress(userId: string, resourceId: string): Promise<ServiceResult<ReadingProgress | null>>
  saveReadingProgress(userId: string, command: SaveReadingProgressCommand): Promise<ServiceResult<ReadingProgress>>
  getVocabularyProgress(userId: string, packId: string): Promise<ServiceResult<VocabularyProgress | null>>
  getWordAttemptState(userId: string, scope: VocabularyAnswerScope): Promise<ServiceResult<VocabularyAttemptState>>
  getPackAttemptSummary(userId: string, scope: VocabularyPackScope): Promise<ServiceResult<VocabularyPackAttemptSummary>>
  submitWordAnswer(userId: string, input: VocabularyAnswerInput, expectedVersion: number,
    operationId: string): Promise<ServiceResult<VocabularyAttemptView>>
  listWorkMaterials(userId: string): Promise<ServiceResult<WorkMaterial[]>>
  searchWorkMaterials(userId: string, keyword: string, limit: number, offset: number,
    filters?: WorkMaterialFilters): Promise<ServiceResult<WorkMaterialPage>>
  listWorkMaterialFacets(userId: string): Promise<ServiceResult<WorkMaterialFacet[]>>
  getWorkMaterial(userId: string, materialId: string): Promise<ServiceResult<WorkMaterial>>
  beginWorkDraft(userId: string, materialId: string, operationId: string): Promise<ServiceResult<StudentWork>>
  submitWork(userId: string, input: { workId: string; stagingFileId: string; note: string },
    expectedVersion: number, operationId: string): Promise<ServiceResult<StudentWork>>
  deleteWorkDraft(userId: string, workId: string, expectedVersion: number,
    operationId: string): Promise<ServiceResult<StudentWork>>
  listMyWorks(userId: string): Promise<ServiceResult<StudentWork[]>>
  getWorkPlayback(userId: string, workId: string): Promise<ServiceResult<WorkPlayback>>
  getMaterialPlayback(userId: string, materialId: string): Promise<ServiceResult<MaterialPlayback>>
  listPhonicsCourses(userId: string): Promise<ServiceResult<PhonicsCourseListItem[]>>
  getPhonicsCourse(userId: string, courseId: string): Promise<ServiceResult<PhonicsCourseView>>
  getPhonicsState(userId: string, courseId: string): Promise<ServiceResult<PhonicsCourseState>>
  submitPhonicsAnswer(userId: string, input: { courseId: string; questionId: string; selectedOptionId: string; round: number },
    expectedVersion: number, operationId: string): Promise<ServiceResult<PhonicsAnswerView>>
  getPhonicsAudio(userId: string, courseId: string, phonemeId: string): Promise<ServiceResult<PhonicsAudioView>>
  listTaskTemplates(userId: string): Promise<ServiceResult<TaskTemplateView[]>>
  getTaskTemplate(userId: string, templateId: string): Promise<ServiceResult<TaskTemplateView>>
  saveTaskTemplate(userId: string, input: TaskTemplateInput, expectedVersion: number,
    operationId: string): Promise<ServiceResult<TaskTemplateView>>
  renameTaskTemplate(userId: string, templateId: string, title: string, expectedVersion: number,
    operationId: string): Promise<ServiceResult<TaskTemplateView>>
  copyTaskTemplate(userId: string, templateId: string, title: string, expectedVersion: number,
    operationId: string): Promise<ServiceResult<TaskTemplateView>>
  removeTaskTemplate(userId: string, templateId: string, expectedVersion: number,
    operationId: string): Promise<ServiceResult<TaskTemplateView>>
  useTaskTemplate(userId: string, templateId: string, expectedVersion: number,
    operationId: string): Promise<ServiceResult<TaskTemplateView>>
  instantiateTaskTemplate(userId: string, templateId: string, expectedVersion: number,
    operationId: string): Promise<ServiceResult<{ taskId: string; version: number; templateVersion: number }>>
  saveVocabularyProgress(userId: string, command: SaveVocabularyProgressCommand): Promise<ServiceResult<VocabularyProgress>>
  logout(userId: string): Promise<ServiceResult<null>>
}

interface TeacherTasksView {
  tasks: Task[]
  pendingCount: number
  progressByTask: Record<string, number>
  pendingByTask: Record<string, number>
}

export interface TeacherWorkbenchView {
  activeTaskCount: number; pendingReviewCount: number; pendingCommentCount: number;
  recentTasks: Array<{ taskId: string; title: string; classIds: string[];
    completedCount: number; totalCount: number; pendingReviewCount: number }>
}

export interface TeacherTaskPreviewView {
  taskId: string | null; title: string; description: string | null; startsAt: string; dueAt: string;
  classIds: string[]; items: Array<{ id: string; resourceId: string; title: string; type: TaskItem['type']; completionRule: Record<string, unknown> }>;
  version: number
  target?: { type: 'classes' | 'students'; classIds: string[]; studentIds: string[] }
}

export interface TeacherTaskEditView {
  taskId: string; title: string; status: Task['status']; version: number; description: string | null; teacherNote: string | null;
  copiedFromTaskId?: string | null;
  copiedFromTemplateId?: string | null;
  startsAt: string; dueAt: string; latePolicy: { allowLate: boolean; lateDays: number };
  target: { type: 'classes' | 'students'; classIds: string[]; studentIds: string[] };
  itemRefs: Array<{ id: string; resourceId: string; completionRule?: Record<string, unknown>; scoringRule?: Record<string, unknown>; order: number }>
  items: Array<{ resourceId: string; title: string; type: TaskItem['type'] }>
  publication?: { operationId: string; originalVersion: number; completedCount: number; totalCount: number }
}

export interface TeacherReviewSubmissionView {
  taskId: string; assignmentId: string; taskTitle: string; submittedAt: string;
  submissionId?: string; submissionVersion: number;
  submissionHistory?: Array<{ id: string; version: number; status: Submission['status']; submittedAt: string }>
  taskItems?: Array<{ id: string; title: string; type: TaskItem['type'];
    completionRule: Record<string, unknown>; order: number; recordingPrompt?: string }>
  readingPages?: Array<{ itemId: string; pageId: string; pageNumber: number; chapterTitle: string;
    imageAssetKey: string; thumbnailAssetKey: string }>
  readingPronunciationSegments?: Array<{ itemId: string; segmentId: string; text: string; pageNumber?: number }>
  automaticScore?: number | null
  scoringItems?: Array<{ itemId: string; weightPercent: number; automaticScore: number | null;
    teacherScoreRequired: boolean; complete: boolean }>
  answers: Array<{ itemId: string; value: unknown }>
  exerciseEvidence?: Array<{ itemId: string; questionId: string; questionType: SchoolQuestionType; stem: string; options: string[];
    exerciseSection?: import('../domain/types').ExerciseSection;
    rubric?: Array<{ criterion: string; points: number }>;
    studentResponse: unknown; correctAnswer: unknown; explanation: string; isCorrect: boolean | null; recorded: boolean }>
  vocabularyEvidence?: Array<{ itemId: string; wordId: string; targetWord: string; meaning?: string; example?: string; syllables?: string[]; firstCorrect: boolean | null;
    attempts: Array<{ studentInput: string; isCorrect: boolean; firstAttempt: boolean; attemptNumber: number; attemptedAt: string }> }>
  feedback?: FeedbackWire | null
}

export interface BatchCommentPreview {
  previewToken: string
  previewVersion: number
  eligibleCount: number
  excludedCount: number
  commentSummary: { length: number }
}

export interface BatchCommentReceipt {
  taskId: string
  reviewedCount: number
  submissionIds: string[]
}

interface AuthSessionWire {
  sessionId: string
  userId: string
  organizationId: string
  activeRole: Role | null
  roles: Role[]
  displayName?: string
  profileVersion?: number
}

interface PageWire<T> { items: T[]; total: number; nextCursor: string | null }

interface TeacherStudentPageWire extends TeacherStudentPage {}

interface TeacherStudentDetailWire extends TeacherStudentDetail {}

export interface TeacherStudentMutationView { studentId: string; displayName: string; accountStatus: 'active' | 'disabled'; classId: string; userVersion: number; membershipVersion: number; classVersion: number }
interface TeacherStudentCommandBase { studentId: string; classId: string; operationId: string; expectedUserVersion: number; expectedMembershipVersion: number; reason: string }
export interface TeacherStudentUpdateCommand extends TeacherStudentCommandBase { displayName: string }
export interface TeacherStudentStatusCommand extends TeacherStudentCommandBase { status: 'active' | 'disabled'; expectedClassVersion: number }
export interface TeacherStudentTransferCommand { studentId: string; sourceClassId: string; targetClassId: string; operationId: string; expectedUserVersion: number; expectedMembershipVersion: number; expectedTargetMembershipVersion: number; expectedSourceClassVersion: number; expectedTargetClassVersion: number; reason: string }

interface StudentListItemWire {
  taskId: string
  title: string
  status: TaskAssignment['status']
  startsAt: string
  dueAt: string
  submittedAt: string | null
  redoDueAt?: string | null
}

interface StudentHomeWire {
  localDate: string
  completedCount: number
  totalCount: number
  nextTask: StudentListItemWire | null
  todayTasks?: StudentListItemWire[]
}

interface SafeTaskItemWire {
  id: string
  resourceId: string
  title: string
  type: TaskItem['type']
  completionRule: object
  readingPageNumbers?: number[]
  recordingPrompt?: string
  snapshotSchemaVersion?: 1 | 2
  vocabularyWordIds?: string[]
  vocabularyPack?: VocabularyPack
  exerciseQuestion?: { questionId: string; exercisePackId?: string; questionType: SchoolQuestionType; stem: string;
    options: string[]; exerciseSection?: import('../domain/types').ExerciseSection }
  mediaSnapshot?: M3TaskMediaSnapshotView
}

interface FeedbackWire {
  id: string
  teacherName?: string
  voiceComment?: { available: boolean; durationMs: number | null }
  submissionId?: string
  decision: 'approved' | 'returned'
  score: number | null
  itemScores?: Array<{ itemId: string; score: number }>
  textComment: string | null
  returnReason: string | null
  publishedAt: string
  originalAutomaticScore?: number | null
  overrideReason?: string | null
}

interface StudentTaskDetailWire {
  taskId: string
  title: string
  description: string | null
  status?: Task['status']
  startsAt: string
  dueAt: string
  latePolicy?: { allowLate: boolean; lateDays: number }
  items: SafeTaskItemWire[]
  readingPageProgress?: Array<{ itemId: string; completedPageCount: number }>
  automaticScore?: number | null
  assignment: {
    classId?: string
    status: TaskAssignment['status']
    submittedAt: string | null
    redoCount: number
    redoDueAt: string | null
    version: number
  }
  submission: {
    id: string
    version: number
    status: Submission['status']
    answers: { itemId: string; value: unknown }[]
    submittedAt: string | null
    recordVersion: number
    assignmentVersion: number
  } | null
  submissionHistory?: { version: number; status: Submission['status']; submittedAt: string;
    answers?: { itemId: string; value: unknown }[]; feedback?: FeedbackWire | null }[]
  feedback: FeedbackWire | null
}

interface TeacherTaskWire {
  taskId: string
  title: string
  status: Task['status']
  startsAt: string
  dueAt: string
  classIds: string[]
  completedCount: number
  totalCount: number
  pendingReviewCount: number
  version: number
}

interface CompletionWire {
  task: TeacherTaskWire
  assignments: PageWire<{
    assignmentId: string
    studentId: string
    classId: string
    status: TaskAssignment['status']
    latestSubmissionId: string | null
    latestSubmissionVersion: number
    submittedAt: string | null
    reviewedAt: string | null
    score: number | null
  }>
}

interface ReviewSubmissionWire {
  taskId: string
  assignmentId: string
  assignmentVersion: number
  submissionId: string
  submissionVersion: number
  feedback: FeedbackWire | null
}

interface SubmissionReceiptWire {
  submissionId: string
  submissionVersion: number
  recordVersion: number
  assignmentVersion: number
  status: Submission['status']
  submittedAt: string | null
}

interface TaskDraftReceiptWire { taskId: string; status: Task['status']; version: number }
interface TemplateDraftReceiptWire extends TaskDraftReceiptWire { templateVersion: number }
interface TaskPublishReceiptWire { taskId: string; status: Task['status'] | 'publishing'; version: number; assignmentCount?: number; totalCount?: number }

interface TaskDraftOptionsWire {
  classes: { id: string; name: string }[]
  resources: {
    id: string
    title: string
    type: 'reading' | 'vocabulary' | 'exercise' | 'recording' | 'listening' | 'video' | 'dubbing'
    allowedClassIds: string[]
    completionRule: Record<string, unknown>
    scoringRule: Record<string, unknown>
  }[]
}

interface ReviewReceiptWire {
  feedbackId: string
  submissionId: string
  submissionVersion: number
  decision: 'approved' | 'returned'
  assignmentVersion: number
}

interface ParentTaskWire {
  taskId: string
  title: string
  studentId: string
  assignmentId?: string
  assignmentStatus: TaskAssignment['status']
  itemSummaries?: Array<{ itemId: string; title: string; type: string; order: number;
    pronunciationAvailable?: boolean }>
  automaticScore?: number | null
  submission: { id: string; version: number; answers: { itemId: string; value: unknown }[]; submittedAt: string } | null
  feedback: FeedbackWire | null
  submissionHistory?: Array<{ id: string; version: number; submittedAt: string;
    answers: Array<{ itemId: string; value: unknown }>; feedback: FeedbackWire | null }>
}

interface ParentTaskListWire {
  taskId: string
  title: string
  contentTypes?: string[]
  status: TaskAssignment['status']
  startsAt: string
  dueAt: string
  submittedAt: string | null
  isLate?: boolean
  feedbackId: string | null
  score?: number | null
}

function parentTaskListItem(item: ParentTaskListWire): ParentTaskListView {
  return { taskId: item.taskId, title: item.title,
    contentTypes: Array.isArray(item.contentTypes)
      ? item.contentTypes.filter((type): type is string => typeof type === 'string') : [],
    status: item.status, startsAt: item.startsAt, dueAt: item.dueAt,
    submittedAt: item.submittedAt, isLate: item.isLate === true,
    feedbackId: item.feedbackId, score: item.score ?? null }
}

interface ParentHomeWire {
  childId: string
  child?: { id: string; displayName: string; displayNameMasked: string; classId: string | null; className: string | null }
  pendingTaskCount: number
  completedTaskCount: number
  weeklyAssignedCount?: number
  weeklyCompletedCount?: number
  overdueTaskCount?: number
  recentTasks: ParentTaskListWire[]
  recentFeedback: { feedbackId: string; taskId: string; taskTitle: string;
    teacherName?: string; textComment?: string; decision: 'approved' | 'returned';
    score: number | null; publishedAt: string }[]
}

interface ParentChildWire {
  linkId: string
  linkVersion: number
  childId: string
  displayName: string
  displayNameMasked: string
  studentNumber: string | null
  classId: string | null
  className: string | null
  confirmedAt: string | null
}

interface BoundChildWire {
  id: string
  child: {
    id: string
    displayName: string
    displayNameMasked: string
    studentNumber?: string
    classIds?: string[]
  }
  confirmedAt: string
  version: number
}

interface FeedbackDetailWire {
  feedbackId: string
  childId: string
  taskId: string
  taskTitle: string
  submission: { id: string; version: number; answers: { itemId: string; value: unknown }[]; submittedAt: string }
  feedback: Omit<FeedbackWire, 'id'>
}

export function createCloudAppService(
  repository: CloudRepositoryClient,
  authentication: CloudAuthenticationPort,
  contextProvider: CloudClientContextProvider,
): CloudAppService {
  let currentUser: UserAccount | null = null
  let currentProfileVersion: number | null = null

  const currentContextUser = (userId: string, role: Role): UserAccount =>
    currentUser?.id === userId ? currentUser : { id: userId, displayName: userId, role }

  const activeChildId = (): ServiceResult<string> => {
    const childId = contextProvider().activeChildId
    return childId
      ? { ok: true, data: childId }
      : failure('VALIDATION_ERROR', '请先选择孩子')
  }

  const getStudentDetail = async (taskId: string): Promise<ServiceResult<TaskDetailView>> => {
    const result = await repository.call<'getMyTask', { taskId: string }, StudentTaskDetailWire>(
      'student-task-query', 'getMyTask', { taskId },
    )
    return mapResult(result, mapStudentTaskDetail)
  }

  const getCompletionRows = async (taskId: string): Promise<ServiceResult<CloudReviewAssignmentView[]>> => {
    const result = await repository.call<'getCompletion', { taskId: string; filter: object; page: { limit: number; cursor?: string } }, CompletionWire>(
      'task-query', 'getCompletion', { taskId, filter: {}, page: { limit: 100 } },
    )
    if (!result.ok) return result
    const assignmentItems = [...result.data.assignments.items]
    const seenAssignmentCursors = new Set<string>()
    let assignmentCursor = result.data.assignments.nextCursor
    for (let page = 1; assignmentCursor && page < 20; page++) {
      if (seenAssignmentCursors.has(assignmentCursor)) return failure('CONFLICT', '任务完成情况分页异常，请重试')
      seenAssignmentCursors.add(assignmentCursor)
      const next = await repository.call<'getCompletion', { taskId: string; filter: object; page: { limit: number; cursor?: string } }, CompletionWire>(
        'task-query', 'getCompletion', { taskId, filter: {}, page: { limit: 100, cursor: assignmentCursor } },
      )
      if (!next.ok) return next
      assignmentItems.push(...next.data.assignments.items)
      assignmentCursor = next.data.assignments.nextCursor
    }
    if (assignmentCursor) return failure('CONFLICT', '任务完成情况超过当前可加载范围，请缩小对象范围')
    const students = new Map<string, TeacherStudentListItem>()
    let cursor: string | undefined
    const seen = new Set<string>()
    for (let page = 0; page < 20; page++) {
      const studentPage = await repository.call<'listStudents', { filters: { status: 'all' }; page: { limit: number; cursor?: string } }, TeacherStudentPageWire>(
        'teacher-student-query', 'listStudents', { filters: { status: 'all' }, page: { limit: 50, ...(cursor === undefined ? {} : { cursor }) } },
      )
      if (!studentPage.ok) {
        if (studentPage.error.code === 'FORBIDDEN') break
        return studentPage
      }
      for (const item of studentPage.data.items) students.set(item.studentId, item)
      if (!studentPage.data.nextCursor) break
      if (seen.has(studentPage.data.nextCursor)) return failure('CONFLICT', '学员分页异常，请重试')
      seen.add(studentPage.data.nextCursor)
      cursor = studentPage.data.nextCursor
    }
    return mapResult(result, () => assignmentItems.map(item => {
      const student = students.get(item.studentId)
      return {
        studentName: student?.displayName ?? '学员信息不可用',
        ...(student?.studentNumber === undefined ? {} : { studentNumber: student.studentNumber }),
        ...(student?.classInfo.name === undefined ? {} : { className: student.classInfo.name }),
        ...(item.submittedAt === null ? {} : { submittedAt: item.submittedAt }),
        ...(item.score === null ? {} : { score: item.score }),
        assignmentId: item.assignmentId, classId: item.classId, taskId, status: item.status,
        ...(item.latestSubmissionId === null ? {} : { submissionId: item.latestSubmissionId }),
        ...(item.latestSubmissionVersion < 1 ? {} : { submissionVersion: item.latestSubmissionVersion }),
      }
    }))
  }

  return {
    async login(mobile, password) {
      if (!mobile || !password) return failure('VALIDATION_ERROR', '请输入手机号和密码')
      try {
        await authentication.signIn({ mobile, password })
      } catch (error: unknown) {
        return authenticationFailure(error)
      }
      const result = await repository.call<'bootstrap', Record<string, never>, AuthSessionWire>(
        'auth-session',
        'bootstrap',
        {},
        { businessSessionToken: null },
      )
      if (!result.ok) return result
      const role = result.data.activeRole ?? result.data.roles[0]
      if (role === undefined) return withMeta(failure('FORBIDDEN', '当前账号没有可用身份'), result)
      if (result.data.activeRole === null && result.data.roles.length > 1) {
        currentUser = { id: result.data.userId, displayName: result.data.displayName ?? result.data.userId, role }
        currentProfileVersion = result.data.profileVersion ?? null
        return { ok: true, data: { sessionId: result.data.sessionId, user: currentUser, availableRoles: [...result.data.roles], activeRole: null }, meta: result.meta }
      }
      const selected = result.data.activeRole === null
        ? await repository.call<'selectRole', { role: Role }, AuthSessionWire>('auth-session', 'selectRole', { role }, { businessSessionToken: result.data.sessionId })
        : result
      if (!selected.ok) return selected
      currentUser = { id: selected.data.userId, displayName: selected.data.displayName ?? selected.data.userId, role }
      currentProfileVersion = selected.data.profileVersion ?? null
      return { ok: true, data: { sessionId: selected.data.sessionId, user: currentUser, availableRoles: [...selected.data.roles], activeRole: role }, meta: selected.meta }
    },

    async requestPasswordResetCode(mobile) {
      if (!/^1\d{10}$/.test(mobile)) return failure('VALIDATION_ERROR', '请输入正确的手机号')
      if (authentication.requestPasswordResetCode === undefined) return failure('SERVICE_UNAVAILABLE', '密码找回服务暂不可用，请稍后重试')
      try {
        await authentication.requestPasswordResetCode(`+86 ${mobile}`)
        return { ok: true, data: { expiresInMinutes: 10 } }
      } catch (error: unknown) {
        return passwordRecoveryServiceFailure(error)
      }
    },

    async verifyPasswordResetCode(mobile, code) {
      if (!/^1\d{10}$/.test(mobile) || !/^\d{6}$/.test(code)) {
        return failure('VALIDATION_ERROR', '手机号或验证码格式不正确')
      }
      if (authentication.verifyPasswordResetCode === undefined) {
        return failure('SERVICE_UNAVAILABLE', '密码找回服务暂不可用，请稍后重试')
      }
      try {
        const expiresInSeconds = await authentication.verifyPasswordResetCode(`+86 ${mobile}`, code)
        if (!Number.isSafeInteger(expiresInSeconds) || expiresInSeconds < 1) {
          return failure('SERVICE_UNAVAILABLE', '验证码验证结果无效，请重试')
        }
        return { ok: true, data: { expiresInSeconds } }
      } catch (error: unknown) {
        return passwordCodeVerificationFailure(error)
      }
    },

    async resetPassword(mobile, newPassword) {
      if (!/^1\d{10}$/.test(mobile)) {
        return failure('VALIDATION_ERROR', '请输入正确的手机号')
      }
      if (newPassword.length < 8 || newPassword.length > 32 || !/[A-Za-z]/.test(newPassword)
        || !/\d/.test(newPassword)) {
        return failure('VALIDATION_ERROR', '新密码需为 8—32 位且同时包含字母和数字')
      }
      if (authentication.resetPassword === undefined) {
        return failure('SERVICE_UNAVAILABLE', '密码找回服务暂不可用，请稍后重试')
      }
      try {
        await authentication.resetPassword(`+86 ${mobile}`, newPassword)
        return { ok: true, data: null }
      } catch (error: unknown) {
        if (typeof error === 'object' && error !== null && 'code' in error
          && typeof error.code === 'string' && error.code.startsWith('AUTH_PROVIDER_')) {
          console.warn('[Auth] password reset provider code:', error.code)
        }
        return passwordRecoveryServiceFailure(error)
      }
    },

    async listRoles(_userId) {
      const result = await repository.call<'getCurrentSession', Record<string, never>, AuthSessionWire>('auth-session', 'getCurrentSession', {})
      return mapResult(result, value => value.roles)
    },

    async selectRole(_userId, role) {
      const result = await repository.call<'selectRole', { role: Role }, AuthSessionWire>('auth-session', 'selectRole', { role })
      if (!result.ok) return result
      currentUser = { id: result.data.userId, displayName: result.data.displayName ?? result.data.userId, role }
      currentProfileVersion = result.data.profileVersion ?? null
      return { ok: true, data: { sessionId: result.data.sessionId, user: currentUser, availableRoles: [...result.data.roles], activeRole: role }, meta: result.meta }
    },

    async getUser(userId) {
      if (currentUser?.id === userId) return { ok: true, data: currentUser }
      const result = await repository.call<'getCurrentSession', Record<string, never>, AuthSessionWire>(
        'auth-session', 'getCurrentSession', {},
      )
      if (!result.ok) return result
      if (result.data.userId !== userId || result.data.activeRole === null) {
        return failure('NOT_FOUND', '用户不存在')
      }
      currentUser = { id: result.data.userId,
        displayName: result.data.displayName ?? result.data.userId,
        role: result.data.activeRole }
      currentProfileVersion = result.data.profileVersion ?? null
      return { ok: true, data: currentUser, meta: result.meta }
    },

    async updateProfile(userId, displayName) {
      if (currentUser?.id !== userId) return failure('NOT_FOUND', '用户不存在')
      const normalized = displayName.trim()
      if (!normalized || normalized.length > 50) return failure('VALIDATION_ERROR', '姓名须为 1—50 个字符')
      if (currentProfileVersion === null) {
        const current = await repository.call<'getCurrentSession', Record<string, never>, AuthSessionWire>('auth-session', 'getCurrentSession', {})
        if (!current.ok) return current
        currentProfileVersion = current.data.profileVersion ?? null
      }
      if (currentProfileVersion === null) return failure('SERVICE_UNAVAILABLE', '资料版本尚未加载，请刷新后重试')
      const result = await repository.call<'updateProfile', { displayName: string }, AuthSessionWire>(
        'auth-session', 'updateProfile', { displayName: normalized },
        { operationId: `profile_${Date.now()}`, expectedVersion: currentProfileVersion },
      )
      if (!result.ok) return result
      currentProfileVersion = result.data.profileVersion ?? currentProfileVersion + 1
      currentUser = { ...currentUser, displayName: result.data.displayName ?? normalized }
      return { ok: true, data: currentUser, meta: result.meta }
    },

    async getHome(userId) {
      const localDate = contextProvider().localDate ?? new Date().toISOString().slice(0, 10)
      const result = await repository.call<'getHome', { localDate: string }, StudentHomeWire>('student-task-query', 'getHome', { localDate })
      if (!result.ok) return result
      const todayTasks = result.data.todayTasks ?? (result.data.nextTask ? [result.data.nextTask] : [])
      if (result.data.nextTask === null) {
        return { ok: true, data: { user: currentContextUser(userId, 'student'), task: null, assignment: null,
          completedCount: result.data.completedCount, totalCount: result.data.totalCount, todayTasks }, meta: result.meta }
      }
      const detail = await getStudentDetail(result.data.nextTask.taskId)
      if (!detail.ok) return detail
      return { ok: true, data: { user: currentContextUser(userId, 'student'), ...detail.data,
        completedCount: result.data.completedCount, totalCount: result.data.totalCount, todayTasks }, meta: result.meta }
    },

    async getTaskDetail(_userId, taskId) { return getStudentDetail(taskId) },

    async beginTaskMediaSession(_userId, taskId, itemId, operationId) {
      return repository.call<'beginTaskMediaSession', { taskId: string; itemId: string }, M3TaskMediaPlaybackView>(
        'learning-progress-command', 'beginTaskMediaSession', { taskId, itemId }, { operationId })
    },
    async reportTaskMediaHeartbeat(_userId, sessionId, playedFromMs, playedToMs, positionMs, operationId) {
      return repository.call<'reportTaskMediaHeartbeat', { sessionId: string; playedFromMs: number;
        playedToMs: number; positionMs: number }, M3TaskMediaHeartbeatView>(
        'learning-progress-command', 'reportTaskMediaHeartbeat',
        { sessionId, playedFromMs, playedToMs, positionMs }, { operationId })
    },
    async getTaskMediaPlayback(_userId, taskId, itemId) {
      return repository.call<'getTaskMediaPlayback', { taskId: string; itemId: string }, M3TaskMediaPlaybackView>(
        'student-task-query', 'getTaskMediaPlayback', { taskId, itemId })
    },
    async getSubmittedTaskMediaPlayback(_userId, taskId, itemId, submissionVersion) {
      return repository.call<'getSubmittedTaskMediaPlayback', { taskId: string; itemId: string;
        submissionVersion: number }, SubmittedTaskMediaPlaybackView>(
          'student-task-query', 'getSubmittedTaskMediaPlayback', { taskId, itemId, submissionVersion })
    },
    async beginTaskDubbingWork(_userId, taskId, itemId, operationId) {
      return repository.call<'beginTaskDubbingWork', { taskId: string; itemId: string }, TaskDubbingWorkView>(
        'student-work-command', 'beginTaskDubbingWork', { taskId, itemId },
        { expectedVersion: 0, operationId })
    },
    async sealTaskDubbingWork(_userId, workId, stagingFileId, expectedVersion, operationId) {
      return repository.call<'sealTaskDubbingWork', { workId: string; stagingFileId: string }, TaskDubbingWorkView>(
        'student-work-command', 'sealTaskDubbingWork', { workId, stagingFileId },
        { expectedVersion, operationId })
    },
    async listMyTaskDubbingWorks(_userId, offset, limit) {
      return repository.call<'listMyTaskDubbingWorks', { offset: number; limit: number }, MyTaskDubbingWorkPage>(
        'student-work-query', 'listMyTaskDubbingWorks', { offset, limit })
    },
    async getTaskDubbingPlayback(_userId, workId) {
      return repository.call<'getTaskDubbingPlayback', { workId: string }, MyTaskDubbingPlaybackView>(
        'student-work-query', 'getTaskDubbingPlayback', { workId })
    },

    async listStudentTasks(_userId) {
      const listed = await repository.call<'listMyTasks', { filters: object; page: { limit: number } }, PageWire<StudentListItemWire>>(
        'student-task-query', 'listMyTasks', { filters: {}, page: { limit: 100 } },
      )
      if (!listed.ok) return listed
      const details = await Promise.all(listed.data.items.map(item => getStudentDetail(item.taskId)))
      const failureResult = details.find((item): item is Extract<ServiceResult<TaskDetailView>, { ok: false }> => !item.ok)
      if (failureResult) return failureResult
      return { ok: true, data: details.map(item => (item as Extract<typeof item, { ok: true }>).data), meta: listed.meta }
    },

    async saveDraft(userId, command) {
      return submit(repository, userId, command, 'saveDraft')
    },

    async submitTask(userId, command) {
      return submit(repository, userId, command, 'submit')
    },

    async getTeacherTasks(_userId) {
      const result = await repository.call<'listTeacherTasks', { filters: object; page: { limit: number; cursor?: string } }, PageWire<TeacherTaskWire>>(
        'task-query', 'listTeacherTasks', { filters: {}, page: { limit: 100 } },
      )
      if (!result.ok) return result
      const taskItems = [...result.data.items]
      const seenTaskCursors = new Set<string>()
      let taskCursor = result.data.nextCursor
      for (let page = 1; taskCursor && page < 20; page++) {
        if (seenTaskCursors.has(taskCursor)) return failure('CONFLICT', '任务列表分页异常，请重试')
        seenTaskCursors.add(taskCursor)
        const next = await repository.call<'listTeacherTasks', { filters: object; page: { limit: number; cursor?: string } }, PageWire<TeacherTaskWire>>(
          'task-query', 'listTeacherTasks', { filters: {}, page: { limit: 100, cursor: taskCursor } },
        )
        if (!next.ok) return next
        taskItems.push(...next.data.items)
        taskCursor = next.data.nextCursor
      }
      if (taskCursor) return failure('CONFLICT', '任务列表超过当前可加载范围，请缩小查询范围')
      return mapResult(result, () => {
        const progressByTask: Record<string, number> = {}
        const pendingByTask: Record<string, number> = {}
        for (const item of taskItems) {
          progressByTask[item.taskId] = item.totalCount === 0 ? 0 : Math.round(item.completedCount * 100 / item.totalCount)
          pendingByTask[item.taskId] = item.pendingReviewCount
        }
        return {
          tasks: taskItems.map(mapTeacherTask),
          pendingCount: taskItems.reduce((sum, item) => sum + item.pendingReviewCount, 0),
          progressByTask,
          pendingByTask,
        }
      })
    },
    async listTeacherCheckItems(_userId, filters, limit, offset) {
      return repository.call<'listTeacherCheckItems', { filters: TeacherCheckFilters;
        page: { limit: number; offset: number } }, TeacherCheckPage>(
        'task-query', 'listTeacherCheckItems', { filters, page: { limit, offset } },
      )
    },
    async getNativeAdminAccess(_userId) {
      return repository.call<'getAccess', Record<string, never>, NativeAdminAccessView>(
        'native-admin-query', 'getAccess', {},
      )
    },
    async getNativeAdminOrganization(_userId) {
      return repository.call<'getOrganization', Record<string, never>, NativeAdminOrganizationView>(
        'native-admin-query', 'getOrganization', {},
      )
    },
    async updateNativeAdminOrganization(_userId, input, expectedVersion, operationId) {
      return repository.call<'updateOrganization', UpdateNativeAdminOrganizationInput,
        NativeAdminOrganizationView>('native-admin-management-command', 'updateOrganization', input,
          { expectedVersion, operationId })
    },
    async bindNativeAdminParentLink(_userId, input, operationId) {
      return repository.call<'bindParentLink', BindNativeAdminParentLinkInput,
        NativeAdminBoundParentLinkView>('native-admin-management-command', 'bindParentLink', input,
          { expectedVersion: 0, operationId })
    },
    async createNativeAdminUser(_userId, input, operationId) {
      return repository.call<'createUser', CreateNativeAdminUserInput, NativeAdminCreatedUserView>(
        'native-admin-management-command', 'createUser', input,
        { expectedVersion: 0, operationId })
    },
    async getNativeAdminOverview(_userId, range) {
      return repository.call<'getOverview', NativeAdminOverviewRange, NativeAdminOverviewView>(
        'native-admin-query', 'getOverview', range ?? defaultNativeAdminOverviewRange(),
      )
    },
    async listNativeAdminClasses(_userId, limit, offset, query = '') {
      return repository.call<'listClasses', { query: string; page: { limit: number; offset: number } }, NativeAdminClassPageView>(
        'native-admin-query', 'listClasses', { query, page: { limit, offset } },
      )
    },
    async listNativeAdminSelectionOptions(_userId, kind, classId, limit, offset, query = '') {
      return repository.call<'listSelectionOptions', { kind: NativeAdminSelectionKind; classId: string;
        query: string; page: { limit: number; offset: number } }, NativeAdminSelectionPageView>(
        'native-admin-query', 'listSelectionOptions', { kind, classId, query, page: { limit, offset } },
      )
    },
    async listNativeAdminUsers(_userId, classId, limit, offset, query = '', role = '', status = '') {
      return repository.call<'listUsers', { classId: string; query?: string; role?: NativeAdminUserRoleFilter;
        status?: NativeAdminUserStatusFilter;
        page: { limit: number; offset: number } }, NativeAdminUserPageView>(
        'native-admin-query', 'listUsers', { classId,
          ...(query ? { query } : {}), ...(role ? { role } : {}), ...(status ? { status } : {}),
          page: { limit, offset } },
      )
    },
    async listNativeAdminGrants(_userId, limit, offset, query = '') {
      return repository.call<'listGrants', { query: string; page: { limit: number; offset: number } }, NativeAdminGrantPageView>(
        'native-admin-query', 'listGrants', { query, page: { limit, offset } },
      )
    },
    async listNativeAdminGrantCandidates(_userId, limit, offset, query = '') {
      return repository.call<'listGrantCandidates', { query: string; page: { limit: number; offset: number } },
        NativeAdminGrantCandidatePageView>('native-admin-query', 'listGrantCandidates',
          { query, page: { limit, offset } })
    },
    async listNativeAdminAudit(_userId, limit, offset) {
      return repository.call<'listAudit', { page: { limit: number; offset: number } }, NativeAdminAuditPageView>(
        'native-admin-query', 'listAudit', { page: { limit, offset } },
      )
    },
    async getNativeAdminQuestionPreview(_userId, questionId) {
      return repository.call<'getQuestionPreview', { questionId: string }, NativeAdminQuestionPreviewView>(
        'native-admin-query', 'getQuestionPreview', { questionId },
      )
    },
    async getNativeAdminUserBindings(_userId, targetUserId) {
      return repository.call<'listUserBindings', { userId: string }, NativeAdminUserBindingsView>(
        'native-admin-query', 'listUserBindings', { userId: targetUserId },
      )
    },
    async setNativeAdminGrant(_userId, input, expectedGrantVersion, operationId) {
      return repository.call<'setGrant', NativeAdminGrantInput, NativeAdminGrantView>(
        'native-admin-command', 'setGrant', input, { expectedVersion: expectedGrantVersion, operationId },
      )
    },
    async listNativeAdminRecords(_userId, kind, limit, offset, filter = {}) {
      return repository.call<'listRecords', { kind: NativeAdminRecordKind;
        filter: NativeAdminRecordFilter; page: { limit: number; offset: number } }, NativeAdminRecordPageView>(
        'native-admin-query', 'listRecords', { kind, filter, page: { limit, offset } },
      )
    },
    async exportNativeAdminRecords(_userId, kind, filter = {}) {
      return repository.call<'exportRecords', { kind: 'tasks'; filter: NativeAdminRecordFilter }, NativeAdminRecordsExportView>(
        'native-admin-query', 'exportRecords', { kind, filter },
      )
    },
    async createNativeAdminClass(_userId, input, expectedVersion, operationId) {
      return repository.call<'createClass', CreateNativeAdminClassInput, NativeAdminClassMutationView>(
        'native-admin-management-command', 'createClass', input, { expectedVersion, operationId },
      )
    },
    async updateNativeAdminClass(_userId, input, expectedVersion, operationId) {
      return repository.call<'updateClass', UpdateNativeAdminClassInput, NativeAdminClassMutationView>(
        'native-admin-management-command', 'updateClass', input, { expectedVersion, operationId },
      )
    },
    async archiveNativeAdminClass(_userId, input, expectedVersion, destinationExpectedVersion, operationId) {
      return repository.call<'archiveClass', ArchiveNativeAdminClassInput & { destinationExpectedVersion: number | null }, NativeAdminClassArchiveView>(
        'native-admin-management-command', 'archiveClass', { ...input, destinationExpectedVersion },
        { expectedVersion, operationId },
      )
    },
    async assignNativeAdminTeacher(_userId, input, expectedVersion, operationId) {
      return repository.call<'assignTeacher', AssignNativeAdminTeacherInput, NativeAdminTeacherAssignmentView>(
        'native-admin-management-command', 'assignTeacher', input, { expectedVersion, operationId },
      )
    },
    async revokeNativeAdminTeacher(_userId, input, expectedVersion, operationId) {
      return repository.call<'revokeTeacher', RevokeNativeAdminTeacherInput, NativeAdminTeacherAssignmentView>(
        'native-admin-management-command', 'revokeTeacher', input,
        { expectedVersion, operationId },
      )
    },
    async updateNativeAdminUser(_userId, input, expectedVersion, operationId) {
      return repository.call<'updateUser', UpdateNativeAdminUserInput, NativeAdminUserMutationView>(
        'native-admin-management-command', 'updateUser', input, { expectedVersion, operationId },
      )
    },
    async disableNativeAdminUser(_userId, input, expectedVersion, operationId) {
      return repository.call<'disableUser', DisableNativeAdminUserInput, NativeAdminUserMutationView>(
        'native-admin-management-command', 'disableUser', input, { expectedVersion, operationId },
      )
    },
    async unbindNativeAdminUser(_userId, input, expectedVersion, operationId) {
      return repository.call<'unbindParentLink', UnbindNativeAdminUserInput, NativeAdminUnbindView>(
        'native-admin-management-command', 'unbindParentLink', input, { expectedVersion, operationId },
      )
    },
    async listNativeAdminDeletedWorks(_userId, studentId, limit, offset) {
      return repository.call<'listDeletedWorkDrafts', { studentId: string;
        page: { limit: number; offset: number } }, NativeAdminDeletedWorkPageView>(
        'native-admin-query', 'listDeletedWorkDrafts', { studentId, page: { limit, offset } },
      )
    },
    async restoreNativeAdminWork(_userId, input, expectedVersion, operationId) {
      return repository.call<'restoreWorkDraft', { studentId: string; workId: string;
        reason: string }, NativeAdminRestoredWorkView>(
        'native-admin-management-command', 'restoreWorkDraft', input,
        { expectedVersion, operationId },
      )
    },
    async saveNativeTextbookConfig(_userId, input, expectedVersion, operationId) {
      return repository.call<'saveTextbookConfig', SaveNativeTextbookConfigInput, NativeTextbookConfigView>(
        'native-admin-operations-command', 'saveTextbookConfig', input,
        { expectedVersion, operationId },
      )
    },
    async setNativeTextbookConfigStatus(_userId, input, expectedVersion, operationId) {
      return repository.call<'setTextbookConfigStatus', SetNativeTextbookConfigStatusInput, NativeTextbookConfigView>(
        'native-admin-operations-command', 'setTextbookConfigStatus', input,
        { expectedVersion, operationId },
      )
    },
    async setNativeQuestionStatus(_userId, input, expectedVersion, operationId) {
      return repository.call<'setQuestionStatus', SetNativeQuestionStatusInput, NativeQuestionStatusView>(
        'native-admin-operations-command', 'setQuestionStatus', input,
        { expectedVersion, operationId },
      )
    },
    async setNativeQuestionVisibility(_userId, input, expectedVersion, operationId) {
      return repository.call<'setQuestionVisibility', SetNativeQuestionVisibilityInput, NativeQuestionVisibilityView>(
        'native-admin-operations-command', 'setQuestionVisibility', input,
        { expectedVersion, operationId },
      )
    },
    async setNativeQuestionBatchStatus(_userId, input, operationId) {
      return repository.call<'setQuestionBatchStatus', SetNativeQuestionBatchStatusInput, NativeQuestionBatchStatusView>(
        'native-admin-operations-command', 'setQuestionBatchStatus', input,
        { expectedVersion: 1, operationId },
      )
    },
    async stopNativeManaged(_userId, input, expectedVersion, operationId) {
      return repository.call<'stopManaged', StopNativeManagedInput, NativeManagedStopView>(
        'native-admin-operations-command', 'stopManaged', input,
        { expectedVersion, operationId },
      )
    },
    async getNativeAdminMediaReview(_userId, mediaId) {
      return repository.call<'getMediaReviewSummary', { mediaId: string }, NativeAdminMediaReviewSummaryView>(
        'native-admin-query', 'getMediaReviewSummary', { mediaId },
      )
    },
    async getNativeAdminMediaPreview(_userId, mediaId) {
      return repository.call<'getMediaPreview', { mediaId: string }, NativeAdminMediaPreviewView>(
        'native-admin-query', 'getMediaPreview', { mediaId },
      )
    },
    async listNativeAdminMediaAudit(_userId, mediaId, limit, offset) {
      return repository.call<'listMediaAudit', { mediaId: string; page: { limit: number; offset: number } },
        NativeAdminMediaAuditPageView>('native-admin-query', 'listMediaAudit',
          { mediaId, page: { limit, offset } })
    },
    async reportNativeAdminMediaIssue(_userId, mediaId, reason, expectedVersion, operationId) {
      return repository.call<'reportMediaIssue', { mediaId: string; reason: string }, NativeAdminMediaActionView>(
        'native-admin-media-command', 'reportMediaIssue', { mediaId, reason },
        { expectedVersion, operationId },
      )
    },
    async reviewNativeAdminMedia(_userId, input, expectedVersion, operationId) {
      return repository.call<'reviewMedia', NativeAdminMediaReviewInput, NativeAdminMediaActionView>(
        'native-admin-media-command', 'reviewMedia', input,
        { expectedVersion, operationId },
      )
    },
    async publishNativeAdminMedia(_userId, mediaId, expectedVersion, operationId) {
      return repository.call<'publishMedia', { mediaId: string }, NativeAdminMediaActionView>(
        'native-admin-media-command', 'publishMedia', { mediaId },
        { expectedVersion, operationId },
      )
    },
    async unpublishNativeAdminMedia(_userId, mediaId, reason, expectedVersion, operationId) {
      return repository.call<'unpublishMedia', { mediaId: string; reason: string }, NativeAdminMediaActionView>(
        'native-admin-media-command', 'unpublishMedia', { mediaId, reason },
        { expectedVersion, operationId },
      )
    },
    async getTeacherWorkbench(_userId, date, classId) {
      return repository.call<'getTeacherWorkbench', { date: string; classId?: string }, TeacherWorkbenchView>(
        'task-query', 'getTeacherWorkbench', { date, ...(classId === undefined ? {} : { classId }) },
      )
    },
    async previewTeacherTask(_userId, taskId, version) {
      return repository.call<'previewTask', { taskId: string }, TeacherTaskPreviewView>('task-query', 'previewTask', { taskId }, { expectedVersion: version })
    },
    async getTeacherTaskForEdit(_userId, taskId) {
      return repository.call<'getTaskForEdit', { taskId: string }, TeacherTaskEditView>('task-query', 'getTaskForEdit', { taskId })
    },
    async updatePublishedTeacherTask(_userId, command, status, previousDueAt) {
      const draft = command.structuredDraft
      if (!draft || !command.taskId) return validationFailure('taskId', '请先选择任务')
      let payload: object
      if (status === 'scheduled') {
        const mapped = mapStructuredTaskDraft(draft)
        if (!mapped.ok) return mapped
        payload = { taskId: command.taskId, title: command.title.trim(), description: command.description.trim(), ...mapped.data }
      } else {
        payload = { taskId: command.taskId, description: command.description.trim(), teacherNote: draft.teacherNote ?? '', ...(Date.parse(draft.dueAt) === Date.parse(previousDueAt) ? {} : { dueAt: draft.dueAt }) }
      }
      return repository.call<'updatePublishedTask', object, { taskId: string; version: number }>('task-command', 'updatePublishedTask', payload, { operationId: command.operationId, expectedVersion: command.expectedVersion })
    },
    async updateTeacherTaskDescription(_userId, taskId, version, description, operationId) {
      return repository.call<'updatePublishedTask', { taskId: string; description: string }, { taskId: string; version: number }>('task-command', 'updatePublishedTask', { taskId, description }, { operationId, expectedVersion: version })
    },
    async recycleTeacherTask(_userId, taskId, version, reason, operationId) {
      return repository.call<'recycleTask', { taskId: string; reason: string }, { taskId: string }>('task-command', 'recycleTask', { taskId, reason }, { operationId, expectedVersion: version })
    },
    async deleteTeacherDraftTask(_userId, taskId, version, reason, operationId) {
      return repository.call<'deleteDraftTask', { taskId: string; reason: string },
        { taskId: string; deleted: true }>('task-command', 'deleteDraftTask',
        { taskId, reason }, { operationId, expectedVersion: version })
    },

    async getDraftOptions(_userId, nowIso, catalogMode) {
      const result = await repository.call<'getDraftOptions', { catalogMode?: 'selector' }, TaskDraftOptionsWire>(
        'task-query', 'getDraftOptions', catalogMode === undefined ? {} : { catalogMode },
      )
      if (!result.ok) return result
      const mapped = mapDraftOptions(result.data, nowIso)
      return mapped.ok && result.meta !== undefined ? { ...mapped, meta: result.meta } : mapped
    },

    async getCompletion(_userId, taskId) { return getCompletionRows(taskId) },

    async getReviewSubmission(_userId, submissionId) {
      return repository.call<'getSubmissionForReview', { submissionId: string }, TeacherReviewSubmissionView>('review-query', 'getSubmissionForReview', { submissionId })
    },

    async generateTeacherSuggestion(_userId, submissionId, operationId) {
      return repository.call<'generateSuggestion', { submissionId: string }, TeacherSuggestionView>(
        'teacher-suggestion-command', 'generateSuggestion', { submissionId }, { operationId })
    },

    async getTeacherSuggestion(_userId, submissionId, generationOperationId) {
      return repository.call<'getSuggestion', { submissionId: string; generationOperationId: string }, TeacherSuggestionStatusView>(
        'teacher-suggestion-command', 'getSuggestion', { submissionId, generationOperationId })
    },
    async getAutomaticTeacherSuggestion(_userId, submissionId) {
      return repository.call<'getAutomaticSuggestion', { submissionId: string }, TeacherSuggestionStatusView>(
        'teacher-suggestion-command', 'getAutomaticSuggestion', { submissionId })
    },

    async getTeacherTaskMediaReviewEvidence(_userId, submissionId, itemId) {
      return repository.call<'getTaskMediaReviewEvidence', { submissionId: string; itemId: string },
        TeacherTaskMediaReviewEvidenceView>('review-query', 'getTaskMediaReviewEvidence',
        { submissionId, itemId })
    },

    async previewBatchComment(_userId, taskId, submissionIds, comment) {
      return repository.call<'previewBatchComment', {
        taskId: string; filter: Record<string, never>;
        selection: { mode: 'ids'; submissionIds: string[] }; comment: string
      }, BatchCommentPreview>('review-query', 'previewBatchComment', {
        taskId, filter: {}, selection: { mode: 'ids', submissionIds: [...submissionIds] }, comment,
      })
    },

    async publishBatchComment(_userId, previewToken, previewVersion, textComment, operationId) {
      return repository.call<'publishBatchComment', {
        previewToken: string; previewVersion: number; textComment: string
      }, BatchCommentReceipt>('review-command', 'publishBatchComment', {
        previewToken, previewVersion, textComment,
      }, { operationId })
    },

    async listTeacherStudents(_userId, filters, cursor) {
      return repository.call<
        'listStudents',
        { filters: Readonly<{ classId?: string; keyword?: string; status: TeacherStudentStatusFilter }>; page: { limit: number; cursor?: string } },
        TeacherStudentPageWire
      >(
        'teacher-student-query',
        'listStudents',
        { filters, page: { limit: 20, ...(cursor === undefined ? {} : { cursor }) } },
      )
    },

    async importTeacherStudents(_userId, csvBase64, operationId) {
      return repository.call<'importTeacherStudents', { csvBase64: string }, TeacherStudentBulkImportView>(
        'teacher-student-import-command', 'importTeacherStudents', { csvBase64 }, { operationId },
      )
    },

    async getTeacherStudent(_userId, studentId) {
      return repository.call<'getStudent', { studentId: string }, TeacherStudentDetailWire>(
        'teacher-student-query',
        'getStudent',
        { studentId },
      )
    },

    async updateTeacherStudent(_userId, command) {
      return repository.call<'updateProfile', object, TeacherStudentMutationView>('teacher-student-command', 'updateProfile', {
        studentId: command.studentId, classId: command.classId, displayName: command.displayName,
        expectedMembershipVersion: command.expectedMembershipVersion, reason: command.reason,
      }, { operationId: command.operationId, expectedVersion: command.expectedUserVersion })
    },
    async setTeacherStudentStatus(_userId, command) {
      return repository.call<'setStatus', object, TeacherStudentMutationView>('teacher-student-command', 'setStatus', {
        studentId: command.studentId, classId: command.classId, status: command.status,
        expectedMembershipVersion: command.expectedMembershipVersion, expectedClassVersion: command.expectedClassVersion, reason: command.reason,
      }, { operationId: command.operationId, expectedVersion: command.expectedUserVersion })
    },
    async transferTeacherStudent(_userId, command) {
      return repository.call<'transfer', object, TeacherStudentMutationView>('teacher-student-command', 'transfer', {
        studentId: command.studentId, sourceClassId: command.sourceClassId, targetClassId: command.targetClassId,
        expectedMembershipVersion: command.expectedMembershipVersion, expectedTargetMembershipVersion: command.expectedTargetMembershipVersion,
        expectedSourceClassVersion: command.expectedSourceClassVersion, expectedTargetClassVersion: command.expectedTargetClassVersion, reason: command.reason,
      }, { operationId: command.operationId, expectedVersion: command.expectedUserVersion })
    },

    async publishClassroomTask(userId, command) {
      let draftTaskId = command.taskId ?? ''
      let draftVersion = command.expectedVersion
      if (!command.resumePublication) {
        const mappedDraft = mapStructuredTaskDraft(command.structuredDraft)
        if (!mappedDraft.ok) return mappedDraft
        const draft = await repository.call<'saveDraft', object, TaskDraftReceiptWire>('task-command', 'saveDraft', {
          title: command.title.trim(),
          description: command.description.trim(),
          ...(command.taskId === undefined ? {} : { taskId: command.taskId }),
          ...mappedDraft.data,
        }, { operationId: command.operationId, ...(command.taskId === undefined ? {} : { expectedVersion: command.expectedVersion }) })
        if (!draft.ok) return draft
        draftTaskId = draft.data.taskId
        draftVersion = draft.data.version
      } else if (!draftTaskId) return validationFailure('taskId', '未找到待继续发布的任务')
      let published: ServiceResult<TaskPublishReceiptWire>
      for (let attempt = 0; ; attempt += 1) {
        published = await repository.call<'publishTask', { taskId: string }, TaskPublishReceiptWire>(
          'task-command', 'publishTask', { taskId: draftTaskId },
          { operationId: command.operationId, expectedVersion: draftVersion },
        )
        if (!published.ok) return published
        if (published.data.status !== 'publishing') break
        if (attempt >= 9) return failure('SERVICE_UNAVAILABLE', '任务仍在发布中，请稍后点击发布继续完成')
      }
      return {
        ok: true,
        data: {
          id: published.data.taskId,
          title: command.title.trim(),
          deliveryType: 'classroom',
          status: published.data.status,
          creatorTeacherId: userId,
          classId: command.structuredDraft?.target.type === 'classes' ? command.structuredDraft.target.classIds[0] ?? '' : '',
          startsAt: command.structuredDraft?.startsAt ?? '',
          dueAt: command.structuredDraft?.dueAt ?? '',
          description: command.description.trim(),
          items: command.structuredDraft?.items.map(item => ({
            id: item.id,
            type: item.type,
            title: taskItemTitle(item.type),
            completionRule: completionRuleLabel(item.type, item.requiredCount),
          })) ?? [],
          version: published.data.version,
        },
        meta: published.meta,
      }
    },

    async saveTeacherTaskDraft(userId, command) {
      const mappedDraft = mapStructuredTaskDraft(command.structuredDraft)
      if (!mappedDraft.ok) return mappedDraft
      const result = await repository.call<'saveDraft', object, TaskDraftReceiptWire>('task-command', 'saveDraft', {
        title: command.title.trim(), description: command.description.trim(), ...(command.taskId === undefined ? {} : { taskId: command.taskId }), ...mappedDraft.data,
      }, { operationId: command.operationId, ...(command.taskId === undefined ? {} : { expectedVersion: command.expectedVersion }) })
      if (!result.ok) return result
      return { ok: true, data: {
        id: result.data.taskId, title: command.title.trim(), deliveryType: 'classroom', status: 'draft',
        creatorTeacherId: userId, classId: command.structuredDraft?.target.type === 'classes' ? command.structuredDraft.target.classIds[0] ?? '' : '',
        startsAt: command.structuredDraft?.startsAt ?? '', dueAt: command.structuredDraft?.dueAt ?? '',
        description: command.description.trim(), items: [], version: result.data.version,
      }, meta: result.meta }
    },

    async copyTeacherTaskSnapshot(_userId, sourceTaskId, sourceVersion, operationId) {
      const result = await repository.call<'copyTaskSnapshot', { sourceTaskId: string }, TaskDraftReceiptWire>(
        'task-command', 'copyTaskSnapshot', { sourceTaskId }, { expectedVersion: sourceVersion, operationId },
      )
      return result.ok ? { ok: true, data: { taskId: result.data.taskId, version: result.data.version }, meta: result.meta } : result
    },

    async beginReviewVoiceRecording(_userId, submissionId, operationId) {
      return repository.call<'beginReviewVoiceRecording', { submissionId: string }, ReviewVoiceDraftView>(
        'review-command', 'beginReviewVoiceRecording', { submissionId }, { operationId })
    },

    async sealReviewVoiceRecording(_userId, recordingId, stagingFileId, expectedVersion, operationId) {
      return repository.call<'sealReviewVoiceRecording', { recordingId: string; stagingFileId: string },
        ReviewVoiceDraftView>('review-command', 'sealReviewVoiceRecording',
        { recordingId, stagingFileId }, { expectedVersion, operationId })
    },

    async reviewSubmission(userId, command) {
      const completion = await getCompletionRows(command.taskId)
      if (!completion.ok) return completion
      const row = command.assignmentId
        ? completion.data.find(item => item.assignmentId === command.assignmentId)
        : completion.data.find(item => item.status === 'awaiting_review' && item.submissionId !== undefined)
      if (!row?.submissionId || row.submissionVersion === undefined) return withMeta(failure('FORBIDDEN', '当前提交不可点评'), completion)
      const target = await repository.call<'getSubmissionForReview', { submissionId: string }, ReviewSubmissionWire>(
        'review-query', 'getSubmissionForReview', { submissionId: row.submissionId },
      )
      if (!target.ok) return target
      const result = await repository.call<'publishReview', object, ReviewReceiptWire>('review-command', 'publishReview', {
        submissionId: row.submissionId,
        decision: command.decision,
        expectedSubmissionVersion: command.expectedVersion,
        ...(command.score === undefined ? {} : { score: command.score }),
        ...(command.itemScores === undefined ? {} : { itemScores: command.itemScores.map(item => ({ ...item })) }),
        textComment: command.comment.trim(),
        ...(command.aiSuggestionId ? { aiSuggestionId: command.aiSuggestionId } : {}),
        ...(command.voiceRecordingId === undefined ? {} : { voiceRecordingId: command.voiceRecordingId }),
        ...(command.decision === 'returned' ? { returnReason: command.comment.trim() } : {}),
        ...(command.overrideReason?.trim() ? { overrideReason: command.overrideReason.trim() } : {}),
      }, { operationId: command.operationId, expectedVersion: target.data.assignmentVersion })
      if (!result.ok) return result
      const refreshed = await repository.call<'getSubmissionForReview', { submissionId: string }, ReviewSubmissionWire>(
        'review-query', 'getSubmissionForReview', { submissionId: row.submissionId },
      )
      if (refreshed.ok && refreshed.data.feedback !== null) {
        return { ok: true, data: mapFeedback(refreshed.data.feedback, row.assignmentId, row.submissionId), meta: result.meta }
      }
      return {
        ok: true,
        data: {
        id: result.data.feedbackId,
        assignmentId: row.assignmentId,
        submissionId: result.data.submissionId,
        teacherId: userId,
        decision: result.data.decision,
        ...(command.score === undefined ? {} : { score: command.score }),
        ...(command.itemScores === undefined ? {} : { itemScores: command.itemScores.map(item => ({ ...item })) }),
        textComment: command.comment.trim(),
        ...(command.decision === 'returned' ? { returnReason: command.comment.trim() } : {}),
        publishedAt: new Date().toISOString(),
        },
        meta: result.meta,
      }
    },

    async listParentChildren(_userId) {
      const result = await repository.call<'listChildren', Record<string, never>, ParentChildWire[]>(
        'parent-query', 'listChildren', {},
      )
      return mapResult(result, items => items.map(item => ({
        linkId: item.linkId,
        linkVersion: item.linkVersion,
        childId: item.childId,
        displayName: item.displayName,
        displayNameMasked: item.displayNameMasked,
        ...(item.studentNumber === null ? {} : { studentNumber: item.studentNumber }),
        ...(item.classId === null ? {} : { classId: item.classId }),
        ...(item.className === null ? {} : { className: item.className }),
        confirmedAt: item.confirmedAt ?? '',
      })))
    },

    async bindChild(_userId, command) {
      const result = await repository.call<'bindChild', { studentNumber: string; code: string }, BoundChildWire>(
        'relationship-command', 'bindChild',
        { studentNumber: command.studentNumber.trim(), code: command.code.trim() },
        { operationId: command.operationId },
      )
      return mapResult(result, value => ({
        linkId: value.id,
        linkVersion: value.version,
        childId: value.child.id,
        displayName: value.child.displayName,
        displayNameMasked: value.child.displayNameMasked,
        ...(value.child.studentNumber === undefined ? {} : { studentNumber: value.child.studentNumber }),
        ...(value.child.classIds?.[0] === undefined ? {} : { classId: value.child.classIds[0] }),
        confirmedAt: value.confirmedAt,
      }))
    },

    async unbindChild(_userId, command) {
      return repository.call<'unbindChild', { childId: string; reason: string }, null>(
        'relationship-command', 'unbindChild',
        { childId: command.childId, reason: command.reason.trim() },
        { operationId: command.operationId, expectedVersion: command.expectedVersion },
      )
    },

    async getTeacherStats(_userId, filters) {
      return repository.call<'teacherReport', { filters: StatsFilters }, StatsView>(
        'learning-stats-query', 'teacherReport', { filters },
      )
    },

    async getParentStats(_userId, childId, filters) {
      return repository.call<'parentReport', { childId: string; filters: StatsFilters }, StatsView>(
        'learning-stats-query', 'parentReport', { childId, filters },
      )
    },

    async exportTeacherStats(_userId, filters) {
      return repository.call<'exportTeacherCsv', { filters: StatsFilters }, StatsExport>(
        'learning-stats-query', 'exportTeacherCsv', { filters },
      )
    },

    async getParentHome(userId) {
      const child = activeChildId()
      if (!child.ok) return child
      const result = await repository.call<'getHome', { childId: string }, ParentHomeWire>('parent-query', 'getHome', { childId: child.data })
      if (!result.ok) return result
      const details = await Promise.all(result.data.recentTasks.map(async item => {
        const detail = await repository.call<'getChildTask', { childId: string; taskId: string }, ParentTaskWire>(
          'parent-query', 'getChildTask', { childId: result.data.childId, taskId: item.taskId },
        )
        return detail.ok ? mapParentTask(detail.data, item) : mapParentSummary(item, result.data.childId)
      }))
      return {
        ok: true,
        data: {
          user: currentContextUser(userId, 'parent'),
          child: {
            id: result.data.childId,
            displayName: result.data.child?.displayName ?? result.data.childId,
            role: 'student',
            ...(result.data.child?.classId === null || result.data.child?.classId === undefined ? {} : { classId: result.data.child.classId }),
            ...(result.data.child?.className === null || result.data.child?.className === undefined ? {} : { className: result.data.child.className }),
          },
          tasks: details,
          pendingTaskCount: Number.isSafeInteger(result.data.pendingTaskCount)
            ? result.data.pendingTaskCount : null,
          weeklyAssignedCount: Number.isSafeInteger(result.data.weeklyAssignedCount)
            ? result.data.weeklyAssignedCount! : null,
          weeklyCompletedCount: Number.isSafeInteger(result.data.weeklyCompletedCount)
            ? result.data.weeklyCompletedCount! : null,
          overdueTaskCount: Number.isSafeInteger(result.data.overdueTaskCount)
            ? result.data.overdueTaskCount! : null,
          recentFeedback: result.data.recentFeedback.map(item => ({
            feedbackId: item.feedbackId, taskId: item.taskId,
            taskTitle: item.taskTitle, teacherName: item.teacherName ?? null,
            textComment: item.textComment ?? null, publishedAt: item.publishedAt,
          })),
        },
        meta: result.meta,
      }
    },

    async listParentTasks(_userId, filters, page) {
      const child = activeChildId()
      if (!child.ok) return child
      type ParentTaskWirePage = { items: ParentTaskListWire[]; total: number; nextCursor: string | null }
      const callList = (queryFilters: ParentTaskListFilters | object,
        queryPage: { limit: number; cursor?: string }) => repository.call<'listChildTasks', {
        childId: string; filters: object;
        page: { limit: number; cursor?: string }
      }, ParentTaskWirePage>('parent-query', 'listChildTasks',
        { childId: child.data, filters: queryFilters, page: queryPage })
      if (!isLegacyParentTaskCursor(page.cursor)) {
        const result = await callList(filters, page)
        if (result.ok) return mapResult(result, value => ({
          items: value.items.map(parentTaskListItem), total: value.total,
          nextCursor: value.nextCursor }))
        if (!isUnsupportedParentTaskFilter(result.error)) return result
      }
      const items: ParentTaskListView[] = []
      const seenCursors = new Set<string>()
      let cursor: string | undefined
      for (let batch = 0; batch < 10; batch += 1) {
        const result = await callList({}, { limit: 100, ...(cursor ? { cursor } : {}) })
        if (!result.ok) return result
        items.push(...result.data.items.map(parentTaskListItem))
        const nextCursor = result.data.nextCursor
        if (nextCursor === null) {
          const localPage = legacyParentTaskPage(items, filters, page)
          return localPage === null
            ? failure('VALIDATION_ERROR', '任务分页位置无效，请重新进入孩子任务')
            : { ok: true, data: localPage, ...(result.meta === undefined ? {} : { meta: result.meta }) }
        }
        if (seenCursors.has(nextCursor)) break
        seenCursors.add(nextCursor)
        cursor = nextCursor
      }
      return failure('SERVICE_UNAVAILABLE', '孩子任务较多，当前列表服务尚未同步，请稍后重试')
    },

    async getParentTask(_userId, taskId) {
      const child = activeChildId()
      if (!child.ok) return child
      const result = await repository.call<'getChildTask', { childId: string; taskId: string }, ParentTaskWire>(
        'parent-query', 'getChildTask', { childId: child.data, taskId },
      )
      return mapResult(result, value => mapParentTask(value))
    },

    async getParentFeedback(_userId, taskId) {
      const child = activeChildId()
      if (!child.ok) return child
      const task = await repository.call<'getChildTask', { childId: string; taskId: string }, ParentTaskWire>(
        'parent-query', 'getChildTask', { childId: child.data, taskId },
      )
      if (!task.ok) return task
      if (task.data.feedback === null) return withMeta(failure('NOT_FOUND', '老师暂未发布反馈'), task)
      const result = await repository.call<'getFeedback', { childId: string; feedbackId: string }, FeedbackDetailWire>(
        'parent-query', 'getFeedback', { childId: child.data, feedbackId: task.data.feedback.id },
      )
      return mapResult(result, value => mapFeedback(
        { id: value.feedbackId, ...value.feedback },
        `asn_${value.taskId}_${value.childId}`,
        value.submission.id,
      ))
    },

    async getParentRecordingPlayback(_userId, input) {
      return repository.call<'getRecordingPlayback', typeof input, ParentRecordingPlaybackView>(
        'parent-query', 'getRecordingPlayback', { ...input },
      )
    },
    async getParentFeedbackVoicePlayback(_userId, input) {
      return repository.call<'getChildFeedbackVoicePlayback', typeof input, ParentFeedbackVoicePlaybackView>(
        'parent-query', 'getChildFeedbackVoicePlayback', { ...input },
      )
    },
    async getParentTaskMediaPlayback(_userId, input) {
      return repository.call<'getTaskMediaPlayback', typeof input, ParentTaskMediaPlaybackView>(
        'parent-query', 'getTaskMediaPlayback', { ...input },
      )
    },

    async listReadingResources(_userId) {
      return repository.call<'listReadingResources', Record<string, never>, ReadingListItem[]>(
        'content-query', 'listReadingResources', {},
      )
    },

    async getMyClass(_userId) {
      return repository.call<'getMyClass', Record<string, never>, StudentClassView>(
        'content-query', 'getMyClass', {},
      )
    },

    async listSchoolQuestions(_userId, filters, limit, offset) {
      return repository.call<'listSchoolQuestions', { filters: SchoolQuestionFilters; page: { limit: number; offset: number } }, SchoolQuestionPage>(
        'content-query', 'listSchoolQuestions', { filters, page: { limit, offset } },
      )
    },

    async listSchoolQuestionFacets(_userId, targetClassIds) {
      return repository.call<'listSchoolQuestionFacets', { targetClassIds?: string[] }, SchoolQuestionFacet[]>(
        'content-query', 'listSchoolQuestionFacets', targetClassIds === undefined ? {} : { targetClassIds },
      )
    },

    async getSchoolQuestion(_userId, resourceId, targetClassIds) {
      return repository.call<'getSchoolQuestion', { resourceId: string; targetClassIds?: string[] }, SchoolQuestionDetail>(
        'content-query', 'getSchoolQuestion', { resourceId, ...(targetClassIds === undefined ? {} : { targetClassIds }) },
      )
    },

    async getTeacherTextbookCenterSettings(_userId) {
      return repository.call<'getCenterSettings', Record<string, never>, TextbookCenterLayout>(
        'teacher-textbook-query', 'getCenterSettings', {},
      )
    },

    async listTeacherTextbookClasses(_userId) {
      return repository.call<'listClasses', Record<string, never>, TeacherTextbookClass[]>(
        'teacher-textbook-query', 'listClasses', {},
      )
    },

    async getTeacherTextbookClass(_userId, classId) {
      return repository.call<'getClass', { classId: string }, TeacherTextbookClass>(
        'teacher-textbook-query', 'getClass', { classId },
      )
    },

    async listSynchronizedTextbooks(_userId, filters, limit, offset, targetClassId) {
      return repository.call<'listTextbooks', { filters: TextbookFilters; page: { limit: number; offset: number }; targetClassId?: string }, TextbookPage>(
        'teacher-textbook-query', 'listTextbooks', { filters, page: { limit, offset },
          ...(targetClassId === undefined ? {} : { targetClassId }) },
      )
    },

    async listSynchronizedTextbookFacets(_userId, filters, targetClassId) {
      return repository.call<'listTextbookFacets', { filters: TextbookFilters; targetClassId?: string }, TextbookFacetValues>(
        'teacher-textbook-query', 'listTextbookFacets', { filters,
          ...(targetClassId === undefined ? {} : { targetClassId }) },
      )
    },

    async getSynchronizedTextbook(_userId, textbookId, targetClassId) {
      return repository.call<'getTextbook', { textbookId: string; targetClassId?: string }, TextbookSummary>(
        'teacher-textbook-query', 'getTextbook', { textbookId,
          ...(targetClassId === undefined ? {} : { targetClassId }) },
      )
    },

    async saveClassTextbooks(_userId, classId, textbooks, note, expectedVersion, operationId, publish) {
      return repository.call<'saveClassTextbooks' | 'publishClassTextbooks', {
        classId: string; textbooks: ClassTextbookItem[]; note: string }, ClassTextbookConfig>(
        'teacher-textbook-command', publish ? 'publishClassTextbooks' : 'saveClassTextbooks',
        { classId, textbooks, note }, { expectedVersion, operationId },
      )
    },

    async listRecordingPrompts(_userId, targetClassIds, keyword, limit, offset, filters) {
      return repository.call<'listPrompts', object, RecordingPromptPage>('task-recording-query', 'listPrompts',
        { ...(targetClassIds === undefined ? {} : { targetClassIds }), ...(keyword.trim() ? { keyword: keyword.trim() } : {}),
          ...(filters?.grade ? { grade: filters.grade } : {}), ...(filters?.unit ? { unit: filters.unit } : {}),
          page: { limit, offset } })
    },
    async listRecordingPromptFacets(_userId, targetClassIds) {
      return repository.call<'listPromptFacets', { targetClassIds?: string[] }, RecordingPromptFacet[]>(
        'task-recording-query', 'listPromptFacets', targetClassIds === undefined ? {} : { targetClassIds })
    },
    async getRecordingPrompt(_userId, promptId, targetClassIds) {
      return repository.call<'getPrompt', object, RecordingPromptView>('task-recording-query', 'getPrompt',
        { promptId, ...(targetClassIds === undefined ? {} : { targetClassIds }) })
    },
    async beginTaskRecording(_userId, taskId, itemId, operationId) {
      return repository.call<'begin', object, TaskRecordingView>('task-recording-command', 'begin',
        { taskId, itemId }, { operationId })
    },
    async submitTaskRecording(_userId, recordingId, stagingFileId, expectedVersion, operationId) {
      return repository.call<'submit', object, TaskRecordingView>('task-recording-command', 'submit',
        { recordingId, stagingFileId }, { operationId, expectedVersion })
    },
    async listTaskRecordings(_userId, taskId, itemId) {
      return repository.call<'listRound', object, TaskRecordingView[]>('task-recording-query', 'listRound',
        { taskId, itemId })
    },
    async getTaskRecordingPlayback(_userId, recordingId) {
      return repository.call<'getPlayback', object, TaskRecordingPlayback>('task-recording-query', 'getPlayback',
        { recordingId })
    },
    async getTaskRecordingMediaState(_userId, recordingId) {
      return repository.call<'getMediaState', object, TaskRecordingMediaState>('task-recording-query', 'getMediaState',
        { recordingId })
    },
    async beginPronunciationRecording(_userId, source, operationId) {
      return repository.call<'beginRecording', object, PronunciationRecordingDraft>(
        'pronunciation-command', 'beginRecording', { source }, { operationId })
    },
    async sealPronunciationRecording(_userId, recordingId, stagingFileId, expectedVersion, operationId) {
      return repository.call<'sealRecording', object, SealedPronunciationRecording>(
        'pronunciation-command', 'sealRecording', { recordingId, stagingFileId }, { operationId, expectedVersion })
    },
    async beginPronunciationScore(_userId, recordingId, expectedVersion, operationId) {
      return repository.call<'beginScore', object, PronunciationScoreView>(
        'pronunciation-command', 'beginScore', { recordingId }, { operationId, expectedVersion })
    },
    async getPronunciationScore(_userId, scoreId) {
      return repository.call<'getScore', object, PronunciationScoreView>(
        'pronunciation-query', 'getScore', { scoreId })
    },
    async listPronunciationAttempts(_userId, source) {
      return repository.call<'listAttempts', object, PronunciationScoreView[]>(
        'pronunciation-query', 'listAttempts', { source })
    },
    async listMyPronunciationWorks(_userId, cursor, limit) {
      return repository.call<'listMyWorks', object, MyPronunciationWorkPage>(
        'pronunciation-query', 'listMyWorks', { cursor, limit })
    },
    async getMyPronunciationPlayback(_userId, recordingId) {
      return repository.call<'getMyPlayback', object, MyPronunciationPlayback>(
        'pronunciation-query', 'getMyPlayback', { recordingId })
    },
    async getTeacherPronunciationEvidence(_userId, input) {
      return repository.call<'getTeacherEvidence', object, TeacherPronunciationEvidence>(
        'pronunciation-query', 'getTeacherEvidence', { ...input })
    },
    async getParentPronunciationEvidence(_userId, input) {
      return repository.call<'getParentEvidence', object, ParentPronunciationEvidence>(
        'pronunciation-query', 'getParentEvidence', { ...input })
    },
    async listParentPronunciationEvidence(_userId, input) {
      return repository.call<'listParentEvidence', object, ParentPronunciationEvidencePage>(
        'pronunciation-query', 'listParentEvidence', { ...input })
    },
    async listTaskCatalogResources(_userId, filters, limit, offset) {
      return repository.call<'listTaskCatalogResources', { filters: TaskCatalogFilters; page: { limit: number; offset: number } }, TaskCatalogPage>(
        'content-query', 'listTaskCatalogResources', { filters, page: { limit, offset } },
      )
    },
    async listStudentCatalog(_userId, filters, limit, offset) {
      return repository.call<'listStudentCatalog', { filters: StudentCatalogFilters; page: { limit: number; offset: number } }, StudentCatalogPage>(
        'content-query', 'listStudentCatalog', { filters, page: { limit, offset } },
      )
    },
    async listStudentCatalogFacets(_userId, type, category) {
      return repository.call<'listStudentCatalogFacets', { type: StudentCatalogFilters['type']; category?: StudentCatalogFilters['category'] }, StudentCatalogFacet[]>(
        'content-query', 'listStudentCatalogFacets', { type, ...(category === undefined ? {} : { category }) },
      )
    },

    async listTaskCatalogFacets(_userId, type, targetClassIds, category) {
      return repository.call<'listTaskCatalogFacets', { type: TaskCatalogFilters['type']; targetClassIds?: string[];
        category?: TaskCatalogFilters['category'] }, TaskCatalogFacet[]>(
        'content-query', 'listTaskCatalogFacets', { type, ...(targetClassIds === undefined ? {} : { targetClassIds }),
          ...(category === undefined ? {} : { category }) },
      )
    },

    async getTaskCatalogResource(_userId, resourceId, targetClassIds) {
      return repository.call<'getTaskCatalogResource', { resourceId: string; targetClassIds?: string[] }, TaskCatalogListItem>(
        'content-query', 'getTaskCatalogResource', { resourceId, ...(targetClassIds === undefined ? {} : { targetClassIds }) },
      )
    },

    async listTeacherAssets(_userId, filters, limit, offset) {
      return repository.call<'listTeacherAssets', { filters: TeacherAssetFilters;
        page: { limit: number; offset: number } }, TeacherAssetPage>(
        'content-query', 'listTeacherAssets', { filters, page: { limit, offset } })
    },
    async listTeacherAssetFacets(_userId, kind, targetClassIds) {
      return repository.call<'listTeacherAssetFacets', { kind: TeacherAssetFilters['kind'];
        targetClassIds?: string[] }, TeacherAssetFacet[]>('content-query', 'listTeacherAssetFacets',
        { kind, ...(targetClassIds === undefined ? {} : { targetClassIds }) })
    },
    async previewTeacherAsset(_userId, resourceId, targetClassIds) {
      return repository.call<'previewTeacherAsset', { resourceId: string;
        targetClassIds?: string[] }, TeacherAssetPreview>(
        'content-query', 'previewTeacherAsset', { resourceId,
          ...(targetClassIds === undefined ? {} : { targetClassIds }) })
    },
    async listMyVideos(_userId) {
      const result = await repository.call<'privateVideoList', Record<string, never>, { items: TeacherPrivateVideo[] }>(
        'task-command', 'privateVideoList', {})
      return mapResult(result, data => data.items)
    },
    async getMyVideoAvailability(_userId) {
      return repository.call<'privateVideoAvailability', Record<string, never>, { enabled: boolean }>(
        'task-command', 'privateVideoAvailability', {})
    },
    async getMyVideo(_userId, id) {
      return repository.call<'privateVideoGet', { id: string }, TeacherPrivateVideoDetail>(
        'task-command', 'privateVideoGet', { id })
    },
    async saveMyVideo(_userId, title, questions, id, expectedVersion, operationId) {
      return repository.call<'privateVideoSave', { title: string; questions: TeacherVideoQuestion[];
        id?: string; expectedVersion?: number }, TeacherPrivateVideo>(
        'task-command', 'privateVideoSave', { title, questions,
          ...(id === undefined ? {} : { id }),
          ...(expectedVersion === undefined ? {} : { expectedVersion }) },
        { operationId })
    },
    async beginMyVideoUpload(_userId, id, expectedVersion) {
      return repository.call<'privateVideoBeginUpload', { id: string; expectedVersion: number }, TeacherPrivateVideo>(
        'task-command', 'privateVideoBeginUpload', { id, expectedVersion })
    },
    async sealMyVideo(_userId, id, expectedVersion, stagingFileId) {
      return repository.call<'privateVideoSeal', { id: string; expectedVersion: number; stagingFileId: string }, TeacherPrivateVideo>(
        'task-command', 'privateVideoSeal', { id, expectedVersion, stagingFileId })
    },
    async retryMyVideoProcessing(_userId, id, expectedVersion) {
      return repository.call<'privateVideoRetryProcessing', { id: string; expectedVersion: number }, TeacherPrivateVideo>(
        'task-command', 'privateVideoRetryProcessing', { id, expectedVersion })
    },
    async publishMyVideo(_userId, id, expectedVersion) {
      return repository.call<'privateVideoPublish', { id: string; expectedVersion: number }, TeacherPrivateVideo>(
        'task-command', 'privateVideoPublish', { id, expectedVersion })
    },
    async withdrawMyVideo(_userId, id, expectedVersion) {
      return repository.call<'privateVideoWithdraw', { id: string; expectedVersion: number }, TeacherPrivateVideo>(
        'task-command', 'privateVideoWithdraw', { id, expectedVersion })
    },

    async saveActivityDraft(_userId, draft, expectedVersion, operationId) {
      return repository.call<'saveDraft', ActivityDraftInput, ActivityView>(
        'activity-command', 'saveDraft', draft, { expectedVersion, operationId },
      )
    },

    async publishActivity(_userId, activityId, expectedVersion, operationId) {
      return repository.call<'publish', { activityId: string }, ActivityView>(
        'activity-command', 'publish', { activityId }, { expectedVersion, operationId },
      )
    },
    async closeActivity(_userId, activityId, expectedVersion, reason, operationId) {
      return repository.call<'close', { activityId: string; reason: string }, ActivityView>(
        'activity-command', 'close', { activityId, reason }, { expectedVersion, operationId },
      )
    },
    async deleteActivityDraft(_userId, activityId, expectedVersion, reason, operationId) {
      return repository.call<'deleteDraft', { activityId: string; reason: string }, ActivityView>(
        'activity-command', 'deleteDraft', { activityId, reason }, { expectedVersion, operationId },
      )
    },
    async recycleActivity(_userId, activityId, expectedVersion, reason, operationId) {
      return repository.call<'recycle', { activityId: string; reason: string }, ActivityView>(
        'activity-command', 'recycle', { activityId, reason }, { expectedVersion, operationId },
      )
    },
    async addActivityFutureRestDay(_userId, activityId, date, reason, expectedVersion, operationId) {
      return repository.call<'addFutureRestDay', { activityId: string; date: string; reason: string }, ActivityView>(
        'activity-command', 'addFutureRestDay', { activityId, date, reason }, { expectedVersion, operationId },
      )
    },

    async listTeacherActivities(_userId) {
      return repository.call<'listForTeacher', Record<string, never>, ActivityView[]>(
        'activity-query', 'listForTeacher', {},
      )
    },
    async getTeacherActivityProgress(_userId, activityId, date, limit, offset, keyword, completion) {
      return repository.call<'getTeacherProgress', { activityId: string; date: string;
        page: { limit: number; offset: number }; keyword?: string; completion?: 'all' | 'complete' | 'incomplete' },
        TeacherActivityProgressView>('activity-query', 'getTeacherProgress',
        { activityId, date, page: { limit, offset }, ...(keyword ? { keyword } : {}),
          ...(completion && completion !== 'all' ? { completion } : {}) })
    },

    async listStudentActivities(_userId) {
      return repository.call<'listForStudent', Record<string, never>, ActivityView[]>(
        'activity-query', 'listForStudent', {},
      )
    },

    async getStudentActivity(_userId, activityId) {
      return repository.call<'getForStudent', { activityId: string }, ActivityView>(
        'activity-query', 'getForStudent', { activityId },
      )
    },

    async getMyActivityDay(_userId, activityId, date) {
      return repository.call<'getMyDay', { activityId: string; date: string }, ActivityDayView>(
        'activity-query', 'getMyDay', { activityId, date },
      )
    },

    async setActivityOverride(_userId, input, expectedVersion, operationId) {
      return repository.call<'setOverride', typeof input, ActivityOverrideView>(
        'activity-command', 'setOverride', input, { expectedVersion, operationId },
      )
    },

    async getActivityOverrideForTeacher(_userId, activityId, studentId, date) {
      return repository.call<'getOverrideForTeacher', { activityId: string; studentId: string; date: string }, ActivityOverrideState>(
        'activity-query', 'getOverrideForTeacher', { activityId, studentId, date },
      )
    },

    async getActivityLeaderboard(_userId, activityId) {
      return repository.call<'getLeaderboard', { activityId: string }, ActivityLeaderboardView>(
        'activity-query', 'getLeaderboard', { activityId },
      )
    },

    async getReadingResource(_userId, resourceId) {
      return repository.call<'getReadingResource', { resourceId: string }, ReadingResource>(
        'content-query', 'getReadingResource', { resourceId },
      )
    },

    async getReadingPronunciationSegments(_userId, resourceId) {
      return repository.call<'getReadingPronunciationSegments', { resourceId: string }, ReadingPronunciationSegmentsView>(
        'content-query', 'getReadingPronunciationSegments', { resourceId },
      )
    },
    async getReadingAudioMap(_userId, resourceId, chapterId) {
      return repository.call<'getReadingAudioMap', { resourceId: string; chapterId: string }, ReadingAudioMapView>(
        'content-query', 'getReadingAudioMap', { resourceId, chapterId },
      )
    },

    async listVocabularyPacks(_userId) {
      return repository.call<'listVocabularyPacks', Record<string, never>, VocabularyPack[]>(
        'content-query', 'listVocabularyPacks', {},
      )
    },

    async getVocabularyPack(_userId, resourceId) {
      return repository.call<'getVocabularyPack', { resourceId: string }, VocabularyPack>(
        'content-query', 'getVocabularyPack', { resourceId },
      )
    },
    async getHistoricalTaskLearning(_userId, taskId, itemId) {
      return repository.call<'getHistoricalTaskLearning',
        { taskId: string; itemId: string }, HistoricalTaskLearningView>(
          'content-query', 'getHistoricalTaskLearning', { taskId, itemId },
        )
    },

    async getReadingProgress(_userId, resourceId) {
      return repository.call<'getReadingProgress', { resourceId: string }, ReadingProgress | null>(
        'learning-progress-query', 'getReadingProgress', { resourceId },
      )
    },

    async saveReadingProgress(_userId, command) {
      return repository.call<'saveReadingProgress', object, ReadingProgress>(
        'learning-progress-command', 'saveReadingProgress', {
          resourceId: command.resourceId,
          chapterId: command.chapterId,
          pageId: command.pageId,
          pageNumber: command.pageNumber,
          favorite: command.favorite,
        }, {
          operationId: command.operationId,
          ...(command.expectedVersion === 0 ? {} : { expectedVersion: command.expectedVersion }),
        },
      )
    },

    async getVocabularyProgress(_userId, packId) {
      return repository.call<'getVocabularyProgress', { packId: string }, VocabularyProgress | null>(
        'learning-progress-query', 'getVocabularyProgress', { packId },
      )
    },

    async getWordAttemptState(_userId, scope) {
      return repository.call<'getWordAttemptState', VocabularyAnswerScope, VocabularyAttemptState>(
        'vocabulary-evidence-query', 'getWordAttemptState', scope,
      )
    },

    async getPackAttemptSummary(_userId, scope) {
      return repository.call<'getPackAttemptSummary', VocabularyPackScope, VocabularyPackAttemptSummary>(
        'vocabulary-evidence-query', 'getPackAttemptSummary', scope,
      )
    },

    async submitWordAnswer(_userId, input, expectedVersion, operationId) {
      return repository.call<'submitWordAnswer', VocabularyAnswerInput, VocabularyAttemptView>(
        'vocabulary-evidence-command', 'submitWordAnswer', input, { expectedVersion, operationId },
      )
    },

    async listWorkMaterials(_userId) {
      return repository.call<'listMaterials', Record<string, never>, WorkMaterial[]>(
        'student-work-query', 'listMaterials', {},
      )
    },
    async searchWorkMaterials(_userId, keyword, limit, offset, filters = {}) {
      return repository.call<'searchMaterials', { keyword: string; offset: number; limit: number } & WorkMaterialFilters, WorkMaterialPage>(
        'student-work-query', 'searchMaterials', { keyword, offset, limit,
          ...(filters.grade ? { grade: filters.grade } : {}),
          ...(filters.textbook ? { textbook: filters.textbook } : {}),
          ...(filters.unit ? { unit: filters.unit } : {}) },
      )
    },
    async listWorkMaterialFacets(_userId) {
      return repository.call<'listMaterialFacets', Record<string, never>, WorkMaterialFacet[]>(
        'student-work-query', 'listMaterialFacets', {},
      )
    },
    async getWorkMaterial(_userId, materialId) {
      return repository.call<'getMaterial', { materialId: string }, WorkMaterial>(
        'student-work-query', 'getMaterial', { materialId },
      )
    },
    async beginWorkDraft(_userId, materialId, operationId) {
      return repository.call<'beginDraft', { materialId: string }, StudentWork>(
        'student-work-command', 'beginDraft', { materialId }, { operationId, expectedVersion: 0 },
      )
    },
    async submitWork(_userId, input, expectedVersion, operationId) {
      return repository.call<'submitWork', typeof input, StudentWork>(
        'student-work-command', 'submitWork', input, { operationId, expectedVersion },
      )
    },
    async deleteWorkDraft(_userId, workId, expectedVersion, operationId) {
      return repository.call<'deleteDraft', { workId: string }, StudentWork>(
        'student-work-command', 'deleteDraft', { workId }, { operationId, expectedVersion },
      )
    },
    async listMyWorks(_userId) {
      return repository.call<'listMine', Record<string, never>, StudentWork[]>(
        'student-work-query', 'listMine', {},
      )
    },
    async getWorkPlayback(_userId, workId) {
      return repository.call<'getPlayback', { workId: string }, WorkPlayback>(
        'student-work-query', 'getPlayback', { workId },
      )
    },
    async getMaterialPlayback(_userId, materialId) {
      return repository.call<'getMaterialPlayback', { materialId: string }, MaterialPlayback>(
        'student-work-query', 'getMaterialPlayback', { materialId },
      )
    },
    async listPhonicsCourses(_userId) {
      return repository.call<'listCourses', Record<string, never>, PhonicsCourseListItem[]>(
        'phonics-query', 'listCourses', {},
      )
    },
    async getPhonicsCourse(_userId, courseId) {
      return repository.call<'getCourse', { courseId: string }, PhonicsCourseView>(
        'phonics-query', 'getCourse', { courseId },
      )
    },
    async getPhonicsState(_userId, courseId) {
      return repository.call<'getState', { courseId: string }, PhonicsCourseState>(
        'phonics-query', 'getState', { courseId },
      )
    },
    async submitPhonicsAnswer(_userId, input, expectedVersion, operationId) {
      return repository.call<'submitAnswer', typeof input, PhonicsAnswerView>(
        'phonics-command', 'submitAnswer', input, { expectedVersion, operationId },
      )
    },
    async getPhonicsAudio(_userId, courseId, phonemeId) {
      return repository.call<'getAudio', { courseId: string; phonemeId: string }, PhonicsAudioView>(
        'phonics-query', 'getAudio', { courseId, phonemeId },
      )
    },
    async listTaskTemplates(_userId) {
      return repository.call<'listTemplates', Record<string, never>, TaskTemplateView[]>(
        'task-template-query', 'listTemplates', {},
      )
    },
    async listNotifications(_userId, filter, offset, limit, days) {
      return repository.call<'list', { filter: NotificationFilter; offset: number; limit: number; days: number }, InboxPage>(
        'notification-query', 'list', { filter, offset, limit, days },
      )
    },
    async markNotificationRead(_userId, noticeId, operationId) {
      return repository.call<'markRead', { noticeId: string }, InboxNotice>(
        'notification-command', 'markRead', { noticeId }, { operationId },
      )
    },
    async markAllNotificationsRead(_userId, operationId) {
      return repository.call<'markAllRead', Record<string, never>, { readAt: string }>(
        'notification-command', 'markAllRead', {}, { operationId },
      )
    },
    async getTaskTemplate(_userId, templateId) {
      return repository.call<'getTemplate', { templateId: string }, TaskTemplateView>(
        'task-template-query', 'getTemplate', { templateId },
      )
    },
    async saveTaskTemplate(_userId, input, expectedVersion, operationId) {
      return repository.call<'saveTemplate', TaskTemplateInput, TaskTemplateView>(
        'task-template-command', 'saveTemplate', input, { expectedVersion, operationId },
      )
    },
    async renameTaskTemplate(_userId, templateId, title, expectedVersion, operationId) {
      return repository.call<'renameTemplate', { templateId: string; title: string }, TaskTemplateView>(
        'task-template-command', 'renameTemplate', { templateId, title }, { expectedVersion, operationId },
      )
    },
    async copyTaskTemplate(_userId, templateId, title, expectedVersion, operationId) {
      return repository.call<'copyTemplate', { templateId: string; title: string }, TaskTemplateView>(
        'task-template-command', 'copyTemplate', { templateId, title }, { expectedVersion, operationId },
      )
    },
    async removeTaskTemplate(_userId, templateId, expectedVersion, operationId) {
      return repository.call<'removeTemplate', { templateId: string }, TaskTemplateView>(
        'task-template-command', 'removeTemplate', { templateId }, { expectedVersion, operationId },
      )
    },
    async useTaskTemplate(_userId, templateId, expectedVersion, operationId) {
      return repository.call<'useTemplate', { templateId: string }, TaskTemplateView>(
        'task-template-command', 'useTemplate', { templateId }, { expectedVersion, operationId },
      )
    },
    async instantiateTaskTemplate(_userId, templateId, expectedVersion, operationId) {
      const result = await repository.call<'instantiateTemplate', { templateId: string }, TemplateDraftReceiptWire>(
        'task-command', 'instantiateTemplate', { templateId }, { expectedVersion, operationId },
      )
      return result.ok ? { ok: true, data: { taskId: result.data.taskId, version: result.data.version,
        templateVersion: result.data.templateVersion }, meta: result.meta } : result
    },

    async saveVocabularyProgress(_userId, command) {
      return repository.call<'saveVocabularyProgress', object, VocabularyProgress>(
        'learning-progress-command', 'saveVocabularyProgress', {
          packId: command.packId,
          completedCount: command.completedCount,
          correctCount: command.correctCount,
          wrongWordIds: command.wrongWordIds,
        }, {
          operationId: command.operationId,
          ...(command.expectedVersion === 0 ? {} : { expectedVersion: command.expectedVersion }),
        },
      )
    },

    async logout(_userId) {
      const result = await repository.call<'logout', Record<string, never>, null>(
        'auth-session', 'logout', {}, { operationId: `logout_${Date.now()}` },
      )
      if (result.ok) currentUser = null
      return result
    },
  }
}

async function submit(
  repository: CloudRepositoryClient,
  userId: string,
  command: CloudSubmissionCommand,
  action: 'saveDraft' | 'submit',
): Promise<ServiceResult<Submission>> {
  if (!isPositiveInteger(command.assignmentVersion)) {
    return validationFailure('assignmentVersion', '请刷新任务后再操作')
  }
  if (!isStructuredAnswers(command.structuredAnswers)) {
    return validationFailure('structuredAnswers', '请完成结构化任务内容后再保存或提交')
  }
  const result = await repository.call<typeof action, object, SubmissionReceiptWire>('submission-command', action, {
    taskId: command.taskId,
    answers: command.structuredAnswers,
    ...(command.draftVersion === undefined ? {} : { draftVersion: command.draftVersion }),
  }, { operationId: command.operationId, expectedVersion: command.assignmentVersion })
  return mapResult(result, value => ({
    id: value.submissionId,
    assignmentId: `asn_${command.taskId}_${userId}`,
    studentId: userId,
    version: value.submissionVersion,
    status: value.status,
    answers: command.structuredAnswers?.map(answer => ({ taskItemId: answer.itemId, value: stringValue(answer.value) })) ?? [],
    ...(value.submittedAt === null ? {} : { submittedAt: value.submittedAt }),
    recordVersion: value.recordVersion,
    assignmentVersion: value.assignmentVersion,
  }))
}

function mapStudentTaskDetail(value: StudentTaskDetailWire): TaskDetailView {
  const task: Task = {
    id: value.taskId,
    title: value.title,
    deliveryType: 'classroom',
    status: value.status ?? 'active',
    creatorTeacherId: '',
    classId: value.assignment.classId ?? '',
    startsAt: value.startsAt,
    dueAt: value.dueAt,
    ...(value.latePolicy === undefined ? {} : { latePolicy: { ...value.latePolicy } }),
    description: value.description ?? '',
    items: value.items.map(item => {
      const rule = taskCompletionRule(item.type, item.completionRule)
      return {
        id: item.id,
        resourceId: item.resourceId,
        title: item.title,
        type: item.type,
        completionRule: rule === undefined ? '完成规则暂不可用' : completionRuleLabel(item.type, completionRequiredCount(item.type, item.completionRule as Record<string, unknown>) ?? 0),
        ...(rule === undefined ? {} : { completionRuleData: rule }),
        ...(item.readingPageNumbers === undefined ? {} : { readingPageNumbers: [...item.readingPageNumbers] }),
        ...(item.recordingPrompt === undefined ? {} : { recordingPrompt: item.recordingPrompt }),
        ...(item.snapshotSchemaVersion === undefined ? {} : { snapshotSchemaVersion: item.snapshotSchemaVersion }),
        ...(item.vocabularyWordIds === undefined ? {} : { vocabularyWordIds: [...item.vocabularyWordIds] }),
        ...(item.vocabularyPack === undefined ? {} : { vocabularyPack: { ...item.vocabularyPack,
          words: item.vocabularyPack.words.map(word => ({ ...word, syllables: [...word.syllables] })) } }),
        ...(item.exerciseQuestion === undefined ? {} : { exerciseQuestion: { ...item.exerciseQuestion, options: [...item.exerciseQuestion.options] } }),
        ...(item.mediaSnapshot === undefined ? {} : { mediaSnapshot: {
          ...item.mediaSnapshot, questionIds: [...item.mediaSnapshot.questionIds],
          questions: item.mediaSnapshot.questions.map(question => ({ ...question, options: [...question.options] })),
          clips: item.mediaSnapshot.clips.map(clip => ({ ...clip })),
          ...(item.mediaSnapshot.subtitleCues === undefined ? {}
            : { subtitleCues: item.mediaSnapshot.subtitleCues.map(cue => ({ ...cue })) }),
        } }),
      }
    }),
    version: 1,
  }
  const assignment: TaskAssignment = {
    id: `asn_${value.taskId}`,
    taskId: value.taskId,
    studentId: '',
    classId: value.assignment.classId ?? '',
    status: value.assignment.status,
    progressPercent: value.assignment.status === 'completed' || value.assignment.status === 'awaiting_review' ? 100 : 0,
    redoCount: value.assignment.redoCount,
    version: value.assignment.version,
    ...(value.assignment.redoDueAt === null ? {} : { redoDueAt: value.assignment.redoDueAt }),
    ...(value.assignment.submittedAt === null ? {} : { submittedAt: value.assignment.submittedAt }),
    ...(value.submission === null || value.submission.status === 'draft' ? {} : { latestSubmissionId: value.submission.id }),
  }
  const submission = value.submission === null ? undefined : {
    id: value.submission.id,
    assignmentId: assignment.id,
    studentId: assignment.studentId,
    version: value.submission.version,
    status: value.submission.status,
    answers: value.submission.answers.map(answer => {
      const structuredValue = taskCompletionValue(answer.value)
      return {
        taskItemId: answer.itemId,
        value: stringValue(answer.value),
        ...(structuredValue === undefined ? {} : { structuredValue }),
      }
    }),
    ...(value.submission.submittedAt === null ? {} : { submittedAt: value.submission.submittedAt }),
    recordVersion: value.submission.recordVersion,
    assignmentVersion: value.submission.assignmentVersion,
  }
  const feedback = value.feedback === null || submission === undefined ? undefined
    : mapFeedback(value.feedback, assignment.id, value.feedback.submissionId ?? submission.id)
  return { task, assignment, ...(value.automaticScore === undefined ? {} : { automaticScore: value.automaticScore }),
    ...(value.readingPageProgress === undefined ? {} : { readingPageProgress: value.readingPageProgress }),
    ...(submission === undefined ? {} : { submission }),
    submissionHistory: value.submissionHistory?.map(item => ({ version: item.version, status: item.status,
      submittedAt: item.submittedAt,
      ...(item.feedback ? { feedback: mapFeedback(item.feedback, assignment.id,
        item.feedback.submissionId ?? `history_${item.version}`) } : {}),
      ...(item.answers === undefined ? {} : { answers: item.answers.map(answer => {
        const structuredValue = taskCompletionValue(answer.value)
        return { taskItemId: answer.itemId, value: stringValue(answer.value),
          ...(structuredValue === undefined ? {} : { structuredValue }) }
      }) }) })) ?? (submission?.submittedAt ? [{ version: submission.version, status: submission.status,
      submittedAt: submission.submittedAt, answers: submission.answers.map(answer => ({ ...answer })) }] : []),
    ...(feedback === undefined ? {} : { feedback }) }
}

function mapTeacherTask(value: TeacherTaskWire): Task {
  return {
    id: value.taskId,
    title: value.title,
    deliveryType: 'classroom',
    status: value.status,
    creatorTeacherId: '',
    classId: value.classIds[0] ?? '',
    classIds: value.classIds,
    startsAt: value.startsAt,
    dueAt: value.dueAt,
    description: '',
    items: [],
    version: value.version,
  }
}

function mapParentTask(value: ParentTaskWire, summary?: ParentTaskListWire): TaskDetailView {
  const assignmentId = value.assignmentId ?? `asn_${value.taskId}_${value.studentId}`
  const task: Task = {
    id: value.taskId,
    title: value.title,
    deliveryType: 'classroom',
    status: 'active',
    creatorTeacherId: '',
    classId: '',
    startsAt: summary?.startsAt ?? value.submission?.submittedAt ?? new Date(0).toISOString(),
    dueAt: summary?.dueAt ?? value.submission?.submittedAt ?? new Date(0).toISOString(),
    description: '',
    items: [],
    version: 1,
  }
  const assignment: TaskAssignment = {
    id: assignmentId,
    taskId: value.taskId,
    studentId: value.studentId,
    classId: '',
    status: value.assignmentStatus,
    progressPercent: value.submission === null ? 0 : 100,
    redoCount: value.assignmentStatus === 'redo_required' ? 1 : 0,
    ...(value.submission === null ? {} : { latestSubmissionId: value.submission.id, submittedAt: value.submission.submittedAt }),
  }
  const submission: Submission | undefined = value.submission === null ? undefined : {
    id: value.submission.id,
    assignmentId,
    studentId: value.studentId,
    version: value.submission.version,
    status: value.feedback === null ? 'submitted' : value.feedback.decision === 'approved' ? 'reviewed' : 'returned',
    answers: value.submission.answers.map(answer => ({ taskItemId: answer.itemId, value: stringValue(answer.value) })),
    submittedAt: value.submission.submittedAt,
  }
  const feedback = value.feedback === null || submission === undefined ? undefined : mapFeedback(value.feedback, assignmentId, submission.id)
  const submissionHistory = value.submissionHistory?.map(item => ({
    version: item.version,
    status: item.feedback === null ? 'submitted' as const : item.feedback.decision === 'approved' ? 'reviewed' as const : 'returned' as const,
    submittedAt: item.submittedAt,
    answers: item.answers.map(answer => ({ taskItemId: answer.itemId, value: stringValue(answer.value) })),
    ...(item.feedback === null ? {} : { feedback: mapFeedback(item.feedback, assignmentId, item.id) }),
  }))
  return { task, assignment, ...(value.automaticScore === undefined ? {} : { automaticScore: value.automaticScore }),
    ...(value.assignmentId === undefined ? {} : { parentAssignmentId: value.assignmentId }),
    ...(value.itemSummaries === undefined ? {} : { parentItemSummaries: value.itemSummaries }),
    ...(submission === undefined ? {} : { submission }), ...(feedback === undefined ? {} : { feedback }),
    ...(submissionHistory === undefined ? {} : { submissionHistory }) }
}

function mapParentSummary(value: ParentTaskListWire, childId: string): TaskDetailView {
  return {
    task: {
      id: value.taskId,
      title: value.title,
      deliveryType: 'classroom',
      status: 'active',
      creatorTeacherId: '',
      classId: '',
      startsAt: value.startsAt,
      dueAt: value.dueAt,
      description: '',
      items: [],
      version: 1,
    },
    assignment: {
      id: `asn_${value.taskId}_${childId}`,
      taskId: value.taskId,
      studentId: childId,
      classId: '',
      status: value.status,
      progressPercent: value.status === 'completed' || value.status === 'awaiting_review' ? 100 : 0,
      redoCount: value.status === 'redo_required' ? 1 : 0,
      ...(value.submittedAt === null ? {} : { submittedAt: value.submittedAt }),
    },
  }
}

function mapFeedback(value: FeedbackWire, assignmentId: string, submissionId: string): ReviewFeedback {
  return {
    id: value.id,
    assignmentId,
    submissionId,
    teacherId: '',
    ...(value.teacherName === undefined ? {} : { teacherName: value.teacherName }),
    ...(value.voiceComment === undefined ? {} : { voiceComment: value.voiceComment }),
    decision: value.decision,
    ...(value.score === null ? {} : { score: value.score }),
    ...(value.itemScores === undefined ? {} : { itemScores: value.itemScores.map(item => ({ ...item })) }),
    ...(value.textComment === null ? {} : { textComment: value.textComment }),
    ...(value.returnReason === null ? {} : { returnReason: value.returnReason }),
    publishedAt: value.publishedAt,
  }
}

function mapStructuredTaskDraft(value: StructuredTaskDraft | undefined): ServiceResult<object> {
  if (value === undefined) return validationFailure('structuredDraft', '请补全任务内容、完成阈值和评分规则')
  if (value.items.length === 0) return validationFailure('structuredDraft.items', '任务内容至少包含一项')
  if (!isOffsetIso(value.startsAt) || !isOffsetIso(value.dueAt) || Date.parse(value.startsAt) >= Date.parse(value.dueAt)) {
    return validationFailure('structuredDraft.dueAt', '请提供有效的任务开始和截止时间')
  }
  if (!Number.isInteger(value.latePolicy.lateDays) || value.latePolicy.lateDays < 1 || value.latePolicy.lateDays > 30) {
    return validationFailure('structuredDraft.latePolicy.lateDays', '补交天数必须为 1 到 30 天')
  }
  if (value.target.type === 'classes' && value.target.classIds.length === 0) {
    return validationFailure('structuredDraft.target.classIds', '请至少选择一个班级')
  }
  if (value.target.type === 'students' && value.target.studentIds.length === 0) {
    return validationFailure('structuredDraft.target.studentIds', '请至少选择一个学员')
  }
  for (const [index, item] of value.items.entries()) {
    if (!item.id.trim() || !item.resourceId.trim()) return validationFailure(`structuredDraft.items[${index}]`, '任务内容标识不能为空')
    if (!isPositiveInteger(item.requiredCount)) return validationFailure(`structuredDraft.items[${index}].requiredCount`, '完成阈值必须为正整数')
    if (!isPositiveInteger(item.maxScore)) return validationFailure(`structuredDraft.items[${index}].maxScore`, '满分必须为正整数')
    if (item.weightPercent !== undefined && (!Number.isFinite(item.weightPercent)
      || item.weightPercent <= 0 || item.weightPercent > 100)) {
      return validationFailure(`structuredDraft.items[${index}].weightPercent`, '评分权重须在 0 到 100 之间')
    }
    if (item.scoringKind !== undefined && item.scoringKind !== 'manual' && item.scoringKind !== 'automatic'
      && item.scoringKind !== 'completion_only') {
      return validationFailure(`structuredDraft.items[${index}].scoringKind`, '评分方式无效')
    }
    if (item.type === 'recording' && item.scoringKind === 'automatic') {
      return validationFailure(`structuredDraft.items[${index}].scoringKind`, '录音任务须由教师人工评分')
    }
    if (item.pageIds !== undefined && (item.type !== 'reading' || item.pageIds.length !== item.requiredCount
      || !item.pageIds.every(id => typeof id === 'string' && !!id.trim())
      || new Set(item.pageIds).size !== item.pageIds.length)) {
      return validationFailure(`structuredDraft.items[${index}].pageIds`, '阅读指定页范围无效')
    }
  }
  return {
    ok: true,
    data: {
      itemRefs: value.items.map((item, index) => ({
        id: item.id,
        resourceId: item.resourceId,
        ...(item.type === 'listening' || item.type === 'video' || item.type === 'dubbing' ? {}
          : { completionRule: completionRule(item.type, item.requiredCount, item.pageIds) }),
        scoringRule: { kind: item.scoringKind ?? 'manual', maxScore: item.maxScore,
          ...(item.weightPercent === undefined ? {} : { weightPercent: item.weightPercent }) },
        order: index + 1,
      })),
      target: value.target,
      startsAt: value.startsAt,
      dueAt: value.dueAt,
      latePolicy: value.latePolicy,
      ...(value.teacherNote === undefined ? {} : { teacherNote: value.teacherNote }),
    },
  }
}

function mapDraftOptions(value: TaskDraftOptionsWire, nowIso: string): ServiceResult<TaskDraftOptionsView> {
  const selectedClass = value.classes.find(candidate => value.resources.some(resource => (
    resource.allowedClassIds.includes(candidate.id)
      && completionRequiredCount(resource.type, resource.completionRule) !== null
  )))
  const defaultClass = selectedClass ?? value.classes[0]
  if (defaultClass === undefined) return validationFailure('classes', '当前没有可布置的授权班级')
  const selectedResources: TaskDraftOptionsView['resources'] = []
  const items: StructuredTaskDraft['items'] = []
  for (const resource of value.resources) {
    const requiredCount = completionRequiredCount(resource.type, resource.completionRule)
    if (requiredCount === null) continue
    selectedResources.push({ id: resource.id, title: resource.title, type: resource.type, requiredCount, allowedClassIds: resource.allowedClassIds })
  }
  for (const type of ['reading', 'vocabulary', 'exercise'] as const) {
    const resource = value.resources.find(candidate => (
      candidate.type === type
        && candidate.allowedClassIds.includes(defaultClass.id)
        && completionRequiredCount(type, candidate.completionRule) !== null
    ))
    if (resource === undefined) continue
    const requiredCount = completionRequiredCount(type, resource.completionRule)
    const maxScore = resource.scoringRule.kind === 'manual' && isPositiveIntegerValue(resource.scoringRule.maxScore)
      ? resource.scoringRule.maxScore
      : 100
    if (requiredCount === null) continue
    items.push({ id: `item_${type}`, resourceId: resource.id, type, requiredCount, maxScore })
  }
  if (!isOffsetIso(nowIso)) return validationFailure('startsAt', '当前时间无效')
  const startsAt = new Date(nowIso)
  const dueAt = new Date(startsAt.getTime() + 24 * 60 * 60 * 1000)
  return {
    ok: true,
    data: {
      selectedClassName: defaultClass.name,
      availableClasses: value.classes,
      resources: selectedResources,
      structuredDraft: {
        items,
        target: { type: 'classes', classIds: [defaultClass.id] },
        startsAt: startsAt.toISOString(),
        dueAt: dueAt.toISOString(),
        latePolicy: { allowLate: true, lateDays: 7 },
      },
    },
  }
}

function completionRequiredCount(type: TaskItem['type'], rule: Record<string, unknown>): number | null {
  if (type === 'reading' && rule.kind === 'reading_pages' && isPositiveIntegerValue(rule.requiredPageCount)) return rule.requiredPageCount
  if (type === 'vocabulary' && rule.kind === 'vocabulary_words' && isPositiveIntegerValue(rule.requiredWordCount)) return rule.requiredWordCount
  if (type === 'exercise' && rule.kind === 'exercise_questions' && isPositiveIntegerValue(rule.requiredQuestionCount)) return rule.requiredQuestionCount
  if (type === 'recording' && rule.kind === 'recording_upload') return 1
  if (type === 'listening' && rule.kind === 'listening' && Array.isArray(rule.questionIds)) return rule.questionIds.length
  if (type === 'video' && rule.kind === 'video' && isPositiveIntegerValue(rule.durationMs)) return 1
  if (type === 'dubbing' && rule.kind === 'dubbing') return 1
  return null
}

function taskCompletionRule(type: TaskItem['type'], rule: object): TaskCompletionRule | undefined {
  const record = rule as Record<string, unknown>
  if (type === 'listening' && record.kind === 'listening' && Array.isArray(record.questionIds)
    && Array.isArray(record.segmentIds) && record.questionIds.length > 0
    && record.questionIds.length === record.segmentIds.length
    && [...record.questionIds, ...record.segmentIds].every(id => typeof id === 'string' && !!id.trim())) {
    return { kind: 'listening', questionIds: [...record.questionIds] as string[],
      segmentIds: [...record.segmentIds] as string[] }
  }
  if (type === 'video' && record.kind === 'video' && isPositiveIntegerValue(record.durationMs)
    && Array.isArray(record.questionIds) && record.questionIds.every(id => typeof id === 'string' && !!id.trim())) {
    return { kind: 'video', durationMs: record.durationMs, questionIds: [...record.questionIds] as string[] }
  }
  if (type === 'dubbing' && record.kind === 'dubbing') return { kind: 'dubbing' }
  const requiredCount = completionRequiredCount(type, record)
  if (requiredCount === null) return undefined
  if (type === 'reading') {
    if (record.pageIds !== undefined && (!Array.isArray(record.pageIds)
      || record.pageIds.length !== requiredCount
      || !record.pageIds.every(id => typeof id === 'string' && !!id.trim())
      || new Set(record.pageIds).size !== record.pageIds.length)) return undefined
    return { kind: 'reading_pages', requiredPageCount: requiredCount,
      ...(record.pageIds === undefined ? {} : { pageIds: [...record.pageIds] as string[] }) }
  }
  if (type === 'vocabulary') return { kind: 'vocabulary_words', requiredWordCount: requiredCount }
  if (type === 'recording') return { kind: 'recording_upload' }
  if (type === 'exercise') return { kind: 'exercise_questions', requiredQuestionCount: requiredCount }
  return undefined
}

function taskCompletionValue(value: unknown): TaskCompletionValue | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if ((record.kind === 'listening' || record.kind === 'video')
    && typeof record.mediaSessionId === 'string' && !!record.mediaSessionId.trim()) {
    const responses = Array.isArray(record.questionResponses) ? record.questionResponses.flatMap(entry => {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return []
      const answer = entry as Record<string, unknown>
      if (typeof answer.questionId !== 'string' || !answer.questionId.trim()
        || !(typeof answer.response === 'string' && !!answer.response.trim()
          || Array.isArray(answer.response) && answer.response.length > 0
          && answer.response.every(option => typeof option === 'string' && !!option.trim()))) return []
      return [{ questionId: answer.questionId, response: answer.response as string | string[] }]
    }) : []
    if (record.kind === 'listening' && responses.length === 0) return undefined
    if (record.questionResponses !== undefined && (!Array.isArray(record.questionResponses)
      || responses.length !== record.questionResponses.length)) return undefined
    if (new Set(responses.map(answer => answer.questionId)).size !== responses.length) return undefined
    return record.kind === 'listening'
      ? { kind: 'listening', mediaSessionId: record.mediaSessionId, questionResponses: responses }
      : { kind: 'video', mediaSessionId: record.mediaSessionId,
        ...(record.questionResponses === undefined ? {} : { questionResponses: responses }) }
  }
  if (record.kind === 'dubbing' && typeof record.mediaSessionId === 'string'
    && !!record.mediaSessionId.trim() && typeof record.finalWorkId === 'string' && !!record.finalWorkId.trim()) {
    return { kind: 'dubbing', mediaSessionId: record.mediaSessionId, finalWorkId: record.finalWorkId }
  }
  if (record.kind === 'recording' && typeof record.recordingId === 'string' && record.recordingId.trim()) {
    return { kind: 'recording', recordingId: record.recordingId,
      ...(isPositiveIntegerValue(record.durationMs) ? { durationMs: record.durationMs } : {}),
      ...(isPositiveIntegerValue(record.sizeBytes) ? { sizeBytes: record.sizeBytes } : {}) }
  }
  if (record.kind === 'reading' && isNonNegativeIntegerValue(record.completedPageCount)) {
    return { kind: 'reading', completedPageCount: record.completedPageCount }
  }
  if (record.kind === 'vocabulary'
    && isNonNegativeIntegerValue(record.completedWordCount)
    && isNonNegativeIntegerValue(record.correctWordCount)
    && record.correctWordCount <= record.completedWordCount) {
    return { kind: 'vocabulary', completedWordCount: record.completedWordCount, correctWordCount: record.correctWordCount }
  }
  if (record.kind === 'exercise' && isNonNegativeIntegerValue(record.answeredQuestionCount)) {
    const responses = Array.isArray(record.questionResponses) ? record.questionResponses.flatMap((entry) => {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return []
      const value = entry as Record<string, unknown>
      if (typeof value.questionId !== 'string' || !(typeof value.response === 'string'
        || (Array.isArray(value.response) && value.response.every(option => typeof option === 'string')))) return []
      return [{ questionId: value.questionId, response: value.response as string | string[],
        ...(typeof value.isCorrect === 'boolean' ? { isCorrect: value.isCorrect } : {}) }]
    }) : undefined
    return {
      kind: 'exercise',
      answeredQuestionCount: record.answeredQuestionCount,
      ...(isNonNegativeIntegerValue(record.correctQuestionCount) ? { correctQuestionCount: record.correctQuestionCount } : {}),
      ...(responses === undefined ? {} : { questionResponses: responses }),
    }
  }
  return undefined
}

function isPositiveIntegerValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function isNonNegativeIntegerValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function completionRule(type: StructuredTaskDraft['items'][number]['type'], requiredCount: number, pageIds?: readonly string[]): object {
  if (type === 'reading') return { kind: 'reading_pages', requiredPageCount: requiredCount,
    ...(pageIds === undefined ? {} : { pageIds: [...pageIds] }) }
  if (type === 'vocabulary') return { kind: 'vocabulary_words', requiredWordCount: requiredCount }
  if (type === 'recording') return { kind: 'recording_upload' }
  return { kind: 'exercise_questions', requiredQuestionCount: requiredCount }
}

function taskItemTitle(type: StructuredTaskDraft['items'][number]['type']): string {
  if (type === 'reading') return '阅读练习'
  if (type === 'vocabulary') return '单词练习'
  if (type === 'recording') return '录音任务'
  return '习题练习'
}

function completionRuleLabel(type: TaskItem['type'], requiredCount: number): string {
  if (type === 'reading') return `完成 ${requiredCount} 页阅读`
  if (type === 'vocabulary') return `完成 ${requiredCount} 个单词`
  if (type === 'recording') return '提交有效录音'
  if (type === 'listening') return `听完音频并作答 ${requiredCount} 题`
  if (type === 'video') return '连续观看至少 90%'
  if (type === 'dubbing') return '连续观看并提交最终配音作品'
  return `完成 ${requiredCount} 道习题`
}

function isStructuredAnswers(value: StructuredSubmissionAnswer[] | undefined): value is StructuredSubmissionAnswer[] {
  if (value === undefined || value.length === 0) return false
  return value.every(answer => {
    if (!answer.itemId.trim()) return false
    if (answer.value.kind === 'reading') return isNonNegativeInteger(answer.value.completedPageCount)
    if (answer.value.kind === 'recording') return answer.value.recordingId.trim().length > 0
    if (answer.value.kind === 'dubbing') return !!answer.value.mediaSessionId.trim()
      && !!answer.value.finalWorkId.trim()
    if (answer.value.kind === 'listening' || answer.value.kind === 'video') {
      const responses = answer.value.questionResponses ?? []
      return !!answer.value.mediaSessionId.trim()
        && (answer.value.kind !== 'listening' || responses.length > 0)
        && responses.every(response => !!response.questionId.trim()
          && (typeof response.response === 'string' ? !!response.response.trim()
            : response.response.length > 0 && response.response.every(option => !!option.trim())))
    }
    if (answer.value.kind === 'vocabulary') {
      return isNonNegativeInteger(answer.value.completedWordCount)
        && isNonNegativeInteger(answer.value.correctWordCount)
        && answer.value.correctWordCount <= answer.value.completedWordCount
    }
    if (answer.value.kind === 'exercise' && answer.value.questionResponses !== undefined) return answer.value.answeredQuestionCount === 1
      && answer.value.questionResponses.length === 1
      && answer.value.questionResponses.every(response => response.questionId.trim().length > 0
        && (typeof response.response === 'string' ? response.response.trim().length > 0
          : response.response.length > 0 && response.response.every(option => option.trim().length > 0)))
    return isNonNegativeInteger(answer.value.answeredQuestionCount)
      && (answer.value.correctQuestionCount === undefined || (
        isNonNegativeInteger(answer.value.correctQuestionCount)
        && answer.value.correctQuestionCount <= answer.value.answeredQuestionCount
      ))
  })
}

function isPositiveInteger(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0
}

function isOffsetIso(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value))
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function failure<T>(code: import('../domain/types').ServiceError['code'], message: string): ServiceResult<T> {
  return { ok: false, error: { code, message, retryable: code === 'INTERNAL_ERROR' } }
}

function validationFailure<T>(field: string, message: string): ServiceResult<T> {
  return { ok: false, error: { code: 'VALIDATION_ERROR', message, retryable: false, fieldErrors: { [field]: message } } }
}

function authenticationFailure(error: unknown): ServiceResult<Session> {
  const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code.toUpperCase()
    : ''
  if (code.includes('NETWORK') || code.includes('TIMEOUT')) {
    return { ok: false, error: { code: 'NETWORK_ERROR', message: '网络连接失败，请检查网络后重试', retryable: true } }
  }
  if (code.includes('CAPTCHA_REQUIRED')) return { ok: false, error: { code: 'UNAUTHENTICATED', message: '登录尝试过多，需要完成验证码验证', retryable: false } }
  if (code.includes('INVALID_STATUS')) return { ok: false, error: { code: 'UNAUTHENTICATED', message: '账号暂不可用或已锁定，请稍后重试', retryable: false } }
  if (code.includes('PASSWORD_NOT_SET')) return { ok: false, error: { code: 'UNAUTHENTICATED', message: '该账号尚未设置密码，请联系管理员', retryable: false } }
  if (code.includes('LOGIN_DISABLED')) return { ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: '当前环境未开启密码登录，请联系管理员', retryable: false } }
  return { ok: false, error: { code: 'UNAUTHENTICATED', message: '手机号或密码不正确', retryable: false } }
}

function passwordCodeVerificationFailure<T>(error: unknown): ServiceResult<T> {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code).toUpperCase()
    : ''
  if (code.includes('NETWORK') || code.includes('TIMEOUT')) {
    return { ok: false, error: { code: 'NETWORK_ERROR', message: '网络连接失败，请检查网络后重试', retryable: true } }
  }
  if (code.includes('EXPIRED') || code.includes('INVALID_VERIFICATION') || code.includes('VERIFICATION')
    || code.includes('INVALID_ARGUMENT') || code.includes('CAPTCHA_INVALID')) {
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: '验证码无效或已过期', retryable: false } }
  }
  if (code.includes('RESOURCE_EXHAUSTED') || code.includes('ABORTED')) {
    return { ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: '验证码尝试过于频繁，请稍后重试', retryable: true } }
  }
  return passwordRecoveryServiceFailure(error)
}

function passwordRecoveryServiceFailure<T>(error: unknown): ServiceResult<T> {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code).toUpperCase()
    : ''
  if (code.includes('NETWORK') || code.includes('TIMEOUT')) {
    return { ok: false, error: { code: 'NETWORK_ERROR', message: '网络连接失败，请检查网络后重试', retryable: true } }
  }
  if (code.includes('ACCOUNT_NOT_FOUND') || code.includes('USER_NOT_FOUND')) {
    return { ok: false, error: { code: 'NOT_FOUND', message: '该手机号未对应可找回的账号，请联系学校管理员核对', retryable: false } }
  }
  if (code.includes('EXPIRED') || code.includes('INVALID_VERIFICATION') || code.includes('VERIFICATION')) {
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: '验证码已过期，请重新验证', retryable: false } }
  }
  if (code.includes('PASSWORD_RECOVERY_NOT_CONFIGURED')) return { ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: '请联系管理员领取或重置阿里云登录密码', retryable: false } }
  if (code.includes('INVALID_PASSWORD') || code.includes('PASSWORD_POLICY') || code.includes('INVALID_ARGUMENT')) {
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: '新密码不符合要求，请检查密码长度和格式', retryable: false } }
  }
  if (code.includes('RESOURCE_EXHAUSTED')) {
    return { ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: '尝试过于频繁，请稍后重试', retryable: true } }
  }
  return { ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: '密码找回服务暂不可用，请稍后重试', retryable: true } }
}

function mapResult<TInput, TOutput>(result: ServiceResult<TInput>, mapper: (value: TInput) => TOutput): ServiceResult<TOutput> {
  return result.ok ? { ok: true, data: mapper(result.data), ...(result.meta === undefined ? {} : { meta: result.meta }) } : result
}

function defaultNativeAdminOverviewRange(): NativeAdminOverviewRange {
  const to = new Date()
  const from = new Date(to.getFullYear(), to.getMonth(), to.getDate() - 6)
  const format = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  return { from: format(from), to: format(to) }
}

function withMeta<T, TMeta>(result: ServiceResult<T>, source: ServiceResult<TMeta>): ServiceResult<T> {
  return source.meta === undefined ? result : { ...result, meta: source.meta }
}
