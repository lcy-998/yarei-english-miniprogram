import { createHash } from 'node:crypto';
import type { TrustedActorContext } from '../auth/trusted-actor';
import type { DocumentDatabasePort, DocumentDatabaseTransactionPort,
  VersionedDocument } from '../repositories/document-database-port';
import { TEACHER_CLASS_PERMISSIONS, type TeacherClassPermission } from '../org-content/types';
import { authorizeNativeAdmin, type NativeAdminGrantReader,
  type NativeAdminPermission } from './authorization';
import { nativeAdminGrantId } from './document-grant-repository';

export interface NativeAdminClassMutationView { id: string; name: string; grade: number;
  term: string; status: 'active' | 'disabled'; version: number }
export interface NativeAdminClassArchiveView { id: string; status: 'disabled';
  migratedStudentCount: number; destinationClassId: string | null; version: number }
export interface NativeAdminTeacherAssignmentView { classId: string; teacherId: string;
  permissions: TeacherClassPermission[]; version: number }
export interface NativeAdminUserMutationView { id: string; displayName: string;
  status: 'active' | 'disabled'; version: number }
export interface NativeAdminUnbindView { linkId: string; status: 'revoked'; version: number }
export interface NativeAdminOrganizationView { id: string; name: string; status: 'active' | 'disabled'; version: number }
export interface NativeAdminBindView { linkId: string; status: 'active'; version: number }

export class NativeAdminManagementError extends Error {
  public constructor(public readonly code: 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION_ERROR' | 'SERVICE_UNAVAILABLE') {
    super(code);
  }
}

export class NativeAdminManagementService {
  public constructor(private readonly database: DocumentDatabasePort,
    private readonly grants: NativeAdminGrantReader,
    private readonly clock: Readonly<{ nowIso(): string }>) {}

  public async updateOrganization(actor: TrustedActorContext, input: Readonly<{
    name: string; reason: string }>, expectedVersion: number, operationId: string): Promise<NativeAdminOrganizationView> {
    operationCheck(expectedVersion, operationId, input.reason);
    if (!input.name.trim() || input.name.trim().length > 50) throw new NativeAdminManagementError('VALIDATION_ERROR');
    const scope = await this.authorize(actor, 'organization.manage');
    if (!scope.organizationWide) throw new NativeAdminManagementError('FORBIDDEN');
    return this.database.runTransaction(async tx => {
      await this.liveGuard(tx, actor, 'organization.manage', undefined, true);
      const fingerprint = hash(['updateOrganization', input, expectedVersion]);
      const prior = await this.receipt<NativeAdminOrganizationView>(tx, actor, operationId, fingerprint);
      if (prior) return prior;
      const current = await tx.get('organizations', actor.organizationId);
      if (!visible(current, actor.organizationId)) throw new NativeAdminManagementError('NOT_FOUND');
      if (current.version !== expectedVersion || current.status !== 'active') throw new NativeAdminManagementError('CONFLICT');
      const next = { ...current, name: input.name.trim(), version: current.version + 1 };
      if (!await tx.replace('organizations', current._id, current.version, next)) throw new NativeAdminManagementError('CONFLICT');
      const result: NativeAdminOrganizationView = { id: next._id, name: next.name, status: 'active', version: next.version };
      await this.finish(tx, actor, operationId, fingerprint, 'native_admin.organization.updated',
        'organization', current._id, input.reason, result);
      return result;
    });
  }

