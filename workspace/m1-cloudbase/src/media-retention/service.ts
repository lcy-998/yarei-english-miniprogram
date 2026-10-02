import { createHash } from 'node:crypto';
import type { DocumentDatabasePort, VersionedDocument } from '../repositories/document-database-port';
import { ORIGINAL_AUDIO_RETENTION_MS } from './policy';

export type RetainedRecordingKind = 'student_work' | 'task_recording';
export type RetentionJobStatus = 'planned' | 'deleting' | 'failed' | 'completed' | 'stale';
export interface RetentionStoragePort {
  /** A missing object is a successful idempotent retry after an interrupted deletion. */
  deleteFile(fileId: string): Promise<'deleted' | 'not_found'>;
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
};

function time(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function digest(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function jobId(kind: RetainedRecordingKind, record: VersionedDocument): string {
  return `media_retention_${digest(JSON.stringify([kind, record.organizationId, record._id]))}`;
}
function expectedFileId(kind: RetainedRecordingKind, record: VersionedDocument, environmentId: string): string | null {
  if (typeof record.id !== 'string' || record.id !== record._id
    || typeof record.studentId !== 'string' || typeof record.contentSha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(record.contentSha256)
    || !/^[A-Za-z0-9_-]{8,128}$/.test(record.id)
    || typeof record.organizationId !== 'string') return null;
  const ownerDigest = digest(JSON.stringify([record.organizationId, record.studentId]));
  const prefix = kind === 'student_work' ? 'student-works' : 'task-recordings';
  return `cloud://${environmentId}/${prefix}/private/${ownerDigest}/${record.id}/${record.contentSha256}.mp3`;
}
function validSource(kind: RetainedRecordingKind, record: VersionedDocument | null,
  environmentId: string, nowMs: number): record is VersionedDocument {
  if (!record || record.deletedAt !== null || record.status !== 'submitted'
    || record.mediaDeletedAt !== undefined && record.mediaDeletedAt !== null
    || time(record.submittedAt) === null || nowMs < (time(record.submittedAt) ?? Infinity) + ORIGINAL_AUDIO_RETENTION_MS
    || typeof record.fileId !== 'string') return false;
  const expected = expectedFileId(kind, record, environmentId);
  if (!expected) return false;
  const fileId = record.fileId;
  // CloudBase may append a bucket suffix to the environment segment.
  const match = /^cloud:\/\/([^/]+)\/(.+)$/.exec(fileId);
  const expectedPath = expected.slice(`cloud://${environmentId}/`.length);
  return Boolean(match && (match[1] === environmentId || match[1]?.startsWith(`${environmentId}.`))
    && match[2] === expectedPath);
}
function view(job: VersionedDocument): RetentionJobView {
  if ((job.kind !== 'student_work' && job.kind !== 'task_recording')
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
    private readonly clock: { nowIso(): string }) {
    if (!/^[A-Za-z0-9_-]+$/.test(environmentId)) throw new Error('Invalid environment ID');
  }

  public async planBatch(kind: RetainedRecordingKind, organizationId: string,
    offset: number, limit = 25): Promise<Readonly<{ scanned: number; planned: number; hasMore: boolean }>> {
    if (!organizationId.trim() || !Number.isSafeInteger(offset) || offset < 0
      || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error('Invalid retention page');
    const page = await this.database.findPage(COLLECTION[kind], { organizationId, status: 'submitted', deletedAt: null },
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
    if (nowMs === null || !validSource(kind, candidate, this.environmentId, nowMs)) return false;
    return this.database.runTransaction(async tx => {
      const current = await tx.get(COLLECTION[kind], candidate._id);
      if (!current || current.organizationId !== candidate.organizationId
        || !validSource(kind, current, this.environmentId, nowMs)) return false;
      const id = jobId(kind, current);
      if (await tx.get(JOBS, id)) return false;
      const eligibleAt = new Date((time(current.submittedAt) ?? 0) + ORIGINAL_AUDIO_RETENTION_MS).toISOString();
      return tx.create(JOBS, { _id: id, organizationId: current.organizationId,
        schemaVersion: 1, version: 1, deletedAt: null, kind, sourceId: current._id,
        fileId: current.fileId ?? null, contentSha256: current.contentSha256 ?? null,
        status: 'planned', eligibleAt, plannedAt: now, attempts: 0, leaseUntil: null });
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
      if (!source || source.organizationId !== job.organizationId || source.fileId !== job.fileId
        || source.contentSha256 !== job.contentSha256
        || !validSource(currentView.kind, source, this.environmentId, nowMs)) {
        const stale = { ...job, version: job.version + 1, status: 'stale', finishedAt: now };
        if (!await tx.replace(JOBS, job._id, job.version, stale)) throw new Error('Retention job conflict');
        return { terminal: view(stale) } as const;
      }
      const next = { ...job, version: job.version + 1, status: 'deleting',
        leaseUntil: new Date(nowMs + LEASE_MS).toISOString(), attempts: Number(job.attempts) + 1 };
      if (!await tx.replace(JOBS, job._id, job.version, next)) throw new Error('Retention claim conflict');
      return { claimed: view(next), fileId: source.fileId as string, claimVersion: next.version } as const;
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
      if (!source || source.organizationId !== job.organizationId || source.fileId !== job.fileId
        || source.contentSha256 !== job.contentSha256 || source.deletedAt !== null) {
        throw new Error('Retention source changed after deletion');
      }
      const marked = { ...source, version: source.version + 1, mediaDeletedAt: now };
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
}
