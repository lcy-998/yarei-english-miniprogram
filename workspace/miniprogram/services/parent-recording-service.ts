import type { ParentRecordingPlaybackView, ServiceResult } from '../domain/types'
import { getCloudAppService } from '../repositories/repository-factory'

export interface ParentRecordingRequest {
  childId: string
  taskId: string
  assignmentId: string
  submissionVersion: number
  itemId: string
}

export async function getParentRecordingPlayback(userId: string,
  request: ParentRecordingRequest): Promise<ServiceResult<ParentRecordingPlaybackView>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.getParentRecordingPlayback(userId, request)
    : { ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: '当前环境尚未开放录音试听', retryable: false } }
}
