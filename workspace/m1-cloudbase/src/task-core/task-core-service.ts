import { hasPermission, hasScope, type TrustedActorContext } from '../auth/trusted-actor';
import { AuthorizationService } from '../auth/authorization-service';
import type { Clock, IdentifierGenerator, IdentityRepository } from '../runtime/ports';
import type { IdempotencyRecord, OperationLogRecord } from '../runtime/records';
import { createOperationFingerprint } from '../shared/request-summary';
import { createMeta, failure, success, type RequestIdGenerator } from '../shared/result';
import type { ErrorCode, FunctionName, JsonObject, JsonValue, ServiceResult } from '../shared/protocol';
import {
  parseBatchReviewPreviewIntent,
  type BatchReviewEligibleSubmission,
  type BatchReviewPreviewCodec,
  type BatchReviewPreviewIntent,
} from './batch-review-preview';
import type { TaskCoreReader, TaskCoreTransaction, TaskCoreTransactionScope, TaskCoreUnitOfWork } from './repository';
import type {
  ClassMembershipRecord,
  FrozenTaskItem,
  ParentTaskResultView,
  ReviewFeedbackRecord,
  SaveTaskDraftInput,
  SubmissionAnswer,
  SubmissionRecord,
  TaskAssignmentRecord,
  TaskRecord,
  TeacherSubmissionReviewView,
  UpdatePublishedTaskInput,
} from './types';

const REDO_DAYS = 3;
const MAX_REDO_COUNT = 2;

/** Pure business slice whose command writes are committed through one unit of work. */
export class TaskCoreService {
  private readonly authorization: AuthorizationService;

  public constructor(
    private readonly repository: TaskCoreUnitOfWork,
    identities: IdentityRepository,
    private readonly clock: Clock,
    private readonly ids: IdentifierGenerator,
    private readonly requestIds: RequestIdGenerator,
    private readonly batchReviewPreviewCodec?: BatchReviewPreviewCodec,
  ) {
    this.authorization = new AuthorizationService(identities);
  }

  public async saveTaskDraft(
    actor: TrustedActorContext,
    input: SaveTaskDraftInput,
    expectedVersion: number,
    operationId: string,
  ): Promise<ServiceResult<JsonObject>> {
    const validation = validateTaskDraft(input);
    if (validation !== null) return this.fail('VALIDATION_ERROR', validation);
    const initialTarget = await resolveTargetMemberships(this.repository, actor.organizationId, input);
    if (!initialTarget.ok) return this.fail('VALIDATION_ERROR', initialTarget.fieldErrors);
    if (!(await this.canTeacherAccessAll(actor, initialTarget.classIds, 'task.publish'))) return this.fail('FORBIDDEN');
    const scope = await this.prepareScope(actor, {
      classIds: initialTarget.classIds,
      memberships: initialTarget.memberships,
    });

    return this.executeAtomic({
      actor,
      functionName: 'task-command',
      action: 'saveDraft',
      operationId,
      expectedVersion,
      payload: taskDraftPayload(input),
      scope,
      perform: async (transaction) => {
        const resolvedTarget = await resolveTargetMemberships(transaction, actor.organizationId, input);
        if (!resolvedTarget.ok) return this.fail('VALIDATION_ERROR', resolvedTarget.fieldErrors);
        if (!(await this.canTeacherAccessAllInTransaction(transaction, actor, resolvedTarget.classIds, 'task.publish'))) return this.fail('FORBIDDEN');
        const current = input.taskId === undefined ? null : await transaction.findTask(actor.organizationId, input.taskId);
        if (input.taskId !== undefined && current === null) return this.fail('NOT_FOUND');
        if (current !== null && (current.creatorTeacherId !== actor.actorUserId || current.status !== 'draft')) return this.fail('FORBIDDEN');
        const currentVersion = current?.version ?? 0;
        if (currentVersion !== expectedVersion) return this.fail('CONFLICT');

        const task: TaskRecord = {
          id: current?.id ?? this.ids.next('task'),
          organizationId: actor.organizationId,
          creatorTeacherId: actor.actorUserId,
          title: input.title.trim(),
          deliveryType: 'classroom',
          status: 'draft',
          targetType: input.targetType ?? 'classes',
          targetClassIds: resolvedTarget.classIds,
          targetStudentIds: (input.targetType ?? 'classes') === 'students' ? unique(input.targetStudentIds ?? []) : [],
          startsAt: input.startsAt,
          dueAt: input.dueAt,
          latePolicy: { ...input.latePolicy },
          description: cleanOptional(input.description),
          teacherNote: cleanOptional(input.teacherNote),
          itemRefs: input.itemRefs.map((item) => ({
            ...item,
            ...(item.completionRule === undefined ? {} : { completionRule: { ...item.completionRule } }),
            scoringRule: { ...(item.scoringRule ?? defaultScoringRule()) },
          })),
          items: [],
          publishedAt: null,
          deadlineExtendedAt: null,
          visibility: 'visible',
          withdrawnAt: null,
          withdrawnBy: null,
          withdrawReason: null,
          recycledAt: null,
          recycledBy: null,
          recycleReason: null,
          recoverableUntil: null,
          version: currentVersion + 1,
        };
        await transaction.saveTask(task);
        return success<JsonObject>({ taskId: task.id, status: task.status, version: task.version }, createMeta(this.clock, this.requestIds));
      },
    });
  }

  public async publishTask(
    actor: TrustedActorContext,
    taskId: string,
    expectedVersion: number,
    operationId: string,
  ): Promise<ServiceResult<JsonObject>> {
    const preparedTask = await this.repository.findTask(actor.organizationId, taskId);
    const preparedMembershipGuards = preparedTask?.targetType === 'classes'
      ? await this.prepareClassMembershipGuards(actor.organizationId, preparedTask.targetClassIds)
      : [];
    const preparedMemberships = preparedTask === null
      ? []
      : preparedTask.targetType === 'classes'
        ? await this.repository.listActiveClassMemberships(actor.organizationId, preparedTask.targetClassIds)
        : await this.repository.listActiveStudentMemberships(actor.organizationId, preparedTask.targetStudentIds);
    const preparedClassIds = preparedTask?.targetType === 'students'
      ? unique(preparedMemberships.map((membership) => membership.classId))
      : preparedTask?.targetClassIds ?? [];
    const scope = await this.prepareScope(actor, {
      classIds: preparedClassIds,
      memberships: preparedMemberships,
      resourceIds: preparedTask?.itemRefs.map((item) => item.resourceId) ?? [],
      classMembershipGuards: preparedMembershipGuards,
    });
    return this.executeAtomic({
      actor,
      functionName: 'task-command',
      action: 'publishTask',
      operationId,
      expectedVersion,
      payload: { taskId },
      scope,
      perform: async (transaction) => {
        const current = await transaction.findTask(actor.organizationId, taskId);
        if (current === null) return this.fail('NOT_FOUND');
        if (current.creatorTeacherId !== actor.actorUserId || current.status !== 'draft') return this.fail('FORBIDDEN');
        if (current.version !== expectedVersion) return this.fail('CONFLICT');
        const resolvedTarget = await resolveStoredTargetMemberships(transaction, actor.organizationId, current);
        if (!resolvedTarget.ok) return this.fail('VALIDATION_ERROR', resolvedTarget.fieldErrors);
        if (!(await this.canTeacherAccessAllInTransaction(transaction, actor, resolvedTarget.classIds, 'task.publish'))) return this.fail('FORBIDDEN');
        if (!(await this.canTeacherAccessAllInTransaction(transaction, actor, resolvedTarget.classIds, 'content.read'))) return this.fail('FORBIDDEN');

        const frozenItems: FrozenTaskItem[] = [];
        for (const reference of current.itemRefs) {
          const resource = await transaction.findResource(actor.organizationId, reference.resourceId);
          if (resource === null) return this.fail('NOT_FOUND');
          if (resource.status !== 'published') return this.fail('RESOURCE_OFFLINE');
          if (resource.visibility === 'classes' && resolvedTarget.classIds.some((classId) => !resource.allowedClassIds.includes(classId))) {
            return this.fail('FORBIDDEN');
          }
          const completionRule = reference.completionRule ?? defaultCompletionRule(resource.type);
          if (!isSupportedCompletionRule(resource.type, completionRule)) {
            return this.fail('VALIDATION_ERROR', { itemRefs: '任务内容的完成规则无效。' });
          }
          frozenItems.push({
            id: reference.id,
            resourceId: resource.id,
            resourceVersion: resource.contentVersion,
            snapshotSchemaVersion: 1,
            resourceSnapshot: { title: resource.title, type: resource.type, payload: resource.payload },
            completionRule,
            scoringRule: reference.scoringRule ?? defaultScoringRule(),
            order: reference.order,
          });
        }

        const memberships = resolvedTarget.memberships;
        const byStudent = new Map(memberships.map((membership) => [membership.studentId, membership]));
        if (byStudent.size === 0) return this.fail('VALIDATION_ERROR', { targetClassIds: '布置对象中没有有效学生。' });
        if (byStudent.size > 50) return this.fail('VALIDATION_ERROR', { targetClassIds: '单次发布最多包含 50 名学生。' });
        for (const membership of byStudent.values()) {
          if (await transaction.findAssignment(actor.organizationId, taskId, membership.studentId) !== null) return this.fail('CONFLICT');
        }
        const now = this.clock.nowIso();
        const published: TaskRecord = {
          ...current,
          status: Date.parse(current.startsAt) > Date.parse(now) ? 'scheduled' : 'active',
          targetClassIds: resolvedTarget.classIds,
          targetStudentIds: [...byStudent.keys()].sort(),
          items: frozenItems,
          publishedAt: now,
          version: current.version + 1,
        };
        await transaction.saveTask(published);
        for (const membership of byStudent.values()) {
          await transaction.saveAssignment({
            id: `assignment_${taskId}_${membership.studentId}`,
            organizationId: actor.organizationId,
            taskId,
            studentId: membership.studentId,
            classId: membership.classId,
            status: 'not_started',
            latestSubmissionId: null,
            latestSubmissionVersion: 0,
            redoCount: 0,
            redoDueAt: null,
            isLate: false,
            submittedAt: null,
            reviewedAt: null,
            version: 1,
          });
        }
        const result = success<JsonObject>({
          taskId,
          version: published.version,
          assignmentCount: byStudent.size,
          publishedAt: now,
        }, createMeta(this.clock, this.requestIds));
        await this.appendAudit(transaction, {
          actor,
          requestId: result.meta.requestId,
          action: 'task.publish',
          targetType: 'task',
          targetId: taskId,
          result: 'succeeded',
          metadata: { taskVersion: published.version, assignmentCount: byStudent.size },
        });
        return result;
      },
    });
  }

