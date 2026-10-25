import { describe, expect, it } from 'vitest';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import { OrgContentDocumentRepository } from '../../src/repositories/org-content-document-adapter';
import { ContentQueryService } from '../../src/org-content/content-service';
import { createTaskCoreDocumentRepository } from '../../src/repositories/task-core-document-adapter';
import { DocumentNativeAdminGrantRepository, nativeAdminGrantId } from '../../src/native-admin/document-grant-repository';
import { NativeAdminOperationsService } from '../../src/native-admin/operations-service';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { PublicQuestionDistributionService, publicQuestionProjectionId,
  type VerifiedPublicQuestionInput } from '../../src/question-admin/public-question-distribution';
import { hasActivePublicQuestionSource } from '../../src/question-admin/public-question-source';

const base = { schemaVersion: 1 as const, version: 1, deletedAt: null };
const input: VerifiedPublicQuestionInput = {
  sourceId: 'question_public_source', organizationId: 'org_one',
  title: '虚构公共习题', grade: '三年级', questionType: 'single_choice',
  stem: 'Choose the word.', options: ['cat', 'dog'], correctAnswer: 'cat',
  explanation: '虚构测试解析', contentVersion: 1,
  sourceSha256: 'a'.repeat(64), manifestSha256: 'b'.repeat(64),
  sourceUrl: 'https://example.org/fictional-question-source',
  exercisePackId: 'exercise_pack_test',
  reviewId: 'review_demo', copyrightEvidenceId: 'copyright_demo', importedBy: 'import_demo',
  copyrightEvidenceSha256: 'c'.repeat(64), verifiedAt: '2026-10-06T12:00:00+08:00',
};

function fixture() {
  const database = new FakeDocumentDatabase({
    organizations: [
      { _id: 'org_one', organizationId: 'org_one', ...base, status: 'active' },
      { _id: 'org_two', organizationId: 'org_two', ...base, status: 'active' },
    ],
    users: [{ _id: 'teacher_manager', organizationId: 'org_two', ...base,
      authorizationVersion: 2, status: 'active' }],
    native_admin_grants: [{ _id: nativeAdminGrantId('org_two', 'teacher_manager'),
      organizationId: 'org_two', ...base, teacherId: 'teacher_manager', status: 'active',
      permissions: ['question.manage'], scope: { organizationWide: true, classIds: [] } }],
    learning_resources: [
      { _id: 'private_question', organizationId: 'org_one', ...base, type: 'exercise',
        title: '旧私有题', status: 'published', visibility: { type: 'organization' },
        questionType: 'single_choice', stem: 'Legacy', options: ['A', 'B'],
        correctAnswer: 'A', explanation: '旧题', contentVersion: 1, grade: '三年级',
        copyrightStatus: 'verified',
        payload: { questionIds: ['private_question'], questionType: 'single_choice',
          stem: 'Legacy', options: ['A', 'B'], correctAnswer: 'A', explanation: '旧题' } },
    ],
  });
  return { database, distributor: new PublicQuestionDistributionService(database,
    { nowIso: () => '2026-10-06T12:00:00+08:00' }) };
}

