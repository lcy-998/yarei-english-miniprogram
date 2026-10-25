import type { TrustedActorContext } from '../auth/trusted-actor';

export interface ReviewVoiceTarget {
  readonly organizationId: string;
  readonly taskId: string;
  readonly assignmentId: string;
  readonly submissionId: string;
  readonly submissionVersion: number;
  readonly classId: string;
  readonly status: 'submitted' | 'reviewed' | 'returned';
}

export interface ReviewVoiceDraft {
  readonly id: string;
  readonly organizationId: string;
  readonly teacherId: string;
  readonly taskId: string;
  readonly assignmentId: string;
  readonly submissionId: string;
  readonly submissionVersion: number;
  readonly classId: string;
  readonly stagingPath: string;
  readonly status: 'draft' | 'sealed';
  readonly fileId: string | null;
  readonly contentSha256: string | null;
  readonly durationMs: number | null;
  readonly sizeBytes: number | null;
  readonly mediaVersion: number;
  readonly version: number;
  readonly createdAt: string;
  readonly sealedAt?: string | null;
  readonly expiresAt: string;
}

export interface SealedReviewVoice {
  readonly recordingId: string;
  readonly fileId: string;
  readonly contentSha256: string;
  readonly durationMs: number;
  readonly sizeBytes: number;
  readonly mediaVersion: number;
}

export interface ReviewVoiceDraftView {
  readonly recordingId: string;
  readonly submissionId: string;
  readonly submissionVersion: number;
  readonly stagingPath: string;
  readonly status: 'draft' | 'sealed';
  readonly durationMs: number | null;
  readonly version: number;
  readonly expiresAt: string;
}

export interface ReviewVoicePort {
  /** Must recheck current teacher, class grant and formal submission on every call. */
  findTarget(actor: TrustedActorContext, submissionId: string): Promise<ReviewVoiceTarget | null>;
  findDraft(recordingId: string): Promise<ReviewVoiceDraft | null>;
  findSealReceipt(organizationId: string, teacherId: string,
    operationId: string): Promise<Readonly<{ fingerprint: string; draft: ReviewVoiceDraft }> | null>;
  createDraft(draft: ReviewVoiceDraft, operationId: string): Promise<ReviewVoiceDraft>;
  sealDraft(draft: ReviewVoiceDraft, expectedVersion: number,
    operationId: string, fingerprint: string): Promise<ReviewVoiceDraft | null>;
  nextId(): string;
  /** The storage port checks exact staging path, MIME, bytes, duration, hash and server readability. */
  inspectAndSeal(stagingPath: string, stagingFileId: string): Promise<Readonly<{
    fileId: string; contentType: 'audio/mpeg' | 'audio/aac'; durationMs: number;
    sizeBytes: number; contentSha256: string;
  }> | null>;
}

export type ReviewVoiceResult<T> = Readonly<{ ok: true; data: T }>
  | Readonly<{ ok: false; code: 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION_ERROR'
    | 'CONFLICT' | 'MEDIA_INVALID' | 'SERVICE_UNAVAILABLE' }>;

const DRAFT_LIFETIME_MS = 24 * 60 * 60 * 1000;

/** Protected T-08 voice comment draft; no playback URL or provider file ID crosses the client boundary. */
export class ReviewVoiceCommentService {
  public constructor(private readonly port: ReviewVoicePort,
    private readonly clock: Readonly<{ nowIso(): string }>,
    private readonly limits: Readonly<{ maxDurationMs: number; maxBytes: number }>) {}

  public async begin(actor: TrustedActorContext, submissionId: string,
    operationId: string): Promise<ReviewVoiceResult<ReviewVoiceDraftView>> {
    if (!validId(submissionId) || !validId(operationId) || !validLimits(this.limits)) return fail('VALIDATION_ERROR');
    const target = await this.target(actor, submissionId);
    if (!target) return fail('FORBIDDEN');
    const now = this.clock.nowIso();
    const id = this.port.nextId();
    const draft = await this.port.createDraft({ id, organizationId: actor.organizationId,
      teacherId: actor.actorUserId, taskId: target.taskId,
      assignmentId: target.assignmentId, submissionId, submissionVersion: target.submissionVersion,
      classId: target.classId, stagingPath: `review-voice/${actor.organizationId}/${actor.actorUserId}/${submissionId}/${id}`,
      status: 'draft', fileId: null, contentSha256: null, durationMs: null, sizeBytes: null,
      mediaVersion: 1, version: 1, createdAt: now,
      expiresAt: new Date(Date.parse(now) + DRAFT_LIFETIME_MS).toISOString() }, operationId);
    return this.matches(draft, actor, target) ? { ok: true, data: projectDraft(draft) } : fail('CONFLICT');
  }

