export const API_VERSION = 'm1.v1' as const;

export type ApiVersion = typeof API_VERSION;

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RESOURCE_OFFLINE'
  | 'MEDIA_INVALID'
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
  /** Opaque bearer value issued by auth-session; never contains actor claims. */
  readonly businessSessionToken?: string;
  readonly operationId?: string;
  readonly expectedVersion?: number;
}

/**
 * Per-invocation transport context derived only after the wire envelope passes
 * strict validation. The token is still untrusted until the server resolves it
 * and binds the resulting session to the CloudBase platform subject.
 */
export interface CloudCallContext {
  readonly businessSessionToken: string | null;
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type JsonObject = { readonly [key: string]: JsonValue };

export const FUNCTION_NAMES = [
  'auth-session',
  'admin-session',
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
  'teacher-student-query',
  'teacher-student-command',
  'learning-progress-query',
  'learning-progress-command',
  'activity-command',
  'activity-query',
  'vocabulary-evidence-command',
  'vocabulary-evidence-query',
  'student-work-command',
  'student-work-query',
  'phonics-query',
  'phonics-command',
  'task-template-query',
  'task-template-command',
  'teacher-textbook-query',
  'teacher-textbook-command',
  'learning-stats-query',
  'notification-query',
  'notification-command',
  'maintenance-timer',
  'admin-task-activity-query',
  'admin-task-activity-command',
  'textbook-admin-query',
  'textbook-admin-command',
  'task-recording-query',
  'task-recording-command',
] as const;

export type FunctionName = (typeof FUNCTION_NAMES)[number];

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
