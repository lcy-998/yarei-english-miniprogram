import { createHash } from 'node:crypto';
import type { DocumentDatabasePort, VersionedDocument } from '../repositories/document-database-port';
import { AUTONOMOUS_READING_AUDIO_RETENTION_MS, DUBBING_AUDIO_RETENTION_MS,
  ORIGINAL_AUDIO_RETENTION_MS, TEACHER_VOICE_COMMENT_RETENTION_MS } from './policy';

export type AbandonedStagingKind = 'student_work' | 'task_recording' | 'pronunciation'
  | 'task_dubbing' | 'teacher_voice';
export interface AbandonedStagingStoragePort {
  deleteStagingPath(input: Readonly<{ environmentId: string; stagingPath: string }>):
    Promise<'deleted' | 'not_found'>;
}

const COLLECTION: Readonly<Record<AbandonedStagingKind, string>> = {
  student_work: 'student_works', task_recording: 'task_recordings',
  pronunciation: 'pronunciation_recordings', task_dubbing: 'task_dubbing_works',
  teacher_voice: 'review_voice_drafts',
};
const JOBS = 'media_retention_jobs';
const AUDIT = 'operation_logs';
const LEASE_MS = 5 * 60_000;
const idPattern = /^[A-Za-z0-9_-]{8,128}$/;
const partPattern = /^[A-Za-z0-9_-]{1,128}$/;
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const instant = (value: unknown): number | null => {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

function expectedPath(kind: AbandonedStagingKind, row: VersionedDocument): string | null {
  if (!idPattern.test(row._id) || !partPattern.test(row.organizationId)) return null;
  if (kind === 'teacher_voice') {
    if (typeof row.teacherId !== 'string' || !partPattern.test(row.teacherId)
      || typeof row.submissionId !== 'string' || !partPattern.test(row.submissionId)) return null;
    return `review-voice/${row.organizationId}/${row.teacherId}/${row.submissionId}/${row._id}`;
  }
  if (typeof row.studentId !== 'string' || !partPattern.test(row.studentId)) return null;
  if (kind === 'task_dubbing') {
    if (typeof row.taskId !== 'string' || !partPattern.test(row.taskId)
      || typeof row.itemId !== 'string' || !partPattern.test(row.itemId)) return null;
    return `task-dubbing/staging/${row.organizationId}/${row.studentId}/${row.taskId}/${row.itemId}/${row._id}`;
  }
  const owner = hash(JSON.stringify([row.organizationId, row.studentId]));
  const prefix = kind === 'student_work' ? 'student-works'
    : kind === 'task_recording' ? 'task-recordings' : 'pronunciation';
  return `${prefix}/staging/${owner}/${row._id}.mp3`;
}

function duration(kind: AbandonedStagingKind, row: VersionedDocument): number | null {
  if (kind === 'student_work' || kind === 'task_dubbing') return DUBBING_AUDIO_RETENTION_MS;
  if (kind === 'teacher_voice') return TEACHER_VOICE_COMMENT_RETENTION_MS;
  if (kind === 'task_recording') return ORIGINAL_AUDIO_RETENTION_MS;
  if (row.source === null || typeof row.source !== 'object' || Array.isArray(row.source)) return null;
  const source = row.source as Record<string, unknown>;
  return source.kind === 'reading' ? AUTONOMOUS_READING_AUDIO_RETENTION_MS
    : source.kind === 'task' ? ORIGINAL_AUDIO_RETENTION_MS : null;
}

function eligible(kind: AbandonedStagingKind, row: VersionedDocument | null, nowMs: number):
  row is VersionedDocument {
  if (!row || row.status !== 'draft' || row.fileId !== null
    || row.stagingMediaDeletedAt != null || row.stagingCleanupStatus === 'deleted'
    || row.stagingCleanupStatus === 'deleting'
      && (instant(row.stagingLeaseUntil) ?? 0) > nowMs) return false;
  const path = expectedPath(kind, row);
  const retention = duration(kind, row);
  const created = instant(row.createdAt);
  return path !== null && row.stagingPath === path && retention !== null
    && created !== null && nowMs >= created + retention
    && (instant(row.uploadLeaseUntil) ?? 0) <= nowMs;
}

function jobId(kind: AbandonedStagingKind, row: VersionedDocument, eligibleAt: string): string {
  return `abandoned_staging_retention_${hash(JSON.stringify([kind, row.organizationId, row._id, eligibleAt]))}`;
}
function jobKind(row: VersionedDocument): AbandonedStagingKind {
  const value = row.kind;
  if (value === 'student_work' || value === 'task_recording' || value === 'pronunciation'
    || value === 'task_dubbing' || value === 'teacher_voice') return value;
  throw new Error('Invalid abandoned staging job');
}

/** Cleans a server-issued upload path only after its category deadline and source-version lock. */
export class AbandonedStagingRetentionService {
  public constructor(private readonly database: DocumentDatabasePort,
    private readonly storage: AbandonedStagingStoragePort,
    private readonly environmentId: string,
    private readonly clock: Readonly<{ nowIso(): string }>) {
    if (!/^[A-Za-z0-9_-]+$/.test(environmentId)) throw new Error('Invalid environment ID');
  }

  public async planBatch(kind: AbandonedStagingKind, organizationId: string,
    offset: number, limit = 25): Promise<Readonly<{ scanned: number; planned: number; hasMore: boolean }>> {
    if (!partPattern.test(organizationId) || !Number.isSafeInteger(offset) || offset < 0
      || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error('Invalid staging page');
    const page = await this.database.findPage(COLLECTION[kind],
      { organizationId, status: 'draft' }, { limit, offset });
    let planned = 0;
    for (const candidate of page.items) {
      if (candidate.organizationId !== organizationId) throw new Error('Cross-organization staging scan');
      if (await this.planOne(kind, candidate)) planned += 1;
    }
    return { scanned: page.items.length, planned, hasMore: page.hasMore };
  }

  private async planOne(kind: AbandonedStagingKind, candidate: VersionedDocument): Promise<boolean> {
    const now = this.clock.nowIso();
    const nowMs = instant(now);
    if (nowMs === null || !eligible(kind, candidate, nowMs)) return false;
    return this.database.runTransaction(async tx => {
      const row = await tx.get(COLLECTION[kind], candidate._id);
      if (!row || row.organizationId !== candidate.organizationId || !eligible(kind, row, nowMs)) return false;
      const eligibleAt = new Date((instant(row.createdAt) ?? 0) + duration(kind, row)!).toISOString();
      const id = jobId(kind, row, eligibleAt);
      const existing = await tx.get(JOBS, id);
      if (existing && (existing.organizationId !== row.organizationId || existing.status !== 'stale')) return false;
      const plan = { _id: id, organizationId: row.organizationId, schemaVersion: 1 as const,
        version: 1, deletedAt: null, kind, sourceId: row._id,
        stagingPath: row.stagingPath, eligibleAt, status: 'planned', attempts: 0,
        plannedAt: now, leaseUntil: null };
      return existing ? tx.replace(JOBS, id, existing.version,
        { ...plan, version: existing.version + 1 }) : tx.create(JOBS, plan);
    });
  }

  public async execute(id: string): Promise<'completed' | 'stale' | 'busy'> {
    const now = this.clock.nowIso();
    const nowMs = instant(now);
    if (nowMs === null || !/^abandoned_staging_retention_[a-f0-9]{64}$/.test(id)) {
      throw new Error('Invalid staging cleanup request');
    }
    const claimed = await this.database.runTransaction(async tx => {
      const job = await tx.get(JOBS, id);
      if (!job || job.deletedAt !== null || job.sourceId === null) throw new Error('Staging job missing');
      if (job.status === 'completed' || job.status === 'stale') return { state: job.status } as const;
      if (job.status === 'deleting' && (instant(job.leaseUntil) ?? Infinity) > nowMs) {
        return { state: 'busy' } as const;
      }
      const kind = jobKind(job);
      const source = await tx.get(COLLECTION[kind], String(job.sourceId));
      const deadline = source && duration(kind, source) !== null && instant(source.createdAt) !== null
        ? new Date(instant(source.createdAt)! + duration(kind, source)!).toISOString() : null;
      if (!source || source.organizationId !== job.organizationId
        || source.stagingPath !== job.stagingPath || deadline !== job.eligibleAt
        || !eligible(kind, source, nowMs)) {
        const stale = { ...job, version: job.version + 1, status: 'stale', finishedAt: now };
        if (!await tx.replace(JOBS, id, job.version, stale)) throw new Error('Staging stale conflict');
        return { state: 'stale' } as const;
      }
      const locked = { ...source, version: source.version + 1,
        stagingCleanupStatus: 'deleting', stagingLeaseUntil: new Date(nowMs + LEASE_MS).toISOString() };
      if (!await tx.replace(COLLECTION[kind], source._id, source.version, locked)) {
        throw new Error('Staging source claim conflict');
      }
      const next = { ...job, version: job.version + 1, status: 'deleting',
        sourceVersion: locked.version, attempts: Number(job.attempts) + 1,
        leaseUntil: new Date(nowMs + LEASE_MS).toISOString() };
      if (!await tx.replace(JOBS, id, job.version, next)) throw new Error('Staging job claim conflict');
      return { state: 'claimed', path: String(source.stagingPath), version: next.version } as const;
    });
    if (claimed.state !== 'claimed') return claimed.state;
    let outcome: 'deleted' | 'not_found';
    try {
      outcome = await this.storage.deleteStagingPath({ environmentId: this.environmentId,
        stagingPath: claimed.path });
    } catch (error: unknown) {
      await this.database.runTransaction(async tx => {
        const job = await tx.get(JOBS, id);
        if (!job || job.status !== 'deleting' || job.version !== claimed.version) return;
        const kind = jobKind(job);
        const source = await tx.get(COLLECTION[kind], String(job.sourceId));
        if (source && source.version === job.sourceVersion
          && source.stagingCleanupStatus === 'deleting') {
          if (!await tx.replace(COLLECTION[kind], source._id, source.version,
            { ...source, version: source.version + 1,
              stagingCleanupStatus: 'failed', stagingLeaseUntil: null })) {
            throw new Error('Staging failure unlock conflict');
          }
        }
        if (!await tx.replace(JOBS, id, job.version,
          { ...job, version: job.version + 1, status: 'failed', leaseUntil: null, lastFailureAt: now })) {
          throw new Error('Staging failure job conflict');
        }
      });
      throw error;
    }
    return this.database.runTransaction(async tx => {
      const job = await tx.get(JOBS, id);
      if (!job || job.status !== 'deleting' || job.version !== claimed.version) {
        throw new Error('Staging completion conflict');
      }
      const kind = jobKind(job);
      const source = await tx.get(COLLECTION[kind], String(job.sourceId));
      if (!source || source.organizationId !== job.organizationId
        || source.stagingPath !== job.stagingPath || source.version !== job.sourceVersion
        || source.status !== 'draft' || source.fileId !== null
        || source.stagingCleanupStatus !== 'deleting') {
        throw new Error('Staging source changed after deletion');
      }
      const marked = { ...source, version: source.version + 1,
        stagingCleanupStatus: 'deleted', stagingMediaDeletedAt: now, stagingLeaseUntil: null };
      if (!await tx.replace(COLLECTION[kind], source._id, source.version, marked)) {
        throw new Error('Staging source completion conflict');
      }
      const completed = { ...job, version: job.version + 1, status: 'completed',
        finishedAt: now, leaseUntil: null, storageOutcome: outcome };
      if (!await tx.replace(JOBS, id, job.version, completed)) throw new Error('Staging job completion conflict');
      if (!await tx.append(AUDIT, { _id: `audit:${job.organizationId}:${id}`,
        organizationId: job.organizationId, schemaVersion: 1, version: 1, deletedAt: null,
        requestId: id, actorUserId: 'server-maintenance', actorRole: 'system',
        action: 'media-retention.deleteAbandonedStaging', targetType: kind,
        targetId: String(job.sourceId), result: 'succeeded', errorCode: null,
        occurredAt: now, metadata: { storageOutcome: outcome, retainedHistory: true },
      })) throw new Error('Staging audit conflict');
      return 'completed' as const;
    });
  }
}
