import type { FunctionName } from '../shared/protocol';
import type { RequestIdGenerator } from '../shared/result';
import type { Clock, BusinessSessionRepository, IdentityRepository, SubjectDigestPort } from '../runtime/ports';
import { isTrustedPlatformIdentity, type ActorRole, type PlatformIdentity, type TrustedActorContext, type TrustedActorResolver } from './trusted-actor';

export class RepositoryTrustedActorResolver implements TrustedActorResolver {
  public constructor(
    private readonly identities: IdentityRepository,
    private readonly sessions: BusinessSessionRepository,
    private readonly subjectDigest: SubjectDigestPort,
    private readonly clock: Clock,
    private readonly requestIds: RequestIdGenerator,
  ) {}

  public async resolve(identity: PlatformIdentity, functionName: FunctionName, sessionId: string | null): Promise<TrustedActorContext | null> {
    void functionName;
    if (!isTrustedPlatformIdentity(identity)) return null;
    const subjectDigest = this.subjectDigest.digest(identity.subject);
    const linkedIdentity = await this.identities.findIdentityByDigest(subjectDigest);
    if (linkedIdentity === null || linkedIdentity.status !== 'active') return null;
    const user = await this.identities.findUser(linkedIdentity.userId, linkedIdentity.organizationId);
    const organization = await this.identities.findOrganization(linkedIdentity.organizationId);
    if (user === null || user.status !== 'active' || organization === null || organization.status !== 'active') return null;
    const session = await this.findMatchingActiveSession(sessionId, linkedIdentity.userId, linkedIdentity.organizationId, subjectDigest);
    if (session === null || session.role === null) return null;
    if (!isAudienceAllowed(functionName, session)) return null;
    const roles = await this.identities.listActiveRoles(user._id, organization._id);
    const activeRole = roles.find((item) => item.role === session.role);
    if (activeRole === undefined) return null;
    if (session.authzVersion !== user.authorizationVersion) return null;
    return {
      requestId: this.requestIds.next(),
      sessionId: session.id,
      actorUserId: user._id,
      actorRole: activeRole.role as ActorRole,
      organizationId: organization._id,
      platformSubjectDigest: subjectDigest,
      permissions: activeRole.permissions,
      scopeIds: activeRole.scopeIds,
      authzVersion: session.authzVersion,
    };
  }

  private async findMatchingActiveSession(sessionId: string | null, userId: string, organizationId: string, subjectDigest: string) {
    if (sessionId === null) return null;
    const session = await this.sessions.find(sessionId);
    if (session === null || session.revokedAt !== null || session.expiresAt <= this.clock.nowIso()) return null;
    if (session.userId !== userId || session.organizationId !== organizationId || session.subjectDigest !== subjectDigest) return null;
    return session;
  }
}

function sessionAudience(session: Readonly<{ audience?: 'mini-program' | 'admin-console' }>) {
  return session.audience ?? 'mini-program';
}

function isAudienceAllowed(functionName: FunctionName, session: Readonly<{
  audience?: 'mini-program' | 'admin-console';
  role: string | null;
}>): boolean {
  const audience = sessionAudience(session);
  if (functionName === 'organization-admin' || functionName === 'admin-session') {
    return audience === 'admin-console' && session.role === 'admin';
  }
  if (functionName === 'relationship-command' && session.role === 'admin') {
    return audience === 'admin-console';
  }
  return audience === 'mini-program';
}
