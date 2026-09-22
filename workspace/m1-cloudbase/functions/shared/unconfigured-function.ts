import { failure, type RequestIdGenerator, type ResultClock } from '../../src/shared/result';
import type { FunctionName, FunctionRequest, JsonObject, ServiceResult } from '../../src/shared/protocol';
import { parseFunctionRequest } from '../../src/shared/validation';

export type PayloadValidator<TAction extends string> = (
  action: TAction,
  payload: Readonly<Record<string, unknown>>,
  request: FunctionRequest<TAction, JsonObject>,
) => Readonly<Record<string, string>> | null;

const SYSTEM_CLOCK: ResultClock = {
  nowIso: () => new Date().toISOString(),
};

let sequence = 0;
const REQUEST_IDS: RequestIdGenerator = {
  next: () => {
    sequence += 1;
    return `req_local_placeholder_${sequence}`;
  },
};

export function createUnconfiguredFunction<TAction extends string>(
  functionName: FunctionName,
  actions: readonly TAction[],
  validatePayload?: PayloadValidator<TAction>,
): (event: unknown) => Promise<ServiceResult<never>> {
  return async (event: unknown): Promise<ServiceResult<never>> => {
    const meta = {
      requestId: REQUEST_IDS.next(),
      serverTime: SYSTEM_CLOCK.nowIso(),
      apiVersion: 'm1.v1' as const,
    };
    const parsed = parseFunctionRequest(event, actions);
    if (!parsed.ok) {
      return failure('VALIDATION_ERROR', meta, parsed.fieldErrors);
    }
    const payloadErrors = validatePayload?.(parsed.value.action, parsed.value.payload, parsed.value);
    if (payloadErrors !== undefined && payloadErrors !== null) {
      return failure('VALIDATION_ERROR', meta, payloadErrors);
    }
    // No CloudBase SDK, platform identity bridge, database port, or action handler is
    // wired in this local skeleton. Never silently accept a business command here.
    void functionName;
    return failure('SERVICE_UNAVAILABLE', meta);
  };
}
