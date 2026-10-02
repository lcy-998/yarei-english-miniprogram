import type { TrustedActorContext } from '../auth/trusted-actor';
import type { ActivityUnitOfWork } from '../activity/repository';
import type { ActivityEntity, ActivityFinalSnapshot } from '../activity/types';
import type { OrgContentRepository } from '../org-content/repository';
import type { TaskQueryRepository } from '../task-query/repository';
import type { TaskTemplate } from '../task-template/types';
import type { TemplateUnitOfWork } from '../task-template/repository';
import type { TaskAssignmentRecord, TaskRecord } from '../task-core/types';
import { automaticTaskScore } from '../task-core/task-score';
import { failure, success, type RequestIdGenerator, type ResultClock } from '../shared/result';
import type { ServiceResult } from '../shared/protocol';
import { AdminTaskActivityWriteRepository } from './write-repository';
import type { ManagedDetail, ManagedExport, ManagedFilters, ManagedItem, ManagedKind, ManagedList, StopManagedResult } from './types';

export interface AdminTaskActivityDependencies {
  readonly organization: OrgContentRepository;
  readonly tasks: TaskQueryRepository;
  readonly activities: ActivityUnitOfWork;
  readonly templates: TemplateUnitOfWork;
  readonly writes: AdminTaskActivityWriteRepository;
  readonly clock: ResultClock;
  readonly requestIds: RequestIdGenerator;
}

export class AdminTaskActivityService {
  public constructor(private readonly dependencies: AdminTaskActivityDependencies) {}

  public async list(actor: TrustedActorContext, filters: ManagedFilters,
    page: Readonly<{ limit: number; offset: number }>): Promise<ServiceResult<ManagedList>> {
    if (!canRead(actor)) return failure('FORBIDDEN', this.meta());
    if (!validFilters(filters) || !validPage(page)) return failure('VALIDATION_ERROR', this.meta());
    const rows = (await this.all(actor)).filter((item) => matches(item, filters));
    const items = rows.slice(page.offset, page.offset + page.limit);
    return success({ items, total: rows.length, nextOffset: page.offset + items.length < rows.length
      ? page.offset + items.length : null }, this.meta());
  }

  public async detail(actor: TrustedActorContext, kind: ManagedKind, id: string): Promise<ServiceResult<ManagedDetail>> {
    if (!canRead(actor)) return failure('FORBIDDEN', this.meta());
    const item = (await this.all(actor)).find((row) => row.kind === kind && row.id === id);
    if (!item) return failure('NOT_FOUND', this.meta());
    if (kind === 'template') return success({ item, submissions: [] }, this.meta());
    if (kind === 'activity') {
      const activity = await this.dependencies.activities.transaction((transaction) => transaction.findActivity(actor.organizationId, id));
      if (!activity) return failure('NOT_FOUND', this.meta());
      const final = await this.dependencies.activities.transaction((transaction) => transaction.findFinalSnapshot(actor.organizationId, id));
      return success({ item, submissions: activity.participants.map((person) => {
        const rank = final?.leaderboard.ranks.find((candidate) => candidate.studentId === person.studentId);
        return { studentId: person.studentId, studentNameMasked: person.displayNameMasked,
          status: rank ? `已完成 ${rank.completedDays} 天` : '待结算', submittedAt: null,
          score: null, hasFeedback: false };
      }) }, this.meta());
    }
    const assignments = (await this.dependencies.tasks.listAssignments(actor.organizationId))
      .filter((assignment) => assignment.taskId === id);
    const task = await this.dependencies.tasks.findTask(actor.organizationId, id);
    if (!task) return failure('NOT_FOUND', this.meta());
    const submissions = await Promise.all(assignments.map(async (assignment) => {
      const latest = assignment.latestSubmissionId
        ? await this.dependencies.tasks.findSubmission(actor.organizationId, assignment.latestSubmissionId) : null;
      const feedback = latest ? await this.dependencies.tasks.findFeedback(actor.organizationId, latest.id) : null;
      const student = await this.dependencies.organization.findUser(actor.organizationId, assignment.studentId);
      return { studentId: assignment.studentId, studentNameMasked: student?.displayNameMasked ?? '未知学员',
        status: assignment.status, submittedAt: latest?.submittedAt ?? null,
        score: feedback?.score ?? (latest ? automaticTaskScore(task, latest) : null), hasFeedback: feedback !== null };
    }));
    return success({ item, submissions }, this.meta());
  }

