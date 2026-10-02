import { afterEach, describe, expect, it } from 'vitest'
import { listStudentCatalog, listStudentCatalogFacets } from '../../miniprogram/services/app-service'
import { createCloudAppService } from '../../miniprogram/services/cloudbase-app-service'
import { createCloudRepositoryClient, type CloudFunctionInvoker } from '../../miniprogram/repositories/cloudbase/protocol'
import { configureRepositories } from '../../miniprogram/repositories/repository-factory'

afterEach(() => configureRepositories({ mode: 'memory' }))

describe('S-02 and S-03 student catalog', () => {
  it('returns paged summaries in memory without word or page content', async () => {
    configureRepositories({ mode: 'memory' })
    const vocabulary = await listStudentCatalog('usr_student_xiaoyu', { type: 'vocabulary', textbook: '__unlabeled_textbook__' }, 1, 0)
    expect(vocabulary).toMatchObject({ ok: true, data: { total: 1, items: [{ id: 'vocab_animals', itemCount: 2 }], nextOffset: null } })
    expect(JSON.stringify(vocabulary)).not.toContain('word_animal')
    const facets = await listStudentCatalogFacets('usr_student_xiaoyu', 'reading', 'picture_book')
    expect(facets.ok).toBe(true)
    if (facets.ok) expect(facets.data).toContainEqual({ category: 'picture_book', grade: '三年级', difficulty: '入门', theme: '动物' })
    const reading = await listStudentCatalog('usr_student_xiaoyu', { type: 'reading', category: 'picture_book', keyword: 'Zoo' }, 1, 0)
    expect(reading).toMatchObject({ ok: true, data: { total: 1, items: [{ id: 'book_zoo' }] } })
    expect(JSON.stringify(reading)).not.toContain('imageUrl')
  })

  it('sends student filters and pages through the bound cloud session', async () => {
    const calls: Array<{ action: string; payload: object; token: string | null }> = []
    const invoker: CloudFunctionInvoker = { async call(_functionName, request, context) {
      calls.push({ action: request.action, payload: request.payload, token: context.businessSessionToken })
      return request.action === 'listStudentCatalog'
        ? { ok: true, data: { items: [], total: 0, nextOffset: null } }
        : { ok: true, data: [] }
    } }
    const service = createCloudAppService(createCloudRepositoryClient(invoker, () => ({ sessionId: 'session_student_demo' })),
      { async signIn() {} }, () => ({ sessionId: 'session_student_demo' }))
    await service.listStudentCatalog('forged_student', { type: 'reading', category: 'picture_book', theme: '动物' }, 20, 40)
    await service.listStudentCatalogFacets('forged_student', 'reading', 'picture_book')
    expect(calls).toEqual([
      { action: 'listStudentCatalog', payload: { filters: { type: 'reading', category: 'picture_book', theme: '动物' },
        page: { limit: 20, offset: 40 } }, token: 'session_student_demo' },
      { action: 'listStudentCatalogFacets', payload: { type: 'reading', category: 'picture_book' }, token: 'session_student_demo' },
    ])
  })
})
