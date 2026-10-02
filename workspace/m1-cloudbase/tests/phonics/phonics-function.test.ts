import { describe, expect, it, vi } from 'vitest';
import { createPhonicsCommandFunction, main as unconfiguredCommand } from '../../functions/phonics-command';
import { createPhonicsQueryFunction, main as unconfiguredQuery } from '../../functions/phonics-query';
import type { TrustedActorContext, TrustedActorResolver } from '../../src/auth/trusted-actor';
import type { CloudBaseRuntimePort } from '../../src/runtime/ports';
import { InMemoryPhonicsRepository } from '../../src/phonics/memory-repository';
import { PhonicsService } from '../../src/phonics/service';

const actor: TrustedActorContext = { requestId: 'request_phonics_function', sessionId: 'session_phonics_function',
  actorUserId: 'student_phonics', actorRole: 'student', organizationId: 'org_phonics',
  platformSubjectDigest: 'digest_phonics', permissions: [], scopeIds: ['student_phonics'], authzVersion: 1 };
const clock = { nowIso: () => '2026-09-27T09:00:00+08:00' };
const requestIds = { next: () => 'request_phonics_result' };
let sequence = 0;
function service() {
  return new PhonicsService(new InMemoryPhonicsRepository({
    memberships: [{ organizationId: 'org_phonics', studentId: 'student_phonics', classId: 'class_phonics', status: 'active' }],
    courses: [{ id: 'course_a', organizationId: 'org_phonics', title: '短元音 a', grade: '三年级',
      unit: 'Unit 1', contentVersion: 'demo-v1', status: 'published',
      visibility: { type: 'classes', classIds: ['class_phonics'] },
      phonemes: [{ id: 'phoneme_a', label: '/æ/', examples: ['cat'], audioFileId: 'cloud://demo/phonics/a.mp3' }],
      questions: [{ id: 'question_a', stem: '选出同音素的词', options: [
        { id: 'cat', text: 'cat' }, { id: 'sun', text: 'sun' }], correctOptionId: 'cat', explanation: 'cat 使用短元音。' }],
    }],
  }), clock, { next: prefix => `${prefix}_function_${++sequence}` },
  { async temporaryUrl() { return 'https://example.test/phonics/a.mp3'; } });
}
function boundary(functionName: CloudBaseRuntimePort['functionName'], current: TrustedActorContext) {
  const runtime: CloudBaseRuntimePort = { functionName,
    getPlatformSubject: vi.fn(async () => ({ subject: 'platform_subject', loginType: 'USERNAME' as const,
      isAuthenticated: true })), getBusinessSessionId: vi.fn(async () => 'trusted_session') };
  const actorResolver: TrustedActorResolver = { resolve: vi.fn(async () => current) };
  return { runtime, actorResolver, clock, requestIds };
}

describe('M2 trusted phonics functions', () => {
  it('returns safe course content and grades one answer under the trusted student', async () => {
    const handler = service();
    const query = createPhonicsQueryFunction({ ...boundary('phonics-query', actor), service: handler });
    const command = createPhonicsCommandFunction({ ...boundary('phonics-command', actor), service: handler });
    expect(await query({ apiVersion: 'm1.v1', action: 'listCourses', payload: {} }))
      .toMatchObject({ ok: true, data: [{ id: 'course_a' }] });
    const content = await query({ apiVersion: 'm1.v1', action: 'getCourse', payload: { courseId: 'course_a' } });
    expect(content).toMatchObject({ ok: true, data: { questions: [{ id: 'question_a' }] } });
    expect(JSON.stringify(content)).not.toContain('correctOptionId');
    expect(await command({ apiVersion: 'm1.v1', action: 'submitAnswer', payload: {
      courseId: 'course_a', questionId: 'question_a', selectedOptionId: 'sun', round: 1 },
    expectedVersion: 0, operationId: 'operation_phonics_function_answer' }))
      .toMatchObject({ ok: true, data: { firstAttempt: true, isCorrect: false } });
    expect(await query({ apiVersion: 'm1.v1', action: 'getState', payload: { courseId: 'course_a' } }))
      .toMatchObject({ ok: true, data: { score: 0, wrongQuestionIds: ['question_a'] } });
  });

  it('rejects answer keys, actor injection and teacher submissions', async () => {
    const command = createPhonicsCommandFunction({ ...boundary('phonics-command', actor), service: service() });
    expect(await command({ apiVersion: 'm1.v1', action: 'submitAnswer', payload: {
      courseId: 'course_a', questionId: 'question_a', selectedOptionId: 'cat', round: 1, isCorrect: true },
    expectedVersion: 0, operationId: 'operation_phonics_forged' }))
      .toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    const query = createPhonicsQueryFunction({ ...boundary('phonics-query', actor), service: service() });
    expect(await query({ apiVersion: 'm1.v1', action: 'getState', payload: {
      courseId: 'course_a', studentId: actor.actorUserId } }))
      .toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    const teacherCommand = createPhonicsCommandFunction({ ...boundary('phonics-command',
      { ...actor, actorRole: 'teacher' }), service: service() });
    expect(await teacherCommand({ apiVersion: 'm1.v1', action: 'submitAnswer', payload: {
      courseId: 'course_a', questionId: 'question_a', selectedOptionId: 'cat', round: 1 },
    expectedVersion: 0, operationId: 'operation_phonics_teacher' }))
      .toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });

  it('keeps unconfigured deployment mains fail closed', async () => {
    expect(await unconfiguredQuery({ apiVersion: 'm1.v1', action: 'listCourses', payload: {} }))
      .toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } });
    expect(await unconfiguredCommand({ apiVersion: 'm1.v1', action: 'submitAnswer', payload: {
      courseId: 'course_a', questionId: 'question_a', selectedOptionId: 'cat', round: 1 },
    expectedVersion: 0, operationId: 'operation_phonics_unconfigured' }))
      .toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } });
  });
});
