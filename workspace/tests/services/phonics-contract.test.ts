import { afterEach, describe, expect, it } from 'vitest'
import { getPhonicsAudio, getPhonicsCourse, getPhonicsState, listPhonicsCourses, submitPhonicsAnswer } from '../../miniprogram/services/app-service'
import { createCloudAppService } from '../../miniprogram/services/cloudbase-app-service'
import { createCloudRepositoryClient, type CloudFunctionInvoker } from '../../miniprogram/repositories/cloudbase/protocol'
import { configureRepositories } from '../../miniprogram/repositories/repository-factory'

afterEach(() => configureRepositories({ mode: 'memory' }))

describe('M2 phonics client contract', () => {
  it('uses the bound session and sends only course, question and option ids', async () => {
    const calls: Array<{ name: string; action: string; payload: object; token: string | null;
      expectedVersion?: number; operationId?: string }> = []
    const invoker: CloudFunctionInvoker = { async call(name, request, context) {
      calls.push({ name, action: request.action, payload: request.payload,
        token: context.businessSessionToken, expectedVersion: request.expectedVersion,
        operationId: request.operationId })
      return { ok: true, data: request.action === 'listCourses' ? [] : {} }
    } }
    const service = createCloudAppService(createCloudRepositoryClient(invoker, () => ({ sessionId: 'session_phonics' })),
      { async signIn() {} }, () => ({ sessionId: 'session_phonics' }))
    await service.listPhonicsCourses('forged_student')
    await service.getPhonicsCourse('forged_student', 'course_short_a')
    await service.getPhonicsState('forged_student', 'course_short_a')
    await service.getPhonicsAudio('forged_student', 'course_short_a', 'phoneme_a')
    await service.submitPhonicsAnswer('forged_student', { courseId: 'course_short_a',
      questionId: 'question_cat', selectedOptionId: 'map', round: 1 }, 0, 'operation_phonics_client')
    expect(calls).toEqual([
      { name: 'phonics-query', action: 'listCourses', payload: {}, token: 'session_phonics',
        expectedVersion: undefined, operationId: undefined },
      { name: 'phonics-query', action: 'getCourse', payload: { courseId: 'course_short_a' },
        token: 'session_phonics', expectedVersion: undefined, operationId: undefined },
      { name: 'phonics-query', action: 'getState', payload: { courseId: 'course_short_a' },
        token: 'session_phonics', expectedVersion: undefined, operationId: undefined },
      { name: 'phonics-query', action: 'getAudio', payload: { courseId: 'course_short_a', phonemeId: 'phoneme_a' },
        token: 'session_phonics', expectedVersion: undefined, operationId: undefined },
      { name: 'phonics-command', action: 'submitAnswer', payload: { courseId: 'course_short_a',
        questionId: 'question_cat', selectedOptionId: 'map', round: 1 }, token: 'session_phonics',
        expectedVersion: 0, operationId: 'operation_phonics_client' },
    ])
  })

  it('does not invent progress in memory mode', async () => {
    configureRepositories({ mode: 'memory' })
    expect(await listPhonicsCourses('student_demo')).toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } })
    expect(await getPhonicsCourse('student_demo', 'course_short_a')).toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } })
    expect(await getPhonicsState('student_demo', 'course_short_a')).toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } })
    expect(await getPhonicsAudio('student_demo', 'course_short_a', 'phoneme_a')).toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } })
    expect(await submitPhonicsAnswer('student_demo', { courseId: 'course_short_a', questionId: 'question_cat',
      selectedOptionId: 'map', round: 1 }, 0, 'operation_phonics_memory'))
      .toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } })
  })
})
