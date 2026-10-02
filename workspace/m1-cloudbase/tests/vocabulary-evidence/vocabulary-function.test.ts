import { describe, expect, it, vi } from 'vitest';
import { createVocabularyEvidenceCommandFunction, main as unconfiguredCommand } from '../../functions/vocabulary-evidence-command';
import { createVocabularyEvidenceQueryFunction, main as unconfiguredQuery } from '../../functions/vocabulary-evidence-query';
import type { TrustedActorContext, TrustedActorResolver } from '../../src/auth/trusted-actor';
import type { CloudBaseRuntimePort } from '../../src/runtime/ports';
import { InMemoryVocabularyEvidenceRepository } from '../../src/vocabulary-evidence/memory-repository';
import { VocabularyEvidenceService } from '../../src/vocabulary-evidence/service';

const organizationId = 'org_word_function';
const studentId = 'student_word_function';
const actor: TrustedActorContext = { requestId: 'request_word', sessionId: 'session_word', actorUserId: studentId,
  actorRole: 'student', organizationId, platformSubjectDigest: 'digest_word', permissions: ['content.read'],
  scopeIds: [studentId], authzVersion: 1 };
const clock = { nowIso: () => '2026-09-27T09:00:00+08:00' };
const requestIds = { next: () => 'request_word_result' };
let sequence = 0;
const ids = { next: (prefix: string) => `${prefix}_function_${++sequence}` };

function service(): VocabularyEvidenceService {
  return new VocabularyEvidenceService(new InMemoryVocabularyEvidenceRepository({ autonomousScopes: [{
    organizationId, studentId, packId: 'pack_animals', contentVersion: 'demo-v1',
    words: [{ id: 'word_tiger', spelling: 'tiger' }], taskId: null, itemId: null, round: 0, status: 'available',
  }] }), clock, ids);
}

function boundary(functionName: CloudBaseRuntimePort['functionName'], current: TrustedActorContext) {
  const runtime: CloudBaseRuntimePort = { functionName,
    getPlatformSubject: vi.fn(async () => ({ subject: 'platform_subject', loginType: 'USERNAME' as const,
      isAuthenticated: true })), getBusinessSessionId: vi.fn(async () => 'trusted_session') };
  const actorResolver: TrustedActorResolver = { resolve: vi.fn(async () => current) };
  return { runtime, actorResolver, clock, requestIds };
}

describe('M2 trusted vocabulary attempt functions', () => {
  it('uses the trusted student to grade raw spelling and return immutable first-answer state', async () => {
    const handler = service();
    const command = createVocabularyEvidenceCommandFunction({ ...boundary('vocabulary-evidence-command', actor), service: handler });
    const query = createVocabularyEvidenceQueryFunction({ ...boundary('vocabulary-evidence-query', actor), service: handler });
    expect(await command({ apiVersion: 'm1.v1', action: 'submitWordAnswer', payload: {
      packId: 'pack_animals', wordId: 'word_tiger', studentInput: 'lion',
    }, operationId: 'operation_word_function_first', expectedVersion: 0 }))
      .toMatchObject({ ok: true, data: { isCorrect: false, firstAttempt: true } });
    expect(await query({ apiVersion: 'm1.v1', action: 'getWordAttemptState', payload: {
      packId: 'pack_animals', wordId: 'word_tiger',
    } })).toMatchObject({ ok: true, data: { firstCorrect: false, version: 1 } });
    expect(await query({ apiVersion: 'm1.v1', action: 'getPackAttemptSummary', payload: {
      packId: 'pack_animals',
    } })).toMatchObject({ ok: true, data: { words: [{ wordId: 'word_tiger', firstCorrect: false, version: 1 }] } });
    expect(await query({ apiVersion: 'm1.v1', action: 'getPackAttemptSummary', payload: {
      packId: 'pack_animals', studentId,
    } })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    const teacherCommand = createVocabularyEvidenceCommandFunction({
      ...boundary('vocabulary-evidence-command', { ...actor, actorRole: 'teacher' }), service: handler,
    });
    expect(await teacherCommand({ apiVersion: 'm1.v1', action: 'submitWordAnswer', payload: {
      packId: 'pack_animals', wordId: 'word_tiger', studentInput: 'tiger',
    }, operationId: 'operation_teacher_word', expectedVersion: 1 }))
      .toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });

  it('rejects identity injection, submitted correctness and incomplete task scope before service calls', async () => {
    const command = createVocabularyEvidenceCommandFunction({ ...boundary('vocabulary-evidence-command', actor), service: service() });
    expect(await command({ apiVersion: 'm1.v1', action: 'submitWordAnswer', payload: {
      packId: 'pack_animals', wordId: 'word_tiger', studentInput: 'tiger', isCorrect: true,
    }, operationId: 'operation_word_forged_score', expectedVersion: 0 }))
      .toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(await command({ apiVersion: 'm1.v1', action: 'submitWordAnswer', payload: {
      packId: 'pack_animals', wordId: 'word_tiger', studentInput: 'tiger', studentId: 'other_student',
    }, operationId: 'operation_word_forged_actor', expectedVersion: 0 }))
      .toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(await command({ apiVersion: 'm1.v1', action: 'submitWordAnswer', payload: {
      packId: 'pack_animals', wordId: 'word_tiger', studentInput: 'tiger', taskId: 'task_only',
    }, operationId: 'operation_word_missing_item', expectedVersion: 0 }))
      .toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
  });

  it('keeps production mains unconfigured and fail closed', async () => {
    expect(await unconfiguredCommand({ apiVersion: 'm1.v1', action: 'submitWordAnswer', payload: {
      packId: 'pack_animals', wordId: 'word_tiger', studentInput: 'tiger',
    }, operationId: 'operation_word_unconfigured', expectedVersion: 0 }))
      .toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } });
    expect(await unconfiguredQuery({ apiVersion: 'm1.v1', action: 'getWordAttemptState', payload: {
      packId: 'pack_animals', wordId: 'word_tiger',
    } })).toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } });
  });
});
