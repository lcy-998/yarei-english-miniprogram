import { createHash } from 'node:crypto';
import { hashHex } from '../shared/request-summary';
import type { DocumentDatabasePort, VersionedDocument } from '../repositories/document-database-port';

export interface DraftStagingStoragePort {
  /** Resolve the configured CloudBase bucket server-side; never accept a client file ID. */
  deleteStagingPath(input: Readonly<{ environmentId: string; stagingPath: string }>): Promise<'deleted' | 'not_found'>;
}
export interface DraftStagingJobView {
  readonly id: string;
  readonly organizationId: string;
  readonly workId: string;
  readonly status: 'planned' | 'deleting' | 'failed' | 'completed' | 'stale';
  readonly eligibleAt: string;
}

const WORKS = 'student_works';
const JOBS = 'media_retention_jobs';
const AUDIT = 'operation_logs';
const RECOVERY_MS = 7 * 86_400_000;
const LEASE_MS = 5 * 60_000;

function instant(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function jobId(work: VersionedDocument): string {
  const identity = JSON.stringify(['draft_staging', work.organizationId, work._id]);
  return `draft_staging_retention_${createHash('sha256').update(identity).digest('hex')}`;
}
function validDraft(work: VersionedDocument | null, nowMs: number,
  expectedVersion?: number): work is VersionedDocument {
  if (!work || work.status !== 'draft' || typeof work.studentId !== 'string'
    || typeof work.id !== 'string' || work.id !== work._id
    || !/^[A-Za-z0-9_-]{8,128}$/.test(work.id)
    || work.deletedByUserId !== work.studentId
    || work.fileId !== null || work.contentSha256 !== null
    || work.submittedAt !== null || work.stagingMediaDeletedAt !== undefined
    || (expectedVersion !== undefined && work.version !== expectedVersion)) return false;
  const deleted = instant(work.deletedAt);
  const recoverable = instant(work.recoverableUntil);
  if (deleted === null || recoverable === null || recoverable < deleted + RECOVERY_MS
    || nowMs < recoverable) return false;
  const ownerDigest = hashHex(JSON.stringify([work.organizationId, work.studentId]));
  return work.stagingPath === `student-works/staging/${ownerDigest}/${work.id}.mp3`;
}
function view(job: VersionedDocument): DraftStagingJobView {
  if (job.kind !== 'draft_staging' || typeof job.workId !== 'string'
    || typeof job.eligibleAt !== 'string'
    || !['planned', 'deleting', 'failed', 'completed', 'stale'].includes(String(job.status))) {
    throw new Error('Invalid draft staging job');
  }
  return { id: job._id, organizationId: job.organizationId, workId: job.workId,
    status: job.status as DraftStagingJobView['status'], eligibleAt: job.eligibleAt };
}

/** Server-only cleanup for S-12 soft-deleted drafts after their seven-day recovery deadline. */
export class DraftStagingRetentionService {
  public constructor(private readonly database: DocumentDatabasePort,
    private readonly storage: DraftStagingStoragePort,
    private readonly environmentId: string,
    private readonly clock: { nowIso(): string }) {
    if (!/^[A-Za-z0-9_-]+$/.test(environmentId)) throw new Error('Invalid environment ID');
  }

  public async planBatch(organizationId: string, offset: number, limit = 25): Promise<Readonly<{
    scanned: number; planned: number; hasMore: boolean }>> {
    if (!organizationId.trim() || !Number.isSafeInteger(offset) || offset < 0
      || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error('Invalid staging page');
    const page = await this.database.findPage(WORKS, { organizationId, status: 'draft' }, { limit, offset });
    let planned = 0;
    for (const candidate of page.items) {
      if (candidate.organizationId !== organizationId) throw new Error('Cross-organization staging scan');
      if (await this.planOne(candidate)) planned += 1;
    }
    return { scanned: page.items.length, planned, hasMore: page.hasMore };
  }

  private async planOne(candidate: VersionedDocument): Promise<boolean> {
    const now = this.clock.nowIso();
    const nowMs = instant(now);
    if (nowMs === null || !validDraft(candidate, nowMs)) return false;
    return this.database.runTransaction(async tx => {
      const work = await tx.get(WORKS, candidate._id);
      if (!work || work.organizationId !== candidate.organizationId || !validDraft(work, nowMs)) return false;
      const id = jobId(work);
      if (await tx.get(JOBS, id)) return false;
      return tx.create(JOBS, { _id: id, organizationId: work.organizationId,
        schemaVersion: 1, version: 1, deletedAt: null, kind: 'draft_staging', workId: work._id,
        studentId: work.studentId, stagingPath: work.stagingPath, sourceVersion: work.version,
        status: 'planned', eligibleAt: work.recoverableUntil ?? null, plannedAt: now,
        attempts: 0, leaseUntil: null });
    });
  }

  public async execute(id: string): Promise<DraftStagingJobView> {
    const now = this.clock.nowIso();
    const nowMs = instant(now);
    if (nowMs === null || !/^draft_staging_retention_[a-f0-9]{64}$/.test(id)) {
      throw new Error('Invalid staging cleanup request');
    }
    const claimed = await this.database.runTransaction(async tx => {
      const job = await tx.get(JOBS, id);
      if (!job || job.deletedAt !== null) throw new Error('Staging cleanup job missing');
      const currentView = view(job);
      if (currentView.status === 'completed' || currentView.status === 'stale') return { terminal: currentView } as const;
      if (nowMs < (instant(job.eligibleAt) ?? Infinity)) return { busy: currentView } as const;
      if (currentView.status === 'deleting' && (instant(job.leaseUntil) ?? Infinity) > nowMs) {
        return { busy: currentView } as const;
      }
      const work = await tx.get(WORKS, currentView.workId);
      if (!work || id !== jobId(work) || work.organizationId !== job.organizationId || work.studentId !== job.studentId
        || work.stagingPath !== job.stagingPath || !validDraft(work, nowMs, Number(job.sourceVersion))) {
        const stale = { ...job, version: job.version + 1, status: 'stale', finishedAt: now };
        if (!await tx.replace(JOBS, id, job.version, stale)) throw new Error('Staging stale conflict');
        return { terminal: view(stale) } as const;
      }
      const locked = { ...work, version: work.version + 1, stagingCleanupStatus: 'deleting' };
      if (!await tx.replace(WORKS, work._id, work.version, locked)) throw new Error('Staging source claim conflict');
      const next = { ...job, version: job.version + 1, status: 'deleting',
        sourceVersion: locked.version, attempts: Number(job.attempts) + 1,
        leaseUntil: new Date(nowMs + LEASE_MS).toISOString() };
      if (!await tx.replace(JOBS, id, job.version, next)) throw new Error('Staging job claim conflict');
      return { claimed: view(next), stagingPath: work.stagingPath as string, claimVersion: next.version } as const;
    });
    if ('terminal' in claimed && claimed.terminal) return claimed.terminal;
    if ('busy' in claimed && claimed.busy) return claimed.busy;
    let outcome: 'deleted' | 'not_found';
    try { outcome = await this.storage.deleteStagingPath({ environmentId: this.environmentId,
      stagingPath: claimed.stagingPath }); }
    catch (error: unknown) {
      await this.finishFailure(id, claimed.claimVersion, now);
      throw error;
    }
    return this.database.runTransaction(async tx => {
      const job = await tx.get(JOBS, id);
      if (!job || job.status !== 'deleting' || job.version !== claimed.claimVersion) {
        throw new Error('Staging completion conflict');
      }
      const work = await tx.get(WORKS, String(job.workId));
      if (!work || work.organizationId !== job.organizationId || work.studentId !== job.studentId
        || work.stagingPath !== job.stagingPath || work.version !== job.sourceVersion
        || work.stagingCleanupStatus !== 'deleting' || work.status !== 'draft'
        || work.deletedAt === null || work.submittedAt !== null) {
        throw new Error('Staging source changed after deletion');
      }
      const marked = { ...work, version: work.version + 1,
        stagingCleanupStatus: 'deleted', stagingMediaDeletedAt: now };
      if (!await tx.replace(WORKS, work._id, work.version, marked)) throw new Error('Staging source completion conflict');
      const completed = { ...job, version: job.version + 1, status: 'completed', finishedAt: now,
        leaseUntil: null, storageOutcome: outcome };
      if (!await tx.replace(JOBS, id, job.version, completed)) throw new Error('Staging job completion conflict');
      const audited = await tx.append(AUDIT, { _id: `audit:${job.organizationId}:${job._id}`,
        organizationId: job.organizationId, schemaVersion: 1, version: 1, deletedAt: null,
        id: `retention_${job._id}`, requestId: job._id, actorUserId: 'server-maintenance',
        actorRole: 'system', action: 'media-retention.deleteDraftStaging',
        targetType: 'student_work_draft', targetId: String(job.workId), result: 'succeeded',
        errorCode: null, occurredAt: now,
        metadata: { storageOutcome: outcome, recoverableUntil: String(job.eligibleAt) } });
      if (!audited) throw new Error('Staging cleanup audit conflict');
      return view(completed);
    });
  }

  private async finishFailure(id: string, claimVersion: number, now: string): Promise<void> {
    await this.database.runTransaction(async tx => {
      const job = await tx.get(JOBS, id);
      if (!job || job.status !== 'deleting' || job.version !== claimVersion) return;
      const failed = { ...job, version: job.version + 1, status: 'failed',
        leaseUntil: null, lastFailureAt: now };
      if (!await tx.replace(JOBS, id, job.version, failed)) throw new Error('Staging failure conflict');
    });
  }
}
