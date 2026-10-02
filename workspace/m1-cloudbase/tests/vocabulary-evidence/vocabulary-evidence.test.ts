import { describe, expect, it, vi } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { InMemoryVocabularyEvidenceRepository } from '../../src/vocabulary-evidence/memory-repository';
import { VocabularyEvidenceService } from '../../src/vocabulary-evidence/service';
import type { VocabularyEvidenceScope } from '../../src/vocabulary-evidence/types';

const organizationId = 'org_vocabulary_demo';
const studentId = 'student_xiaoyu_demo';
const actor: TrustedActorContext = { requestId: 'request_word', sessionId: 'session_word', actorUserId: studentId,
  actorRole: 'student', organizationId, platformSubjectDigest: 'digest_word', permissions: ['content.read'],
  scopeIds: [studentId], authzVersion: 1 };
const words = [{ id: 'word_tiger', spelling: 'tiger' }, { id: 'word_lion', spelling: 'lion' }];
const autonomous: VocabularyEvidenceScope = { organizationId, studentId, packId: 'pack_animals',
  contentVersion: 'demo-v1', words, taskId: null, itemId: null, round: 0, status: 'available' };
const taskScope: VocabularyEvidenceScope = { ...autonomous, taskId: 'task_animals', itemId: 'item_words', round: 1 };
const clock = { nowIso: () => '2026-09-27T09:00:00+08:00' };
let sequence = 0;
const ids = { next: (prefix: string) => `${prefix}_demo_${++sequence}` };

function fixture() {
  const repository = new InMemoryVocabularyEvidenceRepository({ autonomousScopes: [autonomous], taskScopes: [taskScope] });
  return { repository, service: new VocabularyEvidenceService(repository, clock, ids) };
}

describe('M2 server-graded first word answer', () => {
  it('keeps the first task spelling result immutable across retries and later correction', async () => {
    const { repository, service } = fixture();
    const input = { packId: 'pack_animals', wordId: 'word_tiger', taskId: 'task_animals',
      itemId: 'item_words', studentInput: 'lion' };
    const first = await service.submit(actor, input, 0, 'operation_word_first_wrong');
    expect(first).toMatchObject({ isCorrect: false, firstAttempt: true, attemptNumber: 1, studentInput: 'lion' });
    expect(await service.submit(actor, input, 0, 'operation_word_first_wrong')).toEqual(first);
    const corrected = await service.submit(actor, { ...input, studentInput: ' TIGER ' }, 1, 'operation_word_corrected');
    expect(corrected).toMatchObject({ isCorrect: true, firstAttempt: false, attemptNumber: 2, studentInput: 'TIGER' });
    expect(await service.getState(actor, { packId: input.packId, wordId: input.wordId,
      taskId: input.taskId, itemId: input.itemId })).toMatchObject({ firstCorrect: false, version: 2 });
    expect(await service.getPackSummary(actor, { packId: input.packId, taskId: input.taskId, itemId: input.itemId }))
      .toMatchObject({ packId: input.packId, round: 1, words: [
        { wordId: 'word_tiger', firstCorrect: false, lastCorrect: true, version: 2 },
        { wordId: 'word_lion', firstCorrect: null, lastCorrect: null, version: 0 },
      ] });
    expect(repository.snapshot().attempts).toHaveLength(2);
    await expect(service.submit(actor, { ...input, studentInput: 'tiger' }, 0, 'operation_word_stale'))
      .rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(service.submit(actor, { ...input, studentInput: 'tiger' }, 0, 'operation_word_first_wrong'))
      .rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('separates autonomous progress and redo rounds from the task first result', async () => {
    const { repository, service } = fixture();
    await service.submit(actor, { packId: 'pack_animals', wordId: 'word_tiger', taskId: 'task_animals',
      itemId: 'item_words', studentInput: 'lion' }, 0, 'operation_task_wrong');
    expect(await service.submit(actor, { packId: 'pack_animals', wordId: 'word_tiger', studentInput: 'tiger' },
      0, 'operation_autonomous_right')).toMatchObject({ isCorrect: true, firstAttempt: true });
    const redo = new InMemoryVocabularyEvidenceRepository({ ...repository.snapshot(),
      taskScopes: [{ ...taskScope, round: 2 }] });
    const redoService = new VocabularyEvidenceService(redo, clock, ids);
    expect(await redoService.submit(actor, { packId: 'pack_animals', wordId: 'word_tiger', taskId: 'task_animals',
      itemId: 'item_words', studentInput: 'tiger' }, 0, 'operation_redo_first'))
      .toMatchObject({ round: 2, firstAttempt: true, isCorrect: true });
  });

  it('rejects foreign users, forged words and locked task scopes', async () => {
    const { repository, service } = fixture();
    await expect(service.submit({ ...actor, actorUserId: 'student_other' }, { packId: 'pack_animals',
      wordId: 'word_tiger', studentInput: 'tiger' }, 0, 'operation_foreign_student'))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.getPackSummary({ ...actor, actorUserId: 'student_other' }, { packId: 'pack_animals' }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.submit(actor, { packId: 'pack_animals', wordId: 'word_missing', studentInput: 'tiger' },
      0, 'operation_forged_word')).rejects.toMatchObject({ code: 'RESOURCE_OFFLINE' });
    const locked = new VocabularyEvidenceService(new InMemoryVocabularyEvidenceRepository({ ...repository.snapshot(),
      taskScopes: [{ ...taskScope, status: 'locked' }] }), clock, ids);
    await expect(locked.submit(actor, { packId: 'pack_animals', wordId: 'word_tiger', taskId: 'task_animals',
      itemId: 'item_words', studentInput: 'tiger' }, 0, 'operation_locked_task'))
      .rejects.toMatchObject({ code: 'TASK_NOT_SUBMITTABLE' });
  });

  it('rolls back the attempt if the idempotency receipt fails', async () => {
    const { repository, service } = fixture();
    vi.spyOn(repository, 'saveReceipt').mockResolvedValueOnce(false);
    await expect(service.submit(actor, { packId: 'pack_animals', wordId: 'word_tiger', studentInput: 'tiger' },
      0, 'operation_word_receipt_failed')).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(repository.snapshot().attempts).toHaveLength(0);
  });
});
