import {
  ADMIN_API_VERSION,
  ADMIN_FUNCTION_NAME,
  ADMIN_SESSION_AUDIENCE,
  type AdminCloudError,
  type AdminCloudErrorCode,
  type AdminCloudResult,
  type AdminConsoleSession,
  type AdminFunctionInvoker,
  type AdminSessionSource,
  type OrganizationAdminCall,
  type OrganizationAdminWireRequest,
} from './admin-cloud-contract';

const SAFE_MESSAGES: Readonly<Record<AdminCloudErrorCode, string>> = {
  VALIDATION_ERROR: '输入内容不符合要求，请检查后重试。',
  UNAUTHENTICATED: '后台登录状态已失效，请重新登录。',
  FORBIDDEN: '当前后台账号没有执行此操作的权限。',
  NOT_FOUND: '请求的内容不存在或不在授权范围。',
  CONFLICT: '内容已发生变化，请刷新后重试。',
  RESOURCE_OFFLINE: '该资源当前不可用。',
  DUPLICATE_OPERATION: '该操作已经处理，请勿重复提交。',
  NETWORK_ERROR: '网络连接异常，请稍后重试。',
  SERVICE_UNAVAILABLE: '后台服务尚未配置或暂不可用。',
  INTERNAL_ERROR: '后台服务处理失败，请稍后重试。',
};

const RETRYABLE = new Set<AdminCloudErrorCode>(['NETWORK_ERROR', 'SERVICE_UNAVAILABLE', 'INTERNAL_ERROR']);
const ERROR_CODES = new Set<AdminCloudErrorCode>(Object.keys(SAFE_MESSAGES) as AdminCloudErrorCode[]);
const CALL_SHAPES: Readonly<Record<OrganizationAdminCall['action'], Readonly<{ required: readonly string[]; optional?: readonly string[]; write: boolean }>>> = {
  listClasses: { required: [], write: false },
  getDashboardOverview: { required: [], optional: ['from', 'to'], write: false },
  listRoleAssignments: { required: ['filter', 'page'], write: false },
  listAuditLogs: { required: ['filter', 'page'], write: false },
  listUsers: { required: [], optional: ['classId', 'role', 'status', 'keyword'], write: false },
  listDeletedWorkDrafts: { required: ['studentId', 'page'], write: false },
  restoreWorkDraft: { required: ['studentId', 'workId', 'reason'], write: true },
  listAdminQuestions: { required: ['filters', 'page'], write: false },
  getAdminQuestion: { required: ['id'], write: false },
  setQuestionVisibility: { required: ['id', 'visibility', 'reason'], write: true },
  batchSetQuestionVisibility: { required: ['items', 'visibility', 'reason'], write: true },
  batchSetQuestionStatus: { required: ['items', 'status', 'reason'], write: true },
  createClass: { required: ['name', 'grade', 'term', 'reason'], write: true },
  updateClass: { required: ['classId', 'name', 'grade', 'term', 'reason'], write: true },
  disableClass: { required: ['classId', 'reason'], write: true },
  createUser: { required: ['displayName', 'mobile', 'role', 'reason'], optional: ['classId'], write: true },
  updateUser: { required: ['userId', 'displayName', 'reason'], write: true },
  disableUser: { required: ['userId', 'reason'], write: true },
  assignRole: { required: ['userId', 'role', 'permissions', 'scopeType', 'scopeIds', 'reason'], write: true },
  revokeRole: { required: ['userId', 'role', 'reason'], write: true },
  grantTeacherClass: { required: ['teacherId', 'classId', 'permissions', 'reason'], write: true },
  revokeTeacherClass: { required: ['teacherId', 'classId', 'reason'], write: true },
};

export interface AdminCloudTransport {
  invoke(call: OrganizationAdminCall): Promise<AdminCloudResult<unknown>>;
}

export function createAdminCloudTransport(options: Readonly<{
  invoker: AdminFunctionInvoker;
  sessions: AdminSessionSource;
  now?: () => Date;
}>): AdminCloudTransport {
  const now = options.now ?? (() => new Date());
  return {
    async invoke(call): Promise<AdminCloudResult<unknown>> {
      const callError = validateCall(call);
      if (callError !== null) return failed('VALIDATION_ERROR', callError);

      let sessionValue: unknown;
      try {
        sessionValue = await options.sessions.current();
      } catch {
        return failed('SERVICE_UNAVAILABLE');
      }
      const session = parseAdminSession(sessionValue, now());
      if (session === null) return failed('UNAUTHENTICATED');

      const request: OrganizationAdminWireRequest = {
        apiVersion: ADMIN_API_VERSION,
        action: call.action,
        payload: call.payload,
        businessSessionToken: session.token,
        ...('expectedVersion' in call ? { expectedVersion: call.expectedVersion } : {}),
        ...('operationId' in call ? { operationId: call.operationId } : {}),
      };

      try {
        return parseFunctionResult(await options.invoker.invoke(ADMIN_FUNCTION_NAME, request));
      } catch {
        return failed('NETWORK_ERROR');
      }
    },
  };
}

