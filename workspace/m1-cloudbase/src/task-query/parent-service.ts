import { AuthorizationService } from '../auth/authorization-service';
import type { TrustedActorContext } from '../auth/trusted-actor';
import { hasPermission } from '../auth/trusted-actor';
import type { IdentityRepository } from '../runtime/ports';
import { failure, success, type RequestIdGenerator, type ResultClock } from '../shared/result';
import type { ServiceResult } from '../shared/protocol';
import type { ParentTaskResultView, ReviewFeedbackRecord, SubmissionRecord, TaskAssignmentRecord, TaskRecord } from '../task-core/types';
import { automaticTaskScore } from '../task-core/task-score';
import type { TaskQueryRepository } from './repository';
import { InMemoryOpaqueCursorCodec } from './service';
import { hasOnlyOfficialAutomaticItems } from './official-score';
import { parentSafeAnswers } from './parent-answer-projection';
import { parentVoiceCommentSummary } from './parent-feedback-voice';
import type {
  CursorCodec,
  FeedbackDetailView,
  PageRequest,
  PageResult,
  ParentChildListItem,
  ParentHomeView,
  ParentTaskFilters,
  ParentTaskListItem,
} from './types';

export interface ParentQueryServiceDependencies {
  readonly repository: TaskQueryRepository;
  readonly identities: IdentityRepository;
  readonly clock: ResultClock;
  readonly requestIds: RequestIdGenerator;
  readonly cursorCodec?: CursorCodec;
}

export class ParentTaskQueryService {
  private readonly authorization: AuthorizationService;
  private readonly cursorCodec: CursorCodec;

  public constructor(private readonly dependencies: ParentQueryServiceDependencies) {
    this.authorization = new AuthorizationService(dependencies.identities);
    this.cursorCodec = dependencies.cursorCodec ?? new InMemoryOpaqueCursorCodec(dependencies.requestIds);
  }

  public async listChildren(actor: TrustedActorContext): Promise<ServiceResult<readonly ParentChildListItem[]>> {
    if (actor.actorRole !== 'parent' || !hasPermission(actor, 'child.read')) return failure('FORBIDDEN', this.meta());
    const links = await this.dependencies.identities.listActiveParentLinks(actor.organizationId, actor.actorUserId);
    const children = await Promise.all(links.map(async (link): Promise<ParentChildListItem | null> => {
      const child = await this.dependencies.identities.findUser(link.studentId, actor.organizationId);
      if (child === null || child.status !== 'active') return null;
      return {
        linkId: link._id,
        linkVersion: link.version,
        childId: child._id,
        displayName: child.displayName,
        displayNameMasked: child.displayNameMasked,
        studentNumber: child.studentNumber ?? null,
        classId: child.classId ?? null,
        className: child.className ?? null,
        confirmedAt: link.confirmedAt ?? null,
      };
    }));
    return success(children.filter((child): child is ParentChildListItem => child !== null), this.meta());
  }

