import { describe, expect, it } from 'vitest';
import { applySeedPackage, rollbackSeedRun, verifySeedPackage } from '../../src/seed/apply-core';
import { createAuthoritativeM1SeedPackage } from '../../src/seed/authoritative-fixture';
import { canonicalJson } from '../../src/seed/canonical-json';
import { createCrossOrganizationSecuritySeedPackage } from '../../src/seed/cross-organization-security-fixture';
import { MemorySeedRepository } from '../../src/seed/memory-repository';
import { SEED_COLLECTION_ORDER, type SeedPackage } from '../../src/seed/model';
import { validateSeedPackage } from '../../src/seed/validator';

const OPTIONS = {
  executedBy: 'sys_cross_org_security_test',
  now: () => '2026-09-17T15:30:00+08:00',
};

describe('M1 跨组织安全测试 seed fixture', () => {
  it('确定性生成独立的 17 条最小 seed', () => {
    const first = createCrossOrganizationSecuritySeedPackage();
    const second = createCrossOrganizationSecuritySeedPackage();

    expect(canonicalJson(first)).toBe(canonicalJson(second));
    expect(first.manifest.contentHash).toBe(second.manifest.contentHash);
    expect(first.manifest.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(first.manifest.seedRunId).toBe('seed_m1_cross_org_security_v2');
    expect(totalDocuments(first)).toBe(17);
  });

  it('通过现有 validator，并包含四角色及完整关系链', () => {
    const seed = createCrossOrganizationSecuritySeedPackage();

    expect(validateSeedPackage(seed)).toMatchObject({ ok: true, issues: [] });
    expect(seed.manifest.expectedCounts).toEqual({
      organizations: 1,
      classes: 1,
      users: 4,
      auth_identities: 4,
      role_assignments: 4,
      class_memberships: 1,
      teacher_class_grants: 1,
      parent_student_links: 1,
      learning_resources: 0,
      tasks: 0,
      task_assignments: 0,
      submissions: 0,
      review_feedback: 0,
    });
    expect(seed.collections.role_assignments.map((assignment) => assignment.role).sort()).toEqual([
      'admin',
      'parent',
      'student',
      'teacher',
    ]);
    expect(seed.collections.role_assignments.find((assignment) => assignment.role === 'admin')?.permissions).toEqual([
      'organization.read', 'organization.manage', 'class.read', 'class.manage',
      'user.read', 'user.manage', 'authorization.manage', 'audit.read',
      'student.bind-code.issue',
    ]);
    expect(seed.collections.auth_identities.map((identity) => identity.userId).sort()).toEqual(
      seed.collections.users.map((user) => user._id).sort(),
    );
    expect(seed.collections.class_memberships[0]).toMatchObject({
      organizationId: 'org_isolation_secondary',
      classId: 'cls_isolation_secondary',
      studentId: 'usr_isolation_student',
    });
    expect(seed.collections.teacher_class_grants[0]).toMatchObject({
      organizationId: 'org_isolation_secondary',
      classId: 'cls_isolation_secondary',
      teacherId: 'usr_isolation_teacher',
    });
    expect(seed.collections.parent_student_links[0]).toMatchObject({
      organizationId: 'org_isolation_secondary',
      parentId: 'usr_isolation_parent',
      studentId: 'usr_isolation_student',
    });
  });

  it('seedRunId 与所有文档 ID 均不占用权威演示 seed', () => {
    const securitySeed = createCrossOrganizationSecuritySeedPackage();
    const authoritativeSeed = createAuthoritativeM1SeedPackage();
    const authoritativeIds = documentKeys(authoritativeSeed);

    expect(securitySeed.manifest.seedRunId).not.toBe(authoritativeSeed.manifest.seedRunId);
    for (const key of documentKeys(securitySeed)) {
      expect(authoritativeIds.has(key), key).toBe(false);
    }
  });

  it('只含虚构身份占位，不含联系方式或凭据', () => {
    const serialized = canonicalJson(createCrossOrganizationSecuritySeedPackage());

    expect(serialized).not.toMatch(/\b1[3-9]\d{9}\b/);
    expect(serialized).not.toMatch(/password|mobile|phone|email|credential|accessToken|refreshToken/i);
  });

  it('复用现有 apply/verify/rollback 核心完成闭环', async () => {
    const seed = createCrossOrganizationSecuritySeedPackage();
    const repository = new MemorySeedRepository();

    await expect(applySeedPackage(repository, seed, OPTIONS)).resolves.toMatchObject({
      status: 'applied',
      createdCount: 17,
      skippedCount: 0,
    });
    await expect(verifySeedPackage(repository, seed)).resolves.toMatchObject({
      ok: true,
      expectedCount: 17,
      matchedCount: 17,
    });
    expect(repository.listDocuments()).toHaveLength(17);
    await expect(rollbackSeedRun(repository, seed.manifest.seedRunId, OPTIONS)).resolves.toMatchObject({
      status: 'rolled_back',
      deletedCount: 17,
    });
    expect(repository.listDocuments()).toHaveLength(0);
  });
});

function totalDocuments(seed: SeedPackage): number {
  return SEED_COLLECTION_ORDER.reduce((total, collection) => total + seed.collections[collection].length, 0);
}

function documentKeys(seed: SeedPackage): ReadonlySet<string> {
  return new Set(SEED_COLLECTION_ORDER.flatMap((collection) => (
    seed.collections[collection].map((document) => `${collection}/${String(document._id)}`)
  )));
}
