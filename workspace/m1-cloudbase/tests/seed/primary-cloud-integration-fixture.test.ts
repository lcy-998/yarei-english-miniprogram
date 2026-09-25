import { describe, expect, it } from 'vitest';
import { applySeedPackage, rollbackSeedRun, verifySeedPackage } from '../../src/seed/apply-core';
import { createAuthoritativeM1SeedPackage, summarizeAuthoritativeM1Seed } from '../../src/seed/authoritative-fixture';
import { computeSeedContentHash } from '../../src/seed/canonical-json';
import { MemorySeedRepository } from '../../src/seed/memory-repository';
import { SEED_COLLECTION_ORDER } from '../../src/seed/model';
import {
  createPrimaryCloudIntegrationSeedPackage,
  PRIMARY_CLOUD_INTEGRATION_ACTOR_USER_IDS,
  PRIMARY_CLOUD_INTEGRATION_SEED_RUN_ID,
} from '../../src/seed/primary-cloud-integration-fixture';
import { materializeRuntimeIdentityDigests } from '../../src/seed/runtime-identity-materialization';
import { validateSeedPackage } from '../../src/seed/validator';

const OPTIONS = {
  executedBy: 'sys_primary_cloud_integration_test',
  now: () => '2026-09-17T20:30:00+08:00',
};

describe('主组织云联调 seed 派生器', () => {
  it('只保留四个实际登录 actor 身份并确定性重算计数与摘要', () => {
    const first = createPrimaryCloudIntegrationSeedPackage();
    const second = createPrimaryCloudIntegrationSeedPackage();

    expect(first).toEqual(second);
    expect(first.collections.auth_identities.map((identity) => identity.userId).sort()).toEqual(
      [...PRIMARY_CLOUD_INTEGRATION_ACTOR_USER_IDS].sort(),
    );
    expect(first.collections.auth_identities).toHaveLength(4);
    expect(first.manifest.seedRunId).toBe(PRIMARY_CLOUD_INTEGRATION_SEED_RUN_ID);
    expect(first.manifest.seedRunId).not.toBe(createAuthoritativeM1SeedPackage().manifest.seedRunId);
    expect(SEED_COLLECTION_ORDER.every((collection) => first.collections[collection].every((document) => (
      document.seedRunId === PRIMARY_CLOUD_INTEGRATION_SEED_RUN_ID
    )))).toBe(true);
    expect(first.manifest.expectedCounts.auth_identities).toBe(4);
    expect(first.manifest.contentHash).toBe(computeSeedContentHash(first));
    expect(first.manifest.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(totalDocuments(first)).toBe(307);
    expect(validateSeedPackage(first)).toMatchObject({ ok: true, issues: [] });
  });

  it('不修改输入，除身份裁剪、独立 runId 与派生 manifest 元数据外保持权威内容', () => {
    const authoritative = createAuthoritativeM1SeedPackage();
    const before = JSON.stringify(authoritative);

    const derived = createPrimaryCloudIntegrationSeedPackage(authoritative);

    expect(JSON.stringify(authoritative)).toBe(before);
    for (const collection of SEED_COLLECTION_ORDER) {
      if (collection === 'auth_identities') continue;
      expect(derived.collections[collection]).toEqual(authoritative.collections[collection].map((document) => ({
        ...document,
        seedRunId: PRIMARY_CLOUD_INTEGRATION_SEED_RUN_ID,
      })));
    }
    expect(derived.manifest.seedVersion).toBe('m1-cloud-integration-v4');
    expect(derived.manifest.seedRunId).toBe(PRIMARY_CLOUD_INTEGRATION_SEED_RUN_ID);
    expect(derived.manifest.expectedCounts.auth_identities).toBe(4);
    expect(derived.manifest.contentHash).not.toBe(authoritative.manifest.contentHash);
  });

  it('不为其余 67 名学生或其他非登录用户生成身份记录', () => {
    const derived = createPrimaryCloudIntegrationSeedPackage();
    const identityUserIds = new Set(derived.collections.auth_identities.map((identity) => String(identity.userId)));
    const studentUserIds = derived.collections.role_assignments
      .filter((role) => role.role === 'student')
      .map((role) => String(role.userId));

    expect(studentUserIds).toHaveLength(68);
    expect(studentUserIds.filter((userId) => identityUserIds.has(userId))).toEqual(['usr_student_g3_01']);
    expect(studentUserIds.filter((userId) => !identityUserIds.has(userId))).toHaveLength(67);
    expect(derived.collections.users).toHaveLength(71);
    expect(derived.collections.role_assignments).toHaveLength(71);
  });

  it('默认 apply、verify 和 rollback 可完整处理派生包', async () => {
    const seed = createPrimaryCloudIntegrationSeedPackage();
    const repository = new MemorySeedRepository();

    await expect(applySeedPackage(repository, seed, OPTIONS)).resolves.toMatchObject({
      status: 'applied', createdCount: 307, skippedCount: 0,
    });
    await expect(verifySeedPackage(repository, seed)).resolves.toMatchObject({
      ok: true, expectedCount: 307, matchedCount: 307, issues: [],
    });
    await expect(rollbackSeedRun(repository, seed.manifest.seedRunId, OPTIONS)).resolves.toMatchObject({
      status: 'rolled_back', deletedCount: 307,
    });
    expect(repository.listDocuments()).toHaveLength(0);
  });

  it('runtime identity materialization 只需四条 digest binding 并通过 runtime 校验', () => {
    const fixture = createPrimaryCloudIntegrationSeedPackage();
    const bindings = fixture.collections.auth_identities.map((identity, index) => ({
      userId: String(identity.userId),
      providerSubjectDigest: runtimeDigest(index),
    }));

    expect(bindings).toHaveLength(4);
    const result = materializeRuntimeIdentityDigests(fixture, bindings);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.seed.collections.auth_identities).toHaveLength(4);
    expect(result.seed.collections.auth_identities.map((identity) => identity.providerSubjectDigest)).toEqual(
      bindings.map((binding) => binding.providerSubjectDigest),
    );
    expect(validateSeedPackage(result.seed, { identityProfile: 'runtime' })).toMatchObject({ ok: true, issues: [] });
  });

  it('权威生成器仍保持 374 条文档和 71 条身份，不被派生器改写', () => {
    createPrimaryCloudIntegrationSeedPackage();
    const authoritative = createAuthoritativeM1SeedPackage();

    expect(totalDocuments(authoritative)).toBe(374);
    expect(authoritative.collections.auth_identities).toHaveLength(71);
    expect(summarizeAuthoritativeM1Seed(authoritative).totalDocuments).toBe(374);
  });
});

function totalDocuments(seed: ReturnType<typeof createAuthoritativeM1SeedPackage>): number {
  return SEED_COLLECTION_ORDER.reduce((total, collection) => total + seed.collections[collection].length, 0);
}

function runtimeDigest(index: number): string {
  return `sd1_${index.toString(36).padStart(43, 'A')}`;
}
