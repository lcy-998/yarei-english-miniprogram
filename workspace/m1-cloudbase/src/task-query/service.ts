import type { TrustedActorContext } from '../auth/trusted-actor';
import { readExerciseQuestionSnapshot } from '../task-core/exercise-evidence';
import { automaticTaskScore, manualTaskItemIds, taskScoringItems } from '../task-core/task-score';
import { selectedReadingPageIds } from '../task-core/reading-range';
import { summarizeVocabularyFirstAttempts, vocabularyWordIds } from '../vocabulary-evidence/summary';
import { failure, success, type RequestIdGenerator, type ResultClock } from '../shared/result';
import type { JsonObject, JsonValue, ServiceResult } from '../shared/protocol';
import type { AssignmentStatus, ReviewFeedbackRecord, SubmissionAnswer, SubmissionRecord, TaskAssignmentRecord, TaskRecord } from '../task-core/types';
import {
  serializeBatchReviewPreviewIntent,
  type BatchReviewPreviewCodec,
  type BatchReviewEligibleSubmission,
} from '../task-core/batch-review-preview';
import type { TaskQueryRepository } from './repository';
import type {
  BatchReviewPreview,
  CompletionFilters,
  CursorCodec,
  CompletionListItem,
  DraftPreviewInput,
  PageRequest,
  PageResult,
  QueryResourceOptionRecord,
  QueryTeacherGrantRecord,
  ReviewSubmissionView,
  ReviewTaskFilters,
  ReviewTaskListItem,
  SafeTaskItemView,
  StudentHomeView,
  TeacherTaskEditView,
  StudentTaskDetailView,
  StudentTaskFilters,
  StudentTaskListItem,
  StudentTaskPreview,
  TaskCompletionView,
  TaskDraftOptions,
  TeacherTaskFilters,
  TeacherTaskListItem,
  TeacherWorkbenchView,
} from './types';

const COMPLETION_STATUSES: readonly AssignmentStatus[] = [
  'not_started', 'in_progress', 'awaiting_review', 'completed', 'redo_required', 'overdue',
];

export interface QueryServiceDependencies {
  readonly repository: TaskQueryRepository;
  readonly clock: ResultClock;
  readonly requestIds: RequestIdGenerator;
  readonly cursorCodec?: CursorCodec;
  readonly batchReviewPreviewCodec?: BatchReviewPreviewCodec;
}

export class TeacherTaskQueryService {
  private readonly cursorCodec: CursorCodec;

  public constructor(private readonly dependencies: QueryServiceDependencies) {
    this.cursorCodec = dependencies.cursorCodec ?? new InMemoryOpaqueCursorCodec(dependencies.requestIds);
  }

  public async getTeacherWorkbench(
    actor: TrustedActorContext,
    date: string,
    requestedClassId?: string,
  ): Promise<ServiceResult<TeacherWorkbenchView>> {
    const grants = await this.authorizedGrants(actor, 'task.read');
    if (grants === null) return failure('FORBIDDEN', this.meta());
    const scoped = narrowGrants(grants, requestedClassId);
    const classIds = scoped.map((item) => item.classId);
    const [tasks, assignments, submissions] = await Promise.all([
      this.dependencies.repository.listTasks(actor.organizationId),
      this.dependencies.repository.listAssignments(actor.organizationId),
      this.dependencies.repository.listSubmissions(actor.organizationId),
    ]);
    const visibleTasks = tasks
      .filter((task) => task.status !== 'draft' && task.visibility !== 'recycled' && isTaskVisibleInClasses(task, assignments, classIds))
      .filter((task) => task.startsAt.slice(0, 10) <= date && task.dueAt.slice(0, 10) >= date);
    const taskItems = await Promise.all(visibleTasks.map((task) => buildTeacherTaskItem(task, assignments, submissions, classIds, this.dependencies.repository)));
    taskItems.sort((left, right) => left.dueAt.localeCompare(right.dueAt) || left.taskId.localeCompare(right.taskId));
    return success({
      date,
      classIds,
      activeTaskCount: taskItems.length,
      pendingReviewCount: taskItems.reduce((sum, item) => sum + item.pendingReviewCount, 0),
      pendingCommentCount: taskItems.reduce((sum, item) => sum + item.pendingReviewCount, 0),
      recentTasks: taskItems.slice(0, 5),
    }, this.meta());
  }

  public async listTeacherTasks(
    actor: TrustedActorContext,
    filters: TeacherTaskFilters,
    page: PageRequest,
  ): Promise<ServiceResult<PageResult<TeacherTaskListItem>>> {
    const grants = await this.authorizedGrants(actor, 'task.read');
    if (grants === null) return failure('FORBIDDEN', this.meta());
    const classIds = narrowGrants(grants, filters.classId).map((item) => item.classId);
    const [tasks, assignments, submissions] = await Promise.all([
      this.dependencies.repository.listTasks(actor.organizationId),
      this.dependencies.repository.listAssignments(actor.organizationId),
      this.dependencies.repository.listSubmissions(actor.organizationId),
    ]);
    const filtered = tasks
      .filter((task) => task.visibility !== 'recycled' && isTaskVisibleInClasses(task, assignments, classIds))
      .filter((task) => filters.status === undefined || task.status === filters.status)
      .filter((task) => filters.keyword === undefined || task.title.toLocaleLowerCase().includes(filters.keyword.toLocaleLowerCase()));
    const items = await Promise.all(filtered.map((task) => buildTeacherTaskItem(task, assignments, submissions, classIds, this.dependencies.repository)));
    items.sort((left, right) => right.dueAt.localeCompare(left.dueAt) || left.taskId.localeCompare(right.taskId));
    return this.page(actor, 'teacher-tasks', filters, page, items);
  }

  public async getDraftOptions(actor: TrustedActorContext, catalogMode?: 'selector'): Promise<ServiceResult<TaskDraftOptions>> {
    const grants = await this.authorizedGrants(actor, 'task.publish');
    if (grants === null) return failure('FORBIDDEN', this.meta());
    if (catalogMode === 'selector') return success({
      classes: grants.map((item) => ({ id: item.classId, name: item.className })),
      resources: [],
    }, this.meta());
    const classIds = grants.map((item) => item.classId);
    const resources = await this.dependencies.repository.listPublishedResourceOptions(actor.organizationId);
    return success({
      classes: grants.map((item) => ({ id: item.classId, name: item.className })),
      resources: resources
        .filter((item) => item.allowedClassIds.some((classId) => classIds.includes(classId)))
        .map((item) => ({
          id: item.id,
          title: item.title,
          type: item.type,
          allowedClassIds: item.allowedClassIds.filter((classId) => classIds.includes(classId)),
          completionRule: draftOptionCompletionRule(item.type),
          scoringRule: { kind: 'manual', maxScore: 100 },
        })),
    }, this.meta());
  }

