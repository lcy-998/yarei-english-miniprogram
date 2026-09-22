import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import type { VersionedDocument } from '../../src/repositories/document-database-port';
import type { SeedRepositoryPort } from '../../src/seed/apply-core';
import { createAuthoritativeM1SeedPackage } from '../../src/seed/authoritative-fixture';
import { prepareSeedPackage } from '../../src/seed/canonical-json';
import { createControlledSeedOperator } from '../../src/seed/controlled-operator';
import { createSeedDocumentDatabaseRepository } from '../../src/seed/document-database-repository';
import { loadSeedFile } from '../../src/seed/loader';
import { SEED_COLLECTION_ORDER, type SeedPackage } from '../../src/seed/model';
import { materializeRuntimeIdentityDigests } from '../../src/seed/runtime-identity-materialization';

const EXAMPLE_PATH = fileURLToPath(
  new URL('../../../../docs/m1-cloudbase/templates/development-seed.example.json', import.meta.url),
);
const ORGANIZATION_ID = 'org_qihang_demo';
const NOW = '2026-09-17T14:00:00+08:00';

describe('受控种子操作器', () => {
  it('status 只返回安全进度，不返回种子文档、操作者或凭据字段', async () => {
    const seed = await loadSeed();
    const database = new FakeDocumentDatabase();
    const operator = createOperator(createRepository(database));

    const result = await operator.execute(seed, request(seed, 'status'));

    expect(result).toEqual({
      command: 'status',
      requestId: 'request_controlled_seed',
      state: {
        seedRunId: seed.manifest.seedRunId,
        status: 'not_planned',
        nextBatchIndex: 0,
        totalBatches: 2,
        verifiedBatchCount: 0,
        rollbackCursor: 0,
        createdCount: 0,
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('executedBy');
    expect(serialized).not.toContain('collections');
    expect(serialized).not.toContain('displayName');
    expect(serialized).not.toContain('password');
  });

  it('任何 repository 调用前同时校验非生产 M1、synthetic-only、runId、请求、操作者和批大小', async () => {
    const seed = await loadSeed();
    const database = new FakeDocumentDatabase();
    let transactionCount = 0;
    const repository = createRepository(database);
    const counted: SeedRepositoryPort = {
      transaction: async (operation) => {
        transactionCount += 1;
        return repository.transaction(operation);
      },
    };
    const operator = createOperator(counted);
    const valid = request(seed, 'plan');
    const invalidRequests: readonly unknown[] = [
      { ...valid, command: 'run_to_completion' },
      { ...valid, guard: { ...valid.guard, environmentPurpose: 'production' } },
      { ...valid, guard: { ...valid.guard, dataClassification: 'mixed-data' } },
      { ...valid, expectedSeedRunId: 'seed_unexpected' },
      { ...valid, requestId: ' ' },
      { ...valid, executedBy: '' },
      { ...valid, batchSize: 26 },
      { ...valid, automatic: true },
      { ...valid, guard: { ...valid.guard, environmentId: 'must-not-be-accepted' } },
    ];

    for (const invalid of invalidRequests) {
      await expect(operator.execute(seed, invalid)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    }
    expect(transactionCount).toBe(0);
    expect(database.snapshot()).toEqual({});
  });

  it('默认保持 fixture-only，runtime 包必须在严格 guard 中显式选择 runtime profile', async () => {
    const fixture = createAuthoritativeM1SeedPackage();
    const materialized = materializeRuntimeIdentityDigests(
      fixture,
      fixture.collections.auth_identities.map((identity, index) => ({
        userId: String(identity.userId),
        providerSubjectDigest: `sd1_${index.toString(36).padStart(43, 'A')}`,
      })),
    );
    expect(materialized.ok).toBe(true);
    if (!materialized.ok) return;
    const database = new FakeDocumentDatabase();
    const operator = createOperator(createRepository(database));

    await expect(operator.execute(materialized.seed, request(materialized.seed, 'plan')))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(database.snapshot()).toEqual({});
    await expect(operator.execute(materialized.seed, {
      ...request(materialized.seed, 'plan', 25),
      guard: {
        environmentPurpose: 'm1-non-production',
        dataClassification: 'synthetic-only',
        identityProfile: 'runtime',
      },
    })).resolves.toMatchObject({ state: { status: 'planned', totalBatches: 15 } });
  });

  it('plan/advance 每次只推进一个状态或一个批次，且完整 verify 前绝不成功', async () => {
    const seed = await loadSeed();
    const database = new FakeDocumentDatabase();
    const operator = createOperator(createRepository(database));
    const run = (command: Parameters<typeof request>[1]) => operator.execute(seed, request(seed, command));

    await expect(run('plan')).resolves.toMatchObject({ state: { status: 'planned', createdCount: 0 } });
    expect(countDocuments(database.snapshot())).toBe(0);
    await expect(run('advance')).resolves.toMatchObject({ state: { status: 'applying', nextBatchIndex: 0 } });
    expect(countDocuments(database.snapshot())).toBe(0);
    await expect(run('advance')).resolves.toMatchObject({ state: { status: 'applying', nextBatchIndex: 1, createdCount: 10 } });
    expect(countDocuments(database.snapshot())).toBe(10);
    await expect(run('advance')).resolves.toMatchObject({ state: { status: 'applying', nextBatchIndex: 2, createdCount: 19 } });
    expect(countDocuments(database.snapshot())).toBe(19);
    await expect(run('advance')).resolves.toMatchObject({ state: { status: 'verifying', verifiedBatchCount: 0 } });
    await expect(run('advance')).resolves.toMatchObject({ state: { status: 'verifying', verifiedBatchCount: 1 } });
    await expect(run('advance')).resolves.toMatchObject({ state: { status: 'verifying', verifiedBatchCount: 2 } });
    await expect(run('status')).resolves.toMatchObject({ state: { status: 'verifying' } });
    await expect(run('advance')).resolves.toMatchObject({ state: { status: 'succeeded', createdCount: 19 } });
  });

  it('resume 只恢复失败阶段，不在同一次调用内继续写下一个批次', async () => {
    const seed = await loadSeed();
    const database = new FakeDocumentDatabase();
    const operator = createOperator(createRepository(database));
    await operator.execute(seed, request(seed, 'plan'));
    await operator.execute(seed, request(seed, 'advance'));
    database.failNext({ operation: 'commit', kind: 'unavailable' });
    await expect(operator.execute(seed, request(seed, 'advance'))).rejects.toMatchObject({ kind: 'unavailable' });

    await expect(operator.execute(seed, request(seed, 'status'))).resolves.toMatchObject({
      state: { status: 'failed', nextBatchIndex: 0, createdCount: 0 },
    });
    await expect(operator.execute(seed, request(seed, 'resume'))).resolves.toMatchObject({
      state: { status: 'applying', nextBatchIndex: 0, createdCount: 0 },
    });
    expect(countDocuments(database.snapshot())).toBe(0);
  });

  it('begin_rollback 只切换状态，advance_rollback 每次最多删除一个既定批次', async () => {
    const seed = await loadSeed();
    const database = new FakeDocumentDatabase();
    const operator = createOperator(createRepository(database));
    const run = (command: Parameters<typeof request>[1]) => operator.execute(seed, request(seed, command));
    await run('plan');
    for (let step = 0; step < 7; step += 1) await run('advance');
    await expect(run('status')).resolves.toMatchObject({ state: { status: 'succeeded', createdCount: 19 } });

    await expect(run('begin_rollback')).resolves.toMatchObject({ state: { status: 'rolling_back', rollbackCursor: 19 } });
    expect(countDocuments(database.snapshot())).toBe(19);
    await expect(run('advance_rollback')).resolves.toMatchObject({ state: { status: 'rolling_back', rollbackCursor: 9 } });
    expect(countDocuments(database.snapshot())).toBe(9);
  });

  it('允许新种子上下文按已保存的摘要精确回滚旧批次', async () => {
    const oldSeed = await loadSeed();
    const database = new FakeDocumentDatabase();
    const operator = createOperator(createRepository(database));
    const run = (command: 'plan' | 'advance' | 'begin_rollback' | 'advance_rollback', seed = oldSeed, targetSeedRunId?: string) => operator.execute(seed, {
      ...request(seed, command),
      ...(targetSeedRunId === undefined ? {} : { expectedSeedRunId: targetSeedRunId }),
    });

    await run('plan');
    for (let step = 0; step < 7; step += 1) await run('advance');
    const newSeed = prepareSeedPackage({
      ...oldSeed,
      manifest: { ...oldSeed.manifest, seedRunId: 'seed_current_v2', seedVersion: 'm1-current-v2' },
      collections: Object.fromEntries(SEED_COLLECTION_ORDER.map((collection) => [collection, oldSeed.collections[collection].map((document) => ({
        ...document,
        seedRunId: 'seed_current_v2',
      }))])) as SeedPackage['collections'],
    });

    await expect(run('begin_rollback', newSeed, oldSeed.manifest.seedRunId)).resolves.toMatchObject({
      state: { seedRunId: oldSeed.manifest.seedRunId, status: 'rolling_back', rollbackCursor: 19 },
    });
    await expect(run('advance_rollback', newSeed, oldSeed.manifest.seedRunId)).resolves.toMatchObject({
      state: { seedRunId: oldSeed.manifest.seedRunId, status: 'rolling_back', rollbackCursor: 9 },
    });
  });
});

function createOperator(repository: SeedRepositoryPort) {
  return createControlledSeedOperator({ repository, now: () => NOW });
}

function createRepository(database: FakeDocumentDatabase): SeedRepositoryPort {
  return createSeedDocumentDatabaseRepository(database, {
    organizationId: ORGANIZATION_ID,
    maxPortOperationsPerTransaction: 40,
  });
}

function request(
  seed: SeedPackage,
  command: 'status' | 'plan' | 'advance' | 'resume' | 'begin_rollback' | 'advance_rollback',
  batchSize = 10,
) {
  return {
    command,
    guard: {
      environmentPurpose: 'm1-non-production' as const,
      dataClassification: 'synthetic-only' as const,
    },
    expectedSeedRunId: seed.manifest.seedRunId,
    requestId: 'request_controlled_seed',
    executedBy: 'sys_controlled_seed_test',
    batchSize,
  };
}

async function loadSeed(): Promise<SeedPackage> {
  return prepareSeedPackage(await loadSeedFile(EXAMPLE_PATH));
}

function countDocuments(snapshot: Readonly<Record<string, readonly VersionedDocument[]>>): number {
  return SEED_COLLECTION_ORDER.reduce((count, collection) => count + (snapshot[collection]?.length ?? 0), 0);
}
