import { createHash } from 'node:crypto';
import type { TrustedActorContext } from '../auth/trusted-actor';
import { AUTONOMOUS_READING_AUDIO_RETENTION_MS, ORIGINAL_AUDIO_RETENTION_MS,
  audioExpired, originalAudioExpired, pronunciationAudioExpired } from '../media-retention/policy';
import type { PronunciationFormalSubmissionPort, PronunciationInferencePort, PronunciationPlaybackPort, PronunciationSealPort,
  PronunciationSourcePort, PronunciationUnitOfWork } from './repository';
import { scoreRecognition, VOICE_ALGORITHM_VERSION, VOICE_MODEL_VERSION } from './rules';
import { PronunciationError, type PronunciationRecording, type PronunciationSourceInput } from './types';

const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
const validOperation = (value: string): boolean => /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(value);
const id = (value: string): boolean => /^[A-Za-z0-9_-]{1,256}$/.test(value);

export interface PronunciationView {
  readonly scoreId: string;
  readonly recordingId: string;
  readonly status: PronunciationRecording['status'];
  readonly experimental: true;
  readonly score: PronunciationRecording['score'];
  readonly qualityReason: PronunciationRecording['qualityReason'];
  readonly effectiveAttemptNumber: number | null;
  readonly modelVersion: string | null;
  readonly algorithmVersion: string | null;
  readonly sourceVersion: string;
  readonly submissionVersion: number | null;
  readonly scoredAt: string | null;
  readonly expectedVersion: number;
  readonly retryable: boolean;
}

function view(record: PronunciationRecording): PronunciationView {
  return { scoreId: record.id, recordingId: record.id, status: record.status,
    experimental: true, score: record.score, qualityReason: record.qualityReason,
    effectiveAttemptNumber: record.effectiveAttemptNumber, modelVersion: record.modelVersion,
    algorithmVersion: record.algorithmVersion, sourceVersion: record.source.sourceVersion,
    submissionVersion: record.source.submissionVersion, scoredAt: record.scoredAt,
    expectedVersion: record.version,
    retryable: record.status === 'failed' && record.failureKind === 'system' && !record.mediaDeletedAt };
}

function parentSafeView(record: PronunciationRecording, submittedAt: string, at: string) {
  return { segmentId: record.source.segmentId, status: record.status,
    experimental: true as const, sourceVersion: record.source.sourceVersion,
    submissionVersion: record.source.submissionVersion,
    modelVersion: record.modelVersion, algorithmVersion: record.algorithmVersion,
    scoredAt: record.scoredAt, qualityReason: record.qualityReason,
    score: null, durationMs: record.durationMs,
    mediaExpired: Boolean(record.mediaDeletedAt) || originalAudioExpired(submittedAt, at),
    playback: null, officialScoreAvailable: false as const };
}

export class PronunciationService {
  public constructor(private readonly records: PronunciationUnitOfWork,
    private readonly sources: PronunciationSourcePort,
    private readonly sealPort: PronunciationSealPort | null,
    private readonly inference: PronunciationInferencePort | null,
    private readonly playback: PronunciationPlaybackPort | null,
    private readonly clock: { nowIso(): string },
    private readonly ids: { next(prefix: string): string },
    private readonly formalSubmissions: PronunciationFormalSubmissionPort | null = null) {}