  public async updatePublishedTask(
    actor: TrustedActorContext,
    input: UpdatePublishedTaskInput,
    expectedVersion: number,
    operationId: string,
  ): Promise<ServiceResult<JsonObject>> {
    const validation = validatePublishedTaskUpdate(input);
    if (validation !== null) return this.fail('VALIDATION_ERROR', validation);
    const preparedTask = await this.repository.findTask(actor.organizationId, input.taskId);
    const preparedMembershipGuards = input.targetType === 'classes'
      ? await this.prepareClassMembershipGuards(actor.organizationId, input.targetClassIds ?? [])
      : [];
    const [preparedAssignments, preparedSubmissions, preparedMemberships] = preparedTask === null
      ? [[], [], []] as const
      : await Promise.all([
          this.repository.listTaskAssignments(actor.organizationId, input.taskId),
          this.repository.listTaskSubmissions(actor.organizationId, input.taskId),
          input.targetType === 'classes'
            ? this.repository.listActiveClassMemberships(actor.organizationId, input.targetClassIds ?? [])
            : input.targetType === 'students'
              ? this.repository.listActiveStudentMemberships(actor.organizationId, input.targetStudentIds ?? [])
              : Promise.resolve([]),
        ]);
    const preparedClassIds = preparedTask === null
      ? []
      : unique(preparedTask.targetClassIds.concat(preparedMemberships.map((membership) => membership.classId)));
    const scope = await this.prepareScope(actor, {
      classIds: preparedClassIds,
      resourceIds: input.itemRefs?.map((item) => item.resourceId) ?? preparedTask?.itemRefs.map((item) => item.resourceId) ?? [],
      memberships: preparedMemberships,
      assignments: preparedAssignments,
      submissions: preparedSubmissions,
      classMembershipGuards: preparedMembershipGuards,
    });
    return this.executeAtomic({
      actor,
      functionName: 'task-command',
      action: 'updatePublishedTask',
      operationId,
      expectedVersion,
      payload: publishedTaskUpdatePayload(input),
      scope,
      perform: async (transaction) => {
        const current = await transaction.findTask(actor.organizationId, input.taskId);
        if (current === null || current.visibility !== 'visible') return this.fail('NOT_FOUND');
        if (current.creatorTeacherId !== actor.actorUserId || current.status === 'draft') return this.fail('FORBIDDEN');
        if (current.version !== expectedVersion) return this.fail('CONFLICT');
        if (!(await this.canTeacherAccessAllInTransaction(transaction, actor, current.targetClassIds, 'task.publish'))) return this.fail('FORBIDDEN');

        const now = this.clock.nowIso();
        const lifecycle = effectiveLifecycleStatus(current, now);
        if (lifecycle === 'withdrawn' || lifecycle === 'closed' || lifecycle === 'completed') return this.fail('CONFLICT');
        const updatesScheduleOnly = input.title !== undefined
          || input.itemRefs !== undefined
          || input.targetType !== undefined
          || input.startsAt !== undefined
          || input.latePolicy !== undefined;
        if (lifecycle !== 'scheduled' && updatesScheduleOnly) {
          return this.fail('VALIDATION_ERROR', { payload: '进行中或已过期任务只能延长截止时间、修改任务描述和教师备注。' });
        }

        const nextStartsAt = input.startsAt ?? current.startsAt;
        const nextDueAt = input.dueAt ?? current.dueAt;
        if (!isZonedIso(nextStartsAt) || !isZonedIso(nextDueAt) || Date.parse(nextDueAt) <= Date.parse(nextStartsAt)) {
          return this.fail('VALIDATION_ERROR', { dueAt: '截止时间必须晚于开始时间。' });
        }
        let deadlineExtendedAt = current.deadlineExtendedAt;
        if (lifecycle !== 'scheduled' && input.dueAt !== undefined) {
          if (deadlineExtendedAt !== null) return this.fail('CONFLICT');
          if (Date.parse(input.dueAt) <= Date.parse(current.dueAt) || Date.parse(input.dueAt) <= Date.parse(now)) {
            return this.fail('VALIDATION_ERROR', { dueAt: '截止时间只能向后延长且必须晚于当前时间。' });
          }
          deadlineExtendedAt = now;
        }

        let nextItemRefs = current.itemRefs;
        let nextItems = current.items;
        let nextTargetType = current.targetType;
        let nextTargetClassIds = current.targetClassIds;
        let nextTargetStudentIds = current.targetStudentIds;
        let assignmentCount: number | null = null;
        let nextMembershipsForReconciliation: readonly ClassMembershipRecord[] | null = null;
        if (lifecycle === 'scheduled') {
          const existingAssignments = await transaction.listTaskAssignments(actor.organizationId, current.id);
          const existingSubmissions = await transaction.listTaskSubmissions(actor.organizationId, current.id);
          if (existingSubmissions.length > 0 || existingAssignments.some((assignment) => assignment.latestSubmissionId !== null)) {
            return this.fail('CONFLICT');
          }

          const targetChanged = input.targetType !== undefined;
          if (targetChanged) {
            const targetInput: SaveTaskDraftInput = {
              title: input.title ?? current.title,
              itemRefs: input.itemRefs ?? current.itemRefs,
              targetType: input.targetType,
              targetClassIds: input.targetClassIds ?? [],
              targetStudentIds: input.targetStudentIds ?? [],
              startsAt: nextStartsAt,
              dueAt: nextDueAt,
              latePolicy: input.latePolicy ?? current.latePolicy,
              ...(input.description === undefined ? {} : { description: input.description }),
              ...(input.teacherNote === undefined ? {} : { teacherNote: input.teacherNote }),
            };
            const targetValidation = validateTaskDraft(targetInput);
            if (targetValidation !== null) return this.fail('VALIDATION_ERROR', targetValidation);
            const resolvedTarget = await resolveTargetMemberships(transaction, actor.organizationId, targetInput);
            if (!resolvedTarget.ok) return this.fail('VALIDATION_ERROR', resolvedTarget.fieldErrors);
            const resolvedMemberships = uniqueMembershipsByStudent(resolvedTarget.memberships);
            if (resolvedMemberships.length < 1 || resolvedMemberships.length > 50) {
              return this.fail('VALIDATION_ERROR', { target: '布置对象须包含 1—50 名有效学生。' });
            }
            if (!(await this.canTeacherAccessAllInTransaction(transaction, actor, resolvedTarget.classIds, 'task.publish'))) return this.fail('FORBIDDEN');
            if (!(await this.canTeacherAccessAllInTransaction(transaction, actor, resolvedTarget.classIds, 'content.read'))) return this.fail('FORBIDDEN');
            nextTargetType = input.targetType as 'classes' | 'students';
            nextTargetClassIds = resolvedTarget.classIds;
            nextTargetStudentIds = resolvedMemberships.map((membership) => membership.studentId).sort();
            nextMembershipsForReconciliation = resolvedMemberships;
            assignmentCount = resolvedMemberships.length;
          } else {
            if (!(await this.canTeacherAccessAllInTransaction(transaction, actor, current.targetClassIds, 'content.read'))) return this.fail('FORBIDDEN');
            assignmentCount = existingAssignments.length;
          }

          if (input.itemRefs !== undefined || targetChanged) {
            nextItemRefs = (input.itemRefs ?? current.itemRefs).map((item) => normalizeItemReference(item));
            const frozen = await freezeTaskItemReferences(transaction, actor.organizationId, nextItemRefs, nextTargetClassIds);
            if (!frozen.ok) return this.fail(frozen.code, frozen.fieldErrors);
            nextItems = frozen.items;
          }
          if (nextMembershipsForReconciliation !== null) {
            await reconcileScheduledAssignments(transaction, current, existingAssignments, nextMembershipsForReconciliation);
          }
        }

        const next: TaskRecord = {
          ...current,
          title: input.title?.trim() ?? current.title,
          itemRefs: nextItemRefs,
          items: nextItems,
          targetType: nextTargetType,
          targetClassIds: nextTargetClassIds,
          targetStudentIds: nextTargetStudentIds,
          startsAt: nextStartsAt,
          dueAt: nextDueAt,
          latePolicy: input.latePolicy === undefined ? current.latePolicy : { ...input.latePolicy },
          description: input.description === undefined ? current.description : cleanOptional(input.description),
          teacherNote: input.teacherNote === undefined ? current.teacherNote : cleanOptional(input.teacherNote),
          deadlineExtendedAt,
          status: lifecycleStatusForTimes(current.status, nextStartsAt, nextDueAt, now),
          version: current.version + 1,
        };
        await transaction.saveTask(next);
        const result = success<JsonObject>({ taskId: next.id, status: next.status, version: next.version, dueAt: next.dueAt }, createMeta(this.clock, this.requestIds));
        await this.appendAudit(transaction, {
          actor,
          requestId: result.meta.requestId,
          action: 'task.updatePublished',
          targetType: 'task',
          targetId: next.id,
          result: 'succeeded',
          metadata: {
            taskVersion: next.version,
            deadlineExtended: deadlineExtendedAt !== current.deadlineExtendedAt,
            targetChanged: input.targetType !== undefined,
            contentChanged: input.itemRefs !== undefined,
            assignmentCount,
          },
        });
        return result;
      },
    });
  }