  public async bindParentLink(actor: TrustedActorContext, input: Readonly<{
    parentId: string; studentId: string; reason: string }>, expectedVersion: number,
    operationId: string): Promise<NativeAdminBindView> {
    idCheck(input.parentId); idCheck(input.studentId);
    operationCheck(expectedVersion, operationId, input.reason, true);
    if (expectedVersion !== 0 || input.parentId === input.studentId) throw new NativeAdminManagementError('VALIDATION_ERROR');
    await this.authorize(actor, 'user.manage');
    return this.database.runTransaction(async tx => {
      const scope = await this.liveGuard(tx, actor, 'user.manage');
      const fingerprint = hash(['bindParentLink', input, expectedVersion]);
      const prior = await this.receipt<NativeAdminBindView>(tx, actor, operationId, fingerprint);
      if (prior) return prior;
      const parent = await tx.get('users', input.parentId);
      const student = await tx.get('users', input.studentId);
      if (!visible(parent, actor.organizationId) || parent.status !== 'active'
        || !visible(student, actor.organizationId) || student.status !== 'active') throw new NativeAdminManagementError('NOT_FOUND');
      for (const [userId, role] of [[input.parentId, 'parent'], [input.studentId, 'student']]) {
        const roles = await tx.find('role_assignments', { organizationId: actor.organizationId, userId, role, status: 'active', deletedAt: null });
        if (!roles.some(row => visible(row, actor.organizationId) && row.userId === userId && row.role === role)) {
          throw new NativeAdminManagementError('FORBIDDEN');
        }
      }
      const memberships = await tx.find('class_memberships', { organizationId: actor.organizationId,
        studentId: input.studentId, status: 'active', deletedAt: null });
      const classIds = memberships.filter(row => visible(row, actor.organizationId)
        && typeof row.classId === 'string').map(row => String(row.classId));
      if (!scope.organizationWide && (!classIds.length || classIds.some(id => !scope.classIds.includes(id)))) {
        throw new NativeAdminManagementError('FORBIDDEN');
      }
      const parentLinks = (await tx.find('parent_student_links', { organizationId: actor.organizationId,
        parentId: input.parentId, status: 'active', deletedAt: null })).filter(row => visible(row, actor.organizationId));
      const studentLinks = (await tx.find('parent_student_links', { organizationId: actor.organizationId,
        studentId: input.studentId, status: 'active', deletedAt: null })).filter(row => visible(row, actor.organizationId));
      if (parentLinks.some(row => row.studentId === input.studentId) || parentLinks.length >= 5 || studentLinks.length >= 3) {
        throw new NativeAdminManagementError('CONFLICT');
      }
      const now = this.clock.nowIso();
      const linkId = `link_native_${hash([actor.organizationId, operationId, actor.actorUserId]).slice(0, 32)}`;
      if (!await tx.create('parent_student_links', { _id: linkId, organizationId: actor.organizationId,
        schemaVersion: 1, version: 1, deletedAt: null, parentId: input.parentId, studentId: input.studentId,
        status: 'active', confirmedAt: now, boundBy: actor.actorUserId })) throw new NativeAdminManagementError('CONFLICT');
      // Both user rows are the concurrency guard for their respective binding limits.
      for (const user of [parent, student]) {
        if (!await tx.replace('users', user._id, user.version, { ...user, version: user.version + 1 })) {
          throw new NativeAdminManagementError('CONFLICT');
        }
      }
      const result: NativeAdminBindView = { linkId, status: 'active', version: 1 };
      await this.finish(tx, actor, operationId, fingerprint, 'native_admin.parent_link.created',
        'parent_student_link', linkId, input.reason, result);
      return result;
    });
  }

  public async createClass(actor: TrustedActorContext, input: Readonly<{
    name: string; grade: number; term: string; reason: string }>, expectedVersion: number,
    operationId: string): Promise<NativeAdminClassMutationView> {
    this.validateClass(input);
    operationCheck(expectedVersion, operationId, input.reason, true);
    const scope = await this.authorize(actor, 'organization.manage');
    if (!scope.organizationWide) throw new NativeAdminManagementError('FORBIDDEN');
    const id = `cls_native_${hash([actor.organizationId, actor.actorUserId, operationId]).slice(0, 32)}`;
    return this.database.runTransaction(async tx => {
      await this.liveGuard(tx, actor, 'organization.manage', undefined, true);
      const prior = await this.receipt<NativeAdminClassMutationView>(tx, actor, operationId,
        hash(['createClass', input, expectedVersion]));
      if (prior) return prior;
      const duplicate = await tx.find('classes', { organizationId: actor.organizationId,
        name: input.name.trim(), deletedAt: null });
      if (duplicate.some(row => row.status === 'active')) throw new NativeAdminManagementError('CONFLICT');
      const document: VersionedDocument = { _id: id, organizationId: actor.organizationId,
        schemaVersion: 1, version: 1, deletedAt: null,
        name: input.name.trim(), grade: input.grade, term: input.term.trim(), status: 'active' };
      if (!await tx.create('classes', document)) throw new NativeAdminManagementError('CONFLICT');
      const result: NativeAdminClassMutationView = { id, name: input.name.trim(), grade: input.grade,
        term: input.term.trim(), status: 'active', version: 1 };
      await this.finish(tx, actor, operationId, hash(['createClass', input, expectedVersion]),
        'native_admin.class.created', 'class', id, input.reason, result);
      return result;
    });
  }

  public async updateClass(actor: TrustedActorContext, input: Readonly<{
    classId: string; name: string; grade: number; term: string; reason: string }>,
    expectedVersion: number, operationId: string): Promise<NativeAdminClassMutationView> {
    this.validateClass(input);
    idCheck(input.classId);
    operationCheck(expectedVersion, operationId, input.reason);
    await this.authorize(actor, 'organization.manage', input.classId);
    return this.database.runTransaction(async tx => {
      await this.liveGuard(tx, actor, 'organization.manage', input.classId);
      const fingerprint = hash(['updateClass', input, expectedVersion]);
      const prior = await this.receipt<NativeAdminClassMutationView>(tx, actor, operationId, fingerprint);
      if (prior) return prior;
      const current = await tx.get('classes', input.classId);
      if (!visible(current, actor.organizationId)) throw new NativeAdminManagementError('NOT_FOUND');
      if (current.version !== expectedVersion) throw new NativeAdminManagementError('CONFLICT');
      const next: VersionedDocument = { ...current, version: current.version + 1,
        name: input.name.trim(), grade: input.grade, term: input.term.trim() };
      if (!await tx.replace('classes', current._id, current.version, next)) throw new NativeAdminManagementError('CONFLICT');
      const result: NativeAdminClassMutationView = { id: next._id, name: String(next.name),
        grade: Number(next.grade), term: String(next.term),
        status: next.status === 'active' ? 'active' : 'disabled', version: next.version };
      await this.finish(tx, actor, operationId, fingerprint, 'native_admin.class.updated',
        'class', input.classId, input.reason, result);
      return result;
    });
  }

