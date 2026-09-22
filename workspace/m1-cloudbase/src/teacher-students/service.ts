import type { TrustedActorContext } from '../auth/trusted-actor';
import type { OrgContentRepository } from '../org-content/repository';
import type { ClassEntity, ClassMembershipEntity, TeacherClassGrantEntity, UserEntity } from '../org-content/types';
import type { ServiceResult } from '../shared/protocol';
import { failure, success, type RequestIdGenerator, type ResultClock } from '../shared/result';
import type { TaskQueryRepository } from '../task-query/repository';
import { sha256Hex } from '../task-query/self-contained-cursor';
import type { CursorCodec } from '../task-query/types';
import type { TaskAssignmentRecord } from '../task-core/types';
import type {
  TeacherStudentClassOption,
  TeacherStudentDetail,
  TeacherStudentFilters,
  TeacherStudentListItem,
  TeacherStudentPage,
  TeacherStudentPageRequest,
  TeacherStudentPerformanceSummary,
  TeacherStudentTaskItem,
} from './types';

export interface TeacherStudentQueryDependencies {
  readonly organizationRepository: OrgContentRepository;
  readonly taskRepository: TaskQueryRepository;
  readonly clock: ResultClock;
  readonly requestIds: RequestIdGenerator;
  readonly cursorCodec: CursorCodec;
}

interface AuthorizedClass {
  readonly grant: TeacherClassGrantEntity;
  readonly classEntity: ClassEntity;
}

export class TeacherStudentQueryService {
  private readonly cursorCodec: CursorCodec;

  public constructor(private readonly dependencies: TeacherStudentQueryDependencies) {
    this.cursorCodec = dependencies.cursorCodec;
  }

  public async listStudents(
    actor: TrustedActorContext,
    filters: TeacherStudentFilters,
    page: TeacherStudentPageRequest,
  ): Promise<ServiceResult<TeacherStudentPage>> {
    const authorized = await this.authorizedClasses(actor);
    if (authorized === null) return failure('FORBIDDEN', this.meta());
    if (filters.classId !== undefined && !authorized.some((item) => item.classEntity.id === filters.classId)) {
      return failure('FORBIDDEN', this.meta());
    }
    const scoped = filters.classId === undefined
      ? authorized
      : authorized.filter((item) => item.classEntity.id === filters.classId);
    const assignments = await this.dependencies.taskRepository.listAssignments(actor.organizationId);
    const keyword = filters.keyword?.toLocaleLowerCase();
    const items: TeacherStudentListItem[] = [];

    for (const { classEntity } of scoped) {
      const memberships = await this.dependencies.organizationRepository.listMembershipsForClass(
        actor.organizationId,
        classEntity.id,
      );
      for (const membership of memberships) {
        if (membership.status === 'transferred') continue;
        const student = await this.dependencies.organizationRepository.findUser(actor.organizationId, membership.studentId);
        if (student === null || !student.roles.includes('student')) continue;
        if (membership.status === 'inactive' && student.status !== 'disabled') continue;
        if (keyword !== undefined
          && !student.displayName.toLocaleLowerCase().includes(keyword)
          && !student.studentNumber?.toLocaleLowerCase().includes(keyword)) continue;
        const performance = await this.performance(actor.organizationId, student.id, classEntity.id, assignments);
        const item = this.listItem(student, classEntity, performance);
        if (!matchesStatus(item, filters.status)) continue;
        items.push(item);
      }
    }

    items.sort((left, right) => left.classInfo.name.localeCompare(right.classInfo.name, 'zh-CN')
      || left.displayName.localeCompare(right.displayName, 'zh-CN')
      || left.studentId.localeCompare(right.studentId));
    const paged = paginate(this.cursorCodec, actor, filters, page, items);
    if (paged === null) return failure('CONFLICT', this.meta());
    return success({
      classes: authorized.map(({ classEntity }) => classOption(classEntity)),
      ...paged,
    }, this.meta());
  }

