import type { ReadingPronunciationSegmentsView, ServiceResult } from '../../../domain/types'
import type { MyPronunciationPlayback, MyPronunciationWorkPage, TeacherPronunciationEvidence } from '../../../services/cloudbase-app-service'
import { getCloudAppService } from '../../../repositories/repository-factory'
import { getReadingPronunciationSegments as readAuthorizedSegments } from './app-service'

export type { TeacherPronunciationEvidence } from '../../../services/cloudbase-app-service'

export type PronunciationSource =
  | Readonly<{ kind: 'reading'; resourceId: string; segmentId: string }>
  | Readonly<{ kind: 'task'; taskId: string; itemId: string; segmentId: string }>

export interface PronunciationRecordingDraft {
  recordingId: string
  stagingPath: string
  expectedVersion: 1
  source: PronunciationSource
  referencePreview: string
  durationLimits: Readonly<{ minMs: number; maxMs: number; maxBytes: number }>
}

export interface SealedPronunciationRecording {
  recordingId: string
  expectedVersion: 2
  durationMs: number
}

export interface PronunciationScore {
  total: number
  pronunciation: number
  fluency: number
  completeness: number
}

export interface PronunciationScoreView {
  scoreId: string
  status: 'draft' | 'sealed' | 'processing' | 'scored' | 'unreliable' | 'failed'
  experimental: true
  effectiveAttemptNumber?: number
  score?: PronunciationScore
  qualityReason?: string
  modelVersion?: string
  algorithmVersion?: string
  sourceVersion?: string
  submissionVersion?: number | null
  scoredAt?: string | null
  expectedVersion?: number
  retryable?: boolean
}

export type ReadingPronunciationSegment = ReadingPronunciationSegmentsView['segments'][number]

function unavailable<T>(): ServiceResult<T> {
  return { ok: false, error: { code: 'SERVICE_UNAVAILABLE',
    message: '跟读评分服务尚未开放，请稍后重试', retryable: true } }
}

export function beginPronunciationRecording(userId: string, source: PronunciationSource,
  operationId: string): Promise<ServiceResult<PronunciationRecordingDraft>> {
  return getCloudAppService()?.beginPronunciationRecording(userId, source, operationId)
    ?? Promise.resolve(unavailable())
}

export function sealPronunciationRecording(userId: string, recordingId: string, stagingFileId: string,
  operationId: string): Promise<ServiceResult<SealedPronunciationRecording>> {
  return getCloudAppService()?.sealPronunciationRecording(userId, recordingId, stagingFileId, 1, operationId)
    ?? Promise.resolve(unavailable())
}

export function beginPronunciationScore(userId: string, recordingId: string,
  operationId: string, expectedVersion = 2): Promise<ServiceResult<PronunciationScoreView>> {
  return getCloudAppService()?.beginPronunciationScore(userId, recordingId, expectedVersion, operationId)
    ?? Promise.resolve(unavailable())
}

export function getPronunciationScore(userId: string,
  scoreId: string): Promise<ServiceResult<PronunciationScoreView>> {
  return getCloudAppService()?.getPronunciationScore(userId, scoreId)
    ?? Promise.resolve(unavailable())
}

export function listPronunciationAttempts(userId: string,
  source: PronunciationSource): Promise<ServiceResult<PronunciationScoreView[]>> {
  return getCloudAppService()?.listPronunciationAttempts(userId, source)
    ?? Promise.resolve(unavailable())
}

export function listMyPronunciationWorks(userId: string, cursor: string | null,
  limit = 20): Promise<ServiceResult<MyPronunciationWorkPage>> {
  return getCloudAppService()?.listMyPronunciationWorks(userId, cursor, limit)
    ?? Promise.resolve(unavailable())
}

export function getMyPronunciationPlayback(userId: string,
  recordingId: string): Promise<ServiceResult<MyPronunciationPlayback>> {
  return getCloudAppService()?.getMyPronunciationPlayback(userId, recordingId)
    ?? Promise.resolve(unavailable())
}

export function getTeacherPronunciationEvidence(userId: string, input: Readonly<{
  taskId: string; assignmentId: string; submissionVersion: number; itemId: string; segmentId: string
}>): Promise<ServiceResult<TeacherPronunciationEvidence>> {
  return getCloudAppService()?.getTeacherPronunciationEvidence(userId, input)
    ?? Promise.resolve(unavailable())
}

export function getReadingPronunciationSegments(userId: string,
  resourceId: string): Promise<ServiceResult<ReadingPronunciationSegmentsView>> {
  return readAuthorizedSegments(userId, resourceId)
}
