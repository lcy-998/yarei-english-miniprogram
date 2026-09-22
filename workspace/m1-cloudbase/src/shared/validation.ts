import { API_VERSION, isRecord, type FunctionRequest, type JsonObject } from './protocol';

export type RequestParseResult<TAction extends string> =
  | { readonly ok: true; readonly value: FunctionRequest<TAction, JsonObject> }
  | { readonly ok: false; readonly fieldErrors: Readonly<Record<string, string>> };

export function parseFunctionRequest<TAction extends string>(
  input: unknown,
  allowedActions: readonly TAction[],
): RequestParseResult<TAction> {
  if (!isRecord(input)) {
    return invalid('request', '请求必须是对象。');
  }
  const allowedKeys = new Set(['apiVersion', 'action', 'payload', 'businessSessionToken', 'operationId', 'expectedVersion']);
  const unknownKey = Object.keys(input).find((key) => !allowedKeys.has(key));
  if (unknownKey !== undefined) {
    return invalid(unknownKey, '不支持的字段。');
  }
  if (input.apiVersion !== API_VERSION) {
    return invalid('apiVersion', '不支持的接口版本。');
  }
  if (typeof input.action !== 'string' || !allowedActions.includes(input.action as TAction)) {
    return invalid('action', '不支持的操作。');
  }
  if (!isRecord(input.payload)) {
    return invalid('payload', '请求数据必须是对象。');
  }
  const businessSessionToken = input.businessSessionToken;
  if (businessSessionToken !== undefined && !isBusinessSessionToken(businessSessionToken)) {
    return invalid('businessSessionToken', '业务会话令牌格式无效。');
  }
  const operationId = input.operationId;
  if (operationId !== undefined && !isOperationId(operationId)) {
    return invalid('operationId', '操作标识格式无效。');
  }
  const expectedVersion = input.expectedVersion;
  if (expectedVersion !== undefined && (typeof expectedVersion !== 'number' || !Number.isInteger(expectedVersion) || expectedVersion < 1)) {
    return invalid('expectedVersion', '版本号必须是正整数。');
  }
  return {
    ok: true,
    value: {
      apiVersion: API_VERSION,
      action: input.action as TAction,
      payload: input.payload as JsonObject,
      ...(businessSessionToken === undefined ? {} : { businessSessionToken }),
      ...(operationId === undefined ? {} : { operationId }),
      ...(expectedVersion === undefined ? {} : { expectedVersion }),
    },
  };
}

export function isBusinessSessionToken(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= 256
    && /^[A-Za-z0-9._~:-]+$/.test(value);
}

function invalid<TAction extends string>(field: string, message: string): RequestParseResult<TAction> {
  return { ok: false, fieldErrors: { [field]: message } };
}

export function isOperationId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(value);
}
