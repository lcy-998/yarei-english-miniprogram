import { describe, expect, it } from 'vitest';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import { LegacyGlobalDistributionService, legacyGlobalProjectionId } from '../../src/global-assets/legacy-global-distribution';
import { hasActiveLegacyGlobalSource } from '../../src/global-assets/legacy-global-source';

const base = { schemaVersion: 1, version: 1, deletedAt: null };
function fixture() {
  const db = new FakeDocumentDatabase({
    organizations: [
      { _id: 'org_one', organizationId: 'org_one', ...base, status: 'active' },
      { _id: 'org_two', organizationId: 'org_two', ...base, status: 'active' },
    ],
    learning_resources: [
      { _id: 'question_old_complete', organizationId: 'org_one', ...base,
        type: 'exercise', status: 'published', title: 'Old complete question', contentVersion: 1,
        visibility: { type: 'classes', classIds: ['class_one'] },
        allowedClassIds: ['class_one'], questionType: 'subjective',
        stem: 'What happened?', options: [], correctAnswer: null, explanation: 'Teacher rubric',
        payload: { questionIds: ['question_old_complete'], questionType: 'subjective',
          stem: 'What happened?', options: [], correctAnswer: null,
          explanation: 'Teacher rubric' } },
      { _id: 'reading_old_incomplete', organizationId: 'org_one', ...base,
        type: 'reading', status: 'published', title: 'Pages without audio', contentVersion: 1,
        visibility: { type: 'classes', classIds: ['class_one'] },
        payload: { chapters: [{ id: 'chapter_one', pages: [{ id: 'page_one', pageNumber: 1 }] }] } },
    ],
  });
  return { db, service: new LegacyGlobalDistributionService(db,
    { nowIso: () => '2026-10-09T00:00:00.000Z' }) };
}

describe('global teaching catalog migration', () => {
  it('opens only complete published content and links every projection to its source', async () => {
    const { db, service } = fixture();
    const result = await service.syncPublishedReady(['org_one', 'org_two']);
    expect(result).toEqual({ migrated: ['question_old_complete'], deferred: ['reading_old_incomplete'] });
    const source = await db.get('learning_resources', 'question_old_complete');
    const projection = await db.get('learning_resources',
      legacyGlobalProjectionId('question_old_complete', 'org_two'));
    expect(source).toMatchObject({ visibility: { type: 'organization' },
      allowedClassIds: [], teacherCatalogOnly: true });
    expect(projection).toMatchObject({ visibility: { type: 'organization' },
      allowedClassIds: [], globalSourceVersion: source?.version,
      payload: { questionIds: [projection?._id] } });
    expect(await hasActiveLegacyGlobalSource(db, projection!)).toBe(true);
    expect((await db.get('learning_resources', 'reading_old_incomplete'))?.visibility)
      .toEqual({ type: 'classes', classIds: ['class_one'] });
    await service.syncPublishedReady(['org_one', 'org_two']);
    expect((await db.find('learning_resources', { organizationId: 'org_two' }))).toHaveLength(1);
  });
});
