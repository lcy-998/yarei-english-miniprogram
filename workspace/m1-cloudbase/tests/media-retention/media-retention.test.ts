import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import type { VersionedDocument } from '../../src/repositories/document-database-port';
import { MediaRetentionService, type RetentionStoragePort } from '../../src/media-retention/service';

const ORG = 'org_demo';
const STUDENT = 'student_demo';
const SHA = 'a'.repeat(64);
const OLD = '2026-03-01T00:00:00.000Z';
const NOW = '2026-09-27T00:00:00.000Z';
const owner = createHash('sha256').update(JSON.stringify([ORG, STUDENT])).digest('hex');
const fileId = (kind: 'student_work' | 'task_recording', id: string) =>
  `cloud://test-env/${kind === 'student_work' ? 'student-works' : 'task-recordings'}/private/${owner}/${id}/${SHA}.mp3`;

function recording(kind: 'student_work' | 'task_recording', id: string,
  overrides: Readonly<Record<string, unknown>> = {}): VersionedDocument {
  return { _id: id, id, organizationId: ORG, schemaVersion: 1, version: 2, deletedAt: null,
    status: 'submitted', studentId: STUDENT, fileId: fileId(kind, id), contentSha256: SHA,
    submittedAt: OLD, createdAt: OLD, ...overrides } as VersionedDocument;
}

function fixture(seed: Readonly<Record<string, readonly VersionedDocument[]>>) {
  const database = new FakeDocumentDatabase(seed);
  const deleted: string[] = [];
  const storage: RetentionStoragePort = { async deleteFile(id) { deleted.push(id); return 'deleted'; } };
  const service = new MediaRetentionService(database, storage, 'test-env', { nowIso: () => NOW });
  return { database, deleted, service };
}
function soleJobId(database: FakeDocumentDatabase): string {
  const jobs = database.snapshot().media_retention_jobs ?? [];
  expect(jobs).toHaveLength(1);
  return jobs[0]!._id;
}

describe('M2 original audio retention', () => {
  it('plans and deletes only an eligible sealed work, preserving history and auditing once', async () => {
    const work = recording('student_work', 'work_12345678');
    const { database, deleted, service } = fixture({ student_works: [work] });
    expect(await service.planBatch('student_work', ORG, 0)).toEqual({ scanned: 1, planned: 1, hasMore: false });
    const id = soleJobId(database);
    expect(await service.execute(id)).toMatchObject({ status: 'completed', kind: 'student_work' });
    expect(await service.execute(id)).toMatchObject({ status: 'completed' });
    expect(deleted).toEqual([work.fileId]);
    expect(database.snapshot().student_works?.[0]).toMatchObject({ status: 'submitted',
      fileId: work.fileId, mediaDeletedAt: NOW });
    expect(database.snapshot().operation_logs).toHaveLength(1);
    expect(database.snapshot().operation_logs?.[0]).toMatchObject({
      action: 'media-retention.deleteOriginal', result: 'succeeded',
      metadata: { storageOutcome: 'deleted', retainedHistory: true } });
    expect(await service.planBatch('student_work', ORG, 0)).toMatchObject({ planned: 0 });
  });

  it('does not plan drafts, recent originals, foreign or malformed private paths', async () => {
    const records = [
      recording('task_recording', 'record_12345678', { status: 'draft' }),
      recording('task_recording', 'record_22345678', { submittedAt: '2026-09-26T00:00:00.000Z' }),
      recording('task_recording', 'record_32345678', { fileId: 'cloud://other-env/task-recordings/private/x.mp3' }),
      recording('task_recording', 'record_42345678', { fileId: 'cloud://test-env/task-recordings/staging/x.mp3' }),
      recording('task_recording', 'record_52345678', { organizationId: 'org_other' }),
    ];
    const { database, service } = fixture({ task_recordings: records });
    expect(await service.planBatch('task_recording', ORG, 0)).toMatchObject({ planned: 0 });
    expect(database.snapshot().media_retention_jobs ?? []).toHaveLength(0);
  });

  it('becomes eligible exactly after 180 elapsed days, independent of local calendar labels', async () => {
    const submittedAt = '2026-03-31T08:00:00.000Z';
    const work = recording('student_work', 'work_12345678', { submittedAt });
    const database = new FakeDocumentDatabase({ student_works: [work] });
    let now = new Date(Date.parse(submittedAt) + 180 * 86400000 - 1).toISOString();
    const service = new MediaRetentionService(database, { async deleteFile() { return 'deleted'; } },
      'test-env', { nowIso: () => now });
    expect(await service.planBatch('student_work', ORG, 0)).toMatchObject({ planned: 0 });
    now = new Date(Date.parse(submittedAt) + 180 * 86400000).toISOString();
    expect(await service.planBatch('student_work', ORG, 0)).toMatchObject({ planned: 1 });
  });

  it('revalidates source before deleting and marks changed plans stale', async () => {
    const original = recording('task_recording', 'record_12345678');
    const { database, deleted, service } = fixture({ task_recordings: [original] });
    await service.planBatch('task_recording', ORG, 0);
    const id = soleJobId(database);
    await database.runTransaction(async tx => {
      const record = await tx.get('task_recordings', original._id);
      expect(record).not.toBeNull();
      await tx.replace('task_recordings', original._id, record!.version,
        { ...record!, version: record!.version + 1, fileId: 'cloud://test-env/other.mp3' });
    });
    expect(await service.execute(id)).toMatchObject({ status: 'stale' });
    expect(deleted).toEqual([]);
    expect(database.snapshot().task_recordings?.[0]?.mediaDeletedAt).toBeUndefined();
  });

  it('retries a failed storage deletion and accepts an already absent object', async () => {
    const original = recording('task_recording', 'record_12345678');
    const database = new FakeDocumentDatabase({ task_recordings: [original] });
    let attempts = 0;
    const service = new MediaRetentionService(database, { async deleteFile() {
      attempts += 1;
      if (attempts === 1) throw new Error('transient');
      return 'not_found' as const;
    } }, 'test-env', { nowIso: () => NOW });
    await service.planBatch('task_recording', ORG, 0);
    const id = soleJobId(database);
    await expect(service.execute(id)).rejects.toThrow('transient');
    expect(database.snapshot().media_retention_jobs?.[0]?.status).toBe('failed');
    expect(database.snapshot().task_recordings?.[0]?.mediaDeletedAt).toBeUndefined();
    expect(await service.execute(id)).toMatchObject({ status: 'completed' });
    expect(database.snapshot().task_recordings?.[0]).toMatchObject({ status: 'submitted', mediaDeletedAt: NOW });
    expect(database.snapshot().operation_logs).toHaveLength(1);
  });
});