  public async previewTask(
    actor: TrustedActorContext,
    input: Readonly<{ taskId: string; expectedVersion: number }> | Readonly<{ draft: DraftPreviewInput }>,
  ): Promise<ServiceResult<StudentTaskPreview>> {
    const grants = await this.authorizedGrants(actor, 'task.publish');
    if (grants === null) return failure('FORBIDDEN', this.meta());
    const classIds = grants.map((item) => item.classId);
    if ('taskId' in input) {
      const task = await this.dependencies.repository.findTask(actor.organizationId, input.taskId);
      if (task === null || !task.targetClassIds.some((classId) => classIds.includes(classId))) return failure('NOT_FOUND', this.meta());
      if (task.version !== input.expectedVersion) return failure('CONFLICT', this.meta());
      const preview = taskPreview(task, task.targetClassIds.filter((classId) => classIds.includes(classId)));
      if (task.status !== 'draft') return success(preview, this.meta());
      const items: SafeTaskItemView[] = [];
      for (const item of task.itemRefs) {
        const resource = await this.dependencies.repository.findPublishedResourceOption(actor.organizationId, item.resourceId);
        if (resource === null || !task.targetClassIds.every((classId) => resource.allowedClassIds.includes(classId))) {
          return failure('RESOURCE_OFFLINE', this.meta());
        }
        items.push({
          id: item.id, resourceId: item.resourceId, resourceVersion: 1, snapshotSchemaVersion: 1 as const,
          title: resource.title, type: resource.type, completionRule: item.completionRule ?? {}, order: item.order,
        });
      }
      return success({ ...preview, items }, this.meta());
    }
    if (input.draft.targetClassIds.length === 0 || input.draft.targetClassIds.some((classId) => !classIds.includes(classId))) {
      return failure('FORBIDDEN', this.meta());
    }
    for (const item of input.draft.items) {
      const resource = await this.dependencies.repository.findPublishedResourceOption(actor.organizationId, item.resourceId);
      if (resource === null || resource.type !== item.type
        || !input.draft.targetClassIds.every((classId) => resource.allowedClassIds.includes(classId))) {
        return failure('RESOURCE_OFFLINE', this.meta());
      }
    }
    const items: SafeTaskItemView[] = input.draft.items.map((item) => ({
      id: item.id,
      resourceId: item.resourceId,
      resourceVersion: 1,
      snapshotSchemaVersion: 1,
      title: item.title,
      type: item.type,
      completionRule: item.completionRule,
      order: item.order,
    }));
    return success({
      taskId: null,
      title: input.draft.title,
      description: input.draft.description ?? null,
      startsAt: input.draft.startsAt,
      dueAt: input.draft.dueAt,
      classIds: [...input.draft.targetClassIds],
      items,
      version: 0,
    }, this.meta());
  }

  public async getTaskForEdit(actor: TrustedActorContext, taskId: string): Promise<ServiceResult<TeacherTaskEditView>> {
    const grants = await this.authorizedGrants(actor, 'task.publish');
    if (grants === null) return failure('FORBIDDEN', this.meta());
    const task = await this.dependencies.repository.findTask(actor.organizationId, taskId);
    const allowedClassIds = new Set(grants.map((grant) => grant.classId));
    if (task === null || task.visibility === 'recycled' || task.creatorTeacherId !== actor.actorUserId
      || task.targetClassIds.some((classId) => !allowedClassIds.has(classId))) return failure('NOT_FOUND', this.meta());
    return success({
      taskId: task.id, title: task.title, status: task.status, version: task.version,
      description: task.description, teacherNote: task.teacherNote,
      copiedFromTaskId: task.copiedFromTaskId ?? null,
      copiedFromTemplateId: task.copiedFromTemplateId ?? null,
      startsAt: task.startsAt, dueAt: task.dueAt,
      latePolicy: { ...task.latePolicy },
      target: { type: task.targetType, classIds: [...task.targetClassIds], studentIds: [...task.targetStudentIds] },
      itemRefs: task.itemRefs.map((item) => ({ ...item, ...(item.completionRule === undefined ? {} : { completionRule: { ...item.completionRule } }), ...(item.scoringRule === undefined ? {} : { scoringRule: { ...item.scoringRule } }) })),
      items: task.items.map((item) => ({ resourceId: item.resourceId, title: item.resourceSnapshot.title, type: item.resourceSnapshot.type })),
      ...(task.publication ? { publication: { operationId: task.publication.operationId, originalVersion: task.publication.originalVersion, completedCount: task.publication.nextIndex, totalCount: task.publication.entries.length } } : {}),
    }, this.meta());
  }

  public async getCompletion(
    actor: TrustedActorContext,
    taskId: string,
    filter: CompletionFilters,
    page: PageRequest,
  ): Promise<ServiceResult<TaskCompletionView>> {
    const grants = await this.authorizedGrants(actor, 'submission.review');
    if (grants === null) return failure('FORBIDDEN', this.meta());
    const allowedClassIds = grants.map((item) => item.classId);
    const [task, assignments, submissions] = await Promise.all([
      this.dependencies.repository.findTask(actor.organizationId, taskId),
      this.dependencies.repository.listAssignments(actor.organizationId),
      this.dependencies.repository.listSubmissions(actor.organizationId),
    ]);
    if (task === null || !isTaskVisibleInClasses(task, assignments, allowedClassIds)) return failure('NOT_FOUND', this.meta());
    const classIds = filter.classId === undefined
      ? allowedClassIds
      : allowedClassIds.includes(filter.classId) ? [filter.classId] : [];
    const scopedAssignments = assignments
      .filter((item) => item.taskId === taskId && classIds.includes(item.classId))
      .filter((item) => filter.status === undefined || item.status === filter.status);
    const listItems = scopedAssignments.map(completionItem).sort((left, right) => (right.submittedAt ?? '').localeCompare(left.submittedAt ?? '') || left.assignmentId.localeCompare(right.assignmentId));
    const paged = paginate(this.cursorCodec, actor, 'completion', { taskId, ...filter }, page, listItems);
    if (!paged.ok) return failure('CONFLICT', this.meta());
    const visibleItems = await Promise.all(paged.value.items.map(async (item) => {
      const feedback = item.latestSubmissionId === null ? null : await this.dependencies.repository.findFeedback(actor.organizationId, item.latestSubmissionId);
      const submission = item.latestSubmissionId === null ? null : await this.dependencies.repository.findSubmission(actor.organizationId, item.latestSubmissionId);
      return { ...item, score: feedback?.score ?? (submission && item.status !== 'redo_required' ? automaticTaskScore(task, submission) : null) };
    }));
    const countedAssignments = assignments.filter((item) => item.taskId === taskId && classIds.includes(item.classId));
    const counts = Object.fromEntries(COMPLETION_STATUSES.map((status) => [status, countedAssignments.filter((item) => item.status === status).length])) as Readonly<Record<AssignmentStatus, number>>;
    const taskItem = await buildTeacherTaskItem(task, assignments, submissions, classIds, this.dependencies.repository);
    return success({ task: taskItem, counts, assignments: { ...paged.value, items: visibleItems } }, this.meta());
  }

