import type { TrustedActorContext } from '../auth/trusted-actor';
import { createOperationFingerprint } from '../shared/request-summary';
import type { FunctionName, JsonValue } from '../shared/protocol';
import { OrgContentError } from './types';
import type { OrgContentTransaction } from './repository';

type StoredOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: OrgContentError['code'] };

interface PendingRecord {
  readonly requestHash: string;
  readonly outcome: Promise<StoredOutcome<unknown>>;
}

export interface OrgContentIdempotencyBoundary {
  execute<T>(input: Readonly<{
    actor: TrustedActorContext;
    functionName: FunctionName;
    action: string;
    operationId: string;
    payload: JsonValue;
    expectedVersion?: number;
    perform: (transaction?: OrgContentTransaction) => Promise<T>;
    onBoundaryError?: (error: unknown, transaction?: OrgContentTransaction) => Promise<void>;
    serializeResult?: (value: T) => JsonValue;
    restoreResult?: (value: JsonValue) => T;
  }>): Promise<T>;
}

export class InMemoryOrgContentIdempotency implements OrgContentIdempotencyBoundary {
  private readonly records = new Map<string, PendingRecord>();

  public async execute<T>(input: Readonly<{
    actor: TrustedActorContext;
    functionName: FunctionName;
    action: string;
    operationId: string;
    payload: JsonValue;
    expectedVersion?: number;
    perform: (transaction?: OrgContentTransaction) => Promise<T>;
    onBoundaryError?: (error: unknown, transaction?: OrgContentTransaction) => Promise<void>;
    serializeResult?: (value: T) => JsonValue;
    restoreResult?: (value: JsonValue) => T;
  }>): Promise<T> {
    if (input.operationId.trim().length === 0) {
      const error = new OrgContentError('VALIDATION_ERROR');
      await input.onBoundaryError?.(error);
      throw error;
    }
    const fingerprint = createOperationFingerprint({
      organizationId: input.actor.organizationId,
      actorUserId: input.actor.actorUserId,
      functionName: input.functionName,
      action: input.action,
      operationId: input.operationId,
      payload: input.payload,
      ...(input.expectedVersion === undefined ? {} : { expectedVersion: input.expectedVersion }),
    });
    const existing = this.records.get(fingerprint.recordId);
    if (existing !== undefined) {
      if (existing.requestHash !== fingerprint.requestHash) {
        const error = new OrgContentError('CONFLICT');
        await input.onBoundaryError?.(error);
        throw error;
      }
      return this.unwrap<T>(await existing.outcome);
    }

    const outcome = this.perform(input.perform);
    this.records.set(fingerprint.recordId, { requestHash: fingerprint.requestHash, outcome });
    try {
      return this.unwrap<T>(await outcome);
    } catch (error: unknown) {
      if (!(error instanceof OrgContentError)) await input.onBoundaryError?.(error);
      throw error;
    }
  }

  private async perform<T>(perform: () => Promise<T>): Promise<StoredOutcome<T>> {
    try {
      return { ok: true, value: await perform() };
    } catch (error: unknown) {
      if (error instanceof OrgContentError) return { ok: false, code: error.code };
      throw error;
    }
  }

  private unwrap<T>(outcome: StoredOutcome<unknown>): T {
    if (!outcome.ok) throw new OrgContentError(outcome.code);
    return outcome.value as T;
  }
}
