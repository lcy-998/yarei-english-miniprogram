import type { CloudCallContext, FunctionName } from '../shared/protocol';
import type { CloudBaseRuntimePort } from './ports';

export interface CloudBasePlatformContext {
  readonly OPENID?: unknown;
  readonly UID?: unknown;
}

/** Minimal structural surface of wx-server-sdk used by the runtime adapter. */
export interface CloudBasePlatformSdkPort {
  getWXContext(): CloudBasePlatformContext;
}

/**
 * Server-side resolver for an opaque client bearer token. The resolver returns
 * only an internal session id; actor, role and organization claims never come
 * from the token or event. RepositoryTrustedActorResolver subsequently binds
 * the session to the independently derived CloudBase platform subject.
 */
export interface TrustedBusinessSessionSource {
  getBusinessSessionId(
    businessSessionToken: string,
    expectedAudience?: BusinessSessionAudience,
  ): string | null | Promise<string | null>;
  issueBusinessSessionToken?(
    sessionId: string,
    expiresAt: string,
    audience?: BusinessSessionAudience,
  ): string;
}

export interface TrustedBusinessSessionTokenCodec extends TrustedBusinessSessionSource {
  issueBusinessSessionToken(
    sessionId: string,
    expiresAt: string,
    audience?: BusinessSessionAudience,
  ): string;
}

export type BusinessSessionAudience = 'mini-program' | 'admin-console';

export interface CloudBaseRuntimeAdapterOptions {
  readonly functionName: FunctionName;
  readonly sdk: CloudBasePlatformSdkPort;
  readonly businessSession?: TrustedBusinessSessionSource;
  readonly businessSessionAudience?: BusinessSessionAudience;
}

export function createCloudBaseRuntimeAdapter(
  options: CloudBaseRuntimeAdapterOptions,
): CloudBaseRuntimePort {
  return new CloudBaseRuntimeAdapter(options);
}

/**
 * Local/default-compatible resolver for deployments where the high-entropy
 * business session id itself is the opaque bearer token. Authorization never
 * comes from this value: the actor resolver still verifies the stored session,
 * platform-subject digest, revocation, expiry and current authorization version.
 */
export function createOpaqueSessionIdSource(): TrustedBusinessSessionTokenCodec {
  return {
    issueBusinessSessionToken: (sessionId) => {
      if (!isSafeSessionId(sessionId)) throw new Error('Unsafe session identifier.');
      return sessionId;
    },
    getBusinessSessionId: (businessSessionToken) => (
      isSafeSessionToken(businessSessionToken) ? businessSessionToken : null
    ),
  };
}

class CloudBaseRuntimeAdapter implements CloudBaseRuntimePort {
  public readonly functionName: FunctionName;

  public constructor(private readonly options: CloudBaseRuntimeAdapterOptions) {
    this.functionName = options.functionName;
  }

  public async getPlatformSubject(): Promise<Readonly<{
    subject: string;
    loginType: 'WECHAT' | 'USERNAME' | 'UNKNOWN';
    isAuthenticated: boolean;
  }>> {
    const context = this.options.sdk.getWXContext();
    const uid = readNonEmptyString(context.UID);
    const openId = readNonEmptyString(context.OPENID);
    if (uid === null || (openId !== null && openId !== uid)) {
      return { subject: '', loginType: 'UNKNOWN', isAuthenticated: false };
    }

    return {
      subject: `cloudbase:username:${uid}`,
      loginType: 'USERNAME',
      isAuthenticated: true,
    };
  }

  public async getBusinessSessionId(context: CloudCallContext): Promise<string | null> {
    const token = context.businessSessionToken;
    if (token === null || !isSafeSessionToken(token)) return null;
    const source = this.options.businessSession;
    if (source === undefined) return null;
    const configuredAudience = this.options.businessSessionAudience;
    let candidate: string | null = null;
    for (const audience of configuredAudience === undefined
      ? audiencesForFunction(this.functionName)
      : [configuredAudience]) {
      candidate = await source.getBusinessSessionId(token, audience);
      if (candidate !== null) break;
    }
    if (candidate === null) return null;
    const normalized = candidate.trim();
    return isSafeSessionId(normalized) ? normalized : null;
  }
}

function audiencesForFunction(functionName: FunctionName): readonly BusinessSessionAudience[] {
  if (functionName === 'admin-session' || functionName === 'organization-admin') return ['admin-console'];
  if (functionName === 'relationship-command') return ['mini-program', 'admin-console'];
  return ['mini-program'];
}

function isSafeSessionToken(value: string): boolean {
  return value.length >= 1
    && value.length <= 256
    && /^[A-Za-z0-9._~:-]+$/.test(value);
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}

function isSafeSessionId(value: string): boolean {
  return value.length >= 1
    && value.length <= 128
    && /^[A-Za-z0-9:_-]+$/.test(value);
}
