import type { DocumentDatabasePort } from '../repositories/document-database-port';
import { MediaRetentionService, type RetainedRecordingKind } from './service';
import { AbandonedStagingRetentionService, type AbandonedStagingKind } from './abandoned-staging';

const CURSOR_COLLECTION = 'maintenance_scan_state';
const CURSOR_ID = 'media_retention_scan_v1';
const KINDS: readonly RetainedRecordingKind[] = [
  'student_work', 'task_recording', 'pronunciation', 'task_dubbing', 'teacher_voice',
  'teacher_voice_draft',
];
const STAGING_KINDS: readonly AbandonedStagingKind[] = [
  'student_work', 'task_recording', 'pronunciation', 'task_dubbing', 'teacher_voice',
];
type ScanKind = RetainedRecordingKind | `staging_${AbandonedStagingKind}`;
const PAGE_SIZE = 25;
const JOB_LIMIT = 5;

export interface MediaRetentionReport {
  readonly scanned: number;
  readonly planned: number;
  readonly completed: number;
  readonly failed: number;
}

/** One bounded page per tick, with a durable cursor so large collections are eventually covered. */
export class MediaRetentionMaintenance {
  public constructor(private readonly database: DocumentDatabasePort,
    private readonly retention: MediaRetentionService,
    private readonly staging: AbandonedStagingRetentionService | null = null) {}

  public async run(): Promise<MediaRetentionReport> {
    const cursor = await this.database.get(CURSOR_COLLECTION, CURSOR_ID);
    const organizationOffset = validOffset(cursor?.organizationOffset);
    const kindIndex = validOffset(cursor?.kindIndex);
    const sourceOffset = validOffset(cursor?.sourceOffset);
    const kinds: readonly ScanKind[] = this.staging
      ? [...KINDS, ...STAGING_KINDS.map(kind => `staging_${kind}` as const)] : KINDS;
    if (kindIndex >= kinds.length) throw new Error('Invalid retention cursor');
    let orgOffset = organizationOffset;
    let organizations = await this.database.findPage('organizations', { status: 'active', deletedAt: null },
      { limit: 1, offset: orgOffset });
    if (!organizations.items.length && orgOffset > 0) {
      orgOffset = 0;
      organizations = await this.database.findPage('organizations', { status: 'active', deletedAt: null },
        { limit: 1, offset: 0 });
    }
    const org = organizations.items[0];
    if (!org || org._id !== org.organizationId) return { scanned: 0, planned: 0, completed: 0, failed: 0 };
    const kind = kinds[orgOffset === organizationOffset ? kindIndex : 0]!;
    const offset = orgOffset === organizationOffset ? sourceOffset : 0;
    const stagingKind = kind.startsWith('staging_') ? kind.slice(8) as AbandonedStagingKind : null;
    const rawKind = stagingKind ?? kind as RetainedRecordingKind;
    const plan = stagingKind && this.staging
      ? await this.staging.planBatch(stagingKind, org._id, offset, PAGE_SIZE)
      : await this.retention.planBatch(kind as RetainedRecordingKind, org._id, offset, PAGE_SIZE);
    const nextKind = plan.hasMore ? kinds.indexOf(kind) : kinds.indexOf(kind) + 1;
    const nextCursor = nextKind >= kinds.length
      ? { organizationOffset: orgOffset + 1, kindIndex: 0, sourceOffset: 0 }
      : { organizationOffset: orgOffset, kindIndex: nextKind,
        sourceOffset: plan.hasMore ? offset + plan.scanned : 0 };
    await this.database.runTransaction(async tx => {
      const current = await tx.get(CURSOR_COLLECTION, CURSOR_ID);
      if ((current?.version ?? 0) !== (cursor?.version ?? 0)) throw new Error('Concurrent retention scan');
      const row = { _id: CURSOR_ID, organizationId: org._id, schemaVersion: 1 as const,
        version: (current?.version ?? 0) + 1, deletedAt: null, ...nextCursor };
      const saved = current ? await tx.replace(CURSOR_COLLECTION, CURSOR_ID, current.version, row)
        : await tx.create(CURSOR_COLLECTION, row);
      if (!saved) throw new Error('Retention cursor conflict');
    });
    let completed = 0;
    let failed = 0;
    for (const status of ['planned', 'failed'] as const) {
      const jobs = await this.database.findPage('media_retention_jobs', {
        organizationId: org._id, status, kind: rawKind, deletedAt: null,
      }, { limit: JOB_LIMIT, offset: 0 });
      for (const job of jobs.items) {
        try {
          if (job._id.startsWith('media_retention_')) {
            const result = await this.retention.execute(job._id);
            if (result.status === 'completed') completed += 1;
          } else if (job._id.startsWith('abandoned_staging_retention_') && this.staging) {
            if (await this.staging.execute(job._id) === 'completed') completed += 1;
          }
        } catch { failed += 1; }
      }
    }
    return { scanned: plan.scanned, planned: plan.planned, completed, failed };
  }
}

function validOffset(value: unknown): number {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error('Invalid retention cursor');
  return Number(value);
}
