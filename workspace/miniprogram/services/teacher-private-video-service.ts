import type { ServiceResult } from '../domain/types'
import type { TeacherPrivateVideo, TeacherPrivateVideoDetail,
  TeacherVideoQuestion } from '../domain/teacher-private-video'
import { getCloudAppService } from '../repositories/repository-factory'

function unavailable<T>(): ServiceResult<T> {
  return { ok: false, error: { code: 'SERVICE_UNAVAILABLE',
    message: '教师视频需要当前授权的云端服务', retryable: false } }
}

export function listMyVideos(userId: string): Promise<ServiceResult<TeacherPrivateVideo[]>> {
  return getCloudAppService()?.listMyVideos(userId) ?? Promise.resolve(unavailable())
}
export function getMyVideoAvailability(userId: string): Promise<ServiceResult<{ enabled: boolean }>> {
  return getCloudAppService()?.getMyVideoAvailability(userId) ?? Promise.resolve(unavailable())
}
export function getMyVideo(userId: string, id: string): Promise<ServiceResult<TeacherPrivateVideoDetail>> {
  return getCloudAppService()?.getMyVideo(userId, id) ?? Promise.resolve(unavailable())
}
export function saveMyVideo(userId: string, title: string, questions: TeacherVideoQuestion[],
  id: string | undefined, version: number | undefined,
  operationId: string): Promise<ServiceResult<TeacherPrivateVideo>> {
  return getCloudAppService()?.saveMyVideo(userId, title, questions, id, version, operationId)
    ?? Promise.resolve(unavailable())
}
export function beginMyVideoUpload(userId: string, id: string, version: number) {
  return getCloudAppService()?.beginMyVideoUpload(userId, id, version)
    ?? Promise.resolve(unavailable<TeacherPrivateVideo>())
}
export function sealMyVideo(userId: string, id: string, version: number, stagingFileId: string) {
  return getCloudAppService()?.sealMyVideo(userId, id, version, stagingFileId)
    ?? Promise.resolve(unavailable<TeacherPrivateVideo>())
}
export function retryMyVideoProcessing(userId: string, id: string, version: number) {
  return getCloudAppService()?.retryMyVideoProcessing(userId, id, version)
    ?? Promise.resolve(unavailable<TeacherPrivateVideo>())
}
export function publishMyVideo(userId: string, id: string, version: number) {
  return getCloudAppService()?.publishMyVideo(userId, id, version)
    ?? Promise.resolve(unavailable<TeacherPrivateVideo>())
}
export function withdrawMyVideo(userId: string, id: string, version: number) {
  return getCloudAppService()?.withdrawMyVideo(userId, id, version)
    ?? Promise.resolve(unavailable<TeacherPrivateVideo>())
}
