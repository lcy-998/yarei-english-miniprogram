import type { MyTaskDubbingPlaybackView, ServiceResult, TaskDubbingWorkView } from '../domain/types'
import { getCloudAppService } from '../repositories/repository-factory'

function unavailable(): ServiceResult<TaskDubbingWorkView> {
  return { ok: false, error: { code: 'SERVICE_UNAVAILABLE',
    message: '任务配音封存服务尚未开放，录音仍保留在本机', retryable: true } }
}

export function beginTaskDubbingWork(userId: string, taskId: string, itemId: string,
  operationId: string): Promise<ServiceResult<TaskDubbingWorkView>> {
  return getCloudAppService()?.beginTaskDubbingWork(userId, taskId, itemId, operationId)
    ?? Promise.resolve(unavailable())
}

export function sealTaskDubbingWork(userId: string, workId: string, stagingFileId: string,
  expectedVersion: number, operationId: string): Promise<ServiceResult<TaskDubbingWorkView>> {
  return getCloudAppService()?.sealTaskDubbingWork(userId, workId, stagingFileId,
    expectedVersion, operationId) ?? Promise.resolve(unavailable())
}

export function getTaskDubbingPlayback(userId: string,
  workId: string): Promise<ServiceResult<MyTaskDubbingPlaybackView>> {
  return getCloudAppService()?.getTaskDubbingPlayback(userId, workId)
    ?? Promise.resolve({ ok: false, error: { code: 'SERVICE_UNAVAILABLE',
      message: '任务配音暂时无法试听，请稍后重试', retryable: true } })
}
