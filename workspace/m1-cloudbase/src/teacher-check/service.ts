import type { TrustedActorContext } from '../auth/trusted-actor';
import type { ActivityService } from '../activity/activity-service';
import { ActivityError } from '../activity/types';
import { localDateAt } from '../task-core/activity-rules';
import type { OrgContentRepository } from '../org-content/repository';
import type { TaskQueryRepository } from '../task-query/repository';
import { taskLifecycleStatusAt } from '../task-query/lifecycle-status';
import type { TaskAssignmentRecord } from '../task-core/types';
import type { TeacherCheckFilters, TeacherCheckItem, TeacherCheckPage } from './types';

export class TeacherCheckError extends Error {
  public constructor(public readonly code: 'FORBIDDEN' | 'VALIDATION_ERROR' | 'SERVICE_UNAVAILABLE') {
    super(code);
  }
}

export class TeacherCheckListService {
  public constructor(private readonly tasks: TaskQueryRepository,
    private readonly organization: OrgContentRepository,
    private readonly activities: Pick<ActivityService, 'listForTeacher' | 'getTeacherProgress'>,
    private readonly clock: Readonly<{ nowIso(): string }>) {}

  public async list(actor: TrustedActorContext, filters: TeacherCheckFilters,
    page: Readonly<{ limit: number; offset: number }>): Promise<TeacherCheckPage> {
    if (actor.actorRole !== 'teacher' || !actor.permissions.includes('task.read')) throw new TeacherCheckError('FORBIDDEN');
    if (!Number.isSafeInteger(page.limit) || page.limit < 1 || page.limit > 50
      || !Number.isSafeInteger(page.offset) || page.offset < 0 || page.offset > 10000
      || (filters.keyword?.length ?? 0) > 50
      || (filters.type !== undefined && filters.type !== 'classroom' && filters.type !== 'checkin')
      || (filters.startsOn !== undefined && !validDate(filters.startsOn))
      || (filters.endsOn !== undefined && !validDate(filters.endsOn))
      || (filters.startsOn !== undefined && filters.endsOn !== undefined && filters.startsOn > filters.endsOn)) {
      throw new TeacherCheckError('VALIDATION_ERROR');
    }
    const grants = (await this.tasks.listActiveTeacherGrants(actor.organizationId, actor.actorUserId))
      .filter(grant => grant.status === 'active' && grant.permissions.includes('task.read')
        && actor.scopeIds.includes(grant.classId));
    if (!grants.length) throw new TeacherCheckError('FORBIDDEN');
    const classIds = grants.map(grant => grant.classId);
    if (filters.classId !== undefined && !classIds.includes(filters.classId)) throw new TeacherCheckError('FORBIDDEN');
    const organization = await this.organization.findOrganization(actor.organizationId);
    if (organization?.status !== 'active') throw new TeacherCheckError('FORBIDDEN');
    const timeZone = organization.timeZone;
    const now = this.clock.nowIso();
    const scopedClasses = filters.classId === undefined ? classIds : [filters.classId];
    const [taskRows, assignments, activityRows] = await Promise.all([
      filters.type === 'checkin' ? Promise.resolve([]) : this.tasks.listTasks(actor.organizationId),
      filters.type === 'checkin' ? Promise.resolve([]) : this.tasks.listAssignments(actor.organizationId),
      filters.type === 'classroom' ? Promise.resolve([]) : this.activities.listForTeacher(actor),
    ]);
    const byTask = groupAssignments(assignments, scopedClasses);
    const items: TeacherCheckItem[] = [];
    for (const task of taskRows) {
      if (task.visibility === 'recycled') continue;
      const scoped = byTask.get(task.id) ?? [];
      const targetClasses = task.targetClassIds.filter(id => scopedClasses.includes(id));
      if (!targetClasses.length && !scoped.length
        && !(task.status === 'draft' && task.creatorTeacherId === actor.actorUserId
          && filters.classId === undefined)) continue;
      const status = taskLifecycleStatusAt(task, now);
      const classes = [...new Set([...targetClasses, ...scoped.map(row => row.classId)])];
      items.push({ id: task.id, kind: 'classroom', title: task.title, status,
        startsOn: dateOrBlank(task.startsAt, timeZone), dueOn: dateOrBlank(task.dueAt, timeZone),
        classIds: classes, completedCount: status === 'draft' ? null
          : scoped.filter(row => row.status === 'awaiting_review' || row.status === 'completed').length,
        totalCount: scoped.length, pendingReviewCount: 0, restDayCount: 0, version: task.version,
        canDeleteDraft: false },
      );
    }
    for (const activity of activityRows) {
      if (!scopedClasses.includes(activity.schedule.classId)) continue;
      const schoolToday = localDateAt(now, activity.schedule.schoolTimeZone);
      const status = activity.status === 'draft' ? 'draft' : activity.status === 'closed' ? 'closed'
        : schoolToday < activity.schedule.startsOn ? 'scheduled'
          : schoolToday > activity.schedule.endsOn ? 'expired' : 'active';
      items.push({ id: activity.id, kind: 'checkin', title: activity.title, status,
        startsOn: activity.schedule.startsOn, dueOn: activity.schedule.endsOn,
        classIds: [activity.schedule.classId], completedCount: null,
        totalCount: activity.participants.length, pendingReviewCount: 0,
        restDayCount: activity.schedule.restDates.length, version: activity.version,
        canDeleteDraft: activity.status === 'draft' });
    }
    const keyword = filters.keyword?.trim().toLocaleLowerCase();
    const filtered = items.filter(item => filters.type === undefined || item.kind === filters.type)
      .filter(item => filters.status === undefined || item.status === filters.status)
      .filter(item => filters.startsOn === undefined || item.dueOn >= filters.startsOn)
      .filter(item => filters.endsOn === undefined || item.dueOn <= filters.endsOn)
      .filter(item => !keyword || item.title.toLocaleLowerCase().includes(keyword))
      .sort((left, right) => right.dueOn.localeCompare(left.dueOn)
        || left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));
    const paged = filtered.slice(page.offset, page.offset + page.limit);
    const enriched: TeacherCheckItem[] = [];
    for (const item of paged) {
      if (item.kind === 'classroom') {
        if (item.status === 'draft') {
          const task = taskRows.find(row => row.id === item.id);
          const hasRelations = assignments.some(row => row.taskId === item.id)
            || (await this.tasks.listTaskSubmissions(actor.organizationId, item.id)).length > 0;
          enriched.push({ ...item, canDeleteDraft: task?.creatorTeacherId === actor.actorUserId
            && !hasRelations });
          continue;
        }
        const scoped = byTask.get(item.id) ?? [];
        let pendingReviewCount = 0;
        for (const assignment of scoped) {
          if (!assignment.latestSubmissionId || (assignment.status !== 'awaiting_review'
            && assignment.status !== 'completed')) continue;
          const feedback = await this.tasks.findFeedback(actor.organizationId, assignment.latestSubmissionId);
          if (feedback === null) pendingReviewCount += 1;
        }
        enriched.push({ ...item, pendingReviewCount });
      } else {
        const activity = activityRows.find(row => row.id === item.id);
        if (!activity || activity.status === 'draft') { enriched.push(item); continue; }
        const schoolToday = localDateAt(now, activity.schedule.schoolTimeZone);
        const date = activity.status === 'closed' && activity.closedAt
          ? localDateAt(activity.closedAt, activity.schedule.schoolTimeZone)
          : schoolToday > activity.schedule.endsOn ? activity.schedule.endsOn : schoolToday;
        if (date < activity.schedule.startsOn || activity.schedule.restDates.includes(date)) {
          enriched.push(item); continue;
        }
        try {
          const progress = await this.activities.getTeacherProgress(actor, activity.id, date,
            { limit: 1, offset: 0 });
          enriched.push({ ...item, completedCount: progress.completedCount });
        } catch (error: unknown) {
          if (error instanceof ActivityError && (error.code === 'FORBIDDEN' || error.code === 'NOT_FOUND')) {
            throw new TeacherCheckError('FORBIDDEN');
          }
          // An unavailable activity result is explicit; never replace it with a guessed zero.
          enriched.push(item);
        }
      }
    }
    return { classes: grants.map(grant => ({ id: grant.classId, name: grant.className })),
      items: enriched, total: filtered.length,
      nextOffset: page.offset + page.limit < filtered.length ? page.offset + page.limit : null };
  }
}

function groupAssignments(assignments: readonly TaskAssignmentRecord[], classIds: readonly string[]):
  Map<string, TaskAssignmentRecord[]> {
  const allowed = new Set(classIds);
  const byTask = new Map<string, TaskAssignmentRecord[]>();
  for (const assignment of assignments) {
    if (!allowed.has(assignment.classId)) continue;
    const rows = byTask.get(assignment.taskId) ?? [];
    rows.push(assignment);
    byTask.set(assignment.taskId, rows);
  }
  return byTask;
}

function dateOrBlank(value: string, timeZone: string): string {
  return Number.isFinite(Date.parse(value)) ? localDateAt(value, timeZone) : '';
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}
