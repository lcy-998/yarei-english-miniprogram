import { scoreRecognition, VOICE_ALGORITHM_VERSION, VOICE_MODEL_VERSION } from './rules';
import { PronunciationError, type PronunciationRecording, type RecognitionResult } from './types';

function currentJob(record: PronunciationRecording, operationId: string): boolean {
  return record.status === 'processing' && record.scoreOperationId === operationId;
}

/** Pure transition. The caller must atomically CAS-save it with receipt and audit. */
export function acceptScoreJob(record: PronunciationRecording, operationId: string,
  expectedVersion: number, effectiveTaskAttempts: number, at: string,
  authzVersion: number): PronunciationRecording {
  if (record.status === 'processing' && record.scoreOperationId === operationId) return record;
  if (record.status === 'scored' || record.status === 'unreliable') return record;
  if ((record.status !== 'sealed' && record.status !== 'failed') || record.version !== expectedVersion
    || (record.status === 'failed' && record.failureKind !== 'system')
    || !record.fileId || !record.contentSha256 || !record.sizeBytes || !record.durationMs
    || !Number.isSafeInteger(authzVersion) || authzVersion < 1
    || (record.source.kind === 'task' && effectiveTaskAttempts >= 5)
    || (record.status === 'failed' && record.scoreOperationId === operationId)) {
    throw new PronunciationError('CONFLICT');
  }
  return { ...record, status: 'processing', score: null, qualityReason: null,
    failureKind: null,
    scoreOperationId: operationId, processingStartedAt: at, systemRetryCount: 0,
    lastDispatchAt: at, dispatchRecoveryCount: 0,
    workerInvocationCount: 0, workerLeaseUntil: null,
    scoreAuthzVersion: authzVersion,
    dispatchState: 'pending', effectiveAttemptNumber: null, version: record.version + 1 };
}

export function markScoreJobDispatched(record: PronunciationRecording,
  operationId: string): PronunciationRecording {
  if (!currentJob(record, operationId)) throw new PronunciationError('CONFLICT');
  if (record.dispatchState === 'sent') return record;
  if (record.dispatchState !== 'pending') throw new PronunciationError('CONFLICT');
  return { ...record, dispatchState: 'sent', version: record.version + 1 };
}

/** At most one system retry; the second failure becomes terminal. */
export function failScoreJobAttempt(record: PronunciationRecording,
  operationId: string): PronunciationRecording {
  if (!currentJob(record, operationId)) throw new PronunciationError('CONFLICT');
  const retries = record.systemRetryCount ?? 0;
  if (retries > 0) return { ...record, status: 'failed', dispatchState: 'finished',
    failureKind: 'system', systemRetryCount: 1, version: record.version + 1 };
  return { ...record, failureKind: 'system', systemRetryCount: 1,
    dispatchState: 'pending', version: record.version + 1 };
}

/** Revocation, stale snapshot, terminal timeout or malformed worker result. */
export function invalidateScoreJob(record: PronunciationRecording,
  operationId: string): PronunciationRecording {
  if (!currentJob(record, operationId)) throw new PronunciationError('CONFLICT');
  return { ...record, status: 'failed', score: null, qualityReason: null,
    failureKind: 'invalidated', dispatchState: 'finished', version: record.version + 1 };
}

/** The trusted worker must re-check current authorization and source before applying this transition. */
export function completeScoreJob(record: PronunciationRecording, operationId: string,
  recognition: RecognitionResult, currentSourceVersion: string | null,
  effectiveTaskAttempts: number, at: string): PronunciationRecording {
  if (!currentJob(record, operationId) || !record.durationMs || !record.contentSha256
    || currentSourceVersion !== record.source.sourceVersion
    || recognition.modelVersion !== VOICE_MODEL_VERSION
    || Math.abs(recognition.durationMs - record.durationMs) > 1000
    || (record.source.kind === 'task' && effectiveTaskAttempts >= 5)) {
    throw new PronunciationError('CONFLICT');
  }
  const decision = scoreRecognition(record.source.referenceText, recognition);
  return { ...record, status: decision.status,
    failureKind: null,
    score: decision.status === 'scored' ? decision.score : null,
    qualityReason: decision.status === 'unreliable' ? decision.qualityReason : null,
    effectiveAttemptNumber: decision.status === 'scored' && record.source.kind === 'task'
      ? effectiveTaskAttempts + 1 : null,
    modelVersion: VOICE_MODEL_VERSION, algorithmVersion: VOICE_ALGORITHM_VERSION,
    dispatchState: 'finished', version: record.version + 1, scoredAt: at };
}
