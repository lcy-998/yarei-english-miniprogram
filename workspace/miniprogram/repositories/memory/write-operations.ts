import {
  AppState,
  ReviewFeedback,
  Submission,
  Task,
  WriteOperationKind,
  WriteOperationReceipt,
} from '../../domain/types'

export type WriteOperationResult = Task | Submission | ReviewFeedback

export interface OperationLookup<T extends WriteOperationResult> {
  status: 'missing' | 'replay' | 'conflict'
  result?: T
}
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function findOperation<T extends WriteOperationResult>(
  state: AppState,
  kind: WriteOperationKind,
  actorUserId: string,
  operationId: string,
  fingerprint: string,
): OperationLookup<T> {
  const receipt = state.operationReceipts.find(item => (
    item.kind === kind
    && item.actorUserId === actorUserId
    && item.operationId === operationId
  ))
  if (!receipt) return { status: 'missing' }
  if (receipt.fingerprint !== fingerprint) return { status: 'conflict' }
  return { status: 'replay', result: clone(receipt.result) as T }
}

export function addOperationReceipt(
  state: AppState,
  input: Omit<WriteOperationReceipt, 'result'> & { result: WriteOperationResult },
): void {
  state.operationReceipts.push(clone(input))
}
