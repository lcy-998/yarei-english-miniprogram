import { describe, expect, it } from 'vitest';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import type { VersionedDocument } from '../../src/repositories/document-database-port';
import { createAuthoritativeM1SeedPackage } from '../../src/seed/authoritative-fixture';
import {
  advanceSeedBatchRollback,
  advanceSeedBatchRun,
  beginSeedBatchRollback,
  planSeedBatchRun,
  resumeFailedSeedBatchRun,
  type SeedBatchCoordinatorOptions,
  type SeedBatchRunState,
} from '../../src/seed/batch-coordinator';
import { createSeedDocumentDatabaseRepository } from '../../src/seed/document-database-repository';
import type { SeedMigrationRun, SeedRepositoryPort } from '../../src/seed/apply-core';
import { SEED_COLLECTION_ORDER } from '../../src/seed/model';

const ORGANIZATION_ID = 'org_qihang_demo';
const FIXED_NOW = '2026-09-17T13:00:00+08:00';
// These two cases deliberately process all 374 authoritative documents. On
// Windows, concurrent Vitest workers can exceed the framework's 5s default
// despite the coordinator completing correctly, so retain a bounded contract
// timeout rather than weakening the assertions or reducing fixture coverage.
const AUTHORITATIVE_SEED_TIMEOUT_MS = 15_000;
const OPTIONS: SeedBatchCoordinatorOptions = {
  executedBy: 'sys_seed_batch_contract',
  requestId: 'request_seed_batch_contract',
  batchSize: 25,
  now: () => FIXED_NOW,
};

