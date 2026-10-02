import { afterEach, describe, expect, it } from 'vitest'
import { getSchoolQuestion, listSchoolQuestionFacets, listSchoolQuestions } from '../../miniprogram/services/app-service'
import { createCloudAppService } from '../../miniprogram/services/cloudbase-app-service'
import { createCloudRepositoryClient, type CloudFunctionInvoker } from '../../miniprogram/repositories/cloudbase/protocol'
import { configureRepositories } from '../../miniprogram/repositories/repository-factory'

afterEach(() => configureRepositories({ mode: 'memory' }))

describe('T-15 school question service boundary', () => {
  it('lists searchable read-only summaries and keeps answers in authorized detail', async () => {
    configureRepositories({ mode: 'memory' })
    const page = await listSchoolQuestions('usr_teacher_lin', { grade: '三年级', unit: 'Unit 3', keyword: 'animal' }, 1, 0)
    expect(page).toMatchObject({ ok: true, data: { items: [{ id: 'res_exercise_bird_demo' }], nextOffset: null } })
    expect(JSON.stringify(page)).not.toContain('correctAnswer')
    expect(JSON.stringify(page)).not.toContain('Birds can fly.')
    expect(await listSchoolQuestionFacets('usr_teacher_lin')).toMatchObject({ ok: true, data: [
      { grade: '三年级', unit: 'Unit 3', questionType: 'single_choice' },
      { grade: '三年级', unit: 'Unit 3', questionType: 'fill' },
    ] })
    expect(await getSchoolQuestion('usr_teacher_lin', 'res_exercise_bird_demo')).toMatchObject({ ok: true, data: { correctAnswer: 'A. bird' } })
    expect(await getSchoolQuestion('usr_parent_xiaoyu', 'res_exercise_bird_demo')).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })
    expect(await listSchoolQuestions('usr_teacher_lin', { targetClassIds: ['cls_other'] }, 20, 0)).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })
  })

  it('sends filters and page without client actor fields through the session bound CloudBase client', async () => {
    const calls: Array<{ functionName: string; action: string; payload: object; token: string | null }> = []
    const invoker: CloudFunctionInvoker = {
      async call(functionName, request, context) {
        calls.push({ functionName, action: request.action, payload: request.payload, token: context.businessSessionToken })
        return request.action === 'listSchoolQuestions'
          ? { ok: true, data: { items: [], nextOffset: null } }
          : request.action === 'listSchoolQuestionFacets'
            ? { ok: true, data: [{ grade: '三年级', questionType: 'single_choice' }] }
          : { ok: true, data: { id: 'res_exercise_bird_demo', stem: 'Which animal can fly?', options: [], correctAnswer: 'A. bird' } }
      },
    }
    const service = createCloudAppService(
      createCloudRepositoryClient(invoker, () => ({ sessionId: 'session_teacher_demo' })),
      { async signIn() {} },
      () => ({ sessionId: 'session_teacher_demo' }),
    )
    await service.listSchoolQuestions('forged_teacher', { grade: '三年级' }, 20, 0)
    await service.listSchoolQuestionFacets('forged_teacher', ['cls_grade3_2'])
    await service.getSchoolQuestion('forged_teacher', 'res_exercise_bird_demo', ['cls_grade3_2'])
    expect(calls).toEqual([
      { functionName: 'content-query', action: 'listSchoolQuestions', payload: { filters: { grade: '三年级' }, page: { limit: 20, offset: 0 } }, token: 'session_teacher_demo' },
      { functionName: 'content-query', action: 'listSchoolQuestionFacets', payload: { targetClassIds: ['cls_grade3_2'] }, token: 'session_teacher_demo' },
      { functionName: 'content-query', action: 'getSchoolQuestion', payload: { resourceId: 'res_exercise_bird_demo', targetClassIds: ['cls_grade3_2'] }, token: 'session_teacher_demo' },
    ])
  })
})
