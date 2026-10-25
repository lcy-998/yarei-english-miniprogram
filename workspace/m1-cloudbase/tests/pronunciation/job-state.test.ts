import { describe, expect, it } from 'vitest';
import { acceptScoreJob, completeScoreJob, failScoreJobAttempt,
  invalidateScoreJob, markScoreJobDispatched } from '../../src/pronunciation/job-state';
import type { PronunciationRecording, RecognitionResult } from '../../src/pronunciation/types';

const now = '2026-10-03T10:00:00+08:00';
const operationId = 'score_virtual_0001';
function sealed(): PronunciationRecording {
  return { id: 'pronunciation_virtual_0001', organizationId: 'org_virtual_01',
    studentId: 'student_virtual_01', source: { kind: 'task', taskId: 'task_virtual_01',
      itemId: 'item_virtual_01', resourceId: 'reading_virtual_01', segmentId: 'segment_virtual_01',
      referenceText: 'Hello world', sourceVersion: 'snapshot_virtual_01',
      assignmentId: 'assignment_virtual_01', classId: 'class_virtual_01', submissionVersion: 1 },
    referenceSha256: 'a'.repeat(64), stagingPath: 'pronunciation/staging/virtual.mp3',
    fileId: 'cloud://test-env/pronunciation/private/virtual.mp3', contentSha256: 'b'.repeat(64),
    sizeBytes: 12000, durationMs: 2000, status: 'sealed', score: null, qualityReason: null,
    modelVersion: null, algorithmVersion: null, scoreOperationId: null,
    effectiveAttemptNumber: null, version: 2, createdAt: now, sealedAt: now, scoredAt: null };
}
const recognition: RecognitionResult = { modelVersion: 'vosk-model-small-en-us-0.15',
  durationMs: 2000, words: [
    { word: 'hello', start: 0, end: 0.5, confidence: 0.9 },
    { word: 'world', start: 0.6, end: 1.2, confidence: 0.9 },
  ] };

describe('M3 durable pronunciation job transitions', () => {
  it('accepts once, returns a processing receipt and never counts it as a score', () => {
    const accepted = acceptScoreJob(sealed(), operationId, 2, 0, now, 1);
    expect(accepted).toMatchObject({ status: 'processing', dispatchState: 'pending',
      effectiveAttemptNumber: null, score: null, scoreOperationId: operationId,
      processingStartedAt: now, version: 3 });
    expect(acceptScoreJob(accepted, operationId, 2, 0, now, 1)).toBe(accepted);
    expect(() => acceptScoreJob(sealed(), operationId, 2, 5, now, 1)).toThrowError('CONFLICT');
    expect(() => acceptScoreJob(sealed(), operationId, 3, 0, now, 1)).toThrowError('CONFLICT');
  });

  it('permits exactly one system retry and requires a new operation after terminal failure', () => {
    const accepted = acceptScoreJob(sealed(), operationId, 2, 0, now, 1);
    const sent = markScoreJobDispatched(accepted, operationId);
    expect(sent.dispatchState).toBe('sent');
    const retry = failScoreJobAttempt(sent, operationId);
    expect(retry).toMatchObject({ status: 'processing', systemRetryCount: 1, dispatchState: 'pending' });
    const failed = failScoreJobAttempt(markScoreJobDispatched(retry, operationId), operationId);
    expect(failed).toMatchObject({ status: 'failed', systemRetryCount: 1, score: null });
    expect(() => acceptScoreJob(failed, operationId, failed.version, 0, now, 1)).toThrowError('CONFLICT');
    expect(acceptScoreJob(failed, 'manual_retry_0001', failed.version, 0, now, 1))
      .toMatchObject({ status: 'processing', systemRetryCount: 0 });
  });

  it('applies only a current, matching worker result; duplicate or revoked result cannot count', () => {
    const accepted = acceptScoreJob(sealed(), operationId, 2, 1, now, 1);
    const scored = completeScoreJob(accepted, operationId, recognition, 'snapshot_virtual_01', 1, now);
    expect(scored).toMatchObject({ status: 'scored', effectiveAttemptNumber: 2,
      dispatchState: 'finished', scoredAt: now });
    expect(scored.score?.total).toBeGreaterThan(0);
    expect(() => completeScoreJob(scored, operationId, recognition, 'snapshot_virtual_01', 1, now))
      .toThrowError('CONFLICT');
    expect(() => completeScoreJob(accepted, operationId, recognition, null, 1, now))
      .toThrowError('CONFLICT');
    expect(() => completeScoreJob(accepted, operationId, recognition, 'changed_snapshot', 1, now))
      .toThrowError('CONFLICT');
    expect(() => completeScoreJob(accepted, operationId, recognition, 'snapshot_virtual_01', 5, now))
      .toThrowError('CONFLICT');
    expect(invalidateScoreJob(accepted, operationId)).toMatchObject({ status: 'failed', score: null });
  });

  it('leaves low-confidence and silent recognition without fabricated scores or effective attempts', () => {
    const accepted = acceptScoreJob(sealed(), operationId, 2, 0, now, 1);
    const unreliable = completeScoreJob(accepted, operationId,
      { ...recognition, words: [] }, 'snapshot_virtual_01', 0, now);
    expect(unreliable).toMatchObject({ status: 'unreliable', score: null,
      qualityReason: 'NO_SPEECH', effectiveAttemptNumber: null });
  });
});