  public async withdrawTask(
    actor: TrustedActorContext,
    taskId: string,
    reason: string,
    expectedVersion: number,
    operationId: string,
  ): Promise<ServiceResult<JsonObject>> {
    const cleanedReason = cleanOptional(reason);
    if (cleanedReason === null || cleanedReason.length > 200) return this.fail('VALIDATION_ERROR', { reason: '撤回原因须为 1—200 字。' });
    const preparedTask = await this.repository.findTask(actor.organizationId, taskId);
    const scope = await this.prepareScope(actor, { classIds: preparedTask?.targetClassIds ?? [] });
    return this.executeAtomic({
      actor,
      functionName: 'task-command',
      action: 'withdrawTask',
      operationId,
      expectedVersion,
      payload: { taskId, reason: cleanedReason },
      scope,
      perform: async (transaction) => {
        const current = await transaction.findTask(actor.organizationId, taskId);
        if (current === null || current.visibility !== 'visible') return this.fail('NOT_FOUND');
        if (current.creatorTeacherId !== actor.actorUserId || current.status === 'draft') return this.fail('FORBIDDEN');
        if (current.version !== expectedVersion) return this.fail('CONFLICT');
        if (!(await this.canTeacherAccessAllInTransaction(transaction, actor, current.targetClassIds, 'task.publish'))) return this.fail('FORBIDDEN');
        const now = this.clock.nowIso();
        if (effectiveLifecycleStatus(current, now) !== 'scheduled') return this.fail('CONFLICT');
        const next: TaskRecord = {
          ...current,
          status: 'withdrawn',
          withdrawnAt: now,
          withdrawnBy: actor.actorUserId,
          withdrawReason: cleanedReason,
          version: current.version + 1,
        };
        await transaction.saveTask(next);
        const result = success<JsonObject>({ taskId, status: next.status, version: next.version, withdrawnAt: now }, createMeta(this.clock, this.requestIds));
        await this.appendAudit(transaction, {
          actor, requestId: result.meta.requestId, action: 'task.withdraw', targetType: 'task', targetId: taskId,
          result: 'succeeded', metadata: { taskVersion: next.version, reasonLength: cleanedReason.length },
        });
        return result;
      },
    });
  }

  public async recycleTask(
    actor: TrustedActorContext,
    taskId: string,
    reason: string,
    expectedVersion: number,
    operationId: string,
  ): Promise<ServiceResult<JsonObject>> {
    const cleanedReason = cleanOptional(reason);
    if (cleanedReason === null || cleanedReason.length > 200) return this.fail('VALIDATION_ERROR', { reason: '删除原因须为 1—200 字。' });
    const preparedTask = await this.repository.findTask(actor.organizationId, taskId);
    const scope = await this.prepareScope(actor, { classIds: preparedTask?.targetClassIds ?? [] });
    return this.executeAtomic({
      actor,
      functionName: 'task-command',
      action: 'recycleTask',
      operationId,
      expectedVersion,
      payload: { taskId, reason: cleanedReason },
      scope,
      perform: async (transaction) => {
        const current = await transaction.findTask(actor.organizationId, taskId);
        if (current === null || current.visibility === 'recycled') return this.fail('NOT_FOUND');
        if (current.creatorTeacherId !== actor.actorUserId || current.status === 'draft') return this.fail('FORBIDDEN');
        if (current.version !== expectedVersion) return this.fail('CONFLICT');
        if (!(await this.canTeacherAccessAllInTransaction(transaction, actor, current.targetClassIds, 'task.publish'))) return this.fail('FORBIDDEN');
        const now = this.clock.nowIso();
        const next: TaskRecord = {
          ...current,
          status: effectiveLifecycleStatus(current, now),
          visibility: 'recycled',
          recycledAt: now,
          recycledBy: actor.actorUserId,
          recycleReason: cleanedReason,
          recoverableUntil: addDays(now, 7),
          version: current.version + 1,
        };
        await transaction.saveTask(next);
        const result = success<JsonObject>({ taskId, visibility: next.visibility, version: next.version, recoverableUntil: next.recoverableUntil }, createMeta(this.clock, this.requestIds));
        await this.appendAudit(transaction, {
          actor, requestId: result.meta.requestId, action: 'task.recycle', targetType: 'task', targetId: taskId,
          result: 'succeeded', metadata: { taskVersion: next.version, recoverableUntil: next.recoverableUntil },
        });
        return result;
      },
    });
  }

  public async saveSubmissionDraft(
    actor: TrustedActorContext,
    taskId: string,
    answers: readonly SubmissionAnswer[],
    expectedAssignmentVersion: number,
    expectedDraftRecordVersion: number | undefined,
    operationId: string,
  ): Promise<ServiceResult<JsonObject>> {
    return this.executeStudentSubmission(actor, 'saveDraft', taskId, answers, expectedAssignmentVersion, expectedDraftRecordVersion, operationId);
  }

  public async submit(
    actor: TrustedActorContext,
    taskId: string,
    answers: readonly SubmissionAnswer[],
    expectedAssignmentVersion: number,
    expectedDraftRecordVersion: number | undefined,
    operationId: string,
  ): Promise<ServiceResult<JsonObject>> {
    return this.executeStudentSubmission(actor, 'submit', taskId, answers, expectedAssignmentVersion, expectedDraftRecordVersion, operationId);
  }