  public async getStudent(actor: TrustedActorContext, studentId: string): Promise<ServiceResult<TeacherStudentDetail>> {
    const authorized = await this.authorizedClasses(actor);
    if (authorized === null) return failure('FORBIDDEN', this.meta());
    const authorizedById = new Map(authorized.map((item) => [item.classEntity.id, item.classEntity]));
    const student = await this.dependencies.organizationRepository.findUser(actor.organizationId, studentId);
    let membership: ClassMembershipEntity | null = null;
    for (const classId of authorizedById.keys()) {
      const candidate = await this.dependencies.organizationRepository.findMembership(actor.organizationId, studentId, classId);
      if (candidate !== null && candidate.status !== 'transferred'
        && (candidate.status === 'active' || student?.status === 'disabled')) {
        membership = candidate;
        break;
      }
    }
    if (membership === null) return failure('NOT_FOUND', this.meta());
    const classEntity = authorizedById.get(membership.classId);
    if (student === null || classEntity === undefined || !student.roles.includes('student')) {
      return failure('NOT_FOUND', this.meta());
    }

    const assignments = await this.dependencies.taskRepository.listAssignments(actor.organizationId);
    const relevantAssignments = assignments.filter((item) => item.studentId === student.id && item.classId === classEntity.id);
    const [performance, parents, recentTasks] = await Promise.all([
      this.performance(actor.organizationId, student.id, classEntity.id, assignments),
      this.parentSummaries(actor.organizationId, student.id),
      this.recentTasks(actor.organizationId, relevantAssignments),
    ]);
    return success({
      studentId: student.id,
      displayName: student.displayName,
      studentNumber: student.studentNumber ?? '未设置',
      accountStatus: student.status,
      needsAttention: performance.overdueCount > 0 || performance.redoCount > 0,
      classInfo: classOption(classEntity),
      parents,
      performance,
      recentTasks,
    }, this.meta());
  }

  private async authorizedClasses(actor: TrustedActorContext): Promise<readonly AuthorizedClass[] | null> {
    if (actor.actorRole !== 'teacher' || !actor.permissions.includes('student.read')) return null;
    const grants = await this.dependencies.organizationRepository.listActiveTeacherGrants(
      actor.organizationId,
      actor.actorUserId,
    );
    const allowed = grants.filter((grant) => grant.permissions.includes('student.read') && actor.scopeIds.includes(grant.classId));
    const resolved: AuthorizedClass[] = [];
    for (const grant of allowed) {
      const classEntity = await this.dependencies.organizationRepository.findClass(actor.organizationId, grant.classId);
      if (classEntity !== null && classEntity.status === 'active') resolved.push({ grant, classEntity });
    }
    return resolved.length === 0 ? null : resolved;
  }

  private listItem(
    student: UserEntity,
    classEntity: ClassEntity,
    performance: TeacherStudentPerformanceSummary,
  ): TeacherStudentListItem {
    return {
      studentId: student.id,
      displayName: student.displayName,
      studentNumber: student.studentNumber ?? '未设置',
      accountStatus: student.status,
      needsAttention: performance.overdueCount > 0 || performance.redoCount > 0,
      classInfo: classOption(classEntity),
      performance,
    };
  }

