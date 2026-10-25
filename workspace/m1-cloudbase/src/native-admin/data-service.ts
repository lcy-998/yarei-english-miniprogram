import { createHash } from 'node:crypto';
import type { TrustedActorContext } from '../auth/trusted-actor';
import type { DocumentDatabasePort, VersionedDocument } from '../repositories/document-database-port';
import { authorizeNativeAdmin, NATIVE_ADMIN_PERMISSIONS,
  type NativeAdminGrantReader, type NativeAdminPermission } from './authorization';
import { hasApprovedAssetLibraryOrigin, hasAssetLibraryOrigin } from '../teacher-media/asset-library-origin';
import { hasActivePublicMediaSource } from '../teacher-media/public-media-source';
import { freezeTeacherMediaForTask, type TeacherMediaCandidate } from '../teacher-media/publish-gate';
import { hasActivePublicQuestionSource } from '../question-admin/public-question-source';
import type { JsonObject } from '../shared/protocol';
import type { CloudBasePlaybackSdkPort } from '../student-work/cloudbase-playback';
import { TEACHER_CLASS_PERMISSIONS, type TeacherClassPermission } from '../org-content/types';

export interface NativeAdminOverviewView {
  readonly organizationCount: number;
  readonly classCount: number;
  readonly userCount: number | null;
  readonly taskCount: number | null;
  readonly activeTaskCount: number | null;
  readonly pendingReviewCount: number | null;
}

export interface NativeAdminRecordFilter {
  readonly query?: string;
  readonly status?: string;
  readonly mediaKind?: '' | 'listening' | 'video' | 'dubbing';
  readonly taskType?: 'all' | 'classroom' | 'activity';
  readonly from?: string;
  readonly to?: string;
}

export interface NativeAdminAuditPageView {
  readonly items: readonly Readonly<{ id: string; action: string; targetType: string; targetId: string;
    result: 'succeeded' | 'denied' | 'failed'; occurredAt: string; actorUserId: string }>[];
  readonly nextOffset: number | null;
}

export interface NativeAdminClassPageView {
  readonly items: readonly Readonly<{ id: string; name: string; grade: string; term: string;
    status: 'active' | 'disabled'; studentCount: number | null;
    teacherIds: readonly string[]; teacherAssignments: readonly Readonly<{ teacherId: string;
      permissions: readonly TeacherClassPermission[]; status: 'active' | 'revoked'; version: number }>[];
    version: number }>[];
  readonly nextOffset: number | null;
}

export interface NativeAdminUserPageView {
  readonly items: readonly Readonly<{ id: string; displayName: string; roleLabel: string;
    status: 'active' | 'disabled'; version: number; bindingCount: number;
    studentNumber?: string; mobileMasked?: string; role: string; classNames: readonly string[];
    lastLoginAt: string | null }>[];
  readonly nextOffset: number | null;
}

export type NativeAdminSelectionKind = 'class_for_user' | 'class_for_grant'
  | 'teacher_for_class' | 'parent_for_binding' | 'student_for_binding';
export interface NativeAdminSelectionPageView {
  readonly items: readonly Readonly<{ id: string; label: string; detail: string }>[];
  readonly nextOffset: number | null;
}

export interface NativeAdminUserBindingsView {
  readonly userId: string;
  readonly items: readonly Readonly<{ id: string; parentId: string; parentName: string;
    studentId: string; studentName: string; status: 'active' | 'revoked';
    confirmedAt: string | null; version: number }>[];
}

export interface NativeAdminGrantPageView {
  readonly items: readonly Readonly<{ teacherId: string; status: 'active' | 'revoked';
    permissions: readonly NativeAdminPermission[]; classIds: readonly string[];
    organizationWide: boolean; version: number; userVersion: number }>[];
  readonly nextOffset: number | null;
}

export type NativeAdminRecordKind = 'textbooks' | 'questions' | 'tasks' | 'media';
export interface NativeAdminRecordPageView {
  readonly items: readonly Readonly<{ id: string;
    kind: 'textbook' | 'question' | 'classroom' | 'activity' | 'media';
    title: string; status: string; statusLabel: string; detail: string; version: number;
    classIds?: readonly string[]; creatorLabel?: string; classLabel?: string;
    startsAt?: string; dueAt?: string; participantCount?: number;
    completedCount?: number; pendingReviewCount?: number }>[];
  readonly nextOffset: number | null;
}
export interface NativeAdminQuestionPreviewView { readonly id: string; readonly title: string;
  readonly version: number; readonly questionType: string; readonly stem: string;
  readonly answer: string; readonly explanation: string; readonly organizationWide: boolean;
  readonly classIds: readonly string[] }
export interface NativeAdminRecordsExportView { readonly fileName: string;
  readonly csv: string; readonly rowCount: number }
export interface NativeAdminMediaReviewSummaryView {
  readonly id: string; readonly title: string;
  readonly kind: 'listening' | 'video' | 'dubbing'; readonly status: string; readonly statusLabel: string;
  readonly recordVersion: number;
  readonly scanStatus: 'pending' | 'clean' | 'failed';
  readonly transcodeStatus: 'pending' | 'ready' | 'failed';
  readonly sourceScanEvidencePresent: boolean; readonly outputScanEvidencePresent: boolean;
  readonly transcodeEvidencePresent: boolean; readonly copyrightEvidencePresent: boolean;
  readonly questionCount: number; readonly clipCount: number; readonly subtitleCount: number;
  readonly continuousPlaybackEnforced: boolean; readonly allowedClassIds: readonly string[];
  readonly reviewerIsOwner: boolean;
}
export interface NativeAdminMediaPreviewView {
  readonly id: string; readonly kind: 'listening' | 'video' | 'dubbing';
  readonly temporaryUrl: string; readonly expiresAt: string;
  readonly clips: readonly Readonly<{ questionId: string; segmentId: string;
    startMs: number; endMs: number }>[];
  readonly subtitles: readonly Readonly<{ startMs: number; endMs: number; text: string;
    translationText?: string }>[];
}
export interface NativeAdminMediaAuditPageView {
  readonly items: readonly Readonly<{ id: string; action: string; actorUserId: string;
    occurredAt: string; issueReason: string | null }>[];
  readonly nextOffset: number | null;
}

export class NativeAdminDataError extends Error {
  public constructor(public readonly code: 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION_ERROR' | 'SERVICE_UNAVAILABLE') { super(code); }
}

const AUTHORIZATION_AUDIT_ACTIONS = [
  'native_admin.granted', 'native_admin.revoked',
  'native_admin.teacher.assigned', 'native_admin.teacher.assignment_revoked',
  'native_admin.teacher.granted',
] as const;

export class NativeAdminDataService {
  public constructor(private readonly grants: NativeAdminGrantReader,
    private readonly database: DocumentDatabasePort,
    private readonly playback?: CloudBasePlaybackSdkPort) {}

