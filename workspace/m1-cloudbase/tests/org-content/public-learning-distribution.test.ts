import { describe, expect, it } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import { OrgContentDocumentRepository } from '../../src/repositories/org-content-document-adapter';
import { createTaskCoreDocumentRepository } from '../../src/repositories/task-core-document-adapter';
import { ContentQueryService } from '../../src/org-content/content-service';
import { PublicLearningDistributionService, publicLearningProjectionId,
  type VerifiedPublicLearningInput } from '../../src/org-content/public-learning-distribution';

const base = { schemaVersion: 1 as const, version: 1, deletedAt: null };
const page = { id: 'page_one', pageNumber: 1, order: 1,
  imageAssetKey: 'cloud://private/page-one.jpg',
  thumbnailAssetKey: 'cloud://private/page-one-thumb.jpg',
  width: 100, height: 100, assetVersion: 'v1' };
const chapters = [{ id: 'chapter_one', title: 'Chapter one', order: 1, pages: [page] }];
const readingAudio = { reviewStatus: 'approved', sourceVersion: '1.1',
  approvedBy: 'review_demo', approvedAt: '2026-10-06T12:00:00+08:00',
  chapters: [{ chapterId: 'chapter_one', audioAssetKey: 'cloud://private/chapter-one.mp3',
    durationMs: 2000, segments: [{ id: 'segment_one', pageId: 'page_one',
      pageNumber: 1, text: 'Hello.', rect: { x: 0.1, y: 0.1, width: 0.5, height: 0.2 },
      startMs: 0, endMs: 1000 }] }] };
const readingInput: VerifiedPublicLearningInput = {
  resource: { _id: 'public_reading_source', organizationId: 'org_one', ...base,
    type: 'reading', status: 'draft', title: '虚构公共绘本',
    contentVersion: '1.1', copyrightStatus: 'verified',
    visibility: { type: 'organization' }, category: 'picture_book',
    grade: '三年级', difficulty: '基础', chapters, readingAudio,
    payload: { chapters, readingAudio } },
  sourceSha256: 'a'.repeat(64), manifestSha256: 'b'.repeat(64),
  reviewId: 'review_demo', copyrightEvidenceId: 'copyright_demo',
  copyrightEvidenceSha256: 'c'.repeat(64), importedBy: 'import_demo',
  verifiedAt: '2026-10-06T12:00:00+08:00',
};
const vocabularyInput: VerifiedPublicLearningInput = {
  ...readingInput,
  resource: { _id: 'public_vocabulary_source', organizationId: 'org_one', ...base,
    type: 'vocabulary', status: 'draft', title: '虚构公共词包',
    contentVersion: '1.1', copyrightStatus: 'verified',
    visibility: { type: 'organization' }, grade: '三年级', unit: 'Unit 1',
    words: [{ id: 'word_one', word: 'hello', meaning: '你好', example: 'Hello!',
      syllables: ['hel', 'lo'], audioAssetKey: 'cloud://private/hello.mp3' }],
    payload: { words: [{ id: 'word_one', word: 'hello', meaning: '你好', example: 'Hello!',
      syllables: ['hel', 'lo'], audioAssetKey: 'cloud://private/hello.mp3' }] } },
};
const teacher: TrustedActorContext = { requestId: 'req_teacher', sessionId: 'ses_teacher',
  actorUserId: 'teacher_two', actorRole: 'teacher', organizationId: 'org_two',
  platformSubjectDigest: 'digest_teacher', permissions: ['content.read', 'task.publish'],
  scopeIds: ['class_two'], authzVersion: 1 };
const student: TrustedActorContext = { ...teacher, actorUserId: 'student_two',
  actorRole: 'student', permissions: ['content.read'] };