  public async getHome(actor: TrustedActorContext, childId: string): Promise<ServiceResult<ParentHomeView>> {
    if (!(await this.authorization.canParentReadStudent(actor, childId)).allowed) return failure('NOT_FOUND', this.meta());
    const child = await this.dependencies.identities.findUser(childId, actor.organizationId);
    if (child === null || child.status !== 'active') return failure('NOT_FOUND', this.meta());
    const records = await this.readChildRecords(actor.organizationId, childId);
    const visible = records.filter((record) => isParentVisible(record.task, record.assignment));
    const items = await Promise.all(visible.map((record) => this.toListItem(actor.organizationId, record)));
    items.sort(parentTaskOrder);
    const organization = await this.dependencies.identities.findOrganization(actor.organizationId);
    const timeZone = organization?.timeZone ?? 'Asia/Shanghai';
    const { startsOn, endsOn } = schoolWeek(this.dependencies.clock.nowIso(), timeZone);
    const weekItems = items.filter(item => {
      const dueOn = schoolDate(item.dueAt, timeZone);
      return dueOn >= startsOn && dueOn <= endsOn;
    });
    const visibleByAssignment = new Map(visible.map(record => [record.assignment.id, record]));
    const submissions = (await this.dependencies.repository.listSubmissions(actor.organizationId))
      .filter(submission => visibleByAssignment.has(submission.assignmentId)
        && submission.studentId === childId && submission.submittedAt !== null);
    const feedbackCandidates = await Promise.all(submissions.map(async submission => {
      const feedback = await this.dependencies.repository.findFeedback(actor.organizationId, submission.id);
      if (feedback === null) return null;
      const record = visibleByAssignment.get(submission.assignmentId);
      if (record === undefined) return null;
      const teacher = await this.dependencies.identities.findUser(feedback.teacherId, actor.organizationId);
      return {
        feedbackId: feedback.id,
        taskId: record.task.id,
        taskTitle: record.task.title,
        teacherName: teacher?.displayName ?? '任课教师',
        textComment: feedback.textComment ?? feedback.returnReason,
        decision: feedback.decision,
        score: feedback.score,
        publishedAt: feedback.publishedAt,
      };
    }));
    const recentFeedback = feedbackCandidates.filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt))
      .slice(0, 3);
    return success({
      childId,
      child: {
        id: child._id,
        displayName: child.displayName,
        displayNameMasked: child.displayNameMasked,
        classId: child.classId ?? null,
        className: child.className ?? null,
      },
      pendingTaskCount: items.filter((item) => !isCompletedStatus(item.status)).length,
      completedTaskCount: items.filter((item) => isCompletedStatus(item.status)).length,
      weeklyAssignedCount: weekItems.length,
      weeklyCompletedCount: weekItems.filter(item => isCompletedStatus(item.status)).length,
      overdueTaskCount: items.filter(item => !isCompletedStatus(item.status)
        && item.status !== 'redo_required' && item.dueAt < this.dependencies.clock.nowIso()).length,
      recentTasks: items.slice(0, 5),
      recentFeedback,
    }, this.meta());
  }

  public async listChildTasks(
    actor: TrustedActorContext,
    childId: string,
    filters: ParentTaskFilters,
    page: PageRequest,
  ): Promise<ServiceResult<PageResult<ParentTaskListItem>>> {
    if (!(await this.authorization.canParentReadStudent(actor, childId)).allowed) return failure('NOT_FOUND', this.meta());
    const organization = await this.dependencies.identities.findOrganization(actor.organizationId);
    const timeZone = organization?.timeZone ?? 'Asia/Shanghai';
    const records = await this.readChildRecords(actor.organizationId, childId);
    const filtered = records
      .filter((record) => isParentVisible(record.task, record.assignment))
      .filter((record) => filters.status === undefined || record.assignment.status === filters.status)
      .filter((record) => matchesParentStatusGroup(record.assignment.status, filters.statusGroup))
      .filter((record) => {
        if (filters.startsOn === undefined || filters.endsOn === undefined) return true;
        const dueOn = schoolDate(record.task.dueAt, timeZone);
        return dueOn >= filters.startsOn && dueOn <= filters.endsOn;
      })
      .filter((record) => filters.keyword === undefined || record.task.title.toLocaleLowerCase().includes(filters.keyword.toLocaleLowerCase()));
    const items = await Promise.all(filtered.map((record) => this.toListItem(actor.organizationId, record)));
    items.sort(parentTaskOrder);
    return this.page(actor, childId, filters, page, items);
  }

  public async getParentTaskResult(
    actor: TrustedActorContext,
    childId: string,
    taskId: string,
  ): Promise<ServiceResult<ParentTaskResultView>> {
    if (!(await this.authorization.canParentReadStudent(actor, childId)).allowed) return failure('NOT_FOUND', this.meta());
    const assignment = await this.dependencies.repository.findAssignment(actor.organizationId, taskId, childId);
    if (assignment === null) return failure('NOT_FOUND', this.meta());
    const task = await this.dependencies.repository.findTask(actor.organizationId, taskId);
    if (task === null || !isParentVisible(task, assignment)) return failure('NOT_FOUND', this.meta());
    const submission = assignment.latestSubmissionId === null
      ? null
      : await this.dependencies.repository.findSubmission(actor.organizationId, assignment.latestSubmissionId);
    const feedback = submission === null ? null : await this.dependencies.repository.findFeedback(actor.organizationId, submission.id);
    const latestTeacher = feedback === null ? null
      : await this.dependencies.identities.findUser(feedback.teacherId, actor.organizationId);
    const versions = (await this.dependencies.repository.listSubmissions(actor.organizationId))
      .filter(item => item.assignmentId === assignment.id && item.studentId === childId && item.taskId === taskId
        && item.submittedAt !== null)
      .sort((left, right) => right.submissionVersion - left.submissionVersion);
    const submissionHistory = await Promise.all(versions.map(async version => {
      const published = await this.dependencies.repository.findFeedback(actor.organizationId, version.id);
      const teacher = published === null ? null
        : await this.dependencies.identities.findUser(published.teacherId, actor.organizationId);
      return {
        id: version.id,
        version: version.submissionVersion,
        submittedAt: version.submittedAt as string,
        answers: parentSafeAnswers(task, version.answers, version.submittedAt, this.dependencies.clock.nowIso()),
        feedback: published === null ? null : {
          id: published.id, teacherName: teacher?.displayName ?? '任课教师',
          ...(parentVoiceCommentSummary(published, this.dependencies.clock.nowIso())
            ? { voiceComment: parentVoiceCommentSummary(published, this.dependencies.clock.nowIso()) } : {}),
          decision: published.decision, score: published.score,
          textComment: published.textComment, returnReason: published.returnReason,
          publishedAt: published.publishedAt,
        },
      };
    }));
    return success({
      taskId,
      title: task.title,
      studentId: childId,
      assignmentId: assignment.id,
      assignmentStatus: assignment.status,
      itemSummaries: task.items.map(item => ({ itemId: item.id, title: item.resourceSnapshot.title,
        type: item.resourceSnapshot.type, order: item.order,
        pronunciationAvailable: approvedPronunciation(item.resourceSnapshot.payload.pronunciation) }))
        .sort((left, right) => left.order - right.order),
      automaticScore: submission === null || !hasOnlyOfficialAutomaticItems(task)
        ? null : automaticTaskScore(task, submission),
      submission: submission === null || submission.submittedAt === null ? null : {
        id: submission.id, version: submission.submissionVersion,
        answers: parentSafeAnswers(task, submission.answers, submission.submittedAt, this.dependencies.clock.nowIso()),
        submittedAt: submission.submittedAt,
      },
      feedback: feedback === null ? null : {
        id: feedback.id, teacherName: latestTeacher?.displayName ?? '任课教师',
        ...(parentVoiceCommentSummary(feedback, this.dependencies.clock.nowIso())
          ? { voiceComment: parentVoiceCommentSummary(feedback, this.dependencies.clock.nowIso()) } : {}),
        decision: feedback.decision, score: feedback.score, textComment: feedback.textComment,
        returnReason: feedback.returnReason, publishedAt: feedback.publishedAt,
      },
      submissionHistory,
    }, this.meta());
  }

  public async getFeedback(
    actor: TrustedActorContext,
    childId: string,
    feedbackId: string,
  ): Promise<ServiceResult<FeedbackDetailView>> {
    if (!(await this.authorization.canParentReadStudent(actor, childId)).allowed) return failure('NOT_FOUND', this.meta());
    const submissions = (await this.dependencies.repository.listSubmissions(actor.organizationId))
      .filter((submission) => submission.studentId === childId && submission.submittedAt !== null);
    for (const submission of submissions) {
      const feedback = await this.dependencies.repository.findFeedback(actor.organizationId, submission.id);
      if (feedback?.id !== feedbackId) continue;
      const assignment = await this.dependencies.repository.findAssignmentById(actor.organizationId, submission.assignmentId);
      const task = await this.dependencies.repository.findTask(actor.organizationId, submission.taskId);
      if (assignment === null || assignment.studentId !== childId || task === null || !isParentVisible(task, assignment)) break;
      return success({
        feedbackId,
        childId,
        taskId: task.id,
        taskTitle: task.title,
        submission: {
          id: submission.id, version: submission.submissionVersion,
          answers: parentSafeAnswers(task, submission.answers, submission.submittedAt, this.dependencies.clock.nowIso()),
          submittedAt: submission.submittedAt as string,
        },
        feedback: {
          ...(parentVoiceCommentSummary(feedback, this.dependencies.clock.nowIso())
            ? { voiceComment: parentVoiceCommentSummary(feedback, this.dependencies.clock.nowIso()) } : {}),
          decision: feedback.decision, score: feedback.score, textComment: feedback.textComment,
          returnReason: feedback.returnReason, publishedAt: feedback.publishedAt,
        },
      }, this.meta());
    }
    return failure('NOT_FOUND', this.meta());
  }

  private async readChildRecords(organizationId: string, childId: string): Promise<readonly ChildTaskRecord[]> {
    const [tasks, assignments] = await Promise.all([
      this.dependencies.repository.listTasks(organizationId),
      this.dependencies.repository.listAssignments(organizationId),
    ]);
    const taskById = new Map(tasks.map((task) => [task.id, task]));
    const records: ChildTaskRecord[] = [];
    for (const assignment of assignments.filter((item) => item.studentId === childId)) {
      const task = taskById.get(assignment.taskId);
      if (task === undefined) continue;
      const submission = assignment.latestSubmissionId === null
        ? null
        : await this.dependencies.repository.findSubmission(organizationId, assignment.latestSubmissionId);
      const feedback = submission === null ? null : await this.dependencies.repository.findFeedback(organizationId, submission.id);
      records.push({ task, assignment, submission, feedback });
    }
    return records;
  }

  private async toListItem(organizationId: string, record: ChildTaskRecord): Promise<ParentTaskListItem> {
    const feedback = record.feedback ?? (record.submission === null ? null : await this.dependencies.repository.findFeedback(organizationId, record.submission.id));
    return {
      taskId: record.task.id,
      title: record.task.title,
      status: record.assignment.status,
      startsAt: record.task.startsAt,
      dueAt: record.task.dueAt,
      submittedAt: record.assignment.submittedAt,
      isLate: record.assignment.isLate,
      contentTypes: [...new Set(record.task.items.map(item => item.resourceSnapshot.type))],
      feedbackId: feedback?.id ?? null,
      feedbackPublishedAt: feedback?.publishedAt ?? null,
      score: feedback?.score ?? (record.submission !== null && hasOnlyOfficialAutomaticItems(record.task)
        ? automaticTaskScore(record.task, record.submission) : null),
    };
  }

  private page(
    actor: TrustedActorContext,
    childId: string,
    filters: ParentTaskFilters,
    page: PageRequest,
    items: readonly ParentTaskListItem[],
  ): ServiceResult<PageResult<ParentTaskListItem>> {
    const key = `${actor.organizationId}|${actor.actorUserId}|${actor.authzVersion}|${childId}|${stable(filters)}`;
    let offset = 0;
    if (page.cursor !== undefined) {
      const decoded = this.cursorCodec.decode(page.cursor);
      if (decoded === null || !decoded.startsWith(`${key}|`)) return failure('CONFLICT', this.meta());
      offset = Number(decoded.slice(key.length + 1));
      if (!Number.isInteger(offset) || offset < 0 || offset > items.length) return failure('CONFLICT', this.meta());
    }
    const selected = items.slice(offset, offset + page.limit);
    const nextOffset = offset + selected.length;
    return success({
      items: selected,
      total: items.length,
      nextCursor: nextOffset < items.length ? this.cursorCodec.encode(`${key}|${nextOffset}`) : null,
    }, this.meta());
  }

  private meta() {
    return { requestId: this.dependencies.requestIds.next(), serverTime: this.dependencies.clock.nowIso(), apiVersion: 'm1.v1' as const };
  }
}

