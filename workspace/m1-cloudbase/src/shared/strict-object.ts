import { isRecord } from './protocol';

export type StrictObjectResult =
  | { readonly ok: true; readonly value: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly fieldErrors: Readonly<Record<string, string>> };

export function parseExactObject(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): StrictObjectResult {
  if (!isRecord(value)) {
    return { ok: false, fieldErrors: { payload: '请求数据必须是对象。' } };
  }
  const allowedKeys = new Set([...requiredKeys, ...optionalKeys]);
  const unknownKey = Object.keys(value).find((key) => !allowedKeys.has(key));
  if (unknownKey !== undefined) {
    return { ok: false, fieldErrors: { [unknownKey]: '不支持的字段。' } };
  }
  const missingKey = requiredKeys.find((key) => !(key in value));
  if (missingKey !== undefined) {
    return { ok: false, fieldErrors: { [missingKey]: '该字段为必填项。' } };
  }
  return { ok: true, value };
}
