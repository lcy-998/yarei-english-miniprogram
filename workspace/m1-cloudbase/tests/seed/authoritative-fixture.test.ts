import { describe, expect, it } from 'vitest';
import {
  createAuthoritativeM1SeedPackage,
  summarizeAuthoritativeM1Seed,
} from '../../src/seed/authoritative-fixture';
import { canonicalJson } from '../../src/seed/canonical-json';
import { applySeedPackage, rollbackSeedRun, verifySeedPackage } from '../../src/seed/apply-core';
import { MemorySeedRepository } from '../../src/seed/memory-repository';
import { validateSeedPackage } from '../../src/seed/validator';

const OPTIONS = {
  executedBy: 'sys_seed_test',
  now: () => '2026-09-17T12:00:00+08:00',
};

describe('M1 权威规模虚构 seed fixture', () => {
  it('确定性生成相同的规范内容与摘要', () => {
    const first = createAuthoritativeM1SeedPackage();
    const second = createAuthoritativeM1SeedPackage();

    expect(canonicalJson(first)).toBe(canonicalJson(second));
    expect(first.manifest.contentHash).toBe(second.manifest.contentHash);
    expect(first.manifest.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('通过既有 seed validator 且集合数量与引用链完整', () => {
    const seed = createAuthoritativeM1SeedPackage();
    const validation = validateSeedPackage(seed);

    expect(validation).toMatchObject({ ok: true, issues: [] });
    expect(validation.counts).toEqual({
      organizations: 1,
      classes: 2,
      users: 71,
      auth_identities: 71,
      role_assignments: 71,
      class_memberships: 68,
      teacher_class_grants: 2,
      parent_student_links: 1,
      learning_resources: 2,
      tasks: 1,
      task_assignments: 36,
      submissions: 27,
      review_feedback: 21,
    });
  });

  it('为虚构管理员提供 A-01 至 A-04 和绑定码所需的最小后台权限', () => {
    const seed = createAuthoritativeM1SeedPackage();
    const adminRole = seed.collections.role_assignments.find((role) => role.userId === 'usr_admin_demo_01');

    expect(adminRole?.permissions).toEqual([
      'organization.read', 'organization.manage', 'class.read', 'class.manage',
      'user.read', 'user.manage', 'authorization.manage', 'audit.read',
      'student.bind-code.issue',
    ]);
  });

  it('为主组织测试教师提供内容读取与任务发布的同一班级授权', () => {
    const seed = createAuthoritativeM1SeedPackage();
    expect(seed.collections.teacher_class_grants.every((grant) => (grant.permissions as readonly string[]).includes('content.read'))).toBe(true);
  });

  it('从底层记录重算权威学校、班级和课堂任务统计', () => {
    const seed = createAuthoritativeM1SeedPackage();
    const task = seed.collections.tasks[0]!;
    const assignments = seed.collections.task_assignments;

    expect(summarizeAuthoritativeM1Seed(seed)).toEqual({
      schoolName: '启航实验学校',
      classes: {
        gradeThreeClass: { name: '三年级 2 班', studentCount: 36 },
        gradeFourClass: { name: '四年级 1 班', studentCount: 32 },
      },
      classroomTask: {
        title: '动物主题听说练习',
        assigned: 36,
        submitted: 27,
        unsubmitted: 9,
        awaitingReview: 6,
        reviewed: 21,
      },
      totalDocuments: 374,
    });
    expect(new Set(task.targetStudentIds as readonly string[])).toEqual(
      new Set(assignments.map((assignment) => String(assignment.studentId))),
    );
    expect(assignments.filter((assignment) => assignment.status === 'completed')).toHaveLength(21);
    expect(assignments.filter((assignment) => assignment.status === 'awaiting_review')).toHaveLength(6);
    expect(assignments.filter((assignment) => assignment.status === 'not_started')).toHaveLength(9);
  });

  it('只包含明确虚构账号占位，不包含联系方式或凭据字段', () => {
    const seed = createAuthoritativeM1SeedPackage();
    const serialized = canonicalJson(seed);

    expect(seed.collections.users.every((user) => String(user.displayName).startsWith('测试') || String(user.displayName).includes('测试学生'))).toBe(true);
    expect(serialized).not.toMatch(/\b1[3-9]\d{9}\b/);
    expect(serialized).not.toContain('password');
    expect(serialized).not.toContain('mobile');
    expect(serialized).not.toContain('email');
    expect(serialized).not.toContain('token');
  });

  it('复用本地 apply/verify/rollback 核心完成全量原子合约', async () => {
    const seed = createAuthoritativeM1SeedPackage();
    const repository = new MemorySeedRepository();

    await expect(applySeedPackage(repository, seed, OPTIONS)).resolves.toMatchObject({
      status: 'applied',
      createdCount: 374,
      skippedCount: 0,
    });
    await expect(verifySeedPackage(repository, seed)).resolves.toMatchObject({
      ok: true,
      expectedCount: 374,
      matchedCount: 374,
    });
    await expect(rollbackSeedRun(repository, seed.manifest.seedRunId, OPTIONS)).resolves.toMatchObject({
      status: 'rolled_back',
      deletedCount: 374,
    });
  });
});
