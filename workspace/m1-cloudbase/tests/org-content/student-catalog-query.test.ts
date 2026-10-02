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
  it('returns only authorized paged summaries and derives facets from available books', async () => {
    const service = new ContentQueryService(new InMemoryOrgContentRepository({ memberships: [membership], resources: [
      reading('read_01'), reading('read_02', otherClassId), reading('read_03'),
      { ...reading('read_task_only'), taskOnly: true }, { ...reading('read_offline'), status: 'offline' },
    ] }));
    const first = await service.listStudentCatalog(actor, { type: 'reading', category: 'picture_book', theme: '动物' }, { limit: 1, offset: 0 });
    const second = await service.listStudentCatalog(actor, { type: 'reading', category: 'picture_book', theme: '动物' }, { limit: 1, offset: first.nextOffset! });
    expect(first).toMatchObject({ total: 2, nextOffset: 1, items: [{ id: 'read_01', itemCount: 1 }] });
    expect(second).toMatchObject({ total: 2, nextOffset: null, items: [{ id: 'read_03' }] });
    expect(JSON.stringify(first)).not.toContain('imageAssetKey');
    expect(JSON.stringify(first)).not.toContain('chapters');
    await expect(service.listStudentCatalogFacets(actor, 'reading', 'picture_book')).resolves.toEqual([
      { category: 'picture_book', grade: '三年级', difficulty: '基础', theme: '动物' },
    ]);
    await expect(service.getReadingResource(actor, 'read_02')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('keeps unlabeled textbooks separate and rejects revoked student access', async () => {
    const repository = new InMemoryOrgContentRepository({ memberships: [membership], resources: [
      pack('pack_unlabeled'), pack('pack_labeled', '演示教材'),
    ] });
    const service = new ContentQueryService(repository);
    await expect(service.listStudentCatalog(actor, { type: 'vocabulary', textbook: '__unlabeled_textbook__' }, { limit: 20, offset: 0 }))
      .resolves.toMatchObject({ total: 1, items: [{ id: 'pack_unlabeled' }] });
    await expect(service.listStudentCatalogFacets(actor, 'vocabulary')).resolves.toContainEqual({ grade: '三年级', unit: 'Unit 1' });
    await expect(service.listStudentCatalog({ ...actor, permissions: [] }, { type: 'vocabulary' }, { limit: 20, offset: 0 }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    const revoked = new ContentQueryService(new InMemoryOrgContentRepository({ memberships: [{ ...membership, status: 'inactive' }], resources: [pack('pack_unlabeled')] }));
    await expect(revoked.listStudentCatalog(actor, { type: 'vocabulary' }, { limit: 20, offset: 0 }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.listStudentCatalog({ ...actor, actorRole: 'teacher' }, { type: 'vocabulary' }, { limit: 20, offset: 0 }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
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
