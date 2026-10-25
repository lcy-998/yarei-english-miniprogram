import { describe, expect, it } from 'vitest'
import { templateItemRefsFromDraft } from '../../miniprogram/subpackages/teacher/publish-task/template-item-refs'

describe('T-06 save-as-template item rules', () => {
  it('preserves selected reading pages, recording upload and explicit weights', () => {
    const source = [
      { id: 'read', resourceId: 'book_demo', type: 'reading' as const, requiredCount: 2,
        pageIds: ['page_2', 'page_3'], maxScore: 100, weightPercent: 25 },
      { id: 'record', resourceId: 'prompt_demo', type: 'recording' as const, requiredCount: 1,
        maxScore: 100, weightPercent: 75 },
    ]
    const refs = templateItemRefsFromDraft(source)
    expect(refs).toMatchObject([
      { id: 'read', completionRule: { kind: 'reading_pages', requiredPageCount: 2,
        pageIds: ['page_2', 'page_3'] }, scoringRule: { weightPercent: 25 }, order: 1 },
      { id: 'record', completionRule: { kind: 'recording_upload' },
        scoringRule: { kind: 'manual', weightPercent: 75 }, order: 2 },
    ])
    source[0]!.pageIds.push('page_4')
    expect(refs[0]?.completionRule).toMatchObject({ pageIds: ['page_2', 'page_3'] })
  })

  it('lets the server freeze media completion rules from the current asset version', () => {
    const refs = templateItemRefsFromDraft([{ id: 'video', resourceId: 'video_real',
      type: 'video', requiredCount: 1, maxScore: 100, scoringKind: 'completion_only' }])
    expect(refs[0]).toMatchObject({ resourceId: 'video_real', scoringRule: { kind: 'completion_only' } })
    expect(refs[0]).not.toHaveProperty('completionRule')
  })
})
