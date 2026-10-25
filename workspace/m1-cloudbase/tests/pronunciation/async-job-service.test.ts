import { describe, expect, it } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { PronunciationAsyncJobService } from '../../src/pronunciation/async-job-service';
import { DocumentPronunciationRepository } from '../../src/pronunciation/document-repository';
import type { PronunciationSourcePort } from '../../src/pronunciation/repository';
import { PronunciationError, type PronunciationRecording, type RecognitionResult } from '../../src/pronunciation/types';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import type { VersionedDocument } from '../../src/repositories/document-database-port';

const now = '2026-10-03T10:00:00+08:00';
const actor: TrustedActorContext = { requestId: 'request_virtual_job', sessionId: 'session_virtual_job',
  actorUserId: 'student_virtual_01', actorRole: 'student', organizationId: 'org_virtual_01',
  platformSubjectDigest: 'digest_virtual_01', permissions: [], scopeIds: [], authzVersion: 1 };
const operationId = 'score_job_virtual_01';
const recognition: RecognitionResult = { modelVersion: 'vosk-model-small-en-us-0.15', durationMs: 2000,
  words: [{ word: 'hello', start: 0, end: 0.5, confidence: 0.9 },
    { word: 'world', start: 0.6, end: 1.2, confidence: 0.9 }] };
function sealed(): PronunciationRecording {
  return { id: 'pronunciation_virtual_job_01', organizationId: actor.organizationId,
    studentId: actor.actorUserId, platformSubjectDigest: actor.platformSubjectDigest,
    source: { kind: 'task', taskId: 'task_virtual_01',
      itemId: 'item_virtual_01', resourceId: 'reading_virtual_01', segmentId: 'segment_virtual_01',
      referenceText: 'Hello world', sourceVersion: 'snapshot_virtual_01',
      assignmentId: 'assignment_virtual_01', classId: 'class_virtual_01', submissionVersion: 1 },
    referenceSha256: 'a'.repeat(64), stagingPath: 'pronunciation/staging/virtual.mp3',
    fileId: 'cloud://test-env/pronunciation/private/virtual.mp3', contentSha256: 'b'.repeat(64),
    sizeBytes: 12000, durationMs: 2000, status: 'sealed', score: null, qualityReason: null,
    modelVersion: null, algorithmVersion: null, scoreOperationId: null,
    effectiveAttemptNumber: null, version: 2, createdAt: now, sealedAt: now, scoredAt: null };
}
function fixture(infer: () => Promise<RecognitionResult> = async () => recognition) {
  const source = sealed();
  const database = new FakeDocumentDatabase({ pronunciation_recordings: [
    { _id: source.id, schemaVersion: 1, deletedAt: null, ...source,
      taskId: source.source.taskId, assignmentId: source.source.assignmentId,
      submissionVersion: source.source.submissionVersion } as VersionedDocument,
  ] });
  let current = true;
  let identity = true;
  let authzVersion = actor.authzVersion;
  let time = now;
  const dispatched: string[] = [];
  let dispatchFailure = false;
  let inferred = 0;
  const sources: PronunciationSourcePort = {
    async resolve() { return source.source; },
    async current() { return current; },
    async teacherSubmittedAt() { return null; },
    async parentSubmittedAt() { return null; },
    async parentSubmissionRecordingIds() { return null; },
  };
  const service = new PronunciationAsyncJobService(new DocumentPronunciationRepository(database), sources,
    { async dispatch(input) { if (dispatchFailure) throw new Error('synthetic Event rejection');
      dispatched.push(input.operationId); } },
    { async infer() { inferred += 1; return infer(); } },
    { async currentStudent() { return identity ? { ...actor, authzVersion } : null; } },
    { nowIso: () => time }, 300000);
  const job = { organizationId: actor.organizationId, studentId: actor.actorUserId,
    recordingId: source.id, operationId };
  return { database, service, job, dispatched, inferred: () => inferred,
    revoke: () => { current = false; }, disable: () => { identity = false; },
    failDispatch: () => { dispatchFailure = true; },
    resumeDispatch: () => { dispatchFailure = false; },
    bumpAuthz: () => { authzVersion += 1; },
    advance: (ms: number) => { time = new Date(Date.parse(time) + ms).toISOString(); } };
}

