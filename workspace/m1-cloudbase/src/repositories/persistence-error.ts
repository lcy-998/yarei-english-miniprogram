import type { ErrorCode } from '../shared/protocol';
import { serviceError } from '../shared/result';
import { DocumentDatabasePlatformError } from './document-database-port';

export type PersistenceErrorCode = Extract<ErrorCode, 'CONFLICT' | 'SERVICE_UNAVAILABLE' | 'INTERNAL_ERROR'>;

/** Stable, safe boundary consumed by future function error mapping. */
export class TaskCorePersistenceError extends Error {
  public readonly retryable: boolean;

  public constructor(public readonly code: PersistenceErrorCode, cause?: unknown) {
    const safe = serviceError(code);
    super(safe.message);
    if (cause !== undefined) Object.defineProperty(this, 'cause', { value: cause, enumerable: false });
    this.name = 'TaskCorePersistenceError';
    this.retryable = safe.retryable;
  }
}

export function toTaskCorePersistenceError(error: unknown): TaskCorePersistenceError {
  if (error instanceof TaskCorePersistenceError) return error;
  if (error instanceof DocumentDatabasePlatformError) {
    if (error.kind === 'conflict') return new TaskCorePersistenceError('CONFLICT', error);
    if (error.kind === 'unavailable') return new TaskCorePersistenceError('SERVICE_UNAVAILABLE', error);
  }
  return new TaskCorePersistenceError('INTERNAL_ERROR', error);
}
