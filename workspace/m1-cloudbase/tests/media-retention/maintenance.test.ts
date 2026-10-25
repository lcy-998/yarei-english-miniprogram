import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import { MediaRetentionService } from '../../src/media-retention/service';
import { MediaRetentionMaintenance } from '../../src/media-retention/maintenance';

describe('bounded media retention maintenance', () => {
  it('scans one page, deletes an expired private original, and advances the durable cursor', async () => {
    const organizationId = 'org_demo';
    const studentId = 'student_demo';
    const id = 'record_12345678';
    const sha = 'a'.repeat(64);
    const owner = createHash('sha256').update(JSON.stringify([organizationId, studentId])).digest('hex');
    const fileId = `cloud://test-env/task-recordings/private/${owner}/${id}/${sha}.mp3`;
    const database = new FakeDocumentDatabase({
      organizations: [{ _id: organizationId, organizationId, schemaVersion: 1, version: 1,
        deletedAt: null, status: 'active' }],
      task_recordings: [{ _id: id, id, organizationId, schemaVersion: 1, version: 1,
        deletedAt: null, studentId, status: 'submitted', fileId,
        contentSha256: sha, submittedAt: '2026-01-01T00:00:00.000Z' }],
    });
    const deleted: string[] = [];
    const service = new MediaRetentionService(database,
      { async deleteFile(file) { deleted.push(file); return 'deleted'; } },
      'test-env', { nowIso: () => '2026-04-01T00:00:00.000Z' });
    const maintenance = new MediaRetentionMaintenance(database, service);
    expect(await maintenance.run()).toMatchObject({ scanned: 0, planned: 0, completed: 0 });
    expect(await maintenance.run()).toMatchObject({ scanned: 1, planned: 1, completed: 1 });
    expect(deleted).toEqual([fileId]);
    expect(database.snapshot().task_recordings?.[0]).toMatchObject({ status: 'submitted',
      mediaDeletedAt: '2026-04-01T00:00:00.000Z' });
  });
});