  public async getOrganization(actor: TrustedActorContext): Promise<Readonly<{
    id: string; name: string; status: 'active' | 'disabled'; version: number }>> {
    await this.scope(actor, 'organization.manage');
    const organization = await this.database.get('organizations', actor.organizationId);
    if (!visible(organization, actor.organizationId)) throw new NativeAdminDataError('NOT_FOUND');
    return { id: organization._id, name: cleanText(organization.name) || '学校名称未记录',
      status: organization.status === 'active' ? 'active' : 'disabled', version: organization.version };
  }

  public async getOverview(actor: TrustedActorContext, from = '', to = ''): Promise<NativeAdminOverviewView> {
    const range = { ...(from ? { from } : {}), ...(to ? { to } : {}) };
    validateRecordFilter(range);
    const scope = await this.scope(actor, 'dashboard.read');
    const classes = await this.visibleClasses(actor.organizationId, scope);
    const users = await this.database.find('users', { organizationId: actor.organizationId,
      status: 'active', deletedAt: null });
    const visibleUsers = users.filter(row => visible(row, actor.organizationId));
    const scopedUserIds = scope.organizationWide ? null : new Set((await this.database.find('class_memberships', {
      organizationId: actor.organizationId, status: 'active', deletedAt: null,
    })).filter(row => visible(row, actor.organizationId) && typeof row.classId === 'string'
      && scope.classIds.includes(row.classId) && typeof row.studentId === 'string')
      .map(row => String(row.studentId)));
    const userCount = scopedUserIds
      ? visibleUsers.filter(user => scopedUserIds.has(user._id)).length : visibleUsers.length;
    const taskGroups = await Promise.all(['tasks', 'checkin_activities'].map(collection =>
      this.database.find(collection, { organizationId: actor.organizationId, deletedAt: null })));
    const tasks = taskGroups.flatMap((rows, index) => rows.map(row => ({ row,
      collection: index === 0 ? 'tasks' : 'checkin_activities' })))
      .filter(({ row, collection }) => visible(row, actor.organizationId)
        && recordInScope(row, scope) && recordMatchesFilter(row, collection, 'tasks', range))
      .map(({ row }) => row);
    const assignments = await this.database.find('task_assignments', {
      organizationId: actor.organizationId, deletedAt: null,
    });
    const scopedTaskIds = new Set(tasks.filter(row => row._id && row.organizationId === actor.organizationId)
      .map(row => row._id));
    const pendingReviewCount = assignments.filter(row => visible(row, actor.organizationId)
      && row.status === 'awaiting_review' && typeof row.taskId === 'string'
      && scopedTaskIds.has(row.taskId) && (scope.organizationWide
        || typeof row.classId === 'string' && scope.classIds.includes(row.classId))).length;
    const activeStatuses = new Set(['scheduled', 'active', 'in_progress', 'ongoing', 'published']);
    const activeTaskCount = tasks.filter(row => {
      const payload = object(row.payload);
      const status = payload?.status ?? row.status;
      return activeStatuses.has(String(status));
    }).length;
    return { organizationCount: 1, classCount: classes.length, userCount, taskCount: tasks.length,
      activeTaskCount,
      pendingReviewCount };
  }

  public async listClasses(actor: TrustedActorContext, limit: number,
    offset: number, query = ''): Promise<NativeAdminClassPageView> {
    pageCheck(limit, offset);
    validateQuery(query);
    const scope = await this.scope(actor, 'organization.manage');
    const classes = (await this.visibleClasses(actor.organizationId, scope))
      .filter(row => !query || [row._id, row.name, gradeLabel(row.grade), row.term].some(value =>
        typeof value === 'string' && value.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())))
      .sort((left, right) => left._id.localeCompare(right._id));
    const selected = classes.slice(offset, offset + limit);
    const items = await Promise.all(selected.map(async row => {
      const memberships = await this.database.find('class_memberships', {
        organizationId: actor.organizationId, classId: row._id, status: 'active', deletedAt: null });
      const teacherGrants = await this.database.find('teacher_class_grants', {
        organizationId: actor.organizationId, classId: row._id, deletedAt: null });
      const visibleTeacherGrants = teacherGrants.filter(grant => visible(grant, actor.organizationId)
        && grant.classId === row._id && typeof grant.teacherId === 'string'
        && (grant.status === 'active' || grant.status === 'revoked'));
      return { id: row._id, name: cleanText(row.name) || row._id,
        grade: gradeLabel(row.grade), term: cleanText(row.term),
        status: row.status === 'active' ? 'active' as const : 'disabled' as const,
        studentCount: memberships.filter(member => visible(member, actor.organizationId)
          && member.classId === row._id).length,
        teacherIds: visibleTeacherGrants.filter(grant => grant.status === 'active')
          .map(grant => String(grant.teacherId)),
        teacherAssignments: visibleTeacherGrants.map(grant => ({ teacherId: String(grant.teacherId),
          permissions: Array.isArray(grant.permissions) ? grant.permissions.filter((permission):
            permission is TeacherClassPermission => typeof permission === 'string'
              && TEACHER_CLASS_PERMISSIONS.includes(permission as TeacherClassPermission)) : [],
          status: grant.status as 'active' | 'revoked', version: grant.version })),
        version: row.version };
    }));
    return { items, nextOffset: offset + limit < classes.length ? offset + limit : null };
  }