  public async archiveClass(actor: TrustedActorContext, input: Readonly<{
    classId: string; destinationClassId: string | null; reason: string }> ,
    expectedVersion: number, destinationExpectedVersion: number | null,
    operationId: string): Promise<NativeAdminClassArchiveView> {
    idCheck(input.classId);
    if (input.destinationClassId !== null) idCheck(input.destinationClassId);
    operationCheck(expectedVersion, operationId, input.reason);
    if (input.destinationClassId === input.classId
      || (input.destinationClassId === null && destinationExpectedVersion !== null)
      || (input.destinationClassId !== null
        && (!Number.isSafeInteger(destinationExpectedVersion) || Number(destinationExpectedVersion) < 1))) {
      throw new NativeAdminManagementError('VALIDATION_ERROR');
    }
    await this.authorize(actor, 'organization.manage', input.classId);
    if (input.destinationClassId !== null) {
      await this.authorize(actor, 'organization.manage', input.destinationClassId);
    }
    return this.database.runTransaction(async tx => {
      const sourceScope = await this.liveGuard(tx, actor, 'organization.manage', input.classId);
      const destinationScope = input.destinationClassId === null ? null
        : await this.liveGuard(tx, actor, 'organization.manage', input.destinationClassId);
      const fingerprint = hash(['archiveClass', input, expectedVersion, destinationExpectedVersion]);
      const prior = await this.receipt<NativeAdminClassArchiveView>(tx, actor, operationId, fingerprint);
      if (prior) return prior;
      const source = await tx.get('classes', input.classId);
      if (!visible(source, actor.organizationId) || source.status !== 'active') {
        throw new NativeAdminManagementError('NOT_FOUND');
      }
      if (source.version !== expectedVersion) throw new NativeAdminManagementError('CONFLICT');
      if (!sourceScope.organizationWide && !sourceScope.classIds.includes(input.classId)) {
        throw new NativeAdminManagementError('FORBIDDEN');
      }
      const members = (await tx.find('class_memberships', { organizationId: actor.organizationId,
        classId: input.classId, status: 'active', deletedAt: null }))
        .filter(row => visible(row, actor.organizationId) && row.classId === input.classId
          && typeof row.studentId === 'string');
      if (members.length && input.destinationClassId === null) {
        throw new NativeAdminManagementError('VALIDATION_ERROR');
      }
      let destination: VersionedDocument | null = null;
      if (input.destinationClassId !== null) {
        destination = await tx.get('classes', input.destinationClassId);
        if (!visible(destination, actor.organizationId) || destination.status !== 'active'
          || !destinationScope || !destinationScope.organizationWide
            && !destinationScope.classIds.includes(input.destinationClassId)) {
          throw new NativeAdminManagementError('FORBIDDEN');
        }
        if (destination.version !== destinationExpectedVersion) throw new NativeAdminManagementError('CONFLICT');
        const existing = await tx.find('class_memberships', { organizationId: actor.organizationId,
          classId: destination._id, deletedAt: null });
        const membershipsByStudent = new Map(existing.filter(row => visible(row, actor.organizationId)
          && typeof row.studentId === 'string').map(row => [String(row.studentId), row] as const));
        const destinationStudents = new Set(existing.filter(row => visible(row, actor.organizationId)
          && row.status === 'active' && typeof row.studentId === 'string').map(row => String(row.studentId)));
        if (members.some(member => destinationStudents.has(String(member.studentId)))) {
          throw new NativeAdminManagementError('CONFLICT');
        }
        const now = this.clock.nowIso();
        for (const member of members) {
          const transferred: VersionedDocument = { ...member, status: 'transferred',
            version: member.version + 1, leftAt: now, transferredToClassId: destination._id };
          if (!await tx.replace('class_memberships', member._id, member.version, transferred)) {
            throw new NativeAdminManagementError('CONFLICT');
          }
          const priorDestination = membershipsByStudent.get(String(member.studentId));
          if (priorDestination) {
            if (priorDestination.status === 'active'
              || !await tx.replace('class_memberships', priorDestination._id, priorDestination.version,
                { ...priorDestination, status: 'active', version: priorDestination.version + 1,
                  joinedAt: now, transferredFromClassId: source._id, leftAt: null })) {
              throw new NativeAdminManagementError('CONFLICT');
            }
          } else {
            const newId = `mem_native_${hash([actor.organizationId, member.studentId, destination._id]).slice(0, 32)}`;
            if (!await tx.create('class_memberships', { _id: newId, organizationId: actor.organizationId,
              schemaVersion: 1, version: 1, deletedAt: null, classId: destination._id,
              studentId: member.studentId, status: 'active', joinedAt: now, transferredFromClassId: source._id })) {
              throw new NativeAdminManagementError('CONFLICT');
            }
          }
        }
      }
      const now = this.clock.nowIso();
      const archived: VersionedDocument = { ...source, status: 'disabled', version: source.version + 1,
        disabledAt: now, disabledBy: actor.actorUserId, disableReason: input.reason.trim() };
      if (!await tx.replace('classes', source._id, source.version, archived)) {
        throw new NativeAdminManagementError('CONFLICT');
      }
      if (destination && destinationExpectedVersion !== null) {
        if (!await tx.replace('classes', destination._id, destinationExpectedVersion,
          { ...destination, version: destination.version + 1 })) throw new NativeAdminManagementError('CONFLICT');
      }
      const grants = await tx.find('teacher_class_grants', { organizationId: actor.organizationId,
        classId: source._id, status: 'active', deletedAt: null });
      for (const grant of grants.filter(row => visible(row, actor.organizationId))) {
        if (!await tx.replace('teacher_class_grants', grant._id, grant.version,
          { ...grant, status: 'revoked', permissions: [], version: grant.version + 1,
            revokedAt: now, revokedBy: actor.actorUserId })) throw new NativeAdminManagementError('CONFLICT');
      }
      const result: NativeAdminClassArchiveView = { id: source._id, status: 'disabled',
        migratedStudentCount: members.length, destinationClassId: destination?._id ?? null,
        version: archived.version };
      await this.finish(tx, actor, operationId, fingerprint, 'native_admin.class.disabled',
        'class', source._id, input.reason, result);
      return result;
    });
  }

