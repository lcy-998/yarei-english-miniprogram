import { describe, expect, it } from 'vitest'

import { createCloudBaseM1AppRepository } from '../../miniprogram/repositories/cloudbase/cloudbase-m1-app-repository'
import type { M1FunctionName, M1FunctionRequest } from '../../miniprogram/repositories/cloudbase/cloud-function-invoker'

const meta = { requestId: 'req_reading', serverTime: '2026-09-23T08:00:00.000Z', apiVersion: 'm1.v1' as const }

const readingResource = {
  id: 'res_reading_zoo_cloud_v2', title: 'A Day at the Zoo', category: 'picture_book', grade: '三年级', difficulty: '基础', contentVersion: 1,
  chapters: [{
    id: 'chapter_zoo_cloud_01', title: 'At the Zoo', order: 1,
    pages: [{ id: 'page_zoo_cloud_01', pageNumber: 1, order: 1, thumbnailAssetKey: 'demo/thumb', imageAssetKey: 'demo/image', width: 1200, height: 1600, assetVersion: '1' }],
  }],
}

describe('CloudBase M1 reading repository', () => {
  it('keeps real categories, favorite state, and saved progress in the reading list', async () => {
    const resources = [readingResource, { ...readingResource, id: 'res_original', category: 'original', title: 'Nature Walk' }]
    const repository = createCloudBaseM1AppRepository({ invoker: { async invoke(_functionName, request) {
      if (request.action === 'listReadingResources') return { ok: true, data: resources, meta }
      if (request.action === 'getReadingResource') return { ok: true, data: resources.find(item => item.id === request.payload.resourceId), meta }
      if (request.action === 'getReadingProgress') return { ok: true, data: request.payload.resourceId === readingResource.id
        ? { resourceId: readingResource.id, chapterId: 'chapter_zoo_cloud_01', pageId: 'page_zoo_cloud_01', pageNumber: 1, favorite: true, version: 1 }
        : null, meta }
      throw new Error(`Unexpected ${request.action}`)
    } } })
    expect(await repository.listReadingBooks('student', 'picture', true)).toMatchObject({ ok: true, data: [{ id: readingResource.id, favorite: true, progressPercent: 100 }] })
    expect(await repository.listReadingBooks('student', 'original')).toMatchObject({ ok: true, data: [{ id: 'res_original', category: 'original', favorite: false, progressPercent: 0 }] })
  })

  it('changes the visible page image together with the saved page number', async () => {
    const resource = { ...readingResource, chapters: [{ ...readingResource.chapters[0], pages: [
      { id: 'page_1', pageNumber: 1, thumbnailAssetKey: 'demo/page-01-thumbnail', imageAssetKey: 'demo/page-01-image' },
      { id: 'page_2', pageNumber: 2, thumbnailAssetKey: 'demo/page-02-thumbnail', imageAssetKey: 'demo/page-02-image' },
    ] }] }
    const repository = createCloudBaseM1AppRepository({ invoker: { async invoke(_functionName, request) {
      if (request.action === 'getReadingResource') return { ok: true, data: resource, meta }
      if (request.action === 'getReadingProgress') return { ok: true, data: null, meta }
      if (request.action === 'saveReadingProgress') return { ok: true, data: { resourceId: resource.id, chapterId: 'chapter_zoo_cloud_01', pageId: 'page_2', pageNumber: 2, favorite: false, version: 1 }, meta }
      throw new Error(`Unexpected ${request.action}`)
    } } })
    const first = await repository.getReadingProgress('student', resource.id)
    expect(first).toMatchObject({ ok: true, data: { pageNumber: 1, pageImageUrl: '/assets/content/demo-zoo-picture-book-cover-v1.jpg' } })
    const second = await repository.setReadingPage('student', resource.id, 2)
    expect(second).toMatchObject({ ok: true, data: { pageNumber: 2, pageImageUrl: '/assets/content/demo-zoo-page-02-v1.jpg' } })
  })

  it('maps the deployed vocabulary word shape into three selectable meanings', async () => {
    const repository = createCloudBaseM1AppRepository({
      invoker: {
        async invoke(functionName, request) {
          expect(functionName).toBe('content-query')
          expect(request).toMatchObject({ action: 'getVocabularyPack', payload: { resourceId: 'res_vocabulary_animals_cloud_v1' } })
          return {
            ok: true,
            data: {
              id: 'res_vocabulary_animals_cloud_v1', title: 'Animals Word Pack', grade: '三年级', contentVersion: '1',
              words: [{ id: 'word_animal', word: 'animal', meaning: '动物', example: 'An animal.', syllables: ['an', 'i', 'mal'] }],
            },
            meta,
          }
        },
      },
    })

    await expect(repository.getWordPractice('forged_student')).resolves.toMatchObject({
      ok: true,
      data: { syllables: 'an-i-mal', correctOption: '动物', options: ['动物', '动物园', '雨天'] },
    })
  })

  it('uses the deployed reading-resource and progress contracts without client identity fields', async () => {
    const calls: Array<Readonly<{ functionName: M1FunctionName; request: M1FunctionRequest }>> = []
    const responses: unknown[] = [
      { ok: true, data: readingResource, meta },
      { ok: true, data: null, meta },
      { ok: true, data: { id: 'progress_1', resourceId: readingResource.id, chapterId: 'chapter_zoo_cloud_01', pageId: 'page_zoo_cloud_01', pageNumber: 1, favorite: false, version: 1, updatedAt: '2026-09-23T08:00:00.000Z' }, meta },
      { ok: true, data: { id: 'progress_1', resourceId: readingResource.id, chapterId: 'chapter_zoo_cloud_01', pageId: 'page_zoo_cloud_01', pageNumber: 1, favorite: true, version: 2, updatedAt: '2026-09-23T08:00:01.000Z' }, meta },
    ]
    const repository = createCloudBaseM1AppRepository({
      invoker: {
        async invoke(functionName, request) {
          calls.push({ functionName, request })
          const response = responses.shift()
          if (response === undefined) throw new Error('缺少测试响应')
          return response
        },
      },
    })

    expect(await repository.getReadingProgress('forged_student_id', readingResource.id)).toMatchObject({
      ok: true, data: { pageNumber: 1, pageImageUrl: '/assets/content/demo-zoo-page-02-v1.jpg', book: { favorite: false } },
    })
    expect(await repository.setReadingPage('forged_student_id', readingResource.id, 1)).toMatchObject({ ok: true, data: { pageNumber: 1 } })
    expect(await repository.toggleReadingFavorite('forged_student_id', readingResource.id)).toMatchObject({ ok: true, data: { favorite: true } })

    expect(calls).toEqual([
      { functionName: 'content-query', request: { apiVersion: 'm1.v1', action: 'getReadingResource', payload: { resourceId: readingResource.id } } },
      { functionName: 'learning-progress-query', request: { apiVersion: 'm1.v1', action: 'getReadingProgress', payload: { resourceId: readingResource.id } } },
      { functionName: 'learning-progress-command', request: {
        apiVersion: 'm1.v1', action: 'saveReadingProgress',
        payload: { resourceId: readingResource.id, chapterId: 'chapter_zoo_cloud_01', pageId: 'page_zoo_cloud_01', pageNumber: 1, favorite: false },
        operationId: `reading_page_${readingResource.id}_1_0`, expectedVersion: 0,
      } },
      { functionName: 'learning-progress-command', request: {
        apiVersion: 'm1.v1', action: 'saveReadingProgress',
        payload: { resourceId: readingResource.id, chapterId: 'chapter_zoo_cloud_01', pageId: 'page_zoo_cloud_01', pageNumber: 1, favorite: true },
        operationId: `reading_favorite_${readingResource.id}_on_1`, expectedVersion: 1,
      } },
    ])
    expect(JSON.stringify(calls)).not.toContain('forged_student_id')
  })
})