  private async authorizedGrants(actor: TrustedActorContext, permission: string): Promise<readonly QueryTeacherGrantRecord[] | null> {
    if (actor.actorRole !== 'teacher' || !actor.permissions.includes(permission)) return null;
    const grants = await this.dependencies.repository.listActiveTeacherGrants(actor.organizationId, actor.actorUserId);
    return grants.filter((item) => item.permissions.includes(permission));
  }

  private page<T>(actor: TrustedActorContext, key: string, filters: object, page: PageRequest, items: readonly T[]): ServiceResult<PageResult<T>> {
    const result = paginate(this.cursorCodec, actor, key, filters, page, items);
    return result.ok ? success(result.value, this.meta()) : failure('CONFLICT', this.meta());
  }

  private meta() { return createServiceMeta(this.dependencies); }
}

function draftOptionCompletionRule(type: QueryResourceOptionRecord['type']): JsonObject {
  if (type === 'reading') return { kind: 'reading_pages', requiredPageCount: 1 };
  if (type === 'vocabulary') return { kind: 'vocabulary_words', requiredWordCount: 1 };
  if (type === 'recording') return { kind: 'recording_upload' };
  return { kind: 'exercise_questions', requiredQuestionCount: 1 };
}

export class StudentTaskQueryService {
  private readonly cursorCodec: CursorCodec;

  public constructor(private readonly dependencies: QueryServiceDependencies) {
    this.cursorCodec = dependencies.cursorCodec ?? new InMemoryOpaqueCursorCodec(dependencies.requestIds);
  }

  public async getHome(actor: TrustedActorContext, localDate: string): Promise<ServiceResult<StudentHomeView>> {
    if (actor.actorRole !== 'student') return failure('FORBIDDEN', this.meta());
    const [tasks, assignments] = await Promise.all([
      this.dependencies.repository.listTasks(actor.organizationId),
      this.dependencies.repository.listAssignments(actor.organizationId),
    ]);
    const ownAssignments = assignments.filter((item) => item.studentId === actor.actorUserId);
    const taskById = new Map(tasks.filter((task) => task.status !== 'draft' && task.status !== 'withdrawn').map((task) => [task.id, task]));
    const visible = ownAssignments.filter((assignment) => {
      const task = taskById.get(assignment.taskId);
      return task !== undefined && task.visibility !== 'recycled' && isStudentTaskVisible(task, assignment);
    });
    const isUrgent = (assignment: TaskAssignmentRecord): boolean => assignment.status === 'redo_required'
      || assignment.status === 'overdue'
      || (assignment.status !== 'completed' && assignment.status !== 'awaiting_review' && assignment.redoDueAt !== null);
    const onDate = (assignment: TaskAssignmentRecord): boolean => {
      const task = taskById.get(assignment.taskId)!;
      return task.startsAt.slice(0, 10) === localDate || task.dueAt.slice(0, 10) === localDate;
    };
    const completedToday = (assignment: TaskAssignmentRecord): boolean =>
      (assignment.status === 'awaiting_review' || assignment.status === 'completed')
      && (assignment.submittedAt?.slice(0, 10) === localDate
        || assignment.reviewedAt?.slice(0, 10) === localDate);
    const counted = visible.filter((assignment) => (onDate(assignment) || completedToday(assignment))
      && !isUrgent(assignment));
    const today = visible.filter((assignment) => onDate(assignment) || completedToday(assignment)
      || isUrgent(assignment))
      .map((assignment) => studentTaskItem(taskById.get(assignment.taskId) as TaskRecord, assignment));
    today.sort(studentTaskOrder);
    return success({
      localDate,
      completedCount: counted.filter((item) => item.status === 'awaiting_review' || item.status === 'completed').length,
      totalCount: counted.length,
      todayTasks: today,
      nextTask: today.find((item) => item.status !== 'awaiting_review' && item.status !== 'completed') ?? null,
    }, this.meta());
  }

  public async listMyTasks(
    actor: TrustedActorContext,
    filters: StudentTaskFilters,
    page: PageRequest,
  ): Promise<ServiceResult<PageResult<StudentTaskListItem>>> {
    if (actor.actorRole !== 'student') return failure('FORBIDDEN', this.meta());
    const [tasks, assignments] = await Promise.all([
      this.dependencies.repository.listTasks(actor.organizationId),
      this.dependencies.repository.listAssignments(actor.organizationId),
    ]);
    const taskById = new Map(tasks.filter((task) => task.status !== 'draft' && task.status !== 'withdrawn').map((task) => [task.id, task]));
    const items = assignments
      .filter((item) => item.studentId === actor.actorUserId)
      .filter((item) => filters.status === undefined || item.status === filters.status)
      .flatMap((assignment) => {
        const task = taskById.get(assignment.taskId);
        if (task === undefined || !isStudentTaskVisible(task, assignment) || (filters.keyword !== undefined && !task.title.toLocaleLowerCase().includes(filters.keyword.toLocaleLowerCase()))) return [];
        return [studentTaskItem(task, assignment)];
      })
      .sort(studentTaskOrder);
    const paged = paginate(this.cursorCodec, actor, 'my-tasks', filters, page, items);
    return paged.ok ? success(paged.value, this.meta()) : failure('CONFLICT', this.meta());
  }