  public async assignTeacher(actor: TrustedActorContext, input: Readonly<{
    classId: string; teacherId: string; permissions: readonly TeacherClassPermission[]; reason: string }>,
    expectedVersion: number, operationId: string): Promise<NativeAdminTeacherAssignmentView> {
    idCheck(input.classId);
    idCheck(input.teacherId);
    operationCheck(expectedVersion, operationId, input.reason, true);
    if (input.teacherId === actor.actorUserId || !Array.isArray(input.permissions)
      || input.permissions.length === 0 || new Set(input.permissions).size !== input.permissions.length
      || input.permissions.some(permission => !TEACHER_CLASS_PERMISSIONS.includes(permission))) {
      throw new NativeAdminManagementError('FORBIDDEN');
    }
    await this.authorize(actor, 'organization.manage', input.classId);
    return this.database.runTransaction(async tx => {
      await this.liveGuard(tx, actor, 'organization.manage', input.classId);
      const fingerprint = hash(['assignTeacher', input, expectedVersion]);
      const prior = await this.receipt<NativeAdminTeacherAssignmentView>(tx, actor, operationId, fingerprint);
      if (prior) return prior;
      const target = await tx.get('users', input.teacherId);
      const classroom = await tx.get('classes', input.classId);
      if (!visible(target, actor.organizationId) || target.status !== 'active'
        || !visible(classroom, actor.organizationId) || classroom.status !== 'active') {
        throw new NativeAdminManagementError('NOT_FOUND');
      }
      const roles = await tx.find('role_assignments', { organizationId: actor.organizationId,
        userId: input.teacherId, role: 'teacher', status: 'active', deletedAt: null });
      if (!roles.length) throw new NativeAdminManagementError('NOT_FOUND');
      const rows = await tx.find('teacher_class_grants', { organizationId: actor.organizationId,
        teacherId: input.teacherId, classId: input.classId, deletedAt: null });
      if (rows.length > 1) throw new NativeAdminManagementError('CONFLICT');
      const current = rows[0] ?? null;
      if ((current?.version ?? 0) !== expectedVersion) throw new NativeAdminManagementError('CONFLICT');
      const id = current?._id ?? `grt_native_${hash([actor.organizationId, input.teacherId, input.classId]).slice(0, 32)}`;
      const next: VersionedDocument = { ...(current ?? { _id: id, organizationId: actor.organizationId,
        schemaVersion: 1, deletedAt: null }), version: expectedVersion + 1,
        teacherId: input.teacherId, classId: input.classId, status: 'active',
        permissions: [...input.permissions] };
      const saved = current ? await tx.replace('teacher_class_grants', id, expectedVersion, next)
        : await tx.create('teacher_class_grants', next);
      if (!saved) throw new NativeAdminManagementError('CONFLICT');
      await this.syncNativeTeacherRole(tx, actor.organizationId, input.teacherId);
      const result: NativeAdminTeacherAssignmentView = { classId: input.classId,
        teacherId: input.teacherId, permissions: [...input.permissions], version: next.version };
      await this.finish(tx, actor, operationId, fingerprint, 'native_admin.teacher.assigned',
        'teacher_class_grant', id, input.reason, result);
      return result;
    });
  }

