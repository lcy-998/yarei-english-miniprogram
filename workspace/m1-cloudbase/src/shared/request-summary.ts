import type { FunctionName, JsonValue } from './protocol';

export interface OperationFingerprintInput {
  readonly organizationId: string;
  readonly actorUserId: string;
  readonly functionName: FunctionName;
  readonly action: string;
  readonly operationId: string;
  readonly payload: JsonValue;
  readonly expectedVersion?: number;
}

export interface OperationFingerprint {
  readonly recordId: string;
  readonly requestHash: string;
}

export function canonicalize(value: JsonValue): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  if (isJsonObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function isJsonObject(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createOperationFingerprint(input: OperationFingerprintInput): OperationFingerprint {
  const requestHash = hashHex(canonicalize({
    action: input.action,
    payload: input.payload,
    ...(input.expectedVersion === undefined ? {} : { expectedVersion: input.expectedVersion }),
  }));
  const recordId = `idem_${hashHex(canonicalize({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    functionName: input.functionName,
    action: input.action,
    operationId: input.operationId,
  }))}`;
  return { recordId, requestHash };
}

function hashHex(text: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= BigInt(text.charCodeAt(index));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}