  public async publishReview(
    actor: TrustedActorContext,
    input: Readonly<{
      submissionId: string;
      decision: 'approved' | 'returned';
      score?: number;
      textComment?: string;
      returnReason?: string;
      expectedSubmissionVersion: number;
    }>,
    expectedAssignmentVersion: number,
    operationId: string,
  ): Promise<ServiceResult<JsonObject>> {
    const reviewValidation = validateReview(input);
    if (reviewValidation !== null) return this.fail('VALIDATION_ERROR', reviewValidation);
    const preparedSubmission = await this.repository.findSubmission(actor.organizationId, input.submissionId);
    const preparedAssignment = preparedSubmission === null
      ? null
      : await this.repository.findAssignmentById(actor.organizationId, preparedSubmission.assignmentId);
    const preparedFeedback = preparedSubmission === null
      ? null
      : await this.repository.findFeedbackBySubmission(actor.organizationId, preparedSubmission.id);
    if (preparedFeedback !== null) return this.fail('CONFLICT');
    const scope = await this.prepareScope(actor, {
      classIds: preparedAssignment === null ? [] : [preparedAssignment.classId],
      assignments: preparedAssignment === null ? [] : [preparedAssignment],
      submissions: preparedSubmission === null ? [] : [preparedSubmission],
    });
    return this.executeAtomic({
      actor,
      functionName: 'review-command',
      action: 'publishReview',
      operationId,
      expectedVersion: expectedAssignmentVersion,
      payload: reviewPayload(input),
      scope,
      perform: async (transaction) => {
        const submission = await transaction.findSubmission(actor.organizationId, input.submissionId);
        if (submission === null) return this.fail('NOT_FOUND');
        const assignment = await transaction.findAssignmentById(actor.organizationId, submission.assignmentId);
        if (assignment === null) return this.fail('NOT_FOUND');
        if (!(await this.canTeacherAccessAllInTransaction(transaction, actor, [assignment.classId], 'submission.review'))) return this.fail('FORBIDDEN');
        if (assignment.version !== expectedAssignmentVersion || submission.submissionVersion !== input.expectedSubmissionVersion) return this.fail('CONFLICT');
        if (submission.status !== 'submitted' || assignment.latestSubmissionId !== submission.id || assignment.status !== 'awaiting_review') return this.fail('CONFLICT');
        if (input.decision === 'returned' && assignment.redoCount >= MAX_REDO_COUNT) return this.fail('REDO_LIMIT_REACHED');

        const now = this.clock.nowIso();
        const feedback: ReviewFeedbackRecord = {
          id: this.ids.next('feedback'),
          organizationId: actor.organizationId,
          taskId: submission.taskId,
          assignmentId: assignment.id,
          submissionId: submission.id,
          submissionVersion: submission.submissionVersion,
          teacherId: actor.actorUserId,
          decision: input.decision,
          score: input.score ?? null,
          textComment: cleanOptional(input.textComment),
          returnReason: input.decision === 'returned' ? cleanOptional(input.returnReason) : null,
          publishedAt: now,
          source: 'manual',
        };
        await transaction.saveFeedback(feedback);
        await transaction.saveSubmission({ ...submission, status: input.decision === 'returned' ? 'returned' : 'reviewed' });
        const nextAssignment: TaskAssignmentRecord = input.decision === 'returned'
          ? {
              ...assignment,
              status: 'redo_required',
              redoCount: assignment.redoCount + 1,
              redoDueAt: addDays(now, REDO_DAYS),
              reviewedAt: now,
              version: assignment.version + 1,
            }
          : {
              ...assignment,
              status: 'completed',
              redoDueAt: null,
              reviewedAt: now,
              version: assignment.version + 1,
            };
        await transaction.saveAssignment(nextAssignment);
        const result = success<JsonObject>({
          feedbackId: feedback.id,
          submissionId: submission.id,
          submissionVersion: submission.submissionVersion,
          decision: feedback.decision,
          assignmentVersion: nextAssignment.version,
        }, createMeta(this.clock, this.requestIds));
        await this.appendAudit(transaction, {
          actor,
          requestId: result.meta.requestId,
          action: input.decision === 'returned' ? 'submission.return' : 'submission.review',
          targetType: 'submission',
          targetId: submission.id,
          result: 'succeeded',
          metadata: { submissionVersion: submission.submissionVersion, decision: input.decision },
        });
        return result;
      },
    });
  }

  public async publishBatchComment(
    actor: TrustedActorContext,
    previewToken: string,
    previewVersion: number,
    textComment: string,
    operationId: string,
  ): Promise<ServiceResult<JsonObject>> {
    const encodedIntent = this.batchReviewPreviewCodec?.decode(previewToken) ?? null;
    const intent = encodedIntent === null ? null : parseBatchReviewPreviewIntent(encodedIntent);
    if (intent === null) return this.fail('CONFLICT');
    if (actor.actorRole !== 'teacher'
      || actor.organizationId !== intent.actor.organizationId
      || actor.actorUserId !== intent.actor.actorUserId
      || actor.authzVersion !== intent.actor.authzVersion) return this.fail('FORBIDDEN');
    if (previewVersion !== intent.previewVersion || textComment !== intent.comment) return this.fail('CONFLICT');
    const comment = cleanOptional(textComment);
    if (comment === null || textComment.length > 300) {
      return this.fail('VALIDATION_ERROR', { comment: '批量点评须为 1—300 字。' });
    }
    if (intent.eligible.length === 0) {
      return this.fail('VALIDATION_ERROR', { previewToken: '当前预览没有可点评的提交。' });
    }

    const preparedTask = await this.repository.findTask(actor.organizationId, intent.task.id);
    if (preparedTask === null) return this.fail('NOT_FOUND');
    const preparedAssignments = scopeBatchAssignments(
      await this.repository.listTaskAssignments(actor.organizationId, intent.task.id),
      intent,
    );
    const preparedSubmissions = (await Promise.all(preparedAssignments
      .filter((assignment) => assignment.latestSubmissionId !== null)
      .map((assignment) => this.repository.findSubmission(actor.organizationId, assignment.latestSubmissionId as string))))
      .filter((submission): submission is SubmissionRecord => submission !== null);
    const scope = await this.prepareScope(actor, {
      classIds: intent.authorizedClassIds,
      assignments: preparedAssignments,
      submissions: preparedSubmissions,
    });

    return this.executeAtomic({
      actor,
      functionName: 'review-command',
      action: 'publishBatchComment',
      operationId,
      expectedVersion: previewVersion,
      payload: { previewToken, previewVersion, textComment },
      scope,
      perform: async (transaction) => {
        const nowTime = Date.parse(this.clock.nowIso());
        if (nowTime < Date.parse(intent.issuedAt) || nowTime > Date.parse(intent.expiresAt)) return this.fail('CONFLICT');
        const task = await transaction.findTask(actor.organizationId, intent.task.id);
        if (task === null) return this.fail('NOT_FOUND');
        if (task.version !== intent.task.version || previewVersion !== intent.previewVersion) return this.fail('CONFLICT');
        if (!(await this.canTeacherAccessAllInTransaction(
          transaction,
          actor,
          intent.authorizedClassIds,
          'submission.review',
        ))) return this.fail('FORBIDDEN');

        const assignments = scopeBatchAssignments(
          await transaction.listTaskAssignments(actor.organizationId, intent.task.id),
          intent,
        );
        const eligible = await collectEligibleBatchSubmissions(transaction, actor.organizationId, intent.task.id, assignments, intent);
        if (!sameEligibleBatch(eligible.map((item) => item.preview), intent.eligible)) return this.fail('CONFLICT');

        const now = this.clock.nowIso();
        const feedbackIds: string[] = [];
        const submissionIds: string[] = [];
        for (const item of eligible) {
          const feedback: ReviewFeedbackRecord = {
            id: this.ids.next('feedback'),
            organizationId: actor.organizationId,
            taskId: intent.task.id,
            assignmentId: item.assignment.id,
            submissionId: item.submission.id,
            submissionVersion: item.submission.submissionVersion,
            teacherId: actor.actorUserId,
            decision: 'approved',
            score: null,
            textComment: comment,
            returnReason: null,
            publishedAt: now,
            source: 'manual',
          };
          await transaction.saveFeedback(feedback);
          await transaction.saveSubmission({ ...item.submission, status: 'reviewed' });
          await transaction.saveAssignment({
            ...item.assignment,
            status: 'completed',
            redoDueAt: null,
            reviewedAt: now,
            version: item.assignment.version + 1,
          });
          feedbackIds.push(feedback.id);
          submissionIds.push(item.submission.id);
        }
        const result = success<JsonObject>({
          taskId: intent.task.id,
          reviewedCount: eligible.length,
          feedbackIds,
          submissionIds,
        }, createMeta(this.clock, this.requestIds));
        await this.appendAudit(transaction, {
          actor,
          requestId: result.meta.requestId,
          action: 'submission.batch_comment',
          targetType: 'task',
          targetId: intent.task.id,
          result: 'succeeded',
          metadata: {
            reviewedCount: eligible.length,
            previewVersion: intent.previewVersion,
            submissionIds,
          },
        });
        return result;
      },
    });
  }

