import { AuthorizationService } from '../auth/authorization-service';
import type { TrustedActorContext } from '../auth/trusted-actor';
import type { OrgContentRepository } from '../org-content/repository';
import type { IdentityRepository } from '../runtime/ports';
import { failure, success, type RequestIdGenerator, type ResultClock } from '../shared/result';
import type { ServiceResult } from '../shared/protocol';
import { automaticTaskScore } from '../task-core/task-score';
import type { TaskQueryRepository } from '../task-query/repository';
import type { StudentWorkUnitOfWork } from '../student-work/repository';
import type { StatsExport, StatsFilters, StatsSummary, StatsTaskDetail, StatsView } from './types';

export interface LearningStatsDependencies {
  readonly organization: OrgContentRepository;
  readonly tasks: TaskQueryRepository;
  readonly identities: IdentityRepository;
  readonly works?: StudentWorkUnitOfWork;
  readonly clock: ResultClock;
  readonly requestIds: RequestIdGenerator;
}

export class LearningStatsService {
  private readonly authorization: AuthorizationService;

  public constructor(private readonly dependencies: LearningStatsDependencies) {
    this.authorization = new AuthorizationService(dependencies.identities);
  }

  public async teacher(actor: TrustedActorContext, filters: StatsFilters): Promise<ServiceResult<StatsView>> {
    if (actor.actorRole !== 'teacher' || !actor.permissions.includes('student.read') || !actor.permissions.includes('task.read')) {
      return failure('FORBIDDEN', this.meta());
    }
    if (!validDates(filters)) return failure('VALIDATION_ERROR', this.meta());
    const grants = await this.dependencies.organization.listActiveTeacherGrants(actor.organizationId, actor.actorUserId);
    const allowed = grants.filter((grant) => actor.scopeIds.includes(grant.classId)
      && grant.permissions.includes('student.read') && grant.permissions.includes('task.read'));
    const classes = (await Promise.all(allowed.map((grant) => this.dependencies.organization.findClass(actor.organizationId, grant.classId))))
      .filter((item): item is NonNullable<typeof item> => item !== null && item.status === 'active');
    if (filters.classId && !classes.some((item) => item.id === filters.classId)) return failure('FORBIDDEN', this.meta());
    const selected = filters.classId ? classes.filter((item) => item.id === filters.classId) : classes;
    const students: Array<{ id: string; name: string; classId: string }> = [];
    for (const classEntity of selected) {
      const memberships = await this.dependencies.organization.listActiveMembershipsForClass(actor.organizationId, classEntity.id);
      for (const membership of memberships) {
        const student = await this.dependencies.organization.findUser(actor.organizationId, membership.studentId);
        if (student?.status === 'active' && student.roles.includes('student')) {
          students.push({ id: student.id, name: student.displayNameMasked, classId: classEntity.id });
        }
      }
    }
    if (filters.studentId && !students.some((item) => item.id === filters.studentId)) return failure('NOT_FOUND', this.meta());
    const scoped = filters.studentId ? students.filter((item) => item.id === filters.studentId) : students;
    const details = await this.details(actor.organizationId, filters, selected.map((item) => ({ id: item.id, name: item.name })), scoped);
    const dubbingCount = await this.dubbingCount(actor.organizationId, filters,
      scoped.map((item) => item.id), selected.map((item) => item.id));
    return success({ filters, periodBasis: 'taskDueDate', classes: classes.map((item) => ({ id: item.id, name: item.name })),
      students, summary: { ...summarize(details), dubbingCount }, details, canExport: true }, this.meta());
  }

