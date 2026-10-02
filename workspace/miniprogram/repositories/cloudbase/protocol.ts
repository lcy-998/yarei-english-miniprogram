import { ServiceError, ServiceResult } from '../../domain/types'

export type FunctionName =
  | 'auth-session'
  | 'task-query'
  | 'task-command'
  | 'student-task-query'
  | 'submission-command'
  | 'review-query'
  | 'review-command'
  | 'parent-query'
  | 'relationship-command'
  | 'content-query'
  | 'learning-progress-query'
  | 'learning-progress-command'
  | 'teacher-student-query'
  | 'teacher-student-command'
  | 'activity-query'
  | 'activity-command'
  | 'vocabulary-evidence-command'
  | 'vocabulary-evidence-query'
  | 'student-work-command'
  | 'student-work-query'
  | 'phonics-query'
  | 'phonics-command'
  | 'task-template-query'
  | 'task-template-command'
  | 'learning-stats-query'
  | 'teacher-textbook-query'
  | 'teacher-textbook-command'
  | 'notification-query'
  | 'notification-command'
  | 'task-recording-query'
  | 'task-recording-command'

export interface FunctionRequest<TAction extends string, TPayload extends object> {
  apiVersion: 'm1.v1'
  action: TAction
  payload: TPayload
  operationId?: string
  expectedVersion?: number
}

export interface CloudCallContext {
  /** Opaque bearer token only; actor/role/organization are never transported. */
  businessSessionToken: string | null
}

export interface CloudFunctionInvoker {
  call<TAction extends string, TPayload extends object, TResult>(
    functionName: FunctionName,
    request: FunctionRequest<TAction, TPayload>,
    context: CloudCallContext,
  ): Promise<ServiceResult<TResult>>
}

export interface CloudAuthenticationPort {
  signIn(input: Readonly<{ mobile: string; password: string }>): Promise<void>
  requestPasswordResetCode?(mobile: string): Promise<void>
  resetPassword?(mobile: string, code: string, newPassword: string): Promise<void>
}

export interface CloudClientContext {
  sessionId: string | null
  activeChildId?: string
  localDate?: string
}

export type CloudClientContextProvider = () => CloudClientContext

export interface CloudRepositoryClient {
  call<TAction extends string, TPayload extends object, TResult>(
    functionName: FunctionName,
    action: TAction,
    payload: TPayload,
    options?: Readonly<{ operationId?: string; expectedVersion?: number; businessSessionToken?: string | null }>,
  ): Promise<ServiceResult<TResult>>
}

const PLATFORM_MESSAGES: Record<'UNAUTHENTICATED' | 'NETWORK_ERROR' | 'SERVICE_UNAVAILABLE' | 'INTERNAL_ERROR', string> = {
  UNAUTHENTICATED: '登录状态已失效，请重新登录',
  NETWORK_ERROR: '网络连接失败，请检查网络后重试',
  SERVICE_UNAVAILABLE: '服务暂不可用，请稍后重试',
  INTERNAL_ERROR: '服务处理失败，请稍后重试',
}

export function createCloudRepositoryClient(
  invoker: CloudFunctionInvoker,
  contextProvider: CloudClientContextProvider,
  onUnauthenticated?: () => void,
): CloudRepositoryClient {
  return {
    async call<TAction extends string, TPayload extends object, TResult>(
      functionName: FunctionName,
      action: TAction,
      payload: TPayload,
      options?: Readonly<{ operationId?: string; expectedVersion?: number; businessSessionToken?: string | null }>,
    ): Promise<ServiceResult<TResult>> {
      const request: FunctionRequest<TAction, TPayload> = {
        apiVersion: 'm1.v1',
        action,
        payload,
        ...(options?.operationId === undefined ? {} : { operationId: options.operationId }),
        ...(options?.expectedVersion === undefined ? {} : { expectedVersion: options.expectedVersion }),
      }
      try {
        const hasExplicitToken = options !== undefined && 'businessSessionToken' in options
        const result = await invoker.call<TAction, TPayload, TResult>(functionName, request, {
          businessSessionToken: hasExplicitToken
            ? options.businessSessionToken ?? null
            : contextProvider().sessionId,
        })
        if (!result.ok && result.error.code === 'UNAUTHENTICATED') onUnauthenticated?.()
        return result
      } catch (error: unknown) {
        const code = platformErrorCode(error)
        if (code === 'UNAUTHENTICATED') onUnauthenticated?.()
        return { ok: false, error: { code, message: PLATFORM_MESSAGES[code],
          retryable: code === 'NETWORK_ERROR' || code === 'SERVICE_UNAVAILABLE' } }
      }
    },
  }
}

function platformErrorCode(error: unknown): Extract<ServiceError['code'], 'UNAUTHENTICATED' | 'NETWORK_ERROR' | 'SERVICE_UNAVAILABLE' | 'INTERNAL_ERROR'> {
  const signal = platformErrorSignal(error)
  if (includesAny(signal, ['UNAUTHENTICATED', 'NOT_LOGGED_IN', 'NOT LOGIN', 'LOGIN_REQUIRED',
    'AUTH_REQUIRED', 'INVALID_TOKEN', 'TOKEN_EXPIRED'])) return 'UNAUTHENTICATED'
  if (includesAny(signal, [
    'TIMEOUT',
    'TIMED OUT',
    'NETWORK',
    'CONNECTION',
    'ECONN',
    'DNS',
    'OFFLINE',
  ])) return 'NETWORK_ERROR'
  if (includesAny(signal, [
    'SERVICE_UNAVAILABLE',
    'UNAVAILABLE',
    'NOT_FOUND',
    'NOT FOUND',
    'ENVIRONMENT',
    'ENV_ID',
    'ENV-ID',
    'ENVID',
    'CLOUDBASE_NOT_ENABLED',
  ])) return 'SERVICE_UNAVAILABLE'
  return 'INTERNAL_ERROR'
}

function platformErrorSignal(error: unknown): string {
  if (!isRecord(error)) return typeof error === 'string' ? error.toUpperCase() : ''
  return ['code', 'errCode', 'errMsg', 'message', 'error', 'error_description']
    .map(field => error[field])
    .filter((value): value is string | number => typeof value === 'string' || typeof value === 'number')
    .map(value => String(value).toUpperCase())
    .join(' ')
}

function includesAny(value: string, candidates: readonly string[]): boolean {
  return candidates.some(candidate => value.includes(candidate))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