function parseAdminSession(value: unknown, now: Date): AdminConsoleSession | null {
  if (!isRecord(value) || !hasExactKeys(value, ['audience', 'token', 'expiresAt'])) return null;
  if (value.audience !== ADMIN_SESSION_AUDIENCE || typeof value.token !== 'string' || value.token.length < 16 || value.token.length > 4096) return null;
  if (typeof value.expiresAt !== 'string') return null;
  const expiry = Date.parse(value.expiresAt);
  if (!Number.isFinite(expiry) || expiry <= now.getTime()) return null;
  return { audience: ADMIN_SESSION_AUDIENCE, token: value.token, expiresAt: value.expiresAt };
}

function parseFunctionResult(value: unknown): AdminCloudResult<unknown> {
  if (!isRecord(value) || typeof value.ok !== 'boolean' || !isRecord(value.meta)) return failed('INTERNAL_ERROR');
  const requestId = typeof value.meta.requestId === 'string' && value.meta.requestId.length <= 128 ? value.meta.requestId : undefined;
  if (value.ok) {
    if (!hasExactKeys(value, ['ok', 'data', 'meta'])) return failed('INTERNAL_ERROR', undefined, requestId);
    return { ok: true, data: value.data, ...(requestId === undefined ? {} : { requestId }) };
  }
  if (!hasExactKeys(value, ['ok', 'error', 'meta']) || !isRecord(value.error) || typeof value.error.code !== 'string' || !ERROR_CODES.has(value.error.code as AdminCloudErrorCode)) {
    return failed('INTERNAL_ERROR', undefined, requestId);
  }
  const code = value.error.code as AdminCloudErrorCode;
  const fieldErrors = parseFieldErrors(value.error.fieldErrors);
  return {
    ok: false,
    error: error(code, fieldErrors),
    ...(requestId === undefined ? {} : { requestId }),
  };
}

function parseFieldErrors(value: unknown): Readonly<Record<string, string>> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value);
  if (entries.length > 30 || entries.some(([key, message]) => key.length > 100 || typeof message !== 'string' || message.length > 300)) return undefined;
  return Object.fromEntries(entries) as Readonly<Record<string, string>>;
}

function validateCall(call: OrganizationAdminCall): string | null {
  if (!isRecord(call) || typeof call.action !== 'string' || !isRecord(call.payload)) return '请求格式无效。';
  if (!(call.action in CALL_SHAPES)) return '后台动作无效。';
  const action = call.action as OrganizationAdminCall['action'];
  const shape = CALL_SHAPES[action];
  const candidate = call as Record<string, unknown>;
  const expectedVersion = candidate.expectedVersion;
  const operationId = candidate.operationId;
  const payload = call.payload as Record<string, unknown>;
  const reason = payload.reason;
  const expectedTopLevel = shape.write ? ['action', 'payload', 'expectedVersion', 'operationId'] : ['action', 'payload'];
  if (!hasExactKeys(candidate, expectedTopLevel)) return '请求字段无效。';
  const allowedPayload = [...shape.required, ...(shape.optional ?? [])];
  if (!shape.required.every((key) => key in payload) || !Object.keys(payload).every((key) => allowedPayload.includes(key))) return '动作字段无效。';
  if (shape.write && (expectedVersion === undefined || operationId === undefined)) return '写操作缺少版本号或操作标识。';
  if (expectedVersion !== undefined && (typeof expectedVersion !== 'number' || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1)) return '版本号无效。';
  if (operationId !== undefined && (typeof operationId !== 'string' || operationId.trim().length < 8 || operationId.length > 128)) return '操作标识无效。';
  if (reason !== undefined && (typeof reason !== 'string' || reason.trim().length === 0 || reason.length > 300)) return '操作原因无效。';
  if (action === 'getDashboardOverview') return validateTimeRange(payload.from, payload.to);
  if (action === 'listRoleAssignments') {
    if (!hasAllowedKeys(payload.filter, ['userId', 'role', 'status', 'scopeType']) || !validatePage(payload.page)) return '角色查询条件或分页无效。';
    const filter = payload.filter as Record<string, unknown>;
    if (!optionalId(filter.userId)
      || !optionalEnum(filter.role, ['student', 'parent', 'teacher', 'admin'])
      || !optionalEnum(filter.status, ['active', 'revoked'])
      || !optionalEnum(filter.scopeType, ['self', 'classes', 'organization'])) return '角色查询条件无效。';
  }
  if (action === 'listAuditLogs') {
    if (!hasAllowedKeys(payload.filter, ['actorUserId', 'action', 'result', 'targetType', 'from', 'to']) || !validatePage(payload.page)) return '审计查询条件或分页无效。';
    const filter = payload.filter as Record<string, unknown>;
    if (!optionalId(filter.actorUserId)
      || !optionalBoundedString(filter.action, 80)
      || !optionalEnum(filter.result, ['succeeded', 'denied', 'failed'])
      || !optionalBoundedString(filter.targetType, 80)) return '审计查询条件无效。';
    const timeError = validateTimeRange(filter.from, filter.to);
    if (timeError !== null) return timeError;
  }
  if (action === 'listAdminQuestions') {
    if (!hasAllowedKeys(payload.filters, ['keyword', 'status', 'questionType', 'classId']) || !validatePage(payload.page)) return '题目筛选或分页无效。';
  }
  if (action === 'listDeletedWorkDrafts'
    && (!requiredId(payload.studentId) || !validateWorkPage(payload.page))) return '作品草稿查询条件或分页无效。';
  if (action === 'restoreWorkDraft'
    && (!requiredId(payload.studentId) || !requiredId(payload.workId)
      || typeof payload.reason !== 'string' || !payload.reason.trim() || payload.reason.trim().length > 200)) {
    return '作品草稿恢复参数无效。';
  }
  if (action === 'getAdminQuestion' && !optionalId(payload.id)) return '题目标识无效。';
  if (action === 'setQuestionVisibility' || action === 'batchSetQuestionVisibility') {
    if (action === 'setQuestionVisibility' && !optionalId(payload.id) || !isRecord(payload.visibility)
      || payload.visibility.type !== 'organization' && payload.visibility.type !== 'classes') return '可见范围无效。';
  }
  if (action === 'batchSetQuestionVisibility'
    && (!Array.isArray(payload.items) || !payload.items.length || payload.items.length > 20)) return '批量授权参数无效。';
  if (action === 'batchSetQuestionStatus') {
    if (!Array.isArray(payload.items) || !payload.items.length || payload.items.length > 20
      || !['published', 'offline'].includes(String(payload.status))) return '批量操作参数无效。';
  }
  return null;
}