  public async seal(actor: TrustedActorContext, recordingId: string, stagingFileId: string,
    expectedVersion: number, operationId: string): Promise<ReviewVoiceResult<ReviewVoiceDraftView>> {
    if (!validId(recordingId) || !validId(operationId) || !Number.isSafeInteger(expectedVersion)
      || expectedVersion < 1 || !validLimits(this.limits)
      || typeof stagingFileId !== 'string' || !stagingFileId.startsWith('cloud://')) return fail('VALIDATION_ERROR');
    const current = await this.port.findDraft(recordingId);
    if (!current) return fail('NOT_FOUND');
    const target = await this.target(actor, current.submissionId);
    if (!target || !this.matches(current, actor, target)) return fail('FORBIDDEN');
    const fingerprint = JSON.stringify([recordingId, stagingFileId, expectedVersion]);
    const prior = await this.port.findSealReceipt(actor.organizationId, actor.actorUserId, operationId);
    if (prior) return prior.fingerprint === fingerprint && this.matches(prior.draft, actor, target)
      ? { ok: true, data: projectDraft(prior.draft) } : fail('CONFLICT');
    if (current.status !== 'draft' || current.version !== expectedVersion
      || Date.parse(current.expiresAt) <= Date.parse(this.clock.nowIso())) return fail('CONFLICT');
    const media = await this.port.inspectAndSeal(current.stagingPath, stagingFileId);
    if (!media || !media.fileId.startsWith('cloud://')
      || media.durationMs < 1000 || media.durationMs > this.limits.maxDurationMs
      || media.sizeBytes < 1 || media.sizeBytes > this.limits.maxBytes
      || !/^[a-f0-9]{64}$/i.test(media.contentSha256)) return fail('MEDIA_INVALID');
    const next = await this.port.sealDraft({ ...current, status: 'sealed', fileId: media.fileId,
      contentSha256: media.contentSha256.toLowerCase(), durationMs: media.durationMs,
      sizeBytes: media.sizeBytes, sealedAt: this.clock.nowIso(),
      version: current.version + 1 }, expectedVersion, operationId, fingerprint);
    return next && this.matches(next, actor, target)
      ? { ok: true, data: projectDraft(next) } : fail('CONFLICT');
  }

  /** Read again immediately before formal feedback publication. */
  public async resolveForFeedback(actor: TrustedActorContext, submissionId: string,
    submissionVersion: number, recordingId: string): Promise<SealedReviewVoice | null> {
    if (!validId(submissionId) || !validId(recordingId) || !Number.isSafeInteger(submissionVersion)) return null;
    const target = await this.target(actor, submissionId);
    const draft = await this.port.findDraft(recordingId);
    if (!target || !draft || target.submissionVersion !== submissionVersion
      || !this.matches(draft, actor, target) || draft.status !== 'sealed'
      || !draft.fileId?.startsWith('cloud://') || !draft.contentSha256
      || draft.durationMs === null || draft.sizeBytes === null
      || Date.parse(draft.expiresAt) <= Date.parse(this.clock.nowIso())) return null;
    return { recordingId: draft.id, fileId: draft.fileId,
      contentSha256: draft.contentSha256, durationMs: draft.durationMs,
      sizeBytes: draft.sizeBytes, mediaVersion: draft.mediaVersion };
  }

  private async target(actor: TrustedActorContext, submissionId: string): Promise<ReviewVoiceTarget | null> {
    return actor.actorRole === 'teacher' && actor.permissions.includes('submission.review')
      ? this.port.findTarget(actor, submissionId) : null;
  }

  private matches(draft: ReviewVoiceDraft, actor: TrustedActorContext, target: ReviewVoiceTarget): boolean {
    return draft.organizationId === actor.organizationId && draft.teacherId === actor.actorUserId
      && draft.taskId === target.taskId && draft.assignmentId === target.assignmentId
      && draft.submissionId === target.submissionId
      && draft.submissionVersion === target.submissionVersion && draft.classId === target.classId;
  }
}

function projectDraft(row: ReviewVoiceDraft): ReviewVoiceDraftView {
  return { recordingId: row.id, submissionId: row.submissionId,
    submissionVersion: row.submissionVersion, stagingPath: row.stagingPath,
    status: row.status, durationMs: row.durationMs, version: row.version,
    expiresAt: row.expiresAt };
}

function validId(value: string): boolean { return /^[A-Za-z0-9_-]{1,128}$/.test(value); }
function validLimits(value: Readonly<{ maxDurationMs: number; maxBytes: number }>): boolean {
  return Number.isSafeInteger(value.maxDurationMs) && value.maxDurationMs >= 1000
    && Number.isSafeInteger(value.maxBytes) && value.maxBytes >= 1;
}
function fail<T>(code: Extract<ReviewVoiceResult<T>, { ok: false }>['code']): ReviewVoiceResult<T> {
  return { ok: false, code };
}
