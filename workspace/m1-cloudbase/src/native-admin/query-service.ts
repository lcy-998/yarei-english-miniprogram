import type { TrustedActorContext } from '../auth/trusted-actor';
import { authorizeNativeAdmin, type NativeAdminGrantReader,
  type NativeAdminPermission } from './authorization';

export interface NativeAdminAccessView {
  readonly grantVersion: number;
  readonly permissions: readonly NativeAdminPermission[];
  readonly scope: Readonly<{ organizationWide: boolean; classIds: readonly string[] }>;
}

export class NativeAdminQueryError extends Error {
  public constructor(public readonly code: 'FORBIDDEN') { super(code); }
}

export class NativeAdminQueryService {
  public constructor(private readonly grants: NativeAdminGrantReader) {}

  public async getAccess(actor: TrustedActorContext): Promise<NativeAdminAccessView> {
    const decision = await authorizeNativeAdmin(this.grants, actor, 'dashboard.read');
    if (!decision.allowed) throw new NativeAdminQueryError('FORBIDDEN');
    const grant = await this.grants.findGrant(actor.organizationId, actor.actorUserId);
    if (!grant || grant.version !== decision.grantVersion || grant.status !== 'active') {
      throw new NativeAdminQueryError('FORBIDDEN');
    }
    return { grantVersion: grant.version,
      permissions: [...grant.permissions], scope: { organizationWide: grant.scope.organizationWide,
        classIds: [...grant.scope.classIds] } };
  }
}
