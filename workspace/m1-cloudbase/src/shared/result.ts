import { API_VERSION, type ErrorCode, type ResponseMeta, type ServiceError, type ServiceResult } from './protocol';

const RETRYABLE_CODES: ReadonlySet<ErrorCode> = new Set([
  'NETWORK_ERROR',
  'SERVICE_UNAVAILABLE',
  'INTERNAL_ERROR',
]);

const SAFE_MESSAGES: Readonly<Record<ErrorCode, string>> = {
  VALIDATION_ERROR: '输入内容不符合要求，请检查后重试。',
  UNAUTHENTICATED: '登录状态已失效，请重新登录。',
  FORBIDDEN: '你暂时没有执行此操作的权限。',
  NOT_FOUND: '请求的内容不存在或当前不可见。',
  CONFLICT: '内容已发生变化，请刷新后重试。',
  RESOURCE_OFFLINE: '该资源当前不可用于新操作。',
  MEDIA_INVALID: '录音文件无效或超出时长、大小限制，请重录后重试。',
  TASK_NOT_SUBMITTABLE: '当前任务不在可提交状态。',
  REDO_LIMIT_REACHED: '已达到允许的重做次数。',
  DUPLICATE_OPERATION: '该操作已经处理，请勿重复提交。',
  NETWORK_ERROR: '网络连接异常，请稍后重试。',
  SERVICE_UNAVAILABLE: '服务暂不可用，请稍后重试。',
  INTERNAL_ERROR: '服务处理失败，请稍后重试。',
};

export interface ResultClock {
  nowIso(): string;
}

export interface RequestIdGenerator {
  next(): string;
}

export function createMeta(clock: ResultClock, requestIds: RequestIdGenerator): ResponseMeta {
  return { requestId: requestIds.next(), serverTime: clock.nowIso(), apiVersion: API_VERSION };
}

export function serviceError(
  code: ErrorCode,
  fieldErrors?: Readonly<Record<string, string>>,
): ServiceError {
  return {
    code,
    message: SAFE_MESSAGES[code],
    retryable: RETRYABLE_CODES.has(code),
    ...(fieldErrors === undefined ? {} : { fieldErrors }),
  };
}

export function success<T>(data: T, meta: ResponseMeta): ServiceResult<T> {
  return { ok: true, data, meta };
}

export function failure<T = never>(code: ErrorCode, meta: ResponseMeta, fieldErrors?: Readonly<Record<string, string>>): ServiceResult<T> {
  return { ok: false, error: serviceError(code, fieldErrors), meta };
}