  public async listSelectionOptions(actor: TrustedActorContext, kind: NativeAdminSelectionKind,
    classId: string, limit: number, offset: number, query = ''): Promise<NativeAdminSelectionPageView> {
    pageCheck(limit, offset);
    validateQuery(query);
    if (!['class_for_user', 'class_for_grant', 'teacher_for_class',
      'parent_for_binding', 'student_for_binding'].includes(kind)
      || classId && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(classId)
      || kind === 'teacher_for_class' && !classId) throw new NativeAdminDataError('VALIDATION_ERROR');
    const permission: NativeAdminPermission = kind === 'class_for_grant' ? 'authorization.manage'
      : kind === 'teacher_for_class' ? 'organization.manage' : 'user.manage';
    const scope = await this.scope(actor, permission, classId || undefined);
    if (kind === 'class_for_user' || kind === 'class_for_grant') {
      const classes = (await this.visibleClasses(actor.organizationId, scope))
        .filter(row => row.status === 'active')
        .filter(row => !query || [row._id, row.name, gradeLabel(row.grade), row.term]
          .some(value => typeof value === 'string'
            && value.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())))
        .sort((left, right) => left._id.localeCompare(right._id));
      return { items: classes.slice(offset, offset + limit).map(row => ({
        id: row._id, label: cleanText(row.name) || row._id,
        detail: `${gradeLabel(row.grade)} · ${cleanText(row.term)}`,
      })), nextOffset: offset + limit < classes.length ? offset + limit : null };
    }
    if (classId) {
      const currentClass = await this.database.get('classes', classId);
      if (!visible(currentClass, actor.organizationId) || currentClass.status !== 'active') {
        throw new NativeAdminDataError('FORBIDDEN');
      }
    }
    const requestedRole = kind === 'teacher_for_class' ? 'teacher'
      : kind === 'parent_for_binding' ? 'parent' : 'student';
    const [roles, users, memberships] = await Promise.all([
      this.database.find('role_assignments', { organizationId: actor.organizationId,
        role: requestedRole, status: 'active', deletedAt: null }),
      this.database.find('users', { organizationId: actor.organizationId, deletedAt: null }),
      kind === 'student_for_binding' ? this.database.find('class_memberships', {
        organizationId: actor.organizationId, status: 'active', deletedAt: null,
      }) : Promise.resolve([] as readonly VersionedDocument[]),
    ]);
    if (roles.length > 10000 || users.length > 10000 || memberships.length > 10000) {
      throw new NativeAdminDataError('SERVICE_UNAVAILABLE');
    }
    const roleIds = new Set(roles.filter(row => visible(row, actor.organizationId)
      && typeof row.userId === 'string').map(row => String(row.userId)));
    const scopedStudentIds = kind === 'student_for_binding' ? new Set(memberships
      .filter(row => visible(row, actor.organizationId) && typeof row.studentId === 'string'
        && typeof row.classId === 'string'
        && (classId ? row.classId === classId
          : scope.organizationWide || scope.classIds.includes(row.classId)))
      .map(row => String(row.studentId))) : null;
    const needle = query.trim().toLocaleLowerCase();
    const candidates = users.filter(row => visible(row, actor.organizationId)
      && row.status === 'active' && roleIds.has(row._id)
      && (scopedStudentIds === null || scopedStudentIds.has(row._id)))
      .filter(row => !needle || [row._id, row.displayName, row.displayNameMasked]
        .some(value => typeof value === 'string'
          && value.toLocaleLowerCase().includes(needle)))
      .sort((left, right) => left._id.localeCompare(right._id));
    return { items: candidates.slice(offset, offset + limit).map(row => ({
      id: row._id, label: cleanText(row.displayName) || cleanText(row.displayNameMasked) || '未命名账号',
      detail: row._id,
    })), nextOffset: offset + limit < candidates.length ? offset + limit : null };
  }

  public async listUsers(actor: TrustedActorContext, classId: string, limit: number,
    offset: number, query = '', role = '', status = ''): Promise<NativeAdminUserPageView> {
    pageCheck(limit, offset);
    validateQuery(query);
    if (!['', 'student', 'parent', 'teacher', 'admin'].includes(role)
      || !['', 'active', 'disabled'].includes(status)) throw new NativeAdminDataError('VALIDATION_ERROR');
    if (classId && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(classId)) {
      throw new NativeAdminDataError('VALIDATION_ERROR');
    }
    const scope = await this.scope(actor, 'user.manage', classId || undefined);
    if (!classId && !scope.organizationWide) throw new NativeAdminDataError('FORBIDDEN');
    if (query.trim() || role || status) {
      const queryText = query.trim().toLocaleLowerCase();
      const [users, roles] = await Promise.all([
        classId ? this.usersForClass(actor.organizationId, classId)
          : this.database.find('users', { organizationId: actor.organizationId, deletedAt: null }),
        this.database.find('role_assignments', { organizationId: actor.organizationId,
          status: 'active', deletedAt: null }),
      ]);
      if (users.length > 10000) throw new NativeAdminDataError('SERVICE_UNAVAILABLE');
      const roleByUser = new Map<string, string>();
      for (const row of roles) {
        if (visible(row, actor.organizationId) && typeof row.userId === 'string'
          && typeof row.role === 'string' && !roleByUser.has(row.userId)) {
          roleByUser.set(row.userId, row.role);
        }
      }
      const candidates = users.filter(user => visible(user, actor.organizationId))
        .filter(user => {
          const userRole = resolveUserRole(user, roleByUser.get(user._id));
          if (role && userRole !== role) return false;
          if (status && user.status !== status) return false;
          if (!queryText) return true;
          const displayName = cleanText(user.displayName) || cleanText(user.displayNameMasked)
            || '未命名用户';
          return [user._id, displayName, roleLabel(userRole), user.studentNumber,
            user.mobileMasked].some(value => typeof value === 'string'
              && value.toLocaleLowerCase().includes(queryText));
        })
        .sort((left, right) => left._id.localeCompare(right._id));
      const items = await Promise.all(candidates.slice(offset, offset + limit)
        .map(user => this.projectUser(actor.organizationId, user, scope, classId)));
      return { items, nextOffset: offset + limit < candidates.length ? offset + limit : null };
    }
    if (!classId) {
      const page = await this.database.findPage('users', {
        organizationId: actor.organizationId, deletedAt: null }, { limit, offset });
      const items = await Promise.all(page.items.filter(row => visible(row, actor.organizationId))
        .map(row => this.projectUser(actor.organizationId, row, scope)));
      return { items, nextOffset: page.hasMore ? offset + limit : null };
    }
    const classRow = await this.database.get('classes', classId);
    if (!visible(classRow, actor.organizationId)) throw new NativeAdminDataError('FORBIDDEN');
    const page = await this.database.findPage('class_memberships', {
      organizationId: actor.organizationId, classId, status: 'active', deletedAt: null }, { limit, offset });
    const items = (await Promise.all(page.items.map(async member => {
      if (!visible(member, actor.organizationId) || member.classId !== classId
        || typeof member.studentId !== 'string') return null;
      const user = await this.database.get('users', member.studentId);
      if (!visible(user, actor.organizationId)) return null;
      return this.projectUser(actor.organizationId, user, scope, classId);
    }))).filter((item): item is NonNullable<typeof item> => item !== null);
    return { items, nextOffset: page.hasMore ? offset + limit : null };
  }

  public async listGrants(actor: TrustedActorContext, limit: number,
    offset: number, query = ''): Promise<NativeAdminGrantPageView> {
    pageCheck(limit, offset);
    validateQuery(query);
    const scope = await this.scope(actor, 'authorization.manage');
    const rows = await this.database.find('native_admin_grants', {
      organizationId: actor.organizationId, deletedAt: null });
    const visibleRows = rows.filter(row => visible(row, actor.organizationId)
      && typeof row.teacherId === 'string' && (row.status === 'active' || row.status === 'revoked')
      && typeof row.scope === 'object' && row.scope !== null && !Array.isArray(row.scope))
      .filter(row => {
        const target = row.scope as Record<string, unknown>;
        const targetClasses = Array.isArray(target.classIds) ? target.classIds : [];
        return scope.organizationWide || target.organizationWide !== true
          && targetClasses.every(id => typeof id === 'string' && scope.classIds.includes(id));
      })
      .filter(row => !query || String(row.teacherId).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
      .sort((left, right) => left._id.localeCompare(right._id));
    const items = await Promise.all(visibleRows.slice(offset, offset + limit).map(async row => {
      const target = row.scope as Record<string, unknown>;
      const user = await this.database.get('users', String(row.teacherId));
      return { teacherId: String(row.teacherId), status: row.status as 'active' | 'revoked',
        permissions: Array.isArray(row.permissions) ? row.permissions.filter((permission):
          permission is NativeAdminPermission => typeof permission === 'string'
            && NATIVE_ADMIN_PERMISSIONS.includes(permission as NativeAdminPermission)) : [],
        classIds: Array.isArray(target.classIds) ? target.classIds.filter((id): id is string =>
          typeof id === 'string') : [], organizationWide: target.organizationWide === true,
        version: row.version, userVersion: visible(user, actor.organizationId) ? user.version : 0 };
    }));
    return { items, nextOffset: offset + limit < visibleRows.length ? offset + limit : null };
  }

  public async listRecords(actor: TrustedActorContext, kind: NativeAdminRecordKind,
    limit: number, offset: number, filter: NativeAdminRecordFilter = {}): Promise<NativeAdminRecordPageView> {
    pageCheck(limit, offset);
    validateRecordFilter(filter);
    const permission: NativeAdminPermission = kind === 'textbooks' ? 'textbook.manage'
      : kind === 'questions' ? 'question.manage' : kind === 'tasks' ? 'task.manage' : 'media.review';
    const scope = await this.scope(actor, permission);
    const specs = kind === 'textbooks' ? [{ collection: 'learning_resources', type: 'reading' }]
      : kind === 'questions' ? [{ collection: 'learning_resources', type: 'exercise' }]
        : kind === 'tasks' ? [{ collection: 'tasks' }, { collection: 'checkin_activities' }]
          : [{ collection: 'learning_resources' }];
    const groups = await Promise.all(specs.map(spec => this.database.find(spec.collection, {
      organizationId: actor.organizationId, deletedAt: null,
      ...('type' in spec ? { type: spec.type } : {}) })));
    const all = groups.flatMap((rows, index) => rows.map(row => ({ row, collection: specs[index]!.collection })));
    if (all.length > 2000) throw new NativeAdminDataError('SERVICE_UNAVAILABLE');
    const effective = kind === 'media' ? await Promise.all(all.map(async item => ({
      ...item, row: await mediaWithEffectiveStatus(this.database, item.row),
    }))) : kind === 'questions' ? await Promise.all(all.map(async item => ({
      ...item, row: await hasActivePublicQuestionSource(this.database, item.row)
        ? item.row : { ...item.row, status: 'offline' },
    }))) : all;
    const selected = effective.filter(({ row, collection }) => visible(row, actor.organizationId)
      && recordKindMatches(kind, collection, row)
      && recordInScope(row, scope)
      && (kind !== 'media' || mediaRecordInScope(row, scope))
      && recordMatchesFilter(row, collection, kind, filter))
      .sort((left, right) => left.row._id.localeCompare(right.row._id));
    const items = await Promise.all(selected.slice(offset, offset + limit).map(async ({ row, collection }) => {
      const itemKind = collection === 'checkin_activities' ? 'activity' as const
        : collection === 'tasks' ? 'classroom' as const
          : kind === 'textbooks' ? 'textbook' as const : kind === 'questions' ? 'question' as const : 'media' as const;
      const catalogDraft = itemKind === 'textbook'
        ? await this.database.get('textbook_catalog_drafts',
          `textbook_catalog_${createHash('sha256').update(JSON.stringify([
            actor.organizationId, row._id])).digest('hex')}`) : null;
      const visibility = object(row.visibility);
      const rawClassIds = itemKind === 'textbook' && Array.isArray(catalogDraft?.classIds)
        ? catalogDraft.classIds : Array.isArray(row.allowedClassIds) ? row.allowedClassIds
          : Array.isArray(row.targetClassIds) ? row.targetClassIds
          : Array.isArray(row.classIds) ? row.classIds
            : Array.isArray(visibility?.classIds) ? visibility.classIds : [];
      const payload = object(row.payload);
      const media = object(payload?.teacherMedia);
      const status = itemKind === 'media' ? cleanText(media?.status) || '未记录'
        : itemKind === 'activity' ? cleanText(payload?.status) || cleanText(row.status) || '未记录'
          : itemKind === 'textbook' ? cleanText(catalogDraft?.status) || 'draft'
            : cleanText(row.status) || '未记录';
      const classIds = rawClassIds.filter((id): id is string => typeof id === 'string');
      const classNames = await Promise.all(classIds.map(async id => {
        const classroom = await this.database.get('classes', id);
        return visible(classroom, actor.organizationId) ? cleanText(classroom.name) || id : '';
      }));
      let participantCount: number | undefined;
      let completedCount: number | undefined;
      let pendingReviewCount: number | undefined;
      if (itemKind === 'classroom') {
        const assignments = await this.database.find('task_assignments', {
          organizationId: actor.organizationId, taskId: row._id, deletedAt: null,
        });
        const visibleAssignments = assignments.filter(assignment => visible(assignment, actor.organizationId)
          && assignment.taskId === row._id && (scope.organizationWide
            || typeof assignment.classId === 'string' && scope.classIds.includes(assignment.classId)));
        participantCount = visibleAssignments.length;
        completedCount = visibleAssignments.filter(item => item.status === 'completed').length;
        pendingReviewCount = visibleAssignments.filter(item => item.status === 'awaiting_review').length;
      }
      const creatorId = typeof row.creatorTeacherId === 'string' ? row.creatorTeacherId
        : typeof row.createdBy === 'string' ? row.createdBy : '';
      const creator = creatorId ? await this.database.get('users', creatorId) : null;
      const startsAt = typeof row.startsAt === 'string' ? row.startsAt
        : typeof payload?.startDate === 'string' ? payload.startDate : undefined;
      const dueAt = typeof row.dueAt === 'string' ? row.dueAt
        : typeof payload?.endDate === 'string' ? payload.endDate : undefined;
      return { id: row._id, kind: itemKind,
        version: itemKind === 'textbook' ? catalogDraft?.version ?? 0 : row.version,
        classIds,
        ...(itemKind === 'question' ? { organizationWide: visibility?.type === 'organization' } : {}),
        ...(creator && visible(creator, actor.organizationId)
          ? { creatorLabel: cleanText(creator.displayNameMasked) || '教师' } : {}),
        ...(classNames.length ? { classLabel: classNames.filter(Boolean).join('、') } : {}),
        ...(startsAt ? { startsAt } : {}), ...(dueAt ? { dueAt } : {}),
        ...(participantCount === undefined ? {} : { participantCount, completedCount, pendingReviewCount }),
        title: cleanText(row.title) || cleanText(row.name) || cleanText(payload?.title) || '未命名记录',
        status, statusLabel: nativeAdminStatusLabel(status, itemKind),
        detail: itemKind === 'media'
          ? object(payload?.assetLibrary)?.acceptanceStatus === 'pending_user_acceptance'
            ? '待用户验收 · 自动校验记录' : '来源、检查结果和处理记录见详情'
          : itemKind === 'question' ? `题型 ${cleanText(row.questionType) || '未标注'}`
            : itemKind === 'textbook' ? `年级 ${gradeLabel(row.grade) || '未标注'}`
              : itemKind === 'activity' ? '打卡活动' : '课堂任务' };
    }));
    return { items, nextOffset: offset + limit < selected.length ? offset + limit : null };
  }

  public async listAudit(actor: TrustedActorContext, limit: number,
    offset: number): Promise<NativeAdminAuditPageView> {
    pageCheck(limit, offset);
    const scope = await this.scope(actor, 'authorization.manage');
    // Historical operation logs use several schemas. Query only authorization
    // events so unrelated legacy rows cannot break the A-04 audit view.
    const logs = (await Promise.all(AUTHORIZATION_AUDIT_ACTIONS.map(action =>
      this.database.find('operation_logs', {
        organizationId: actor.organizationId, deletedAt: null, action,
      })))).flat();
    const rows = logs.filter(row => visible(row, actor.organizationId)
      && (scope.organizationWide || row.actorUserId === actor.actorUserId))
      .sort((left, right) => String(right.occurredAt ?? '').localeCompare(String(left.occurredAt ?? '')));
    return { items: rows.slice(offset, offset + limit).map(row => ({
      id: row._id, action: cleanText(row.action), targetType: cleanText(row.targetType),
      targetId: cleanText(row.targetId),
      result: row.result === 'denied' || row.result === 'failed' ? row.result : 'succeeded',
      occurredAt: cleanText(row.occurredAt), actorUserId: cleanText(row.actorUserId),
    })), nextOffset: offset + limit < rows.length ? offset + limit : null };
  }

  public async listUserBindings(actor: TrustedActorContext, userId: string): Promise<NativeAdminUserBindingsView> {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(userId)) throw new NativeAdminDataError('VALIDATION_ERROR');
    const scope = await this.scope(actor, 'user.manage');
    const user = await this.database.get('users', userId);
    if (!visible(user, actor.organizationId)) throw new NativeAdminDataError('NOT_FOUND');
    const links = await this.database.find('parent_student_links', {
      organizationId: actor.organizationId, deletedAt: null,
    });
    const candidates = links.filter(link => visible(link, actor.organizationId)
      && (link.parentId === userId || link.studentId === userId)
      && (link.status === 'active' || link.status === 'revoked'));
    const visibleLinks = [] as Array<{ link: VersionedDocument; parent: VersionedDocument; student: VersionedDocument }>;
    for (const link of candidates) {
      const parentId = typeof link.parentId === 'string' ? link.parentId : '';
      const studentId = typeof link.studentId === 'string' ? link.studentId : '';
      if (!parentId || !studentId) continue;
      const parent = await this.database.get('users', parentId);
      const student = await this.database.get('users', studentId);
      if (!visible(parent, actor.organizationId) || !visible(student, actor.organizationId)) continue;
      if (!scope.organizationWide) {
        const memberships = await this.database.find('class_memberships', { organizationId: actor.organizationId,
          studentId, status: 'active', deletedAt: null });
        const classIds = memberships.filter(row => visible(row, actor.organizationId))
          .map(row => typeof row.classId === 'string' ? row.classId : '');
        if (!classIds.length || classIds.some(classId => !scope.classIds.includes(classId))) continue;
      }
      visibleLinks.push({ link, parent, student });
    }
    return { userId, items: visibleLinks.map(({ link, parent, student }) => ({ id: link._id,
      parentId: parent._id, parentName: cleanText(parent.displayNameMasked) || '家长',
      studentId: student._id, studentName: cleanText(student.displayNameMasked) || '学员',
      status: link.status as 'active' | 'revoked',
      confirmedAt: typeof link.confirmedAt === 'string' ? link.confirmedAt : null,
      version: link.version })) };
  }

  public async getQuestionPreview(actor: TrustedActorContext,
    questionId: string): Promise<NativeAdminQuestionPreviewView> {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(questionId)) throw new NativeAdminDataError('VALIDATION_ERROR');
    const scope = await this.scope(actor, 'question.manage');
    const question = await this.database.get('learning_resources', questionId);
    if (!visible(question, actor.organizationId) || question.type !== 'exercise') {
      throw new NativeAdminDataError('NOT_FOUND');
    }
    if (!recordInScope(question, scope)) throw new NativeAdminDataError('FORBIDDEN');
    const visibility = object(question.visibility);
    const classIds = Array.isArray(visibility?.classIds)
      ? visibility.classIds.filter((id): id is string => typeof id === 'string') : [];
    const payload = object(question.payload);
    return { id: question._id, title: cleanText(question.title) || '未命名题目',
      version: question.version, questionType: cleanText(question.questionType) || '未标注',
      stem: safeContentText(question.stem ?? payload?.stem),
      answer: safeContentText(question.correctAnswer ?? payload?.correctAnswer),
      explanation: safeContentText(question.explanation ?? payload?.explanation),
      organizationWide: visibility?.type === 'organization', classIds };
  }

  public async exportTaskRecords(actor: TrustedActorContext,
    filter: NativeAdminRecordFilter = {}): Promise<NativeAdminRecordsExportView> {
    const rows: NativeAdminRecordPageView['items'][number][] = [];
    let offset = 0;
    for (let pageNumber = 0; pageNumber < 40; pageNumber++) {
      const page = await this.listRecords(actor, 'tasks', 50, offset, filter);
      rows.push(...page.items);
      if (page.nextOffset === null) {
        const cells = [['类型', '记录ID', '名称', '状态', '版本'], ...rows.map(row => [
          row.kind === 'activity' ? '打卡活动' : '课堂任务', row.id, row.title,
          row.status, String(row.version),
        ])];
        return { fileName: '雅睿英语-授权任务活动.csv', rowCount: rows.length,
          csv: '\uFEFF' + cells.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n' };
      }
      offset = page.nextOffset;
    }
    throw new NativeAdminDataError('SERVICE_UNAVAILABLE');
  }

  public async getMediaReviewSummary(actor: TrustedActorContext,
    mediaId: string): Promise<NativeAdminMediaReviewSummaryView> {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(mediaId)) throw new NativeAdminDataError('VALIDATION_ERROR');
    const row = await this.database.get('learning_resources', mediaId);
    const payload = object(row?.payload);
    const media = object(payload?.teacherMedia);
    const origin = object(payload?.assetLibrary);
    if (!visible(row, actor.organizationId) || !payload || !media || !origin
      || !Number.isSafeInteger(row.contentVersion)
      || !hasAssetLibraryOrigin(payload as JsonObject, mediaId, Number(row.contentVersion))) {
      throw new NativeAdminDataError('FORBIDDEN');
    }
    const visibility = object(row.visibility);
    const classIds = visibility?.type === 'classes' && Array.isArray(visibility.classIds)
      ? visibility.classIds.filter((id): id is string => typeof id === 'string')
      : visibility?.type === 'organization' && Array.isArray(media.allowedClassIds)
        ? media.allowedClassIds.filter((id): id is string => typeof id === 'string') : [];
    const scope = await this.scope(actor, 'media.review');
    if (visibility?.type === 'organization' ? !scope.organizationWide
      : !classIds.length || classIds.some(id => !scope.organizationWide && !scope.classIds.includes(id))) {
      throw new NativeAdminDataError('FORBIDDEN');
    }
    if (row.type !== 'listening' && row.type !== 'video' && row.type !== 'dubbing') {
      throw new NativeAdminDataError('SERVICE_UNAVAILABLE');
    }
    const effectiveRow = await mediaWithEffectiveStatus(this.database, row);
    const effectiveMedia = object(object(effectiveRow.payload)?.teacherMedia);
    const mediaStatus = cleanText(effectiveMedia?.status) || '未记录';
    const summary: NativeAdminMediaReviewSummaryView = {
      id: row._id, title: cleanText(row.title) || '未命名媒体', kind: row.type,
      status: mediaStatus,
      statusLabel: nativeAdminStatusLabel(mediaStatus, 'media'),
      recordVersion: row.version,
      scanStatus: scanStatus(media.scanStatus), transcodeStatus: transcodeStatus(media.transcodeStatus),
      sourceScanEvidencePresent: object(media.sourceScanEvidence) !== null,
      outputScanEvidencePresent: object(media.scanEvidence) !== null,
      transcodeEvidencePresent: object(media.transcodeEvidence) !== null,
      copyrightEvidencePresent: typeof media.copyrightEvidenceKey === 'string'
        && media.copyrightEvidenceKey.startsWith('cloud://'),
      questionCount: Array.isArray(media.questionIds) ? media.questionIds.length : 0,
      clipCount: Array.isArray(media.clips) ? media.clips.length : 0,
      subtitleCount: Array.isArray(media.subtitleCues) ? media.subtitleCues.length : 0,
      continuousPlaybackEnforced: media.continuousPlaybackEnforced === true,
      allowedClassIds: classIds,
      reviewerIsOwner: origin.importedBy === actor.actorUserId,
    };
    return summary;
  }

  public async getMediaPreview(actor: TrustedActorContext,
    mediaId: string): Promise<NativeAdminMediaPreviewView> {
    const summary = await this.getMediaReviewSummary(actor, mediaId);
    const row = await this.database.get('learning_resources', mediaId);
    const payload = object(row?.payload);
    const media = object(payload?.teacherMedia);
    if (!row || !payload || !media || row.status !== 'published'
      || summary.status !== 'published'
      || summary.scanStatus !== 'clean' || summary.transcodeStatus !== 'ready'
      || !summary.sourceScanEvidencePresent || !summary.outputScanEvidencePresent
      || !summary.transcodeEvidencePresent || !summary.copyrightEvidencePresent
      || !hasApprovedAssetLibraryOrigin(payload as JsonObject, mediaId, Number(row.contentVersion))
      || typeof media.mediaAssetKey !== 'string' || !media.mediaAssetKey.startsWith('cloud://')) {
      throw new NativeAdminDataError('SERVICE_UNAVAILABLE');
    }
    const candidate = { ...media, id: row._id, organizationId: row.organizationId,
      kind: summary.kind, title: row.title, version: row.contentVersion,
      status: row.status } as unknown as TeacherMediaCandidate;
    const previewClass = candidate.catalogScope === 'all_teachers'
      ? 'catalog_preview_probe' : summary.allowedClassIds[0];
    if (!previewClass || !freezeTeacherMediaForTask(candidate,
      actor.organizationId, [previewClass]).ready) throw new NativeAdminDataError('SERVICE_UNAVAILABLE');
    if (!this.playback) throw new NativeAdminDataError('SERVICE_UNAVAILABLE');
    let temporaryUrl: string;
    try {
      const result = await this.playback.getTempFileURL({ fileList: [{ fileID: media.mediaAssetKey,
        maxAge: 60 }] });
      const signed = result.fileList?.find(item => item.fileID === media.mediaAssetKey);
      if (!signed?.tempFileURL?.startsWith('https://')
        || signed.code !== undefined && signed.code !== 'SUCCESS') throw new Error('SIGN_FAILED');
      temporaryUrl = signed.tempFileURL;
    } catch { throw new NativeAdminDataError('SERVICE_UNAVAILABLE'); }
    const clips = Array.isArray(media.clips) ? media.clips.map(value => object(value)) : [];
    const subtitles = Array.isArray(media.subtitleCues)
      ? media.subtitleCues.map(value => object(value)) : [];
    return { id: mediaId, kind: summary.kind, temporaryUrl,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      clips: clips.filter((clip): clip is NonNullable<typeof clip> => clip !== null)
        .filter(clip => typeof clip.questionId === 'string'
          && typeof clip.segmentId === 'string'
          && Number.isSafeInteger(clip.startMs) && Number.isSafeInteger(clip.endMs))
        .map(clip => ({ questionId: String(clip.questionId), segmentId: String(clip.segmentId),
          startMs: Number(clip.startMs), endMs: Number(clip.endMs) })),
      subtitles: subtitles.filter((cue): cue is NonNullable<typeof cue> => cue !== null)
        .filter(cue => typeof cue.text === 'string'
          && Number.isSafeInteger(cue.startMs) && Number.isSafeInteger(cue.endMs))
        .map(cue => ({ startMs: Number(cue.startMs), endMs: Number(cue.endMs),
          text: String(cue.text), ...(typeof cue.translationText === 'string'
            && cue.translationText.trim() ? { translationText: cue.translationText.trim() } : {}) })) };
  }

  public async listMediaAudit(actor: TrustedActorContext, mediaId: string,
    limit: number, offset: number): Promise<NativeAdminMediaAuditPageView> {
    await this.getMediaReviewSummary(actor, mediaId);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50
      || !Number.isSafeInteger(offset) || offset < 0 || offset > 10000) {
      throw new NativeAdminDataError('VALIDATION_ERROR');
    }
    const rows = await this.database.find('operation_logs', {
      organizationId: actor.organizationId, targetType: 'learning_resource',
      targetId: mediaId, deletedAt: null });
    if (rows.length > 2000) throw new NativeAdminDataError('SERVICE_UNAVAILABLE');
    const filtered = rows.filter(row => typeof row.action === 'string'
      && row.action.startsWith('asset_library.media.'))
      .sort((left, right) => String(right.occurredAt).localeCompare(String(left.occurredAt))
        || right._id.localeCompare(left._id));
    return { items: filtered.slice(offset, offset + limit).map(row => {
      const metadata = object(row.metadata);
      return { id: row._id, action: String(row.action),
        actorUserId: typeof row.actorUserId === 'string' ? row.actorUserId : '',
        occurredAt: typeof row.occurredAt === 'string' ? row.occurredAt : '',
        issueReason: typeof metadata?.issueReason === 'string' ? metadata.issueReason : null };
    }), nextOffset: offset + limit < filtered.length ? offset + limit : null };
  }

  private async projectUser(organizationId: string, user: VersionedDocument,
    scope: Readonly<{ organizationWide: boolean; classIds: readonly string[] }>,
    classId?: string) {
    const roles = await this.database.find('role_assignments', {
      organizationId, userId: user._id, status: 'active', deletedAt: null });
    const role = resolveUserRole(user, roles.find(row => visible(row, organizationId))?.role);
    const memberships = await this.database.find('class_memberships', { organizationId,
      studentId: user._id, status: 'active', deletedAt: null });
    const scopedMemberships = memberships.filter(row => visible(row, organizationId)
      && typeof row.classId === 'string' && (scope.organizationWide || scope.classIds.includes(row.classId)));
    const classes = await Promise.all(scopedMemberships.map(row => this.database.get('classes', String(row.classId))));
    const classNames = classes.filter((row): row is VersionedDocument => visible(row, organizationId))
      .map(row => cleanText(row.name) || row._id);
    const links = await this.database.find('parent_student_links', { organizationId, deletedAt: null });
    let bindingCount = 0;
    for (const link of links.filter(row => visible(row, organizationId) && row.status === 'active'
      && (row.parentId === user._id || row.studentId === user._id))) {
      if (scope.organizationWide) { bindingCount += 1; continue; }
      const studentId = typeof link.studentId === 'string' ? link.studentId : '';
      const memberships = await this.database.find('class_memberships', { organizationId, studentId,
        status: 'active', deletedAt: null });
      const scopedIds = memberships.filter(row => visible(row, organizationId)
        && typeof row.classId === 'string').map(row => String(row.classId));
      if (scopedIds.length && scopedIds.every(id => scope.classIds.includes(id))
        && (!classId || scopedIds.includes(classId))) bindingCount += 1;
    }
    return { id: user._id, displayName: cleanText(user.displayName) || cleanText(user.displayNameMasked) || '未命名用户',
      role: typeof role === 'string' ? role : '', classNames,
      lastLoginAt: typeof user.lastLoginAt === 'string' && Number.isFinite(Date.parse(user.lastLoginAt)) ? user.lastLoginAt : null,
      roleLabel: roleLabel(role),
      status: user.status === 'active' ? 'active' as const : 'disabled' as const,
      version: user.version, bindingCount,
      ...(typeof user.studentNumber === 'string' ? { studentNumber: user.studentNumber } : {}),
      ...(typeof user.mobileMasked === 'string' ? { mobileMasked: user.mobileMasked } : {}) };
  }

  private async usersForClass(organizationId: string, classId: string): Promise<VersionedDocument[]> {
    const members = await this.database.find('class_memberships', { organizationId, classId,
      status: 'active', deletedAt: null });
    const users = await Promise.all(members.filter(row => visible(row, organizationId)
      && row.classId === classId && typeof row.studentId === 'string')
      .map(row => this.database.get('users', String(row.studentId))));
    return users.filter((row): row is VersionedDocument => visible(row, organizationId));
  }

  private async scope(actor: TrustedActorContext, permission: NativeAdminPermission,
    classId?: string): Promise<Readonly<{ organizationWide: boolean; classIds: readonly string[] }>> {
    const decision = await authorizeNativeAdmin(this.grants, actor, permission, classId);
    if (!decision.allowed) throw new NativeAdminDataError('FORBIDDEN');
    return decision.scope;
  }

  private async visibleClasses(organizationId: string,
    scope: Readonly<{ organizationWide: boolean; classIds: readonly string[] }>): Promise<VersionedDocument[]> {
    if (scope.organizationWide) {
      const rows = await this.database.find('classes', { organizationId, deletedAt: null });
      return rows.filter(row => visible(row, organizationId));
    }
    const rows = await Promise.all(scope.classIds.map(id => this.database.get('classes', id)));
    return rows.filter((row): row is VersionedDocument => visible(row, organizationId));
  }
}

