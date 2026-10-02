import { describe, expect, it } from 'vitest';
import type { VersionedDocument } from '../../src/repositories/document-database-port';
import { createM2DevelopmentFixture, M2_FIXTURE_IDS } from '../../src/seed/m2-development-fixture';
import { createM2OfflineDatabase, createM2OfflineOperator, createM2OfflinePlan,
  type M2OfflineCommand, type M2OfflineRequest } from '../../src/seed/m2-offline-operator';

const fixture = createM2DevelopmentFixture();
const seedRunId = fixture.manifest.seedRunId;
const request = (command: M2OfflineCommand, batchSize = 2): M2OfflineRequest => ({
  command, guard: { environmentPurpose: 'm2-offline-only', dataClassification: 'synthetic-only' },
  expectedSeedRunId: seedRunId, requestId: 'request_m2_offline_01',
  executedBy: 'offline_seed_rehearsal', batchSize,
});

async function completeImport(operator: ReturnType<typeof createM2OfflineOperator>, batchSize = 2): Promise<void> {
  let result = await operator.execute(request('plan', batchSize));
  for (let step = 0; result.status !== 'succeeded' && step < 20; step += 1) {
    result = await operator.execute(request('advance', batchSize));
  }
  expect(result.status).toBe('succeeded');
}
async function completeRollback(operator: ReturnType<typeof createM2OfflineOperator>, batchSize = 2): Promise<void> {
  let result = await operator.execute(request('begin_rollback', batchSize));
  for (let step = 0; result.status !== 'rolled_back' && step < 20; step += 1) {
    result = await operator.execute(request('advance_rollback', batchSize));
  }
  expect(result.status).toBe('rolled_back');
}