  private async performance(
    organizationId: string,
    studentId: string,
    classId: string,
    assignments: readonly TaskAssignmentRecord[],
  ): Promise<TeacherStudentPerformanceSummary> {
    const scoped = assignments.filter((item) => item.studentId === studentId && item.classId === classId);
    const completedCount = scoped.filter((item) => item.status === 'awaiting_review' || item.status === 'completed').length;
    const scores: number[] = [];
    for (const assignment of scoped) {
      if (assignment.latestSubmissionId === null) continue;
      const feedback = await this.dependencies.taskRepository.findFeedback(organizationId, assignment.latestSubmissionId);
      if (feedback?.score !== null && feedback?.score !== undefined) scores.push(feedback.score);
    }
    return {
      assignedCount: scoped.length,
      completedCount,
      overdueCount: scoped.filter((item) => item.status === 'overdue').length,
      redoCount: scoped.filter((item) => item.status === 'redo_required').length,
      completionRate: scoped.length === 0 ? 0 : Math.round(completedCount * 100 / scoped.length),
      averageScore: scores.length === 0 ? null : Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length),
    };
  }

  private async parentSummaries(organizationId: string, studentId: string) {
    const links = await this.dependencies.organizationRepository.listActiveParentLinksForStudent(organizationId, studentId);
    const parents = [];
    for (const link of links) {
      const parent = await this.dependencies.organizationRepository.findUser(organizationId, link.parentId);
      if (parent === null || parent.status !== 'active' || !parent.roles.includes('parent')) continue;
      parents.push({
        linkId: link.id,
        displayNameMasked: parent.displayNameMasked,
        mobileMasked: parent.mobileMasked ?? null,
        confirmedAt: link.confirmedAt,
      });
    }
    return parents;
  }

  private async recentTasks(
    organizationId: string,
    assignments: readonly TaskAssignmentRecord[],
  ): Promise<readonly TeacherStudentTaskItem[]> {
    const sorted = [...assignments].sort((left, right) => (right.submittedAt ?? '').localeCompare(left.submittedAt ?? '')
      || right.id.localeCompare(left.id));
    const results: TeacherStudentTaskItem[] = [];
    for (const assignment of sorted) {
      const task = await this.dependencies.taskRepository.findTask(organizationId, assignment.taskId);
      if (task === null || task.status === 'draft') continue;
      const feedback = assignment.latestSubmissionId === null
        ? null
        : await this.dependencies.taskRepository.findFeedback(organizationId, assignment.latestSubmissionId);
      results.push({
        taskId: task.id,
        title: task.title,
        status: assignment.status,
        submittedAt: assignment.submittedAt,
        score: feedback?.score ?? null,
      });
      if (results.length === 5) break;
    }
    return results;
  }

  private meta() {
    return {
      requestId: this.dependencies.requestIds.next(),
      serverTime: this.dependencies.clock.nowIso(),
      apiVersion: 'm1.v1' as const,
    };
  }
}

function classOption(classEntity: ClassEntity): TeacherStudentClassOption {
  return {
    id: classEntity.id,
    name: classEntity.name,
    grade: classEntity.grade,
    term: classEntity.term,
  };
}

function matchesStatus(item: TeacherStudentListItem, status: TeacherStudentFilters['status']): boolean {
  if (status === 'all') return true;
  if (status === 'attention') return item.accountStatus === 'active' && item.needsAttention;
  if (status === 'normal') return item.accountStatus === 'active' && !item.needsAttention;
  return item.accountStatus === 'disabled';
}

function paginate<T>(
  codec: CursorCodec,
  actor: TrustedActorContext,
  filters: TeacherStudentFilters,
  page: TeacherStudentPageRequest,
  items: readonly T[],
): Readonly<{ items: readonly T[]; total: number; nextCursor: string | null }> | null {
  const signature = sha256Hex(stableStringify({
    organizationId: actor.organizationId,
    actorUserId: actor.actorUserId,
    actorRole: actor.actorRole,
    authzVersion: actor.authzVersion,
    permissions: [...actor.permissions].sort(),
    scopeIds: [...actor.scopeIds].sort(),
    query: 'teacher-students',
    filters,
  }));
  let offset = 0;
  if (page.cursor !== undefined) {
    const decoded = codec.decode(page.cursor);
    if (decoded === null) return null;
    const match = /^ts1\|([0-9a-f]{64})\|([0-9]+)$/.exec(decoded);
    if (match === null || match[1] !== signature) return null;
    offset = Number(match[2]);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > items.length) return null;
  }
  const selected = items.slice(offset, offset + page.limit);
  const nextOffset = offset + selected.length;
  return {
    items: selected,
    total: items.length,
    nextCursor: nextOffset < items.length ? codec.encode(`ts1|${signature}|${nextOffset}`) : null,
  };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${key}:${stableStringify(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