  public async revokeTeacher(actor: TrustedActorContext, input: Readonly<{
    classId: string; teacherId: string; reason: string }>, expectedVersion: number,
    operationId: string): Promise<NativeAdminTeacherAssignmentView> {
    idCheck(input.classId);
    idCheck(input.teacherId);
    operationCheck(expectedVersion, operationId, input.reason);
    if (input.teacherId === actor.actorUserId) throw new NativeAdminManagementError('FORBIDDEN');
    await this.authorize(actor, 'organization.manage', input.classId);
    return this.database.runTransaction(async tx => {
      await this.liveGuard(tx, actor, 'organization.manage', input.classId);
      const fingerprint = hash(['revokeTeacher', input, expectedVersion]);
      const prior = await this.receipt<NativeAdminTeacherAssignmentView>(tx, actor, operationId, fingerprint);
      if (prior) return prior;
      const target = await tx.get('users', input.teacherId);
      const classroom = await tx.get('classes', input.classId);
      if (!visible(target, actor.organizationId) || !visible(classroom, actor.organizationId)) {
        throw new NativeAdminManagementError('NOT_FOUND');
      }
      const rows = await tx.find('teacher_class_grants', { organizationId: actor.organizationId,
        teacherId: input.teacherId, classId: input.classId, status: 'active', deletedAt: null });
      if (rows.length !== 1) throw new NativeAdminManagementError('NOT_FOUND');
      const current = rows[0]!;
      if (current.version !== expectedVersion) throw new NativeAdminManagementError('CONFLICT');
      const next: VersionedDocument = { ...current, version: current.version + 1,
        status: 'revoked', permissions: [], revokedAt: this.clock.nowIso(), revokedBy: actor.actorUserId };
      if (!await tx.replace('teacher_class_grants', current._id, current.version, next)) {
        throw new NativeAdminManagementError('CONFLICT');
      }
      await this.syncNativeTeacherRole(tx, actor.organizationId, input.teacherId);
      const result: NativeAdminTeacherAssignmentView = { classId: input.classId,
        teacherId: input.teacherId, permissions: [], version: next.version };
      await this.finish(tx, actor, operationId, fingerprint, 'native_admin.teacher.assignment_revoked',
        'teacher_class_grant', current._id, input.reason, result);
      return result;
    });
  }

  public async updateUser(actor: TrustedActorContext, input: Readonly<{
    userId: string; displayName: string; reason: string }>, expectedVersion: number,
    operationId: string): Promise<NativeAdminUserMutationView> {
    idCheck(input.userId);
    operationCheck(expectedVersion, operationId, input.reason);
    if (!input.displayName.trim() || input.displayName.trim().length > 50) {
      throw new NativeAdminManagementError('VALIDATION_ERROR');
    }
    await this.authorize(actor, 'user.manage');
    return this.database.runTransaction(async tx => {
      const scope = await this.liveGuard(tx, actor, 'user.manage');
      const fingerprint = hash(['updateUser', input, expectedVersion]);
      const prior = await this.receipt<NativeAdminUserMutationView>(tx, actor, operationId, fingerprint);
      if (prior) return prior;
      const current = await tx.get('users', input.userId);
      if (!visible(current, actor.organizationId)) throw new NativeAdminManagementError('NOT_FOUND');
      if (!scope.organizationWide) {
        const memberships = await tx.find('class_memberships', { organizationId: actor.organizationId,
          studentId: input.userId, status: 'active', deletedAt: null });
        if (!memberships.length || memberships.some(row => typeof row.classId !== 'string'
          || !scope.classIds.includes(row.classId))) throw new NativeAdminManagementError('FORBIDDEN');
      }
      if (current.version !== expectedVersion) throw new NativeAdminManagementError('CONFLICT');
      const next: VersionedDocument = { ...current, version: current.version + 1,
        displayName: input.displayName.trim(), displayNameMasked: maskName(input.displayName.trim()) };
      if (!await tx.replace('users', current._id, current.version, next)) throw new NativeAdminManagementError('CONFLICT');
      const result: NativeAdminUserMutationView = { id: current._id,
        displayName: input.displayName.trim(), status: current.status === 'active' ? 'active' : 'disabled',
        version: next.version };
      await this.finish(tx, actor, operationId, fingerprint, 'native_admin.user.updated',
        'user', input.userId, input.reason, result);
      return result;
    });
  }

