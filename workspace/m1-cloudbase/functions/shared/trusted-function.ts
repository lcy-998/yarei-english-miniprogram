import type { PlatformIdentity, TrustedActorContext, TrustedActorResolver } from '../../src/auth/trusted-actor';
import type { CloudBaseRuntimePort } from '../../src/runtime/ports';
import type { ErrorCode, FunctionName, FunctionRequest, JsonObject, ServiceResult } from '../../src/shared/protocol';
import { createMeta, failure, type RequestIdGenerator, type ResultClock } from '../../src/shared/result';
import { parseFunctionRequest } from '../../src/shared/validation';

export type TrustedFunctionFailurePhase = 'runtime' | 'actor' | 'handler';

export interface TrustedFunctionDependencies {
  readonly runtime: CloudBaseRuntimePort;
  readonly actorResolver: TrustedActorResolver;
  readonly clock: ResultClock;
  readonly requestIds: RequestIdGenerator;
  readonly mapFailure?: (phase: TrustedFunctionFailurePhase, error: unknown) => ErrorCode;
}

export type TrustedFunctionValidation<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly fieldErrors: Readonly<Record<string, string>> };

export function createTrustedFunction<TAction extends string, TInput, TOutput>(
  functionName: FunctionName,
  actions: readonly TAction[],
  dependencies: TrustedFunctionDependencies,
  validate: (request: FunctionRequest<TAction, JsonObject>) => TrustedFunctionValidation<TInput>,
  handle: (input: TInput, actor: TrustedActorContext) => Promise<ServiceResult<TOutput>>,
): (event: unknown) => Promise<ServiceResult<TOutput>> {
  return async (event: unknown): Promise<ServiceResult<TOutput>> => {
    const meta = createMeta(dependencies.clock, dependencies.requestIds);
    const parsed = parseFunctionRequest(event, actions);
    if (!parsed.ok) return failure('VALIDATION_ERROR', meta, parsed.fieldErrors);
    const validated = validate(parsed.value);
    if (!validated.ok) return failure('VALIDATION_ERROR', meta, validated.fieldErrors);
    if (dependencies.runtime.functionName !== functionName) return failure('SERVICE_UNAVAILABLE', meta);

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

    let actor: TrustedActorContext | null;
    try {
      actor = await dependencies.actorResolver.resolve(identity, functionName, sessionId);
    } catch (error: unknown) {
      return failure(mapFailure(dependencies, 'actor', error), meta);
    }
    if (actor === null) return failure('UNAUTHENTICATED', meta);

    try {
      return await handle(validated.value, actor);
    } catch (error: unknown) {
      return failure(mapFailure(dependencies, 'handler', error), meta);
    }
  };
}

function mapFailure(
  dependencies: TrustedFunctionDependencies,
  phase: TrustedFunctionFailurePhase,
  error: unknown,
): ErrorCode {
  const mapped = dependencies.mapFailure?.(phase, error);
  if (mapped !== undefined) return mapped;
  return phase === 'runtime' ? 'SERVICE_UNAVAILABLE' : 'INTERNAL_ERROR';
}
