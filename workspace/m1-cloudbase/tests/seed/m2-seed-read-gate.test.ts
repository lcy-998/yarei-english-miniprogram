import { describe, expect, it } from 'vitest';
import type { VersionedDocument } from '../../src/repositories/document-database-port';
import { M2_FIXTURE_IDS, createM2DevelopmentFixture } from '../../src/seed/m2-development-fixture';
import { createM2OfflineDatabase, createM2OfflineOperator,
  type M2OfflineCommand, type M2OfflineRequest } from '../../src/seed/m2-offline-operator';
import { filterVisibleM2SeedRows } from '../../src/seed/m2-seed-read-gate';

const fixture = createM2DevelopmentFixture();
const request = (command: M2OfflineCommand): M2OfflineRequest => ({ command,
  guard: { environmentPurpose: 'm2-offline-only', dataClassification: 'synthetic-only' },
  expectedSeedRunId: fixture.manifest.seedRunId, requestId: 'request_m2_read_gate_01',
  executedBy: 'offline_read_gate', batchSize: 2 });

describe('M2 pending-run read isolation contract', () => {
  it('preserves M1 resources but hides all M2 rows until the full run succeeds', async () => {
    const database = createM2OfflineDatabase();
    const operator = createM2OfflineOperator(database);
    const m1Count = (await database.find('learning_resources', {})).length;
    await operator.execute(request('plan'));
    await operator.execute(request('advance'));
    await operator.execute(request('advance'));
    let rows = await database.find('learning_resources', {});
    expect(rows).toHaveLength(m1Count + 2);
    expect(await filterVisibleM2SeedRows(database, 'learning_resources', rows, operator.plan))
      .toHaveLength(m1Count);
    await operator.execute(request('advance'));
    let state = await operator.execute(request('advance'));
    const collections = ['learning_resources', 'phonics_courses', 'task_templates', 'checkin_activities'] as const;
    for (const collection of collections) {
      const raw = await database.find(collection, {});
      const allowed = await filterVisibleM2SeedRows(database, collection, raw, operator.plan);
      expect(allowed.every(row => row.seedRunId !== fixture.manifest.seedRunId)).toBe(true);
    }
    for (let step = 0; state.status !== 'succeeded' && step < 20; step += 1) {
      state = await operator.execute(request('advance'));
    }
    expect(state.status).toBe('succeeded');
    for (const collection of collections) {
      const raw = await database.find(collection, {});
      const allowed = await filterVisibleM2SeedRows(database, collection, raw, operator.plan);
      expect(allowed.filter(row => row.seedRunId === fixture.manifest.seedRunId)).toHaveLength(
        fixture.collections[collection].length);
    }
    rows = await database.find('learning_resources', {});
    expect(await filterVisibleM2SeedRows(database, 'learning_resources', rows, operator.plan))
      .toHaveLength(m1Count + 2);
    await operator.execute(request('begin_rollback'));
    expect(await filterVisibleM2SeedRows(database, 'learning_resources', rows, operator.plan))
      .toHaveLength(m1Count);
  });

  it('hides a candidate whose run label or content hash is lost even if the run says succeeded', async () => {
    const database = createM2OfflineDatabase();
    const operator = createM2OfflineOperator(database);
    await operator.execute(request('plan'));
    let state = await operator.execute(request('advance'));
    for (let step = 0; state.status !== 'succeeded' && step < 20; step += 1) {
      state = await operator.execute(request('advance'));
    }
    const rows = await database.find('learning_resources', {});
    const m1Count = rows.filter(row => row.seedRunId !== fixture.manifest.seedRunId).length;
    const changed: VersionedDocument[] = rows.map(row => row._id === M2_FIXTURE_IDS.exercise
      ? { ...row, seedRunId: 'another_run' } : row);
    expect(await filterVisibleM2SeedRows(database, 'learning_resources', changed, operator.plan))
      .toHaveLength(m1Count + 1);
    const hashChanged: VersionedDocument[] = rows.map(row => row._id === M2_FIXTURE_IDS.exercise
      ? { ...row, title: '外部修改' } : row);
    expect(await filterVisibleM2SeedRows(database, 'learning_resources', hashChanged, operator.plan))
      .toHaveLength(m1Count + 1);
  });
});
