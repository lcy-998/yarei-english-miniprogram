import { afterEach, describe, expect, it } from 'vitest'
import { getCatalogDraftOptions, getTaskCatalogResource, listTaskCatalogFacets, listTaskCatalogResources } from '../../miniprogram/services/app-service'
import { createCloudAppService } from '../../miniprogram/services/cloudbase-app-service'
import { createCloudRepositoryClient, type CloudFunctionInvoker } from '../../miniprogram/repositories/cloudbase/protocol'
import { configureRepositories } from '../../miniprogram/repositories/repository-factory'

afterEach(() => configureRepositories({ mode: 'memory' }))

describe('T-18 reading and word-pack catalog service', () => {
  it('returns only small authorized summaries in the memory fallback', async () => {
    configureRepositories({ mode: 'memory' })
    const reading = await listTaskCatalogResources('usr_teacher_lin', { type: 'reading', targetClassIds: ['cls_grade3_2'] }, 1, 0)
    expect(reading).toMatchObject({ ok: true, data: { items: [{ id: 'book_zoo', type: 'reading' }], nextOffset: null } })
    expect(JSON.stringify(reading)).not.toContain('imageAssetKey')
    const vocabulary = await listTaskCatalogResources('usr_teacher_lin', { type: 'vocabulary', keyword: '动物' }, 1, 0)
    expect(vocabulary).toMatchObject({ ok: true, data: { items: [{ id: 'vocab_animals', requiredCount: 2 }] } })
    expect(JSON.stringify(vocabulary)).not.toContain('word_animal')
    expect(await listTaskCatalogFacets('usr_teacher_lin', 'vocabulary', ['cls_grade3_2']))
      .toMatchObject({ ok: true, data: [{ source: 'word_pack', textbook: '__unlabeled_textbook__' }] })
    expect(await listTaskCatalogResources('usr_teacher_lin', { type: 'vocabulary',
      source: 'word_pack', textbook: '__unlabeled_textbook__' })).toMatchObject({ ok: true, data: { items: [{ id: 'vocab_animals' }] } })
    expect(await getTaskCatalogResource('usr_teacher_lin', 'vocab_animals', ['cls_grade3_2']))
      .toMatchObject({ ok: true, data: { source: 'word_pack' } })
    expect(await getTaskCatalogResource('usr_parent_xiaoyu', 'vocab_animals'))
      .toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })
    expect(await listTaskCatalogResources('usr_teacher_lin', { type: 'reading', targetClassIds: ['cls_other'] }))
      .toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })
  })

  it('sends paged filters and exact resource checks through the bound session', async () => {
    const calls: Array<{ action: string; payload: object; token: string | null }> = []
    const invoker: CloudFunctionInvoker = { async call(_functionName, request, context) {
      calls.push({ action: request.action, payload: request.payload, token: context.businessSessionToken })
      return request.action === 'listTaskCatalogResources'
        ? { ok: true, data: { items: [], nextOffset: null } }
        : request.action === 'listTaskCatalogFacets' ? { ok: true, data: [] }
        : { ok: true, data: { id: 'book_zoo', type: 'reading', title: '动物绘本', source: 'reading_book',
          grade: '三年级', contentVersion: 'demo-v1', requiredCount: 4 } }
    } }
    const service = createCloudAppService(createCloudRepositoryClient(invoker, () => ({ sessionId: 'session_teacher_demo' })),
      { async signIn() {} }, () => ({ sessionId: 'session_teacher_demo' }))
    await service.listTaskCatalogResources('forged_teacher', { type: 'reading', grade: '三年级', targetClassIds: ['cls_grade3_2'] }, 20, 40)
    await service.listTaskCatalogFacets('forged_teacher', 'reading', ['cls_grade3_2'])
    await service.getTaskCatalogResource('forged_teacher', 'book_zoo', ['cls_grade3_2'])
    expect(calls).toEqual([
      { action: 'listTaskCatalogResources', payload: { filters: { type: 'reading', grade: '三年级', targetClassIds: ['cls_grade3_2'] },
        page: { limit: 20, offset: 40 } }, token: 'session_teacher_demo' },
      { action: 'listTaskCatalogFacets', payload: { type: 'reading', targetClassIds: ['cls_grade3_2'] }, token: 'session_teacher_demo' },
      { action: 'getTaskCatalogResource', payload: { resourceId: 'book_zoo', targetClassIds: ['cls_grade3_2'] },
        token: 'session_teacher_demo' },
    ])
  })

  it('loads only authorized classes when the M2 publish form starts', async () => {
    const calls: Array<{ action: string; payload: object }> = []
    const invoker: CloudFunctionInvoker = { async call(_functionName, request) {
      calls.push({ action: request.action, payload: request.payload })
      return { ok: true, data: { classes: [{ id: 'cls_grade3_2', name: '三年级 2 班' }], resources: [] } }
    } }
    configureRepositories({ mode: 'cloudbase', invoker,
      authentication: { async signIn() {} }, context: () => ({ sessionId: 'session_teacher_demo' }) })
    const result = await getCatalogDraftOptions('usr_teacher_lin', { now: () => new Date('2026-09-26T08:00:00.000Z') })
    expect(result).toMatchObject({ ok: true, data: { availableClasses: [{ id: 'cls_grade3_2' }],
      resources: [], structuredDraft: { items: [] } } })
    expect(calls).toEqual([{ action: 'getDraftOptions', payload: { catalogMode: 'selector' } }])
  })
})
