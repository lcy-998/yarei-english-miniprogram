import { describe, expect, it, vi } from 'vitest';
import { createLearningProgressCommandFunction } from '../../functions/learning-progress-command';
import { createLearningProgressQueryFunction } from '../../functions/learning-progress-query';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { InMemoryLearningProgressRepository } from '../../src/learning-progress/memory-repository';
import { LearningProgressService } from '../../src/learning-progress/service';
import type { LearningResourceAccessRecord } from '../../src/learning-progress/types';

const NOW = '2026-09-16T08:00:00.000Z';
const student: TrustedActorContext = {
  requestId: 'req_student', sessionId: 'session_student', actorUserId: 'student_xiaoyu', actorRole: 'student',
  organizationId: 'org_demo', platformSubjectDigest: 'digest_student', permissions: ['content.read'],
  scopeIds: ['student_xiaoyu'], authzVersion: 1,
};
const teacher: TrustedActorContext = { ...student, actorUserId: 'teacher_lin', actorRole: 'teacher' };

const resources: LearningResourceAccessRecord[] = [
  {
    id: 'read_zoo', organizationId: 'org_demo', type: 'reading', status: 'published',
    allowedStudentIds: ['student_xiaoyu'],
    pages: [
      { id: 'page_1', chapterId: 'chapter_1', pageNumber: 1 },
      { id: 'page_2', chapterId: 'chapter_1', pageNumber: 2 },
    ],
    wordIds: [],
  },
  {
    id: 'vocab_animals', organizationId: 'org_demo', type: 'vocabulary', status: 'published',
    allowedStudentIds: ['student_xiaoyu'], pages: [], wordIds: ['word_tiger', 'word_giraffe', 'word_lion'],
  },
];

function fixture() {
  const repository = new InMemoryLearningProgressRepository({ resources });
  let sequence = 0;
  const service = new LearningProgressService(repository, { nowIso: () => NOW }, { next: prefix => `${prefix}_${++sequence}` });
  return { repository, service };
}

function boundary(functionName: 'learning-progress-query' | 'learning-progress-command', actor: TrustedActorContext) {
  let sequence = 0;
  return {
    runtime: {
      functionName,
      getPlatformSubject: vi.fn(async () => ({ subject: 'subject', loginType: 'USERNAME' as const, isAuthenticated: true })),
      getBusinessSessionId: vi.fn(async () => 'session_student'),
    },
    actorResolver: { resolve: vi.fn(async () => actor) },
    clock: { nowIso: () => NOW },
    requestIds: { next: () => `req_${++sequence}` },
  };
}