  public async getParentTaskResult(
    actor: TrustedActorContext,
    studentId: string,
    taskId: string,
  ): Promise<ServiceResult<ParentTaskResultView>> {
    const decision = await this.authorization.canParentReadStudent(actor, studentId);
    if (!decision.allowed) return this.fail(decision.reason);
    const assignment = await this.repository.findAssignment(actor.organizationId, taskId, studentId);
    if (assignment === null) return this.fail('NOT_FOUND');
    const task = await this.repository.findTask(actor.organizationId, taskId);
    if (task === null || task.status === 'draft' || task.status === 'withdrawn' || (task.visibility === 'recycled' && assignment.latestSubmissionId === null)) return this.fail('NOT_FOUND');
    const submission = assignment.latestSubmissionId === null
      ? null
      : await this.repository.findSubmission(actor.organizationId, assignment.latestSubmissionId);
    const feedback = submission === null ? null : await this.repository.findFeedbackBySubmission(actor.organizationId, submission.id);
    return success({
      taskId: task.id,
      title: task.title,
      studentId,
      assignmentStatus: assignment.status,
      submission: submission === null || submission.submittedAt === null ? null : {
        id: submission.id,
        version: submission.submissionVersion,
        answers: submission.answers,
        submittedAt: submission.submittedAt,
      },
      feedback: feedback === null ? null : {
        id: feedback.id,
        decision: feedback.decision,
        score: feedback.score,
        textComment: feedback.textComment,
        returnReason: feedback.returnReason,
        publishedAt: feedback.publishedAt,
      },
    }, createMeta(this.clock, this.requestIds));
  }

  public async getSubmissionForReview(
    actor: TrustedActorContext,
    submissionId: string,
  ): Promise<ServiceResult<TeacherSubmissionReviewView>> {
    const submission = await this.repository.findSubmission(actor.organizationId, submissionId);
    if (submission === null || submission.submittedAt === null || submission.status === 'draft') return this.fail('NOT_FOUND');
    const assignment = await this.repository.findAssignmentById(actor.organizationId, submission.assignmentId);
    if (assignment === null) return this.fail('NOT_FOUND');
    if (!(await this.canTeacherAccessAll(actor, [assignment.classId], 'submission.review'))) return this.fail('NOT_FOUND');
    const task = await this.repository.findTask(actor.organizationId, submission.taskId);
    if (task === null) return this.fail('NOT_FOUND');
    return success({
      taskId: task.id,
      taskTitle: task.title,
      assignmentId: assignment.id,
      assignmentVersion: assignment.version,
      studentId: assignment.studentId,
      submissionId: submission.id,
      submissionVersion: submission.submissionVersion,
      answers: submission.answers,
      isLate: submission.isLate,
      submittedAt: submission.submittedAt,
    }, createMeta(this.clock, this.requestIds));
  }

  private async executeStudentSubmission(
    actor: TrustedActorContext,
    action: 'saveDraft' | 'submit',
    taskId: string,
    answers: readonly SubmissionAnswer[],
    expectedAssignmentVersion: number,
    expectedDraftRecordVersion: number | undefined,
    operationId: string,
  ): Promise<ServiceResult<JsonObject>> {
    if (actor.actorRole !== 'student') return this.fail('FORBIDDEN');
    if (hasDuplicateAnswerItems(answers)) return this.fail('VALIDATION_ERROR', { answers: '同一任务项不能重复作答。' });
    return this.executeAtomic({
      actor,
      functionName: 'submission-command',
      action,
      operationId,
      expectedVersion: expectedAssignmentVersion,
      payload: {
        taskId,
        answers: answers.map((answer) => ({ itemId: answer.itemId, value: answer.value })),
        expectedDraftRecordVersion: expectedDraftRecordVersion ?? null,
      },
      perform: async (transaction) => {
        const assignment = await transaction.findAssignment(actor.organizationId, taskId, actor.actorUserId);
        if (assignment === null) return this.fail('NOT_FOUND');
        if (assignment.version !== expectedAssignmentVersion) return this.fail('CONFLICT');
        const task = await transaction.findTask(actor.organizationId, taskId);
        if (task === null) return this.fail('NOT_FOUND');
        if (!isSubmittable(task, assignment, this.clock.nowIso())) return this.fail('TASK_NOT_SUBMITTABLE');
        const validItemIds = new Set(task.items.map((item) => item.id));
        if (answers.some((answer) => !validItemIds.has(answer.itemId))) return this.fail('VALIDATION_ERROR', { answers: '包含不属于当前任务的作答项。' });
        if (action === 'submit' && (answers.length !== task.items.length || validItemIds.size !== new Set(answers.map((answer) => answer.itemId)).size)) {
          return this.fail('VALIDATION_ERROR', { answers: '请完成全部任务项后提交。' });
        }
        if (action === 'submit') {
          const answersByItem = new Map(answers.map((answer) => [answer.itemId, answer]));
          for (const item of task.items) {
            const answer = answersByItem.get(item.id);
            if (answer === undefined || !satisfiesCompletionRule(item, answer.value)) {
              return this.fail('VALIDATION_ERROR', { answers: '任务完成结果不符合已发布的完成规则。' });
            }
          }
        }

        const submissionVersion = assignment.latestSubmissionVersion + 1;
        const draft = await transaction.findDraftSubmission(actor.organizationId, assignment.id, submissionVersion);
        if (draft === null && expectedDraftRecordVersion !== undefined && expectedDraftRecordVersion !== 0) return this.fail('CONFLICT');
        if (draft !== null && draft.recordVersion !== expectedDraftRecordVersion) return this.fail('CONFLICT');
        const now = this.clock.nowIso();
        const late = Date.parse(now) > Date.parse(task.dueAt);
        const submission: SubmissionRecord = {
          id: draft?.id ?? `submission_${assignment.id}_${submissionVersion}`,
          organizationId: actor.organizationId,
          taskId,
          assignmentId: assignment.id,
          studentId: actor.actorUserId,
          submissionVersion,
          recordVersion: (draft?.recordVersion ?? 0) + 1,
          status: action === 'submit' ? 'submitted' : 'draft',
          answers: answers.map((answer) => ({ ...answer })),
          isLate: late,
          submittedAt: action === 'submit' ? now : null,
          supersedesSubmissionId: assignment.latestSubmissionId,
        };
        await transaction.saveSubmission(submission);
        const nextAssignment: TaskAssignmentRecord = {
          ...assignment,
          status: action === 'submit' ? 'awaiting_review' : 'in_progress',
          latestSubmissionId: action === 'submit' ? submission.id : assignment.latestSubmissionId,
          latestSubmissionVersion: action === 'submit' ? submission.submissionVersion : assignment.latestSubmissionVersion,
          isLate: action === 'submit' ? late : assignment.isLate,
          submittedAt: action === 'submit' ? now : assignment.submittedAt,
          version: assignment.version + 1,
        };
        await transaction.saveAssignment(nextAssignment);
        const result = success<JsonObject>({
          submissionId: submission.id,
          submissionVersion: submission.submissionVersion,
          recordVersion: submission.recordVersion,
          assignmentVersion: nextAssignment.version,
          status: submission.status,
          submittedAt: submission.submittedAt,
        }, createMeta(this.clock, this.requestIds));
        if (action === 'submit') {
          await this.appendAudit(transaction, {
            actor,
            requestId: result.meta.requestId,
            action: 'submission.submit',
            targetType: 'submission',
            targetId: submission.id,
            result: 'succeeded',
            metadata: { submissionVersion: submission.submissionVersion, isLate: submission.isLate },
          });
        }
        return result;
      },
    });
  }

  private async executeAtomic<T extends JsonValue>(input: Readonly<{
    actor: TrustedActorContext;
    functionName: FunctionName;
    action: string;
    operationId: string;
    payload: JsonValue;
    expectedVersion?: number;
    scope?: TaskCoreTransactionScope;
    perform: (transaction: TaskCoreTransaction) => Promise<ServiceResult<T>>;
  }>): Promise<ServiceResult<T>> {
    const fingerprint = createOperationFingerprint({
      organizationId: input.actor.organizationId,
      actorUserId: input.actor.actorUserId,
      functionName: input.functionName,
      action: input.action,
      operationId: input.operationId,
      payload: input.payload,
      ...(input.expectedVersion === undefined ? {} : { expectedVersion: input.expectedVersion }),
    });

    const preexisting = await this.repository.findIdempotencyRecord(fingerprint.recordId);
    if (preexisting !== null) {
      if (preexisting.requestHash !== fingerprint.requestHash || preexisting.status === 'processing') return this.fail('CONFLICT');
      if (preexisting.result === null) return this.fail('INTERNAL_ERROR');
      return preexisting.result as ServiceResult<T>;
    }

    try {
      return await this.repository.runTransaction(input.scope ?? emptyTaskCoreScope(input.actor.organizationId), async (transaction) => {
      const processing: IdempotencyRecord = {
        id: fingerprint.recordId,
        organizationId: input.actor.organizationId,
        actorUserId: input.actor.actorUserId,
        functionName: input.functionName,
        action: input.action,
        operationId: input.operationId,
        requestHash: fingerprint.requestHash,
        status: 'processing',
        result: null,
      };
      if (!(await transaction.createIdempotencyRecord(processing))) {
        throw new IdempotencyCollisionError();
      }

      const result = await input.perform(transaction);
      await transaction.replaceIdempotencyRecord({
        ...processing,
        status: result.ok ? 'succeeded' : 'failed',
        result: result as ServiceResult<JsonValue>,
      });
      return result;
      });
    } catch (error: unknown) {
      // A concurrent identical request may commit after this transaction's
      // deterministic create collides. Re-read outside the aborted transaction
      // and return the stable first result when it is now available.
      const completed = await this.repository.findIdempotencyRecord(fingerprint.recordId);
      if (completed !== null && completed.requestHash === fingerprint.requestHash
        && completed.status === 'succeeded' && completed.result !== null) {
        return completed.result as ServiceResult<T>;
      }
      if (error instanceof IdempotencyCollisionError) return this.fail('CONFLICT');
      throw error;
    }
  }

