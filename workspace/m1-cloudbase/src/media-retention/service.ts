import { createHash } from 'node:crypto';
import type { DocumentDatabasePort, VersionedDocument } from '../repositories/document-database-port';
import { AUTONOMOUS_READING_AUDIO_RETENTION_MS, DUBBING_AUDIO_RETENTION_MS,
  ORIGINAL_AUDIO_RETENTION_MS, TEACHER_VOICE_COMMENT_RETENTION_MS } from './policy';

export type RetainedRecordingKind = 'student_work' | 'task_recording' | 'pronunciation'
  | 'task_dubbing' | 'teacher_voice' | 'teacher_voice_draft';
export type RetentionJobStatus = 'planned' | 'deleting' | 'failed' | 'completed' | 'stale';
export interface RetentionStoragePort {
  /** A missing object is a successful idempotent retry after an interrupted deletion. */
  deleteFile(fileId: string): Promise<'deleted' | 'not_found'>;
}
export interface PronunciationSubmissionLookup {
  /** Only a formal task submission containing this exact recording starts its 60-day clock. */
  submittedAt(record: VersionedDocument): Promise<string | null>;
}
export interface DubbingSubmissionLookup {
  submittedAt(record: VersionedDocument): Promise<string | null>;
}
export interface RetentionJobView {
  readonly id: string;
  readonly kind: RetainedRecordingKind;
  readonly sourceId: string;
  readonly organizationId: string;
  readonly status: RetentionJobStatus;
  readonly eligibleAt: string;
}

const LEASE_MS = 5 * 60_000;
const JOBS = 'media_retention_jobs';
const AUDIT = 'operation_logs';
const COLLECTION: Readonly<Record<RetainedRecordingKind, string>> = {
  student_work: 'student_works', task_recording: 'task_recordings',
  pronunciation: 'pronunciation_recordings', task_dubbing: 'task_dubbing_works',
  teacher_voice: 'review_feedback', teacher_voice_draft: 'review_voice_drafts',
};