  public async getMyTask(actor: TrustedActorContext, taskId: string): Promise<ServiceResult<StudentTaskDetailView>> {
    if (actor.actorRole !== 'student') return failure('FORBIDDEN', this.meta());
    const assignment = await this.dependencies.repository.findAssignment(actor.organizationId, taskId, actor.actorUserId);
    if (assignment === null) return failure('NOT_FOUND', this.meta());
    const task = await this.dependencies.repository.findTask(actor.organizationId, taskId);
    if (task === null || task.status === 'draft' || task.status === 'withdrawn' || !isStudentTaskVisible(task, assignment)) return failure('NOT_FOUND', this.meta());
    const candidateDraft = await this.dependencies.repository.findDraftSubmission(
      actor.organizationId,
      assignment.id,
      assignment.latestSubmissionVersion + 1,
    );
    const draft = candidateDraft !== null
      && candidateDraft.studentId === actor.actorUserId
      && candidateDraft.taskId === taskId
      && candidateDraft.assignmentId === assignment.id
      ? candidateDraft
      : null;
    const latestSubmitted = assignment.latestSubmissionId === null
      ? null
      : await this.dependencies.repository.findSubmission(actor.organizationId, assignment.latestSubmissionId);
    const submission = draft ?? latestSubmitted;
    const latestFeedback = latestSubmitted === null ? null
      : await this.dependencies.repository.findFeedback(actor.organizationId, latestSubmitted.id);
    const feedback = assignment.redoDueAt !== null && latestFeedback?.decision === 'returned'
      ? latestFeedback : submission === null || submission.status === 'draft' ? null : latestFeedback;
    const readingCutoff = assignment.redoDueAt !== null && latestFeedback?.decision === 'returned'
      ? latestFeedback.publishedAt : task.publishedAt;
    const history = (await this.dependencies.repository.listTaskSubmissions(actor.organizationId, taskId))
      .filter((item) => item.assignmentId === assignment.id && item.studentId === actor.actorUserId && item.submittedAt !== null)
      .sort((left, right) => right.submissionVersion - left.submissionVersion)
      .slice(0, 3);
    const historyFeedback = new Map(await Promise.all(history.map(async item =>
      [item.id, await this.dependencies.repository.findFeedback(actor.organizationId, item.id)] as const)));
    const readingPageProgress = await Promise.all(task.items.flatMap(item => {
      const pageIds = item.resourceSnapshot.type === 'reading' ? selectedReadingPageIds(item.completionRule) : null;
      const resourceId = item.resourceId || task.itemRefs.find(reference => reference.id === item.id)?.resourceId;
      if (pageIds === null || !resourceId) return [];
      return [this.dependencies.repository.listReadingPageEvents(actor.organizationId, actor.actorUserId, resourceId)
        .then(events => ({ itemId: item.id, completedPageCount: new Set(events.filter(event =>
          event.contentVersion === String(item.resourceVersion) && readingCutoff !== null
          && Date.parse(event.visitedAt) >= Date.parse(readingCutoff)
          && Date.parse(event.visitedAt) <= Date.parse(this.dependencies.clock.nowIso())
          && pageIds.includes(event.pageId)).map(event => event.pageId)).size }))];
    }));
    return success({ ...studentTaskDetail(task, assignment, submission, feedback, history, historyFeedback), readingPageProgress }, this.meta());
  }

  private meta() { return createServiceMeta(this.dependencies); }
}

export class ReviewQueryService {
  private readonly cursorCodec: CursorCodec;
  private readonly batchReviewPreviewCodec: BatchReviewPreviewCodec;

  public constructor(private readonly dependencies: QueryServiceDependencies) {
    this.cursorCodec = dependencies.cursorCodec ?? new InMemoryOpaqueCursorCodec(dependencies.requestIds);
    this.batchReviewPreviewCodec = dependencies.batchReviewPreviewCodec ?? this.cursorCodec;
  }

  public async listReviewTasks(
    actor: TrustedActorContext,
    filters: ReviewTaskFilters,
    page: PageRequest,
  ): Promise<ServiceResult<PageResult<ReviewTaskListItem>>> {
    const grants = await this.authorizedGrants(actor);
    if (grants === null) return failure('FORBIDDEN', this.meta());
    const allowedClassIds = narrowGrants(grants, filters.classId).map((item) => item.classId);
    const [tasks, assignments, submissions] = await Promise.all([
      this.dependencies.repository.listTasks(actor.organizationId),
      this.dependencies.repository.listAssignments(actor.organizationId),
      this.dependencies.repository.listSubmissions(actor.organizationId),
    ]);
    const items: ReviewTaskListItem[] = [];
    for (const task of tasks) {
      if (!isTaskVisibleInClasses(task, assignments, allowedClassIds)) continue;
      if (filters.keyword !== undefined && !task.title.toLocaleLowerCase().includes(filters.keyword.toLocaleLowerCase())) continue;
      const base = await buildTeacherTaskItem(task, assignments, submissions, allowedClassIds, this.dependencies.repository);
      const scoped = assignments.filter((item) => item.taskId === task.id && allowedClassIds.includes(item.classId));
      let reviewedCount = 0;
      for (const assignment of scoped) {
        if (assignment.latestSubmissionId !== null && await this.dependencies.repository.findFeedback(actor.organizationId, assignment.latestSubmissionId) !== null) reviewedCount += 1;
      }
      if (filters.status === 'pending' && base.pendingReviewCount === 0) continue;
      if (filters.status === 'reviewed' && reviewedCount === 0) continue;
      items.push({ ...base, reviewedCount });
    }
    items.sort((left, right) => right.dueAt.localeCompare(left.dueAt) || left.taskId.localeCompare(right.taskId));
    const paged = paginate(this.cursorCodec, actor, 'review-tasks', filters, page, items);
    return paged.ok ? success(paged.value, this.meta()) : failure('CONFLICT', this.meta());
  }

  public async getSubmissionForReview(actor: TrustedActorContext, submissionId: string): Promise<ServiceResult<ReviewSubmissionView>> {
    const grants = await this.authorizedGrants(actor);
    if (grants === null) return failure('FORBIDDEN', this.meta());
    const submission = await this.dependencies.repository.findSubmission(actor.organizationId, submissionId);
    if (submission === null || submission.status === 'draft' || submission.submittedAt === null) return failure('NOT_FOUND', this.meta());
    const assignment = await this.dependencies.repository.findAssignmentById(actor.organizationId, submission.assignmentId);
    if (assignment === null
      || assignment.taskId !== submission.taskId || assignment.studentId !== submission.studentId
      || submission.submissionVersion > assignment.latestSubmissionVersion
      || !grants.some((item) => item.classId === assignment.classId)) return failure('NOT_FOUND', this.meta());
    const task = await this.dependencies.repository.findTask(actor.organizationId, submission.taskId);
    if (task === null) return failure('NOT_FOUND', this.meta());
    const history = (await this.dependencies.repository.listTaskSubmissions(actor.organizationId, task.id))
      .filter(item => item.assignmentId === assignment.id && item.studentId === assignment.studentId
        && item.status !== 'draft' && item.submittedAt !== null
        && item.submissionVersion <= assignment.latestSubmissionVersion)
      .sort((left, right) => right.submissionVersion - left.submissionVersion);
    if (!history.some(item => item.id === submission.id)) return failure('NOT_FOUND', this.meta());
    const feedback = await this.dependencies.repository.findFeedback(actor.organizationId, submission.id);
    const vocabularyEvidence = await taskVocabularyEvidence(this.dependencies.repository, task, submission);
    if (vocabularyEvidence === null) return failure('SERVICE_UNAVAILABLE', this.meta());
    return success(reviewSubmission(task, assignment, submission, feedback, vocabularyEvidence,
      history.map(item => ({ id: item.id, version: item.submissionVersion,
        status: item.status, submittedAt: item.submittedAt as string }))), this.meta());
  }

