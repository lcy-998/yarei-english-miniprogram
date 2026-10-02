import { afterEach, describe, expect, it } from 'vitest'
import { beginWorkDraft, deleteWorkDraft, getMaterialPlayback, getWorkPlayback, listMyWorks, listWorkMaterials, submitWork } from '../../miniprogram/services/app-service'
import { createCloudAppService } from '../../miniprogram/services/cloudbase-app-service'
import { createCloudRepositoryClient, type CloudFunctionInvoker } from '../../miniprogram/repositories/cloudbase/protocol'
import { configureRepositories } from '../../miniprogram/repositories/repository-factory'

afterEach(() => configureRepositories({ mode: 'memory' }))

describe('M2 student work client contract', () => {
  it('uses the bound business session and sends only material, file and operation fields', async () => {
    const calls: Array<{ name: string; action: string; payload: object; token: string | null;
      operationId?: string; expectedVersion?: number }> = []
    const invoker: CloudFunctionInvoker = { async call(name, request, context) {
      calls.push({ name, action: request.action, payload: request.payload, token: context.businessSessionToken,
        operationId: request.operationId, expectedVersion: request.expectedVersion })
      return { ok: true, data: request.action === 'getMaterialPlayback'
        ? { materialId: 'material_animals', temporaryUrl: 'https://example.test/material.mp4', expiresAt: '2026-09-27T09:01:00+08:00' }
        : request.action === 'getPlayback'
        ? { workId: 'work_demo', temporaryUrl: 'https://example.test/work.mp3', expiresAt: '2026-09-27T09:01:00+08:00' }
        : request.action === 'listMaterials' || request.action === 'listMine' ? []
        : { id: 'work_demo', status: request.action === 'beginDraft' ? 'draft' : 'submitted', version: 1 } }
    } }
    const service = createCloudAppService(createCloudRepositoryClient(invoker, () => ({ sessionId: 'session_student_work' })),
      { async signIn() {} }, () => ({ sessionId: 'session_student_work' }))
    await service.listWorkMaterials('forged_student')
    await service.getMaterialPlayback('forged_student', 'material_animals')
    await service.beginWorkDraft('forged_student', 'material_animals', 'operation_work_begin_client')
    await service.submitWork('forged_student', { workId: 'work_demo', stagingFileId: 'cloud://demo/staging/work.mp3',
      note: '虚构作品' }, 1, 'operation_work_submit_client')
    await service.deleteWorkDraft('forged_student', 'work_draft_demo', 1, 'operation_work_delete_client')
    await service.listMyWorks('forged_student')
    await service.getWorkPlayback('forged_student', 'work_demo')
    expect(calls).toEqual([
      { name: 'student-work-query', action: 'listMaterials', payload: {}, token: 'session_student_work',
        operationId: undefined, expectedVersion: undefined },
      { name: 'student-work-query', action: 'getMaterialPlayback', payload: { materialId: 'material_animals' },
        token: 'session_student_work', operationId: undefined, expectedVersion: undefined },
      { name: 'student-work-command', action: 'beginDraft', payload: { materialId: 'material_animals' },
        token: 'session_student_work', operationId: 'operation_work_begin_client', expectedVersion: 0 },
      { name: 'student-work-command', action: 'submitWork', payload: { workId: 'work_demo',
        stagingFileId: 'cloud://demo/staging/work.mp3', note: '虚构作品' }, token: 'session_student_work',
        operationId: 'operation_work_submit_client', expectedVersion: 1 },
      { name: 'student-work-command', action: 'deleteDraft', payload: { workId: 'work_draft_demo' },
        token: 'session_student_work', operationId: 'operation_work_delete_client', expectedVersion: 1 },
      { name: 'student-work-query', action: 'listMine', payload: {}, token: 'session_student_work',
        operationId: undefined, expectedVersion: undefined },
      { name: 'student-work-query', action: 'getPlayback', payload: { workId: 'work_demo' },
        token: 'session_student_work', operationId: undefined, expectedVersion: undefined },
    ])
  })

  it('does not create fictitious verified works in memory mode', async () => {
    configureRepositories({ mode: 'memory' })
    expect(await listWorkMaterials('student_demo')).toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } })
    expect(await getMaterialPlayback('student_demo', 'material_demo'))
      .toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } })
    expect(await beginWorkDraft('student_demo', 'material_demo', 'operation_work_memory'))
      .toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } })
    expect(await submitWork('student_demo', { workId: 'work_demo', stagingFileId: 'cloud://demo/path.mp3', note: '' },
      1, 'operation_work_memory_submit')).toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } })
    expect(await deleteWorkDraft('student_demo', 'work_draft_demo', 1, 'operation_work_memory_delete'))
      .toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } })
    expect(await listMyWorks('student_demo')).toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } })
    expect(await getWorkPlayback('student_demo', 'work_demo'))
      .toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } })
  })
})