function nativeAdminStatusLabel(status: string, kind: NativeAdminRecordPageView['items'][number]['kind'] | 'media'): string {
  if (kind === 'activity' && status === 'published') return '进行中'
  if (kind === 'textbook' && status === 'published') return '已发布'
  if (kind === 'question' && status === 'published') return '已上架'
  if (kind === 'media') {
    if (status === 'published') return '可布置'
    if (status === 'pending_review' || status === 'approved' || status === 'draft') return '缺项或待处理'
    if (status === 'rejected') return '不可布置'
  }
  const labels: Readonly<Record<string, string>> = {
    draft: '草稿', pending: '待处理', pending_review: '待审核', approved: '待上架',
    active: '进行中', disabled: '停用', offline: '已下架', rejected: '已驳回',
    closed: '已关闭', complete: '已完成', completed: '已完成', withdrawn: '已撤回', expired: '已过期',
  }
  return labels[status] ?? status
}

function visible(row: VersionedDocument | null, organizationId: string): row is VersionedDocument {
  return row !== null && row.organizationId === organizationId && row.deletedAt === null;
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, 100) : '';
}

function resolveUserRole(user: VersionedDocument, activeRole: unknown): string {
  const knownRoles = ['student', 'parent', 'teacher', 'admin'];
  if (typeof activeRole === 'string' && knownRoles.includes(activeRole)) return activeRole;
  return Array.isArray(user.roles)
    ? user.roles.find(value => typeof value === 'string' && knownRoles.includes(value)) ?? '' : '';
}

