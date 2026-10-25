import type { TrustedActorContext } from '../auth/trusted-actor';
import { acceptScoreJob, completeScoreJob, failScoreJobAttempt, invalidateScoreJob } from './job-state';
import type { PronunciationInferencePort, PronunciationJobDispatchPort,
  PronunciationSourcePort, PronunciationUnitOfWork, PronunciationWorkerIdentityPort } from './repository';
import { PronunciationError, type PronunciationRecording } from './types';
import type { PronunciationView } from './service';

const validId = (value: string): boolean => /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(value);
const DISPATCH_RECOVERY_AFTER_MS = 90_000;
const MAX_DISPATCH_RECOVERIES = 2;
const DISPATCH_FAILURE_AFTER_MS = 10 * 60_000;
function view(record: PronunciationRecording): PronunciationView {
  return { scoreId: record.id, recordingId: record.id, status: record.status, experimental: true,
    score: record.score, qualityReason: record.qualityReason,
    effectiveAttemptNumber: record.effectiveAttemptNumber, modelVersion: record.modelVersion,
    algorithmVersion: record.algorithmVersion, sourceVersion: record.source.sourceVersion,
    submissionVersion: record.source.submissionVersion, scoredAt: record.scoredAt,
    expectedVersion: record.version,
    retryable: record.status === 'failed' && record.failureKind === 'system' && !record.mediaDeletedAt };
}
function matching(record: PronunciationRecording, organizationId: string,
  studentId: string, operationId: string): boolean {
  return record.organizationId === organizationId && record.studentId === studentId
    && record.status === 'processing' && record.scoreOperationId === operationId;
}

