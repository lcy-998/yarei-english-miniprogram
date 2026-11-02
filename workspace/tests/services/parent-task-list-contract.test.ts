import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ServiceResult } from '../../miniprogram/domain/types'
import type { CloudCallContext, CloudFunctionInvoker, FunctionName,
  FunctionRequest } from '../../miniprogram/repositories/cloudbase/protocol'
import { configureRepositories } from '../../miniprogram/repositories/repository-factory'
import { getState, initialState, replaceState } from '../../miniprogram/repositories/memory/mock-state'
import { getParentHome, listParentTasks } from '../../miniprogram/services/app-service'
import { setCurrentChildId } from '../../miniprogram/session/session'

type RecordedCall = { functionName: FunctionName; request: FunctionRequest<string, object>;
  context: CloudCallContext }

class FakeInvoker implements CloudFunctionInvoker {
  public readonly calls: RecordedCall[] = []
  private readonly responses: ServiceResult<unknown>[] = []
  public enqueue<T>(result: ServiceResult<T>): void { this.responses.push(result) }
  public async call<TAction extends string, TPayload extends object, TResult>(
    functionName: FunctionName, request: FunctionRequest<TAction, TPayload>,
    context: CloudCallContext): Promise<ServiceResult<TResult>> {
    this.calls.push({ functionName, request: request as FunctionRequest<string, object>, context })
    const result = this.responses.shift()
    if (!result) throw new Error('Missing fake response')
    return result as ServiceResult<TResult>
  }
}

const success = <T>(data: T): ServiceResult<T> => ({ ok: true, data,
  meta: { requestId: 'req_parent_tasks' } })