function roleLabel(role: string): string {
  return role === 'student' ? '学员' : role === 'parent' ? '家长'
    : role === 'teacher' ? '教师' : role === 'admin' ? '管理者' : '未标注';
}

function safeContentText(value: unknown): string {
  if (value === null || value === undefined) return '未记录';
  if (typeof value === 'string') return value.slice(0, 2000);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const serialized = JSON.stringify(value);
  return typeof serialized === 'string' ? serialized.slice(0, 2000) : '未记录';
}

function gradeLabel(value: unknown): string {
  return Number.isSafeInteger(value) ? `${value} 年级` : cleanText(value);
}

function pageCheck(limit: number, offset: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50
    || !Number.isSafeInteger(offset) || offset < 0 || offset > 10000) {
    throw new NativeAdminDataError('VALIDATION_ERROR');
  }
}

function validateQuery(query: string): void {
  if (typeof query !== 'string' || query.length > 100 || /[\u0000-\u001f]/u.test(query)) {
    throw new NativeAdminDataError('VALIDATION_ERROR');
  }
}

function recordKindMatches(kind: NativeAdminRecordKind, collection: string,
  row: VersionedDocument): boolean {
  if (kind === 'textbooks') return collection === 'learning_resources'
    && row.type === 'reading' && (row.category === 'synchronized' || row.category === 'textbook');
  if (kind === 'questions') return collection === 'learning_resources' && row.type === 'exercise';
  if (kind === 'tasks') return collection === 'tasks' || collection === 'checkin_activities';
  return collection === 'learning_resources'
    && (row.type === 'listening' || row.type === 'video' || row.type === 'dubbing')
    && Number.isSafeInteger(row.contentVersion)
    && object(row.payload) !== null
    && hasAssetLibraryOrigin(row.payload as JsonObject, row._id, Number(row.contentVersion));
}