  public async beginRecording(actor: TrustedActorContext, sourceInput: PronunciationSourceInput,
    operationId: string) {
    this.student(actor);
    if (!validOperation(operationId) || !this.validSource(sourceInput)) throw new PronunciationError('VALIDATION_ERROR');
    const source = await this.sources.resolve(actor, sourceInput, true);
    const fingerprint = hash(JSON.stringify(['beginRecording', sourceInput]));
    return this.records.transaction(async transaction => {
      const receipt = await transaction.findReceipt(actor.organizationId, actor.actorUserId, operationId);
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) throw new PronunciationError('CONFLICT');
        const existing = await transaction.findRecording(actor.organizationId, receipt.recordingId);
        if (!existing || existing.studentId !== actor.actorUserId) throw new PronunciationError('CONFLICT');
        return this.beginView(existing);
      }
      const recordingId = this.ids.next('pronunciation');
      if (!id(recordingId)) throw new PronunciationError('SERVICE_UNAVAILABLE');
      const ownerDigest = hash(JSON.stringify([actor.organizationId, actor.actorUserId]));
      const record: PronunciationRecording = { id: recordingId, organizationId: actor.organizationId,
        studentId: actor.actorUserId, platformSubjectDigest: actor.platformSubjectDigest,
        source, referenceSha256: hash(source.referenceText),
        stagingPath: `pronunciation/staging/${ownerDigest}/${recordingId}.mp3`,
        fileId: null, contentSha256: null, sizeBytes: null, durationMs: null,
        status: 'draft', score: null, qualityReason: null, modelVersion: null,
        algorithmVersion: null, scoreOperationId: null, effectiveAttemptNumber: null,
        version: 1, createdAt: this.clock.nowIso(), sealedAt: null, scoredAt: null };
      if (!await transaction.saveRecording(record, 0)
        || !await transaction.saveReceipt({ organizationId: actor.organizationId,
          actorId: actor.actorUserId, operationId, fingerprint, recordingId })) throw new PronunciationError('CONFLICT');
      if (!await transaction.appendAudit(actor, 'pronunciation.beginRecording', recordingId,
        this.clock.nowIso(), { sourceKind: source.kind })) throw new PronunciationError('SERVICE_UNAVAILABLE');
      return this.beginView(record);
    });
  }

  public async sealRecording(actor: TrustedActorContext, recordingId: string,
    stagingFileId: string, expectedVersion: number, operationId: string) {
    this.student(actor);
    if (!id(recordingId) || !stagingFileId.startsWith('cloud://')
      || expectedVersion !== 1 || !validOperation(operationId)) throw new PronunciationError('VALIDATION_ERROR');
    const fingerprint = hash(JSON.stringify(['sealRecording', recordingId, stagingFileId, expectedVersion]));
    const prepared = await this.records.transaction(async transaction => {
      const prior = await transaction.findReceipt(actor.organizationId, actor.actorUserId, operationId);
      if (prior) {
        if (prior.fingerprint !== fingerprint || prior.recordingId !== recordingId) throw new PronunciationError('CONFLICT');
        const existing = await transaction.findRecording(actor.organizationId, recordingId);
        if (!existing || existing.studentId !== actor.actorUserId) throw new PronunciationError('NOT_FOUND');
        return { completed: existing } as const;
      }
      const record = await transaction.findRecording(actor.organizationId, recordingId);
      if (!record || record.studentId !== actor.actorUserId) throw new PronunciationError('NOT_FOUND');
      if (record.status !== 'draft' || record.version !== expectedVersion
        || audioExpired(record.createdAt, this.clock.nowIso(), record.source.kind === 'reading'
          ? AUTONOMOUS_READING_AUDIO_RETENTION_MS : ORIGINAL_AUDIO_RETENTION_MS)) {
        throw new PronunciationError('CONFLICT');
      }
      return { record } as const;
    });
    if ('completed' in prepared && prepared.completed) return this.sealView(prepared.completed);
    if (!await this.sources.current(actor, prepared.record.source, true)) throw new PronunciationError('CONFLICT');
    if (!this.sealPort) throw new PronunciationError('SERVICE_UNAVAILABLE');
    const sealed = await this.sealPort.seal({ stagingFileId, stagingPath: prepared.record.stagingPath,
      organizationId: actor.organizationId, studentId: actor.actorUserId, recordingId });
    if (!sealed.fileId || !/^[a-f0-9]{64}$/.test(sealed.contentSha256)
      || !Number.isSafeInteger(sealed.sizeBytes) || sealed.sizeBytes < 1 || sealed.sizeBytes > 20 * 1024 * 1024
      || !Number.isSafeInteger(sealed.durationMs) || sealed.durationMs < 1000 || sealed.durationMs > 300000) {
      throw new PronunciationError('MEDIA_INVALID');
    }
    return this.records.transaction(async transaction => {
      const prior = await transaction.findReceipt(actor.organizationId, actor.actorUserId, operationId);
      if (prior) {
        if (prior.fingerprint !== fingerprint || prior.recordingId !== recordingId) throw new PronunciationError('CONFLICT');
        const existing = await transaction.findRecording(actor.organizationId, recordingId);
        if (!existing) throw new PronunciationError('CONFLICT');
        return this.sealView(existing);
      }
      const current = await transaction.findRecording(actor.organizationId, recordingId);
      if (!current || current.studentId !== actor.actorUserId || current.status !== 'draft'
        || current.version !== expectedVersion
        || audioExpired(current.createdAt, this.clock.nowIso(), current.source.kind === 'reading'
          ? AUTONOMOUS_READING_AUDIO_RETENTION_MS : ORIGINAL_AUDIO_RETENTION_MS)) {
        throw new PronunciationError('CONFLICT');
      }
      if (!await this.sources.current(actor, current.source, true)) throw new PronunciationError('CONFLICT');
      const updated: PronunciationRecording = { ...current, ...sealed, status: 'sealed',
        version: current.version + 1, sealedAt: this.clock.nowIso() };
      if (!await transaction.saveRecording(updated, current.version)
        || !await transaction.saveReceipt({ organizationId: actor.organizationId,
          actorId: actor.actorUserId, operationId, fingerprint, recordingId })
        || !await transaction.appendAudit(actor, 'pronunciation.sealRecording', recordingId,
          this.clock.nowIso(), { durationMs: sealed.durationMs, sizeBytes: sealed.sizeBytes })) {
        throw new PronunciationError('CONFLICT');
      }
      return this.sealView(updated);
    });
  }

  public async beginScore(actor: TrustedActorContext, recordingId: string,
    expectedVersion: number, operationId: string): Promise<PronunciationView> {
    this.student(actor);
    if (!id(recordingId) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 2
      || !validOperation(operationId)) throw new PronunciationError('VALIDATION_ERROR');
    const fingerprint = hash(JSON.stringify(['beginScore', recordingId]));
    const before = await this.records.transaction(async transaction => {
      const prior = await transaction.findReceipt(actor.organizationId, actor.actorUserId, operationId);
      if (prior && (prior.fingerprint !== fingerprint || prior.recordingId !== recordingId)) {
        throw new PronunciationError('CONFLICT');
      }
      const record = await transaction.findRecording(actor.organizationId, recordingId);
      if (!record || record.studentId !== actor.actorUserId) throw new PronunciationError('NOT_FOUND');
      if (record.status === 'processing') {
        if (record.scoreOperationId !== operationId) throw new PronunciationError('CONFLICT');
        return { complete: record } as const;
      }
      if (prior && record.scoreOperationId === operationId) return { complete: record } as const;
      if (record.status === 'scored' || record.status === 'unreliable') {
        if (!prior && !await transaction.saveReceipt({ organizationId: actor.organizationId,
          actorId: actor.actorUserId, operationId, fingerprint, recordingId })) throw new PronunciationError('CONFLICT');
        return { complete: record } as const;
      }
      if ((record.status !== 'sealed' && record.status !== 'failed')
        || (record.status === 'failed' && record.failureKind !== 'system')
        || record.version !== expectedVersion
        || !record.fileId || !record.contentSha256 || !record.sizeBytes || !record.durationMs) {
        throw new PronunciationError('CONFLICT');
      }
      if (record.source.kind === 'task') {
        const all = await transaction.listRecordings(actor.organizationId, actor.actorUserId);
        if (all.filter(candidate => candidate.status === 'scored'
          && candidate.source.taskId === record.source.taskId
          && candidate.source.itemId === record.source.itemId).length >= 5) {
          throw new PronunciationError('CONFLICT');
        }
      }
      return { record } as const;
    });
    if ('complete' in before && before.complete) return view(before.complete);
    const candidate = before.record;
    if (!await this.sources.current(actor, candidate.source, true)) throw new PronunciationError('CONFLICT');
    if (!this.inference) throw new PronunciationError('SERVICE_UNAVAILABLE');
    let recognition;
    try {
      recognition = await this.inference.infer({ operationId, recordingId,
        fileId: candidate.fileId!, contentSha256: candidate.contentSha256!,
        sizeBytes: candidate.sizeBytes!, durationMs: candidate.durationMs! });
    } catch (error: unknown) {
      const invalid = error instanceof PronunciationError && error.code === 'MEDIA_INVALID';
      await this.markFailed(actor, candidate, operationId, invalid ? 'invalidated' : 'system');
      if (invalid) throw error;
      throw new PronunciationError('SERVICE_UNAVAILABLE');
    }
    if (recognition.modelVersion !== VOICE_MODEL_VERSION
      || Math.abs(recognition.durationMs - candidate.durationMs!) > 1000) {
      await this.markFailed(actor, candidate, operationId, 'system');
      throw new PronunciationError('SERVICE_UNAVAILABLE');
    }
    const decision = scoreRecognition(candidate.source.referenceText, recognition);
    return this.records.transaction(async transaction => {
      const prior = await transaction.findReceipt(actor.organizationId, actor.actorUserId, operationId);
      if (prior && (prior.fingerprint !== fingerprint || prior.recordingId !== recordingId)) {
        throw new PronunciationError('CONFLICT');
      }
      const current = await transaction.findRecording(actor.organizationId, recordingId);
      if (!current || current.studentId !== actor.actorUserId) throw new PronunciationError('NOT_FOUND');
      if (current.status === 'scored' || current.status === 'unreliable') return view(current);
      if (current.version !== candidate.version || current.contentSha256 !== candidate.contentSha256
        || !await this.sources.current(actor, current.source, true)) throw new PronunciationError('CONFLICT');
      const all = await transaction.listRecordings(actor.organizationId, actor.actorUserId);
      const effective = all.filter(record => record.status === 'scored'
        && record.source.kind === 'task' && record.source.taskId === current.source.taskId
        && record.source.itemId === current.source.itemId).length;
      if (decision.status === 'scored' && current.source.kind === 'task' && effective >= 5) {
        throw new PronunciationError('CONFLICT');
      }
      const updated: PronunciationRecording = { ...current, status: decision.status,
        score: decision.status === 'scored' ? decision.score : null,
        failureKind: null,
        qualityReason: decision.status === 'unreliable' ? decision.qualityReason : null,
        modelVersion: VOICE_MODEL_VERSION, algorithmVersion: VOICE_ALGORITHM_VERSION,
        scoreOperationId: operationId,
        effectiveAttemptNumber: decision.status === 'scored' && current.source.kind === 'task'
          ? effective + 1 : null,
        version: current.version + 1, scoredAt: this.clock.nowIso() };
      if (!await transaction.saveRecording(updated, current.version)
        || (!prior && !await transaction.saveReceipt({ organizationId: actor.organizationId,
          actorId: actor.actorUserId, operationId, fingerprint, recordingId }))
        || !await transaction.appendAudit(actor, 'pronunciation.beginScore', recordingId,
          this.clock.nowIso(), { outcome: decision.status, experimental: true,
            submissionVersion: current.source.submissionVersion })) throw new PronunciationError('CONFLICT');
      return view(updated);
    });
  }

  public async getScore(actor: TrustedActorContext, recordingId: string): Promise<PronunciationView> {
    this.student(actor);
    if (!id(recordingId)) throw new PronunciationError('VALIDATION_ERROR');
    const record = await this.records.transaction(transaction => transaction.findRecording(actor.organizationId, recordingId));
    if (!record || record.studentId !== actor.actorUserId) throw new PronunciationError('NOT_FOUND');
    return view(record);
  }

  public async listAttempts(actor: TrustedActorContext, input: PronunciationSourceInput): Promise<readonly PronunciationView[]> {
    this.student(actor);
    if (!this.validSource(input)) throw new PronunciationError('VALIDATION_ERROR');
    const source = await this.sources.resolve(actor, input, false);
    // Autonomous reading scores are intentionally transient from the student's point of view.
    if (source.kind === 'reading') return [];
    const all = await this.records.transaction(transaction => transaction.listRecordings(actor.organizationId, actor.actorUserId));
    return all.filter(record => record.source.kind === source.kind
      && record.source.resourceId === source.resourceId && record.source.segmentId === source.segmentId
      && record.source.taskId === source.taskId && record.source.itemId === source.itemId
      && record.source.sourceVersion === source.sourceVersion)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt)).map(view);
  }

  public async listMyWorks(actor: TrustedActorContext,
    input: Readonly<{ cursor: string | null; limit: number }>) {
    this.student(actor);
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 30
      || (input.cursor !== null && !/^\d{1,6}$/.test(input.cursor))) {
      throw new PronunciationError('VALIDATION_ERROR');
    }
    const offset = input.cursor === null ? 0 : Number(input.cursor);
    const all = await this.records.transaction(tx => tx.listRecordings(actor.organizationId, actor.actorUserId));
    const ordered = all.filter(record => record.status !== 'draft')
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
    const selected = ordered.slice(offset, offset + input.limit);
    const items = await Promise.all(selected.map(async record => {
      const submittedAt = record.source.kind === 'task' && this.formalSubmissions
        ? await this.formalSubmissions.submittedAt(record) : null;
      const mediaExpired = Boolean(record.mediaDeletedAt)
        || pronunciationAudioExpired(record.source.kind, submittedAt, record.sealedAt, this.clock.nowIso());
      const autonomousReading = record.source.kind === 'reading';
      return { scoreId: record.id, recordingId: record.id,
        source: record.source.kind === 'task'
          ? { kind: 'task' as const, taskId: record.source.taskId!, itemId: record.source.itemId!,
            segmentId: record.source.segmentId }
          : { kind: 'reading' as const, resourceId: record.source.resourceId,
            segmentId: record.source.segmentId },
        displayTitle: record.source.displayTitle ?? '跟读练习',
        referencePreview: record.source.referenceText, status: autonomousReading ? 'sealed' as const : record.status,
        experimental: true as const, score: !autonomousReading && record.status === 'scored' ? record.score : null,
        qualityReason: !autonomousReading && record.status === 'unreliable' ? record.qualityReason : null,
        modelVersion: autonomousReading ? null : record.modelVersion,
        algorithmVersion: autonomousReading ? null : record.algorithmVersion,
        scoredAt: autonomousReading ? null : record.scoredAt, expectedVersion: record.version,
        submissionVersion: record.source.submissionVersion,
        retryable: !autonomousReading && record.status === 'failed'
          && record.failureKind === 'system' && !record.mediaDeletedAt,
        mediaExpired: record.source.kind === 'reading' || submittedAt ? mediaExpired
          : record.mediaDeletedAt ? true : null,
        playbackAvailable: Boolean(record.fileId && !mediaExpired && this.playback) };
    }));
    const next = offset + selected.length;
    return { items, nextCursor: next < ordered.length ? String(next) : null };
  }

  public async getMyPlayback(actor: TrustedActorContext, recordingId: string) {
    this.student(actor);
    if (!id(recordingId)) throw new PronunciationError('VALIDATION_ERROR');
    const record = await this.records.transaction(tx => tx.findRecording(actor.organizationId, recordingId));
    if (!record || record.studentId !== actor.actorUserId) throw new PronunciationError('NOT_FOUND');
    const submittedAt = record.source.kind === 'task' && this.formalSubmissions
      ? await this.formalSubmissions.submittedAt(record) : null;
    const mediaExpired = Boolean(record.mediaDeletedAt)
      || pronunciationAudioExpired(record.source.kind, submittedAt, record.sealedAt, this.clock.nowIso());
    const temporaryUrl = !mediaExpired && record.fileId && record.status !== 'draft' && this.playback
      ? await this.playback.temporaryUrl(record.fileId) : null;
    await this.records.transaction(async tx => {
      if (!await tx.appendAudit(actor, 'pronunciation.getMyPlayback', recordingId,
        this.clock.nowIso(), { mediaExpired, playbackIssued: temporaryUrl !== null })) {
        throw new PronunciationError('SERVICE_UNAVAILABLE');
      }
    });
    return { scoreId: record.id, mediaExpired: record.source.kind === 'reading' || submittedAt ? mediaExpired
      : record.mediaDeletedAt ? true : null,
      playback: temporaryUrl ? { temporaryUrl,
        expiresAt: new Date(Date.parse(this.clock.nowIso()) + 60000).toISOString() } : null };
  }

  public async getTeacherEvidence(actor: TrustedActorContext, input: Readonly<{
    taskId: string; assignmentId: string; submissionVersion: number; itemId: string; segmentId: string }>) {
    if (actor.actorRole !== 'teacher') throw new PronunciationError('FORBIDDEN');
    if (![input.taskId, input.assignmentId, input.itemId, input.segmentId].every(id)
      || !Number.isSafeInteger(input.submissionVersion) || input.submissionVersion < 1) {
      throw new PronunciationError('VALIDATION_ERROR');
    }
    const all = await this.records.transaction(transaction => transaction.listSubmissionRecordings(
      actor.organizationId, input.taskId, input.assignmentId, input.submissionVersion));
    const relevant = all.filter(record => record.source.taskId === input.taskId
      && record.source.assignmentId === input.assignmentId
      && record.source.submissionVersion === input.submissionVersion
      && record.source.itemId === input.itemId && record.source.segmentId === input.segmentId
      && record.status !== 'draft' && record.status !== 'sealed');
    let latest: PronunciationRecording | null = null;
    let submittedAt: string | null = null;
    let bestScore: PronunciationRecording['score'] = null;
    for (const candidate of relevant.sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
      const formalSubmissionTime = await this.sources.teacherSubmittedAt(actor, candidate, input.submissionVersion);
      if (formalSubmissionTime && candidate.status === 'scored' && candidate.score
        && (!bestScore || candidate.score.total > bestScore.total)) bestScore = candidate.score
      if (formalSubmissionTime && !latest) {
        latest = candidate;
        submittedAt = formalSubmissionTime;
      }
    }
    if (!latest || !submittedAt) throw new PronunciationError('NOT_FOUND');
    const mediaExpired = Boolean(latest.mediaDeletedAt)
      || originalAudioExpired(submittedAt, this.clock.nowIso());
    const playback = !mediaExpired && latest.fileId && this.playback
      ? await this.playback.temporaryUrl(latest.fileId) : null;
    await this.records.transaction(async transaction => {
      if (!await transaction.appendAudit(actor, 'pronunciation.getTeacherEvidence', latest.id,
        this.clock.nowIso(), { submissionVersion: input.submissionVersion, playbackIssued: playback !== null })) {
        throw new PronunciationError('SERVICE_UNAVAILABLE');
      }
    });
    return { ...view(latest), bestScore, durationMs: latest.durationMs, mediaExpired,
      playback: playback ? { temporaryUrl: playback,
        expiresAt: new Date(Date.parse(this.clock.nowIso()) + 60000).toISOString() } : null };
  }

  public async getParentEvidence(actor: TrustedActorContext, input: Readonly<{
    studentId: string; taskId: string; assignmentId: string; submissionVersion: number;
    itemId: string; segmentId: string }>) {
    if (actor.actorRole !== 'parent') throw new PronunciationError('FORBIDDEN');
    if (![input.studentId, input.taskId, input.assignmentId, input.itemId, input.segmentId].every(id)
      || !Number.isSafeInteger(input.submissionVersion) || input.submissionVersion < 1) {
      throw new PronunciationError('VALIDATION_ERROR');
    }
    const all = await this.records.transaction(tx => tx.listSubmissionRecordings(
      actor.organizationId, input.taskId, input.assignmentId, input.submissionVersion));
    const relevant = all.filter(record => record.studentId === input.studentId
      && record.source.taskId === input.taskId && record.source.assignmentId === input.assignmentId
      && record.source.submissionVersion === input.submissionVersion
      && record.source.itemId === input.itemId && record.source.segmentId === input.segmentId
      && record.status !== 'draft' && record.status !== 'sealed');
    let latest: PronunciationRecording | null = null;
    let submittedAt: string | null = null;
    for (const candidate of relevant.sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
      const formalTime = await this.sources.parentSubmittedAt(actor, candidate, input.submissionVersion);
      if (formalTime) { latest = candidate; submittedAt = formalTime; break; }
    }
    if (!latest || !submittedAt) throw new PronunciationError('NOT_FOUND');
    await this.records.transaction(async tx => {
      if (!await tx.appendAudit(actor, 'pronunciation.getParentEvidence', latest.id,
        this.clock.nowIso(), { submissionVersion: input.submissionVersion,
          experimental: true, scoreHidden: true })) throw new PronunciationError('SERVICE_UNAVAILABLE');
    });
    return parentSafeView(latest, submittedAt, this.clock.nowIso());
  }

  public async listParentEvidence(actor: TrustedActorContext, input: Readonly<{
    studentId: string; taskId: string; assignmentId: string; submissionVersion: number;
    itemId: string }>) {
    if (actor.actorRole !== 'parent') throw new PronunciationError('FORBIDDEN');
    if (![input.studentId, input.taskId, input.assignmentId, input.itemId].every(id)
      || !Number.isSafeInteger(input.submissionVersion) || input.submissionVersion < 1) {
      throw new PronunciationError('VALIDATION_ERROR');
    }
    const authorized = await this.sources.parentSubmissionRecordingIds(actor, input);
    if (!authorized) throw new PronunciationError('NOT_FOUND');
    if (authorized.recordingIds.length > 100) throw new PronunciationError('SERVICE_UNAVAILABLE');
    const all = await this.records.transaction(tx => tx.listSubmissionRecordings(
      actor.organizationId, input.taskId, input.assignmentId, input.submissionVersion));
    const byId = new Map(all.filter(record => record.studentId === input.studentId
      && record.source.kind === 'task' && record.source.taskId === input.taskId
      && record.source.assignmentId === input.assignmentId
      && record.source.submissionVersion === input.submissionVersion
      && record.source.itemId === input.itemId && record.status !== 'draft')
      .map(record => [record.id, record]));
    const seenSegments = new Set<string>();
    const items = [] as ReturnType<typeof parentSafeView>[];
    let missingReferenceCount = 0;
    for (const recordingId of authorized.recordingIds) {
      const record = byId.get(recordingId);
      if (!record) { missingReferenceCount += 1; continue; }
      if (seenSegments.has(record.source.segmentId)) continue;
      seenSegments.add(record.source.segmentId);
      items.push(parentSafeView(record, authorized.submittedAt, this.clock.nowIso()));
    }
    await this.records.transaction(async tx => {
      if (!await tx.appendAudit(actor, 'pronunciation.listParentEvidence', input.taskId,
        this.clock.nowIso(), { submissionVersion: input.submissionVersion,
          itemCount: items.length, missingReferenceCount, experimental: true,
          scoreHidden: true })) throw new PronunciationError('SERVICE_UNAVAILABLE');
    });
    return { items, missingReferenceCount };
  }

  private async markFailed(actor: TrustedActorContext, record: PronunciationRecording,
    operationId: string, failureKind: 'system' | 'invalidated'): Promise<void> {
    await this.records.transaction(async transaction => {
      const current = await transaction.findRecording(actor.organizationId, record.id);
      if (!current || current.version !== record.version || current.status !== record.status) return;
      const prior = await transaction.findReceipt(actor.organizationId, actor.actorUserId, operationId);
      if (prior && prior.recordingId !== record.id) return;
      const saved = await transaction.saveRecording({ ...current, status: 'failed', failureKind,
        scoreOperationId: operationId,
        version: current.version + 1 }, current.version);
      if (!saved) return;
      if (!prior) await transaction.saveReceipt({ organizationId: actor.organizationId,
        actorId: actor.actorUserId, operationId,
        fingerprint: hash(JSON.stringify(['beginScore', record.id])), recordingId: record.id });
      await transaction.appendAudit(actor, 'pronunciation.beginScore', record.id,
        this.clock.nowIso(), { outcome: 'failed', experimental: true });
    });
  }

  private validSource(source: PronunciationSourceInput): boolean {
    return source.kind === 'task'
      ? id(source.taskId) && id(source.itemId) && id(source.segmentId)
      : id(source.resourceId) && id(source.segmentId);
  }
  private beginView(record: PronunciationRecording) {
    return { recordingId: record.id, stagingPath: record.stagingPath,
      expectedVersion: record.version, source: record.source.kind === 'task'
        ? { kind: 'task' as const, taskId: record.source.taskId!, itemId: record.source.itemId!,
          segmentId: record.source.segmentId }
        : { kind: 'reading' as const, resourceId: record.source.resourceId, segmentId: record.source.segmentId },
      referencePreview: record.source.referenceText,
      durationLimits: { minMs: 1000, maxMs: 300000, maxBytes: 20 * 1024 * 1024 } };
  }
  private sealView(record: PronunciationRecording) {
    return { recordingId: record.id, expectedVersion: record.version, durationMs: record.durationMs };
  }
  private student(actor: TrustedActorContext): void {
    if (actor.actorRole !== 'student') throw new PronunciationError('FORBIDDEN');
  }
}