describe('M3 persisted pronunciation async job', () => {
  it('commits processing before dispatch and commits exactly one experimental result', async () => {
    const state = fixture();
    const accepted = await state.service.accept(actor, state.job.recordingId, 2, operationId);
    expect(accepted).toMatchObject({ status: 'processing', score: null, effectiveAttemptNumber: null,
      experimental: true, scoreId: state.job.recordingId });
    expect(state.dispatched).toEqual([operationId]);
    expect(state.inferred()).toBe(0);
    expect((await state.service.accept(actor, state.job.recordingId, 2, operationId)).status).toBe('processing');
    expect(state.dispatched).toEqual([operationId]);
    expect((await state.service.run(state.job))).toMatchObject({ status: 'scored', effectiveAttemptNumber: 1 });
    expect(await state.service.run(state.job)).toBeNull();
    expect(state.inferred()).toBe(1);
    expect(state.database.snapshot().pronunciation_recordings?.[0]).toMatchObject({
      status: 'scored', dispatchState: 'finished', effectiveAttemptNumber: 1, workerInvocationCount: 1 });
    expect(state.database.snapshot().pronunciation_operations).toHaveLength(1);
    expect(state.database.snapshot().operation_logs).toHaveLength(2);
  });

  it('re-dispatches a stale unclaimed job once and keeps it idempotent', async () => {
    const state = fixture();
    await state.service.accept(actor, state.job.recordingId, 2, operationId);
    state.advance(90_001);
    const recovered = await state.service.accept({ ...actor, requestId: 'request_virtual_recover_01' }, state.job.recordingId, 4,
      'score_job_virtual_recover_01');
    expect(recovered).toMatchObject({ status: 'processing', score: null });
    expect(state.dispatched).toEqual([operationId, operationId]);
    expect(state.database.snapshot().pronunciation_recordings?.[0]).toMatchObject({
      status: 'processing', dispatchState: 'sent', dispatchRecoveryCount: 1, workerInvocationCount: 0,
    });

    state.advance(10_000);
    await state.service.accept({ ...actor, requestId: 'request_virtual_recover_01' }, state.job.recordingId, 4,
      'score_job_virtual_recover_01');
    expect(state.dispatched).toEqual([operationId, operationId]);
  });

  it('surfaces a retryable system failure after bounded dispatch recovery', async () => {
    const state = fixture();
    await state.service.accept(actor, state.job.recordingId, 2, operationId);
    state.advance(90_001);
    await state.service.accept({ ...actor, requestId: 'request_virtual_recover_02' }, state.job.recordingId, 4,
      'score_job_virtual_recover_02');
    state.advance(90_001);
    await state.service.accept({ ...actor, requestId: 'request_virtual_recover_03' }, state.job.recordingId, 5,
      'score_job_virtual_recover_03');
    state.advance(7 * 60_000);

    const failed = await state.service.accept({ ...actor, requestId: 'request_virtual_recover_final' }, state.job.recordingId, 6,
      'score_job_virtual_recover_final');
    expect(failed).toMatchObject({ status: 'failed', retryable: true });
    expect(failed.score).toBeNull();
    expect(state.dispatched).toEqual([operationId, operationId, operationId]);
    expect(state.inferred()).toBe(0);
  });

  it('retries one system failure and leaves no score until the second result', async () => {
    let calls = 0;
    const state = fixture(async () => {
      calls += 1;
      if (calls === 1) throw new Error('synthetic worker failure');
      return recognition;
    });
    await state.service.accept(actor, state.job.recordingId, 2, operationId);
    expect(await state.service.run(state.job)).toMatchObject({ status: 'processing', score: null });
    expect(state.dispatched).toEqual([operationId, operationId]);
    expect((await state.service.run(state.job))).toMatchObject({ status: 'scored', effectiveAttemptNumber: 1 });
    expect(await state.service.run(state.job)).toBeNull();
    expect(state.inferred()).toBe(2);
  });

  it('audits a safe internal failure category without storing raw error data', async () => {
    const state = fixture(async () => { throw new PronunciationError('SERVICE_UNAVAILABLE', 'scf_api_denied'); });
    await state.service.accept(actor, state.job.recordingId, 2, operationId);
    expect(await state.service.run(state.job)).toMatchObject({ status: 'processing', score: null });
    const attempt = state.database.snapshot().operation_logs?.find(log => log.action === 'pronunciation.scoreAttempt1');
    expect(attempt?.metadata).toMatchObject({ failureReason: 'scf_api_denied', retryCount: 1 });
    expect(JSON.stringify(attempt?.metadata)).not.toMatch(/https?:|AKID|secret|token/i);
  });

  it('rejects revoked ownership before and after inference without a fabricated score', async () => {
    const before = fixture();
    await before.service.accept(actor, before.job.recordingId, 2, operationId);
    before.disable();
    expect(await before.service.run(before.job)).toMatchObject({ status: 'failed', score: null });
    expect(before.inferred()).toBe(0);

    const versionChanged = fixture();
    await versionChanged.service.accept(actor, versionChanged.job.recordingId, 2, operationId);
    versionChanged.bumpAuthz();
    expect(await versionChanged.service.run(versionChanged.job))
      .toMatchObject({ status: 'failed', score: null });
    expect(versionChanged.inferred()).toBe(0);

    let after!: ReturnType<typeof fixture>;
    after = fixture(async () => { after.revoke(); return recognition; });
    await after.service.accept(actor, after.job.recordingId, 2, operationId);
    expect(await after.service.run(after.job)).toMatchObject({ status: 'failed', score: null });
    expect(after.inferred()).toBe(1);

    let changed!: ReturnType<typeof fixture>;
    changed = fixture(async () => { changed.bumpAuthz(); return recognition; });
    await changed.service.accept(actor, changed.job.recordingId, 2, operationId);
    expect(await changed.service.run(changed.job)).toMatchObject({ status: 'failed', score: null });
    expect(changed.inferred()).toBe(1);
  });

  it('fails closed after two expired worker leases instead of a third model call', async () => {
    const state = fixture();
    await state.service.accept(actor, state.job.recordingId, 2, operationId);
    const store = state.database;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      await store.runTransaction(async tx => {
        const record = await tx.get('pronunciation_recordings', state.job.recordingId);
        expect(record).not.toBeNull();
        await tx.replace('pronunciation_recordings', state.job.recordingId, record!.version,
          { ...record!, version: record!.version + 1, workerInvocationCount: attempt,
            workerLeaseUntil: new Date(Date.parse(now) - 1).toISOString() });
      });
    }
    expect(await state.service.run(state.job)).toMatchObject({ status: 'failed', score: null });
    expect(state.inferred()).toBe(0);
  });

  it('denies operation replay against a different recording', async () => {
    const state = fixture();
    await state.service.accept(actor, state.job.recordingId, 2, operationId);
    await expect(state.service.accept({ ...actor, actorRole: 'teacher' }, state.job.recordingId, 2, operationId))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(state.service.accept(actor, 'pronunciation_virtual_wrong', 2, operationId))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('recovers a durable pending outbox without exposing media or creating a new operation', async () => {
    const state = fixture();
    state.failDispatch();
    expect(await state.service.accept(actor, state.job.recordingId, 2, operationId))
      .toMatchObject({ status: 'processing' });
    const repository = new DocumentPronunciationRepository(state.database);
    const pending = await repository.listPending(actor.organizationId, 0);
    expect(pending.jobs).toEqual([state.job]);
    expect(JSON.stringify(pending)).not.toContain('cloud://');
    expect(await state.service.recoverPending(state.job)).toBe(false);
    state.resumeDispatch();
    expect(await state.service.recoverPending(state.job)).toBe(true);
    expect(await state.service.recoverPending(state.job)).toBe(false);
    expect((await repository.listPending(actor.organizationId, 0)).jobs).toEqual([]);
    expect(state.dispatched).toEqual([operationId]);
    expect(state.database.snapshot().pronunciation_operations).toHaveLength(1);
  });
});