  public async previewBatchComment(
    actor: TrustedActorContext,
    taskId: string,
    filter: CompletionFilters,
    selection: Readonly<{ mode: 'eligible' | 'ids'; submissionIds: readonly string[] }>,
    comment: string,
  ): Promise<ServiceResult<BatchReviewPreview>> {
    const grants = await this.authorizedGrants(actor);
    if (grants === null) return failure('FORBIDDEN', this.meta());
    const task = await this.dependencies.repository.findTask(actor.organizationId, taskId);
    const allowedClassIds = grants.map((item) => item.classId);
    const assignments = await this.dependencies.repository.listAssignments(actor.organizationId);
    if (task === null || !isTaskVisibleInClasses(task, assignments, allowedClassIds)) return failure('NOT_FOUND', this.meta());
    const classIds = filter.classId === undefined ? allowedClassIds : allowedClassIds.includes(filter.classId) ? [filter.classId] : [];
    const scoped = assignments
      .filter((item) => item.taskId === taskId && classIds.includes(item.classId))
      .filter((item) => filter.status === undefined || item.status === filter.status);
    const selectedIds = new Set(selection.submissionIds);
    let eligibleCount = 0;
    let excludedCount = 0;
    let previewVersion = task.version;
    const eligible: BatchReviewEligibleSubmission[] = [];
    for (const assignment of scoped) {
      if (assignment.latestSubmissionId === null) {
        if (selection.mode === 'eligible') excludedCount += 1;
        continue;
      }
      if (selection.mode === 'ids' && !selectedIds.has(assignment.latestSubmissionId)) continue;
      previewVersion = Math.max(previewVersion, assignment.version, assignment.latestSubmissionVersion);
      const submission = await this.dependencies.repository.findSubmission(actor.organizationId, assignment.latestSubmissionId);
      const feedback = submission === null ? null : await this.dependencies.repository.findFeedback(actor.organizationId, submission.id);
      if (submission !== null
        && submission.taskId === taskId
        && submission.assignmentId === assignment.id
        && submission.studentId === assignment.studentId
        && submission.submissionVersion === assignment.latestSubmissionVersion
        && submission.status === 'submitted'
        && submission.submittedAt !== null
        && feedback === null
        && manualTaskItemIds(task, submission)?.length === 0
        && (assignment.status === 'awaiting_review' || assignment.status === 'completed')) {
        eligibleCount += 1;
        previewVersion = Math.max(previewVersion, submission.submissionVersion, submission.recordVersion);
        eligible.push({
          submissionId: submission.id,
          submissionVersion: submission.submissionVersion,
          submissionRecordVersion: submission.recordVersion,
          assignmentId: assignment.id,
          assignmentVersion: assignment.version,
          classId: assignment.classId,
        });
      }
      else excludedCount += 1;
    }
    if (selection.mode === 'ids') {
      const seen = scoped.filter((item) => item.latestSubmissionId !== null && selectedIds.has(item.latestSubmissionId)).length;
      excludedCount += Math.max(0, selection.submissionIds.length - seen);
    }
    const issuedAt = this.dependencies.clock.nowIso();
    const expiresAt = new Date(Date.parse(issuedAt) + 5 * 60 * 1000).toISOString();
    const normalizedIntent = serializeBatchReviewPreviewIntent({
      schemaVersion: 1,
      issuedAt,
      expiresAt,
      previewVersion,
      actor: {
        organizationId: actor.organizationId,
        actorUserId: actor.actorUserId,
        actorRole: 'teacher',
        authzVersion: actor.authzVersion,
      },
      task: { id: taskId, version: task.version },
      authorizedClassIds: [...new Set(scoped.map((assignment) => assignment.classId))].sort(),
      filter,
      selection: { mode: selection.mode, submissionIds: [...selection.submissionIds].sort() },
      eligible: eligible.sort((left, right) => left.submissionId.localeCompare(right.submissionId)),
      comment,
    });
    return success({
      previewToken: this.batchReviewPreviewCodec.encode(normalizedIntent),
      previewVersion,
      eligibleCount,
      excludedCount,
      commentSummary: { length: comment.length },
    }, this.meta());
  }

  private async authorizedGrants(actor: TrustedActorContext): Promise<readonly QueryTeacherGrantRecord[] | null> {
    if (actor.actorRole !== 'teacher' || !actor.permissions.includes('submission.review')) return null;
    const grants = await this.dependencies.repository.listActiveTeacherGrants(actor.organizationId, actor.actorUserId);
    return grants.filter((item) => item.permissions.includes('submission.review') && actor.scopeIds.includes(item.classId));
  }

  private meta() { return createServiceMeta(this.dependencies); }
}

function createServiceMeta(dependencies: Pick<QueryServiceDependencies, 'clock' | 'requestIds'>) {
  return { requestId: dependencies.requestIds.next(), serverTime: dependencies.clock.nowIso(), apiVersion: 'm1.v1' as const };
}

function narrowGrants(grants: readonly QueryTeacherGrantRecord[], classId?: string): readonly QueryTeacherGrantRecord[] {
  return classId === undefined ? grants : grants.filter((item) => item.classId === classId);
}

function isTaskVisibleInClasses(task: TaskRecord, assignments: readonly TaskAssignmentRecord[], classIds: readonly string[]): boolean {
  return task.targetClassIds.some((classId) => classIds.includes(classId))
    || assignments.some((item) => item.taskId === task.id && classIds.includes(item.classId));
}

function isStudentTaskVisible(task: TaskRecord, assignment: TaskAssignmentRecord): boolean {
  return task.visibility !== 'recycled' || assignment.latestSubmissionId !== null;
}

