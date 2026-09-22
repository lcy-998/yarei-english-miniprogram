import type { TrustedActorContext } from './trusted-actor';
import { hasPermission } from './trusted-actor';
import type { IdentityRepository } from '../runtime/ports';

export type AuthorizationDecision = { readonly allowed: true } | { readonly allowed: false; readonly reason: 'FORBIDDEN' | 'NOT_FOUND' };

export class AuthorizationService {
  public constructor(private readonly identities: IdentityRepository) {}

  public async canTeacherAccessClass(actor: TrustedActorContext, classId: string, permission: string): Promise<AuthorizationDecision> {
    if (actor.actorRole !== 'teacher' || !hasPermission(actor, permission)) return { allowed: false, reason: 'FORBIDDEN' };
    const grant = await this.identities.findActiveTeacherGrant(actor.organizationId, actor.actorUserId, classId);
    return grant !== null && grant.permissions.includes(permission) ? { allowed: true } : { allowed: false, reason: 'FORBIDDEN' };
  }

  public async canParentReadStudent(actor: TrustedActorContext, studentId: string): Promise<AuthorizationDecision> {
    if (actor.actorRole !== 'parent' || !hasPermission(actor, 'child.read')) {
      return { allowed: false, reason: 'FORBIDDEN' };
    }
    const link = await this.identities.findActiveParentLink(actor.organizationId, actor.actorUserId, studentId);
    return link === null ? { allowed: false, reason: 'NOT_FOUND' } : { allowed: true };
  }
}
