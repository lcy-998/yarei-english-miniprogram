import { describe, expect, it } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { LearningProgressService } from '../../src/learning-progress/service';
import type { LearningResourceAccessRecord } from '../../src/learning-progress/types';
import type { JsonValue } from '../../src/shared/protocol';
import type { VersionedDocument } from '../../src/repositories/document-database-port';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import {
  LEARNING_PROGRESS_COLLECTIONS,
  createLearningProgressDocumentRepository,
} from '../../src/repositories/learning-progress-document-adapter';

const ORGANIZATION_ID = 'org_demo';
const STUDENT_ID = 'student_xiaoyu';
const NOW = '2026-09-16T12:00:00.000+08:00';

const student: TrustedActorContext = {
  requestId: 'request_learning_progress',
  sessionId: 'session_student',
  actorUserId: STUDENT_ID,
  actorRole: 'student',
  organizationId: ORGANIZATION_ID,
  platformSubjectDigest: 'digest_student',
  permissions: ['content.read'],
  scopeIds: [STUDENT_ID],
  authzVersion: 1,
};

const readingResource: LearningResourceAccessRecord = {
  id: 'reading_zoo',
  organizationId: ORGANIZATION_ID,
  type: 'reading',
  status: 'published',
  contentVersion: 'demo-v1',
  allowedStudentIds: [STUDENT_ID],
  pages: [
    { id: 'page_1', chapterId: 'chapter_1', pageNumber: 1 },
    { id: 'page_2', chapterId: 'chapter_1', pageNumber: 2 },
  ],
  wordIds: [],
};

const vocabularyResource: LearningResourceAccessRecord = {
  id: 'vocabulary_animals',
  organizationId: ORGANIZATION_ID,
  type: 'vocabulary',
  status: 'published',
  allowedStudentIds: [STUDENT_ID],
  pages: [],
  wordIds: ['word_tiger', 'word_lion'],
};

