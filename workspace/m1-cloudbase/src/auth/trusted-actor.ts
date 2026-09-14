import type { FunctionName } from '../shared/protocol';

export const ACTOR_ROLES = ['student', 'parent', 'teacher', 'admin'] as const;
export type ActorRole = (typeof ACTOR_ROLES)[number];

export interface TrustedActorContext {
  readonly requestId: string;
  readonly sessionId: string;
  readonly actorUserId: string;
  readonly actorRole: ActorRole;
  readonly organizationId: string;
  readonly platformSubjectDigest: string;
  readonly permissions: readonly string[];
  readonly scopeIds: readonly string[];
  readonly authzVersion: number;
}

export interface PlatformIdentity {
  readonly subject: string;
  readonly loginType: 'WECHAT' | 'USERNAME' | 'UNKNOWN';
  readonly isAuthenticated: boolean;
}

export interface TrustedActorResolver {
  resolve(identity: PlatformIdentity, functionName: FunctionName): Promise<TrustedActorContext | null>;
}

export function hasPermission(actor: TrustedActorContext, permission: string): boolean {
  return actor.permissions.includes(permission);
}

export function hasScope(actor: TrustedActorContext, scopeId: string): boolean {
  return actor.scopeIds.includes(scopeId);
}

export function isAllowedRole(actor: TrustedActorContext, allowedRoles: readonly ActorRole[]): boolean {
  return allowedRoles.includes(actor.actorRole);
}

/**
 * Actor identity is intentionally absent from FunctionRequest payloads. This helper
 * makes attempted client actor fields observable to action validators without ever
 * accepting them as an authorization source.
 */
export function hasUntrustedActorFields(payload: Readonly<Record<string, unknown>>): boolean {
  return ['actorUserId', 'actorRole', 'organizationId', 'sessionId'].some((field) => field in payload);
}