function fixture() {
  const database = new FakeDocumentDatabase({
    organizations: [
      { _id: 'org_one', organizationId: 'org_one', ...base, status: 'active' },
      { _id: 'org_two', organizationId: 'org_two', ...base, status: 'active' },
    ],
    classes: [{ _id: 'class_two', organizationId: 'org_two', ...base,
      name: '虚构二班', grade: '三年级', term: '秋季', status: 'active' }],
    teacher_class_grants: [{ _id: 'grant_teacher_two', organizationId: 'org_two', ...base,
      teacherId: 'teacher_two', classId: 'class_two', status: 'active',
      permissions: ['content.read', 'task.publish'],
      grantedBy: 'admin_demo', grantedAt: '2026-10-06T12:00:00+08:00' }],
    class_memberships: [{ _id: 'member_student_two', organizationId: 'org_two', ...base,
      studentId: 'student_two', classId: 'class_two', status: 'active' }],
    learning_resources: [{ _id: 'private_reading', organizationId: 'org_one', ...base,
      type: 'reading', status: 'published', title: '旧私有绘本', contentVersion: '1.1',
      copyrightStatus: 'verified', visibility: { type: 'organization' },
      category: 'picture_book', grade: '三年级', difficulty: '基础',
      chapters, readingAudio, payload: { chapters, readingAudio } }],
  });
  return { database, distributor: new PublicLearningDistributionService(database,
    { nowIso: () => '2026-10-06T12:00:00+08:00' }) };
}

describe('cross-school teacher-only learning catalog', () => {
  it('projects reviewed reading and vocabulary for teachers without expanding old private resources', async () => {
    const { database, distributor } = fixture();
    await distributor.importVerified(readingInput);
    await distributor.importVerified(vocabularyInput);
    const readingId = publicLearningProjectionId('public_reading_source', 'org_two');
    const vocabularyId = publicLearningProjectionId('public_vocabulary_source', 'org_two');
    const service = new ContentQueryService(new OrgContentDocumentRepository(database));
    expect((await service.listTaskCatalogResources(teacher,
      { type: 'reading', targetClassIds: ['class_two'] }, { limit: 20, offset: 0 }))
      .items.map(item => item.id)).toEqual([readingId]);
    expect((await service.listTaskCatalogResources(teacher,
      { type: 'vocabulary', targetClassIds: ['class_two'] }, { limit: 20, offset: 0 }))
      .items.map(item => item.id)).toEqual([vocabularyId]);
    expect((await service.listStudentCatalog(student, { type: 'reading' },
      { limit: 20, offset: 0 })).items.map(item => item.id)).toEqual([readingId]);
    await expect(service.getReadingResource(student, readingId))
      .resolves.toMatchObject({ id: readingId });
    await expect(service.getVocabularyPack(student, vocabularyId))
      .resolves.toMatchObject({ id: vocabularyId });
    expect(await new OrgContentDocumentRepository(database).findLearningResource(
      'org_two', 'private_reading')).toBeNull();
    expect(await createTaskCoreDocumentRepository(database).findResource('org_two', readingId))
      .toMatchObject({ id: readingId, status: 'published' });
  });

  it('allows an assigned student to open task content, then blocks new source use after takedown', async () => {
    const { database, distributor } = fixture();
    await distributor.importVerified(readingInput);
    const readingId = publicLearningProjectionId('public_reading_source', 'org_two');
    await database.runTransaction(async tx => {
      await tx.create('tasks', { _id: 'task_one', organizationId: 'org_two', ...base,
        status: 'active', visibility: 'visible', publishedAt: '2026-10-06T12:00:00+08:00',
        items: [{ resourceId: readingId }] });
      await tx.create('task_assignments', { _id: 'assignment_one', organizationId: 'org_two',
        ...base, taskId: 'task_one', studentId: 'student_two', classId: 'class_two',
        status: 'not_started' });
    });
    const service = new ContentQueryService(new OrgContentDocumentRepository(database));
    expect(await service.getReadingResource(student, readingId)).toMatchObject({ id: readingId });
    await database.runTransaction(async tx => {
      const source = await tx.get('learning_resources', 'public_reading_source');
      await tx.replace('learning_resources', 'public_reading_source', source!.version,
        { ...source!, status: 'offline', version: source!.version + 1 });
    });
    await expect(service.getReadingResource(student, readingId))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await createTaskCoreDocumentRepository(database).findResource('org_two', readingId))
      .toBeNull();
    const frozenTask = await database.get('tasks', 'task_one');
    expect(frozenTask?.items).toEqual([{ resourceId: readingId }]);
  });

  it('rejects incomplete audio mappings', async () => {
    const { distributor } = fixture();
    await expect(distributor.importVerified({ ...readingInput,
      resource: { ...readingInput.resource, readingAudio: { ...readingAudio, chapters: [] } } }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
