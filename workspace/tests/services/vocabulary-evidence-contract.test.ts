import { afterEach, describe, expect, it } from 'vitest'
import { getPackAttemptSummary, getWordAttemptState, submitWordAnswer } from '../../miniprogram/services/app-service'
import { createCloudAppService } from '../../miniprogram/services/cloudbase-app-service'
import { createCloudRepositoryClient, type CloudFunctionInvoker } from '../../miniprogram/repositories/cloudbase/protocol'
import { configureRepositories } from '../../miniprogram/repositories/repository-factory'

afterEach(() => configureRepositories({ mode: 'memory' }))

describe('M2 vocabulary attempt client contract', () => {
  it('sends the raw spelling and scope through the bound session without actor or correctness fields', async () => {
    const calls: Array<{ functionName: string; action: string; payload: object; token: string | null;
      operationId?: string; expectedVersion?: number }> = []
    const invoker: CloudFunctionInvoker = { async call(functionName, request, context) {
      calls.push({ functionName, action: request.action, payload: request.payload,
        token: context.businessSessionToken, operationId: request.operationId, expectedVersion: request.expectedVersion })
      return request.action === 'getPackAttemptSummary'
        ? { ok: true, data: { packId: 'pack_animals', contentVersion: '1', round: 1,
          words: [{ wordId: 'word_tiger', firstCorrect: null, lastCorrect: null, version: 0 }] } }
        : request.action === 'getWordAttemptState'
        ? { ok: true, data: { wordId: 'word_tiger', firstCorrect: null, version: 0, attempts: [] } }
        : { ok: true, data: { wordId: 'word_tiger', isCorrect: true, firstAttempt: true, attemptNumber: 1 } }
    } }
    const service = createCloudAppService(createCloudRepositoryClient(invoker, () => ({ sessionId: 'session_student_demo' })),
      { async signIn() {} }, () => ({ sessionId: 'session_student_demo' }))
    await service.getWordAttemptState('forged_student', { packId: 'pack_animals', wordId: 'word_tiger',
      taskId: 'task_animals', itemId: 'item_words' })
    await service.getPackAttemptSummary('forged_student', { packId: 'pack_animals',
      taskId: 'task_animals', itemId: 'item_words' })
    await service.submitWordAnswer('forged_student', { packId: 'pack_animals', wordId: 'word_tiger',
      taskId: 'task_animals', itemId: 'item_words', studentInput: 'tiger' }, 0, 'operation_word_client_first')
    expect(calls).toEqual([
      { functionName: 'vocabulary-evidence-query', action: 'getWordAttemptState', payload: {
        packId: 'pack_animals', wordId: 'word_tiger', taskId: 'task_animals', itemId: 'item_words',
      }, token: 'session_student_demo', operationId: undefined, expectedVersion: undefined },
      { functionName: 'vocabulary-evidence-query', action: 'getPackAttemptSummary', payload: {
        packId: 'pack_animals', taskId: 'task_animals', itemId: 'item_words',
      }, token: 'session_student_demo', operationId: undefined, expectedVersion: undefined },
      { functionName: 'vocabulary-evidence-command', action: 'submitWordAnswer', payload: {
        packId: 'pack_animals', wordId: 'word_tiger', taskId: 'task_animals', itemId: 'item_words', studentInput: 'tiger',
      }, token: 'session_student_demo', operationId: 'operation_word_client_first', expectedVersion: 0 },
    ])
  })

  it('does not invent M2 spelling evidence in the memory fallback', async () => {
    configureRepositories({ mode: 'memory' })
    expect(await getWordAttemptState('usr_student_xiaoyu', { packId: 'vocab_animals', wordId: 'word_tiger' }))
      .toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } })
    expect(await getPackAttemptSummary('usr_student_xiaoyu', { packId: 'vocab_animals' }))
      .toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } })
    expect(await submitWordAnswer('usr_student_xiaoyu', { packId: 'vocab_animals', wordId: 'word_tiger',
      studentInput: 'tiger' }, 0, 'operation_word_memory'))
      .toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } })
  })
})
