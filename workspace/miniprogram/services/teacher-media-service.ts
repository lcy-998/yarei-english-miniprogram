import type { ServiceResult } from '../domain/types'
import type { TeacherAssetFacet, TeacherAssetFilters, TeacherAssetPage, TeacherAssetPreview,
  TeacherTaskMediaReviewEvidenceView } from '../domain/teacher-media'
import { getCloudAppService } from '../repositories/repository-factory'

export async function listTeacherAssets(userId: string, filters: TeacherAssetFilters,
  limit = 20, offset = 0): Promise<ServiceResult<TeacherAssetPage>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.listTeacherAssets(userId, filters, limit, offset)
    : { ok: false, error: { code: 'SERVICE_UNAVAILABLE',
      message: '后台资产目录需要当前授权的云端服务，暂未开放', retryable: false } }
}

export async function listTeacherAssetFacets(userId: string, kind: TeacherAssetFilters['kind'],
  targetClassIds?: string[]): Promise<ServiceResult<TeacherAssetFacet[]>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.listTeacherAssetFacets(userId, kind, targetClassIds)
    : { ok: false, error: { code: 'SERVICE_UNAVAILABLE',
      message: '后台音视频筛选条件需要当前授权的云端服务', retryable: false } }
}

export async function previewTeacherAsset(userId: string, resourceId: string,
  targetClassIds?: string[]): Promise<ServiceResult<TeacherAssetPreview>> {
  const cloud = getCloudAppService()
  if (!cloud) return { ok: false, error: { code: 'SERVICE_UNAVAILABLE',
    message: '后台资产预览需要当前授权的云端服务，暂未开放', retryable: false } }
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      cloud.previewTeacherAsset(userId, resourceId, targetClassIds),
      new Promise<ServiceResult<TeacherAssetPreview>>(resolve => {
        timer = setTimeout(() => resolve({ ok: false, error: { code: 'NETWORK_ERROR',
          message: '素材预览加载超时，请检查网络后重试', retryable: true } }), 20000)
      }),
    ])
  } catch {
    return { ok: false, error: { code: 'NETWORK_ERROR',
      message: '素材预览加载失败，请检查网络后重试', retryable: true } }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function getTeacherTaskMediaReviewEvidence(userId: string,
  submissionId: string, itemId: string): Promise<ServiceResult<TeacherTaskMediaReviewEvidenceView>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.getTeacherTaskMediaReviewEvidence(userId, submissionId, itemId)
    : { ok: false, error: { code: 'SERVICE_UNAVAILABLE',
      message: '媒体证据需要当前授权的云端服务，暂未开放', retryable: false } }
}
