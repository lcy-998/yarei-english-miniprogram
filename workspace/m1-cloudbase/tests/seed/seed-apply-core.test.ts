import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { prepareSeedPackage } from '../../src/seed/canonical-json';
import {
  applySeedPackage,
  rollbackSeedRun,
  SeedOperationError,
  verifySeedPackage,
} from '../../src/seed/apply-core';
import { loadSeedFile } from '../../src/seed/loader';
import { MemorySeedRepository } from '../../src/seed/memory-repository';

const EXAMPLE_PATH = fileURLToPath(
  new URL('../../../../docs/m1-cloudbase/templates/development-seed.example.json', import.meta.url),
);
const FIXED_NOW = '2026-09-17T12:00:00+08:00';
const OPTIONS = { executedBy: 'sys_seed_test', now: () => FIXED_NOW };

describe('M1 安全种子 apply/verify/rollback 核心', () => {
  it('按确定顺序写入并记录 migration run、seedRunId 与单文档摘要', async () => {
    const seed = prepareSeedPackage(await loadSeedFile(EXAMPLE_PATH));
    const repository = new MemorySeedRepository();

    const result = await applySeedPackage(repository, seed, OPTIONS);

    expect(result).toMatchObject({ status: 'applied', createdCount: 19, skippedCount: 0 });
    expect(result.createdDocumentIds[0]).toMatchObject({ collection: 'organizations', id: 'org_qihang_demo' });
    expect(result.createdDocumentIds.at(-1)).toMatchObject({ collection: 'review_feedback' });
    expect(result.createdDocumentIds.every((reference) => /^sha256:[a-f0-9]{64}$/.test(reference.contentHash))).toBe(true);
    expect(repository.listDocuments().every((document) => (
      document.seedRunId === seed.manifest.seedRunId
      && document.seedVersion === seed.manifest.seedVersion
    ))).toBe(true);
    expect(repository.getMigrationRun(seed.manifest.seedRunId)).toMatchObject({
      status: 'succeeded',
      contentHash: seed.manifest.contentHash,
      counts: seed.manifest.expectedCounts,
      executedBy: 'sys_seed_test',
      startedAt: FIXED_NOW,
      finishedAt: FIXED_NOW,
    });
    await expect(verifySeedPackage(repository, seed)).resolves.toMatchObject({ ok: true, matchedCount: 19 });
  });

  it('同 ID 同内容整体跳过且重复执行不产生新记录', async () => {
    const seed = prepareSeedPackage(await loadSeedFile(EXAMPLE_PATH));
    const repository = new MemorySeedRepository();
    await applySeedPackage(repository, seed, OPTIONS);

    const repeated = await applySeedPackage(repository, seed, OPTIONS);

    expect(repeated).toMatchObject({ status: 'already_applied', createdCount: 0, skippedCount: 19 });
    expect(repository.listDocuments()).toHaveLength(19);
  });

  it('已完成 run 的文档丢失时重复 apply 整体阻断而不静默补写', async () => {
    const seed = prepareSeedPackage(await loadSeedFile(EXAMPLE_PATH));
    const repository = new MemorySeedRepository();
    await applySeedPackage(repository, seed, OPTIONS);
    repository.deleteDocumentExternally('review_feedback', 'fbk_xiaoyu_animals_v1');

    await expect(applySeedPackage(repository, seed, OPTIONS)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(repository.listDocuments()).toHaveLength(18);
    expect(repository.getMigrationRun(seed.manifest.seedRunId)).toMatchObject({ status: 'succeeded' });
  });

  it('同 ID 不同内容在任何写入前阻断整个 apply', async () => {
    const seed = prepareSeedPackage(await loadSeedFile(EXAMPLE_PATH));
    const repository = new MemorySeedRepository();
    repository.seedExternalDocument('users', {
      ...seed.collections.users[0],
      displayName: '冲突的虚构姓名',
    });

    let thrown: unknown;
    try {
      await applySeedPackage(repository, seed, OPTIONS);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(SeedOperationError);
    expect(thrown).toMatchObject({ code: 'CONFLICT' });
    expect(repository.listDocuments()).toHaveLength(1);
    expect(repository.getMigrationRun(seed.manifest.seedRunId)).toBeNull();
  });

  it('同内容的外部既有文档被跳过，回滚不会删除它', async () => {
    const seed = prepareSeedPackage(await loadSeedFile(EXAMPLE_PATH));
    const repository = new MemorySeedRepository();
    repository.seedExternalDocument('organizations', seed.collections.organizations[0]);
    const applied = await applySeedPackage(repository, seed, OPTIONS);

    expect(applied).toMatchObject({ createdCount: 18, skippedCount: 1 });
    await expect(rollbackSeedRun(repository, seed.manifest.seedRunId, OPTIONS)).resolves.toMatchObject({
      status: 'rolled_back',
      deletedCount: 18,
    });
    expect(repository.listDocuments()).toHaveLength(1);
    expect(repository.getDocument('organizations', 'org_qihang_demo')).not.toBeNull();
    await expect(rollbackSeedRun(repository, seed.manifest.seedRunId, OPTIONS)).resolves.toMatchObject({
      status: 'already_rolled_back',
      deletedCount: 0,
    });
  });

  it('verify 对账能发现文档内容被外部修改', async () => {
    const seed = prepareSeedPackage(await loadSeedFile(EXAMPLE_PATH));
    const repository = new MemorySeedRepository();
    await applySeedPackage(repository, seed, OPTIONS);
    const current = repository.getDocument('tasks', 'tsk_animals_listening');
    expect(current).not.toBeNull();
    repository.replaceDocumentExternally('tasks', 'tsk_animals_listening', {
      ...current!.document,
      title: '外部修改后的虚构任务',
    });

    const verification = await verifySeedPackage(repository, seed);

    expect(verification.ok).toBe(false);
    expect(verification.issues.map((item) => item.code)).toEqual(expect.arrayContaining([
      'DOCUMENT_CONTENT_MISMATCH',
      'DOCUMENT_OWNERSHIP_MISMATCH',
    ]));
  });

  it('rollback 发现任一外部修改时整体停止且不发生部分删除', async () => {
    const seed = prepareSeedPackage(await loadSeedFile(EXAMPLE_PATH));
    const repository = new MemorySeedRepository();
    await applySeedPackage(repository, seed, OPTIONS);
    const current = repository.getDocument('tasks', 'tsk_animals_listening');
    repository.replaceDocumentExternally('tasks', 'tsk_animals_listening', {
      ...current!.document,
      title: '外部修改后的虚构任务',
    });

    await expect(rollbackSeedRun(repository, seed.manifest.seedRunId, OPTIONS)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(repository.listDocuments()).toHaveLength(19);
    expect(repository.getMigrationRun(seed.manifest.seedRunId)).toMatchObject({ status: 'succeeded' });
  });
});
