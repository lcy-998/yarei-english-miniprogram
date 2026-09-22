import { isTrustedPlatformIdentity, type PlatformIdentity } from './trusted-actor';
import type { AdminSessionInput } from '../contracts/admin-session';
import type { TrustedBusinessSessionTokenCodec } from '../runtime/cloudbase-runtime-adapter';
import type { BusinessSessionRepository, Clock, IdentifierGenerator, IdentityRepository, SubjectDigestPort } from '../runtime/ports';
import type { BusinessSessionRecord } from '../runtime/records';
import type { ResponseMeta, ServiceResult } from '../shared/protocol';
import { failure, success } from '../shared/result';

const ADMIN_SESSION_HOURS = 2;

export interface AdminSessionView {
  readonly audience: 'admin-console';
  readonly token: string;
  readonly expiresAt: string;
}

export class AdminSessionHandler {
  public constructor(
    private readonly identities: IdentityRepository,
    private readonly sessions: BusinessSessionRepository,
    private readonly subjectDigest: SubjectDigestPort,
    private readonly clock: Clock,
    private readonly identifiers: IdentifierGenerator,
    private readonly tokens: TrustedBusinessSessionTokenCodec,
  ) {}

  public async handle(
    input: AdminSessionInput,
    identity: PlatformIdentity,
    sessionId: string | null,
    meta: ResponseMeta,
  ): Promise<ServiceResult<AdminSessionView | null>> {
    if (!isTrustedPlatformIdentity(identity)) return failure('UNAUTHENTICATED', meta);
    const principal = await this.resolvePrincipal(identity);
    if (principal === null) {
      return failure(input.action === 'bootstrap' ? 'FORBIDDEN' : 'UNAUTHENTICATED', meta);
    }
    if (input.action === 'bootstrap') return this.bootstrap(principal, meta);
    const session = await this.resolveSession(sessionId, principal);
    if (session === null) return failure('UNAUTHENTICATED', meta);
    if (input.action === 'logout') return this.logout(session, meta);
    if (input.action === 'refresh') return this.refresh(session, meta);
    return success(this.toView(session), meta);
  }

  private async bootstrap(principal: AdminPrincipal, meta: ResponseMeta): Promise<ServiceResult<AdminSessionView>> {
    const now = this.clock.nowIso();
    const candidate: BusinessSessionRecord = {
      id: this.identifiers.next('admin_ses'),
      organizationId: principal.organizationId,
      userId: principal.userId,
      subjectDigest: principal.subjectDigest,
      audience: 'admin-console',
      role: 'admin',
      authzVersion: principal.authorizationVersion,
      recordVersion: 1,
      expiresAt: addHours(now, ADMIN_SESSION_HOURS),
      revokedAt: null,
    };
    const session = await this.sessions.startOrResume(candidate, now);
    if (!isMatchingAdminSession(session, principal, now)) return failure('UNAUTHENTICATED', meta);
    return success(this.toView(session), meta);
  }

  private async refresh(
    session: BusinessSessionRecord,
    meta: ResponseMeta,
  ): Promise<ServiceResult<AdminSessionView>> {
    const refreshedExpiry = addHours(this.clock.nowIso(), ADMIN_SESSION_HOURS);
    if (Date.parse(refreshedExpiry) <= Date.parse(session.expiresAt)) return success(this.toView(session), meta);
    const refreshed: BusinessSessionRecord = {
      ...session,
      expiresAt: refreshedExpiry,
      recordVersion: session.recordVersion + 1,
    };
    if (!await this.sessions.replace(refreshed, session.recordVersion)) return failure('CONFLICT', meta);
    return success(this.toView(refreshed), meta);
  }

  private async logout(
    session: BusinessSessionRecord,
    meta: ResponseMeta,
  ): Promise<ServiceResult<null>> {
    if (session.revokedAt === null) {
      const revoked = {
        ...session,
        revokedAt: this.clock.nowIso(),
        recordVersion: session.recordVersion + 1,
      };
      if (!await this.sessions.replace(revoked, session.recordVersion)) return failure('CONFLICT', meta);
    }
    return success(null, meta);
  }

  private async resolvePrincipal(identity: PlatformIdentity): Promise<AdminPrincipal | null> {
    const subjectDigest = this.subjectDigest.digest(identity.subject);
    const linked = await this.identities.findIdentityByDigest(subjectDigest);
    if (linked === null || linked.status !== 'active') return null;
    const [user, organization, roles] = await Promise.all([
      this.identities.findUser(linked.userId, linked.organizationId),
      this.identities.findOrganization(linked.organizationId),
      this.identities.listActiveRoles(linked.userId, linked.organizationId),
    ]);
    if (user === null || user.status !== 'active' || organization === null || organization.status !== 'active') return null;
    const adminRoles = roles.filter((role) => role.role === 'admin' && role.status === 'active');
    if (adminRoles.length !== 1) return null;
    return {
      userId: user._id,
      organizationId: organization._id,
      subjectDigest,
      authorizationVersion: user.authorizationVersion,
    };
  }

  private async resolveSession(
    sessionId: string | null,
    principal: AdminPrincipal,
  ): Promise<BusinessSessionRecord | null> {
    if (sessionId === null) return null;
    const session = await this.sessions.find(sessionId);
    return session !== null && isMatchingAdminSession(session, principal, this.clock.nowIso()) ? session : null;
  }

  private toView(session: BusinessSessionRecord): AdminSessionView {
    return {
      audience: 'admin-console',
      token: this.tokens.issueBusinessSessionToken(session.id, session.expiresAt, 'admin-console'),
      expiresAt: session.expiresAt,
    };
  }
}

interface AdminPrincipal {
  readonly userId: string;
  readonly organizationId: string;
  readonly subjectDigest: string;
  readonly authorizationVersion: number;
}

function isMatchingAdminSession(
  session: BusinessSessionRecord,
  principal: AdminPrincipal,
  now: string,
): boolean {
  return session.organizationId === principal.organizationId
    && session.userId === principal.userId
    && session.subjectDigest === principal.subjectDigest
    && session.audience === 'admin-console'
    && session.role === 'admin'
    && session.authzVersion === principal.authorizationVersion
    && session.revokedAt === null
    && Date.parse(session.expiresAt) > Date.parse(now);
}

function addHours(iso: string, hours: number): string {
  return new Date(Date.parse(iso) + hours * 60 * 60 * 1000).toISOString();
}
