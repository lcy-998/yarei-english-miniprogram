import { describe, expect, it } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import type { VersionedDocument } from '../../src/repositories/document-database-port';
import { assignmentDocumentId } from '../../src/repositories/task-core-document-adapter';
import { DocumentVocabularyEvidenceRepository, VOCABULARY_EVIDENCE_COLLECTIONS } from '../../src/vocabulary-evidence/document-repository';
import { VocabularyEvidenceService } from '../../src/vocabulary-evidence/service';

const organizationId = 'org_word_document';
const classId = 'class_word_document';
const studentId = 'student_word_document';
const packId = 'pack_animals';
const taskId = 'task_words';
const itemId = 'item_words';
const actor: TrustedActorContext = { requestId: 'request_word', sessionId: 'session_word', actorUserId: studentId,
  actorRole: 'student', organizationId, platformSubjectDigest: 'digest_word', permissions: ['content.read'],
  scopeIds: [studentId], authzVersion: 1 };
let sequence = 0;
const ids = { next: (prefix: string) => `${prefix}_document_${++sequence}` };
const clock = { nowIso: () => '2026-09-27T09:00:00+08:00' };

function document(id: string, fields: Record<string, VersionedDocument[string]>): VersionedDocument {
  return { _id: id, organizationId, schemaVersion: 1, version: 1, deletedAt: null, ...fields };
}

function database(): FakeDocumentDatabase {
  const words = [{ id: 'word_tiger', word: 'tiger' }, { id: 'word_lion', word: 'lion' }];
  return new FakeDocumentDatabase({
    [VOCABULARY_EVIDENCE_COLLECTIONS.resources]: [document(packId, { type: 'vocabulary', status: 'published',
      contentVersion: 1, visibility: { type: 'classes', classIds: [classId] }, words })],
    [VOCABULARY_EVIDENCE_COLLECTIONS.memberships]: [document('membership_word', { studentId, classId, status: 'active' })],
    [VOCABULARY_EVIDENCE_COLLECTIONS.tasks]: [document(taskId, { id: taskId, status: 'active', visibility: 'visible',
      startsAt: '2026-09-27T08:00:00+08:00', dueAt: '2026-09-28T00:00:00+08:00',
      latePolicy: { allowLate: true, lateDays: 7 },
      items: [{ id: itemId, resourceId: packId, resourceVersion: 1,
        resourceSnapshot: { type: 'vocabulary', title: '动物单词', payload: { words } } }] })],
    [VOCABULARY_EVIDENCE_COLLECTIONS.assignments]: [document(assignmentDocumentId(organizationId, taskId, studentId), {
      id: `assignment_${taskId}_${studentId}`, taskId, studentId, classId, status: 'in_progress',
      redoDueAt: null, latestSubmissionVersion: 0,
    })],
  });
}

function service(documents: FakeDocumentDatabase): VocabularyEvidenceService {
  return new VocabularyEvidenceService(new DocumentVocabularyEvidenceRepository(documents), clock, ids);
}

describe('M2 vocabulary attempt document transactions', () => {
  it('grades against the saved word content and separates autonomous from task attempts', async () => {
    const documents = database();
    const first = await service(documents).submit(actor, { packId, wordId: 'word_tiger', studentInput: 'lion' },
      0, 'operation_autonomous_wrong');
    expect(first).toMatchObject({ firstAttempt: true, isCorrect: false, taskId: null });
    const taskFirst = await service(documents).submit(actor, { packId, wordId: 'word_tiger', taskId, itemId,
      studentInput: 'TIGER' }, 0, 'operation_task_right');
    expect(taskFirst).toMatchObject({ firstAttempt: true, isCorrect: true, taskId, round: 1 });
    expect(await service(documents).submit(actor, { packId, wordId: 'word_tiger', taskId, itemId,
      studentInput: 'TIGER' }, 0, 'operation_task_right')).toEqual(taskFirst);
    expect(documents.snapshot()[VOCABULARY_EVIDENCE_COLLECTIONS.attempts]).toHaveLength(2);
    expect(documents.snapshot()[VOCABULARY_EVIDENCE_COLLECTIONS.receipts]).toHaveLength(2);
    expect(await service(documents).getState(actor, { packId, wordId: 'word_tiger', taskId, itemId }))
      .toMatchObject({ firstCorrect: true, version: 1 });
    expect(await service(documents).getPackSummary(actor, { packId, taskId, itemId }))
      .toMatchObject({ words: [
        { wordId: 'word_tiger', firstCorrect: true, lastCorrect: true, version: 1 },
        { wordId: 'word_lion', firstCorrect: null, lastCorrect: null, version: 0 },
      ] });
  });

  it('rolls back the attempt if its receipt cannot be created', async () => {
    const documents = database();
    documents.failNext({ operation: 'create', collection: VOCABULARY_EVIDENCE_COLLECTIONS.receipts, kind: 'conflict' });
    await expect(service(documents).submit(actor, { packId, wordId: 'word_lion', studentInput: 'lion' },
      0, 'operation_receipt_rollback')).rejects.toThrow();
    expect(documents.snapshot()[VOCABULARY_EVIDENCE_COLLECTIONS.attempts] ?? []).toHaveLength(0);
  });

  it('keeps a published task snapshot usable after the original word pack is offline', async () => {
    const documents = database();
    const original = documents.snapshot()[VOCABULARY_EVIDENCE_COLLECTIONS.resources]?.[0];
    if (!original) throw new Error('word pack missing');
    await documents.runTransaction(transaction => transaction.replace(VOCABULARY_EVIDENCE_COLLECTIONS.resources, packId, 1,
      { ...original, status: 'offline', version: 2 }));
    await expect(service(documents).submit(actor, { packId, wordId: 'word_tiger', studentInput: 'tiger' },
      0, 'operation_offline_autonomous')).rejects.toMatchObject({ code: 'TASK_NOT_SUBMITTABLE' });
    expect(await service(documents).submit(actor, { packId, wordId: 'word_tiger', taskId, itemId, studentInput: 'tiger' },
      0, 'operation_offline_task')).toMatchObject({ firstAttempt: true, isCorrect: true });
  });

  it('uses the classroom task submission window before accepting spelling attempts', async () => {
    const documents = database();
    const original = documents.snapshot()[VOCABULARY_EVIDENCE_COLLECTIONS.tasks]?.[0];
    if (!original) throw new Error('task missing');
    await documents.runTransaction(transaction => transaction.replace(VOCABULARY_EVIDENCE_COLLECTIONS.tasks, taskId, 1,
      { ...original, version: 2, status: 'scheduled', startsAt: '2026-09-28T08:00:00+08:00',
        dueAt: '2026-09-29T00:00:00+08:00' }));
    await expect(service(documents).submit(actor, { packId, wordId: 'word_tiger', taskId, itemId,
      studentInput: 'tiger' }, 0, 'operation_before_task_start'))
      .rejects.toMatchObject({ code: 'TASK_NOT_SUBMITTABLE' });
    expect(documents.snapshot()[VOCABULARY_EVIDENCE_COLLECTIONS.attempts] ?? []).toHaveLength(0);
  });
});
