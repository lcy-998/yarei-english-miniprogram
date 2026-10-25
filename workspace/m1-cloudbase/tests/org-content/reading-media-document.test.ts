import { describe, expect, it } from 'vitest';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import { createOrgContentDocumentRepository, ORG_CONTENT_COLLECTIONS } from '../../src/repositories/org-content-document-adapter';

describe('M3 reading media document projection', () => {
  it('retains approved audio and pronunciation metadata behind the server resource boundary', async () => {
    const organizationId = 'org_demo';
    const document = { _id: 'read_demo', organizationId, schemaVersion: 1 as const,
      version: 1, deletedAt: null, type: 'reading', status: 'published',
      title: '虚构阅读', contentVersion: 'v1', copyrightStatus: 'verified',
      visibility: { type: 'classes', classIds: ['class_demo'] },
      payload: { category: 'picture_book', grade: '三年级', difficulty: '基础',
        chapters: [{ id: 'chapter_demo', title: '虚构章节', order: 1,
          pages: [{ id: 'page_demo', pageNumber: 1, order: 1,
            thumbnailAssetKey: 'cloud://demo/thumb.jpg', imageAssetKey: 'cloud://demo/page.jpg',
            width: 1000, height: 700, assetVersion: 'v1' }] }],
        pronunciation: { reviewStatus: 'approved', sourceVersion: 'v1',
          approvedAt: '2026-10-02T08:00:00+08:00', approvedBy: 'reviewer_demo',
          segments: [{ id: 'segment_demo', text: 'Hello.', pageNumber: 1,
            demonstrationAudioAssetKey: 'cloud://demo/segment.mp3' }] },
        readingAudio: { reviewStatus: 'approved', sourceVersion: 'v1',
          approvedAt: '2026-10-02T08:00:00+08:00', approvedBy: 'reviewer_demo',
          chapters: [{ chapterId: 'chapter_demo', audioAssetKey: 'cloud://demo/chapter.mp3',
            durationMs: 5000, segments: [{ id: 'segment_demo', pageId: 'page_demo',
              pageNumber: 1, text: 'Hello.', rect: { x: 0.2, y: 0.2, width: 0.3, height: 0.1 },
              startMs: 0, endMs: 3000,
              clipAudioAssetKey: 'cloud://demo/page.mp3', clipDurationMs: 3200 }] }] },
      },
    };
    const database = new FakeDocumentDatabase({ [ORG_CONTENT_COLLECTIONS.resources]: [document] });
    const resource = await createOrgContentDocumentRepository(database)
      .findLearningResource(organizationId, 'read_demo');
    expect(resource).toMatchObject({ type: 'reading', pronunciation: { segments: [{ id: 'segment_demo' }] },
      readingAudio: { chapters: [{ segments: [{ pageId: 'page_demo', endMs: 3000,
        clipAudioAssetKey: 'cloud://demo/page.mp3', clipDurationMs: 3200 }] }] } });
  });
});
