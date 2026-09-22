import { describe, expect, it } from 'vitest';
import { createCloudBaseControlledSeedOperator } from '../../src/seed/cloudbase-controlled-operator';
import {
  materializeCloudRuntimeSeedPackages,
  type CloudBaseAccountMetadata,
} from '../../src/seed/cloudbase-account-materializer';
import { NativeDatabaseDouble } from '../support/native-database-double';

const NOW = '2026-09-18T10:00:00+08:00';
const TEST_SUBJECT_PEPPER = 'xLZ7Jfj7ZK7LnJboPz9Dxmx_eZoFluu0GP41XIlNexg';

describe('CloudBase 受控种子操作器装配', () => {
  it('仅接受运行态身份包，并通过同一事务桥单步创建首批虚构数据', async () => {
    const materialized = materializeCloudRuntimeSeedPackages(createAccounts(), TEST_SUBJECT_PEPPER);
    expect(materialized.ok).toBe(true);
    if (!materialized.ok) return;

    const nativeDatabase = new NativeDatabaseDouble();
    const operator = createCloudBaseControlledSeedOperator(nativeDatabase, {
      primary: materialized.primarySeed,
      secondary: materialized.secondarySeed,
    }, () => NOW);
    const seed = materialized.primarySeed;

    await expect(operator.execute('primary', request(seed.manifest.seedRunId, 'status'))).resolves.toMatchObject({
      state: { status: 'not_planned', createdCount: 0, totalBatches: 13 },
    });
    await expect(operator.execute('primary', request(seed.manifest.seedRunId, 'plan'))).resolves.toMatchObject({
      state: { status: 'planned', createdCount: 0, totalBatches: 13 },
    });
    await expect(operator.execute('primary', request(seed.manifest.seedRunId, 'advance'))).resolves.toMatchObject({
      state: { status: 'applying', nextBatchIndex: 0, createdCount: 0 },
    });
    await expect(operator.execute('primary', request(seed.manifest.seedRunId, 'advance'))).resolves.toMatchObject({
      state: { status: 'applying', nextBatchIndex: 1, createdCount: 25 },
    });

    expect(countDocuments(nativeDatabase)).toBe(25);
    expect(nativeDatabase.snapshot('migration_runs')).toMatchObject([
      { _id: seed.manifest.seedRunId, status: 'applying', nextBatchIndex: 1 },
    ]);
  });
});

function createAccounts(): readonly CloudBaseAccountMetadata[] {
  return [
    ['demo_student_01', 'externalUser'],
    ['demo_parent_01', 'externalUser'],
    ['demo_teacher_01', 'externalUser'],
    ['demo_admin_01', 'internalUser'],
    ['isolation_student_01', 'externalUser'],
    ['isolation_parent_01', 'externalUser'],
    ['isolation_teacher_01', 'externalUser'],
    ['isolation_admin_01', 'internalUser'],
  ].map(([name, type], index) => ({
    name,
    type: type as CloudBaseAccountMetadata['type'],
    status: 'ACTIVE' as const,
    uid: `synthetic-cloudbase-uid-${index + 1}`,
  }));
}

function request(
  expectedSeedRunId: string,
  command: 'status' | 'plan' | 'advance',
): Readonly<Record<string, unknown>> {
  return {
    command,
    guard: {
      environmentPurpose: 'm1-non-production',
      dataClassification: 'synthetic-only',
      identityProfile: 'runtime',
    },
    expectedSeedRunId,
    requestId: 'request_cloudbase_seed_contract',
    executedBy: 'sys_cloudbase_seed_contract',
    batchSize: 25,
  };
}

function countDocuments(database: NativeDatabaseDouble): number {
  return [
    'organizations', 'classes', 'users', 'auth_identities', 'role_assignments',
    'class_memberships', 'teacher_class_grants', 'parent_student_links', 'binding_codes',
    'learning_resources', 'reading_progress', 'vocabulary_progress', 'tasks',
    'task_assignments', 'submissions', 'review_feedback', 'idempotency_records', 'operation_logs',
  ].reduce((count, collection) => count + database.snapshot(collection).length, 0);
}