function mediaRecordInScope(row: VersionedDocument,
  scope: Readonly<{ organizationWide: boolean; classIds: readonly string[] }>): boolean {
  const visibility = object(row.visibility);
  if (visibility?.type === 'organization') return scope.organizationWide;
  const ids = visibility?.type === 'classes' && Array.isArray(visibility.classIds)
    ? visibility.classIds : [];
  return ids.length > 0 && ids.every(id => typeof id === 'string'
    && (scope.organizationWide || scope.classIds.includes(id)));
}

function recordInScope(row: VersionedDocument,
  scope: Readonly<{ organizationWide: boolean; classIds: readonly string[] }>): boolean {
  if (scope.organizationWide) return true;
  const visibility = typeof row.visibility === 'object' && row.visibility !== null
    && !Array.isArray(row.visibility) ? row.visibility as Record<string, unknown> : null;
  if (visibility?.type === 'organization') return true;
  const schedule = typeof row.schedule === 'object' && row.schedule !== null
    && !Array.isArray(row.schedule) ? row.schedule as Record<string, unknown> : null;
  const classIds = Array.isArray(row.allowedClassIds) ? row.allowedClassIds
    : Array.isArray(row.targetClassIds) ? row.targetClassIds
      : Array.isArray(row.classIds) ? row.classIds
      : Array.isArray(visibility?.classIds) ? visibility.classIds
        : typeof row.classId === 'string' ? [row.classId]
          : typeof schedule?.classId === 'string' ? [schedule.classId] : [];
  return classIds.length > 0 && classIds.every(id => typeof id === 'string' && scope.classIds.includes(id));
}

