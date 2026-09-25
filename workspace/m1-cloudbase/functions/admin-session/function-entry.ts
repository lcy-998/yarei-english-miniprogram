import type { AdminSessionHandler, AdminSessionView } from '../../src/auth/admin-session-handler';
import type { PlatformIdentity } from '../../src/auth/trusted-actor';
import { ADMIN_SESSION_ACTIONS, validateAdminSessionRequest } from '../../src/contracts/admin-session';
import { DocumentDatabasePlatformError } from '../../src/repositories/document-database-port';
import type { CloudBaseRuntimePort } from '../../src/runtime/ports';
import type { ErrorCode, ServiceResult } from '../../src/shared/protocol';
import { createMeta, failure, type RequestIdGenerator, type ResultClock } from '../../src/shared/result';
import { parseFunctionRequest } from '../../src/shared/validation';

export interface AdminSessionFunctionDependencies {
  readonly runtime: CloudBaseRuntimePort;
  readonly handler: AdminSessionHandler;
  readonly clock: ResultClock;
  readonly requestIds: RequestIdGenerator;
  readonly mapFailure?: (phase: AdminSessionFailurePhase, error: unknown) => ErrorCode;
}

export type AdminSessionFailurePhase = 'runtime' | 'handler';

export function createAdminSessionFunction(
  dependencies: AdminSessionFunctionDependencies,
): (event: unknown) => Promise<ServiceResult<AdminSessionView | null>> {
  return async (event) => {
    const meta = createMeta(dependencies.clock, dependencies.requestIds);
    const parsed = parseFunctionRequest(event, ADMIN_SESSION_ACTIONS);
    if (!parsed.ok) return failure('VALIDATION_ERROR', meta, parsed.fieldErrors);
    const validated = validateAdminSessionRequest(parsed.value);
    if (!validated.ok) return failure('VALIDATION_ERROR', meta, validated.fieldErrors);
    if (dependencies.runtime.functionName !== 'admin-session') return failure('SERVICE_UNAVAILABLE', meta);

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
  dependencies: AdminSessionFunctionDependencies,
  phase: AdminSessionFailurePhase,
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
