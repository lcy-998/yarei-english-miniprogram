import { describe, expect, it } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { ContentQueryService } from '../../src/org-content/content-service';
import { InMemoryOrgContentRepository } from '../../src/org-content/in-memory-repository';
import type { ExerciseResourceEntity, TeacherClassGrantEntity } from '../../src/org-content/types';
import type { VersionedDocument } from '../../src/repositories/document-database-port';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import { ORG_CONTENT_COLLECTIONS, createOrgContentDocumentRepository } from '../../src/repositories/org-content-document-adapter';

const ORG = 'org_qihang';
const CLASS = 'cls_grade3_2';
const OTHER_CLASS = 'cls_grade4_1';
const TEACHER = 'usr_teacher_lin';

const actor: TrustedActorContext = {
  requestId: 'req_teacher', sessionId: 'session_teacher', actorUserId: TEACHER, actorRole: 'teacher',
  organizationId: ORG, platformSubjectDigest: 'digest_teacher', permissions: ['content.read'],
  scopeIds: [CLASS], authzVersion: 1,
};

const grant: TeacherClassGrantEntity = {
  id: 'grant_teacher', organizationId: ORG, teacherId: TEACHER, classId: CLASS,
  permissions: ['content.read'], status: 'active', grantedBy: 'usr_admin_zhou', grantedAt: '2026-09-26T00:00:00+08:00', version: 1,
};

function question(id: string, classIds: readonly string[] = [CLASS], status: ExerciseResourceEntity['status'] = 'published'): ExerciseResourceEntity {
  return {
    id, organizationId: ORG, type: 'exercise', title: `动物主题题目 ${id}`, contentVersion: 'demo-v1', status,
    visibility: { type: 'classes', classIds }, copyrightStatus: 'demo', grade: '三年级', textbook: '演示同步教材',
    unit: 'Unit 3', knowledgePoint: '动物词汇', questionType: 'single_choice', difficulty: '基础',
    stem: `请选择 ${id} 对应的动物`, options: ['猫', '狗', '鸟'], correctAnswer: '猫', explanation: '这是虚构题目解析。',
  };
}