function validateRecordFilter(filter: NativeAdminRecordFilter): void {
  if (filter.query !== undefined && (filter.query.length > 100
    || /[\u0000-\u001f]/u.test(filter.query))) throw new NativeAdminDataError('VALIDATION_ERROR');
  if (filter.status !== undefined && (filter.status.length > 40
    || /[\u0000-\u001f]/u.test(filter.status))) throw new NativeAdminDataError('VALIDATION_ERROR');
  if (filter.mediaKind !== undefined && !['', 'listening', 'video', 'dubbing'].includes(filter.mediaKind)) {
    throw new NativeAdminDataError('VALIDATION_ERROR');
  }
  if (filter.taskType !== undefined && !['all', 'classroom', 'activity'].includes(filter.taskType)) {
    throw new NativeAdminDataError('VALIDATION_ERROR');
  }
  for (const date of [filter.from, filter.to]) {
    if (date !== undefined && (!/^\d{4}-\d{2}-\d{2}$/u.test(date)
      || !Number.isFinite(Date.parse(`${date}T00:00:00.000Z`)))) {
      throw new NativeAdminDataError('VALIDATION_ERROR');
    }
  }
  if (filter.from && filter.to && filter.from > filter.to) {
    throw new NativeAdminDataError('VALIDATION_ERROR');
  }
}