async function buildTeacherTaskItem(
  task: TaskRecord,
  assignments: readonly TaskAssignmentRecord[],
  _submissions: readonly SubmissionRecord[],
  classIds: readonly string[],
  repository: TaskQueryRepository,
): Promise<TeacherTaskListItem> {
  const scoped = assignments.filter((item) => item.taskId === task.id && classIds.includes(item.classId));
  let pendingReviewCount = 0;
  for (const assignment of scoped) {
    if (assignment.latestSubmissionId !== null && (assignment.status === 'awaiting_review' || assignment.status === 'completed')) {
      const feedback = await repository.findFeedback(task.organizationId, assignment.latestSubmissionId);
      if (feedback === null) pendingReviewCount += 1;
    }
  }
  return {
    taskId: task.id,
    title: task.title,
    status: task.status,
    startsAt: task.startsAt,
    dueAt: task.dueAt,
    classIds: [...new Set(scoped.map((item) => item.classId).concat(task.targetClassIds.filter((item) => classIds.includes(item))))],
    completedCount: scoped.filter((item) => item.status === 'awaiting_review' || item.status === 'completed').length,
    totalCount: scoped.length,
    pendingReviewCount,
    version: task.version,
  };
}

function taskPreview(task: TaskRecord, classIds: readonly string[]): StudentTaskPreview {
  return {
    taskId: task.id,
    title: task.title,
    description: task.description,
    startsAt: task.startsAt,
    dueAt: task.dueAt,
    classIds,
    items: task.items.map((item) => safeTaskItem(item, task.itemRefs)),
    version: task.version,
    target: { type: task.targetType, classIds: task.targetClassIds, studentIds: task.targetStudentIds },
  };
}

function completionItem(assignment: TaskAssignmentRecord): CompletionListItem {
  return {
    assignmentId: assignment.id,
    studentId: assignment.studentId,
    classId: assignment.classId,
    status: assignment.status,
    submittedAt: assignment.submittedAt,
    latestSubmissionId: assignment.latestSubmissionId,
    latestSubmissionVersion: assignment.latestSubmissionVersion,
    isLate: assignment.isLate,
    reviewedAt: assignment.reviewedAt,
    score: null,
  };
}

function studentTaskItem(task: TaskRecord, assignment: TaskAssignmentRecord): StudentTaskListItem {
  return {
    taskId: task.id,
    title: task.title,
    status: assignment.status,
    startsAt: task.startsAt,
    dueAt: task.dueAt,
    submittedAt: assignment.submittedAt,
    isLate: assignment.isLate,
    redoDueAt: assignment.redoDueAt,
  };
}

function studentTaskOrder(left: StudentTaskListItem, right: StudentTaskListItem): number {
  const priority = (item: StudentTaskListItem): number => item.status === 'redo_required' || Boolean(item.redoDueAt) ? 0
    : item.status === 'overdue' ? 1 : item.status === 'in_progress' ? 2 : item.status === 'not_started' ? 3 : 4;
  return priority(left) - priority(right)
    || (left.redoDueAt ?? left.dueAt).localeCompare(right.redoDueAt ?? right.dueAt)
    || left.taskId.localeCompare(right.taskId);
}

function studentSafeSubmissionAnswer(task: TaskRecord, answer: SubmissionAnswer,
  revealJudgement: boolean): SubmissionAnswer {
  const item = task.items.find((candidate) => candidate.id === answer.itemId);
  const value = answer.value;
  if (typeof value === 'string') return { itemId: answer.itemId, value };
  if (item === undefined || !isJsonRecord(value)) return { itemId: answer.itemId, value: '' };
  if (item.resourceSnapshot.type === 'reading' && value.kind === 'reading'
    && typeof value.completedPageCount === 'number' && Number.isSafeInteger(value.completedPageCount)) {
    return { itemId: answer.itemId, value: { kind: 'reading', completedPageCount: value.completedPageCount } };
  }
  if (item.resourceSnapshot.type === 'vocabulary' && value.kind === 'vocabulary'
    && typeof value.completedWordCount === 'number' && Number.isSafeInteger(value.completedWordCount)
    && typeof value.correctWordCount === 'number' && Number.isSafeInteger(value.correctWordCount)) {
    return { itemId: answer.itemId, value: { kind: 'vocabulary', completedWordCount: value.completedWordCount,
      correctWordCount: value.correctWordCount } };
  }
  if (item.resourceSnapshot.type === 'recording' && value.kind === 'recording'
    && typeof value.recordingId === 'string') {
    return { itemId: answer.itemId, value: { kind: 'recording', recordingId: value.recordingId,
      ...(typeof value.durationMs === 'number' ? { durationMs: value.durationMs } : {}),
      ...(typeof value.sizeBytes === 'number' ? { sizeBytes: value.sizeBytes } : {}) } };
  }
  if (item.resourceSnapshot.type === 'exercise' && value.kind === 'exercise'
    && typeof value.answeredQuestionCount === 'number' && Number.isSafeInteger(value.answeredQuestionCount)) {
    const questionResponses = Array.isArray(value.questionResponses) ? value.questionResponses.flatMap((entry) => {
      if (!isJsonRecord(entry) || typeof entry.questionId !== 'string') return [];
      const response = typeof entry.response === 'string' ? entry.response
        : Array.isArray(entry.response) && entry.response.every((part) => typeof part === 'string')
          ? [...entry.response] : null;
      if (response === null) return [];
      return [{ questionId: entry.questionId, response,
        ...(revealJudgement && typeof entry.isCorrect === 'boolean' ? { isCorrect: entry.isCorrect } : {}) }];
    }) : [];
    return { itemId: answer.itemId, value: { kind: 'exercise', answeredQuestionCount: value.answeredQuestionCount,
      questionResponses,
      ...(revealJudgement && typeof value.correctQuestionCount === 'number'
        ? { correctQuestionCount: value.correctQuestionCount } : {}) } };
  }
  return { itemId: answer.itemId, value: '' };
}

function studentTaskDetail(
  task: TaskRecord,
  assignment: TaskAssignmentRecord,
  submission: SubmissionRecord | null,
  feedback: ReviewFeedbackRecord | null,
  history: readonly SubmissionRecord[],
  historyFeedback: ReadonlyMap<string, ReviewFeedbackRecord | null>,
): StudentTaskDetailView {
  return {
    taskId: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    startsAt: task.startsAt,
    dueAt: task.dueAt,
    latePolicy: { ...task.latePolicy },
    items: task.items.map((item) => safeTaskItem(item, task.itemRefs)),
    automaticScore: submission === null ? null : automaticTaskScore(task, submission),
    assignment: {
      classId: assignment.classId,
      status: assignment.status,
      isLate: assignment.isLate,
      submittedAt: assignment.submittedAt,
      redoCount: assignment.redoCount,
      redoDueAt: assignment.redoDueAt,
      version: assignment.version,
    },
    submission: submission === null ? null : {
      id: submission.id,
      version: submission.submissionVersion,
      status: submission.status,
      answers: submission.answers.map((answer) => studentSafeSubmissionAnswer(task, answer,
        feedback?.decision === 'approved' && feedback.submissionId === submission.id)),
      submittedAt: submission.submittedAt,
      recordVersion: submission.recordVersion,
      assignmentVersion: assignment.version,
    },
    submissionHistory: history.map((item) => ({ version: item.submissionVersion, status: item.status,
      submittedAt: item.submittedAt!, answers: item.answers.map((answer) => studentSafeSubmissionAnswer(task, answer,
        historyFeedback.get(item.id)?.decision === 'approved')),
      feedback: safeFeedback(historyFeedback.get(item.id) ?? null) })),
    feedback: safeFeedback(feedback),
  };
}