function time(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function digest(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function jobId(kind: RetainedRecordingKind, record: VersionedDocument, eligibleAt: string): string {
  return `media_retention_${digest(JSON.stringify([kind, record.organizationId, record._id, eligibleAt]))}`;
}
function voiceComment(record: VersionedDocument): Record<string, unknown> | null {
  const value = record.voiceComment;
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function sourceFileId(kind: RetainedRecordingKind, record: VersionedDocument): string | null {
  const value = kind === 'teacher_voice' ? voiceComment(record)?.fileId : record.fileId;
  return typeof value === 'string' ? value : null;
}
function sourceSha(kind: RetainedRecordingKind, record: VersionedDocument): string | null {
  const value = kind === 'teacher_voice' ? voiceComment(record)?.sha256 : record.contentSha256;
  return typeof value === 'string' ? value : null;
}
function expectedFileId(kind: RetainedRecordingKind, record: VersionedDocument, environmentId: string): string | null {
  if (kind === 'teacher_voice_draft') {
    if (typeof record.stagingPath !== 'string' || typeof record.teacherId !== 'string'
      || typeof record.submissionId !== 'string' || typeof record.contentSha256 !== 'string'
      || typeof record.fileId !== 'string' || !/^[a-f0-9]{64}$/.test(record.contentSha256)
      || record.stagingPath !== `review-voice/${record.organizationId}/${record.teacherId}/${record.submissionId}/${record._id}`) return null;
    const extension = /\.(mp3|aac)$/.exec(record.fileId)?.[1];
    return extension ? `cloud://${environmentId}/review-voice/private/${digest(record.stagingPath).slice(0, 32)}/${record.contentSha256}.${extension}` : null;
  }
  if (kind === 'teacher_voice') {
    const voice = voiceComment(record);
    if (!voice || typeof record.teacherId !== 'string' || typeof record.submissionId !== 'string'
      || typeof voice.recordingId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(voice.recordingId)
      || ![record.organizationId, record.teacherId, record.submissionId].every(value => /^[A-Za-z0-9_-]+$/.test(value))
      || typeof voice.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(voice.sha256)
      || typeof voice.fileId !== 'string') return null;
    const extension = /\.(mp3|aac)$/.exec(voice.fileId)?.[1];
    const stagingPath = `review-voice/${record.organizationId}/${record.teacherId}/${record.submissionId}/${voice.recordingId}`;
    return extension ? `cloud://${environmentId}/review-voice/private/${digest(stagingPath).slice(0, 32)}/${voice.sha256}.${extension}` : null;
  }
  if (typeof record.id !== 'string' || record.id !== record._id
    || typeof record.studentId !== 'string' || typeof record.contentSha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(record.contentSha256)
    || !/^[A-Za-z0-9_-]{8,128}$/.test(record.id)
    || typeof record.organizationId !== 'string') return null;
  const ownerDigest = digest(JSON.stringify([record.organizationId, record.studentId]));
  if (kind === 'task_dubbing') {
    if (typeof record.stagingPath !== 'string'
      || !/^task-dubbing\/staging\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(record.stagingPath)
      || !record.stagingPath.startsWith(`task-dubbing/staging/${record.organizationId}/${record.studentId}/`)
      || typeof record.fileId !== 'string') return null;
    const extension = /\.(mp3|aac)$/.exec(record.fileId)?.[1];
    return extension ? `cloud://${environmentId}/task-dubbing/private/${digest(record.stagingPath).slice(0, 32)}/${record.contentSha256}.${extension}` : null;
  }
  const prefix = kind === 'student_work' ? 'student-works'
    : kind === 'task_recording' ? 'task-recordings' : 'pronunciation';
  const extension = kind === 'pronunciation' ? 'mp3'
    : typeof record.fileId === 'string' ? /\.(mp3|aac)$/.exec(record.fileId)?.[1] : null;
  return extension
    ? `cloud://${environmentId}/${prefix}/private/${ownerDigest}/${record.id}/${record.contentSha256}.${extension}`
    : null;
}
function retentionAnchor(kind: RetainedRecordingKind, record: VersionedDocument,
  formalSubmittedAt: string | null): Readonly<{ at: string | null; durationMs: number }> {
  if (kind === 'teacher_voice') return {
    at: typeof record.publishedAt === 'string' ? record.publishedAt : null,
    durationMs: TEACHER_VOICE_COMMENT_RETENTION_MS,
  };
  if (kind === 'teacher_voice_draft') return {
    at: typeof record.sealedAt === 'string' ? record.sealedAt
      : typeof record.createdAt === 'string' ? record.createdAt : null,
    durationMs: TEACHER_VOICE_COMMENT_RETENTION_MS,
  };
  if (kind === 'pronunciation') {
    const source = record.source;
    const reading = source !== null && typeof source === 'object' && !Array.isArray(source)
      && (source as Record<string, unknown>).kind === 'reading';
    return reading
      ? { at: typeof record.sealedAt === 'string' ? record.sealedAt : null,
        durationMs: AUTONOMOUS_READING_AUDIO_RETENTION_MS }
      : { at: formalSubmittedAt, durationMs: ORIGINAL_AUDIO_RETENTION_MS };
  }
  return { at: kind === 'task_dubbing' ? formalSubmittedAt
      ?? (typeof record.submittedAt === 'string' ? record.submittedAt : null)
    : typeof record.submittedAt === 'string' ? record.submittedAt : null,
    durationMs: kind === 'student_work' || kind === 'task_dubbing'
      ? DUBBING_AUDIO_RETENTION_MS : ORIGINAL_AUDIO_RETENTION_MS };
}
function eligiblePronunciationStatus(record: VersionedDocument): boolean {
  const source = record.source;
  const reading = source !== null && typeof source === 'object' && !Array.isArray(source)
    && (source as Record<string, unknown>).kind === 'reading';
  return (reading ? ['sealed', 'processing', 'scored', 'unreliable', 'failed']
    : ['scored', 'unreliable']).includes(String(record.status));
}
function validSource(kind: RetainedRecordingKind, record: VersionedDocument | null,
  environmentId: string, nowMs: number, formalSubmittedAt: string | null = null): record is VersionedDocument {
  if (!record || record.deletedAt !== null
    || (kind === 'teacher_voice' ? false : kind === 'teacher_voice_draft' ? record.status !== 'sealed'
      : kind === 'pronunciation' ? !eligiblePronunciationStatus(record)
      : record.status !== 'submitted')
    || (kind === 'teacher_voice' ? voiceComment(record)?.mediaDeletedAt != null
      : record.mediaDeletedAt !== undefined && record.mediaDeletedAt !== null)
    || sourceFileId(kind, record) === null) return false;
  const anchor = retentionAnchor(kind, record, formalSubmittedAt);
  if (time(anchor.at) === null || nowMs < (time(anchor.at) ?? Infinity) + anchor.durationMs) return false;
  const expected = expectedFileId(kind, record, environmentId);
  if (!expected) return false;
  const fileId = sourceFileId(kind, record);
  if (!fileId) return false;
  // CloudBase may append a bucket suffix to the environment segment.
  const match = /^cloud:\/\/([^/]+)\/(.+)$/.exec(fileId);
  const expectedPath = expected.slice(`cloud://${environmentId}/`.length);
  return Boolean(match && (match[1] === environmentId || match[1]?.startsWith(`${environmentId}.`))
    && match[2] === expectedPath);
}
function view(job: VersionedDocument): RetentionJobView {
  if ((job.kind !== 'student_work' && job.kind !== 'task_recording'
    && job.kind !== 'pronunciation' && job.kind !== 'task_dubbing'
    && job.kind !== 'teacher_voice' && job.kind !== 'teacher_voice_draft')
    || typeof job.sourceId !== 'string' || typeof job.eligibleAt !== 'string'
    || !['planned', 'deleting', 'failed', 'completed', 'stale'].includes(String(job.status))) {
    throw new Error('Invalid retention job');
  }
  return { id: job._id, kind: job.kind, sourceId: job.sourceId,
    organizationId: job.organizationId, status: job.status as RetentionJobStatus,
    eligibleAt: job.eligibleAt };
}

/** Server-only maintenance component. It never accepts a caller-supplied file ID for deletion. */
export class MediaRetentionService {
  public constructor(private readonly database: DocumentDatabasePort,
    private readonly storage: RetentionStoragePort,
    private readonly environmentId: string,
    private readonly clock: { nowIso(): string },
    private readonly pronunciationSubmissions: PronunciationSubmissionLookup | null = null,
    private readonly dubbingSubmissions: DubbingSubmissionLookup | null = null) {
    if (!/^[A-Za-z0-9_-]+$/.test(environmentId)) throw new Error('Invalid environment ID');
  }

  public async planBatch(kind: RetainedRecordingKind, organizationId: string,
    offset: number, limit = 25): Promise<Readonly<{ scanned: number; planned: number; hasMore: boolean }>> {
    if (!organizationId.trim() || !Number.isSafeInteger(offset) || offset < 0
      || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error('Invalid retention page');
    const query: Record<string, string | null> = { organizationId, deletedAt: null };
    if (kind === 'teacher_voice_draft') query.status = 'sealed';
    else if (kind !== 'pronunciation' && kind !== 'teacher_voice') query.status = 'submitted';
    const page = await this.database.findPage(COLLECTION[kind], query,
      { limit, offset });
    let planned = 0;
    for (const record of page.items) {
      if (record.organizationId !== organizationId) throw new Error('Cross-organization retention scan');
      if (await this.planOne(kind, record)) planned += 1;
    }
    return { scanned: page.items.length, planned, hasMore: page.hasMore };
  }

  private async planOne(kind: RetainedRecordingKind, candidate: VersionedDocument): Promise<boolean> {
    const now = this.clock.nowIso();
    const nowMs = time(now);
    const submittedAt = kind === 'pronunciation'
      ? await this.pronunciationSubmissions?.submittedAt(candidate) ?? null
      : kind === 'task_dubbing' ? await this.dubbingSubmissions?.submittedAt(candidate) ?? null : null;
    if (nowMs === null || !validSource(kind, candidate, this.environmentId, nowMs, submittedAt)) return false;
    if (kind === 'teacher_voice_draft' && await this.referencedByFeedback(candidate)) return false;
    return this.database.runTransaction(async tx => {
      const current = await tx.get(COLLECTION[kind], candidate._id);
      const currentSubmittedAt = kind === 'pronunciation' && current
        ? await this.pronunciationSubmissions?.submittedAt(current) ?? null
        : kind === 'task_dubbing' && current
          ? await this.dubbingSubmissions?.submittedAt(current) ?? null : null;
      if (!current || current.organizationId !== candidate.organizationId
        || !validSource(kind, current, this.environmentId, nowMs, currentSubmittedAt)) return false;
      if (kind === 'teacher_voice_draft' && await this.referencedByFeedback(current, tx)) return false;
      const anchor = retentionAnchor(kind, current, currentSubmittedAt);
      const eligibleAt = new Date((time(anchor.at) ?? 0) + anchor.durationMs).toISOString();
      const id = jobId(kind, current, eligibleAt);
      const existing = await tx.get(JOBS, id);
      if (existing && (existing.organizationId !== current.organizationId || existing.status !== 'stale')) return false;
      const plan = { _id: id, organizationId: current.organizationId,
        schemaVersion: 1 as const, version: 1, deletedAt: null, kind, sourceId: current._id,
        fileId: sourceFileId(kind, current), contentSha256: sourceSha(kind, current),
        status: 'planned', eligibleAt, plannedAt: now, attempts: 0, leaseUntil: null };
      return existing
        ? tx.replace(JOBS, id, existing.version, { ...plan, version: existing.version + 1 })
        : tx.create(JOBS, plan);
    });
  }

  public async execute(jobIdValue: string): Promise<RetentionJobView> {
    const now = this.clock.nowIso();
    const nowMs = time(now);
    if (nowMs === null || !jobIdValue.startsWith('media_retention_')) throw new Error('Invalid retention request');
    const claimed = await this.database.runTransaction(async tx => {
      const job = await tx.get(JOBS, jobIdValue);
      if (!job || job.deletedAt !== null) throw new Error('Retention job missing');
      const currentView = view(job);
      if (currentView.status === 'completed' || currentView.status === 'stale') return { terminal: currentView } as const;
      if (currentView.status === 'deleting' && (time(job.leaseUntil) ?? Infinity) > nowMs) {
        return { busy: currentView } as const;
      }
      const source = await tx.get(COLLECTION[currentView.kind], currentView.sourceId);
      const submittedAt = currentView.kind === 'pronunciation' && source
        ? await this.pronunciationSubmissions?.submittedAt(source) ?? null
        : currentView.kind === 'task_dubbing' && source
          ? await this.dubbingSubmissions?.submittedAt(source) ?? null : null;
      if (!source || source.organizationId !== job.organizationId
        || sourceFileId(currentView.kind, source) !== job.fileId
        || sourceSha(currentView.kind, source) !== job.contentSha256
        || !validSource(currentView.kind, source, this.environmentId, nowMs, submittedAt)
        || new Date((time(retentionAnchor(currentView.kind, source, submittedAt).at) ?? 0)
          + retentionAnchor(currentView.kind, source, submittedAt).durationMs).toISOString() !== job.eligibleAt) {
        const stale = { ...job, version: job.version + 1, status: 'stale', finishedAt: now };
        if (!await tx.replace(JOBS, job._id, job.version, stale)) throw new Error('Retention job conflict');
        return { terminal: view(stale) } as const;
      }
      if (currentView.kind === 'teacher_voice_draft' && await this.referencedByFeedback(source, tx)) {
        const stale = { ...job, version: job.version + 1, status: 'stale', finishedAt: now };
        if (!await tx.replace(JOBS, job._id, job.version, stale)) throw new Error('Retention job conflict');
        return { terminal: view(stale) } as const;
      }
      const next = { ...job, version: job.version + 1, status: 'deleting',
        leaseUntil: new Date(nowMs + LEASE_MS).toISOString(), attempts: Number(job.attempts) + 1 };
      if (!await tx.replace(JOBS, job._id, job.version, next)) throw new Error('Retention claim conflict');
      return { claimed: view(next), fileId: sourceFileId(currentView.kind, source) as string,
        claimVersion: next.version } as const;
    });
    if ('terminal' in claimed && claimed.terminal) return claimed.terminal;
    if ('busy' in claimed && claimed.busy) return claimed.busy;
    let outcome: 'deleted' | 'not_found';
    try { outcome = await this.storage.deleteFile(claimed.fileId); }
    catch (error: unknown) {
      await this.finishFailure(jobIdValue, claimed.claimVersion, now);
      throw error;
    }
    return this.database.runTransaction(async tx => {
      const job = await tx.get(JOBS, jobIdValue);
      if (!job || job.version !== claimed.claimVersion || job.status !== 'deleting') {
        throw new Error('Retention completion conflict');
      }
      const currentView = view(job);
      const source = await tx.get(COLLECTION[currentView.kind], currentView.sourceId);
      if (!source || source.organizationId !== job.organizationId
        || sourceFileId(currentView.kind, source) !== job.fileId
        || sourceSha(currentView.kind, source) !== job.contentSha256 || source.deletedAt !== null) {
        throw new Error('Retention source changed after deletion');
      }
      const marked = currentView.kind === 'teacher_voice'
        ? { ...source, version: source.version + 1,
          voiceComment: { ...voiceComment(source), mediaDeletedAt: now } }
        : { ...source, version: source.version + 1, mediaDeletedAt: now };
      if (!await tx.replace(COLLECTION[currentView.kind], source._id, source.version, marked)) {
        throw new Error('Retention source conflict');
      }
      const completed = { ...job, version: job.version + 1, status: 'completed',
        finishedAt: now, leaseUntil: null, storageOutcome: outcome };
      if (!await tx.replace(JOBS, job._id, job.version, completed)) throw new Error('Retention completion conflict');
      const audited = await tx.append(AUDIT, { _id: `audit:${job.organizationId}:${job._id}`,
        organizationId: job.organizationId, schemaVersion: 1, version: 1, deletedAt: null,
        id: `retention_${job._id}`, requestId: job._id, actorUserId: 'server-maintenance',
        actorRole: 'system', action: 'media-retention.deleteOriginal', targetType: currentView.kind,
        targetId: currentView.sourceId, result: 'succeeded', errorCode: null, occurredAt: now,
        metadata: { storageOutcome: outcome, retainedHistory: true } });
      if (!audited) throw new Error('Retention audit conflict');
      return view(completed);
    });
  }

  private async finishFailure(id: string, claimVersion: number, now: string): Promise<void> {
    await this.database.runTransaction(async tx => {
      const job = await tx.get(JOBS, id);
      if (!job || job.version !== claimVersion || job.status !== 'deleting') return;
      const failed = { ...job, version: job.version + 1, status: 'failed', leaseUntil: null, lastFailureAt: now };
      if (!await tx.replace(JOBS, id, job.version, failed)) throw new Error('Retention failure conflict');
    });
  }

  private async referencedByFeedback(source: VersionedDocument,
    reader: Pick<DocumentDatabasePort, 'get'> = this.database): Promise<boolean> {
    if (typeof source.submissionId !== 'string') return true;
    const feedback = await reader.get('review_feedback',
      `feedback:${source.organizationId}:${source.submissionId}`);
    if (!feedback || feedback.deletedAt !== null) return false;
    const voice = voiceComment(feedback);
    return voice?.recordingId === source._id && voice.fileId === source.fileId;
  }
}