function recordMatchesFilter(row: VersionedDocument, collection: string, kind: NativeAdminRecordKind,
  filter: NativeAdminRecordFilter): boolean {
  if (kind === 'media' && filter.mediaKind && row.type !== filter.mediaKind) return false;
  const payload = object(row.payload);
  const media = object(payload?.teacherMedia);
  const status = kind === 'media' ? media?.status
    : collection === 'checkin_activities' ? payload?.status ?? row.status : row.status;
  if (filter.status && status !== filter.status) return false;
  if (kind === 'tasks' && filter.taskType && filter.taskType !== 'all'
    && (filter.taskType === 'activity') !== (collection === 'checkin_activities')) return false;
  const schedule = object(row.schedule);
  const date = [row.createdAt, row.publishedAt, row.updatedAt, row.startsAt, row.dueAt,
    schedule?.startDate, schedule?.endDate, payload?.createdAt, payload?.startedAt,
    payload?.startDate].find(value => typeof value === 'string') as string | undefined;
  if (filter.from || filter.to) {
    const timestamp = date ? Date.parse(date) : Number.NaN;
    if (!Number.isFinite(timestamp)) return false;
    if (filter.from && timestamp < Date.parse(`${filter.from}T00:00:00.000Z`)) return false;
    if (filter.to && timestamp >= Date.parse(`${filter.to}T00:00:00.000Z`) + 86_400_000) return false;
  }
  if (filter.query) {
    const query = filter.query.trim().toLocaleLowerCase();
    const haystack = [row._id, row.title, row.name, row.displayName, row.studentNumber,
      row.status, row.questionType, payload?.title, payload?.name]
      .filter((value): value is string => typeof value === 'string')
      .join(' ').toLocaleLowerCase();
    if (!haystack.includes(query)) return false;
  }
  return true;
}

async function mediaWithEffectiveStatus(database: DocumentDatabasePort,
  row: VersionedDocument): Promise<VersionedDocument> {
  if (row.status !== 'offline' && (row.status !== 'published'
    || await hasActivePublicMediaSource(database, row))) return row;
  const payload = object(row.payload);
  const media = object(payload?.teacherMedia);
  if (!payload || !media) return row;
  return { ...row, status: 'offline', payload: { ...payload,
    teacherMedia: { ...media, status: 'offline' } } } as VersionedDocument;
}

function csvCell(value: string): string {
  const safe = /^[\s]*[=+@-]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}
function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function scanStatus(value: unknown): 'pending' | 'clean' | 'failed' {
  return value === 'clean' || value === 'failed' ? value : 'pending';
}
function transcodeStatus(value: unknown): 'pending' | 'ready' | 'failed' {
  return value === 'ready' || value === 'failed' ? value : 'pending';
}