  private async appendAudit(transaction: TaskCoreTransaction, input: Readonly<{
    actor: TrustedActorContext;
    requestId: string;
    action: string;
    targetType: string;
    targetId: string | null;
    result: 'succeeded' | 'denied' | 'failed';
    errorCode?: ErrorCode;
    metadata?: Readonly<Record<string, JsonValue>>;
  }>): Promise<void> {
    const entry: OperationLogRecord = {
      id: this.ids.next('log'),
      organizationId: input.actor.organizationId,
      requestId: input.requestId,
      actorUserId: input.actor.actorUserId,
      actorRole: input.actor.actorRole,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      result: input.result,
      errorCode: input.errorCode ?? null,
      occurredAt: this.clock.nowIso(),
      metadata: input.metadata ?? {},
    };
    await transaction.appendOperationLog(entry);
  }

  private async canTeacherAccessAllInTransaction(
    transaction: TaskCoreTransaction,
    actor: TrustedActorContext,
    classIds: readonly string[],
    permission: string,
  ): Promise<boolean> {
    if (actor.actorRole !== 'teacher' || !hasPermission(actor, permission) || classIds.length === 0) return false;
    for (const classId of unique(classIds)) {
      if (!hasScope(actor, classId)) return false;
      const grant = await transaction.findActiveTeacherGrant(actor.organizationId, actor.actorUserId, classId);
      if (grant === null || !grant.permissions.includes(permission)) return false;
    }
    return true;
  }

  private async canTeacherAccessAll(actor: TrustedActorContext, classIds: readonly string[], permission: string): Promise<boolean> {
    if (classIds.length === 0) return false;
    for (const classId of unique(classIds)) {
      const decision = await this.authorization.canTeacherAccessClass(actor, classId, permission);
      if (!decision.allowed) return false;
    }
    return true;
  }

  private async prepareScope(actor: TrustedActorContext, input: Readonly<{
    classIds?: readonly string[];
    resourceIds?: readonly string[];
    memberships?: readonly ClassMembershipRecord[];
    assignments?: readonly TaskAssignmentRecord[];
    submissions?: readonly SubmissionRecord[];
    classMembershipGuards?: TaskCoreTransactionScope['classMembershipGuards'];
  }>): Promise<TaskCoreTransactionScope> {
    const classIds = unique(input.classIds ?? []);
    const grants = actor.actorRole === 'teacher' && classIds.length > 0
      ? await this.repository.listActiveTeacherGrants(actor.organizationId, actor.actorUserId, classIds)
      : [];
    return {
      organizationId: actor.organizationId,
      resourceIds: unique(input.resourceIds ?? []),
      membershipIds: unique((input.memberships ?? []).map((membership) => membership.id)),
      teacherGrantIds: unique(grants.map((grant) => grant._id)),
      assignmentIds: unique((input.assignments ?? []).map((assignment) => assignment.id)),
      submissionIds: unique((input.submissions ?? []).map((submission) => submission.id)),
      classMembershipGuards: input.classMembershipGuards ?? [],
    };
  }

  private async prepareClassMembershipGuards(
    organizationId: string,
    classIds: readonly string[],
  ): Promise<TaskCoreTransactionScope['classMembershipGuards']> {
    return Promise.all(unique(classIds).map(async (classId) => {
      const guard = await this.repository.findClassMembershipGuard(organizationId, classId);
      return { classId, expectedVersion: guard?.version ?? 0 };
    }));
  }

  private fail<T>(code: ErrorCode, fieldErrors?: Readonly<Record<string, string>>): ServiceResult<T> {
    return failure(code, createMeta(this.clock, this.requestIds), fieldErrors);
  }
}

class IdempotencyCollisionError extends Error {
  public constructor() { super('idempotency collision'); this.name = 'IdempotencyCollisionError'; }
}

type EligibleBatchRecord = Readonly<{
  preview: BatchReviewEligibleSubmission;
  assignment: TaskAssignmentRecord;
  submission: SubmissionRecord;
}>;

function scopeBatchAssignments(
  assignments: readonly TaskAssignmentRecord[],
  intent: BatchReviewPreviewIntent,
): readonly TaskAssignmentRecord[] {
  return assignments
    .filter((assignment) => intent.authorizedClassIds.includes(assignment.classId))
    .filter((assignment) => intent.filter.classId === undefined || assignment.classId === intent.filter.classId)
    .filter((assignment) => intent.filter.status === undefined || assignment.status === intent.filter.status);
}

async function collectEligibleBatchSubmissions(
  reader: TaskCoreReader,
  organizationId: string,
  taskId: string,
  assignments: readonly TaskAssignmentRecord[],
  intent: BatchReviewPreviewIntent,
): Promise<readonly EligibleBatchRecord[]> {
  const selectedIds = new Set(intent.selection.submissionIds);
  const eligible: EligibleBatchRecord[] = [];
  for (const assignment of assignments) {
    if (assignment.latestSubmissionId === null) continue;
    if (intent.selection.mode === 'ids' && !selectedIds.has(assignment.latestSubmissionId)) continue;
    const submission = await reader.findSubmission(organizationId, assignment.latestSubmissionId);
    if (submission === null
      || submission.taskId !== taskId
      || submission.assignmentId !== assignment.id
      || submission.studentId !== assignment.studentId
      || submission.submissionVersion !== assignment.latestSubmissionVersion
      || submission.status !== 'submitted'
      || submission.submittedAt === null
      || (assignment.status !== 'awaiting_review' && assignment.status !== 'completed')
      || await reader.findFeedbackBySubmission(organizationId, submission.id) !== null) continue;
    eligible.push({
      preview: {
        submissionId: submission.id,
        submissionVersion: submission.submissionVersion,
        submissionRecordVersion: submission.recordVersion,
        assignmentId: assignment.id,
        assignmentVersion: assignment.version,
        classId: assignment.classId,
      },
      assignment,
      submission,
    });
  }
  return eligible.sort((left, right) => left.preview.submissionId.localeCompare(right.preview.submissionId));
}

function sameEligibleBatch(
  current: readonly BatchReviewEligibleSubmission[],
  previewed: readonly BatchReviewEligibleSubmission[],
): boolean {
  const normalize = (items: readonly BatchReviewEligibleSubmission[]) => [...items]
    .sort((left, right) => left.submissionId.localeCompare(right.submissionId))
    .map((item) => [
      item.submissionId,
      item.submissionVersion,
      item.submissionRecordVersion,
      item.assignmentId,
      item.assignmentVersion,
      item.classId,
    ].join('|'));
  return JSON.stringify(normalize(current)) === JSON.stringify(normalize(previewed));
}

