import { describe, expect, it, vi } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { validateContentQueryRequest } from '../../src/contracts/org-content-functions';
import { ContentQueryService } from '../../src/org-content/content-service';
import { InMemoryOrgContentRepository } from '../../src/org-content/in-memory-repository';
import type { ReadingResourceEntity, TeacherClassGrantEntity, VocabularyResourceEntity } from '../../src/org-content/types';
import type { VersionedDocument } from '../../src/repositories/document-database-port';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import { ORG_CONTENT_COLLECTIONS, createOrgContentDocumentRepository } from '../../src/repositories/org-content-document-adapter';

const org = 'org_demo_catalog';
const classId = 'class_demo_three';
const otherClassId = 'class_demo_four';
const teacherId = 'teacher_demo_lin';
const actor: TrustedActorContext = { requestId: 'req_catalog', sessionId: 'session_catalog', actorUserId: teacherId,
  actorRole: 'teacher', organizationId: org, platformSubjectDigest: 'digest_catalog', permissions: ['content.read'],
  scopeIds: [classId], authzVersion: 1 };
const grant: TeacherClassGrantEntity = { id: 'grant_catalog', organizationId: org, teacherId, classId,
  permissions: ['content.read'], status: 'active', grantedBy: 'admin_demo', grantedAt: '2026-09-26T00:00:00+08:00', version: 1 };

function reading(id: string, visibleClassId = classId, status: ReadingResourceEntity['status'] = 'published'): ReadingResourceEntity {
  return { id, organizationId: org, type: 'reading', title: `动物绘本 ${id}`, contentVersion: 'demo-v1', status,
    visibility: { type: 'classes', classIds: [visibleClassId] }, copyrightStatus: 'demo', category: 'picture_book',
    grade: '三年级', difficulty: '基础', searchText: '虚构动物故事', chapters: [{ id: `chapter_${id}`, title: '第一章', order: 1,
      pages: [{ id: `page_${id}`, pageNumber: 1, order: 1, thumbnailAssetKey: 'demo-thumb', imageAssetKey: 'demo-page',
        width: 750, height: 1000, assetVersion: 'demo-v1' }] }] };
}

function vocabulary(id: string): VocabularyResourceEntity {
  return { id, organizationId: org, type: 'vocabulary', title: `动物词包 ${id}`, contentVersion: 'demo-v1', status: 'published',
    visibility: { type: 'classes', classIds: [classId] }, copyrightStatus: 'demo', grade: '三年级',
    textbook: '演示同步教材', unit: 'Unit 3', words: [{ id: `word_${id}`, word: 'tiger', meaning: '老虎',
      example: 'The tiger runs.', syllables: ['ti', 'ger'] }] };
}

