import { beforeEach, describe, expect, it } from 'vitest'
import { AppState } from '../../miniprogram/domain/types'
import { getState, initialState, replaceState } from '../../miniprogram/repositories/memory/mock-state'

const clone = (state: AppState): AppState => JSON.parse(JSON.stringify(state)) as AppState

describe('M0 memory repository isolation', () => {
  beforeEach(() => replaceState(initialState))

  it('copies both replacement input and returned snapshots', () => {
    const replacement = clone(initialState)
    replaceState(replacement)
    replacement.tasks[0]!.title = '输入对象篡改'
    replacement.tasks[0]!.items[0]!.title = '输入嵌套对象篡改'

    const firstSnapshot = getState()
    expect(firstSnapshot.tasks[0]?.title).toBe('动物主题听说练习')
    expect(firstSnapshot.tasks[0]?.items[0]?.title).toBe('听力练习')

    firstSnapshot.assignments[0]!.progressPercent = 100
    firstSnapshot.tasks[0]!.items[0]!.title = '输出嵌套对象篡改'

    const secondSnapshot = getState()
    expect(secondSnapshot.assignments[0]?.progressPercent).toBe(67)
    expect(secondSnapshot.tasks[0]?.items[0]?.title).toBe('听力练习')
  })
})
