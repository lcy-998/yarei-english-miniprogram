import { describe, expect, it } from 'vitest';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import { hasActiveLegacyGlobalSource } from '../../src/global-assets/legacy-global-source';

const fingerprint = 'a'.repeat(64);
const source = { _id: 'legacy_source', organizationId: 'org_one', schemaVersion: 1,
  version: 2, deletedAt: null, type: 'reading', status: 'published', contentVersion: 1,
  globalCatalogSource: true, globalCatalogFingerprint: fingerprint };
const projection = { _id: 'legacy_projection', organizationId: 'org_two', schemaVersion: 1,
  version: 1, deletedAt: null, type: 'reading', status: 'published', contentVersion: 1,
  globalCatalogProjection: true, globalSourceId: 'legacy_source',
  globalSourceVersion: 2, globalSourceFingerprint: fingerprint };

describe('legacy global teaching source', () => {
  it('allows only a current cross-organization projection', async () => {
    const db = new FakeDocumentDatabase({ learning_resources: [source, projection] });
    expect(await hasActiveLegacyGlobalSource(db, projection)).toBe(true);
    expect(await hasActiveLegacyGlobalSource(db, source)).toBe(true);
    expect(await hasActiveLegacyGlobalSource(db, { ...projection,
      globalSourceVersion: 1 })).toBe(false);
    expect(await hasActiveLegacyGlobalSource(db, { ...projection,
      globalSourceFingerprint: 'b'.repeat(64) })).toBe(false);
    expect(await hasActiveLegacyGlobalSource(db, { ...projection,
      globalSourceId: projection._id })).toBe(false);
  });

  it('blocks new references immediately after source takedown', async () => {
    const db = new FakeDocumentDatabase({ learning_resources: [source, projection] });
    await db.runTransaction(async tx => {
      await tx.replace('learning_resources', source._id, source.version,
        { ...source, version: source.version + 1, status: 'offline' });
    });
    expect(await hasActiveLegacyGlobalSource(db, projection)).toBe(false);
  });
});
