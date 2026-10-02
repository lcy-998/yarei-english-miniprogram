import { afterEach, describe, expect, it, vi } from 'vitest'
import { takeTeacherTemplateSeed } from '../../miniprogram/session/session'

vi.mock('../../miniprogram/services/app-service', () => ({
  instantiateTaskTemplate: vi.fn(async () => ({ ok: true, data: {
    taskId: 'task_from_template_demo', version: 1, templateVersion: 2,
  } })),
}))

describe('teacher template use navigation', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    takeTeacherTemplateSeed()
  })

  it('opens T-06 with the server-created frozen draft, without passing template content', async () => {
    let useTemplate: ((event: WechatMiniprogram.TouchEvent) => Promise<void>) | null = null
    vi.stubGlobal('Component', (definition: { methods: { useTemplate: (event: WechatMiniprogram.TouchEvent) => Promise<void> } }) => {
      useTemplate = definition.methods.useTemplate
    })
    const navigateTo = vi.fn()
    vi.stubGlobal('wx', { getStorageSync: () => ({ user: { id: 'teacher_demo' } }), navigateTo })
    await import('../../miniprogram/pages/teacher/task-templates/task-templates')
    if (useTemplate === null) throw new Error('Template handler was not registered')
    const context = {
      data: { templates: [{ id: 'template_personal_demo', version: 1, title: '虚构阅读模板' }], busyId: '', intents: {} },
      setData(change: Record<string, unknown>) { Object.assign(this.data, change) },
    }
    const event = { currentTarget: { dataset: { id: 'template_personal_demo' } } } as unknown as WechatMiniprogram.TouchEvent
    await useTemplate.call(context, event)
    expect(navigateTo).toHaveBeenCalledWith({
      url: '/pages/teacher/publish-task/publish-task?editTaskId=task_from_template_demo',
    })
    expect(takeTeacherTemplateSeed()).toBeNull()
  })
})