function validatePage(value: unknown): boolean {
  if (!isRecord(value) || !hasExactKeys(value, ['limit', 'offset'])) return false;
  return typeof value.limit === 'number' && Number.isSafeInteger(value.limit) && value.limit >= 1 && value.limit <= 50
    && typeof value.offset === 'number' && Number.isSafeInteger(value.offset) && value.offset >= 0 && value.offset <= 1_000;
}

function validateWorkPage(value: unknown): boolean {
  return isRecord(value) && hasExactKeys(value, ['limit', 'offset'])
    && typeof value.limit === 'number' && Number.isSafeInteger(value.limit) && value.limit >= 1 && value.limit <= 50
    && typeof value.offset === 'number' && Number.isSafeInteger(value.offset) && value.offset >= 0 && value.offset <= 10000;
}

function requiredId(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 128;
}

function validateTimeRange(from: unknown, to: unknown): string | null {
  if (from === undefined && to === undefined) return null;
  if (typeof from !== 'string' || typeof to !== 'string' || !isIsoDateTime(from) || !isIsoDateTime(to)) return '起止时间必须是带时区的 ISO 8601 时间。';
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  if (toMs < fromMs || toMs - fromMs > 31 * 24 * 60 * 60 * 1_000) return '查询时间范围无效。';
  return null;
}

function isIsoDateTime(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function hasAllowedKeys(value: unknown, allowed: readonly string[]): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).every((key) => allowed.includes(key));
}

function optionalId(value: unknown): boolean {
  return value === undefined || typeof value === 'string' && value.trim().length > 0 && value.length <= 128;
}

function optionalBoundedString(value: unknown, maximumLength: number): boolean {
  return value === undefined || typeof value === 'string' && value.length <= maximumLength;
}

function optionalEnum<T extends string>(value: unknown, allowed: readonly T[]): boolean {
  return value === undefined || typeof value === 'string' && allowed.includes(value as T);
}

function failed(code: AdminCloudErrorCode, fieldMessage?: string, requestId?: string): AdminCloudResult<never> {
  const fieldErrors = fieldMessage === undefined ? undefined : { request: fieldMessage };
  return { ok: false, error: error(code, fieldErrors), ...(requestId === undefined ? {} : { requestId }) };
}

function error(code: AdminCloudErrorCode, fieldErrors?: Readonly<Record<string, string>>): AdminCloudError {
  return { code, message: SAFE_MESSAGES[code], retryable: RETRYABLE.has(code), ...(fieldErrors === undefined ? {} : { fieldErrors }) };
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && [...keys].sort().every((key, index) => key === actual[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