/** Server-only durable job logic. Dispatch and worker identity ports remain unconfigured in cloud. */
export class PronunciationAsyncJobService {
  public constructor(private readonly records: PronunciationUnitOfWork,
    private readonly sources: PronunciationSourcePort,
    private readonly dispatcher: PronunciationJobDispatchPort,
    private readonly inference: PronunciationInferencePort,
    private readonly identities: PronunciationWorkerIdentityPort,
    private readonly clock: { nowIso(): string },
    private readonly leaseMs: number) {
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1000 || leaseMs > 900000) {
      throw new Error('Invalid voice worker lease');
    }
  }

  public async accept(actor: TrustedActorContext, recordingId: string,
    expectedVersion: number, operationId: string): Promise<PronunciationView> {
    if (actor.actorRole !== 'student' || !validId(recordingId) || !validId(operationId)
      || !Number.isSafeInteger(expectedVersion) || expectedVersion < 2) throw new PronunciationError('VALIDATION_ERROR');
    const before = await this.records.transaction(tx => tx.findRecording(actor.organizationId, recordingId));
    if (!before || before.studentId !== actor.actorUserId) throw new PronunciationError('NOT_FOUND');
    if (!await this.sourceCurrentForScore(actor, before)) throw new PronunciationError('CONFLICT');
    const accepted = await this.records.transaction(async tx => {
      const record = await tx.findRecording(actor.organizationId, recordingId);
      if (!record || record.studentId !== actor.actorUserId) throw new PronunciationError('NOT_FOUND');
      const receipt = await tx.findReceipt(actor.organizationId, actor.actorUserId, operationId);
      if (receipt && (receipt.recordingId !== recordingId || receipt.fingerprint !== `score:${recordingId}`)) {
        throw new PronunciationError('CONFLICT');
      }
      if (record.status === 'processing') {
        if (!record.scoreOperationId || !await this.sourceCurrentForScore(actor, record)) {
          throw new PronunciationError('CONFLICT');
        }
        const nowIso = this.clock.nowIso();
        const nowMs = Date.parse(nowIso);
        const dispatchAt = Date.parse(record.lastDispatchAt ?? record.processingStartedAt ?? record.createdAt);
        const recoveryCount = record.dispatchRecoveryCount ?? 0;
        const workerCount = record.workerInvocationCount ?? 0;
        const leaseUntil = record.workerLeaseUntil ? Date.parse(record.workerLeaseUntil) : NaN;
        const activeLease = Number.isFinite(leaseUntil) && leaseUntil > nowMs;
        const noActiveWorker = !activeLease;
        const noClaimYet = workerCount === 0;
        const expiredWorkerLease = workerCount > 0 && Number.isFinite(leaseUntil)
          && nowMs - leaseUntil >= DISPATCH_RECOVERY_AFTER_MS;
        const dispatchAgeMs = Number.isFinite(dispatchAt) ? nowMs - dispatchAt : 0;
        const dispatchIsDue = noActiveWorker && dispatchAgeMs >= DISPATCH_RECOVERY_AFTER_MS
          && (record.dispatchState === 'pending' || (record.dispatchState === 'sent'
            && (noClaimYet || expiredWorkerLease)));
        if (dispatchIsDue && recoveryCount < MAX_DISPATCH_RECOVERIES) {
          const recovered: PronunciationRecording = { ...record, dispatchState: 'pending',
            dispatchRecoveryCount: recoveryCount + 1, lastDispatchAt: nowIso,
            version: record.version + 1 };
          if (!await tx.saveRecording(recovered, record.version)
            || (!receipt && !await tx.saveReceipt({ organizationId: actor.organizationId,
              actorId: actor.actorUserId, operationId, fingerprint: `score:${recordingId}`, recordingId }))
            || !await tx.appendAudit(actor, 'pronunciation.scoreDispatchRecovered', recordingId,
              nowIso, { recoveryCount: recoveryCount + 1, experimental: true })) {
            throw new PronunciationError('CONFLICT');
          }
          return { record: recovered, created: false, dispatch: true,
            jobOperationId: record.scoreOperationId } as const;
        }
        const processingAt = Date.parse(record.processingStartedAt ?? record.createdAt);
        const unclaimedTooLong = noActiveWorker && (noClaimYet || expiredWorkerLease)
          && recoveryCount >= MAX_DISPATCH_RECOVERIES
          && Number.isFinite(processingAt) && nowMs - processingAt >= DISPATCH_FAILURE_AFTER_MS;
        if (unclaimedTooLong) {
          const failed: PronunciationRecording = { ...record, status: 'failed', failureKind: 'system',
            dispatchState: 'finished', workerLeaseUntil: null, version: record.version + 1 };
          if (!await tx.saveRecording(failed, record.version)
            || (!receipt && !await tx.saveReceipt({ organizationId: actor.organizationId,
              actorId: actor.actorUserId, operationId, fingerprint: `score:${recordingId}`, recordingId }))
            || !await tx.appendAudit(actor, 'pronunciation.scoreDispatchFailed', recordingId,
              nowIso, { recoveryCount, experimental: true })) {
            throw new PronunciationError('CONFLICT');
          }
          return { record: failed, created: false, dispatch: false,
            jobOperationId: record.scoreOperationId } as const;
        }
        return { record, created: false, dispatch: false,
          jobOperationId: record.scoreOperationId } as const;
      }
      const all = await tx.listRecordings(actor.organizationId, actor.actorUserId);
      const effective = all.filter(candidate => candidate.status === 'scored'
        && candidate.source.kind === 'task' && candidate.source.taskId === record.source.taskId
        && candidate.source.itemId === record.source.itemId).length;
      const next = acceptScoreJob(record, operationId, expectedVersion, effective,
        this.clock.nowIso(), actor.authzVersion);
      if (next === record) return { record, created: false, dispatch: false,
        jobOperationId: record.scoreOperationId ?? operationId } as const;
      if (!await this.sourceCurrentForScore(actor, record)
        || !await tx.saveRecording(next, record.version)
        || (!receipt && !await tx.saveReceipt({ organizationId: actor.organizationId,
          actorId: actor.actorUserId, operationId, fingerprint: `score:${recordingId}`, recordingId }))
        || !await tx.appendAudit(actor, 'pronunciation.scoreAccepted', recordingId,
          this.clock.nowIso(), { experimental: true, submissionVersion: record.source.submissionVersion })) {
        throw new PronunciationError('CONFLICT');
      }
      return { record: next, created: true, dispatch: true, jobOperationId: operationId } as const;
    });
    if (accepted.dispatch) {
      try {
        await this.dispatcher.dispatch({ organizationId: actor.organizationId,
          studentId: actor.actorUserId, recordingId, operationId: accepted.jobOperationId });
        await this.records.transaction(async tx => {
          const record = await tx.findRecording(actor.organizationId, recordingId);
          if (!record || !matching(record, actor.organizationId, actor.actorUserId, accepted.jobOperationId)
            || record.dispatchState !== 'pending') return;
          await tx.saveRecording({ ...record, dispatchState: 'sent', lastDispatchAt: this.clock.nowIso(),
            version: record.version + 1 }, record.version);
        });
      } catch {
        // The durable pending state is retried when the student next checks this score.
        await this.records.transaction(tx => tx.appendWorkerAudit(actor.organizationId,
          'pronunciation.dispatchPending', recordingId, accepted.jobOperationId, this.clock.nowIso(),
          { experimental: true, recovered: !accepted.created }));
      }
    }
    const latest = await this.records.transaction(tx => tx.findRecording(actor.organizationId, recordingId));
    if (!latest) throw new PronunciationError('SERVICE_UNAVAILABLE');
    return view(latest);
  }

  public async run(input: Readonly<{ organizationId: string; studentId: string;
    recordingId: string; operationId: string }>): Promise<PronunciationView | null> {
    const now = Date.parse(this.clock.nowIso());
    if (!validId(input.organizationId) || !validId(input.studentId)
      || !validId(input.recordingId) || !validId(input.operationId) || !Number.isFinite(now)) {
      throw new PronunciationError('VALIDATION_ERROR');
    }
    const outcome = await this.records.transaction(async tx => {
      const record = await tx.findRecording(input.organizationId, input.recordingId);
      if (!record || !matching(record, input.organizationId, input.studentId, input.operationId)) return null;
      if (record.workerLeaseUntil && Date.parse(record.workerLeaseUntil) > now) return null;
      if ((record.workerInvocationCount ?? 0) >= 2) {
        const expired = { ...invalidateScoreJob(record, input.operationId), workerLeaseUntil: null };
        if (!await tx.saveRecording(expired, record.version)
          || !await tx.appendWorkerAudit(input.organizationId, 'pronunciation.scoreWorkerExhausted',
            input.recordingId, input.operationId, this.clock.nowIso(), { experimental: true })) {
          throw new PronunciationError('CONFLICT');
        }
        return { terminal: expired } as const;
      }
      const next: PronunciationRecording = { ...record, dispatchState: 'sent',
        workerLeaseUntil: new Date(now + this.leaseMs).toISOString(),
        workerInvocationCount: (record.workerInvocationCount ?? 0) + 1,
        version: record.version + 1 };
      return await tx.saveRecording(next, record.version) ? { claimed: next } as const : null;
    });
    if (!outcome) return null;
    if ('terminal' in outcome && outcome.terminal) return view(outcome.terminal);
    const claimed = outcome.claimed;
    const actor = await this.identities.currentStudent(input.organizationId, input.studentId,
      claimed.platformSubjectDigest ?? '');
    if (!actor || actor.actorRole !== 'student' || actor.actorUserId !== input.studentId
      || actor.organizationId !== input.organizationId
      || actor.authzVersion !== claimed.scoreAuthzVersion
      || !await this.sourceCurrentForScore(actor, claimed)) return this.invalidate(claimed, input);
    let recognition;
    try {
      recognition = await this.inference.infer({ operationId: input.operationId,
        recordingId: claimed.id, fileId: claimed.fileId!, contentSha256: claimed.contentSha256!,
        sizeBytes: claimed.sizeBytes!, durationMs: claimed.durationMs! });
    } catch (error: unknown) {
      if (error instanceof PronunciationError && error.code === 'MEDIA_INVALID') {
        return this.invalidate(claimed, input);
      }
      const failureReason = error instanceof PronunciationError
        ? error.diagnostic ?? error.code : 'unclassified_error';
      return this.failedAttempt(claimed, input, failureReason);
    }
    const refreshed = await this.identities.currentStudent(input.organizationId, input.studentId,
      claimed.platformSubjectDigest ?? '');
    if (!refreshed || refreshed.actorRole !== 'student' || refreshed.actorUserId !== input.studentId
      || refreshed.organizationId !== input.organizationId
      || refreshed.authzVersion !== claimed.scoreAuthzVersion
      || !await this.sourceCurrentForScore(refreshed, claimed)) return this.invalidate(claimed, input);
    return this.records.transaction(async tx => {
      const current = await tx.findRecording(input.organizationId, input.recordingId);
      if (!current || current.version !== claimed.version
        || !matching(current, input.organizationId, input.studentId, input.operationId)) return null;
      const all = await tx.listRecordings(input.organizationId, input.studentId);
      const effective = all.filter(candidate => candidate.status === 'scored'
        && candidate.source.kind === 'task' && candidate.source.taskId === current.source.taskId
        && candidate.source.itemId === current.source.itemId).length;
      let next: PronunciationRecording;
      try {
        const finalActor = await this.identities.currentStudent(input.organizationId, input.studentId,
          claimed.platformSubjectDigest ?? '');
        if (!finalActor || finalActor.authzVersion !== current.scoreAuthzVersion
          || finalActor.actorUserId !== input.studentId || finalActor.organizationId !== input.organizationId
          || !await this.sourceCurrentForScore(finalActor, current)) {
          throw new PronunciationError('CONFLICT');
        }
        next = completeScoreJob(current, input.operationId, recognition,
          claimed.source.sourceVersion, effective, this.clock.nowIso());
      }
      catch { next = invalidateScoreJob(current, input.operationId); }
      next = { ...next, workerLeaseUntil: null };
      if (!await tx.saveRecording(next, current.version)
        || !await tx.appendWorkerAudit(input.organizationId, 'pronunciation.scoreCompleted',
          input.recordingId, input.operationId, this.clock.nowIso(),
          { status: next.status, experimental: true, submissionVersion: current.source.submissionVersion })) {
        throw new PronunciationError('CONFLICT');
      }
      return view(next);
    });
  }

  /** Server-only outbox repair after an acknowledged DB commit but failed Event dispatch. */
  public async recoverPending(input: Readonly<{ organizationId: string;
    recordingId: string; operationId: string }>): Promise<boolean> {
    if (!validId(input.organizationId) || !validId(input.recordingId)
      || !validId(input.operationId)) throw new PronunciationError('VALIDATION_ERROR');
    const record = await this.records.transaction(tx => tx.findRecording(input.organizationId, input.recordingId));
    if (!record || record.status !== 'processing' || record.dispatchState !== 'pending'
      || record.scoreOperationId !== input.operationId) return false;
    try { await this.dispatcher.dispatch({ organizationId: input.organizationId,
      studentId: record.studentId, recordingId: input.recordingId, operationId: input.operationId }); }
    catch { return false; }
    return this.records.transaction(async tx => {
      const current = await tx.findRecording(input.organizationId, input.recordingId);
      if (!current || current.version !== record.version || current.status !== 'processing'
        || current.dispatchState !== 'pending' || current.scoreOperationId !== input.operationId) return false;
      const next = { ...current, dispatchState: 'sent' as const,
        lastDispatchAt: this.clock.nowIso(), version: current.version + 1 };
      if (!await tx.saveRecording(next, current.version)
        || !await tx.appendWorkerAudit(input.organizationId, 'pronunciation.outboxDispatched',
          input.recordingId, input.operationId, this.clock.nowIso(), { experimental: true })) {
        throw new PronunciationError('CONFLICT');
      }
      return true;
    });
  }

  private async invalidate(claimed: PronunciationRecording, input: Readonly<{
    organizationId: string; studentId: string; recordingId: string; operationId: string }>): Promise<PronunciationView | null> {
    return this.records.transaction(async tx => {
      const current = await tx.findRecording(input.organizationId, input.recordingId);
      if (!current || current.version !== claimed.version
        || !matching(current, input.organizationId, input.studentId, input.operationId)) return null;
      const next = { ...invalidateScoreJob(current, input.operationId), workerLeaseUntil: null };
      if (!await tx.saveRecording(next, current.version)
        || !await tx.appendWorkerAudit(input.organizationId, 'pronunciation.scoreInvalidated',
          input.recordingId, input.operationId, this.clock.nowIso(), { experimental: true })) {
        throw new PronunciationError('CONFLICT');
      }
      return view(next);
    });
  }

  private sourceCurrentForScore(actor: TrustedActorContext,
    recording: PronunciationRecording): Promise<boolean> {
    return this.sources.currentForScoring
      ? this.sources.currentForScoring(actor, recording)
      : this.sources.current(actor, recording.source, true);
  }

  private async failedAttempt(claimed: PronunciationRecording, input: Readonly<{
    organizationId: string; studentId: string; recordingId: string; operationId: string }>,
    failureReason: string): Promise<PronunciationView | null> {
    const updated = await this.records.transaction(async tx => {
      const current = await tx.findRecording(input.organizationId, input.recordingId);
      if (!current || current.version !== claimed.version
        || !matching(current, input.organizationId, input.studentId, input.operationId)) return null;
      const next = { ...failScoreJobAttempt(current, input.operationId), workerLeaseUntil: null,
        lastDispatchAt: this.clock.nowIso() };
      if (!await tx.saveRecording(next, current.version)
        || !await tx.appendWorkerAudit(input.organizationId,
          `pronunciation.scoreAttempt${(current.systemRetryCount ?? 0) + 1}`,
          input.recordingId, input.operationId, this.clock.nowIso(),
          { status: next.status, retryCount: next.systemRetryCount ?? 0, experimental: true,
            failureReason })) {
        throw new PronunciationError('CONFLICT');
      }
      return next;
    });
    if (!updated) return null;
    if (updated.status === 'processing') {
      try {
        await this.dispatcher.dispatch(input);
        await this.records.transaction(async tx => {
          const current = await tx.findRecording(input.organizationId, input.recordingId);
          if (!current || current.version !== updated.version
            || !matching(current, input.organizationId, input.studentId, input.operationId)
            || current.dispatchState !== 'pending') return;
          const sent = { ...current, dispatchState: 'sent' as const,
            lastDispatchAt: this.clock.nowIso(), version: current.version + 1 };
          if (!await tx.saveRecording(sent, current.version)
            || !await tx.appendWorkerAudit(input.organizationId, 'pronunciation.retryDispatched',
              input.recordingId, input.operationId, this.clock.nowIso(), { experimental: true })) {
            throw new PronunciationError('CONFLICT');
          }
        });
      }
      catch { /* pending outbox is durable; a server-only scan can resend. */ }
    }
    return view(updated);
  }
}