interface ChildTaskRecord {
  readonly task: TaskRecord;
  readonly assignment: TaskAssignmentRecord;
  readonly submission: SubmissionRecord | null;
  readonly feedback: ReviewFeedbackRecord | null;
}

function isParentVisible(task: TaskRecord, assignment: TaskAssignmentRecord): boolean {
  if (task.status === 'draft' || task.status === 'withdrawn') return false;
  return task.visibility !== 'recycled' || assignment.latestSubmissionId !== null;
}

function isCompletedStatus(status: TaskAssignmentRecord['status']): boolean {
  return status === 'awaiting_review' || status === 'completed';
}

function parentTaskOrder(left: ParentTaskListItem, right: ParentTaskListItem): number {
  return right.dueAt.localeCompare(left.dueAt) || left.taskId.localeCompare(right.taskId);
}

function stable(value: ParentTaskFilters): string {
  return `status:${value.status ?? ''};group:${value.statusGroup ?? ''};keyword:${value.keyword ?? ''};from:${value.startsOn ?? ''};to:${value.endsOn ?? ''}`;
}

function matchesParentStatusGroup(status: TaskAssignmentRecord['status'], group: ParentTaskFilters['statusGroup']): boolean {
  if (group === undefined) return true;
  if (group === 'active') return status !== 'awaiting_review' && status !== 'completed';
  return status === group;
}

function schoolDate(value: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(value));
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function schoolWeek(nowIso: string, timeZone: string): Readonly<{ startsOn: string; endsOn: string }> {
  const today = schoolDate(nowIso, timeZone);
  const monday = new Date(`${today}T00:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(sunday.getUTCDate() + 6);
  return { startsOn: monday.toISOString().slice(0, 10), endsOn: sunday.toISOString().slice(0, 10) };
}

function approvedPronunciation(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && 'reviewStatus' in value && value.reviewStatus === 'approved'
    && 'segments' in value && Array.isArray(value.segments) && value.segments.length > 0;
}
