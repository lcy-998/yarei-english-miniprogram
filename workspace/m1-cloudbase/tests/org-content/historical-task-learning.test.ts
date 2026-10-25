import { describe, expect, it } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import { HistoricalTaskLearningService } from '../../src/org-content/historical-task-learning-service';
import { createLearningProgressDocumentRepository } from '../../src/repositories/learning-progress-document-adapter';
import { LearningProgressService } from '../../src/learning-progress/service';
import { validateContentQueryRequest } from '../../src/contracts/org-content-functions';

const base = { organizationId: 'org_two', schemaVersion: 1 as const, version: 1, deletedAt: null };
const actor: TrustedActorContext = { requestId: 'req_student', sessionId: 'ses_student',
  actorUserId: 'student_two', actorRole: 'student', organizationId: 'org_two',
  platformSubjectDigest: 'digest_student', permissions: ['content.read'],
  scopeIds: ['class_two'], authzVersion: 1 };
const payload = {
  category: 'picture_book', grade: '三年级', difficulty: '基础',
  chapters: [{ id: 'chapter_one', title: 'Old chapter', order: 1,
    pages: [{ id: 'page_one', pageNumber: 1, order: 1,
      imageAssetKey: 'cloud://old/page.jpg', thumbnailAssetKey: 'cloud://old/thumb.jpg',
      width: 100, height: 100, assetVersion: 'v1' }] }],
  readingAudio: { reviewStatus: 'approved', sourceVersion: '1.1',
    approvedBy: 'review_demo', approvedAt: '2026-10-06T12:00:00+08:00',
    chapters: [{ chapterId: 'chapter_one', audioAssetKey: 'cloud://old/audio.mp3',
      durationMs: 2000, segments: [{ id: 'segment_one', pageId: 'page_one',
        pageNumber: 1, text: 'Hello.', rect: { x: 0.1, y: 0.1, width: 0.5, height: 0.2 },
        startMs: 0, endMs: 1000 }] }] },
  assetLibrary: { kind: 'central_asset_library', resourceId: 'public_reading_projection',
    sourcePublicId: 'public_reading_source', reviewStatus: 'approved',
    catalogScope: 'all_teachers' },
};
function fixture(taskState: 'active' | 'recycled' = 'active') {
  const database = new FakeDocumentDatabase({
    learning_resources: [{ _id: 'public_reading_projection', ...base,
      type: 'reading', status: 'offline', publicLearningProjection: true,
      title: 'Current edited title', contentVersion: '2.0',
      visibility: { type: 'organization' }, payload: {
        ...payload, chapters: [{ ...payload.chapters[0], title: 'New current chapter' }],
      } }],
    tasks: [{ _id: 'task_one', ...base, status: 'completed',
      visibility: taskState === 'recycled' ? 'recycled' : 'visible',
      publishedAt: '2026-10-06T12:00:00+08:00',
      items: [{ id: 'item_one', resourceId: 'public_reading_projection',
        resourceVersion: '1.1', snapshotSchemaVersion: 2,
        resourceSnapshot: { title: 'Old frozen title', type: 'reading', payload } }] }],
    task_assignments: [{ _id: 'assignment_one', ...base, taskId: 'task_one',
      studentId: 'student_two', classId: 'class_two', status: 'completed',
      latestSubmissionId: taskState === 'recycled' ? 'submission_one' : null }],
    submissions: taskState === 'recycled' ? [{ _id: 'submission_one', ...base,
      taskId: 'task_one', studentId: 'student_two', assignmentId: 'assignment_one',
      submissionVersion: 1, status: 'submitted',
      resourceSnapshots: [{ itemId: 'item_one', resourceVersion: '1.1' }] }] : [],
  });
  const service = new HistoricalTaskLearningService(database, {
    getTempFileURL: async ({ fileList }) => ({ fileList: fileList.map(item => ({
      fileID: item.fileID, tempFileURL: `https://example.invalid/${encodeURIComponent(item.fileID)}`,
      code: 'SUCCESS',
    })) }),
  }, { nowIso: () => '2026-10-06T12:10:00+08:00' });
  return { database, service };
}
describe('historical task learning snapshot', () => {
  it('serves the assigned old page/audio rather than the current source', async () => {
    const { service } = fixture();
    const result = await service.get(actor, 'task_one', 'item_one');
    expect(result.reading).toMatchObject({ title: 'Old frozen title',
      chapters: [{ title: 'Old chapter' }] });
    expect(result.audioMaps).toMatchObject([{ chapterId: 'chapter_one',
      playback: { temporaryUrl: expect.stringContaining('https://') } }]);
    expect(JSON.stringify(result)).not.toContain('cloud://');
    await expect(service.get({ ...actor, actorUserId: 'student_other' }, 'task_one', 'item_one'))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.get(actor, 'task_one', 'item_other'))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('serves a directly assigned reading snapshot while withholding unapproved audio', async () => {
    const directReading = { ...payload, readingAudio: { ...payload.readingAudio,
      reviewStatus: 'needs_review' }, acceptanceStatus: 'pending_user_acceptance', testOnly: true };
    const database = new FakeDocumentDatabase({
      tasks: [{ _id: 'task_one', ...base, status: 'active', visibility: 'visible',
        publishedAt: '2026-10-06T12:00:00+08:00',
        items: [{ id: 'item_one', resourceId: 'private_reading', resourceVersion: '1.1',
          snapshotSchemaVersion: 2, resourceSnapshot: { title: 'Feelings', type: 'reading',
            payload: { ...directReading, assetLibrary: undefined } } }] }],
      task_assignments: [{ _id: 'assignment_one', ...base, taskId: 'task_one',
        studentId: 'student_two', classId: 'class_two', status: 'active', latestSubmissionId: null }],
    });
    const service = new HistoricalTaskLearningService(database, {
      getTempFileURL: async ({ fileList }) => ({ fileList: fileList.map(item => ({
        fileID: item.fileID, tempFileURL: `https://example.invalid/${encodeURIComponent(item.fileID)}`,
        code: 'SUCCESS',
      })) }),
    }, { nowIso: () => '2026-10-06T12:10:00+08:00' });

    const result = await service.get(actor, 'task_one', 'item_one');
    expect(result.reading).toMatchObject({ title: 'Feelings',
      chapters: [{ pages: [{ id: 'page_one', imageAssetKey: expect.stringContaining('https://') }] }] });
    expect(result.audioMaps).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('cloud://');
  });

  it('keeps a submitted recycled task readable and permits its frozen-page progress', async () => {
    const { database, service } = fixture('recycled');
    expect(await service.get(actor, 'task_one', 'item_one')).toMatchObject({
      contentVersion: '1.1', reading: { title: 'Old frozen title' } });
    expect((await database.get('submissions', 'submission_one'))?.resourceSnapshots)
      .toEqual([{ itemId: 'item_one', resourceVersion: '1.1' }]);
    const repository = createLearningProgressDocumentRepository(database);
    const progress = new LearningProgressService(repository,
      { nowIso: () => '2026-10-06T12:11:00+08:00' },
      { next: () => 'reading_event_one' });
    expect(await progress.saveReadingProgress(actor, {
      resourceId: 'public_reading_projection', chapterId: 'chapter_one',
      pageId: 'page_one', pageNumber: 1, favorite: false,
      expectedVersion: 0, operationId: 'historical_reading_page_one',
    })).toMatchObject({ resourceId: 'public_reading_projection', pageNumber: 1 });
    expect(database.snapshot().reading_page_events).toMatchObject([{
      contentVersion: '1.1', pageId: 'page_one' }]);
  });

  it('accepts only task and item IDs, never client supplied resource versions or file IDs', () => {
    expect(validateContentQueryRequest({ apiVersion: 'm1.v1', action: 'getHistoricalTaskLearning',
      payload: { taskId: 'task_one', itemId: 'item_one' } })).toMatchObject({ ok: true });
    expect(validateContentQueryRequest({ apiVersion: 'm1.v1', action: 'getHistoricalTaskLearning',
      payload: { taskId: 'task_one', itemId: 'item_one', fileId: 'cloud://forged' } }).ok).toBe(false);
  });
});
