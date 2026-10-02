import { describe, expect, it } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import type { VersionedDocument } from '../../src/repositories/document-database-port';
import { DocumentPhonicsRepository, PHONICS_COLLECTIONS } from '../../src/phonics/document-repository';
import { PhonicsService } from '../../src/phonics/service';

const organizationId = 'org_phonics_document';
const studentId = 'student_phonics_document';
const classId = 'class_phonics_document';
const actor: TrustedActorContext = { requestId: 'request_phonics_document', sessionId: 'session_phonics_document',
  actorUserId: studentId, actorRole: 'student', organizationId,
  platformSubjectDigest: 'digest_phonics_document', permissions: [], scopeIds: [studentId], authzVersion: 1 };
function document(id: string, fields: Record<string, VersionedDocument[string]>): VersionedDocument {
  return { _id: id, organizationId, schemaVersion: 1, version: 1, deletedAt: null, ...fields };
}
function database(): FakeDocumentDatabase {
  return new FakeDocumentDatabase({
    [PHONICS_COLLECTIONS.users]: [document(studentId, { id: studentId, status: 'active' })],
    [PHONICS_COLLECTIONS.classes]: [document(classId, { id: classId, status: 'active' })],
    [PHONICS_COLLECTIONS.memberships]: [document('membership_phonics', { studentId, classId, status: 'active' })],
    [PHONICS_COLLECTIONS.courses]: [document('course_short_a', {
      id: 'course_short_a', title: '短元音 a', grade: '三年级', unit: 'Unit 1',
      contentVersion: 'demo-v1', status: 'published', visibility: { type: 'classes', classIds: [classId] },
      phonemes: [{ id: 'phoneme_a', label: '/æ/', examples: ['cat', 'map'], audioFileId: null }],
      questions: [{ id: 'question_cat', stem: '选择与 cat 同音素的词', options: [
        { id: 'map', text: 'map' }, { id: 'sun', text: 'sun' }], correctOptionId: 'map',
      explanation: 'cat 与 map 使用相同的短元音。' }],
    })],
  });
}
let sequence = 0;
function service(documents: FakeDocumentDatabase) {
  return new PhonicsService(new DocumentPhonicsRepository(documents),
    { nowIso: () => '2026-09-27T09:00:00+08:00' },
    { next: prefix => `${prefix}_document_${++sequence}` });
}

describe('M2 phonics document boundary', () => {
  it('stores only the current student answer and reuses the receipt on retry', async () => {
    const documents = database();
    const practice = service(documents);
    expect(await practice.listCourses(actor)).toMatchObject([{ id: 'course_short_a' }]);
    const result = await practice.submitAnswer(actor, { courseId: 'course_short_a', questionId: 'question_cat',
      selectedOptionId: 'sun', round: 1 }, 0, 'operation_phonics_document_first');
    expect(result).toMatchObject({ isCorrect: false, firstAttempt: true, correctOptionId: 'map' });
    expect(await practice.submitAnswer(actor, { courseId: 'course_short_a', questionId: 'question_cat',
      selectedOptionId: 'sun', round: 1 }, 0, 'operation_phonics_document_first')).toEqual(result);
    expect(await practice.getState(actor, 'course_short_a')).toMatchObject({ completedCount: 1,
      firstCorrectCount: 0, score: 0, wrongQuestionIds: ['question_cat'] });
    expect(documents.snapshot()[PHONICS_COLLECTIONS.answers]).toHaveLength(1);
    expect(documents.snapshot()[PHONICS_COLLECTIONS.receipts]).toHaveLength(1);
    await expect(practice.getState({ ...actor, actorUserId: 'other_student' }, 'course_short_a'))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rolls the answer back when the operation receipt fails', async () => {
    const documents = database();
    documents.failNext({ operation: 'create', collection: PHONICS_COLLECTIONS.receipts, kind: 'conflict' });
    await expect(service(documents).submitAnswer(actor, { courseId: 'course_short_a',
      questionId: 'question_cat', selectedOptionId: 'map', round: 1 }, 0, 'operation_phonics_document_failed'))
      .rejects.toThrow();
    expect(documents.snapshot()[PHONICS_COLLECTIONS.answers] ?? []).toHaveLength(0);
  });
});
