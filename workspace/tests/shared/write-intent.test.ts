import { describe, expect, it } from 'vitest'
import { EMPTY_WRITE_INTENT, clearWriteIntent, prepareWriteIntent } from '../../miniprogram/shared/write-intent'

describe('page write operation intent lifecycle', () => {
  it('reuses an operation id for retries, renews it after input changes, and clears it after success', () => {
    let sequence = 0
    const createId = () => `op_${++sequence}`

    const first = prepareWriteIntent(EMPTY_WRITE_INTENT, 'same-input', createId)
    const retry = prepareWriteIntent(first, 'same-input', createId)
    const changed = prepareWriteIntent(retry, 'changed-input', createId)
    const afterSuccess = prepareWriteIntent(clearWriteIntent(), 'changed-input', createId)

    expect(first.operationId).toBe('op_1')
    expect(retry).toBe(first)
    expect(changed.operationId).toBe('op_2')
    expect(afterSuccess.operationId).toBe('op_3')
  })
})
