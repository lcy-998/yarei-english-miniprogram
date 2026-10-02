import type { ServiceResult } from '../domain/types'
import type { RecordingPromptPage, RecordingPromptView, TaskRecordingMediaState, TaskRecordingPlayback, TaskRecordingView } from '../domain/task-recording'
import { getCloudAppService } from '../repositories/repository-factory'

function unavailable<T>(): ServiceResult<T> {
  return { ok: false, error: { code: 'SERVICE_UNAVAILABLE',
    message: '录音任务需要可信云端封存服务，当前演示模式不可提交', retryable: false } }
}
export async function listRecordingPrompts(userId: string, targetClassIds?: string[], keyword = '',
  limit = 20, offset = 0): Promise<ServiceResult<RecordingPromptPage>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.listRecordingPrompts(userId, targetClassIds, keyword, limit, offset) : unavailable()
}
export async function getRecordingPrompt(userId: string, promptId: string,
  targetClassIds?: string[]): Promise<ServiceResult<RecordingPromptView>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.getRecordingPrompt(userId, promptId, targetClassIds) : unavailable()
}
export async function beginTaskRecording(userId: string, taskId: string, itemId: string,
  operationId: string): Promise<ServiceResult<TaskRecordingView>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.beginTaskRecording(userId, taskId, itemId, operationId) : unavailable()
}
export async function submitTaskRecording(userId: string, recordingId: string, stagingFileId: string,
  expectedVersion: number, operationId: string): Promise<ServiceResult<TaskRecordingView>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.submitTaskRecording(userId, recordingId, stagingFileId, expectedVersion, operationId) : unavailable()
}
export async function listTaskRecordings(userId: string, taskId: string,
  itemId: string): Promise<ServiceResult<TaskRecordingView[]>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.listTaskRecordings(userId, taskId, itemId) : unavailable()
}
export async function getTaskRecordingPlayback(userId: string,
  recordingId: string): Promise<ServiceResult<TaskRecordingPlayback>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.getTaskRecordingPlayback(userId, recordingId) : unavailable()
}
export async function getTaskRecordingMediaState(userId: string,
  recordingId: string): Promise<ServiceResult<TaskRecordingMediaState>> {
  const cloud = getCloudAppService()
  return cloud ? cloud.getTaskRecordingMediaState(userId, recordingId) : unavailable()
}