  public async disableUser(actor: TrustedActorContext, input: Readonly<{
    userId: string; reason: string }>, expectedVersion: number,
    operationId: string): Promise<NativeAdminUserMutationView> {
    idCheck(input.userId);
    operationCheck(expectedVersion, operationId, input.reason);
    if (input.userId === actor.actorUserId) throw new NativeAdminManagementError('FORBIDDEN');
    await this.authorize(actor, 'user.manage');
    return this.database.runTransaction(async tx => {
      const scope = await this.liveGuard(tx, actor, 'user.manage');
      const fingerprint = hash(['disableUser', input, expectedVersion]);
      const prior = await this.receipt<NativeAdminUserMutationView>(tx, actor, operationId, fingerprint);
      if (prior) return prior;
      const user = await tx.get('users', input.userId);
      if (!visible(user, actor.organizationId)) throw new NativeAdminManagementError('NOT_FOUND');
      if (user.status !== 'active' || user.version !== expectedVersion) {
        throw new NativeAdminManagementError('CONFLICT');
      }
      const roles = await tx.find('role_assignments', { organizationId: actor.organizationId,
        userId: input.userId, status: 'active', deletedAt: null });
      const memberships = await tx.find('class_memberships', { organizationId: actor.organizationId,
        studentId: input.userId, status: 'active', deletedAt: null });
      const teacherGrants = await tx.find('teacher_class_grants', { organizationId: actor.organizationId,
        teacherId: input.userId, status: 'active', deletedAt: null });
      const parentLinks = await tx.find('parent_student_links', { organizationId: actor.organizationId,
        deletedAt: null });
      const userLinks = parentLinks.filter(row => visible(row, actor.organizationId)
        && (row.parentId === input.userId || row.studentId === input.userId)
        && row.status === 'active');
      const nativeGrant = await tx.get('native_admin_grants', nativeAdminGrantId(actor.organizationId, input.userId));
      const rolesForUser = roles.filter(row => visible(row, actor.organizationId));
      const hasNonStudentRole = rolesForUser.some(row => row.role !== 'student');
      if (!scope.organizationWide && hasNonStudentRole) throw new NativeAdminManagementError('FORBIDDEN');
      const classIds = new Set<string>();
      for (const membership of memberships.filter(row => visible(row, actor.organizationId))) {
        if (typeof membership.classId !== 'string') throw new NativeAdminManagementError('SERVICE_UNAVAILABLE');
        classIds.add(membership.classId);
      }
      for (const grant of teacherGrants.filter(row => visible(row, actor.organizationId))) {
        if (typeof grant.classId !== 'string') throw new NativeAdminManagementError('SERVICE_UNAVAILABLE');
        classIds.add(grant.classId);
      }
      if (!scope.organizationWide && [...classIds].some(classId => !scope.classIds.includes(classId))) {
        throw new NativeAdminManagementError('FORBIDDEN');
      }
      if (!scope.organizationWide && (userLinks.length > 0 || visible(nativeGrant, actor.organizationId))) {
        throw new NativeAdminManagementError('FORBIDDEN');
      }
      const now = this.clock.nowIso();
      for (const membership of memberships.filter(row => visible(row, actor.organizationId))) {
        if (!await tx.replace('class_memberships', membership._id, membership.version,
          { ...membership, status: 'inactive', version: membership.version + 1, leftAt: now })) {
          throw new NativeAdminManagementError('CONFLICT');
        }
      }
      for (const classId of classIds) {
        const classroom = await tx.get('classes', classId);
        if (visible(classroom, actor.organizationId)
          && !await tx.replace('classes', classroom._id, classroom.version,
            { ...classroom, version: classroom.version + 1 })) throw new NativeAdminManagementError('CONFLICT');
      }
      for (const role of rolesForUser) {
        if (!await tx.replace('role_assignments', role._id, role.version,
          { ...role, status: 'revoked', version: role.version + 1, revokedAt: now,
            revokedBy: actor.actorUserId, revokeReason: input.reason.trim() })) {
          throw new NativeAdminManagementError('CONFLICT');
        }
      }
      for (const grant of teacherGrants.filter(row => visible(row, actor.organizationId))) {
        if (!await tx.replace('teacher_class_grants', grant._id, grant.version,
          { ...grant, status: 'revoked', permissions: [], version: grant.version + 1,
            revokedAt: now, revokedBy: actor.actorUserId })) throw new NativeAdminManagementError('CONFLICT');
      }
      for (const link of userLinks) {
        if (!await tx.replace('parent_student_links', link._id, link.version,
          { ...link, status: 'revoked', version: link.version + 1, revokedAt: now,
            revokedBy: actor.actorUserId, revokeReason: input.reason.trim() })) {
          throw new NativeAdminManagementError('CONFLICT');
        }
      }
      if (rolesForUser.some(row => row.role === 'student')) {
        const codes = await tx.find('binding_codes', { organizationId: actor.organizationId,
          studentId: input.userId, status: 'active', deletedAt: null });
        for (const code of codes.filter(row => visible(row, actor.organizationId))) {
          if (!await tx.replace('binding_codes', code._id, code.version,
            { ...code, status: 'revoked', version: code.version + 1 })) throw new NativeAdminManagementError('CONFLICT');
        }
      }
      if (visible(nativeGrant, actor.organizationId) && nativeGrant.status === 'active') {
        if (!await tx.replace('native_admin_grants', nativeGrant._id, nativeGrant.version,
          { ...nativeGrant, status: 'revoked', permissions: [], version: nativeGrant.version + 1,
            revokedAt: now, revokedBy: actor.actorUserId })) throw new NativeAdminManagementError('CONFLICT');
      }
      const next: VersionedDocument = { ...user, status: 'disabled', version: user.version + 1,
        authorizationVersion: Number.isSafeInteger(user.authorizationVersion)
          ? Number(user.authorizationVersion) + 1 : 1, disabledAt: now,
        disabledBy: actor.actorUserId, disableReason: input.reason.trim() };
      if (!await tx.replace('users', user._id, user.version, next)) throw new NativeAdminManagementError('CONFLICT');
      const result: NativeAdminUserMutationView = { id: user._id,
        displayName: typeof user.displayName === 'string' ? user.displayName
          : typeof user.displayNameMasked === 'string' ? user.displayNameMasked : '未命名用户',
        status: 'disabled', version: next.version };
      await this.finish(tx, actor, operationId, fingerprint, 'native_admin.user.disabled',
        'user', user._id, input.reason, result);
      return result;
    });
  }

