import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { JsonObject } from '../../src/shared/protocol';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import type { VersionedDocument } from '../../src/repositories/document-database-port';
import { createAuthoritativeM1SeedPackage } from '../../src/seed/authoritative-fixture';
import { prepareSeedPackage } from '../../src/seed/canonical-json';
import {
  applySeedPackage,
  rollbackSeedRun,
  SeedOperationError,
  verifySeedPackage,
} from '../../src/seed/apply-core';
import { createSeedDocumentDatabaseRepository } from '../../src/seed/document-database-repository';
import { loadSeedFile } from '../../src/seed/loader';
import { SEED_COLLECTION_ORDER, type SeedPackage } from '../../src/seed/model';

const EXAMPLE_PATH = fileURLToPath(
  new URL('../../../../docs/m1-cloudbase/templates/development-seed.example.json', import.meta.url),
);
const ORGANIZATION_ID = 'org_qihang_demo';
const FIXED_NOW = '2026-09-17T12:00:00+08:00';
const OPTIONS = { executedBy: 'sys_seed_contract', now: () => FIXED_NOW };

describe('SeedRepositoryPort 的 DocumentDatabasePort 事务适配器', () => {
  it('原子创建文档和 migration_runs，附加归属摘要，并可 verify 后精确回滚', async () => {
    const seed = await loadExampleSeed();
    const database = new FakeDocumentDatabase();
    const repository = createRepository(database, 100);

    const applied = await applySeedPackage(repository, seed, OPTIONS);

    expect(applied).toMatchObject({ status: 'applied', createdCount: 19, skippedCount: 0 });
    const afterApply = database.snapshot();
    const storedOrganization = afterApply.organizations?.[0];
    expect(storedOrganization).toMatchObject({
      _id: 'org_qihang_demo',
      seedRunId: seed.manifest.seedRunId,
      seedVersion: seed.manifest.seedVersion,
    });
    expect(storedOrganization?.seedDocumentContentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(afterApply.migration_runs?.[0]).toMatchObject({
      _id: seed.manifest.seedRunId,
      organizationId: ORGANIZATION_ID,
      status: 'succeeded',
      seedVersion: seed.manifest.seedVersion,
      contentHash: seed.manifest.contentHash,
      version: 1,
    });
    await expect(verifySeedPackage(repository, seed)).resolves.toMatchObject({ ok: true, matchedCount: 19 });
    await expect(applySeedPackage(repository, seed, OPTIONS)).resolves.toMatchObject({
      status: 'already_applied',
      createdCount: 0,
      skippedCount: 19,
    });

    await expect(rollbackSeedRun(repository, seed.manifest.seedRunId, OPTIONS)).resolves.toMatchObject({
      status: 'rolled_back',
      deletedCount: 19,
    });
    const afterRollback = database.snapshot();
    expect(countSeedDocuments(afterRollback)).toBe(0);
    expect(afterRollback.migration_runs?.[0]).toMatchObject({ status: 'rolled_back', version: 2 });
  });

  it('逐 ID 同内容跳过且回滚不删除预先存在的非本 run 文档', async () => {
    const seed = await loadExampleSeed();
    const existing = asVersionedDocument(seed.collections.organizations[0]!);
    const database = new FakeDocumentDatabase({ organizations: [existing] });
    const repository = createRepository(database, 100);

    await expect(applySeedPackage(repository, seed, OPTIONS)).resolves.toMatchObject({
      status: 'applied',
      createdCount: 18,
      skippedCount: 1,
    });
    await rollbackSeedRun(repository, seed.manifest.seedRunId, OPTIONS);

    const snapshot = database.snapshot();
    expect(snapshot.organizations).toEqual([existing]);
    expect(countSeedDocuments(snapshot)).toBe(1);
  });

  it('逐 ID 不同内容在首个写入前冲突，事务不留下文档或 migration run', async () => {
    const seed = await loadExampleSeed();
    const conflictDocument = asVersionedDocument({
      ...seed.collections.users[0],
      displayName: '冲突的虚构学员',
    });
    const database = new FakeDocumentDatabase({ users: [conflictDocument] });
    const repository = createRepository(database, 100);

    let thrown: unknown;
    try {
      await applySeedPackage(repository, seed, OPTIONS);
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(SeedOperationError);
    expect(thrown).toMatchObject({ code: 'CONFLICT' });
    const snapshot = database.snapshot();
    expect(snapshot.users).toEqual([conflictDocument]);
    expect(snapshot.migration_runs ?? []).toHaveLength(0);
    expect(countSeedDocuments(snapshot)).toBe(1);
  });

  it('verify 发现外部修改，rollback 整体停止且不发生部分删除', async () => {
    const seed = await loadExampleSeed();
    const database = new FakeDocumentDatabase();
    const repository = createRepository(database, 100);
    await applySeedPackage(repository, seed, OPTIONS);

    await database.runTransaction(async (transaction) => {
      const current = await transaction.get('tasks', 'tsk_animals_listening');
      expect(current).not.toBeNull();
      const replaced = await transaction.replace('tasks', current!._id, current!.version, {
        ...current!,
        title: '外部修改后的虚构任务',
        version: current!.version + 1,
      });
      expect(replaced).toBe(true);
    });

    await expect(verifySeedPackage(repository, seed)).resolves.toMatchObject({ ok: false });
    await expect(rollbackSeedRun(repository, seed.manifest.seedRunId, OPTIONS)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(countSeedDocuments(database.snapshot())).toBe(19);
    expect(database.snapshot().migration_runs?.[0]).toMatchObject({ status: 'succeeded' });
  });

  it('权威规模超过已验证事务预算时在首个写入前失败关闭', async () => {
    const seed = createAuthoritativeM1SeedPackage();
    const database = new FakeDocumentDatabase();
    const repository = createRepository(database, 500);

    await expect(applySeedPackage(repository, seed, OPTIONS)).rejects.toMatchObject({
      code: 'CAPACITY_EXCEEDED',
    });
    const snapshot = database.snapshot();
    expect(countSeedDocuments(snapshot)).toBe(0);
    expect(snapshot.migration_runs ?? []).toHaveLength(0);
  });
});

async function loadExampleSeed(): Promise<SeedPackage> {
  return prepareSeedPackage(await loadSeedFile(EXAMPLE_PATH));
}

function createRepository(database: FakeDocumentDatabase, maxPortOperationsPerTransaction: number) {
  return createSeedDocumentDatabaseRepository(database, {
    organizationId: ORGANIZATION_ID,
    maxPortOperationsPerTransaction,
  });
}

function asVersionedDocument(document: JsonObject): VersionedDocument {
  return JSON.parse(JSON.stringify(document)) as VersionedDocument;
}

function countSeedDocuments(snapshot: Readonly<Record<string, readonly VersionedDocument[]>>): number {
  return SEED_COLLECTION_ORDER.reduce((count, collection) => count + (snapshot[collection]?.length ?? 0), 0);
}
