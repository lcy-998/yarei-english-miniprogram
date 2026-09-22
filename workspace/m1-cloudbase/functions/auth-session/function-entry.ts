import type { AuthSessionHandler, AuthSessionView } from '../../src/auth/auth-session-handler';
import type { PlatformIdentity } from '../../src/auth/trusted-actor';
import { AUTH_SESSION_ACTIONS, validateAuthRequest } from '../../src/contracts/auth-session';
import type { CloudBaseRuntimePort } from '../../src/runtime/ports';
import { DocumentDatabasePlatformError } from '../../src/repositories/document-database-port';
import type { ErrorCode, ServiceResult } from '../../src/shared/protocol';
import { createMeta, failure, type RequestIdGenerator, type ResultClock } from '../../src/shared/result';
import { parseFunctionRequest } from '../../src/shared/validation';

export type AuthSessionMain = (event: unknown) => Promise<ServiceResult<AuthSessionView | null>>;
export type AuthSessionFailurePhase = 'runtime' | 'handler';

export interface AuthSessionFunctionDependencies {
  readonly runtime: CloudBaseRuntimePort;
  readonly handler: AuthSessionHandler;
  readonly clock: ResultClock;
  readonly requestIds: RequestIdGenerator;
  readonly mapFailure?: (phase: AuthSessionFailurePhase, error: unknown) => ErrorCode;
}

/**
 * Local composition boundary for auth-session. The CloudBase adapter derives
 * platform identity independently and resolves only the strictly validated
 * opaque token; it does not accept client actor/role/organization claims.
 */
export function createAuthSessionFunction(dependencies: AuthSessionFunctionDependencies): AuthSessionMain {
  return async (event: unknown): Promise<ServiceResult<AuthSessionView | null>> => {
    const meta = createMeta(dependencies.clock, dependencies.requestIds);
    const parsed = parseFunctionRequest(event, AUTH_SESSION_ACTIONS);
    if (!parsed.ok) return failure('VALIDATION_ERROR', meta, parsed.fieldErrors);
    const validated = validateAuthRequest(parsed.value);
    if (!validated.ok) return failure('VALIDATION_ERROR', meta, validated.fieldErrors);
    if (dependencies.runtime.functionName !== 'auth-session') {
      return failure('SERVICE_UNAVAILABLE', meta);
    }

    let identity: PlatformIdentity;
    let sessionId: string | null;
    try {
      [identity, sessionId] = await Promise.all([
        dependencies.runtime.getPlatformSubject(),
        dependencies.runtime.getBusinessSessionId({
          businessSessionToken: parsed.value.businessSessionToken ?? null,
        }),
      ]);
    } catch (error: unknown) {
      return failure(mapFailure(dependencies, 'runtime', error), meta);
    }

    try {
      return await dependencies.handler.handle(validated.value, identity, sessionId, meta);
    } catch (error: unknown) {
      return failure(mapFailure(dependencies, 'handler', error), meta);
    }
  };
}

function mapFailure(
  dependencies: AuthSessionFunctionDependencies,
  phase: AuthSessionFailurePhase,
  error: unknown,
): ErrorCode {
  const mapped = dependencies.mapFailure?.(phase, error);
  if (mapped !== undefined) return mapped;
  if (phase === 'handler' && error instanceof DocumentDatabasePlatformError) {
    if (error.kind === 'unavailable') return 'SERVICE_UNAVAILABLE';
    if (error.kind === 'conflict') return 'CONFLICT';
    if (error.kind === 'invalid-data') return 'VALIDATION_ERROR';
  }
  return phase === 'runtime' ? 'SERVICE_UNAVAILABLE' : 'INTERNAL_ERROR';
}
