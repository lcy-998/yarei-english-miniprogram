import { describe, expect, it, vi } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { InMemoryPhonicsRepository } from '../../src/phonics/memory-repository';
import { PhonicsService } from '../../src/phonics/service';
import type { PhonicsCourse } from '../../src/phonics/types';

const actor: TrustedActorContext = { requestId: 'request_phonics', sessionId: 'session_phonics',
  actorUserId: 'student_demo', actorRole: 'student', organizationId: 'org_demo',
  platformSubjectDigest: 'digest_phonics', permissions: [], scopeIds: ['student_demo'], authzVersion: 1 };
const course: PhonicsCourse = { id: 'phonics_short_a', organizationId: 'org_demo', title: '短元音 a',
  grade: '三年级', unit: 'Unit 1', contentVersion: 'demo-v1', status: 'published',
  visibility: { type: 'classes', classIds: ['class_demo'] }, phonemes: [
    { id: 'phoneme_a', label: '/æ/', examples: ['cat', 'map'], audioFileId: 'cloud://demo/phonics/a.mp3' },
  ], questions: [
    { id: 'question_cat', stem: '选择与 cat 同音素的词', options: [
      { id: 'map', text: 'map' }, { id: 'sun', text: 'sun' }],
    correctOptionId: 'map', explanation: 'cat 和 map 使用相同的短元音。' },
    { id: 'question_bag', stem: '选择与 bag 同音素的词', options: [
      { id: 'hat', text: 'hat' }, { id: 'dog', text: 'dog' }],
    correctOptionId: 'hat', explanation: 'bag 和 hat 使用相同的短元音。' },
  ] };
let sequence = 0;
function fixture() {
  const repository = new InMemoryPhonicsRepository({
    memberships: [{ organizationId: 'org_demo', studentId: 'student_demo', classId: 'class_demo', status: 'active' },
      { organizationId: 'org_demo', studentId: 'other_student', classId: 'other_class', status: 'active' }],
    courses: [course, { ...course, id: 'phonics_other', visibility: { type: 'classes', classIds: ['other_class'] } }],
  });
  const service = new PhonicsService(repository, { nowIso: () => '2026-09-27T09:00:00+08:00' },
    { next: prefix => `${prefix}_demo_${++sequence}` },
    { async temporaryUrl() { return 'https://example.test/phonics/a.mp3'; } });
  return { repository, service };
}

describe('M2 phonics study and practice', () => {
  it('returns only authorized courses and omits answer keys until the student answers', async () => {
    const { service } = fixture();
    expect((await service.listCourses(actor)).map(item => item.id)).toEqual(['phonics_short_a']);
    const detail = await service.getCourse(actor, course.id);
    expect(detail.questions).toHaveLength(2);
    expect(JSON.stringify(detail)).not.toContain('correctOptionId');
    expect(await service.getAudio(actor, course.id, 'phoneme_a')).toMatchObject({
      temporaryUrl: 'https://example.test/phonics/a.mp3' });
    await expect(service.getCourse(actor, 'phonics_other')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.getCourse({ ...actor, actorRole: 'teacher' }, course.id))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('keeps first correctness stable while updating the wrong-question review state', async () => {
    const { repository, service } = fixture();
    const first = await service.submitAnswer(actor, { courseId: course.id, questionId: 'question_cat',
      selectedOptionId: 'sun', round: 1 }, 0, 'operation_phonics_first_wrong');
    expect(first).toMatchObject({ isCorrect: false, firstAttempt: true, correctOptionId: 'map' });
    expect(await service.submitAnswer(actor, { courseId: course.id, questionId: 'question_cat',
      selectedOptionId: 'sun', round: 1 }, 0, 'operation_phonics_first_wrong')).toEqual(first);
    expect(await service.getState(actor, course.id)).toMatchObject({ completedCount: 1,
      firstCorrectCount: 0, score: null, wrongQuestionIds: ['question_cat'] });
    await service.submitAnswer(actor, { courseId: course.id, questionId: 'question_cat',
      selectedOptionId: 'map', round: 1 }, 1, 'operation_phonics_corrected');
    await service.submitAnswer(actor, { courseId: course.id, questionId: 'question_bag',
      selectedOptionId: 'hat', round: 1 }, 0, 'operation_phonics_second_right');
    expect(await service.getState(actor, course.id)).toMatchObject({ completedCount: 2,
      firstCorrectCount: 1, score: 50, history: [{ round: 1, score: 50 }], wrongQuestionIds: [] });
    await service.submitAnswer(actor, { courseId: course.id, questionId: 'question_cat',
      selectedOptionId: 'map', round: 2 }, 0, 'operation_phonics_round_two_cat');
    await service.submitAnswer(actor, { courseId: course.id, questionId: 'question_bag',
      selectedOptionId: 'hat', round: 2 }, 0, 'operation_phonics_round_two_bag');
    expect(await service.getState(actor, course.id)).toMatchObject({ currentRound: 2, score: 100,
      history: [{ round: 1, score: 50 }, { round: 2, score: 100 }] });
    expect(repository.snapshot().answers).toHaveLength(5);
    await expect(service.submitAnswer(actor, { courseId: course.id, questionId: 'question_cat',
      selectedOptionId: 'map', round: 1 }, 0, 'operation_phonics_stale')).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects another student, forged options and rolls back a failed receipt', async () => {
    const { repository, service } = fixture();
    await expect(service.submitAnswer({ ...actor, actorUserId: 'other_student' }, {
      courseId: course.id, questionId: 'question_cat', selectedOptionId: 'map', round: 1 },
    0, 'operation_phonics_foreign')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.submitAnswer(actor, { courseId: course.id, questionId: 'question_cat',
      selectedOptionId: 'forged', round: 1 }, 0, 'operation_phonics_forged'))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    vi.spyOn(repository, 'saveReceipt').mockResolvedValueOnce(false);
    await expect(service.submitAnswer(actor, { courseId: course.id, questionId: 'question_cat',
      selectedOptionId: 'map', round: 1 }, 0, 'operation_phonics_receipt_failed'))
      .rejects.toMatchObject({ code: 'CONFLICT' });
    expect(repository.snapshot().answers).toHaveLength(0);
  });

  it('uses attempt numbers when storage returns question records out of order', async () => {
    const { repository, service } = fixture();
    await service.submitAnswer(actor, { courseId: course.id, questionId: 'question_cat',
      selectedOptionId: 'sun', round: 1 }, 0, 'operation_phonics_order_first');
    await service.submitAnswer(actor, { courseId: course.id, questionId: 'question_cat',
      selectedOptionId: 'map', round: 1 }, 1, 'operation_phonics_order_second');
    const snapshot = repository.snapshot();
    const unordered = new PhonicsService(new InMemoryPhonicsRepository({ ...snapshot,
      answers: [...snapshot.answers].reverse() }), { nowIso: () => '2026-09-27T09:01:00+08:00' },
    { next: prefix => `${prefix}_unordered_${++sequence}` });
    expect(await unordered.submitAnswer(actor, { courseId: course.id, questionId: 'question_cat',
      selectedOptionId: 'map', round: 1 }, 2, 'operation_phonics_order_third'))
      .toMatchObject({ attemptNumber: 3, firstAttempt: false });
  });
});
