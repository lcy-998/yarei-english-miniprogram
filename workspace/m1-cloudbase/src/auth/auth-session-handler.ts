import { isTrustedPlatformIdentity, type PlatformIdentity } from './trusted-actor';
import type { AuthPayload, MiniProgramRole } from '../contracts/auth-session';
import { failure, success } from '../shared/result';
import type { ResponseMeta, ServiceResult } from '../shared/protocol';
import type { BusinessSessionRecord } from '../runtime/records';
import type { BusinessSessionRepository, Clock, IdentifierGenerator, IdentityRepository, SubjectDigestPort } from '../runtime/ports';
import type { TrustedBusinessSessionSource } from '../runtime/cloudbase-runtime-adapter';

export interface AuthSessionView {
  readonly sessionId: string;
  readonly userId: string;
  readonly organizationId: string;
  readonly activeRole: MiniProgramRole | null;
  readonly roles: readonly MiniProgramRole[];
}

export class AuthSessionHandler {
  public constructor(
    private readonly identities: IdentityRepository,
    private readonly sessions: BusinessSessionRepository,
    private readonly subjectDigest: SubjectDigestPort,
    private readonly clock: Clock,
    private readonly ids: IdentifierGenerator,
    private readonly businessSessionTokens?: TrustedBusinessSessionSource,
  ) {}

  public async handle(input: AuthPayload, identity: PlatformIdentity, sessionId: string | null, meta: ResponseMeta): Promise<ServiceResult<AuthSessionView | null>> {
    if (!isTrustedPlatformIdentity(identity)) return failure('UNAUTHENTICATED', meta);
    const principal = await this.resolvePrincipal(identity);
    if (principal === null) return failure('FORBIDDEN', meta);
    if (input.action === 'bootstrap') return this.bootstrap(principal, meta);
    if (input.action === 'logout') return this.logout(sessionId, principal, meta);
    const session = await this.resolveSession(sessionId, principal);
    if (session === null) return failure('UNAUTHENTICATED', meta);
    if (input.action === 'selectRole') return this.selectRole(session, input.payload.role, principal.roles, meta);
    return success(this.toView(session, principal.roles), meta);
  }

  private async bootstrap(principal: Principal, meta: ResponseMeta): Promise<ServiceResult<AuthSessionView>> {
    const now = this.clock.nowIso();
    const session: BusinessSessionRecord = {
      id: this.ids.next('ses'), organizationId: principal.organizationId, userId: principal.userId,
      subjectDigest: principal.subjectDigest, audience: 'mini-program', role: null, authzVersion: principal.authzVersion,
      recordVersion: 1, expiresAt: addHours(now, 12), revokedAt: null,
    };
    const resumed = await this.sessions.startOrResume(session, now);
    if (resumed.role === null || (isMiniProgramRole(resumed.role) && principal.roles.includes(resumed.role))) {
      return success(this.toView(resumed, principal.roles), meta);
    }
    const reset = { ...resumed, role: null, recordVersion: resumed.recordVersion + 1 };
    if (!await this.sessions.replace(reset, resumed.recordVersion)) return failure('CONFLICT', meta);
    return success(this.toView(reset, principal.roles), meta);
  }

  private async selectRole(session: BusinessSessionRecord, role: MiniProgramRole, roles: readonly MiniProgramRole[], meta: ResponseMeta): Promise<ServiceResult<AuthSessionView>> {
    if (!roles.includes(role)) return failure('FORBIDDEN', meta);
    const updated = { ...session, role, recordVersion: session.recordVersion + 1 };
    if (!await this.sessions.replace(updated, session.recordVersion)) return failure('CONFLICT', meta);
    return success(this.toView(updated, roles), meta);
  }

  private async resolvePrincipal(identity: PlatformIdentity): Promise<Principal | null> {
    const digest = this.subjectDigest.digest(identity.subject);
    const linkedIdentity = await this.identities.findIdentityByDigest(digest);
    if (linkedIdentity === null || linkedIdentity.status !== 'active') return null;
    const [user, organization, roleRows] = await Promise.all([
      this.identities.findUser(linkedIdentity.userId, linkedIdentity.organizationId),
      this.identities.findOrganization(linkedIdentity.organizationId),
      this.identities.listActiveRoles(linkedIdentity.userId, linkedIdentity.organizationId),
    ]);
    if (user === null || user.status !== 'active' || organization === null || organization.status !== 'active') return null;
    const roles = [...new Set(roleRows.map((item) => item.role).filter(isMiniProgramRole))];
    if (roles.length === 0) return null;
    return {
      userId: user._id,
      organizationId: organization._id,
      subjectDigest: digest,
      roles,
      authzVersion: user.authorizationVersion,
    };
  }

  private async resolveSession(sessionId: string | null, principal: Principal): Promise<BusinessSessionRecord | null> {
    if (sessionId === null) return null;
    const session = await this.sessions.find(sessionId);
    if (session === null || session.revokedAt !== null || session.expiresAt <= this.clock.nowIso()) return null;
    if (!this.belongsToPrincipal(session, principal) || session.authzVersion !== principal.authzVersion) return null;
    if (session.role === null || (isMiniProgramRole(session.role) && principal.roles.includes(session.role))) return session;
    const reset = { ...session, role: null, recordVersion: session.recordVersion + 1 };
    return await this.sessions.replace(reset, session.recordVersion) ? reset : null;
  }

  private async logout(sessionId: string | null, principal: Principal, meta: ResponseMeta): Promise<ServiceResult<null>> {
    if (sessionId === null) return failure('UNAUTHENTICATED', meta);
    const session = await this.sessions.find(sessionId);
    if (session === null || session.expiresAt <= this.clock.nowIso() || !this.belongsToPrincipal(session, principal)) {
      return failure('UNAUTHENTICATED', meta);
    }
    if (session.revokedAt === null) {
      const revoked = { ...session, revokedAt: this.clock.nowIso(), recordVersion: session.recordVersion + 1 };
      if (!await this.sessions.replace(revoked, session.recordVersion)) return failure('CONFLICT', meta);
    }
    return success(null, meta);
  }

  private belongsToPrincipal(session: BusinessSessionRecord, principal: Principal): boolean {
    return session.userId === principal.userId
      && session.organizationId === principal.organizationId
      && session.subjectDigest === principal.subjectDigest;
  }

  private toView(session: BusinessSessionRecord, roles: readonly MiniProgramRole[]): AuthSessionView {
    const token = this.businessSessionTokens?.issueBusinessSessionToken?.(
      session.id,
      session.expiresAt,
      'mini-program',
    ) ?? session.id;
    return { sessionId: token, userId: session.userId, organizationId: session.organizationId, activeRole: isMiniProgramRole(session.role) ? session.role : null, roles };
  }
}

interface Principal { readonly userId: string; readonly organizationId: string; readonly subjectDigest: string; readonly roles: readonly MiniProgramRole[]; readonly authzVersion: number; }

function isMiniProgramRole(role: string | null): role is MiniProgramRole { return role === 'student' || role === 'parent' || role === 'teacher'; }

function addHours(iso: string, hours: number): string { return new Date(new Date(iso).getTime() + hours * 60 * 60 * 1000).toISOString(); }
