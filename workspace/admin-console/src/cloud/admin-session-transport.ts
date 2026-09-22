import {
  ADMIN_API_VERSION,
  ADMIN_SESSION_AUDIENCE,
  type AdminCloudError,
  type AdminCloudErrorCode,
  type AdminCloudResult,
  type AdminConsoleSession,
} from './admin-cloud-contract';
import {
  ADMIN_SESSION_FUNCTION_NAME,
  type AdminSessionCall,
  type AdminSessionFunctionInvoker,
  type AdminSessionTransport,
  type AdminSessionWireRequest,
} from './admin-session-contract';

const SAFE_MESSAGES: Readonly<Record<AdminCloudErrorCode, string>> = {
  VALIDATION_ERROR: '后台登录请求不符合要求，请检查后重试。',
  UNAUTHENTICATED: '后台登录状态已失效，请重新登录。',
  FORBIDDEN: '当前账号不能进入管理后台。',
  NOT_FOUND: '请求的内容不存在或不在授权范围。',
  CONFLICT: '后台登录状态已发生变化，请重新登录。',
  RESOURCE_OFFLINE: '该资源当前不可用。',
  DUPLICATE_OPERATION: '该操作已经处理，请勿重复提交。',
  NETWORK_ERROR: '网络连接异常，请稍后重试。',
  SERVICE_UNAVAILABLE: '后台登录服务尚未配置或暂不可用。',
  INTERNAL_ERROR: '后台登录服务处理失败，请稍后重试。',
};

const ERROR_CODES = new Set<AdminCloudErrorCode>(Object.keys(SAFE_MESSAGES) as AdminCloudErrorCode[]);
const RETRYABLE = new Set<AdminCloudErrorCode>(['NETWORK_ERROR', 'SERVICE_UNAVAILABLE', 'INTERNAL_ERROR']);
const TOKEN_PATTERN = /^[A-Za-z0-9._~:-]+$/;
const OPERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/;

export function createAdminSessionTransport(options: Readonly<{
  invoker: AdminSessionFunctionInvoker;
  now?: () => Date;
}>): AdminSessionTransport {
  const now = options.now ?? (() => new Date());
  return {
    async invoke(call) {
      const request = toWireRequest(call);
      if (request === null) return failure('VALIDATION_ERROR');
      try {
        return parseResult(call.action, await options.invoker.invoke(ADMIN_SESSION_FUNCTION_NAME, request), now());
      } catch {
        return failure('NETWORK_ERROR');
      }
    },
  };
}

function toWireRequest(call: AdminSessionCall): AdminSessionWireRequest | null {
  if (!isRecord(call) || typeof call.action !== 'string') return null;
  if (call.action === 'bootstrap') {
    if (!hasExactKeys(call, ['action'])) return null;
    return { apiVersion: ADMIN_API_VERSION, action: 'bootstrap', payload: {} };
  }
  if (call.action === 'refresh' || call.action === 'getCurrentSession') {
    if (!hasExactKeys(call, ['action', 'businessSessionToken']) || !isToken(call.businessSessionToken)) return null;
    return {
      apiVersion: ADMIN_API_VERSION,
      action: call.action,
      payload: {},
      businessSessionToken: call.businessSessionToken,
    };
  }
  if (call.action === 'logout') {
    if (!hasExactKeys(call, ['action', 'businessSessionToken', 'operationId'])
      || !isToken(call.businessSessionToken)
      || typeof call.operationId !== 'string'
      || !OPERATION_ID_PATTERN.test(call.operationId)) return null;
    return {
      apiVersion: ADMIN_API_VERSION,
      action: 'logout',
      payload: {},
      businessSessionToken: call.businessSessionToken,
      operationId: call.operationId,
    };
  }
  return null;
}

function parseResult(
  action: AdminSessionCall['action'],
  value: unknown,
  now: Date,
): AdminCloudResult<AdminConsoleSession | null> {
  if (!isRecord(value) || typeof value.ok !== 'boolean' || !isMeta(value.meta)) return failure('INTERNAL_ERROR');
  const requestId = value.meta.requestId;
  if (value.ok) {
    if (!hasExactKeys(value, ['ok', 'data', 'meta'])) return failure('INTERNAL_ERROR', requestId);
    if (action === 'logout') {
      return value.data === null
        ? { ok: true, data: null, requestId }
        : failure('INTERNAL_ERROR', requestId);
    }
    const session = parseSession(value.data, now);
    return session === null
      ? failure('INTERNAL_ERROR', requestId)
      : { ok: true, data: session, requestId };
  }
  if (!hasExactKeys(value, ['ok', 'error', 'meta']) || !isRecord(value.error)) {
    return failure('INTERNAL_ERROR', requestId);
  }
  const allowedErrorKeys = value.error.fieldErrors === undefined
    ? ['code', 'message', 'retryable']
    : ['code', 'message', 'retryable', 'fieldErrors'];
  if (!hasExactKeys(value.error, allowedErrorKeys)
    || typeof value.error.code !== 'string'
    || !ERROR_CODES.has(value.error.code as AdminCloudErrorCode)
    || typeof value.error.message !== 'string'
    || typeof value.error.retryable !== 'boolean') {
    return failure('INTERNAL_ERROR', requestId);
  }
  const fieldErrors = parseFieldErrors(value.error.fieldErrors);
  if (value.error.fieldErrors !== undefined && fieldErrors === undefined) return failure('INTERNAL_ERROR', requestId);
  return failure(value.error.code as AdminCloudErrorCode, requestId);
}

function parseSession(value: unknown, now: Date): AdminConsoleSession | null {
  if (!isRecord(value) || !hasExactKeys(value, ['audience', 'token', 'expiresAt'])) return null;
  if (value.audience !== ADMIN_SESSION_AUDIENCE || !isToken(value.token) || typeof value.expiresAt !== 'string') return null;
  const expiresAt = Date.parse(value.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) return null;
  return { audience: ADMIN_SESSION_AUDIENCE, token: value.token, expiresAt: value.expiresAt };
}

function isMeta(value: unknown): value is Readonly<{ requestId: string; serverTime: string; apiVersion: 'm1.v1' }> {
  if (!isRecord(value) || !hasExactKeys(value, ['requestId', 'serverTime', 'apiVersion'])) return false;
  return typeof value.requestId === 'string'
    && value.requestId.length >= 1
    && value.requestId.length <= 128
    && typeof value.serverTime === 'string'
    && Number.isFinite(Date.parse(value.serverTime))
    && value.apiVersion === ADMIN_API_VERSION;
}

function parseFieldErrors(value: unknown): Readonly<Record<string, string>> | undefined {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value);
  if (entries.length > 30 || entries.some(([key, message]) => key.length < 1 || key.length > 100 || typeof message !== 'string' || message.length > 300)) return undefined;
  return Object.fromEntries(entries) as Readonly<Record<string, string>>;
}

function isToken(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 256 && TOKEN_PATTERN.test(value);
}

function failure(
  code: AdminCloudErrorCode,
  requestId?: string,
): AdminCloudResult<never> {
  const error: AdminCloudError = {
    code,
    message: SAFE_MESSAGES[code],
    retryable: RETRYABLE.has(code),
  };
  return { ok: false, error, ...(requestId === undefined ? {} : { requestId }) };
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && expected.every((key, index) => key === actual[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
