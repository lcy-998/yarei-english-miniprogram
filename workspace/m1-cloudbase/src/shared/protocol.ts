export const API_VERSION = 'm1.v1' as const;

export type ApiVersion = typeof API_VERSION;

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RESOURCE_OFFLINE'
  | 'TASK_NOT_SUBMITTABLE'
  | 'REDO_LIMIT_REACHED'
  | 'DUPLICATE_OPERATION'
  | 'NETWORK_ERROR'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export interface ServiceError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly fieldErrors?: Readonly<Record<string, string>>;
}

export interface ResponseMeta {
  readonly requestId: string;
  readonly serverTime: string;
  readonly apiVersion: ApiVersion;
}

export type ServiceResult<T> =
  | { readonly ok: true; readonly data: T; readonly meta: ResponseMeta }
  | { readonly ok: false; readonly error: ServiceError; readonly meta: ResponseMeta };

export type FunctionResult<T> = ServiceResult<T>;

export interface FunctionRequest<TAction extends string, TPayload> {
  readonly apiVersion: ApiVersion;
  readonly action: TAction;
  readonly payload: TPayload;
  readonly operationId?: string;
  readonly expectedVersion?: number;
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type JsonObject = { readonly [key: string]: JsonValue };

export const FUNCTION_NAMES = [
  'auth-session',
  'task-query',
  'task-command',
  'student-task-query',
  'submission-command',
  'review-query',
  'review-command',
  'parent-query',
  'relationship-command',
  'content-query',
  'organization-admin',
] as const;

export type FunctionName = (typeof FUNCTION_NAMES)[number];

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
