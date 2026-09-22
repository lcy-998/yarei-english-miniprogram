import type { TrustedActorContext } from '../auth/trusted-actor';
import { createOperationFingerprint } from '../shared/request-summary';
import { failure, type RequestIdGenerator, type ResultClock } from '../shared/result';
import type { FunctionName, JsonValue, ServiceResult } from '../shared/protocol';
import type { IdempotencyRepository } from '../runtime/ports';

export class IdempotencyService {
  public constructor(
    private readonly records: IdempotencyRepository,
    private readonly clock: ResultClock,
    private readonly requestIds: RequestIdGenerator,
  ) {}

  public async execute<T extends JsonValue>(input: Readonly<{
    actor: TrustedActorContext;
    functionName: FunctionName;
    action: string;
    operationId: string;
    payload: JsonValue;
    expectedVersion?: number;
    perform: () => Promise<ServiceResult<T>>;
  }>): Promise<ServiceResult<T>> {
    const fingerprint = createOperationFingerprint({
      organizationId: input.actor.organizationId,
      actorUserId: input.actor.actorUserId,
      functionName: input.functionName,
      action: input.action,
      operationId: input.operationId,
      payload: input.payload,
      ...(input.expectedVersion === undefined ? {} : { expectedVersion: input.expectedVersion }),
    });
    const existing = await this.records.find(fingerprint.recordId);
    if (existing !== null) {
      if (existing.requestHash !== fingerprint.requestHash) return this.fail('CONFLICT');
      if (existing.status === 'processing') return this.fail('CONFLICT');
      if (existing.result !== null) return existing.result as ServiceResult<T>;
      return this.fail('INTERNAL_ERROR');
    }
    const created = await this.records.create({
      id: fingerprint.recordId,
      organizationId: input.actor.organizationId,
      actorUserId: input.actor.actorUserId,
      functionName: input.functionName,
      action: input.action,
      operationId: input.operationId,
      requestHash: fingerprint.requestHash,
      status: 'processing',
      result: null,
    });
    if (!created) return this.fail('CONFLICT');
    const result = await input.perform();
    await this.records.replace({
      id: fingerprint.recordId,
      organizationId: input.actor.organizationId,
      actorUserId: input.actor.actorUserId,
      functionName: input.functionName,
      action: input.action,
      operationId: input.operationId,
      requestHash: fingerprint.requestHash,
      status: result.ok ? 'succeeded' : 'failed',
      result: result as ServiceResult<JsonValue>,
    });
    return result;
  }

  private fail<T extends JsonValue>(code: 'CONFLICT' | 'INTERNAL_ERROR'): ServiceResult<T> {
    return failure(code, { requestId: this.requestIds.next(), serverTime: this.clock.nowIso(), apiVersion: 'm1.v1' });
  }
}
