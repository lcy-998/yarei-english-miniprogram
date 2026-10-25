import type { ServiceResult } from '../../../domain/types'
import { getCloudAppService } from '../../../repositories/repository-factory'
import type { ParentPronunciationEvidencePage } from '../../../services/cloudbase-app-service'

export interface ParentPronunciationRequest {
  studentId: string
  taskId: string
  assignmentId: string
  submissionVersion: number
  itemId: string
}

export async function listParentPronunciationEvidence(userId: string,
  request: ParentPronunciationRequest): Promise<ServiceResult<ParentPronunciationEvidencePage>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.listParentPronunciationEvidence(userId, request)
    : { ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: '当前环境尚未开放跟读结果读取', retryable: false } }
}
