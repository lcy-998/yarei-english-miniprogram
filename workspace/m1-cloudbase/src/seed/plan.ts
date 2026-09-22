import { SEED_COLLECTION_ORDER, type SeedCollectionName, type SeedPackage, type SeedValidationResult } from './model';

export interface SeedPlanStep {
  readonly order: number;
  readonly collections: readonly SeedCollectionName[];
  readonly documentCount: number;
  readonly purpose: string;
}

export interface SeedPlanSummary {
  readonly seedVersion: string;
  readonly seedRunId: string;
  readonly schemaVersion: number;
  readonly contentHash: string;
  readonly totalDocuments: number;
  readonly collectionCounts: Readonly<Record<SeedCollectionName, number>>;
  readonly runtimeIdentityPlaceholders: number;
  readonly steps: readonly SeedPlanStep[];
  readonly safety: readonly string[];
}

const GROUPS: ReadonlyArray<Readonly<{ collections: readonly SeedCollectionName[]; purpose: string }>> = [
  { collections: ['organizations'], purpose: '组织边界' },
  { collections: ['classes', 'users'], purpose: '班级与虚构业务用户' },
  { collections: ['auth_identities', 'role_assignments'], purpose: '身份占位与角色授权' },
  { collections: ['class_memberships', 'teacher_class_grants', 'parent_student_links'], purpose: '同组织关系' },
  { collections: ['learning_resources'], purpose: '虚构学习内容' },
  { collections: ['tasks'], purpose: '任务与内容快照' },
  { collections: ['task_assignments'], purpose: '发布对象快照' },
  { collections: ['submissions'], purpose: '提交版本' },
  { collections: ['review_feedback'], purpose: '人工点评' },
];

export function createSeedPlan(seed: SeedPackage, validation: SeedValidationResult): SeedPlanSummary {
  if (!validation.ok) throw new Error('种子校验未通过，不能生成执行计划。');
  const collectionCounts = Object.fromEntries(SEED_COLLECTION_ORDER.map((name) => [name, seed.collections[name].length])) as Record<SeedCollectionName, number>;
  return {
    seedVersion: seed.manifest.seedVersion,
    seedRunId: seed.manifest.seedRunId,
    schemaVersion: seed.manifest.schemaVersion,
    contentHash: validation.computedContentHash,
    totalDocuments: Object.values(collectionCounts).reduce((sum, count) => sum + count, 0),
    collectionCounts,
    runtimeIdentityPlaceholders: seed.collections.auth_identities.length,
    steps: GROUPS.map((group, index) => ({
      order: index + 1,
      collections: group.collections,
      documentCount: group.collections.reduce((sum, name) => sum + collectionCounts[name], 0),
      purpose: group.purpose,
    })),
    safety: [
      '仅生成本地只读计划，不连接 CloudBase。',
      '不读取 .env.local、环境 ID、账号、密钥或真实个人信息。',
      '身份摘要仍是 fixture 占位，未来导入前须由授权服务端替换。',
      '本工具不提供 apply、import、rollback 或集合清理能力。',
    ],
  };
}