function reviewSubmission(
  task: TaskRecord,
  assignment: TaskAssignmentRecord,
  submission: SubmissionRecord,
  feedback: ReviewFeedbackRecord | null,
  vocabularyEvidence: ReviewSubmissionView['vocabularyEvidence'],
  submissionHistory: ReviewSubmissionView['submissionHistory'],
): ReviewSubmissionView {
  const readingPages = task.items.flatMap((item) => {
    if (item.resourceSnapshot.type !== 'reading') return [];
    const selectedIds = selectedReadingPageIds(item.completionRule);
    const chapters = item.resourceSnapshot.payload.chapters;
    if (selectedIds === null || !Array.isArray(chapters)) return [];
    const pages = chapters.flatMap((rawChapter) => {
      if (!isJsonRecord(rawChapter) || !Array.isArray(rawChapter.pages)) return [];
      return rawChapter.pages.flatMap((rawPage) => {
        if (!isJsonRecord(rawPage) || typeof rawPage.id !== 'string'
          || typeof rawPage.pageNumber !== 'number' || !Number.isSafeInteger(rawPage.pageNumber)
          || typeof rawPage.imageAssetKey !== 'string' || typeof rawPage.thumbnailAssetKey !== 'string') return [];
        return [{ itemId: item.id, pageId: rawPage.id, pageNumber: rawPage.pageNumber,
          chapterTitle: typeof rawChapter.title === 'string' ? rawChapter.title : '',
          imageAssetKey: rawPage.imageAssetKey, thumbnailAssetKey: rawPage.thumbnailAssetKey }];
      });
    });
    return selectedIds.flatMap(id => pages.find(page => page.pageId === id) ?? []);
  });
  const exerciseEvidence = task.items.flatMap((item) => {
    if (item.resourceSnapshot.type !== 'exercise') return [];
    const question = readExerciseQuestionSnapshot(item.resourceSnapshot.payload);
    if (question === null) return [];
    const answer = submission.answers.find((candidate) => candidate.itemId === item.id);
    const value = answer?.value;
    const responseEntries = isJsonRecord(value) && Array.isArray(value.questionResponses) ? value.questionResponses : [];
    const response = responseEntries.find((entry): entry is JsonObject => isJsonRecord(entry)
      && entry.questionId === question.questionId);
    const recorded = response !== undefined && response.response !== undefined;
    return [{
      itemId: item.id, questionId: question.questionId, questionType: question.questionType,
      stem: question.stem, options: [...question.options],
      studentResponse: recorded ? response.response! : null,
      correctAnswer: question.correctAnswer, explanation: question.explanation,
      isCorrect: response?.isCorrect === true ? true : response?.isCorrect === false ? false : null,
      recorded,
    }];
  });
  return {
    taskId: task.id,
    taskTitle: task.title,
    assignmentId: assignment.id,
    assignmentVersion: assignment.version,
    studentId: assignment.studentId,
    classId: assignment.classId,
    submissionId: submission.id,
    submissionVersion: submission.submissionVersion,
    submissionHistory,
    taskItems: task.items.map(item => ({ id: item.id, title: item.resourceSnapshot.title,
      type: item.resourceSnapshot.type, completionRule: item.completionRule, order: item.order,
      ...(item.resourceSnapshot.type === 'recording' && typeof item.resourceSnapshot.payload.promptText === 'string'
        ? { recordingPrompt: item.resourceSnapshot.payload.promptText } : {}) })),
    scoringItems: taskScoringItems(task, submission),
    readingPages,
    answers: submission.answers,
    automaticScore: automaticTaskScore(task, submission),
    exerciseEvidence,
    vocabularyEvidence,
    isLate: submission.isLate,
    submittedAt: submission.submittedAt as string,
    feedback: feedback === null ? null : {
      ...safeFeedback(feedback)!,
      ...(feedback.originalAutomaticScore === undefined ? {} : { originalAutomaticScore: feedback.originalAutomaticScore }),
      ...(feedback.overrideReason === undefined ? {} : { overrideReason: feedback.overrideReason }),
      ...(feedback.itemScores === undefined ? {} : { itemScores: feedback.itemScores.map(item => ({ ...item })) }),
    },
  };
}

async function taskVocabularyEvidence(repository: TaskQueryRepository, task: TaskRecord,
  submission: SubmissionRecord): Promise<ReviewSubmissionView['vocabularyEvidence'] | null> {
  const rows: ReviewSubmissionView['vocabularyEvidence'][number][] = [];
  for (const item of task.items) {
    if (item.resourceSnapshot.type !== 'vocabulary' || item.snapshotSchemaVersion !== 2) continue;
    const wordIds = vocabularyWordIds(item.resourceSnapshot.payload);
    if (wordIds === null) return null;
    const attempts = await repository.listVocabularyAttempts(task.organizationId, submission.studentId,
      item.resourceId, task.id, item.id, submission.submissionVersion, String(item.resourceVersion));
    if (summarizeVocabularyFirstAttempts(wordIds, attempts) === null) return null;
    const rawWords = item.resourceSnapshot.payload.words;
    if (!Array.isArray(rawWords)) return null;
    for (const rawWord of rawWords) {
      if (!isJsonRecord(rawWord) || typeof rawWord.id !== 'string' || typeof rawWord.word !== 'string') return null;
      const wordAttempts = attempts.filter((attempt) => attempt.wordId === rawWord.id)
        .sort((left, right) => left.attemptNumber - right.attemptNumber)
        .map((attempt) => ({ studentInput: attempt.studentInput, isCorrect: attempt.isCorrect,
          firstAttempt: attempt.firstAttempt, attemptNumber: attempt.attemptNumber, attemptedAt: attempt.attemptedAt }));
      rows.push({ itemId: item.id, wordId: rawWord.id, targetWord: rawWord.word,
        ...(typeof rawWord.meaning === 'string' ? { meaning: rawWord.meaning } : {}),
        ...(typeof rawWord.example === 'string' ? { example: rawWord.example } : {}),
        ...(Array.isArray(rawWord.syllables) && rawWord.syllables.every(part => typeof part === 'string')
          ? { syllables: rawWord.syllables as string[] } : {}),
        attempts: wordAttempts, firstCorrect: wordAttempts[0]?.isCorrect ?? null });
    }
  }
  return rows;
}

