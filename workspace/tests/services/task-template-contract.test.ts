import { afterEach, describe, expect, it } from 'vitest'
import { copyTaskTemplate, getTaskTemplate, instantiateTaskTemplate, listTaskTemplates, removeTaskTemplate, renameTaskTemplate, saveTaskTemplate, useTaskTemplate } from '../../miniprogram/services/app-service'
import { createCloudAppService } from '../../miniprogram/services/cloudbase-app-service'
import { createCloudRepositoryClient, type CloudFunctionInvoker } from '../../miniprogram/repositories/cloudbase/protocol'
import { configureRepositories } from '../../miniprogram/repositories/repository-factory'

afterEach(() => configureRepositories({ mode: 'memory' }))

describe('M2 task template client contract', () => {
  it('uses the bound teacher session without sending actor, targets or task dates', async () => {
    const calls: Array<{ name: string; action: string; payload: object; token: string | null;
      operationId?: string; expectedVersion?: number }> = []
    const invoker: CloudFunctionInvoker = { async call(name, request, context) {
      calls.push({ name, action: request.action, payload: request.payload,
        token: context.businessSessionToken, operationId: request.operationId,
        expectedVersion: request.expectedVersion })
      return { ok: true, data: request.action === 'listTemplates' ? []
        : request.action === 'instantiateTemplate' ? { taskId: 'task_from_template_demo', status: 'draft', version: 1, templateVersion: 2 }
          : { id: 'template_demo' } }
    } }
    const service = createCloudAppService(createCloudRepositoryClient(invoker, () => ({ sessionId: 'session_teacher_template' })),
      { async signIn() {} }, () => ({ sessionId: 'session_teacher_template' }))
    const input = { title: '阅读模板', description: '完成一页', itemRefs: [{ id: 'item_reading',
      resourceId: 'resource_reading', completionRule: { kind: 'reading_pages', requiredPageCount: 1 },
      scoringRule: { kind: 'manual', maxScore: 100 }, order: 1 }] }
    await service.listTaskTemplates('forged_teacher')
    await service.getTaskTemplate('forged_teacher', 'template_demo')
    await service.saveTaskTemplate('forged_teacher', input, 0, 'operation_template_client_save')
    await service.renameTaskTemplate('forged_teacher', 'template_demo', '新标题', 1, 'operation_template_client_rename')
    await service.copyTaskTemplate('forged_teacher', 'template_demo', '副本', 1, 'operation_template_client_copy')
    await service.useTaskTemplate('forged_teacher', 'template_demo', 1, 'operation_template_client_use')
    await service.instantiateTaskTemplate('forged_teacher', 'template_demo', 1, 'operation_template_client_instantiate')
    await service.removeTaskTemplate('forged_teacher', 'template_demo', 1, 'operation_template_client_remove')
    expect(calls).toEqual([
      { name: 'task-template-query', action: 'listTemplates', payload: {}, token: 'session_teacher_template', operationId: undefined, expectedVersion: undefined },
      { name: 'task-template-query', action: 'getTemplate', payload: { templateId: 'template_demo' }, token: 'session_teacher_template', operationId: undefined, expectedVersion: undefined },
      { name: 'task-template-command', action: 'saveTemplate', payload: input, token: 'session_teacher_template', operationId: 'operation_template_client_save', expectedVersion: 0 },
      { name: 'task-template-command', action: 'renameTemplate', payload: { templateId: 'template_demo', title: '新标题' }, token: 'session_teacher_template', operationId: 'operation_template_client_rename', expectedVersion: 1 },
      { name: 'task-template-command', action: 'copyTemplate', payload: { templateId: 'template_demo', title: '副本' }, token: 'session_teacher_template', operationId: 'operation_template_client_copy', expectedVersion: 1 },
      { name: 'task-template-command', action: 'useTemplate', payload: { templateId: 'template_demo' }, token: 'session_teacher_template', operationId: 'operation_template_client_use', expectedVersion: 1 },
      { name: 'task-command', action: 'instantiateTemplate', payload: { templateId: 'template_demo' }, token: 'session_teacher_template', operationId: 'operation_template_client_instantiate', expectedVersion: 1 },
      { name: 'task-template-command', action: 'removeTemplate', payload: { templateId: 'template_demo' }, token: 'session_teacher_template', operationId: 'operation_template_client_remove', expectedVersion: 1 },
    ])
  })
  it('does not claim template writes succeeded in memory mode', async () => {
    configureRepositories({ mode: 'memory' })
    expect(await listTaskTemplates('teacher_demo')).toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } })
    expect(await getTaskTemplate('teacher_demo', 'template_demo')).toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } })
    expect(await saveTaskTemplate('teacher_demo', { title: '模板', description: '', itemRefs: [] }, 0, 'operation_template_memory'))
      .toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } })
    expect(await renameTaskTemplate('teacher_demo', 'template_demo', '新标题', 1, 'operation_template_memory_rename'))
      .toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } })
    expect(await copyTaskTemplate('teacher_demo', 'template_demo', '副本', 1, 'operation_template_memory_copy'))
      .toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } })
    expect(await useTaskTemplate('teacher_demo', 'template_demo', 1, 'operation_template_memory_use'))
      .toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } })
    expect(await instantiateTaskTemplate('teacher_demo', 'template_demo', 1, 'operation_template_memory_instantiate'))
      .toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } })
    expect(await removeTaskTemplate('teacher_demo', 'template_demo', 1, 'operation_template_memory_remove'))
      .toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } })
  })
})