describe('M2 school question catalog', () => {
  it('without a publish target includes questions from either authorized class while final targets require common access', async () => {
    const bothClasses = { ...actor, scopeIds: [CLASS, OTHER_CLASS] };
    const service = new ContentQueryService(new InMemoryOrgContentRepository({ resources: [
      question('q_three'), question('q_four', [OTHER_CLASS]),
    ], teacherGrants: [grant, { ...grant, id: 'grant_other', classId: OTHER_CLASS }] }));
    const browse = await service.listSchoolQuestions(bothClasses, {}, { limit: 20, offset: 0 });
    expect(browse.items.map(item => item.id).sort()).toEqual(['q_four', 'q_three']);
    await expect(service.getSchoolQuestion(bothClasses, 'q_four')).resolves.toMatchObject({ id: 'q_four' });
    await expect(service.listSchoolQuestions(bothClasses, { targetClassIds: [CLASS, OTHER_CLASS] },
      { limit: 20, offset: 0 })).resolves.toMatchObject({ items: [] });
    await expect(service.getSchoolQuestion(bothClasses, 'q_four', [CLASS, OTHER_CLASS]))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('pages authorized summaries without exposing answers and keeps a filtered detail behind teacher access', async () => {
    const resources = [question('q_01'), question('q_02', [OTHER_CLASS]), question('q_03'), question('q_04', [CLASS], 'offline'), question('q_05')];
    const service = new ContentQueryService(new InMemoryOrgContentRepository({ resources, teacherGrants: [grant] }));
    const first = await service.listSchoolQuestions(actor, { grade: '三年级', keyword: '动物' }, { limit: 2, offset: 0 });
    const second = await service.listSchoolQuestions(actor, { grade: '三年级', keyword: '动物' }, { limit: 2, offset: first.nextOffset! });
    expect(first.items.map((item) => item.id)).toEqual(['q_01', 'q_03']);
    expect(second.items.map((item) => item.id)).toEqual(['q_05']);
    expect(second.nextOffset).toBeNull();
    expect(JSON.stringify(first)).not.toContain('correctAnswer');
    expect(JSON.stringify(first)).not.toContain('这是虚构题目解析');
    expect(await service.listSchoolQuestionFacets(actor)).toEqual([{
      grade: '三年级', textbook: '演示同步教材', unit: 'Unit 3', knowledgePoint: '动物词汇', questionType: 'single_choice', difficulty: '基础',
    }]);
    await expect(service.getSchoolQuestion(actor, 'q_03')).resolves.toMatchObject({ correctAnswer: '猫', explanation: '这是虚构题目解析。' });
    await expect(service.getSchoolQuestion(actor, 'q_02')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.getSchoolQuestion(actor, 'q_04')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects non-teachers, revoked grants, cross-class targets and invalid pages', async () => {
    const service = new ContentQueryService(new InMemoryOrgContentRepository({ resources: [question('q_01')], teacherGrants: [grant] }));
    await expect(service.listSchoolQuestions({ ...actor, actorRole: 'student' }, {}, { limit: 10, offset: 0 }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.listSchoolQuestions(actor, { targetClassIds: [OTHER_CLASS] }, { limit: 10, offset: 0 }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.listSchoolQuestionFacets(actor, [OTHER_CLASS])).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.listSchoolQuestions(actor, {}, { limit: 51, offset: 0 }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    const revoked = new ContentQueryService(new InMemoryOrgContentRepository({ resources: [question('q_01')], teacherGrants: [{ ...grant, status: 'revoked' }] }));
    await expect(revoked.getSchoolQuestion(actor, 'q_01')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('reads bounded, indexed metadata pages from the document adapter', async () => {
    const resource = question('q_01');
    const database = new FakeDocumentDatabase({
      [ORG_CONTENT_COLLECTIONS.resources]: [document(resource.id, {
        type: 'exercise', title: resource.title, contentVersion: 1, status: resource.status,
        visibility: { type: 'classes', classIds: [CLASS] }, copyrightStatus: 'demo', grade: resource.grade,
        textbook: resource.textbook!, unit: resource.unit!, knowledgePoint: resource.knowledgePoint!,
        questionType: resource.questionType, difficulty: resource.difficulty!, stem: resource.stem,
        options: [...resource.options], correctAnswer: resource.correctAnswer, explanation: resource.explanation,
        payload: { questionIds: [resource.id], questionType: resource.questionType, stem: resource.stem, options: [...resource.options],
          correctAnswer: resource.correctAnswer, explanation: resource.explanation },
      }), document('q_invalid_snapshot', {
        type: 'exercise', title: '无效快照题目', contentVersion: 1, status: 'published',
        visibility: { type: 'classes', classIds: [CLASS] }, copyrightStatus: 'demo', grade: '三年级',
        textbook: '演示同步教材', questionType: 'single_choice', stem: '题干 A', options: ['A', 'B'],
        correctAnswer: 'A', explanation: '虚构解析', payload: { questionIds: ['q_invalid_snapshot'], questionType: 'single_choice', stem: '题干 B',
          options: ['A', 'B'], correctAnswer: 'A', explanation: '虚构解析' },
      })],
      [ORG_CONTENT_COLLECTIONS.teacherGrants]: [document(grant.id, {
        teacherId: TEACHER, classId: CLASS, permissions: ['content.read'], status: 'active',
        grantedBy: 'usr_admin_zhou', grantedAt: '2026-09-26T00:00:00+08:00',
      })],
    });
    const service = new ContentQueryService(createOrgContentDocumentRepository(database));
    await expect(service.listSchoolQuestions(actor, { grade: '三年级', textbook: '演示同步教材' }, { limit: 10, offset: 0 }))
      .resolves.toMatchObject({ items: [{ id: 'q_01', questionType: 'single_choice' }], nextOffset: null });
    await expect(service.getSchoolQuestion(actor, 'q_01')).resolves.toMatchObject({ stem: resource.stem, correctAnswer: '猫' });
    await expect(service.listSchoolQuestionFacets(actor)).resolves.toEqual([{
      grade: '三年级', textbook: '演示同步教材', unit: 'Unit 3', knowledgePoint: '动物词汇', questionType: 'single_choice', difficulty: '基础',
    }]);
  });
});

function document(id: string, fields: Record<string, VersionedDocument[string]>): VersionedDocument {
  return { _id: id, organizationId: ORG, schemaVersion: 1, version: 1, deletedAt: null, ...fields };
}
