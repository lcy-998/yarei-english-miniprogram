import { describe, expect, it, vi } from 'vitest';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import type { VersionedDocument } from '../../src/repositories/document-database-port';
import { M2_FIXTURE_IDS } from '../../src/seed/m2-development-fixture';
import { createM2BusinessReadIsolation } from '../../src/seed/m2-business-read-isolation';

const HASH = `sha256:${'a'.repeat(64)}`;
const seeded: VersionedDocument = { _id: M2_FIXTURE_IDS.exercise, organizationId: M2_FIXTURE_IDS.organization,
  schemaVersion: 1, version: 1, deletedAt: null, status: 'published',
  seedRunId: 'seed_m2_local_addon_v1', seedVersion: 'm2-local-addon-v1', seedDocumentContentHash: HASH };
const independent: VersionedDocument = { _id: 'res_zz_independent', organizationId: M2_FIXTURE_IDS.organization,
  schemaVersion: 1, version: 1, deletedAt: null, status: 'published' };
const refs = [
  ['learning_resources', M2_FIXTURE_IDS.exercise],
  ['learning_resources', M2_FIXTURE_IDS.textbook],
  ['phonics_courses', M2_FIXTURE_IDS.phonics],
  ['task_templates', M2_FIXTURE_IDS.template],
  ['checkin_activities', M2_FIXTURE_IDS.activity],
].map(([collection, id]) => ({ collection, id, contentHash: HASH }));
const run: VersionedDocument = { _id: 'seed_m2_local_addon_v1', organizationId: M2_FIXTURE_IDS.organization,
  schemaVersion: 1, version: 1, deletedAt: null, source: 'synthetic-m2-addon', status: 'planned',
  baseSeedRunId: 'seed_m1_cloud_integration_v4', contentHash: HASH, dependencyDigest: HASH,
  created: refs };

describe('M2 CloudBase business read isolation', () => {
  it('hides incomplete seed records from detail, list, page and transaction reads without hiding independent records', async () => {
    const raw = new FakeDocumentDatabase({ learning_resources: [seeded, independent], migration_runs: [run] });
    const business = createM2BusinessReadIsolation(raw);
    expect(await raw.get('learning_resources', seeded._id)).not.toBeNull();
    expect(await business.get('learning_resources', seeded._id)).toBeNull();
    expect((await business.find('learning_resources', {})).map(row => row._id)).toEqual([independent._id]);
    expect((await business.findPage('learning_resources', {}, { limit: 1, offset: 0 }))).toEqual({
      items: [independent], hasMore: false,
    });
    expect(await business.runTransaction(async tx => ({
      detail: await tx.get('learning_resources', seeded._id),
      ids: (await tx.find('learning_resources', {})).map(row => row._id),
    }))).toEqual({ detail: null, ids: [independent._id] });
    expect(await business.get('users', 'missing')).toBeNull();
  });

  it('shows the same seed only after the exact run succeeds, then hides it again during rollback', async () => {
    const raw = new FakeDocumentDatabase({ learning_resources: [seeded], migration_runs: [run] });
    const business = createM2BusinessReadIsolation(raw);
    await raw.runTransaction(async tx => tx.replace('migration_runs', run._id, 1,
      { ...run, status: 'succeeded', version: 2 }));
    expect(await business.get('learning_resources', seeded._id)).toEqual(seeded);
    expect((await business.findPage('learning_resources', {}, { limit: 1, offset: 0 })).items)
      .toEqual([seeded]);
    await raw.runTransaction(async tx => tx.replace('migration_runs', run._id, 2,
      { ...run, status: 'rolling_back', version: 3 }));
    expect(await business.get('learning_resources', seeded._id)).toBeNull();
  });

  it('keeps a normally updated candidate visible after success and hides it during rollback', async () => {
    const raw = new FakeDocumentDatabase({ learning_resources: [{ ...seeded, seedRunId: null }],
      migration_runs: [{ ...run, status: 'succeeded' }] });
    const business = createM2BusinessReadIsolation(raw);
    expect(await business.get('learning_resources', seeded._id)).toEqual({ ...seeded, seedRunId: null });
    expect(await business.findPage('learning_resources', {}, { limit: 1, offset: 0 }))
      .toEqual({ items: [{ ...seeded, seedRunId: null }], hasMore: false });
    await raw.runTransaction(async tx => tx.replace('migration_runs', run._id, 1,
      { ...run, status: 'rolling_back', version: 2 }));
    expect(await business.get('learning_resources', seeded._id)).toBeNull();
  });

  it('keeps the normal paged query when no incomplete seed candidate exists', async () => {
    const raw = new FakeDocumentDatabase({ learning_resources: [independent] });
    const fullScan = vi.spyOn(raw, 'find');
    const business = createM2BusinessReadIsolation(raw);
    expect(await business.findPage('learning_resources', {}, { limit: 1, offset: 0 }))
      .toEqual({ items: [independent], hasMore: false });
    expect(fullScan).not.toHaveBeenCalled();
  });
});
