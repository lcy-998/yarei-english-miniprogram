export interface WriteIntentState {
  operationId: string
  fingerprint: string
}

export const EMPTY_WRITE_INTENT: WriteIntentState = { operationId: '', fingerprint: '' }

export function prepareWriteIntent(
  current: WriteIntentState,
  fingerprint: string,
  createOperationId: () => string,
): WriteIntentState {
  if (current.operationId && current.fingerprint === fingerprint) return current
  return { operationId: createOperationId(), fingerprint }
}

export function clearWriteIntent(): WriteIntentState {
  return { ...EMPTY_WRITE_INTENT }
}

export function createPageOperationId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`
}