  public async parent(actor: TrustedActorContext, childId: string, filters: StatsFilters): Promise<ServiceResult<StatsView>> {
    if (!validDates(filters)) return failure('VALIDATION_ERROR', this.meta());
    if (!(await this.authorization.canParentReadStudent(actor, childId)).allowed) return failure('NOT_FOUND', this.meta());
    if (filters.studentId && filters.studentId !== childId) return failure('NOT_FOUND', this.meta());
    const child = await this.dependencies.organization.findUser(actor.organizationId, childId);
    if (child?.status !== 'active' || !child.roles.includes('student')) return failure('NOT_FOUND', this.meta());
    const [memberships, assignments] = await Promise.all([
      this.dependencies.organization.listActiveMembershipsForStudent(actor.organizationId, childId),
      this.dependencies.tasks.listAssignments(actor.organizationId),
    ]);
    const classIds = [...new Set([...memberships.map((item) => item.classId),
      ...assignments.filter((item) => item.studentId === childId).map((item) => item.classId)])];
    const classes = (await Promise.all(classIds.map((classId) => this.dependencies.organization.findClass(actor.organizationId, classId))))
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .map((item) => ({ id: item.id, name: item.name }));
    if (filters.classId && !classes.some((item) => item.id === filters.classId)) return failure('NOT_FOUND', this.meta());
    const selected = filters.classId ? classes.filter((item) => item.id === filters.classId) : classes;
    const students = selected.map((item) => ({ id: childId, name: child.displayNameMasked, classId: item.id }));
    const details = await this.details(actor.organizationId, filters, selected, students);
    const dubbingCount = await this.dubbingCount(actor.organizationId, filters, [childId],
      filters.classId ? selected.map((item) => item.id) : null);
    return success({ filters, periodBasis: 'taskDueDate', classes, students,
      summary: { ...summarize(details), dubbingCount }, details, canExport: false }, this.meta());
  }