  public async exportCsv(actor: TrustedActorContext, filters: ManagedFilters): Promise<ServiceResult<ManagedExport>> {
    if (!canRead(actor)) return failure('FORBIDDEN', this.meta());
    if (!validFilters(filters)) return failure('VALIDATION_ERROR', this.meta());
    const rows = (await this.all(actor)).filter((item) => matches(item, filters));
    if (rows.length > 2000) return failure('VALIDATION_ERROR', this.meta(), { filters: '数据较多，请缩小筛选范围后导出。' });
    const header = ['类型', '名称', '创建教师', '班级', '开始时间', '截止时间', '状态', '完成数', '总人数', '完成率', '待检查', '待点评', 'AI 辅助', '异常'];
    const values = rows.map((item) => [kindLabel(item.kind), item.title, item.teacherNameMasked,
      item.classNames.join('、'), item.startsAt ?? '', item.dueAt ?? '', item.status,
      item.completedCount === null ? '' : String(item.completedCount),
      item.totalCount === null ? '' : String(item.totalCount),
      item.completionRate === null ? '' : `${item.completionRate}%`,
      item.pendingReviewCount === null ? '' : String(item.pendingReviewCount),
      item.pendingCommentCount === null ? '' : String(item.pendingCommentCount),
      '否', item.anomaly ?? '']);
    return success({ fileName: `雅睿英语-任务活动-${filters.startsOn}-${filters.endsOn}.csv`,
      csv: '\uFEFF' + [header, ...values].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n' }, this.meta());
  }

  public async stop(actor: TrustedActorContext, input: Readonly<{ kind: ManagedKind; id: string;
    expectedVersion: number; operationId: string; reason: string }>): Promise<ServiceResult<StopManagedResult>> {
    if (!canManage(actor)) return failure('FORBIDDEN', this.meta());
    if (!input.id.trim() || input.id.length > 128 || !input.operationId.trim() || input.operationId.length > 128
      || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1
      || !input.reason.trim() || input.reason.trim().length > 200) return failure('VALIDATION_ERROR', this.meta());
    const meta = this.meta();
    const result = await this.dependencies.writes.stop({ ...input, reason: input.reason.trim(),
      organizationId: actor.organizationId, actorId: actor.actorUserId, now: meta.serverTime, requestId: meta.requestId });
    return success(result, meta);
  }

  private async all(actor: TrustedActorContext): Promise<ManagedItem[]> {
    const [tasks, assignments, activities, templates] = await Promise.all([
      this.dependencies.tasks.listTasks(actor.organizationId),
      this.dependencies.tasks.listAssignments(actor.organizationId),
      this.dependencies.activities.transaction((transaction) => transaction.listActivities(actor.organizationId)),
      this.dependencies.templates.transaction((transaction) => transaction.listTemplates(actor.organizationId)),
    ]);
    const rows: ManagedItem[] = [];
    for (const task of tasks.filter((item) => item.visibility !== 'recycled')) {
      rows.push(await this.taskRow(actor.organizationId, task, assignments.filter((item) => item.taskId === task.id)));
    }
    for (const activity of activities) rows.push(await this.activityRow(actor.organizationId, activity));
    for (const template of templates) rows.push(await this.templateRow(actor.organizationId, template));
    return rows.sort((left, right) => (right.startsAt ?? '').localeCompare(left.startsAt ?? '')
      || left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));
  }

  private async taskRow(organizationId: string, task: TaskRecord, assignments: readonly TaskAssignmentRecord[]): Promise<ManagedItem> {
    const classIds = [...new Set([...task.targetClassIds, ...assignments.map((item) => item.classId)])];
    const [teacherNameMasked, classNames] = await Promise.all([
      this.teacherName(organizationId, task.creatorTeacherId), this.classNames(organizationId, classIds),
    ]);
    const completedCount = assignments.filter((item) => item.status === 'completed' || item.status === 'awaiting_review').length;
    const awaiting = assignments.filter((item) => item.status === 'awaiting_review');
    let pendingCommentCount = 0;
    for (const assignment of awaiting) {
      if (!assignment.latestSubmissionId || !await this.dependencies.tasks.findFeedback(organizationId, assignment.latestSubmissionId)) {
        pendingCommentCount++;
      }
    }
    return { id: task.id, kind: 'classroom', title: task.title, teacherId: task.creatorTeacherId,
      teacherNameMasked, classIds, classNames, startsAt: task.startsAt, dueAt: task.dueAt,
      status: task.status, completedCount, totalCount: assignments.length,
      completionRate: assignments.length ? Math.round(completedCount * 100 / assignments.length) : null,
      pendingReviewCount: awaiting.length, pendingCommentCount, aiAssisted: false,
      anomaly: task.publication ? '发布未完成' : task.status !== 'draft' && assignments.length === 0 ? '无学员任务关系' : null,
      version: task.version };
  }

  private async activityRow(organizationId: string, activity: ActivityEntity): Promise<ManagedItem> {
    const [teacherNameMasked, classNames, final] = await Promise.all([
      this.teacherName(organizationId, activity.creatorTeacherId),
      this.classNames(organizationId, [activity.schedule.classId]),
      this.dependencies.activities.transaction((transaction) => transaction.findFinalSnapshot(organizationId, activity.id)),
    ]);
    const completedCount = final ? completedParticipants(final) : null;
    const totalCount = activity.participants.length;
    return { id: activity.id, kind: 'activity', title: activity.title,
      teacherId: activity.creatorTeacherId, teacherNameMasked,
      classIds: [activity.schedule.classId], classNames,
      startsAt: activity.schedule.startsOn, dueAt: activity.schedule.endsOn, status: activity.status,
      completedCount, totalCount, completionRate: completedCount === null || totalCount === 0
        ? null : Math.round(completedCount * 100 / totalCount),
      pendingReviewCount: null, pendingCommentCount: null, aiAssisted: false,
      anomaly: activity.status === 'published' && totalCount === 0 ? '无参与学员' : null,
      version: activity.version };
  }

  private async templateRow(organizationId: string, template: TaskTemplate): Promise<ManagedItem> {
    return { id: template.id, kind: 'template', title: template.title,
      teacherId: template.ownerTeacherId, teacherNameMasked: template.ownerTeacherId
        ? await this.teacherName(organizationId, template.ownerTeacherId) : '系统模板',
      classIds: [], classNames: [], startsAt: template.createdAt, dueAt: null,
      status: template.status, completedCount: null, totalCount: null, completionRate: null,
      pendingReviewCount: null, pendingCommentCount: null, aiAssisted: false,
      anomaly: template.status === 'active' && template.items.length === 0 ? '模板无内容' : null,
      version: template.version };
  }

  private async teacherName(organizationId: string, teacherId: string): Promise<string> {
    return (await this.dependencies.organization.findUser(organizationId, teacherId))?.displayNameMasked ?? '未知教师';
  }
  private async classNames(organizationId: string, classIds: readonly string[]): Promise<string[]> {
    return Promise.all(classIds.map(async (id) => (await this.dependencies.organization.findClass(organizationId, id))?.name ?? '未知班级'));
  }
  private meta() { return { requestId: this.dependencies.requestIds.next(), serverTime: this.dependencies.clock.nowIso(), apiVersion: 'm1.v1' as const }; }
}

function canRead(actor: TrustedActorContext): boolean {
  return actor.actorRole === 'admin' && actor.permissions.includes('organization.read')
    && actor.scopeIds.includes(actor.organizationId);
}
function canManage(actor: TrustedActorContext): boolean {
  return canRead(actor) && actor.permissions.includes('organization.manage');
}
function validFilters(filters: ManagedFilters): boolean {
  const start = Date.parse(`${filters.startsOn}T00:00:00Z`);
  const end = Date.parse(`${filters.endsOn}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(filters.startsOn) && /^\d{4}-\d{2}-\d{2}$/.test(filters.endsOn)
    && Number.isFinite(start) && Number.isFinite(end) && start <= end && end - start <= 366 * 86400000
    && new Date(start).toISOString().slice(0, 10) === filters.startsOn
    && new Date(end).toISOString().slice(0, 10) === filters.endsOn
    && (!filters.keyword || filters.keyword.length <= 100);
}
function validPage(page: Readonly<{ limit: number; offset: number }>): boolean {
  return Number.isSafeInteger(page.limit) && page.limit >= 1 && page.limit <= 100
    && Number.isSafeInteger(page.offset) && page.offset >= 0;
}
function matches(item: ManagedItem, filters: ManagedFilters): boolean {
  const date = item.startsAt?.slice(0, 10) ?? '';
  return date >= filters.startsOn && date <= filters.endsOn
    && (!filters.kind || item.kind === filters.kind)
    && (!filters.status || item.status === filters.status)
    && (!filters.keyword || [item.title, item.teacherNameMasked, ...item.classNames]
      .some((value) => value.toLocaleLowerCase().includes(filters.keyword!.trim().toLocaleLowerCase())));
}
function kindLabel(kind: ManagedKind): string { return { classroom: '课堂任务', activity: '打卡活动', template: '任务模板' }[kind]; }
function completedParticipants(snapshot: ActivityFinalSnapshot): number {
  return snapshot.leaderboard.ranks.filter((rank) => rank.completedDays === snapshot.leaderboard.effectiveDayCount).length;
}
function csvCell(value: string): string {
  const safe = /^[=+@\-\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}
