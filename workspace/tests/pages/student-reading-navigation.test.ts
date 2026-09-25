import { afterEach, describe, expect, it, vi } from 'vitest'
import { getCurrentBookId, setCurrentBookId } from '../../miniprogram/session/session'

describe('student task reading entry', () => {
  afterEach(() => { vi.unstubAllGlobals(); setCurrentBookId('') })

  it('preserves the task resource when the reader page options arrive late', async () => {
    let openReading: ((event: WechatMiniprogram.TouchEvent) => void) | null = null
    vi.stubGlobal('Component', (definition: { methods: { openReading: (event: WechatMiniprogram.TouchEvent) => void } }) => {
      openReading = definition.methods.openReading
    })
    const navigateTo = vi.fn()
    vi.stubGlobal('wx', { navigateTo })
    await import('../../miniprogram/pages/student/task-detail/task-detail')
    const context = { data: { detail: { task: { id: 'task_demo', items: [{
      id: 'item_reading', resourceId: 'res_reading_zoo_cloud_v2', completionRuleData: { kind: 'reading_pages', requiredPageCount: 2 },
    }] } } } }
    const event = { currentTarget: { dataset: { id: 'item_reading' } } } as unknown as WechatMiniprogram.TouchEvent
    if (openReading === null) throw new Error('Reading handler was not registered')
    openReading.call(context, event)
    expect(getCurrentBookId()).toBe('res_reading_zoo_cloud_v2')
    expect(navigateTo).toHaveBeenCalledWith({ url: '/pages/student/reading-detail/reading-detail?bookId=res_reading_zoo_cloud_v2&taskId=task_demo&requiredPageCount=2' })
  })
})