describe('public question distribution', () => {
  it('keeps honest provenance and section metadata for original written exercises', async () => {
    const { database, distributor } = fixture();
    const original: VerifiedPublicQuestionInput = { ...input,
      sourceId: 'question_original_section_01', title: '原创分层练习', questionType: 'fill',
      stem: 'Write the number.', options: [], correctAnswer: 'two',
      acceptedAnswers: ['two', '2'],
      sourceKind: 'original_by_codex',
      sourceUrl: 'asset-library://independent-exercises/20261020/v4/question_original_section_01',
      exerciseSection: { id: 'section_01', title: '大题一：语言', instruction: '读句子并填空',
        studentMaterial: 'There are two books.', order: 1, questionOrder: 1, points: 2 } };
    await distributor.importVerified(original);
    const projectionId = publicQuestionProjectionId(original.sourceId, 'org_two');
    const projection = await database.get('learning_resources', projectionId);
    expect(projection?.payload).toMatchObject({ acceptedAnswers: ['two', '2'],
      exerciseSection: { id: 'section_01', studentMaterial: 'There are two books.' },
      assetLibrary: { sourceKind: 'original_by_codex' } });
    expect(await hasActivePublicQuestionSource(database, projection!)).toBe(true);
    expect(await new OrgContentDocumentRepository(database).findLearningResource('org_two', projectionId))
      .toMatchObject({ exerciseSection: { id: 'section_01', points: 2 }, acceptedAnswers: ['two', '2'] });
  });

  it('materializes only an explicit verified source and keeps legacy questions private', async () => {
    const { database, distributor } = fixture();
    const first = await distributor.importVerified(input);
    expect(first.projectedOrganizations).toEqual(['org_one', 'org_two']);
    const projectionId = publicQuestionProjectionId(input.sourceId, 'org_two');
    const projection = await database.get('learning_resources', projectionId);
    expect(projection).toMatchObject({ organizationId: 'org_two', type: 'exercise',
      publicQuestionProjection: true, status: 'published', testOnly: false,
      payload: { assetLibrary: { reviewStatus: 'source_verified_reusable',
        automatedVerifier: 'codex' } } });
    expect(await hasActivePublicQuestionSource(database, projection!)).toBe(true);
    const otherCatalog = new OrgContentDocumentRepository(database);
    expect((await otherCatalog.listExerciseResourcePage('org_two', {}, { limit: 20, offset: 0 }))
      .items.map(item => item?.id)).toEqual([projectionId]);
    const catalog = new ContentQueryService(otherCatalog);
    const ungrantedTeacher: TrustedActorContext = { requestId: 'req_public_question_catalog',
      sessionId: 'ses_public_question_catalog', actorUserId: 'teacher_manager',
      actorRole: 'teacher', organizationId: 'org_two',
      platformSubjectDigest: 'digest_public_question_catalog',
      permissions: [], scopeIds: [], authzVersion: 2 };
    expect((await catalog.listSchoolQuestions(ungrantedTeacher, {}, { limit: 20, offset: 0 }))
      .items.map(item => item.id)).toEqual([projectionId]);
    await expect(catalog.getSchoolQuestion(ungrantedTeacher, projectionId))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await otherCatalog.findLearningResource('org_two', 'private_question')).toBeNull();
    expect(await createTaskCoreDocumentRepository(database).findResource('org_two', projectionId))
      .toMatchObject({ id: projectionId, status: 'published' });
    await distributor.importVerified(input);
    expect((await database.find('learning_resources', { organizationId: 'org_two' }))).toHaveLength(1);
    await database.runTransaction(async tx => {
      await tx.create('organizations', { _id: 'org_three', organizationId: 'org_three',
        ...base, status: 'active' });
    });
    expect(await distributor.syncOrganization('org_three')).toBe(1);
    expect(await database.get('learning_resources',
      publicQuestionProjectionId(input.sourceId, 'org_three'))).toMatchObject({
      organizationId: 'org_three', status: 'published' });
  });

  it('blocks new cross-school reads as soon as the source is taken down', async () => {
    const { database, distributor } = fixture();
    await distributor.importVerified(input);
    const projectionId = publicQuestionProjectionId(input.sourceId, 'org_two');
    await database.runTransaction(async tx => {
      const source = await tx.get('learning_resources', input.sourceId);
      expect(source).not.toBeNull();
      await tx.replace('learning_resources', input.sourceId, source!.version,
        { ...source!, status: 'offline', version: source!.version + 1 });
    });
    const projection = await database.get('learning_resources', projectionId);
    expect(await hasActivePublicQuestionSource(database, projection!)).toBe(false);
    const otherCatalog = new OrgContentDocumentRepository(database);
    expect((await otherCatalog.listExerciseResourcePage('org_two', {}, { limit: 20, offset: 0 }))
      .items).toEqual([null]);
    expect(await otherCatalog.findLearningResource('org_two', projectionId)).toBeNull();
    expect(await createTaskCoreDocumentRepository(database).findResource('org_two', projectionId))
      .toBeNull();
    const actor: TrustedActorContext = { requestId: 'req_public_question', sessionId: 'ses_public_question',
      actorUserId: 'teacher_manager', actorRole: 'teacher', organizationId: 'org_two',
      platformSubjectDigest: 'digest_public_question', permissions: [], scopeIds: [],
      authzVersion: 2 };
    const operations = new NativeAdminOperationsService(database,
      new DocumentNativeAdminGrantRepository(database),
      { nowIso: () => '2026-10-06T12:01:00+08:00' });
    await expect(operations.setQuestionStatus(actor, { questionId: projectionId,
      status: 'published', reason: '尝试重新上架' }, 1, 'operation_republish_public_question'))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects missing source and rights evidence before import', async () => {
    const { distributor } = fixture();
    await expect(distributor.importVerified({ ...input, copyrightEvidenceId: '' }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
