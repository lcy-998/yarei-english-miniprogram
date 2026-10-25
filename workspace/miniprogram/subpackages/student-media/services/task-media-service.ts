import type { M3TaskMediaHeartbeatView, M3TaskMediaPlaybackView,
  MyTaskDubbingPlaybackView, MyTaskDubbingWorkPage, ServiceResult, TaskDubbingWorkView,
  SubmittedTaskMediaPlaybackView } from '../../../domain/types'
import { getCloudAppService } from '../../../repositories/repository-factory'

function unavailable<T>(): ServiceResult<T> {
  return { ok: false, error: { code: 'SERVICE_UNAVAILABLE',
    message: '课堂媒体需要服务端连续播放验证，当前尚未开放', retryable: false } }
}

export async function beginTaskMediaSession(userId: string, taskId: string, itemId: string,
  operationId: string): Promise<ServiceResult<M3TaskMediaPlaybackView>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.beginTaskMediaSession(userId, taskId, itemId, operationId) : unavailable()
}

export async function reportTaskMediaHeartbeat(userId: string, sessionId: string, playedFromMs: number,
  playedToMs: number, positionMs: number, operationId: string): Promise<ServiceResult<M3TaskMediaHeartbeatView>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.reportTaskMediaHeartbeat(userId, sessionId, playedFromMs, playedToMs, positionMs, operationId)
    : unavailable()
}

export async function getTaskMediaPlayback(userId: string, taskId: string,
  itemId: string): Promise<ServiceResult<M3TaskMediaPlaybackView>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.getTaskMediaPlayback(userId, taskId, itemId) : unavailable()
}

export async function getSubmittedTaskMediaPlayback(userId: string, taskId: string,
  itemId: string, submissionVersion: number): Promise<ServiceResult<SubmittedTaskMediaPlaybackView>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.getSubmittedTaskMediaPlayback(userId, taskId, itemId, submissionVersion) : unavailable()
}

export async function beginTaskDubbingWork(userId: string, taskId: string, itemId: string,
  operationId: string): Promise<ServiceResult<TaskDubbingWorkView>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.beginTaskDubbingWork(userId, taskId, itemId, operationId) : unavailable()
}

export async function sealTaskDubbingWork(userId: string, workId: string, stagingFileId: string,
  expectedVersion: number, operationId: string): Promise<ServiceResult<TaskDubbingWorkView>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.sealTaskDubbingWork(userId, workId, stagingFileId, expectedVersion, operationId)
    : unavailable()
}

export async function listMyTaskDubbingWorks(userId: string, offset = 0,
  limit = 20): Promise<ServiceResult<MyTaskDubbingWorkPage>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.listMyTaskDubbingWorks(userId, offset, limit) : unavailable()
}

export async function getTaskDubbingPlayback(userId: string,
  workId: string): Promise<ServiceResult<MyTaskDubbingPlaybackView>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.getTaskDubbingPlayback(userId, workId) : unavailable()
}