  public async unbindParentLink(actor: TrustedActorContext, input: Readonly<{
    linkId: string; reason: string }>, expectedVersion: number,
    operationId: string): Promise<NativeAdminUnbindView> {
    idCheck(input.linkId);
    operationCheck(expectedVersion, operationId, input.reason);
    await this.authorize(actor, 'user.manage');
    return this.database.runTransaction(async tx => {
      const scope = await this.liveGuard(tx, actor, 'user.manage');
      const fingerprint = hash(['unbindParentLink', input, expectedVersion]);
      const prior = await this.receipt<NativeAdminUnbindView>(tx, actor, operationId, fingerprint);
      if (prior) return prior;
      const link = await tx.get('parent_student_links', input.linkId);
      if (!visible(link, actor.organizationId) || link.status !== 'active'
        || typeof link.parentId !== 'string' || typeof link.studentId !== 'string') {
        throw new NativeAdminManagementError('NOT_FOUND');
      }
      if (link.version !== expectedVersion) throw new NativeAdminManagementError('CONFLICT');
      if (!scope.organizationWide) {
        const memberships = await tx.find('class_memberships', { organizationId: actor.organizationId,
          studentId: link.studentId, status: 'active', deletedAt: null });
        const classIds = memberships.filter(row => visible(row, actor.organizationId)
          && typeof row.classId === 'string').map(row => String(row.classId));
        if (!classIds.length || classIds.some(classId => !scope.classIds.includes(classId))) {
          throw new NativeAdminManagementError('FORBIDDEN');
        }
      }
      const now = this.clock.nowIso();
      const next: VersionedDocument = { ...link, status: 'revoked', version: link.version + 1,
        revokedAt: now, revokedBy: actor.actorUserId, revokeReason: input.reason.trim() };
      if (!await tx.replace('parent_student_links', link._id, link.version, next)) {
        throw new NativeAdminManagementError('CONFLICT');
      }
      const result: NativeAdminUnbindView = { linkId: link._id, status: 'revoked', version: next.version };
      await this.finish(tx, actor, operationId, fingerprint, 'native_admin.parent_link.revoked',
        'parent_student_link', link._id, input.reason, result);
      return result;
    });
  }

  private validateClass(input: Readonly<{ name: string; grade: number; term: string }>): void {
    if (!input.name.trim() || input.name.trim().length > 50
      || !Number.isSafeInteger(input.grade) || input.grade < 1 || input.grade > 12
      || !input.term.trim() || input.term.trim().length > 60) {
      throw new NativeAdminManagementError('VALIDATION_ERROR');
    }
  }

  private async syncNativeTeacherRole(tx: DocumentDatabaseTransactionPort, organizationId: string, teacherId: string): Promise<void> {
    const roles = await tx.find('role_assignments', { organizationId, userId: teacherId, role: 'teacher', status: 'active', deletedAt: null });
    const owned = roles.filter(row => visible(row, organizationId) && row.nativeAccountManaged === true);
    if (!owned.length) return;
    const grants = (await tx.find('teacher_class_grants', { organizationId, teacherId, status: 'active', deletedAt: null }))
      .filter(row => visible(row, organizationId) && typeof row.classId === 'string');
    const classIds = [...new Set(grants.map(row => String(row.classId)))];
    const permissions = [...new Set(['class.read', ...grants.flatMap(row => Array.isArray(row.permissions)
      ? row.permissions.filter((permission): permission is string => typeof permission === 'string') : [])])];
    for (const role of owned) {
      if (!await tx.replace('role_assignments', role._id, role.version, { ...role, version: role.version + 1,
        permissions, scopeType: 'classes', scopeIds: classIds })) throw new NativeAdminManagementError('CONFLICT');
    }
    const user = await tx.get('users', teacherId);
    if (!visible(user, organizationId) || !Number.isSafeInteger(user.authorizationVersion)
      || !await tx.replace('users', user._id, user.version, { ...user, version: user.version + 1,
        authorizationVersion: Number(user.authorizationVersion) + 1 })) throw new NativeAdminManagementError('CONFLICT');
  }

