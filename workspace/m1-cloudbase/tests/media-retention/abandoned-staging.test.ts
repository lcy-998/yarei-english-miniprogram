import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import type { VersionedDocument } from '../../src/repositories/document-database-port';
import { AbandonedStagingRetentionService } from '../../src/media-retention/abandoned-staging';
import { CloudBaseAbandonedStagingStorage } from '../../src/media-retention/cloudbase-storage';

const org = 'org_virtual';
const student = 'student_virtual';
const id = 'student_work_virtual_01';
const owner = createHash('sha256').update(JSON.stringify([org, student])).digest('hex');
const stagingPath = `student-works/staging/${owner}/${id}.mp3`;
const createdAt = '2026-01-01T00:00:00.000Z';
const now = '2026-07-01T00:00:00.000Z';
const draft = (overrides: Record<string, unknown> = {}): VersionedDocument => ({
  _id: id, id, organizationId: org, schemaVersion: 1, version: 1, deletedAt: null,
  studentId: student, status: 'draft', fileId: null, contentSha256: null,
  stagingPath, createdAt, submittedAt: null, ...overrides,
});

describe('abandoned unsealed recording cleanup', () => {
  it('deletes only a category-expired server-issued path and keeps the draft receipt', async () => {
    const database = new FakeDocumentDatabase({ student_works: [draft()] });
    const deleted: string[] = [];
    const service = new AbandonedStagingRetentionService(database,
      { async deleteStagingPath(input) { deleted.push(input.stagingPath); return 'deleted'; } },
      'test-env', { nowIso: () => now });
    expect(await service.planBatch('student_work', org, 0)).toMatchObject({ planned: 1 });
    const job = database.snapshot().media_retention_jobs?.[0];
    expect(await service.execute(job!._id)).toBe('completed');
    expect(deleted).toEqual([stagingPath]);
    expect(database.snapshot().student_works?.[0]).toMatchObject({ status: 'draft',
      stagingCleanupStatus: 'deleted', stagingMediaDeletedAt: now });
    expect(database.snapshot().operation_logs?.[0]).toMatchObject({
      action: 'media-retention.deleteAbandonedStaging', targetType: 'student_work',
      result: 'succeeded' });
  });

  it('defers an active upload lease and rejects a forged or cross-owner path', async () => {
    const records = [draft({ _id: 'student_work_virtual_02', id: 'student_work_virtual_02',
      stagingPath: `student-works/staging/${owner}/student_work_virtual_02.mp3`,
      uploadLeaseUntil: '2026-07-02T00:00:00.000Z' }),
    draft({ _id: 'student_work_virtual_03', id: 'student_work_virtual_03',
      stagingPath: 'student-works/staging/foreign/student_work_virtual_03.mp3' })];
    const database = new FakeDocumentDatabase({ student_works: records });
    const service = new AbandonedStagingRetentionService(database,
      { async deleteStagingPath() { throw new Error('Should not delete'); } },
      'test-env', { nowIso: () => now });
    expect(await service.planBatch('student_work', org, 0)).toMatchObject({ planned: 0 });
  });

  it('uses a 30-day deadline for autonomous reading upload intents', async () => {
    const recordingId = 'pronunciation_virtual_01';
    const record = draft({ _id: recordingId, id: recordingId,
      source: { kind: 'reading' },
      stagingPath: `pronunciation/staging/${owner}/${recordingId}.mp3` });
    const database = new FakeDocumentDatabase({ pronunciation_recordings: [record] });
    let at = new Date(Date.parse(createdAt) + 30 * 86400000 - 1).toISOString();
    const service = new AbandonedStagingRetentionService(database,
      { async deleteStagingPath() { return 'deleted'; } }, 'test-env', { nowIso: () => at });
    expect(await service.planBatch('pronunciation', org, 0)).toMatchObject({ planned: 0 });
    at = new Date(Date.parse(createdAt) + 30 * 86400000).toISOString();
    expect(await service.planBatch('pronunciation', org, 0)).toMatchObject({ planned: 1 });
  });

  it('releases the source lock after a storage failure and retries the same job', async () => {
    const database = new FakeDocumentDatabase({ student_works: [draft()] });
    let attempts = 0;
    const service = new AbandonedStagingRetentionService(database,
      { async deleteStagingPath() { attempts += 1;
        if (attempts === 1) throw new Error('temporary storage failure');
        return 'not_found'; } }, 'test-env', { nowIso: () => now });
    await service.planBatch('student_work', org, 0);
    const job = database.snapshot().media_retention_jobs?.[0];
    await expect(service.execute(job!._id)).rejects.toThrow('temporary storage failure');
    expect(database.snapshot().media_retention_jobs?.[0]).toMatchObject({ status: 'failed' });
    expect(database.snapshot().student_works?.[0]).toMatchObject({ stagingCleanupStatus: 'failed' });
    expect(await service.execute(job!._id)).toBe('completed');
    expect(attempts).toBe(2);
  });

  it('resolves a staging file ID server-side and refuses a different bucket', async () => {
    const fileId = `cloud://test-env.bucket/${stagingPath}`;
    const storage = new CloudBaseAbandonedStagingStorage({
      async getUploadMetadata() { return { data: { fileId } }; },
      async deleteFile(input) { expect(input.fileList).toEqual([fileId]);
        return { fileList: [{ fileID: fileId, code: 'SUCCESS' }] }; },
    });
    expect(await storage.deleteStagingPath({ environmentId: 'test-env', stagingPath })).toBe('deleted');
    const foreign = new CloudBaseAbandonedStagingStorage({
      async getUploadMetadata() { return { data: { fileId: `cloud://foreign.bucket/${stagingPath}` } }; },
      async deleteFile() { throw new Error('Should not delete'); },
    });
    await expect(foreign.deleteStagingPath({ environmentId: 'test-env', stagingPath }))
      .rejects.toThrow('mismatch');
  });
});
