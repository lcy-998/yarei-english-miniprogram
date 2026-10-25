import { describe, expect, it } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { validateContentQueryRequest } from '../../src/contracts/org-content-functions';
import { ContentQueryService } from '../../src/org-content/content-service';
import { InMemoryOrgContentRepository } from '../../src/org-content/in-memory-repository';
import type { ClassMembershipEntity, ReadingResourceEntity, VocabularyResourceEntity } from '../../src/org-content/types';
import type { VersionedDocument } from '../../src/repositories/document-database-port';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import { ORG_CONTENT_COLLECTIONS, createOrgContentDocumentRepository } from '../../src/repositories/org-content-document-adapter';

const organizationId = 'org_demo_student_catalog';
const classId = 'class_demo_student_catalog';
const otherClassId = 'class_demo_other_catalog';
const studentId = 'student_demo_catalog';
const actor: TrustedActorContext = { requestId: 'req_demo_catalog', sessionId: 'session_demo_catalog',
  actorUserId: studentId, actorRole: 'student', organizationId, platformSubjectDigest: 'digest_demo_catalog',
  permissions: ['content.read'], scopeIds: [classId], authzVersion: 1 };
const membership: ClassMembershipEntity = { id: 'membership_demo_catalog', organizationId, classId, studentId,
  status: 'active', version: 1 };

function reading(id: string, visibilityClass = classId): ReadingResourceEntity {
  return { id, organizationId, title: `虚构动物故事 ${id}`, type: 'reading', contentVersion: 'demo-v1',
    status: 'published', visibility: { type: 'classes', classIds: [visibilityClass] }, copyrightStatus: 'demo',
    category: 'picture_book', grade: '三年级', difficulty: '基础', theme: '动物',
    chapters: [{ id: `chapter_${id}`, title: '第一章', order: 1, pages: [{ id: `page_${id}`,
      pageNumber: 1, order: 1, thumbnailAssetKey: 'demo-thumb', imageAssetKey: 'demo-page',
      width: 750, height: 1000, assetVersion: 'demo-v1' }] }] };
}

function pack(id: string, textbook?: string): VocabularyResourceEntity {
  return { id, organizationId, title: `虚构词包 ${id}`, type: 'vocabulary', contentVersion: 'demo-v1',
    status: 'published', visibility: { type: 'classes', classIds: [classId] }, copyrightStatus: 'demo',
    grade: '三年级', ...(textbook === undefined ? {} : { textbook }), unit: 'Unit 1',
    words: [{ id: `word_${id}`, word: 'tiger', meaning: '老虎', example: 'The tiger runs.', syllables: ['ti', 'ger'] }] };
}