function validateTaskDraft(input: SaveTaskDraftInput): Readonly<Record<string, string>> | null {
  const errors: Record<string, string> = {};
  if (input.title.trim().length < 1 || input.title.trim().length > 50) errors.title = '任务名称须为 1—50 字。';
  if (input.itemRefs.length === 0) errors.itemRefs = '至少选择一个任务内容。';
  if (new Set(input.itemRefs.map((item) => item.id)).size !== input.itemRefs.length) errors.itemRefs = '任务项标识不能重复。';
  const targetType = input.targetType ?? 'classes';
  if (targetType === 'classes') {
    if (input.targetClassIds.length === 0) errors.targetClassIds = '至少选择一个班级。';
    if (new Set(input.targetClassIds).size !== input.targetClassIds.length) errors.targetClassIds = '班级标识不能重复。';
    if ((input.targetStudentIds?.length ?? 0) > 0) errors.targetStudentIds = '按班级布置时不能同时指定学员。';
  } else {
    if ((input.targetStudentIds?.length ?? 0) === 0) errors.targetStudentIds = '至少选择一个学员。';
    if (input.targetClassIds.length > 0) errors.targetClassIds = '按学员布置时不能同时指定班级。';
    if (new Set(input.targetStudentIds ?? []).size !== (input.targetStudentIds?.length ?? 0)) errors.targetStudentIds = '学员标识不能重复。';
    if ((input.targetStudentIds?.length ?? 0) > 50) errors.targetStudentIds = '单次发布最多包含 50 名学生。';
  }
  if (!isZonedIso(input.startsAt)) errors.startsAt = '开始时间必须为带时区的 ISO 8601 时间。';
  if (!isZonedIso(input.dueAt) || Date.parse(input.dueAt) <= Date.parse(input.startsAt)) errors.dueAt = '截止时间必须晚于开始时间。';
  if (!Number.isInteger(input.latePolicy.lateDays) || input.latePolicy.lateDays < 1 || input.latePolicy.lateDays > 30) errors.latePolicy = '补交天数须为 1—30 天。';
  if ((input.description?.trim().length ?? 0) > 300) errors.description = '任务描述最多 300 字。';
  if ((input.teacherNote?.trim().length ?? 0) > 100) errors.teacherNote = '教师备注最多 100 字。';
  return Object.keys(errors).length === 0 ? null : errors;
}

function validatePublishedTaskUpdate(input: UpdatePublishedTaskInput): Readonly<Record<string, string>> | null {
  const errors: Record<string, string> = {};
  if (
    input.title === undefined
    && input.itemRefs === undefined
    && input.targetType === undefined
    && input.startsAt === undefined
    && input.dueAt === undefined
    && input.latePolicy === undefined
    && input.description === undefined
    && input.teacherNote === undefined
  ) errors.payload = '至少提供一个需要修改的字段。';
  if (input.title !== undefined && (input.title.trim().length < 1 || input.title.trim().length > 50)) errors.title = '任务名称须为 1—50 字。';
  if (input.itemRefs !== undefined) {
    if (input.itemRefs.length === 0) errors.itemRefs = '至少选择一个任务内容。';
    if (new Set(input.itemRefs.map((item) => item.id)).size !== input.itemRefs.length) errors.itemRefs = '任务项标识不能重复。';
  }
  if (input.targetType === undefined && (input.targetClassIds !== undefined || input.targetStudentIds !== undefined)) {
    errors.target = '修改布置对象时必须提供对象类型。';
  }
  if (input.targetType === 'classes') {
    if ((input.targetClassIds?.length ?? 0) === 0) errors.targetClassIds = '至少选择一个班级。';
    if ((input.targetStudentIds?.length ?? 0) > 0) errors.targetStudentIds = '按班级布置时不能同时指定学员。';
  }
  if (input.targetType === 'students') {
    if ((input.targetStudentIds?.length ?? 0) === 0) errors.targetStudentIds = '至少选择一个学员。';
    if ((input.targetClassIds?.length ?? 0) > 0) errors.targetClassIds = '按学员布置时不能同时指定班级。';
  }
  if (input.startsAt !== undefined && !isZonedIso(input.startsAt)) errors.startsAt = '开始时间必须为带时区的 ISO 8601 时间。';
  if (input.dueAt !== undefined && !isZonedIso(input.dueAt)) errors.dueAt = '截止时间必须为带时区的 ISO 8601 时间。';
  if (input.latePolicy !== undefined && (!Number.isInteger(input.latePolicy.lateDays) || input.latePolicy.lateDays < 1 || input.latePolicy.lateDays > 30)) {
    errors.latePolicy = '补交天数须为 1—30 天。';
  }
  if ((input.description?.trim().length ?? 0) > 300) errors.description = '任务描述最多 300 字。';
  if ((input.teacherNote?.trim().length ?? 0) > 100) errors.teacherNote = '教师备注最多 100 字。';
  return Object.keys(errors).length === 0 ? null : errors;
}

function validateReview(input: Readonly<{ decision: 'approved' | 'returned'; score?: number; textComment?: string; returnReason?: string }>): Readonly<Record<string, string>> | null {
  const errors: Record<string, string> = {};
  if (input.score !== undefined && (!Number.isFinite(input.score) || input.score < 0 || input.score > 100)) errors.score = '评分须为 0—100。';
  if ((input.textComment?.trim().length ?? 0) > 500) errors.textComment = '点评最多 500 字。';
  if (input.decision === 'returned' && cleanOptional(input.returnReason) === null) errors.returnReason = '退回重做必须填写原因。';
  if ((input.returnReason?.trim().length ?? 0) > 200) errors.returnReason = '退回原因最多 200 字。';
  return Object.keys(errors).length === 0 ? null : errors;
}

function taskDraftPayload(input: SaveTaskDraftInput): JsonObject {
  return {
    taskId: input.taskId ?? null,
    title: input.title,
    itemRefs: input.itemRefs.map((item) => ({
      id: item.id,
      resourceId: item.resourceId,
      completionRule: item.completionRule ?? null,
      scoringRule: item.scoringRule ?? null,
      order: item.order,
    })),
    targetType: input.targetType ?? 'classes',
    targetClassIds: input.targetClassIds,
    targetStudentIds: input.targetStudentIds ?? [],
    startsAt: input.startsAt,
    dueAt: input.dueAt,
    latePolicy: { allowLate: input.latePolicy.allowLate, lateDays: input.latePolicy.lateDays },
    description: input.description ?? null,
    teacherNote: input.teacherNote ?? null,
  };
}

function publishedTaskUpdatePayload(input: UpdatePublishedTaskInput): JsonObject {
  return {
    taskId: input.taskId,
    title: input.title ?? null,
    itemRefs: input.itemRefs?.map((item) => ({
      id: item.id,
      resourceId: item.resourceId,
      completionRule: item.completionRule ?? null,
      scoringRule: item.scoringRule ?? null,
      order: item.order,
    })) ?? null,
    targetType: input.targetType ?? null,
    targetClassIds: input.targetClassIds ?? null,
    targetStudentIds: input.targetStudentIds ?? null,
    startsAt: input.startsAt ?? null,
    dueAt: input.dueAt ?? null,
    latePolicy: input.latePolicy === undefined ? null : { ...input.latePolicy },
    description: input.description ?? null,
    teacherNote: input.teacherNote ?? null,
  };
}

function reviewPayload(input: Readonly<{
  submissionId: string;
  decision: 'approved' | 'returned';
  score?: number;
  textComment?: string;
  returnReason?: string;
  expectedSubmissionVersion: number;
}>): JsonObject {
  return {
    submissionId: input.submissionId,
    decision: input.decision,
    score: input.score ?? null,
    textComment: input.textComment ?? null,
    returnReason: input.returnReason ?? null,
    expectedSubmissionVersion: input.expectedSubmissionVersion,
  };
}

function isZonedIso(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
}