describe('M2 teacher reading and word-pack catalog', () => {
  it('without a publish target browses the union of the teacher’s authorized classes', async () => {
    const bothClasses = { ...actor, scopeIds: [classId, otherClassId] }
    const service = new ContentQueryService(new InMemoryOrgContentRepository({
      teacherGrants: [grant, { ...grant, id: 'grant_other', classId: otherClassId }],
      resources: [reading('read_three'), reading('read_four', otherClassId)],
    }))
    const browse = await service.listTaskCatalogResources(bothClasses, { type: 'reading' }, { limit: 20, offset: 0 })
    expect(browse.items.map(item => item.id).sort()).toEqual(['read_four', 'read_three'])
    await expect(service.getTaskCatalogResource(bothClasses, 'read_four')).resolves.toMatchObject({ id: 'read_four' })
    await expect(service.listTaskCatalogResources(bothClasses, { type: 'reading',
      targetClassIds: [classId, otherClassId] }, { limit: 20, offset: 0 })).resolves.toMatchObject({ items: [] })
    await expect(service.getTaskCatalogResource(bothClasses, 'read_four', [classId, otherClassId]))
      .rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('pages only authorized summaries and rechecks each selected resource', async () => {
    const service = new ContentQueryService(new InMemoryOrgContentRepository({ teacherGrants: [grant], resources: [
      reading('read_01'), reading('read_02', otherClassId), reading('read_03'), reading('read_04', classId, 'offline'),
      vocabulary('vocab_01'),
    ] }));
    const first = await service.listTaskCatalogResources(actor, { type: 'reading', grade: '三年级', keyword: '动物',
      targetClassIds: [classId] }, { limit: 1, offset: 0 });
    const second = await service.listTaskCatalogResources(actor, { type: 'reading', grade: '三年级', keyword: '动物',
      targetClassIds: [classId] }, { limit: 1, offset: first.nextOffset! });
    expect(first.items.map((item) => item.id)).toEqual(['read_01']);
    expect(second.items.map((item) => item.id)).toEqual(['read_03']);
    expect(second.nextOffset).toBeNull();
    expect(JSON.stringify(first)).not.toContain('imageAssetKey');
    expect(JSON.stringify(first)).not.toContain('虚构动物故事');
    await expect(service.listTaskCatalogResources(actor, { type: 'vocabulary', textbook: '演示同步教材', unit: 'Unit 3' },
      { limit: 20, offset: 0 })).resolves.toMatchObject({ items: [{ id: 'vocab_01', requiredCount: 1 }], nextOffset: null });
    await expect(service.listTaskCatalogFacets(actor, 'reading', [classId])).resolves.toEqual([{
      source: 'reading_book', grade: '三年级', textbook: '__unlabeled_textbook__', difficulty: '基础',
    }]);
    await expect(service.getTaskCatalogResource(actor, 'read_03', [classId])).resolves.toMatchObject({ type: 'reading', requiredCount: 1 });
    await expect(service.getTaskCatalogResource(actor, 'read_02', [classId])).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.getTaskCatalogResource(actor, 'read_04', [classId])).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('derives source and textbook facets from authorized content instead of fixed choices', async () => {
    const synchronized: ReadingResourceEntity = { ...reading('read_sync'), category: 'synchronized',
      term: '上学期', textbook: '演示同步教材', unit: 'Unit 3' };
    const service = new ContentQueryService(new InMemoryOrgContentRepository({ teacherGrants: [grant], resources: [
      reading('read_book'), synchronized, reading('read_other', otherClassId),
    ] }));
    const facets = await service.listTaskCatalogFacets(actor, 'reading', [classId]);
    expect(facets).toContainEqual({ source: 'reading_book', grade: '三年级', textbook: '__unlabeled_textbook__', difficulty: '基础' });
    expect(facets).toContainEqual({ source: 'synchronized_textbook', grade: '三年级', term: '上学期',
      textbook: '演示同步教材', unit: 'Unit 3', difficulty: '基础' });
    expect(facets).toHaveLength(2);
    await expect(service.listTaskCatalogResources(actor, { type: 'reading', source: 'synchronized_textbook',
      term: '上学期', textbook: '演示同步教材', unit: 'Unit 3' }, { limit: 20, offset: 0 }))
      .resolves.toMatchObject({ items: [{ id: 'read_sync', source: 'synchronized_textbook' }], nextOffset: null });
    await expect(service.listTaskCatalogResources(actor, { type: 'reading', category: 'picture_book' }, { limit: 20, offset: 0 }))
      .resolves.toMatchObject({ items: [{ id: 'read_book', category: 'picture_book' }], nextOffset: null });
    await expect(service.listTaskCatalogResources(actor, { type: 'reading', category: 'synchronized' }, { limit: 20, offset: 0 }))
      .resolves.toMatchObject({ items: [{ id: 'read_sync', category: 'synchronized' }], nextOffset: null });
    await expect(service.listTaskCatalogResources(actor, { type: 'reading', textbook: '__unlabeled_textbook__' },
      { limit: 20, offset: 0 })).resolves.toMatchObject({ items: [{ id: 'read_book' }], nextOffset: null });
  });

  it('rejects revoked authority, cross-class targets and malformed query payloads', async () => {
    const service = new ContentQueryService(new InMemoryOrgContentRepository({ teacherGrants: [grant], resources: [reading('read_01')] }));
    await expect(service.listTaskCatalogResources({ ...actor, actorRole: 'student' }, { type: 'reading' }, { limit: 20, offset: 0 }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.listTaskCatalogResources(actor, { type: 'reading', targetClassIds: [otherClassId] }, { limit: 20, offset: 0 }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.listTaskCatalogResources(actor, { type: 'reading' }, { limit: 51, offset: 0 }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    const revoked = new ContentQueryService(new InMemoryOrgContentRepository({ teacherGrants: [{ ...grant, status: 'revoked' }], resources: [reading('read_01')] }));
    await expect(revoked.getTaskCatalogResource(actor, 'read_01')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(validateContentQueryRequest({ apiVersion: 'm1.v1', action: 'listTaskCatalogResources', payload: {
      filters: { type: 'reading', targetClassIds: [classId] }, page: { limit: 20, offset: 0 }, forgedUserId: teacherId,
    } })).toMatchObject({ ok: false });
    expect(validateContentQueryRequest({ apiVersion: 'm1.v1', action: 'listTaskCatalogResources', payload: {
      filters: { type: 'video' }, page: { limit: 20, offset: 0 },
    } })).toMatchObject({ ok: false });
    expect(validateContentQueryRequest({ apiVersion: 'm1.v1', action: 'listTaskCatalogFacets', payload: {
      type: 'reading', targetClassIds: [classId], forgedUserId: teacherId,
    } })).toMatchObject({ ok: false });
  });

  it('fails clearly if a page would cross the bounded catalog offset', async () => {
    const repository = new InMemoryOrgContentRepository({ teacherGrants: [grant] });
    vi.spyOn(repository, 'listTaskCatalogResourcePage').mockResolvedValue({
      items: [reading('read_10000'), reading('read_10001')], hasMore: false,
    });
    const service = new ContentQueryService(repository);
    await expect(service.listTaskCatalogResources(actor, { type: 'reading' }, { limit: 1, offset: 10000 }))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });

  it('reads bounded document pages and preserves vocabulary textbook metadata', async () => {
    const book = reading('read_01');
    const pack = vocabulary('vocab_01');
    const database = new FakeDocumentDatabase({
      [ORG_CONTENT_COLLECTIONS.resources]: [document(book.id, { type: book.type, title: book.title, contentVersion: 1,
        status: book.status, visibility: { type: 'classes', classIds: [classId] }, copyrightStatus: 'demo',
        category: book.category, grade: book.grade, term: '上学期', textbook: '演示阅读教材',
        unit: 'Unit 2', difficulty: book.difficulty,
        chapters: [{ id: 'chapter_read_01', title: '第一章', order: 1, pages: [{ id: 'page_read_01',
          pageNumber: 1, order: 1, thumbnailAssetKey: 'demo-thumb', imageAssetKey: 'demo-page',
          width: 750, height: 1000, assetVersion: 'demo-v1' }] }],
      }), document(pack.id, { type: pack.type, title: pack.title, contentVersion: 1,
        status: pack.status, visibility: { type: 'classes', classIds: [classId] }, copyrightStatus: 'demo',
        grade: pack.grade, textbook: pack.textbook!, unit: pack.unit,
        words: [{ id: 'word_vocab_01', word: 'tiger', meaning: '老虎', example: 'The tiger runs.', syllables: ['ti', 'ger'] }],
      })],
      [ORG_CONTENT_COLLECTIONS.teacherGrants]: [document(grant.id, { teacherId, classId, permissions: ['content.read'],
        status: 'active', grantedBy: 'admin_demo', grantedAt: '2026-09-26T00:00:00+08:00' })],
    });
    const service = new ContentQueryService(createOrgContentDocumentRepository(database));
    await expect(service.listTaskCatalogResources(actor, { type: 'reading' }, { limit: 20, offset: 0 }))
      .resolves.toMatchObject({ items: [{ id: 'read_01', term: '上学期', textbook: '演示阅读教材', unit: 'Unit 2', requiredCount: 1 }], nextOffset: null });
    await expect(service.listTaskCatalogResources(actor, { type: 'vocabulary', textbook: '演示同步教材' }, { limit: 20, offset: 0 }))
      .resolves.toMatchObject({ items: [{ id: 'vocab_01', textbook: '演示同步教材' }], nextOffset: null });
    await expect(service.listTaskCatalogFacets(actor, 'vocabulary', [classId])).resolves.toEqual([{
      source: 'word_pack', grade: '三年级', textbook: '演示同步教材', unit: 'Unit 3',
    }]);
  });
});

function document(id: string, fields: Record<string, VersionedDocument[string]>): VersionedDocument {
  return { _id: id, organizationId: org, schemaVersion: 1, version: 1, deletedAt: null, ...fields };
}
