import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ServiceResult } from '../../miniprogram/domain/types'
import type {
  CloudCallContext,
  CloudFunctionInvoker,
  FunctionName,
  FunctionRequest,
} from '../../miniprogram/repositories/cloudbase/protocol'
import { configureRepositories } from '../../miniprogram/repositories/repository-factory'
import { initialState, replaceState } from '../../miniprogram/repositories/memory/mock-state'
import { getTeacherStudent, listTeacherStudents, updateTeacherStudent } from '../../miniprogram/services/app-service'
import { TEACHER_STUDENT_QUERY_ACTIONS, validateTeacherStudentQueryRequest } from '../../m1-cloudbase/src/contracts/teacher-student-functions'
import { parseFunctionRequest } from '../../m1-cloudbase/src/shared/validation'

interface RecordedCall {
  functionName: FunctionName
  request: FunctionRequest<string, object>
  context: CloudCallContext
}

class FakeInvoker implements CloudFunctionInvoker {
  public readonly calls: RecordedCall[] = []
  private readonly responses: ServiceResult<unknown>[] = []

  public enqueue<T>(response: ServiceResult<T>): void { this.responses.push(response) }

  public async call<TAction extends string, TPayload extends object, TResult>(
    functionName: FunctionName,
    request: FunctionRequest<TAction, TPayload>,
    context: CloudCallContext,
  ): Promise<ServiceResult<TResult>> {
    this.calls.push({ functionName, request: request as FunctionRequest<string, object>, context })
    const response = this.responses.shift()
    if (response === undefined) throw new Error('missing fake response')
    return response as ServiceResult<TResult>
  }
}

const success = <T>(data: T): ServiceResult<T> => ({ ok: true, data, meta: { requestId: 'req_teacher_students' } })

describe('teacher student client contract', () => {
  beforeEach(() => {
    configureRepositories({ mode: 'memory' })
    replaceState(initialState)
  })

  afterEach(() => configureRepositories({ mode: 'memory' }))

  it('keeps the M0 memory repository as a paged fallback with safe detail fields', async () => {
    const first = await listTeacherStudents('usr_teacher_lin', { status: 'all' })
    expect(first).toMatchObject({ ok: true, data: { total: 36, items: { length: 20 }, nextCursor: expect.any(String) } })
    if (!first.ok || first.data.nextCursor === null) throw new Error('expected first page')
    const second = await listTeacherStudents('usr_teacher_lin', { status: 'all' }, first.data.nextCursor)
    expect(second).toMatchObject({ ok: true, data: { items: { length: 16 }, nextCursor: null } })
    const detail = await getTeacherStudent('usr_teacher_lin', 'usr_student_xiaoyu')
    expect(detail).toMatchObject({
      ok: true,
      data: {
        displayName: '小宇', classInfo: { name: '三年级 2 班' },
        parents: [{ displayNameMasked: '小***', mobileMasked: '138****2046' }],
      },
    })
    expect(JSON.stringify(detail)).not.toContain('13800000003')
    expect(await getTeacherStudent('usr_teacher_lin', 'unknown_student')).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
  })

  it('maps list and detail to strict cloud requests without caller identity fields', async () => {
    const invoker = new FakeInvoker()
    invoker.enqueue(success({
      classes: [{ id: 'class_a', name: '三年级 2 班', grade: '三年级', term: '上学期' }],
      items: [], total: 0, nextCursor: null,
    }))
    invoker.enqueue(success({
      studentId: 'student_a', displayName: '小宇', studentNumber: '0321', accountStatus: 'active', needsAttention: false,
      classInfo: { id: 'class_a', name: '三年级 2 班', grade: '三年级', term: '上学期' },
      performance: { assignedCount: 1, completedCount: 1, overdueCount: 0, redoCount: 0, completionRate: 100, averageScore: 86 },
      parents: [], recentTasks: [],
    }))
    configureRepositories({
      mode: 'cloudbase', invoker,
      authentication: { signIn: async () => undefined },
      context: () => ({ sessionId: 'session_teacher' }),
    })

    expect(await listTeacherStudents('forged_teacher', { classId: 'class_a', keyword: '小宇', status: 'normal' })).toMatchObject({ ok: true })
    expect(await getTeacherStudent('forged_teacher', 'student_a')).toMatchObject({ ok: true, data: { studentId: 'student_a' } })
    expect(invoker.calls).toEqual([
      {
        functionName: 'teacher-student-query',
        request: { apiVersion: 'm1.v1', action: 'listStudents', payload: { filters: { classId: 'class_a', keyword: '小宇', status: 'normal' }, page: { limit: 20 } } },
        context: { businessSessionToken: 'session_teacher' },
      },
      {
        functionName: 'teacher-student-query',
        request: { apiVersion: 'm1.v1', action: 'getStudent', payload: { studentId: 'student_a' } },
        context: { businessSessionToken: 'session_teacher' },
      },
    ])
    expect(JSON.stringify(invoker.calls)).not.toContain('forged_teacher')
    for (const call of invoker.calls) {
      const parsed = parseFunctionRequest(call.request, TEACHER_STUDENT_QUERY_ACTIONS)
      expect(parsed.ok).toBe(true)
      if (parsed.ok) expect(validateTeacherStudentQueryRequest(parsed.value).ok).toBe(true)
    }
  })

  it('sends a student edit through the teacher command with versions and a reason', async () => {
    const invoker = new FakeInvoker()
    invoker.enqueue(success({ studentId: 'student_a', displayName: '小宇同学', accountStatus: 'active', classId: 'class_a', userVersion: 3, membershipVersion: 2, classVersion: 4 }))
    configureRepositories({ mode: 'cloudbase', invoker, authentication: { signIn: async () => undefined }, context: () => ({ sessionId: 'session_teacher' }) })
    const result = await updateTeacherStudent('forged_teacher', { studentId: 'student_a', classId: 'class_a', displayName: '小宇同学', expectedUserVersion: 2, expectedMembershipVersion: 2, reason: '教师编辑学员姓名', operationId: 'edit_student_once' })
    expect(result).toMatchObject({ ok: true, data: { displayName: '小宇同学' } })
    expect(invoker.calls).toEqual([{
      functionName: 'teacher-student-command', context: { businessSessionToken: 'session_teacher' },
      request: { apiVersion: 'm1.v1', action: 'updateProfile', operationId: 'edit_student_once', expectedVersion: 2,
        payload: { studentId: 'student_a', classId: 'class_a', displayName: '小宇同学', expectedMembershipVersion: 2, reason: '教师编辑学员姓名' } },
    }])
    expect(JSON.stringify(invoker.calls)).not.toContain('forged_teacher')
  })
})