function cleanOptional(value: string | undefined): string | null {
  if (value === undefined) return null;
  const cleaned = value.trim();
  return cleaned.length === 0 ? null : cleaned;
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function emptyTaskCoreScope(organizationId: string): TaskCoreTransactionScope {
  return {
    organizationId,
    resourceIds: [],
    membershipIds: [],
    teacherGrantIds: [],
    assignmentIds: [],
    submissionIds: [],
    classMembershipGuards: [],
  };
}

function hasDuplicateAnswerItems(answers: readonly SubmissionAnswer[]): boolean {
  return new Set(answers.map((answer) => answer.itemId)).size !== answers.length;
}

function defaultCompletionRule(type: FrozenTaskItem['resourceSnapshot']['type']): JsonObject {
  if (type === 'reading') return { kind: 'reading_pages', requiredPageCount: 1 };
  if (type === 'vocabulary') return { kind: 'vocabulary_words', requiredWordCount: 1 };
  return { kind: 'exercise_questions', requiredQuestionCount: 1 };
}

function defaultScoringRule(): JsonObject {
  return { kind: 'manual', maxScore: 100 };
}

function normalizeItemReference(reference: TaskRecord['itemRefs'][number]): TaskRecord['itemRefs'][number] {
  return {
    ...reference,
    ...(reference.completionRule === undefined ? {} : { completionRule: { ...reference.completionRule } }),
    scoringRule: { ...(reference.scoringRule ?? defaultScoringRule()) },
  };
}

type FrozenItemsResult = Readonly<{ ok: true; items: readonly FrozenTaskItem[] }> | Readonly<{
  ok: false;
  code: ErrorCode;
  fieldErrors?: Readonly<Record<string, string>>;
}>;

async function freezeTaskItemReferences(
  reader: TaskCoreReader,
  organizationId: string,
  references: readonly TaskRecord['itemRefs'][number][],
  classIds: readonly string[],
): Promise<FrozenItemsResult> {
  const items: FrozenTaskItem[] = [];
  for (const reference of references) {
    const resource = await reader.findResource(organizationId, reference.resourceId);
    if (resource === null) return { ok: false, code: 'NOT_FOUND' };
    if (resource.status !== 'published') return { ok: false, code: 'RESOURCE_OFFLINE' };
    if (resource.visibility === 'classes' && classIds.some((classId) => !resource.allowedClassIds.includes(classId))) {
      return { ok: false, code: 'FORBIDDEN' };
    }
    const completionRule = reference.completionRule ?? defaultCompletionRule(resource.type);
    if (!isSupportedCompletionRule(resource.type, completionRule)) {
      return { ok: false, code: 'VALIDATION_ERROR', fieldErrors: { itemRefs: '任务内容的完成规则无效。' } };
    }
    items.push({
      id: reference.id,
      resourceId: resource.id,
      resourceVersion: resource.contentVersion,
      snapshotSchemaVersion: 1,
      resourceSnapshot: { title: resource.title, type: resource.type, payload: resource.payload },
      completionRule,
      scoringRule: reference.scoringRule ?? defaultScoringRule(),
      order: reference.order,
    });
  }
  return { ok: true, items };
}

function uniqueMembershipsByStudent(memberships: readonly ClassMembershipRecord[]): readonly ClassMembershipRecord[] {
  const sorted = [...memberships].sort((left, right) => left.studentId.localeCompare(right.studentId) || left.classId.localeCompare(right.classId));
  const byStudent = new Map<string, ClassMembershipRecord>();
  for (const membership of sorted) {
    if (!byStudent.has(membership.studentId)) byStudent.set(membership.studentId, membership);
  }
  return [...byStudent.values()];
}

async function reconcileScheduledAssignments(
  transaction: TaskCoreTransaction,
  task: TaskRecord,
  existingAssignments: readonly TaskAssignmentRecord[],
  memberships: readonly ClassMembershipRecord[],
): Promise<void> {
  const remaining = new Map(memberships.map((membership) => [membership.studentId, membership]));
  for (const assignment of existingAssignments) {
    const membership = remaining.get(assignment.studentId);
    if (membership === undefined) {
      await transaction.deleteAssignment(assignment);
      continue;
    }
    if (assignment.classId !== membership.classId) {
      await transaction.saveAssignment({ ...assignment, classId: membership.classId, version: assignment.version + 1 });
    }
    remaining.delete(assignment.studentId);
  }
  for (const membership of remaining.values()) {
    await transaction.saveAssignment({
      id: `assignment_${task.id}_${membership.studentId}`,
      organizationId: task.organizationId,
      taskId: task.id,
      studentId: membership.studentId,
      classId: membership.classId,
      status: 'not_started',
      latestSubmissionId: null,
      latestSubmissionVersion: 0,
      redoCount: 0,
      redoDueAt: null,
      isLate: false,
      submittedAt: null,
      reviewedAt: null,
      version: 1,
    });
  }
}

function isSupportedCompletionRule(type: FrozenTaskItem['resourceSnapshot']['type'], rule: JsonObject): boolean {
  if (type === 'reading') return rule.kind === 'reading_pages' && isPositiveInteger(rule.requiredPageCount);
  if (type === 'vocabulary') return rule.kind === 'vocabulary_words' && isPositiveInteger(rule.requiredWordCount);
  return rule.kind === 'exercise_questions' && isPositiveInteger(rule.requiredQuestionCount);
}

function satisfiesCompletionRule(item: FrozenTaskItem, value: JsonValue): boolean {
  if (!isJsonObject(value)) return false;
  const rule = item.completionRule;
  if (item.resourceSnapshot.type === 'reading') {
    return value.kind === 'reading'
      && isNonNegativeInteger(value.completedPageCount)
      && isPositiveInteger(rule.requiredPageCount)
      && value.completedPageCount >= rule.requiredPageCount;
  }
  if (item.resourceSnapshot.type === 'vocabulary') {
    return value.kind === 'vocabulary'
      && isNonNegativeInteger(value.completedWordCount)
      && isNonNegativeInteger(value.correctWordCount)
      && value.correctWordCount <= value.completedWordCount
      && isPositiveInteger(rule.requiredWordCount)
      && value.completedWordCount >= rule.requiredWordCount;
  }
  return value.kind === 'exercise'
    && isNonNegativeInteger(value.answeredQuestionCount)
    && isPositiveInteger(rule.requiredQuestionCount)
    && value.answeredQuestionCount >= rule.requiredQuestionCount;
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPositiveInteger(value: JsonValue | undefined): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: JsonValue | undefined): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * 24 * 60 * 60 * 1000).toISOString();
}

type ResolvedTarget = Readonly<{
  ok: true;
  classIds: readonly string[];
  memberships: readonly import('./types').ClassMembershipRecord[];
}> | Readonly<{
  ok: false;
  fieldErrors: Readonly<Record<string, string>>;
}>;

async function resolveTargetMemberships(
  reader: TaskCoreReader,
  organizationId: string,
  input: Pick<SaveTaskDraftInput, 'targetType' | 'targetClassIds' | 'targetStudentIds'>,
): Promise<ResolvedTarget> {
  if ((input.targetType ?? 'classes') === 'classes') {
    const classIds = [...unique(input.targetClassIds)].sort();
    return {
      ok: true,
      classIds,
      memberships: await reader.listActiveClassMemberships(organizationId, classIds),
    };
  }
  const studentIds = unique(input.targetStudentIds ?? []);
  const memberships = await reader.listActiveStudentMemberships(organizationId, studentIds);
  const byStudent = new Map<string, import('./types').ClassMembershipRecord[]>();
  for (const membership of memberships) {
    const current = byStudent.get(membership.studentId) ?? [];
    current.push(membership);
    byStudent.set(membership.studentId, current);
  }
  if (studentIds.some((studentId) => (byStudent.get(studentId)?.length ?? 0) !== 1)) {
    return { ok: false, fieldErrors: { targetStudentIds: '每名学员必须且只能存在一个有效班级关系。' } };
  }
  const orderedMemberships = studentIds.map((studentId) => (byStudent.get(studentId) as import('./types').ClassMembershipRecord[])[0]);
  return {
    ok: true,
    classIds: [...unique(orderedMemberships.map((membership) => membership.classId))].sort(),
    memberships: orderedMemberships,
  };
}

async function resolveStoredTargetMemberships(
  reader: TaskCoreReader,
  organizationId: string,
  task: TaskRecord,
): Promise<ResolvedTarget> {
  if (task.targetType === 'students') {
    return resolveTargetMemberships(reader, organizationId, {
      targetType: 'students',
      targetClassIds: [],
      targetStudentIds: task.targetStudentIds,
    });
  }
  const classIds = [...unique(task.targetClassIds)].sort();
  return {
    ok: true,
    classIds,
    memberships: await reader.listActiveClassMemberships(organizationId, classIds),
  };
}

function effectiveLifecycleStatus(task: TaskRecord, now: string): TaskRecord['status'] {
  if (task.status === 'draft' || task.status === 'withdrawn' || task.status === 'closed' || task.status === 'completed') return task.status;
  return lifecycleStatusForTimes(task.status, task.startsAt, task.dueAt, now);
}

function lifecycleStatusForTimes(
  currentStatus: TaskRecord['status'],
  startsAt: string,
  dueAt: string,
  now: string,
): TaskRecord['status'] {
  if (currentStatus === 'draft' || currentStatus === 'withdrawn' || currentStatus === 'closed' || currentStatus === 'completed') return currentStatus;
  const current = Date.parse(now);
  if (current < Date.parse(startsAt)) return 'scheduled';
  if (current > Date.parse(dueAt)) return 'expired';
  return 'active';
}

function isSubmittable(task: TaskRecord, assignment: TaskAssignmentRecord, now: string): boolean {
  const current = Date.parse(now);
  if (task.visibility !== 'visible') return false;
  const lifecycle = effectiveLifecycleStatus(task, now);
  if (lifecycle !== 'active' && lifecycle !== 'expired') return false;
  if (current < Date.parse(task.startsAt)) return false;
  if (assignment.status === 'awaiting_review' || assignment.status === 'completed') return false;
  if (assignment.status === 'redo_required') return assignment.redoDueAt !== null && current <= Date.parse(assignment.redoDueAt);
  if (current <= Date.parse(task.dueAt)) return true;
  if (!task.latePolicy.allowLate) return false;
  return current <= Date.parse(task.dueAt) + task.latePolicy.lateDays * 24 * 60 * 60 * 1000;
}