describe('G-01/G-03 parent task list contract', () => {
  beforeEach(() => {
    configureRepositories({ mode: 'memory' })
    replaceState(initialState)
    // The fixture uses today's dates; freeze its range explicitly so this contract is not month-dependent.
    const fixture = getState()
    fixture.tasks.forEach(task => { task.startsAt = '2026-10-01T00:00:00.000Z'; task.dueAt = '2026-10-31T08:00:00.000Z' })
    replaceState(fixture)
    setCurrentChildId('usr_student_xiaoyu')
  })
  afterEach(() => configureRepositories({ mode: 'memory' }))

  it('keeps the complete memory list reachable when home has only five previews', async () => {
    const state = getState()
    const seedTask = state.tasks.find(task => task.id === state.assignments.find(
      assignment => assignment.studentId === 'usr_student_xiaoyu')?.taskId)
    const seedAssignment = state.assignments.find(assignment => assignment.studentId === 'usr_student_xiaoyu')
    if (!seedTask || !seedAssignment) throw new Error('Missing fictional parent fixture')
    for (let index = 1; index <= 7; index += 1) {
      const taskId = `task_parent_extra_${index}`
      state.tasks.push({ ...seedTask, id: taskId, title: `虚构任务 ${index}`,
        status: 'active', dueAt: `2026-10-${String(index).padStart(2, '0')}T08:00:00.000Z` })
      state.assignments.push({ ...seedAssignment, id: `asn_parent_extra_${index}`,
        taskId, status: index % 2 === 0 ? 'completed' : 'in_progress' })
    }
    replaceState(state)
    const home = await getParentHome('usr_parent_xiaoyu')
    const first = await listParentTasks('usr_parent_xiaoyu', {
      startsOn: '2026-10-01', endsOn: '2026-10-31',
    }, { limit: 3 })
    expect(home).toMatchObject({ ok: true, data: { tasks: { length: 5 } } })
    expect(first).toMatchObject({ ok: true, data: { total: 8, items: { length: 3 },
      nextCursor: expect.any(String) } })
    if (!first.ok || first.data.nextCursor === null) throw new Error('Missing second page')
    const second = await listParentTasks('usr_parent_xiaoyu', {
      startsOn: '2026-10-01', endsOn: '2026-10-31',
    }, { limit: 10, cursor: first.data.nextCursor })
    expect(second).toMatchObject({ ok: true, data: { items: { length: 5 }, nextCursor: null } })
  })

  it('sends only the active child and filters to the trusted cloud query', async () => {
    const invoker = new FakeInvoker()
    invoker.enqueue(success({ items: [{ taskId: 'task_demo', title: '虚构听力任务',
      status: 'in_progress', startsAt: '2026-10-01T00:00:00.000Z',
      dueAt: '2026-10-03T00:00:00.000Z', submittedAt: null,
      isLate: false, feedbackId: null, score: null }], total: 1, nextCursor: null }))
    configureRepositories({ mode: 'cloudbase', invoker,
      authentication: { signIn: async () => undefined },
      context: () => ({ sessionId: 'session_parent', activeChildId: 'usr_student_xiaoyu' }) })
    const result = await listParentTasks('forged_parent', {
      statusGroup: 'active', startsOn: '2026-10-01', endsOn: '2026-10-31',
    }, { limit: 20 })
    expect(result).toMatchObject({ ok: true, data: { total: 1,
      items: [{ taskId: 'task_demo', score: null }] } })
    expect(invoker.calls).toEqual([{ functionName: 'parent-query',
      request: { apiVersion: 'm1.v1', action: 'listChildTasks', payload: {
        childId: 'usr_student_xiaoyu', filters: { statusGroup: 'active',
          startsOn: '2026-10-01', endsOn: '2026-10-31' }, page: { limit: 20 },
      } }, context: { businessSessionToken: 'session_parent' } }])
    expect(JSON.stringify(invoker.calls)).not.toContain('forged_parent')
  })

  it('uses the bound child legacy query when deployed cloud code rejects date filters', async () => {
    const invoker = new FakeInvoker()
    invoker.enqueue({ ok: false, error: { code: 'VALIDATION_ERROR',
      message: '输入内容不符合要求，请检查后重试。', retryable: false,
      fieldErrors: { 'filters.endsOn': '不支持的字段。' } } })
    invoker.enqueue(success({ items: [
      { taskId: 'old', title: '较早的任务', status: 'completed',
        startsAt: '2026-09-01T00:00:00.000Z', dueAt: '2026-09-02T00:00:00.000Z',
        submittedAt: null, feedbackId: null },
      { taskId: 'active', title: '近期任务', status: 'in_progress',
        startsAt: '2026-10-01T00:00:00.000Z', dueAt: '2026-10-02T00:00:00.000Z',
        submittedAt: null, feedbackId: null },
      { taskId: 'done', title: '近期已完成', status: 'completed',
        startsAt: '2026-10-03T00:00:00.000Z', dueAt: '2026-10-04T00:00:00.000Z',
        submittedAt: null, feedbackId: null },
    ], total: 3, nextCursor: null }))
    configureRepositories({ mode: 'cloudbase', invoker,
      authentication: { signIn: async () => undefined },
      context: () => ({ sessionId: 'session_parent', activeChildId: 'usr_student_xiaoyu' }) })
    const result = await listParentTasks('forged_parent', {
      statusGroup: 'active', startsOn: '2026-10-01', endsOn: '2026-10-31',
    }, { limit: 20 })
    expect(result).toMatchObject({ ok: true, data: { total: 1,
      items: [{ taskId: 'active' }], nextCursor: null } })
    expect(invoker.calls).toHaveLength(2)
    expect(invoker.calls[1]?.request).toMatchObject({ action: 'listChildTasks',
      payload: { childId: 'usr_student_xiaoyu', filters: {}, page: { limit: 100 } } })
  })

  it('keeps the legacy fallback paginated after applying the date filter', async () => {
    const invoker = new FakeInvoker()
    invoker.enqueue({ ok: false, error: { code: 'VALIDATION_ERROR',
      message: '输入内容不符合要求，请检查后重试。', retryable: false,
      fieldErrors: { 'filters.endsOn': '不支持的字段。' } } })
    const rows = [1, 2, 3].map(index => ({ taskId: `task_${index}`, title: `虚构任务 ${index}`,
      status: 'in_progress', startsAt: '2026-10-01T00:00:00.000Z',
      dueAt: `2026-10-0${index}T00:00:00.000Z`, submittedAt: null, feedbackId: null }))
    invoker.enqueue(success({ items: rows, total: 3, nextCursor: null }))
    invoker.enqueue(success({ items: rows, total: 3, nextCursor: null }))
    configureRepositories({ mode: 'cloudbase', invoker,
      authentication: { signIn: async () => undefined },
      context: () => ({ sessionId: 'session_parent', activeChildId: 'usr_student_xiaoyu' }) })
    const filters = { startsOn: '2026-10-01', endsOn: '2026-10-31' }
    const first = await listParentTasks('usr_parent_xiaoyu', filters, { limit: 2 })
    expect(first).toMatchObject({ ok: true, data: { total: 3,
      items: [{ taskId: 'task_1' }, { taskId: 'task_2' }], nextCursor: 'legacy:2' } })
    if (!first.ok || first.data.nextCursor === null) throw new Error('Missing legacy cursor')
    const second = await listParentTasks('usr_parent_xiaoyu', filters,
      { limit: 2, cursor: first.data.nextCursor })
    expect(second).toMatchObject({ ok: true, data: { total: 3,
      items: [{ taskId: 'task_3' }], nextCursor: null } })
    expect(invoker.calls).toHaveLength(3)
    expect(invoker.calls[2]?.request).toMatchObject({ action: 'listChildTasks',
      payload: { filters: {}, page: { limit: 100 } } })
  })
})
