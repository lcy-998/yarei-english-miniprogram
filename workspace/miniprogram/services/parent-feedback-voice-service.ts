import type { ParentFeedbackVoicePlaybackView, ServiceResult } from '../domain/types'
import { getCloudAppService } from '../repositories/repository-factory'

export interface ParentFeedbackVoiceRequest {
  childId: string
  taskId: string
  assignmentId: string
  submissionVersion: number
  feedbackId: string
}

export async function getParentFeedbackVoicePlayback(userId: string,
  request: ParentFeedbackVoiceRequest): Promise<ServiceResult<ParentFeedbackVoicePlaybackView>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.getParentFeedbackVoicePlayback(userId, request)
    : { ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: '当前环境尚未开放语音评语试听', retryable: false } }
}