describe('M2 controlled offline additive seed', () => {
  it('shows a reviewable hash, ordered IDs and a separate cloud authorization gate', () => {
    const plan = createM2OfflinePlan();
    expect(plan).toMatchObject({ seedRunId, requiredBaseSeedRunId: 'seed_m1_cloud_integration_v4',
      totalDocuments: 5, authorizationRequiredForCloud: true,
      collectionOrder: ['learning_resources', 'phonics_courses', 'task_templates', 'checkin_activities'] });
    expect(plan.requiredBaseContentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(plan.documents.map(item => item.id)).toEqual([
      M2_FIXTURE_IDS.exercise, M2_FIXTURE_IDS.textbook, M2_FIXTURE_IDS.phonics,
      M2_FIXTURE_IDS.template, M2_FIXTURE_IDS.activity,
    ]);
    expect(plan.documents.every(item => /^sha256:[a-f0-9]{64}$/.test(item.contentHash))).toBe(true);
    expect(JSON.stringify(plan)).not.toContain('correctAnswer');
  });

  it('imports one batch per step, verifies all owned rows, and rolls back only its five rows', async () => {
    const database = createM2OfflineDatabase();
    const before = database.snapshot();
    const operator = createM2OfflineOperator(database);
    expect(await operator.execute(request('status'))).toMatchObject({ status: 'not_planned', createdCount: 0 });
    const planned = await operator.execute(request('plan'));
    expect(planned).toMatchObject({ status: 'planned', totalBatches: 3, createdCount: 0 });
    expect(await operator.execute(request('plan'))).toEqual(planned);
    expect(await operator.execute(request('advance'))).toMatchObject({ status: 'applying', createdCount: 0 });
    expect(await operator.execute(request('advance'))).toMatchObject({ status: 'applying', createdCount: 2 });
    expect(database.snapshot().learning_resources).toHaveLength((before.learning_resources?.length ?? 0) + 2);
    let current = await operator.execute(request('advance'));
    for (let step = 0; current.status !== 'succeeded' && step < 20; step += 1) {
      current = await operator.execute(request('advance'));
    }
    expect(current).toMatchObject({ status: 'succeeded', createdCount: 5, verifiedBatchCount: 3 });
    expect(await operator.execute(request('advance'))).toEqual(current);
    expect(database.snapshot().migration_runs).toHaveLength(2);
    expect(database.snapshot().learning_resources?.filter(row => row.seedRunId === seedRunId)).toHaveLength(2);
    expect(database.snapshot().learning_resources?.filter(row => row.seedRunId !== seedRunId))
      .toEqual(before.learning_resources);
    await completeRollback(operator);
    const after = database.snapshot();
    expect(after.learning_resources).toEqual(before.learning_resources);
    expect(after.phonics_courses ?? []).toHaveLength(0);
    expect(after.task_templates ?? []).toHaveLength(0);
    expect(after.checkin_activities ?? []).toHaveLength(0);
    expect(after.organizations).toEqual(before.organizations);
    expect(after.classes).toEqual(before.classes);
    expect(after.users).toEqual(before.users);
    expect(after.migration_runs?.find(row => row._id === seedRunId)).toMatchObject({ status: 'rolled_back' });
    await expect(operator.execute(request('plan'))).resolves.toMatchObject({ status: 'rolled_back' });
    await expect(operator.execute(request('advance'))).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects a pre-existing ID even when its content is identical, without touching M1 resources', async () => {
    const database = createM2OfflineDatabase();
    const before = database.snapshot().learning_resources;
    const identical = fixture.collections.learning_resources[0] as unknown as VersionedDocument;
    await database.runTransaction(async tx => { expect(await tx.create('learning_resources', identical)).toBe(true); });
    const operator = createM2OfflineOperator(database);
    await expect(operator.execute(request('plan'))).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(database.snapshot().migration_runs).toHaveLength(1);
    expect(database.snapshot().learning_resources?.filter(row => row.seedRunId !== seedRunId)).toEqual(before);
    expect(database.snapshot().phonics_courses ?? []).toHaveLength(0);
  });

  it('rejects an unverified or changed M1 base run before creating the M2 run', async () => {
    const database = createM2OfflineDatabase();
    const baseRunId = 'seed_m1_cloud_integration_v4';
    const baseRun = await database.get('migration_runs', baseRunId);
    expect(baseRun).toBeDefined();
    await database.runTransaction(async tx => {
      expect(await tx.replace('migration_runs', baseRunId, 1,
        { ...baseRun!, version: 2, contentHash: `sha256:${'0'.repeat(64)}` })).toBe(true);
    });
    await expect(createM2OfflineOperator(database).execute(request('plan')))
      .rejects.toMatchObject({ code: 'CONFLICT' });
    expect(database.snapshot().migration_runs).toHaveLength(1);
    expect(database.snapshot().learning_resources?.filter(row => row.seedRunId === seedRunId)).toHaveLength(0);
  });

  it('leaves a conflicted later batch intact, then explicitly resumes from the committed cursor', async () => {
    const database = createM2OfflineDatabase();
    const operator = createM2OfflineOperator(database);
    await operator.execute(request('plan'));
    await operator.execute(request('advance'));
    await operator.execute(request('advance'));
    const collision = fixture.collections.phonics_courses[0] as unknown as VersionedDocument;
    await database.runTransaction(async tx => { expect(await tx.create('phonics_courses', collision)).toBe(true); });
    await expect(operator.execute(request('advance'))).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await operator.execute(request('status'))).toMatchObject({ status: 'failed', nextBatchIndex: 1, createdCount: 2 });
    expect(database.snapshot().task_templates ?? []).toHaveLength(0);
    await database.runTransaction(async tx => {
      expect(await tx.delete('phonics_courses', M2_FIXTURE_IDS.phonics, 1)).toBe(true);
    });
    expect(await operator.execute(request('resume'))).toMatchObject({ status: 'applying', nextBatchIndex: 1 });
    let current = await operator.execute(request('advance'));
    for (let step = 0; current.status !== 'succeeded' && step < 20; step += 1) {
      current = await operator.execute(request('advance'));
    }
    expect(current).toMatchObject({ status: 'succeeded', createdCount: 5 });
    await completeRollback(operator);
  });

  it('does not commit a batch when the fake database transaction fails at commit', async () => {
    const database = createM2OfflineDatabase();
    const operator = createM2OfflineOperator(database);
    await operator.execute(request('plan'));
    await operator.execute(request('advance'));
    database.failNext({ operation: 'commit', kind: 'unavailable' });
    await expect(operator.execute(request('advance'))).rejects.toThrow();
    expect(database.snapshot().learning_resources?.filter(row => row.seedRunId === seedRunId)).toHaveLength(0);
    expect(await operator.execute(request('status'))).toMatchObject({ status: 'failed', nextBatchIndex: 0,
      createdCount: 0 });
    await operator.execute(request('resume'));
    let current = await operator.execute(request('advance'));
    for (let step = 0; current.status !== 'succeeded' && step < 20; step += 1) {
      current = await operator.execute(request('advance'));
    }
    expect(current.status).toBe('succeeded');
  });

  it('requires all five exact documents and no extra owned row before success', async () => {
    const database = createM2OfflineDatabase();
    const operator = createM2OfflineOperator(database);
    await operator.execute(request('plan'));
    for (let step = 0; step < 5; step += 1) await operator.execute(request('advance'));
    expect(await operator.execute(request('status'))).toMatchObject({ status: 'verifying', verifiedBatchCount: 0 });
    const extra: VersionedDocument = { _id: 'notice_m2_unrecorded_extra_demo', organizationId: M2_FIXTURE_IDS.organization,
      schemaVersion: 1, version: 1, deletedAt: null, seedRunId, kind: 'task_due' };
    await database.runTransaction(async tx => { expect(await tx.create('notification_events', extra)).toBe(true); });
    for (let step = 0; step < 3; step += 1) await operator.execute(request('advance'));
    await expect(operator.execute(request('advance'))).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await operator.execute(request('status'))).toMatchObject({ status: 'failed', verifiedBatchCount: 3 });
  });

  it('stops rollback before any deletion when a created row changes, then resumes after repair', async () => {
    const database = createM2OfflineDatabase();
    const operator = createM2OfflineOperator(database);
    await completeImport(operator);
    const before = database.snapshot();
    const original = before.learning_resources?.find(row => row._id === M2_FIXTURE_IDS.exercise);
    expect(original).toBeDefined();
    await database.runTransaction(async tx => {
      expect(await tx.replace('learning_resources', M2_FIXTURE_IDS.exercise, 1,
        { ...original!, version: 2, title: '外部改动' })).toBe(true);
    });
    await operator.execute(request('begin_rollback'));
    await expect(operator.execute(request('advance_rollback'))).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await operator.execute(request('status'))).toMatchObject({ status: 'failed', rollbackCursor: 5 });
    expect(database.snapshot().checkin_activities).toHaveLength(1);
    await database.runTransaction(async tx => {
      expect(await tx.delete('learning_resources', M2_FIXTURE_IDS.exercise, 2)).toBe(true);
      expect(await tx.create('learning_resources', original!)).toBe(true);
    });
    expect(await operator.execute(request('resume'))).toMatchObject({ status: 'rolling_back', rollbackCursor: 5 });
    let current = await operator.execute(request('advance_rollback'));
    for (let step = 0; current.status !== 'rolled_back' && step < 20; step += 1) {
      current = await operator.execute(request('advance_rollback'));
    }
    expect(current.status).toBe('rolled_back');
  });

  it('rejects cloud-shaped requests, changed run parameters and non-fake adapters', async () => {
    const database = createM2OfflineDatabase();
    const operator = createM2OfflineOperator(database);
    await expect(operator.execute({ ...request('plan'), guard: { environmentPurpose: 'm2-non-production',
      dataClassification: 'synthetic-only' } })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(operator.execute({ ...request('plan'), envId: 'unapproved' }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await operator.execute(request('plan'));
    await expect(operator.execute({ ...request('advance'), batchSize: 3 }))
      .rejects.toMatchObject({ code: 'CONFLICT' });
    expect(() => createM2OfflineOperator({} as typeof database)).toThrow();
  });
});