describe('M2 student reading and vocabulary catalog', () => {
  it('serves approved chapter narration while keeping pointread unavailable', async () => {
    const base = reading('read_chapter_narration');
    const resource: ReadingResourceEntity = { ...base, copyrightStatus: 'verified',
      readingAudio: { reviewStatus: 'approved', sourceVersion: base.contentVersion,
        approvedBy: 'Codex', approvedAt: '2026-10-15T10:00:00+08:00',
        chapters: [{ chapterId: base.chapters[0]!.id,
          audioAssetKey: 'cloud://demo/chapter-only.mp3', durationMs: 60000, segments: [] }] } };
    const service = new ContentQueryService(new InMemoryOrgContentRepository({
      memberships: [membership], resources: [resource],
    }));
    const catalog = await service.listStudentCatalog(actor,
      { type: 'reading', category: 'picture_book' }, { limit: 10, offset: 0 });
    expect(catalog.items[0]?.audioPointreadReady).toBe(false);
    expect(await service.getReadingAudioMap(actor, resource.id, base.chapters[0]!.id))
      .toMatchObject({ audioAssetKey: 'cloud://demo/chapter-only.mp3',
        durationMs: 60000, segments: [] });
  });

  it('serves one reviewed follow-reading sentence without marking the whole book complete', async () => {
    const base = reading('read_partial_pointread');
    const page = base.chapters[0]!.pages[0]!;
    const resource: ReadingResourceEntity = { ...base, copyrightStatus: 'verified',
      chapters: [...base.chapters, { id: 'chapter_not_yet_mapped', title: 'Chapter 2', order: 2,
        pages: [{ ...page, id: 'page_not_yet_mapped', pageNumber: 2 }] }],
      readingAudio: { reviewStatus: 'approved', sourceVersion: base.contentVersion,
        approvedBy: 'Codex', approvedAt: '2026-10-16T10:00:00+08:00',
        chapters: [{ chapterId: base.chapters[0]!.id,
          audioAssetKey: 'cloud://demo/chapter.mp3', durationMs: 60000,
          segments: [{ id: 'sentence_one', pageId: page.id, pageNumber: page.pageNumber,
            text: 'Hello.', rect: { x: 0.1, y: 0.2, width: 0.2, height: 0.1 },
            startMs: 0, endMs: 1200, clipDurationMs: 1200,
            clipAudioAssetKey: 'cloud://demo/hello.mp3' }] }] },
      pronunciation: { reviewStatus: 'approved', sourceVersion: base.contentVersion,
        approvedBy: 'Codex', approvedAt: '2026-10-16T10:00:00+08:00',
        segments: [{ id: 'sentence_one', pageNumber: page.pageNumber,
          text: 'Hello.', demonstrationAudioAssetKey: 'cloud://demo/hello.mp3' }] } };
    const service = new ContentQueryService(new InMemoryOrgContentRepository({
      memberships: [membership], resources: [resource],
    }));
    const catalog = await service.listStudentCatalog(actor,
      { type: 'reading', category: 'picture_book' }, { limit: 10, offset: 0 });
    expect(catalog.items[0]).toMatchObject({ audioPointreadReady: false,
      pronunciationReady: false });
    expect(await service.getReadingAudioMap(actor, resource.id, base.chapters[0]!.id))
      .toMatchObject({ segments: [{ id: 'sentence_one', text: 'Hello.' }] });
    expect(await service.getReadingPronunciationSegments(actor, resource.id))
      .toMatchObject({ segments: [{ id: 'sentence_one', text: 'Hello.',
        demonstrationAudioAssetKey: 'cloud://demo/hello.mp3' }] });
  });
  it('marks only complete reviewed audio maps as available in student book cards', async () => {
    const ready = reading('read_audio_ready');
    const media = { reviewStatus: 'approved' as const, sourceVersion: ready.contentVersion,
      approvedAt: '2026-10-03T10:00:00+08:00', approvedBy: 'reviewer_demo',
      chapters: [{ chapterId: 'chapter_read_audio_ready', audioAssetKey: 'cloud://demo/chapter.mp3',
        durationMs: 5000, segments: [{ id: 'sentence_1', pageId: 'page_read_audio_ready',
          pageNumber: 1, text: 'A cat.', rect: { x: 0.2, y: 0.2, width: 0.3, height: 0.1 },
          startMs: 0, endMs: 2000 }] }] };
    const pronunciation = { reviewStatus: 'approved' as const, sourceVersion: ready.contentVersion,
      approvedAt: '2026-10-03T10:00:00+08:00', approvedBy: 'reviewer_demo', segments: [
        { id: 'follow_page_1', text: 'A cat.', pageNumber: 1, demonstrationAudioAssetKey: 'cloud://demo/cat.mp3' },
      ] };
    const readyWithPronunciation = { ...ready, id: 'read_audio_and_pronunciation', copyrightStatus: 'verified' as const,
      readingAudio: { ...media, chapters: [{ ...media.chapters[0], segments: [{ ...media.chapters[0].segments[0],
        clipAudioAssetKey: 'cloud://demo/cat.mp3', clipDurationMs: 2000 }] }] }, pronunciation };
    const service = new ContentQueryService(new InMemoryOrgContentRepository({ memberships: [membership],
      resources: [reading('read_page_only'), { ...ready, copyrightStatus: 'verified', readingAudio: media },
        readyWithPronunciation,
        { ...reading('read_draft_audio'), copyrightStatus: 'verified', readingAudio: {
          ...media, reviewStatus: 'draft',
        } }] }));
    const page = await service.listStudentCatalog(actor, { type: 'reading', category: 'picture_book' },
      { limit: 20, offset: 0 });
    expect(page.items.map(item => [item.id, item.audioPointreadReady, item.pronunciationReady])).toEqual([
      ['read_audio_and_pronunciation', true, true], ['read_audio_ready', true, false],
      ['read_draft_audio', false, false], ['read_page_only', false, false],
    ]);
    expect(JSON.stringify(page)).not.toContain('audioAssetKey');
  });

  it('exposes complete real-source pending audio only on test-only acceptance resources', async () => {
    const pending = reading('read_pending_acceptance');
    const media = { reviewStatus: 'pending_user_acceptance' as const, sourceVersion: pending.contentVersion,
      chapters: [{ chapterId: 'chapter_read_pending_acceptance', audioAssetKey: 'cloud://demo/chapter.mp3',
        durationMs: 5000, segments: [{ id: 'sentence_1', pageId: 'page_read_pending_acceptance',
          pageNumber: 1, text: 'A cat.', rect: { x: 0.2, y: 0.2, width: 0.3, height: 0.1 },
          startMs: 0, endMs: 2000 }] }] };
    const accepted = { ...pending, copyrightStatus: 'verified' as const, testOnly: true,
      acceptanceStatus: 'pending_user_acceptance' as const, readingAudio: media };
    const nonTest = { ...accepted, id: 'read_pending_non_test', testOnly: false };
    const service = new ContentQueryService(new InMemoryOrgContentRepository({ memberships: [membership],
      resources: [accepted, nonTest] }));
    const page = await service.listStudentCatalog(actor, { type: 'reading' }, { limit: 20, offset: 0 });
    expect(page.items.map(item => [item.id, item.audioPointreadReady, item.audioPointreadPending])).toEqual([
      ['read_pending_acceptance', false, true], ['read_pending_non_test', false, false],
    ]);
    expect(await service.getReadingAudioMap(actor, accepted.id, accepted.chapters[0]!.id))
      .toMatchObject({ audioAssetKey: 'cloud://demo/chapter.mp3', segments: [{ text: 'A cat.' }] });
    await expect(service.getReadingAudioMap(actor, nonTest.id, nonTest.chapters[0]!.id))
      .resolves.toMatchObject({ audioAssetKey: null, segments: [] });
  });

  it('returns only authorized paged summaries and derives facets from available books', async () => {
    const service = new ContentQueryService(new InMemoryOrgContentRepository({ memberships: [membership], resources: [
      reading('read_01'), reading('read_02', otherClassId), reading('read_03'),
      { ...reading('read_task_only'), taskOnly: true }, { ...reading('read_offline'), status: 'offline' },
    ] }));
    const first = await service.listStudentCatalog(actor, { type: 'reading', category: 'picture_book', theme: '动物' }, { limit: 1, offset: 0 });
    const second = await service.listStudentCatalog(actor, { type: 'reading', category: 'picture_book', theme: '动物' }, { limit: 1, offset: first.nextOffset! });
    expect(first).toMatchObject({ total: 3, nextOffset: 1, items: [{ id: 'read_01', itemCount: 1 }] });
    expect(second).toMatchObject({ total: 3, nextOffset: 2, items: [{ id: 'read_02' }] });
    expect(JSON.stringify(first)).not.toContain('imageAssetKey');
    expect(JSON.stringify(first)).not.toContain('chapters');
    await expect(service.listStudentCatalogFacets(actor, 'reading', 'picture_book')).resolves.toEqual([
      { category: 'picture_book', grade: '三年级', difficulty: '基础', theme: '动物' },
    ]);
    await expect(service.getReadingResource(actor, 'read_02')).resolves.toMatchObject({ id: 'read_02' });
  });

  it('keeps unlabeled textbooks separate and shares published summaries with signed-in roles', async () => {
    const repository = new InMemoryOrgContentRepository({ memberships: [membership], resources: [
      pack('pack_unlabeled'), pack('pack_labeled', '演示教材'),
    ] });
    const service = new ContentQueryService(repository);
    await expect(service.listStudentCatalog(actor, { type: 'vocabulary', textbook: '__unlabeled_textbook__' }, { limit: 20, offset: 0 }))
      .resolves.toMatchObject({ total: 1, items: [{ id: 'pack_unlabeled' }] });
    await expect(service.listStudentCatalogFacets(actor, 'vocabulary')).resolves.toContainEqual({ grade: '三年级', unit: 'Unit 1' });
    await expect(service.listStudentCatalog({ ...actor, permissions: [] }, { type: 'vocabulary' }, { limit: 20, offset: 0 }))
      .resolves.toMatchObject({ total: 2 });
    const revoked = new ContentQueryService(new InMemoryOrgContentRepository({ memberships: [{ ...membership, status: 'inactive' }], resources: [pack('pack_unlabeled')] }));
    await expect(revoked.listStudentCatalog(actor, { type: 'vocabulary' }, { limit: 20, offset: 0 }))
      .resolves.toMatchObject({ total: 1 });
    for (const actorRole of ['student', 'parent', 'teacher', 'admin'] as const) {
      const sessionActor = { ...actor, actorRole };
      await expect(service.listStudentCatalog(sessionActor, { type: 'vocabulary' }, { limit: 20, offset: 0 }))
        .resolves.toMatchObject({ total: 2, items: [{ id: 'pack_labeled' }, { id: 'pack_unlabeled' }] });
      await expect(service.listStudentCatalogFacets(sessionActor, 'vocabulary'))
        .resolves.toContainEqual({ grade: '三年级', unit: 'Unit 1' });
    }
  });

  it('rejects forged fields and incompatible student query filters', () => {
    expect(validateContentQueryRequest({ apiVersion: 'm1.v1', action: 'listStudentCatalog', payload: {
      filters: { type: 'vocabulary', actorUserId: studentId }, page: { limit: 20, offset: 0 },
    } })).toMatchObject({ ok: false });
    expect(validateContentQueryRequest({ apiVersion: 'm1.v1', action: 'listStudentCatalog', payload: {
      filters: { type: 'reading', unit: 'Unit 1' }, page: { limit: 20, offset: 0 },
    } })).toMatchObject({ ok: false });
    expect(validateContentQueryRequest({ apiVersion: 'm1.v1', action: 'listStudentCatalogFacets', payload: {
      type: 'vocabulary', category: 'picture_book',
    } })).toMatchObject({ ok: false });
  });

  it('reads real reading theme metadata from document pages without returning page assets', async () => {
    const database = new FakeDocumentDatabase({
      [ORG_CONTENT_COLLECTIONS.resources]: [{ _id: 'read_document_demo', organizationId, schemaVersion: 1,
        version: 1, deletedAt: null, type: 'reading', status: 'published', title: '虚构动物绘本',
        contentVersion: 1, visibility: { type: 'classes', classIds: [classId] }, copyrightStatus: 'demo',
        category: 'picture_book', grade: '三年级', difficulty: '基础', theme: '动物',
        chapters: [{ id: 'chapter_document_demo', title: '第一章', order: 1, pages: [{ id: 'page_document_demo',
          pageNumber: 1, order: 1, thumbnailAssetKey: 'demo-thumb', imageAssetKey: 'demo-page',
          width: 750, height: 1000, assetVersion: 'demo-v1' }] }],
      } as VersionedDocument],
      [ORG_CONTENT_COLLECTIONS.memberships]: [{ _id: membership.id, organizationId, schemaVersion: 1,
        version: 1, deletedAt: null, classId, studentId, status: 'active' } as VersionedDocument],
    });
    const service = new ContentQueryService(createOrgContentDocumentRepository(database));
    const page = await service.listStudentCatalog(actor, { type: 'reading', category: 'picture_book', theme: '动物' }, { limit: 20, offset: 0 });
    expect(page).toMatchObject({ total: 1, items: [{ id: 'read_document_demo', theme: '动物' }] });
    expect(JSON.stringify(page)).not.toContain('imageAssetKey');
  });
});
