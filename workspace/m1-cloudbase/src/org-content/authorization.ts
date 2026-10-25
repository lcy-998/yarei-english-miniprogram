import type { OrgContentRepository } from './repository';
import type { Actor, ResourceVisibility, TeacherClassPermission } from './types';

export function actorHasPermission(actor: Actor, permission: string): boolean {
  return actor.permissions.includes(permission);
}

export function adminHasScope(actor: Actor, organizationId: string, classId?: string): boolean {
  return actor.actorRole === 'admin'
    && actor.organizationId === organizationId
    && (actor.scopeIds.includes(organizationId) || (classId !== undefined && actor.scopeIds.includes(classId)));
}

export async function teacherHasClassPermission(
  repository: OrgContentRepository,
  actor: Actor,
  classId: string,
  permission: TeacherClassPermission,
): Promise<boolean> {
  if (actor.actorRole !== 'teacher' || !actorHasPermission(actor, permission) || !actor.scopeIds.includes(classId)) return false;
  const grant = await repository.findActiveTeacherGrant(actor.organizationId, actor.actorUserId, classId);
  return grant !== null && grant.permissions.includes(permission);
}

export async function canReadVisibility(
  repository: OrgContentRepository,
  actor: Actor,
  organizationId: string,
  visibility: ResourceVisibility,
): Promise<boolean> {
  void repository;
  void visibility;
  return actor.organizationId === organizationId
    && ['student', 'parent', 'teacher', 'admin'].includes(actor.actorRole);
}