  public async exportTeacherCsv(actor: TrustedActorContext, filters: StatsFilters): Promise<ServiceResult<StatsExport>> {
    const result = await this.teacher(actor, filters);
    if (!result.ok) return result;
    const header = ['截止日期', '班级', '学员', '任务', '状态', '提交时间', '逾期', '提交次数', '成绩'];
    const rows = result.data.details.map((item) => [item.dueOn, item.className, item.studentName,
      item.taskTitle, item.status, item.submittedAt ?? '', item.isLate ? '是' : '否',
      String(item.submissionCount), item.score === null ? '' : String(item.score)]);
    const summary = result.data.summary;
    const summaryRows = [['统计截止日期', `${filters.startsOn} 至 ${filters.endsOn}`],
      ['任务完成率', summary.completionRate === null ? '' : `${summary.completionRate}%`],
      ['已完成任务', String(summary.completedCount)], ['应完成任务', String(summary.assignedCount)],
      ['逾期任务', String(summary.overdueCount)], ['任务提交次数', String(summary.taskSubmissionCount)],
      ['已记录平均成绩', summary.averageScore === null ? '' : String(summary.averageScore)],
      ...(summary.dubbingCount === null ? [] : [['自主配音提交', String(summary.dubbingCount)]]), []];
    const csv = '\uFEFF' + [...summaryRows, header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
    return success({ fileName: `雅睿英语-学员统计-${filters.startsOn}-${filters.endsOn}.csv`, csv }, this.meta());
  }

  private async details(organizationId: string, filters: StatsFilters,
    classes: readonly { id: string; name: string }[], students: readonly { id: string; name: string; classId: string }[]): Promise<StatsTaskDetail[]> {
    const [tasks, assignments, submissions, organization] = await Promise.all([
      this.dependencies.tasks.listTasks(organizationId), this.dependencies.tasks.listAssignments(organizationId),
      this.dependencies.tasks.listSubmissions(organizationId), this.dependencies.organization.findOrganization(organizationId),
    ]);
    const timeZone = organization?.timeZone ?? 'Asia/Shanghai';
    const taskById = new Map(tasks.filter((item) => item.status !== 'draft' && item.status !== 'withdrawn')
      .map((item) => [item.id, item]));
    const classById = new Map(classes.map((item) => [item.id, item.name]));
    const studentByKey = new Map(students.map((item) => [`${item.classId}|${item.id}`, item.name]));
    const detailRows: StatsTaskDetail[] = [];
    for (const assignment of assignments) {
      const task = taskById.get(assignment.taskId);
      const className = classById.get(assignment.classId);
      const studentName = studentByKey.get(`${assignment.classId}|${assignment.studentId}`);
      if (!task || className === undefined || studentName === undefined) continue;
      const dueOn = localDate(task.dueAt, timeZone);
      if (dueOn < filters.startsOn || dueOn > filters.endsOn) continue;
      const history = submissions.filter((item) => item.assignmentId === assignment.id && item.submittedAt !== null);
      if (task.visibility === 'recycled' && history.length === 0) continue;
      const latest = history.sort((left, right) => right.submissionVersion - left.submissionVersion)[0];
      const feedback = latest ? await this.dependencies.tasks.findFeedback(organizationId, latest.id) : null;
      const score = feedback?.score ?? (latest ? automaticTaskScore(task, latest) : null);
      detailRows.push({ taskId: task.id, taskTitle: task.title, studentId: assignment.studentId,
        studentName, classId: assignment.classId, className, dueOn, status: assignment.status,
        submittedAt: latest?.submittedAt ?? null, isLate: assignment.isLate,
        submissionCount: history.length, score });
    }
    return detailRows.sort((left, right) => right.dueOn.localeCompare(left.dueOn)
      || left.className.localeCompare(right.className, 'zh-CN') || left.studentName.localeCompare(right.studentName, 'zh-CN'));
  }

  private async dubbingCount(organizationId: string, filters: StatsFilters,
    studentIds: readonly string[], classIds: readonly string[] | null): Promise<number | null> {
    const worksRepository = this.dependencies.works;
    if (!worksRepository) return null;
    const organization = await this.dependencies.organization.findOrganization(organizationId);
    const timeZone = organization?.timeZone ?? 'Asia/Shanghai';
    let count = 0;
    const uniqueIds = [...new Set(studentIds)];
    for (let index = 0; index < uniqueIds.length; index += 10) {
      const batch = await Promise.all(uniqueIds.slice(index, index + 10).map((studentId) =>
        worksRepository.transaction((transaction) => transaction.listStudentWorks(organizationId, studentId))));
      count += batch.flat().filter((item) => (classIds === null || classIds.includes(item.classId))
        && item.status === 'submitted' && item.submittedAt !== null
        && localDate(item.submittedAt, timeZone) >= filters.startsOn
        && localDate(item.submittedAt, timeZone) <= filters.endsOn).length;
    }
    return count;
  }

  private meta() {
    return { requestId: this.dependencies.requestIds.next(), serverTime: this.dependencies.clock.nowIso(), apiVersion: 'm1.v1' as const };
  }
}

function summarize(details: readonly StatsTaskDetail[]): StatsSummary {
  const completedCount = details.filter((item) => item.status === 'awaiting_review' || item.status === 'completed').length;
  const scored = details.map((item) => item.score).filter((item): item is number => item !== null);
  return { assignedCount: details.length, completedCount,
    completionRate: details.length ? Math.round(completedCount * 100 / details.length) : null,
    overdueCount: details.filter((item) => item.isLate || item.status === 'overdue').length,
    taskSubmissionCount: details.reduce((total, item) => total + item.submissionCount, 0),
    averageScore: scored.length ? Math.round(scored.reduce((total, score) => total + score, 0) / scored.length) : null,
    learningMinutes: null, practiceAccuracy: null, dubbingCount: null, shadowingCount: null };
}

function validDates(filters: StatsFilters): boolean {
  const pattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!pattern.test(filters.startsOn) || !pattern.test(filters.endsOn)) return false;
  const start = Date.parse(`${filters.startsOn}T00:00:00Z`);
  const end = Date.parse(`${filters.endsOn}T00:00:00Z`);
  return Number.isFinite(start) && Number.isFinite(end) && start <= end && end - start <= 366 * 86400000
    && new Date(start).toISOString().slice(0, 10) === filters.startsOn
    && new Date(end).toISOString().slice(0, 10) === filters.endsOn;
}

function localDate(value: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(value));
  const part = (name: string) => parts.find((item) => item.type === name)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function csvCell(value: string): string {
  const safe = /^[=+@\-\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}
