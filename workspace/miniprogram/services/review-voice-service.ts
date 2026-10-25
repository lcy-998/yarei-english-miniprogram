import type { ReviewVoiceDraftView, ServiceResult } from '../domain/types'
import { getCloudAppService } from '../repositories/repository-factory'

function unavailable(): ServiceResult<ReviewVoiceDraftView> {
  return { ok: false, error: { code: 'SERVICE_UNAVAILABLE',
    message: '语音评语需要可信封存服务，当前尚未开放', retryable: false } }
}

export async function beginReviewVoiceRecording(userId: string, submissionId: string,
  operationId: string): Promise<ServiceResult<ReviewVoiceDraftView>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.beginReviewVoiceRecording(userId, submissionId, operationId) : unavailable()
}

export async function sealReviewVoiceRecording(userId: string, recordingId: string, stagingFileId: string,
  expectedVersion: number, operationId: string): Promise<ServiceResult<ReviewVoiceDraftView>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.sealReviewVoiceRecording(userId, recordingId, stagingFileId,
    expectedVersion, operationId) : unavailable()
}
