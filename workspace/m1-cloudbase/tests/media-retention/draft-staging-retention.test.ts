import { describe, expect, it } from 'vitest';
import { hashHex } from '../../src/shared/request-summary';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import type { VersionedDocument } from '../../src/repositories/document-database-port';
import { DraftStagingRetentionService, type DraftStagingStoragePort } from '../../src/media-retention/draft-staging-retention';

const ORG = 'org_demo';
const STUDENT = 'student_demo';
const ID = 'student_work_demo_1';
const DELETED = '2026-09-20T00:00:00.000Z';
const RECOVERABLE = '2026-09-27T00:00:00.000Z';
const PATH = `student-works/staging/${hashHex(JSON.stringify([ORG, STUDENT]))}/${ID}.mp3`;

function draft(overrides: Readonly<Record<string, unknown>> = {}): VersionedDocument {
  return { _id: ID, id: ID, organizationId: ORG, schemaVersion: 1, version: 2,
    studentId: STUDENT, status: 'draft', stagingPath: PATH, fileId: null, contentSha256: null,
    submittedAt: null, deletedAt: DELETED, recoverableUntil: RECOVERABLE,
    deletedByUserId: STUDENT, ...overrides } as VersionedDocument;
}
function setup(works: readonly VersionedDocument[], at = RECOVERABLE,
  storage?: DraftStagingStoragePort) {
  const database = new FakeDocumentDatabase({ student_works: works });
  const deleted: string[] = [];
  const service = new DraftStagingRetentionService(database, storage ?? {
    async deleteStagingPath(input) { deleted.push(`${input.environmentId}/${input.stagingPath}`); return 'deleted'; },
  }, 'test-env', { nowIso: () => at });
  return { database, deleted, service };
}
function onlyJob(database: FakeDocumentDatabase): string {
  const jobs = database.snapshot().media_retention_jobs ?? [];
  expect(jobs).toHaveLength(1);
  return jobs[0]!._id;
}

describe('S-12 deleted draft staging cleanup', () => {
  it('deletes only after seven days, keeps the soft-deleted record, and writes one audit entry', async () => {
    const { database, deleted, service } = setup([draft()]);
    expect(await service.planBatch(ORG, 0)).toEqual({ scanned: 1, planned: 1, hasMore: false });
    const id = onlyJob(database);
    expect(await service.execute(id)).toMatchObject({ status: 'completed', workId: ID });
    expect(await service.execute(id)).toMatchObject({ status: 'completed' });
    expect(deleted).toEqual([`test-env/${PATH}`]);
    expect(database.snapshot().student_works?.[0]).toMatchObject({ status: 'draft',
      deletedAt: DELETED, stagingMediaDeletedAt: RECOVERABLE, stagingCleanupStatus: 'deleted' });
    expect(database.snapshot().operation_logs).toMatchObject([{ action: 'media-retention.deleteDraftStaging',
      result: 'succeeded', targetId: ID, metadata: { recoverableUntil: RECOVERABLE } }]);
    expect(await service.planBatch(ORG, 0)).toMatchObject({ planned: 0 });
  });

  it('never plans an active, recovering, submitted, malformed or foreign draft', async () => {
    const cases = [
      draft({ deletedAt: null, recoverableUntil: null, deletedByUserId: null }),
      draft({ recoverableUntil: '2026-09-28T00:00:00.000Z' }),
      draft({ recoverableUntil: '2026-09-25T00:00:00.000Z' }),
      draft({ status: 'submitted', submittedAt: DELETED, fileId: 'cloud://test-env/private.mp3' }),
      draft({ stagingPath: 'task-recordings/staging/other.mp3' }),
      draft({ deletedByUserId: 'student_other' }),
      draft({ organizationId: 'org_other' }),
    ];
    for (const item of cases) {
      const { database, service } = setup([item]);
      expect(await service.planBatch(ORG, 0)).toMatchObject({ planned: 0 });
      expect(database.snapshot().media_retention_jobs ?? []).toHaveLength(0);
    }
  });

  it('marks a plan stale if the draft is restored or its version changes before execution', async () => {
    const { database, deleted, service } = setup([draft()]);
    await service.planBatch(ORG, 0);
    const id = onlyJob(database);
    await database.runTransaction(async tx => {
      const current = await tx.get('student_works', ID);
      expect(current).not.toBeNull();
      await tx.replace('student_works', ID, current!.version, { ...current!, version: current!.version + 1,
        deletedAt: null, recoverableUntil: null, deletedByUserId: null });
    });
    expect(await service.execute(id)).toMatchObject({ status: 'stale' });
    expect(deleted).toEqual([]);

    const second = setup([draft()]);
    await second.service.planBatch(ORG, 0);
    const secondId = onlyJob(second.database);
    await second.database.runTransaction(async tx => {
      const current = await tx.get('student_works', ID);
      await tx.replace('student_works', ID, current!.version,
        { ...current!, version: current!.version + 1, note: 'changed after planning' });
    });
    expect(await second.service.execute(secondId)).toMatchObject({ status: 'stale' });
    expect(second.deleted).toEqual([]);
  });

  it('retries a storage failure and treats a missing object as an interrupted successful delete', async () => {
    let attempts = 0;
    const { database, service } = setup([draft()], RECOVERABLE, { async deleteStagingPath() {
      attempts += 1;
      if (attempts === 1) throw new Error('transient');
      return 'not_found';
    } });
    await service.planBatch(ORG, 0);
    const id = onlyJob(database);
    await expect(service.execute(id)).rejects.toThrow('transient');
    expect(database.snapshot().media_retention_jobs?.[0]).toMatchObject({ status: 'failed', attempts: 1 });
    expect(database.snapshot().student_works?.[0]?.stagingMediaDeletedAt).toBeUndefined();
    expect(await service.execute(id)).toMatchObject({ status: 'completed' });
    expect(attempts).toBe(2);
    expect(database.snapshot().operation_logs).toHaveLength(1);
  });

  it('will not execute an early plan if the recovery deadline has not passed', async () => {
    const { database } = setup([draft()]);
    const later = new DraftStagingRetentionService(database, { async deleteStagingPath() {
      throw new Error('must not delete');
    } }, 'test-env', { nowIso: () => '2026-09-26T23:59:59.999Z' });
    const onTime = new DraftStagingRetentionService(database, { async deleteStagingPath() {
      throw new Error('not called');
    } }, 'test-env', { nowIso: () => RECOVERABLE });
    await onTime.planBatch(ORG, 0);
    expect(await later.execute(onlyJob(database))).toMatchObject({ status: 'planned' });
    expect(database.snapshot().student_works?.[0]?.stagingCleanupStatus).toBeUndefined();
  });
});
