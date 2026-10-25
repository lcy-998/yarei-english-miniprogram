import type { ParentTaskMediaPlaybackView, ServiceResult } from '../domain/types'
import { getCloudAppService } from '../repositories/repository-factory'

export interface ParentTaskMediaRequest {
  childId: string
  taskId: string
  assignmentId: string
  submissionVersion: number
  itemId: string
}

export async function getParentTaskMediaPlayback(userId: string,
  request: ParentTaskMediaRequest): Promise<ServiceResult<ParentTaskMediaPlaybackView>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.getParentTaskMediaPlayback(userId, request)
    : { ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: '当前环境尚未开放媒体任务回看', retryable: false } }
}