describe('M1 learning progress persistence', () => {
  it('persists reading location and favorite for the trusted student only', async () => {
    const { repository, service } = fixture();
    expect(await service.getReadingProgress(student, 'read_zoo')).toBeNull();
    const saved = await service.saveReadingProgress(student, {
      resourceId: 'read_zoo', chapterId: 'chapter_1', pageId: 'page_2', pageNumber: 2,
      favorite: true, expectedVersion: 0, operationId: 'operation_reading_0001',
    });
    expect(saved).toMatchObject({ resourceId: 'read_zoo', chapterId: 'chapter_1', pageId: 'page_2', pageNumber: 2, favorite: true, version: 1 });
    expect(await service.getReadingProgress(student, 'read_zoo')).toEqual(saved);
    await expect(service.getReadingProgress(teacher, 'read_zoo')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(repository.debugSnapshot().audits).toEqual([
      expect.objectContaining({ action: 'reading_progress.saved', actorUserId: 'student_xiaoyu', result: 'succeeded' }),
    ]);
  });

  it('uses operation idempotency before CAS and records denied version conflicts', async () => {
    const { repository, service } = fixture();
    const input = {
      resourceId: 'read_zoo', chapterId: 'chapter_1', pageId: 'page_1', pageNumber: 1,
      favorite: false, expectedVersion: 0, operationId: 'operation_reading_0002',
    } as const;
    const first = await service.saveReadingProgress(student, input);
    expect(await service.saveReadingProgress(student, input)).toEqual(first);
    expect(repository.debugSnapshot().readingProgress).toHaveLength(1);
    expect(repository.debugSnapshot().audits.filter(item => item.result === 'succeeded')).toHaveLength(1);

    await expect(service.saveReadingProgress(student, { ...input, operationId: 'operation_reading_0003', favorite: true }))
      .rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(service.saveReadingProgress(student, { ...input, pageId: 'page_2' }))
      .rejects.toMatchObject({ code: 'CONFLICT' });
    expect(repository.debugSnapshot().audits.filter(item => item.result === 'denied')).toHaveLength(2);
  });

  it('serializes concurrent first writes so only one CAS update commits', async () => {
    const { repository, service } = fixture();
    const results = await Promise.allSettled([
      service.saveReadingProgress(student, {
        resourceId: 'read_zoo', chapterId: 'chapter_1', pageId: 'page_1', pageNumber: 1,
        favorite: false, expectedVersion: 0, operationId: 'operation_concurrent_0001',
      }),
      service.saveReadingProgress(student, {
        resourceId: 'read_zoo', chapterId: 'chapter_1', pageId: 'page_2', pageNumber: 2,
        favorite: true, expectedVersion: 0, operationId: 'operation_concurrent_0002',
      }),
    ]);
    expect(results.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(item => item.status === 'rejected')).toHaveLength(1);
    expect(repository.debugSnapshot().readingProgress).toHaveLength(1);
    expect(repository.debugSnapshot().readingProgress[0]?.version).toBe(1);
  });

  it('stores vocabulary completion, calculated accuracy and validated wrong words', async () => {
    const { service } = fixture();
    const saved = await service.saveVocabularyProgress(student, {
      packId: 'vocab_animals', completedCount: 3, correctCount: 2, wrongWordIds: ['word_giraffe'],
      expectedVersion: 0, operationId: 'operation_vocabulary_0001',
    });
    expect(saved).toMatchObject({ packId: 'vocab_animals', completedCount: 3, correctRate: 66.67, wrongWordIds: ['word_giraffe'], version: 1 });
    await expect(service.saveVocabularyProgress(student, {
      packId: 'vocab_animals', completedCount: 2, correctCount: 2, wrongWordIds: ['word_unknown'],
      expectedVersion: 1, operationId: 'operation_vocabulary_0002',
    })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects mismatched reading chapter or page number instead of accepting a flat page id', async () => {
    const { service } = fixture();
    await expect(service.saveReadingProgress(student, {
      resourceId: 'read_zoo', chapterId: 'chapter_other', pageId: 'page_2', pageNumber: 2,
      favorite: false, expectedVersion: 0, operationId: 'operation_bad_chapter_0001',
    })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(service.saveReadingProgress(student, {
      resourceId: 'read_zoo', chapterId: 'chapter_1', pageId: 'page_2', pageNumber: 1,
      favorite: false, expectedVersion: 0, operationId: 'operation_bad_page_number_0001',
    })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('validates direct service count, version and operation boundaries', async () => {
    const { service } = fixture();
    await expect(service.saveVocabularyProgress(student, {
      packId: 'vocab_animals', completedCount: -1, correctCount: 0, wrongWordIds: [],
      expectedVersion: 0, operationId: 'operation_negative_count_0001',
    })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(service.saveVocabularyProgress(student, {
      packId: 'vocab_animals', completedCount: 1, correctCount: 0, wrongWordIds: ['word_tiger', 'word_lion'],
      expectedVersion: 0, operationId: 'operation_too_many_wrong_0001',
    })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(service.saveVocabularyProgress(student, {
      packId: 'vocab_animals', completedCount: 0, correctCount: 0, wrongWordIds: [],
      expectedVersion: -1, operationId: 'operation_bad_version_0001',
    })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(service.saveVocabularyProgress(student, {
      packId: 'vocab_animals', completedCount: 0, correctCount: 0, wrongWordIds: [],
      expectedVersion: 0, operationId: ' ',
    })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('strict entries reject forged identity and map query/command without client user ids', async () => {
    const { service } = fixture();
    const query = createLearningProgressQueryFunction({ ...boundary('learning-progress-query', student), handler: service });
    const command = createLearningProgressCommandFunction({ ...boundary('learning-progress-command', student), handler: service });
    expect(await query({ apiVersion: 'm1.v1', action: 'getReadingProgress', payload: { resourceId: 'read_zoo' } })).toMatchObject({ ok: true, data: null });
    expect(await query({ apiVersion: 'm1.v1', action: 'getReadingProgress', payload: { resourceId: 'read_zoo', actorUserId: 'forged' } }))
      .toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR', fieldErrors: { actorUserId: expect.any(String) } } });
    expect(await command({
      apiVersion: 'm1.v1', action: 'saveVocabularyProgress',
      payload: { packId: 'vocab_animals', completedCount: 1, correctCount: 1, wrongWordIds: [] },
      operationId: 'operation_entry_0001',
    })).toMatchObject({ ok: true, data: { version: 1, correctRate: 100 } });
  });
});