  private async authorize(actor: TrustedActorContext, permission: NativeAdminPermission,
    classId?: string) {
    const decision = await authorizeNativeAdmin(this.grants, actor, permission, classId);
    if (!decision.allowed) throw new NativeAdminManagementError('FORBIDDEN');
    return decision.scope;
  }

  private async liveGuard(tx: DocumentDatabaseTransactionPort, actor: TrustedActorContext,
    permission: NativeAdminPermission, classId?: string, requireOrganizationWide = false) {
    const user = await tx.get('users', actor.actorUserId);
    const grant = await tx.get('native_admin_grants', nativeAdminGrantId(actor.organizationId, actor.actorUserId));
    const scope = typeof grant?.scope === 'object' && grant.scope !== null && !Array.isArray(grant.scope)
      ? grant.scope as Record<string, unknown> : null;
    const classIds = Array.isArray(scope?.classIds) ? scope.classIds : [];
    if (actor.actorRole !== 'teacher' || !visible(user, actor.organizationId) || user.status !== 'active'
      || user.authorizationVersion !== actor.authzVersion
      || !visible(grant, actor.organizationId) || grant.status !== 'active'
      || !Array.isArray(grant.permissions) || !grant.permissions.includes(permission)
      || !scope || requireOrganizationWide && scope.organizationWide !== true
      || classId && scope.organizationWide !== true && !classIds.includes(classId)) {
      throw new NativeAdminManagementError('FORBIDDEN');
    }
    return { organizationWide: scope.organizationWide === true,
      classIds: classIds.filter((id): id is string => typeof id === 'string') };
  }

  private async receipt<T>(tx: DocumentDatabaseTransactionPort, actor: TrustedActorContext,
    operationId: string, fingerprint: string): Promise<T | null> {
    const row = await tx.get('native_admin_management_operations', receiptId(actor, operationId));
    if (!row) return null;
    if (!visible(row, actor.organizationId) || row.actorUserId !== actor.actorUserId
      || row.fingerprint !== fingerprint || typeof row.result !== 'object' || row.result === null) {
      throw new NativeAdminManagementError('CONFLICT');
    }
    return row.result as T;
  }

  private async finish<T>(tx: DocumentDatabaseTransactionPort, actor: TrustedActorContext,
    operationId: string, fingerprint: string, action: string, targetType: string,
    targetId: string, reason: string, result: T): Promise<void> {
    const now = this.clock.nowIso();
    const receipt: VersionedDocument = { _id: receiptId(actor, operationId),
      organizationId: actor.organizationId, schemaVersion: 1, version: 1, deletedAt: null,
      actorUserId: actor.actorUserId, operationId, fingerprint, result: JSON.parse(JSON.stringify(result)),
      occurredAt: now };
    if (!await tx.create('native_admin_management_operations', receipt)) {
      throw new NativeAdminManagementError('CONFLICT');
    }
    const audit: VersionedDocument = { _id: `native_admin_audit_${hash([actor.organizationId,
      actor.actorUserId, operationId])}`, organizationId: actor.organizationId,
      schemaVersion: 1, version: 1, deletedAt: null, requestId: actor.requestId,
      actorUserId: actor.actorUserId, actorRole: 'teacher', action, targetType, targetId,
      result: 'succeeded', errorCode: null, occurredAt: now,
      metadata: { reason: reason.trim(), reasonProvided: Boolean(reason.trim()), operationId } };
    if (!await tx.append('operation_logs', audit)) throw new NativeAdminManagementError('CONFLICT');
  }
}

function visible(row: VersionedDocument | null, organizationId: string): row is VersionedDocument {
  return row !== null && row.organizationId === organizationId && row.deletedAt === null;
}
function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function receiptId(actor: TrustedActorContext, operationId: string): string {
  return `native_admin_op_${hash([actor.organizationId, actor.actorUserId, operationId])}`;
}
function idCheck(value: string): void {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new NativeAdminManagementError('VALIDATION_ERROR');
}
function operationCheck(version: number, operationId: string, reason: string,
  zeroAllowed = false): void {
  if (!Number.isSafeInteger(version) || version < (zeroAllowed ? 0 : 1)
    || !/^[A-Za-z0-9_-]{8,128}$/.test(operationId)
    || !reason.trim() || reason.length > 200) throw new NativeAdminManagementError('VALIDATION_ERROR');
}
function maskName(name: string): string {
  return name.length <= 1 ? name : `${name[0]}${'*'.repeat(Math.min(2, name.length - 1))}`;
}