describe('learning progress document repository', () => {
  it('uses legacy demo page references when the resource has no top-level pages projection', async () => {
    const legacy: VersionedDocument = {
      _id: 'res_reading_zoo_demo', organizationId: ORGANIZATION_ID, schemaVersion: 1, version: 1, deletedAt: null,
      type: 'reading', status: 'published', allowedStudentIds: [STUDENT_ID],
      payload: { demoOnly: true, pages: [{ id: 'page_legacy', chapterId: 'chapter_legacy', pageNumber: 1 }] },
    };
    const database = new FakeDocumentDatabase({ [LEARNING_PROGRESS_COLLECTIONS.resources]: [legacy] });
    const progress = service(database);
    await expect(progress.getReadingProgress(student, legacy._id)).resolves.toBeNull();
    await expect(progress.saveReadingProgress(student, {
      resourceId: legacy._id, chapterId: 'chapter_legacy', pageId: 'page_legacy', pageNumber: 1,
      favorite: false, expectedVersion: 0, operationId: 'legacy_reading_page',
    })).resolves.toMatchObject({ pageNumber: 1, resourceId: legacy._id });
  });

  it('persists reading and vocabulary progress across service instances', async () => {
    const database = seededDatabase();
    const first = service(database);
    const reading = await first.saveReadingProgress(student, {
      resourceId: readingResource.id,
      chapterId: 'chapter_1',
      pageId: 'page_2',
      pageNumber: 2,
      favorite: true,
      expectedVersion: 0,
      operationId: 'operation_reading_persisted',
    });
    const vocabulary = await first.saveVocabularyProgress({ ...student, requestId: 'request_learning_vocabulary' }, {
      packId: vocabularyResource.id,
      completedCount: 2,
      correctCount: 1,
      wrongWordIds: ['word_lion'],
      expectedVersion: 0,
      operationId: 'operation_vocabulary_persisted',
    });

    const second = service(database);
    await expect(second.getReadingProgress(student, readingResource.id)).resolves.toEqual(reading);
    await expect(second.getVocabularyProgress(student, vocabularyResource.id)).resolves.toEqual(vocabulary);
    expect(database.snapshot()[LEARNING_PROGRESS_COLLECTIONS.reading]).toHaveLength(1);
    expect(database.snapshot()[LEARNING_PROGRESS_COLLECTIONS.readingPageEvents]).toHaveLength(1);
    const storedEvents = await createLearningProgressDocumentRepository(database)
      .listReadingPageEvents(ORGANIZATION_ID, STUDENT_ID, readingResource.id);
    expect(storedEvents).toEqual([expect.objectContaining({ pageId: 'page_2', pageNumber: 2, progressVersion: 1,
      contentVersion: 'demo-v1' })]);
    expect(database.snapshot()[LEARNING_PROGRESS_COLLECTIONS.vocabulary]).toHaveLength(1);
    expect(database.snapshot()[LEARNING_PROGRESS_COLLECTIONS.idempotency]).toEqual([
      expect.objectContaining({
        functionName: 'learning-progress-command',
        action: 'saveReadingProgress',
        status: 'succeeded',
        actorUserId: STUDENT_ID,
      }),
      expect.objectContaining({
        functionName: 'learning-progress-command',
        action: 'saveVocabularyProgress',
        status: 'succeeded',
        actorUserId: STUDENT_ID,
      }),
    ]);
    expect(database.snapshot()[LEARNING_PROGRESS_COLLECTIONS.audit]).toHaveLength(2);
  });

  it('uses deterministic tuple keys and lets only one concurrent first write commit', async () => {
    const database = seededDatabase();
    const progress = service(database);
    const settled = await Promise.allSettled([
      progress.saveReadingProgress(student, {
        resourceId: readingResource.id,
        chapterId: 'chapter_1',
        pageId: 'page_1',
        pageNumber: 1,
        favorite: false,
        expectedVersion: 0,
        operationId: 'operation_concurrent_document_1',
      }),
      progress.saveReadingProgress({ ...student, requestId: 'request_learning_progress_2' }, {
        resourceId: readingResource.id,
        chapterId: 'chapter_1',
        pageId: 'page_2',
        pageNumber: 2,
        favorite: true,
        expectedVersion: 0,
        operationId: 'operation_concurrent_document_2',
      }),
    ]);

    expect(settled.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(settled.filter((item) => item.status === 'rejected')).toHaveLength(1);
    const rows = database.snapshot()[LEARNING_PROGRESS_COLLECTIONS.reading] ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.version).toBe(1);
    expect(database.snapshot()[LEARNING_PROGRESS_COLLECTIONS.readingPageEvents]).toHaveLength(1);
  });

  it('rolls back progress and idempotency when the success audit cannot append', async () => {
    const database = seededDatabase();
    database.failNext({
      operation: 'append',
      collection: LEARNING_PROGRESS_COLLECTIONS.audit,
      kind: 'unavailable',
    });

    await expect(service(database).saveReadingProgress(student, {
      resourceId: readingResource.id,
      chapterId: 'chapter_1',
      pageId: 'page_1',
      pageNumber: 1,
      favorite: false,
      expectedVersion: 0,
      operationId: 'operation_rollback_document',
    })).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });

    const snapshot = database.snapshot();
    expect(snapshot[LEARNING_PROGRESS_COLLECTIONS.reading] ?? []).toHaveLength(0);
    expect(snapshot[LEARNING_PROGRESS_COLLECTIONS.readingPageEvents] ?? []).toHaveLength(0);
    expect(snapshot[LEARNING_PROGRESS_COLLECTIONS.idempotency] ?? []).toHaveLength(0);
    expect(snapshot[LEARNING_PROGRESS_COLLECTIONS.audit]).toEqual([
      expect.objectContaining({ result: 'denied', errorCode: 'SERVICE_UNAVAILABLE' }),
    ]);
  });

  it('rolls back progress if its append-only page visit cannot be written', async () => {
    const database = seededDatabase();
    database.failNext({ operation: 'create', collection: LEARNING_PROGRESS_COLLECTIONS.readingPageEvents, kind: 'conflict' });
    await expect(service(database).saveReadingProgress(student, {
      resourceId: readingResource.id, chapterId: 'chapter_1', pageId: 'page_1', pageNumber: 1,
      favorite: false, expectedVersion: 0, operationId: 'operation_page_event_rollback',
    })).rejects.toThrow();
    expect(database.snapshot()[LEARNING_PROGRESS_COLLECTIONS.reading] ?? []).toHaveLength(0);
    expect(database.snapshot()[LEARNING_PROGRESS_COLLECTIONS.readingPageEvents] ?? []).toHaveLength(0);
    expect(database.snapshot()[LEARNING_PROGRESS_COLLECTIONS.idempotency] ?? []).toHaveLength(0);
  });

  it('maps unavailable reads safely and returns deep copies', async () => {
    const database = seededDatabase();
    const repository = createLearningProgressDocumentRepository(database);
    const first = await repository.findResource(ORGANIZATION_ID, readingResource.id);
    if (first === null) throw new Error('resource fixture expected');
    (first.allowedStudentIds as string[]).push('student_mutated');
    (first.pages[0] as { pageNumber: number }).pageNumber = 99;
    await expect(repository.findResource(ORGANIZATION_ID, readingResource.id)).resolves.toEqual(readingResource);

    database.failNext({ operation: 'get', collection: LEARNING_PROGRESS_COLLECTIONS.resources, kind: 'unavailable' });
    await expect(repository.findResource(ORGANIZATION_ID, readingResource.id))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });

  it('replays a committed operation without applying CAS a second time', async () => {
    const database = seededDatabase();
    const input = {
      packId: vocabularyResource.id,
      completedCount: 2,
      correctCount: 2,
      wrongWordIds: [] as readonly string[],
      expectedVersion: 0,
      operationId: 'operation_document_replay',
    };
    const first = await service(database).saveVocabularyProgress(student, input);
    const replayed = await service(database).saveVocabularyProgress(student, input);
    expect(replayed).toEqual(first);
    expect(database.snapshot()[LEARNING_PROGRESS_COLLECTIONS.vocabulary]).toHaveLength(1);
    expect(database.snapshot()[LEARNING_PROGRESS_COLLECTIONS.audit]).toHaveLength(1);
  });
});

function service(database: FakeDocumentDatabase): LearningProgressService {
  let sequence = 0;
  return new LearningProgressService(
    createLearningProgressDocumentRepository(database),
    { nowIso: () => NOW },
    { next: (prefix) => `${prefix}_${++sequence}_${Math.random().toString(36).slice(2, 8)}` },
  );
}

function seededDatabase(): FakeDocumentDatabase {
  return new FakeDocumentDatabase({
    [LEARNING_PROGRESS_COLLECTIONS.resources]: [
      resourceDocument(readingResource),
      resourceDocument(vocabularyResource),
    ],
  });
}

function resourceDocument(resource: LearningResourceAccessRecord): VersionedDocument {
  return {
    ...(resource as unknown as Record<string, JsonValue>),
    _id: resource.id,
    organizationId: resource.organizationId,
    schemaVersion: 1,
    version: 1,
    deletedAt: null,
  };
}
