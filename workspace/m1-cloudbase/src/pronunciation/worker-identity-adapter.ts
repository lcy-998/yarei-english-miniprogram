import { createHash } from 'node:crypto';
import type { TrustedActorContext } from '../auth/trusted-actor';
import type { IdentityRepository } from '../runtime/ports';
import type { PronunciationWorkerIdentityPort } from './repository';

/** Fresh server-side identity projection for a queued job, not a client session. */
export class FreshPronunciationWorkerIdentity implements PronunciationWorkerIdentityPort {
  public constructor(private readonly identities: IdentityRepository) {}

  public async currentStudent(organizationId: string, studentId: string,
    platformSubjectDigest: string): Promise<TrustedActorContext | null> {
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(organizationId)
      || !/^[A-Za-z0-9_-]{1,256}$/.test(studentId)
      || !/^sd1_[A-Za-z0-9_-]{43}$/.test(platformSubjectDigest)) return null;
    const [identity, user, organization, roles] = await Promise.all([
      this.identities.findIdentityByDigest(platformSubjectDigest),
      this.identities.findUser(studentId, organizationId),
      this.identities.findOrganization(organizationId),
      this.identities.listActiveRoles(studentId, organizationId),
    ]);
    if (!identity || identity.status !== 'active' || identity.userId !== studentId
      || identity.organizationId !== organizationId || !user || user.status !== 'active'
      || !organization || organization.status !== 'active') return null;
    const role = roles.find(candidate => candidate.role === 'student' && candidate.status === 'active');
    if (!role) return null;
    const requestDigest = createHash('sha256').update(JSON.stringify([organizationId, studentId,
      user.authorizationVersion])).digest('hex').slice(0, 24);
    return { requestId: `voice_worker_${requestDigest}`, sessionId: 'server-worker',
      actorUserId: studentId, actorRole: 'student', organizationId,
      platformSubjectDigest, permissions: role.permissions, scopeIds: role.scopeIds,
      authzVersion: user.authorizationVersion };
  }
}
