import type { TrustedActorContext } from '../auth/trusted-actor';

export const NATIVE_ADMIN_PERMISSIONS = [
  'dashboard.read', 'organization.manage', 'user.manage', 'authorization.manage',
  'textbook.manage', 'question.manage', 'task.manage', 'media.review',
  'student_work.restore',
] as const;
export type NativeAdminPermission = (typeof NATIVE_ADMIN_PERMISSIONS)[number];

export interface NativeAdminGrant {
  readonly organizationId: string;
  readonly teacherId: string;
  readonly status: 'active' | 'revoked';
  readonly permissions: readonly NativeAdminPermission[];
  readonly scope: Readonly<{ organizationWide: boolean; classIds: readonly string[] }>;
  readonly version: number;
}

export interface NativeAdminGrantReader {
  findGrant(organizationId: string, teacherId: string): Promise<NativeAdminGrant | null>;
  currentAuthorizationVersion(organizationId: string, teacherId: string): Promise<number | null>;
}

export type NativeAdminDecision =
  | Readonly<{ allowed: true; grantVersion: number; scope: NativeAdminGrant['scope'] }>
  | Readonly<{ allowed: false; reason: 'FORBIDDEN' }>;

/** Called for every native A-01—A-08 read/write; button visibility is never authority. */
export async function authorizeNativeAdmin(
  reader: NativeAdminGrantReader,
  actor: TrustedActorContext,
  permission: NativeAdminPermission,
  targetClassId?: string,
): Promise<NativeAdminDecision> {
  if (actor.actorRole !== 'teacher' || actor.sessionId.length === 0 || actor.organizationId.length === 0) {
    return { allowed: false, reason: 'FORBIDDEN' };
  }
  const [version, grant] = await Promise.all([
    reader.currentAuthorizationVersion(actor.organizationId, actor.actorUserId),
    reader.findGrant(actor.organizationId, actor.actorUserId),
  ]);
  if (version === null || version !== actor.authzVersion || grant === null || grant.status !== 'active'
    || grant.organizationId !== actor.organizationId || grant.teacherId !== actor.actorUserId
    || !grant.permissions.includes(permission)
    || (!grant.scope.organizationWide && grant.scope.classIds.length === 0)
    || (targetClassId !== undefined && !grant.scope.organizationWide && !grant.scope.classIds.includes(targetClassId))) {
    return { allowed: false, reason: 'FORBIDDEN' };
  }
  return { allowed: true, grantVersion: grant.version,
    scope: { organizationWide: grant.scope.organizationWide, classIds: [...grant.scope.classIds] } };
}