describe('374 条权威种子的安全分批协调器', () => {
  it('批次提交中断后标为 failed，并从最后完整批次恢复；全量 verify 后才 succeeded', async () => {
    const seed = createAuthoritativeM1SeedPackage();
    const database = new FakeDocumentDatabase();
    const repository = createRepository(database);

    await expect(planSeedBatchRun(repository, seed, OPTIONS)).resolves.toMatchObject({
      status: 'planned', totalBatches: 15, createdCount: 0,
    });
    await expect(advanceSeedBatchRun(repository, seed, OPTIONS)).resolves.toMatchObject({ status: 'applying' });
    await expect(advanceSeedBatchRun(repository, seed, OPTIONS)).resolves.toMatchObject({
      status: 'applying', nextBatchIndex: 1, createdCount: 25,
    });

    database.failNext({ operation: 'commit', kind: 'unavailable', diagnosticMessage: 'simulated batch commit interruption' });
    await expect(advanceSeedBatchRun(repository, seed, OPTIONS)).rejects.toMatchObject({ kind: 'unavailable' });

    expect(countSeedDocuments(database.snapshot())).toBe(25);
    await expect(readRun(repository, seed.manifest.seedRunId)).resolves.toMatchObject({
      status: 'failed',
      failedFromStatus: 'applying',
      failureCode: 'DATABASE_UNAVAILABLE',
      nextBatchIndex: 1,
      createdDocumentIds: expect.arrayContaining([expect.objectContaining({ collection: 'organizations' })]),
    });

    let state = await resumeFailedSeedBatchRun(repository, seed, OPTIONS);
    expect(state).toMatchObject({ status: 'applying', nextBatchIndex: 1, createdCount: 25 });
    const observed: SeedBatchRunState[] = [state];
    for (let step = 0; state.status !== 'succeeded' && step < 40; step += 1) {
      state = await advanceSeedBatchRun(repository, seed, OPTIONS);
      observed.push(state);
    }

    expect(state).toMatchObject({
      status: 'succeeded',
      nextBatchIndex: 15,
      verifiedBatchCount: 15,
      createdCount: 374,
    });
    expect(countSeedDocuments(database.snapshot())).toBe(374);
    const firstSucceeded = observed.findIndex((item) => item.status === 'succeeded');
    expect(firstSucceeded).toBe(observed.length - 1);
    expect(observed.slice(0, -1).every((item) => item.status !== 'succeeded')).toBe(true);
    expect(observed.some((item) => item.status === 'verifying' && item.verifiedBatchCount === 0)).toBe(true);
    expect(database.observedTransactionFindCount).toBe(0);
  }, AUTHORITATIVE_SEED_TIMEOUT_MS);

  it('回滚按创建记录反向分批；外部修改时停止并保留现场，修复后可恢复精确回滚', async () => {
    const seed = createAuthoritativeM1SeedPackage();
    const database = new FakeDocumentDatabase();
    const repository = createRepository(database);
    await completeImport(repository, seed, OPTIONS);

    const run = await readRun(repository, seed.manifest.seedRunId);
    const lastReference = run!.createdDocumentIds.at(-1)!;
    const originalStored = database.snapshot()[lastReference.collection]?.find((item) => item._id === lastReference.id);
    expect(originalStored).toBeDefined();
    await replaceStoredDocument(database, lastReference.collection, lastReference.id, (current) => ({
      ...current,
      version: current.version + 1,
      externallyModifiedForTest: true,
    }));

    await expect(beginSeedBatchRollback(repository, seed.manifest.seedRunId, OPTIONS)).resolves.toMatchObject({
      status: 'rolling_back', rollbackCursor: 374,
    });
    await expect(advanceSeedBatchRollback(repository, seed.manifest.seedRunId, OPTIONS)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(countSeedDocuments(database.snapshot())).toBe(374);
    await expect(readRun(repository, seed.manifest.seedRunId)).resolves.toMatchObject({
      status: 'failed',
      failedFromStatus: 'rolling_back',
      rollbackCursor: 374,
    });

    await replaceStoredDocument(database, lastReference.collection, lastReference.id, () => originalStored!);
    let state = await resumeFailedSeedBatchRun(repository, seed, OPTIONS);
    expect(state).toMatchObject({ status: 'rolling_back', rollbackCursor: 374 });
    for (let step = 0; state.status !== 'rolled_back' && step < 20; step += 1) {
      state = await advanceSeedBatchRollback(repository, seed.manifest.seedRunId, OPTIONS);
    }

    expect(state).toMatchObject({ status: 'rolled_back', rollbackCursor: 0, createdCount: 374 });
    expect(countSeedDocuments(database.snapshot())).toBe(0);
    expect(database.snapshot().migration_runs).toHaveLength(1);
    expect(database.snapshot().migration_runs?.[0]).toMatchObject({ status: 'rolled_back' });
  }, AUTHORITATIVE_SEED_TIMEOUT_MS);
});

function createRepository(database: FakeDocumentDatabase): SeedRepositoryPort {
  return createSeedDocumentDatabaseRepository(database, {
    organizationId: ORGANIZATION_ID,
    maxPortOperationsPerTransaction: 80,
  });
}

async function completeImport(
  repository: SeedRepositoryPort,
  seed: ReturnType<typeof createAuthoritativeM1SeedPackage>,
  options: SeedBatchCoordinatorOptions,
): Promise<SeedBatchRunState> {
  let state = await planSeedBatchRun(repository, seed, options);
  for (let step = 0; state.status !== 'succeeded' && step < 40; step += 1) {
    state = await advanceSeedBatchRun(repository, seed, options);
  }
  expect(state.status).toBe('succeeded');
  return state;
}

async function readRun(repository: SeedRepositoryPort, seedRunId: string): Promise<SeedMigrationRun | null> {
  return repository.transaction(async (transaction) => transaction.getMigrationRun(seedRunId));
}

async function replaceStoredDocument(
  database: FakeDocumentDatabase,
  collection: string,
  documentId: string,
  change: (current: VersionedDocument) => VersionedDocument,
): Promise<void> {
  await database.runTransaction(async (transaction) => {
    const current = await transaction.get(collection, documentId);
    expect(current).not.toBeNull();
    expect(await transaction.replace(collection, documentId, current!.version, change(current!))).toBe(true);
  });
}

function countSeedDocuments(snapshot: Readonly<Record<string, readonly VersionedDocument[]>>): number {
  return SEED_COLLECTION_ORDER.reduce((count, collection) => count + (snapshot[collection]?.length ?? 0), 0);
}
