import { describe, expect, it } from 'vitest';
import { createAuthoritativeM1SeedPackage } from '../../src/seed/authoritative-fixture';
import { planSeedBatchRun, type SeedBatchCoordinatorOptions } from '../../src/seed/batch-coordinator';
import { computeSeedContentHash, prepareSeedPackage } from '../../src/seed/canonical-json';
import { MemorySeedRepository } from '../../src/seed/memory-repository';
import type { SeedPackage } from '../../src/seed/model';
import {
  materializeRuntimeIdentityDigests,
  type RuntimeIdentityDigestBinding,
} from '../../src/seed/runtime-identity-materialization';
import { validateSeedPackage } from '../../src/seed/validator';

const COORDINATOR_OPTIONS: SeedBatchCoordinatorOptions = {
  executedBy: 'sys_seed_runtime_identity_test',
  requestId: 'request_seed_runtime_identity_test',
  batchSize: 25,
  now: () => '2026-09-17T14:00:00+08:00',
};

describe('runtime identity materialization', () => {
  it('按 exact userId 一一替换摘要、不修改输入，并重算 manifest contentHash', () => {
    const fixture = createAuthoritativeM1SeedPackage();
    const before = JSON.stringify(fixture);
    const bindings = createBindings(fixture).reverse();

    const result = materializeRuntimeIdentityDigests(fixture, bindings);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.stringify(fixture)).toBe(before);
    expect(result.seed.manifest.contentHash).not.toBe(fixture.manifest.contentHash);
    expect(result.seed.manifest.contentHash).toBe(computeSeedContentHash(result.seed));
    expect(result.seed.collections.auth_identities.every((identity) => (
      /^sd1_[A-Za-z0-9_-]{43}$/.test(String(identity.providerSubjectDigest))
    ))).toBe(true);
    expect(result.seed.collections.auth_identities.map((identity) => identity.providerSubjectDigest)).toEqual(
      fixture.collections.auth_identities.map((identity, index) => runtimeDigest(index)),
    );
  });

  it('默认校验和默认批次协调器仍拒绝 runtime 包，只有显式 runtime profile 才接受', async () => {
    const fixture = createAuthoritativeM1SeedPackage();
    const result = materializeRuntimeIdentityDigests(fixture, createBindings(fixture));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(validateSeedPackage(fixture, { identityProfile: 'runtime' }).ok).toBe(false);
    expect(validateSeedPackage(result.seed).ok).toBe(false);
    expect(validateSeedPackage(result.seed, { identityProfile: 'runtime' })).toMatchObject({ ok: true, issues: [] });
    await expect(planSeedBatchRun(new MemorySeedRepository(), result.seed, COORDINATOR_OPTIONS))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(planSeedBatchRun(new MemorySeedRepository(), result.seed, {
      ...COORDINATOR_OPTIONS,
      identityProfile: 'runtime',
    })).resolves.toMatchObject({ status: 'planned', totalBatches: 15 });
  });

  it('拒绝缺失、多余或重复 userId', () => {
    const fixture = createAuthoritativeM1SeedPackage();
    const bindings = createBindings(fixture);
    const missing = materializeRuntimeIdentityDigests(fixture, bindings.slice(1));
    const extra = materializeRuntimeIdentityDigests(fixture, [
      ...bindings,
      { userId: 'usr_extra_demo_01', providerSubjectDigest: runtimeDigest(bindings.length) },
    ]);
    const duplicate = materializeRuntimeIdentityDigests(fixture, [
      ...bindings,
      { userId: bindings[0]!.userId, providerSubjectDigest: runtimeDigest(bindings.length) },
    ]);

    expect(issueCodes(missing)).toContain('MISSING_USER_ID');
    expect(issueCodes(extra)).toContain('EXTRA_USER_ID');
    expect(issueCodes(duplicate)).toContain('DUPLICATE_USER_ID');
  });

  it('拒绝权威身份集合自身重复的 userId 与摘要占位', () => {
    const userIdDuplicate = mutateFixture((identities) => {
      identities[1] = { ...identities[1]!, userId: identities[0]!.userId };
    });
    const digestDuplicate = mutateFixture((identities) => {
      identities[1] = {
        ...identities[1]!,
        providerSubjectDigest: identities[0]!.providerSubjectDigest,
      };
    });

    expect(issueCodes(materializeRuntimeIdentityDigests(userIdDuplicate, createBindings(userIdDuplicate))))
      .toContain('DUPLICATE_USER_ID');
    expect(issueCodes(materializeRuntimeIdentityDigests(digestDuplicate, createBindings(digestDuplicate))))
      .toContain('DUPLICATE_DIGEST');
  });

  it('拒绝重复 digest，并严格限制 sd1_ 加 43 位 base64url', () => {
    const fixture = createAuthoritativeM1SeedPackage();
    const duplicate = [...createBindings(fixture)];
    duplicate[1] = { ...duplicate[1]!, providerSubjectDigest: duplicate[0]!.providerSubjectDigest };
    expect(issueCodes(materializeRuntimeIdentityDigests(fixture, duplicate))).toContain('DUPLICATE_DIGEST');

    for (const invalidDigest of [
      'fixture_digest_not_runtime',
      `sd1_${'A'.repeat(42)}`,
      `sd1_${'A'.repeat(44)}`,
      `sd1_${'A'.repeat(42)}=`,
      `sd1_${'A'.repeat(42)}+`,
      `sd1_${'A'.repeat(42)}/`,
    ]) {
      const invalid = [...createBindings(fixture)];
      invalid[0] = { ...invalid[0]!, providerSubjectDigest: invalidDigest };
      expect(issueCodes(materializeRuntimeIdentityDigests(fixture, invalid))).toContain('INVALID_RUNTIME_DIGEST');
    }
  });

  it('严格拒绝携带原始身份、手机号或密码字段，错误结果不回显其值', () => {
    const fixture = createAuthoritativeM1SeedPackage();
    const bindings: readonly unknown[] = createBindings(fixture).map((binding, index) => index === 0 ? {
      ...binding,
      platformUid: 'fake-raw-platform-uid',
      mobile: '13900000000',
      password: 'fake-password-value',
    } : binding);

    const result = materializeRuntimeIdentityDigests(fixture, bindings);
    const serialized = JSON.stringify(result);

    expect(issueCodes(result)).toContain('INVALID_BINDINGS');
    expect(serialized).not.toContain('fake-raw-platform-uid');
    expect(serialized).not.toContain('13900000000');
    expect(serialized).not.toContain('fake-password-value');
  });
});

function createBindings(seed: SeedPackage): readonly RuntimeIdentityDigestBinding[] {
  return seed.collections.auth_identities.map((identity, index) => ({
    userId: String(identity.userId),
    providerSubjectDigest: runtimeDigest(index),
  }));
}

function runtimeDigest(index: number): string {
  return `sd1_${index.toString(36).padStart(43, 'A')}`;
}

function issueCodes(result: ReturnType<typeof materializeRuntimeIdentityDigests>): readonly string[] {
  return result.ok ? [] : result.issues.map((issue) => issue.code);
}

function mutateFixture(change: (identities: Array<Record<string, unknown>>) => void): SeedPackage {
  const fixture = createAuthoritativeM1SeedPackage();
  const identities = fixture.collections.auth_identities.map((identity) => ({ ...identity }));
  change(identities);
  return prepareSeedPackage({
    manifest: { ...fixture.manifest },
    collections: { ...fixture.collections, auth_identities: identities as SeedPackage['collections']['auth_identities'] },
  });
}
