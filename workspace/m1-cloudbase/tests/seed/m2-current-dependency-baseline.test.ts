import { describe, expect, it } from 'vitest';
import type { VersionedDocument } from '../../src/repositories/document-database-port';
import { computeJsonContentHash } from '../../src/seed/canonical-json';
import { M2_CURRENT_DEPENDENCIES, assertReviewedM2CurrentBaseline,
  proposeM2CurrentDependencyBaseline, verifyM2CurrentDependencyBaseline } from '../../src/seed/m2-current-dependency-baseline';
import { createM2DevelopmentFixture, M2_FIXTURE_IDS } from '../../src/seed/m2-development-fixture';
import { createM2AuditedCloudOperator, createM2OfflineDatabase, createM2OfflineOperator,
  type M2OfflineCommand, type M2OfflineRequest } from '../../src/seed/m2-offline-operator';
import { SEED_COLLECTION_ORDER } from '../../src/seed/model';
import { createPrimaryCloudIntegrationSeedPackage } from '../../src/seed/primary-cloud-integration-fixture';

const base = createPrimaryCloudIntegrationSeedPackage();
const fixture = createM2DevelopmentFixture();
const request = (command: M2OfflineCommand): M2OfflineRequest => ({ command,
  guard: { environmentPurpose: 'm2-offline-only', dataClassification: 'synthetic-only' },
  expectedSeedRunId: fixture.manifest.seedRunId, requestId: 'request_m2_audited_01',
  executedBy: 'offline_auditor', batchSize: 2 });

async function interruptedM1() {
  const database = createM2OfflineDatabase(base);
  const localReferences = SEED_COLLECTION_ORDER.flatMap(collection => base.collections[collection].map(document => ({
    collection, id: String(document._id), contentHash: computeJsonContentHash(document),
  })));
  // The current generator has one more historical feedback row than the observed
  // cloud run. Omit one unrelated feedback only to reproduce the 306/231/227
  // topology; this does not claim which cloud document was absent.
  const omitted = localReferences[localReferences.length - 1]!;
  const references = localReferences.slice(0, -1);
  expect(references).toHaveLength(306);
  await database.runTransaction(async tx => {
    expect(await tx.delete(omitted.collection, omitted.id, 1)).toBe(true);
    for (const reference of references.slice(231)) {
      const current = await tx.get(reference.collection, reference.id);
      if (!current || !await tx.delete(reference.collection, reference.id, current.version)) {
        throw new Error(`Offline topology fixture could not delete ${reference.collection}/${reference.id}`);
      }
    }
    const changed = [
      { collection: 'users', id: M2_FIXTURE_IDS.student, version: 11, status: 'active' },
      { collection: 'users', id: M2_FIXTURE_IDS.teacher, version: 7, status: 'active' },
      { collection: 'teacher_class_grants', id: 'grt_teacher_demo_01_grade3_2', version: 5, status: 'active' },
      { collection: 'parent_student_links', id: 'rel_parent_demo_01_student_g3_01', version: 2, status: 'revoked' },
    ] as const;
    for (const item of changed) {
      const previous = await tx.get(item.collection, item.id);
      expect(previous).toBeDefined();
      const { seedRunId: _removed, ...withoutOldRun } = previous!;
      expect(await tx.replace(item.collection, item.id, 1,
        { ...withoutOldRun, version: item.version, status: item.status } as VersionedDocument)).toBe(true);
    }
    const teacherRole = await tx.get('role_assignments', 'rol_teacher_demo_01');
    expect(await tx.replace('role_assignments', 'rol_teacher_demo_01', 1,
      { ...teacherRole!, version: 2 })).toBe(true);
    const run = await tx.get('migration_runs', base.manifest.seedRunId);
    expect(run).toBeDefined();
    expect(await tx.replace('migration_runs', base.manifest.seedRunId, 1, { ...run!, version: 35,
      status: 'failed', failedFromStatus: 'rolling_back', rollbackCursor: 231,
      createdDocumentIds: references })).toBe(true);
  });
  const remaining = Object.values(database.snapshot()).flat()
    .filter(row => row.seedRunId === base.manifest.seedRunId);
  expect(remaining).toHaveLength(227);
  return database;
}