function isJsonRecord(value: JsonValue | undefined): value is JsonObject {
  return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safeTaskItem(item: TaskRecord['items'][number], references: TaskRecord['itemRefs']): SafeTaskItemView {
  const question = item.resourceSnapshot.type === 'exercise'
    ? readExerciseQuestionSnapshot(item.resourceSnapshot.payload) : null;
  const vocabularyWords = item.resourceSnapshot.type === 'vocabulary' && item.snapshotSchemaVersion === 2
    ? item.resourceSnapshot.payload.words : null;
  const vocabularyWordIds = Array.isArray(vocabularyWords)
    ? vocabularyWords.flatMap((word) => isJsonRecord(word) && typeof word.id === 'string' ? [word.id] : []) : [];
  const vocabularyPack = safeVocabularyPack(item);
  const readingPageNumbers = item.resourceSnapshot.type === 'reading'
    ? pageNumbersFromSnapshot(item.resourceSnapshot.payload, item.completionRule) : null;
  const recordingPrompt = item.resourceSnapshot.type === 'recording'
    && typeof item.resourceSnapshot.payload.promptText === 'string'
    ? item.resourceSnapshot.payload.promptText : null;
  return {
    id: item.id,
    resourceId: item.resourceId || references.find((reference) => reference.id === item.id)?.resourceId || '',
    resourceVersion: item.resourceVersion,
    snapshotSchemaVersion: item.snapshotSchemaVersion,
    title: item.resourceSnapshot.title,
    type: item.resourceSnapshot.type,
    completionRule: item.completionRule,
    ...(readingPageNumbers === null ? {} : { readingPageNumbers }),
    ...(recordingPrompt === null ? {} : { recordingPrompt }),
    ...(vocabularyWordIds.length ? { vocabularyWordIds } : {}),
    ...(vocabularyPack === null ? {} : { vocabularyPack }),
    ...(question === null ? {} : { exerciseQuestion: {
      questionId: question.questionId, questionType: question.questionType,
      stem: question.stem, options: [...question.options],
    } }),
    order: item.order,
  };
}

function pageNumbersFromSnapshot(payload: JsonObject, rule: JsonObject): readonly number[] | null {
  const selected = selectedReadingPageIds(rule);
  if (selected === null || !Array.isArray(payload.chapters)) return null;
  const pages = payload.chapters.flatMap(chapter => isJsonRecord(chapter) && Array.isArray(chapter.pages)
    ? chapter.pages.filter(isJsonRecord) : []);
  const numbers = selected.map(id => pages.find(page => page.id === id)?.pageNumber);
  return numbers.every(number => typeof number === 'number' && Number.isSafeInteger(number) && number > 0)
    ? numbers as number[] : null;
}

function safeVocabularyPack(item: TaskRecord['items'][number]): SafeTaskItemView['vocabularyPack'] | null {
  if (item.resourceSnapshot.type !== 'vocabulary' || item.snapshotSchemaVersion !== 2) return null;
  const payload = item.resourceSnapshot.payload;
  if (!Array.isArray(payload.words) || typeof payload.grade !== 'string' || typeof payload.unit !== 'string') return null;
  const words: Array<{ id: string; word: string; meaning: string; syllables: string[]; example?: string }> = [];
  for (const raw of payload.words) {
    if (!isJsonRecord(raw) || typeof raw.id !== 'string' || typeof raw.word !== 'string'
      || typeof raw.meaning !== 'string' || !Array.isArray(raw.syllables)
      || !raw.syllables.every((part) => typeof part === 'string' && part.trim())) return null;
    words.push({ id: raw.id, word: raw.word, meaning: raw.meaning, syllables: [...raw.syllables],
      ...(typeof raw.example === 'string' ? { example: raw.example } : {}) });
  }
  return { id: item.resourceId, title: item.resourceSnapshot.title, grade: payload.grade,
    ...(typeof payload.textbook === 'string' ? { textbook: payload.textbook } : {}),
    unit: payload.unit, contentVersion: String(item.resourceVersion), words };
}

function safeFeedback(feedback: ReviewFeedbackRecord | null): StudentTaskDetailView['feedback'] {
  return feedback === null ? null : {
    id: feedback.id,
    submissionId: feedback.submissionId,
    decision: feedback.decision,
    score: feedback.score,
    textComment: feedback.textComment,
    returnReason: feedback.returnReason,
    publishedAt: feedback.publishedAt,
  };
}

type PaginationResult<T> = { readonly ok: true; readonly value: PageResult<T> } | { readonly ok: false };

function paginate<T>(codec: CursorCodec, actor: TrustedActorContext, key: string, filters: object, page: PageRequest, items: readonly T[]): PaginationResult<T> {
  const signature = hashString(`${actor.organizationId}|${actor.actorUserId}|${actor.actorRole}|${actor.authzVersion}|${key}|${stableStringify(filters)}`);
  let offset = 0;
  if (page.cursor !== undefined) {
    const decoded = codec.decode(page.cursor);
    if (decoded === null) return { ok: false };
    const match = /^q1\|([0-9a-f]{8})\|([0-9]+)$/.exec(decoded);
    if (match === null || match[1] !== signature) return { ok: false };
    offset = Number(match[2]);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > items.length) return { ok: false };
  }
  const selected = items.slice(offset, offset + page.limit);
  const nextOffset = offset + selected.length;
  return {
    ok: true,
    value: {
      items: selected,
      total: items.length,
      nextCursor: nextOffset < items.length ? codec.encode(`q1|${signature}|${nextOffset}`) : null,
    },
  };
}

export class InMemoryOpaqueCursorCodec implements CursorCodec {
  private readonly payloads = new Map<string, string>();
  private sequence = 0;

  public constructor(private readonly tokenIds: RequestIdGenerator) {}

  public encode(payload: string): string {
    this.sequence += 1;
    const token = `oq_${this.sequence}_${hashString(this.tokenIds.next())}`;
    this.payloads.set(token, payload);
    return token;
  }

  public decode(token: string): string | null {
    return this.payloads.get(token) ?? null;
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${key}:${stableStringify(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