describe('M2 exact current-dependency baseline for interrupted M1 rollback', () => {
  it('keeps the cloud request guard separate from the offline operator', async () => {
    const database = await interruptedM1();
    const baseline = await proposeM2CurrentDependencyBaseline(database);
    const cloud = createM2AuditedCloudOperator(database, { baseline, reviewedDigest: baseline.digest });
    const cloudRequest = { ...request('plan'), guard: {
      environmentPurpose: 'm2-non-production', dataClassification: 'synthetic-only' } };
    expect(await cloud.execute(cloudRequest)).toMatchObject({ status: 'planned', createdCount: 0 });
    await expect(createM2OfflineOperator(database, fixture, base,
      { baseline, reviewedDigest: baseline.digest }).execute(cloudRequest))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(() => createM2AuditedCloudOperator(database,
      { baseline, reviewedDigest: 'sha256:invalid' })).toThrow();
  });

  it('records seven exact active dependencies without changing the failed M1 run', async () => {
    const database = await interruptedM1();
    const baseline = await proposeM2CurrentDependencyBaseline(database);
    expect(baseline.baseRun).toMatchObject({ status: 'failed', failedFromStatus: 'rolling_back',
      rollbackCursor: 231, createdReferenceCount: 306, version: 35 });
    expect(baseline.dependencies).toHaveLength(M2_CURRENT_DEPENDENCIES.length);
    expect(baseline.dependencies.find(item => item.id === M2_FIXTURE_IDS.student)?.version).toBe(11);
    expect(baseline.dependencies.find(item => item.id === M2_FIXTURE_IDS.teacher)?.version).toBe(7);
    expect(baseline.dependencies.find(item => item.collection === 'role_assignments')?.version).toBe(2);
    expect(baseline.dependencies.find(item => item.collection === 'teacher_class_grants')?.version).toBe(5);
    expect(baseline.dependencies.every(item => /^sha256:[a-f0-9]{64}$/.test(item.contentHash))).toBe(true);
    assertReviewedM2CurrentBaseline(baseline, baseline.digest);
    await verifyM2CurrentDependencyBaseline(database, baseline, baseline.digest);
    await expect(createM2OfflineOperator(database, fixture, base).execute(request('plan')))
      .rejects.toMatchObject({ code: 'CONFLICT' });
    const operator = createM2OfflineOperator(database, fixture, base,
      { baseline, reviewedDigest: baseline.digest });
    expect(operator.plan.dependencyDigest).toBe(baseline.digest);
    expect(await operator.execute(request('plan'))).toMatchObject({ status: 'planned', createdCount: 0 });
    expect(await database.get('migration_runs', base.manifest.seedRunId))
      .toMatchObject({ status: 'failed', failedFromStatus: 'rolling_back', rollbackCursor: 231 });
    expect(database.snapshot().learning_resources?.filter(row => row.seedRunId === fixture.manifest.seedRunId))
      .toHaveLength(0);
    let state = await operator.execute(request('advance'));
    for (let step = 0; state.status !== 'succeeded' && step < 20; step += 1) {
      state = await operator.execute(request('advance'));
    }
    expect(state).toMatchObject({ status: 'succeeded', createdCount: 5, verifiedBatchCount: 3 });
    state = await operator.execute(request('begin_rollback'));
    for (let step = 0; state.status !== 'rolled_back' && step < 20; step += 1) {
      state = await operator.execute(request('advance_rollback'));
    }
    expect(state.status).toBe('rolled_back');
    expect(await database.get('migration_runs', base.manifest.seedRunId))
      .toMatchObject({ status: 'failed', failedFromStatus: 'rolling_back', rollbackCursor: 231 });
    expect(Object.values(database.snapshot()).flat().filter(row => row.seedRunId === base.manifest.seedRunId))
      .toHaveLength(227);
  });

  it('rejects missing, weak, revoked or cross-organization dependencies before any M2 run', async () => {
    const database = await interruptedM1();
    const baseline = await proposeM2CurrentDependencyBaseline(database);
    expect(() => assertReviewedM2CurrentBaseline(baseline, 'sha256:weak')).toThrow();
    const partial = { ...baseline, dependencies: baseline.dependencies.slice(0, -1) };
    expect(() => assertReviewedM2CurrentBaseline(partial, partial.digest)).toThrow();
    await database.runTransaction(async tx => {
      const classRow = await tx.get('classes', M2_FIXTURE_IDS.class);
      expect(await tx.replace('classes', M2_FIXTURE_IDS.class, 1,
        { ...classRow!, version: 2, organizationId: 'org_other_demo' })).toBe(true);
    });
    await expect(verifyM2CurrentDependencyBaseline(database, baseline, baseline.digest))
      .rejects.toMatchObject({ name: 'M2DependencyError' });
    await expect(proposeM2CurrentDependencyBaseline(database))
      .rejects.toMatchObject({ name: 'M2DependencyError' });
    const operator = createM2OfflineOperator(database, fixture, base,
      { baseline, reviewedDigest: baseline.digest });
    await expect(operator.execute(request('plan'))).rejects.toMatchObject({ name: 'M2DependencyError' });
    expect(database.snapshot().migration_runs).toHaveLength(1);
    const missing = await interruptedM1();
    await missing.runTransaction(async tx => {
      expect(await tx.delete('class_memberships', 'mem_grade3_2_g3_01', 1)).toBe(true);
    });
    await expect(proposeM2CurrentDependencyBaseline(missing))
      .rejects.toMatchObject({ name: 'M2DependencyError' });
    const revoked = await interruptedM1();
    await revoked.runTransaction(async tx => {
      const grant = await tx.get('teacher_class_grants', 'grt_teacher_demo_01_grade3_2');
      expect(await tx.replace('teacher_class_grants', 'grt_teacher_demo_01_grade3_2', 5,
        { ...grant!, version: 6, status: 'revoked' })).toBe(true);
    });
    await expect(proposeM2CurrentDependencyBaseline(revoked))
      .rejects.toMatchObject({ name: 'M2DependencyError' });
    const contentDrift = await interruptedM1();
    const approved = await proposeM2CurrentDependencyBaseline(contentDrift);
    await contentDrift.runTransaction(async tx => {
      const teacher = await tx.get('users', M2_FIXTURE_IDS.teacher);
      expect(await tx.replace('users', M2_FIXTURE_IDS.teacher, 7,
        { ...teacher!, displayName: '静默改动但版本未变' })).toBe(true);
    });
    await expect(verifyM2CurrentDependencyBaseline(contentDrift, approved, approved.digest))
      .rejects.toMatchObject({ name: 'M2DependencyError' });
  });

  it('stops an applying run if an approved dependency changes after planning', async () => {
    const database = await interruptedM1();
    const baseline = await proposeM2CurrentDependencyBaseline(database);
    const operator = createM2OfflineOperator(database, fixture, base,
      { baseline, reviewedDigest: baseline.digest });
    await operator.execute(request('plan'));
    await operator.execute(request('advance'));
    const teacher = await database.get('users', M2_FIXTURE_IDS.teacher);
    await database.runTransaction(async tx => {
      expect(await tx.replace('users', M2_FIXTURE_IDS.teacher, 7,
        { ...teacher!, version: 8, displayName: '又一次外部修改' })).toBe(true);
    });
    await expect(operator.execute(request('advance'))).rejects.toMatchObject({ name: 'M2DependencyError' });
    expect(await operator.execute(request('status'))).toMatchObject({ status: 'failed', createdCount: 0 });
    expect(database.snapshot().learning_resources?.filter(row => row.seedRunId === fixture.manifest.seedRunId))
      .toHaveLength(0);
    expect(await database.get('migration_runs', base.manifest.seedRunId))
      .toMatchObject({ status: 'failed', rollbackCursor: 231 });
    expect(await operator.execute(request('begin_rollback'))).toMatchObject({ status: 'rolling_back' });
    expect(await operator.execute(request('advance_rollback'))).toMatchObject({ status: 'rolled_back' });
  });
});
