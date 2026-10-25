import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MediaRetentionService, type PronunciationSubmissionLookup } from '../../src/media-retention/service';
import { AUTONOMOUS_READING_AUDIO_RETENTION_MS, ORIGINAL_AUDIO_RETENTION_MS,
  originalAudioExpired } from '../../src/media-retention/policy';
import { TaskPronunciationSubmissionLookup } from '../../src/media-retention/pronunciation-submission-lookup';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import type { VersionedDocument } from '../../src/repositories/document-database-port';
import type { TaskQueryRepository } from '../../src/task-query/repository';

const organizationId = 'org_virtual_voice';
const studentId = 'student_virtual_voice';
const environmentId = 'test-env';
const sha = 'b'.repeat(64);
const recordingId = 'pronunciation_virtual_0001';
const owner = createHash('sha256').update(JSON.stringify([organizationId, studentId])).digest('hex');
const fileId = `cloud://${environmentId}/pronunciation/private/${owner}/${recordingId}/${sha}.mp3`;
const submittedAt = '2026-01-01T00:00:00.000Z';

function recording(overrides: Readonly<Record<string, unknown>> = {}): VersionedDocument {
  return { _id: recordingId, id: recordingId, organizationId, studentId,
    schemaVersion: 1, version: 3, deletedAt: null, status: 'scored', fileId,
    contentSha256: sha, source: { kind: 'task', taskId: 'task_virtual_voice',
      assignmentId: 'assignment_virtual_voice', itemId: 'item_virtual_voice', submissionVersion: 1 },
    score: { total: 78 }, modelVersion: 'vosk-model-small-en-us-0.15',
    ...overrides } as VersionedDocument;
}

function fixture(source = recording()) {
  const database = new FakeDocumentDatabase({ pronunciation_recordings: [source] });
  let now = new Date(Date.parse(submittedAt) + ORIGINAL_AUDIO_RETENTION_MS - 1).toISOString();
  let formal: string | null = submittedAt;
  const deleted: string[] = [];
  const submissions: PronunciationSubmissionLookup = { async submittedAt() { return formal; } };
  const service = new MediaRetentionService(database,
    { async deleteFile(value) { deleted.push(value); return 'deleted'; } },
    environmentId, { nowIso: () => now }, submissions);
  return { database, deleted, service, at: (value: string) => { now = value; },
    unlink: () => { formal = null; } };
}

describe('M3 formal pronunciation original retention', () => {
  it('takes the retention start from the formal submission that references this recording', async () => {
    const submissions = [{ organizationId, taskId: 'task_virtual_voice',
      assignmentId: 'assignment_virtual_voice', studentId,
      submissionVersion: 1, status: 'submitted', submittedAt, answers: [{ itemId: 'item_virtual_voice',
        value: { recordingId } }] }];
    const tasks = { async listTaskSubmissions() { return submissions; } } as unknown as TaskQueryRepository;
    const lookup = new TaskPronunciationSubmissionLookup(tasks);
    expect(await lookup.submittedAt(recording())).toBe(submittedAt);
    expect(await lookup.submittedAt(recording({ id: 'pronunciation_virtual_other' }))).toBeNull();
    expect(await lookup.submittedAt(recording({ source: { kind: 'reading' } }))).toBeNull();
  });

  it('stops classroom playback at day 60 and deletes only the exact private file after formal submission', async () => {
    const state = fixture();
    expect(originalAudioExpired(submittedAt,
      new Date(Date.parse(submittedAt) + ORIGINAL_AUDIO_RETENTION_MS - 1).toISOString())).toBe(false);
    expect(await state.service.planBatch('pronunciation', organizationId, 0)).toMatchObject({ planned: 0 });
    state.at(new Date(Date.parse(submittedAt) + ORIGINAL_AUDIO_RETENTION_MS).toISOString());
    expect(originalAudioExpired(submittedAt,
      new Date(Date.parse(submittedAt) + ORIGINAL_AUDIO_RETENTION_MS).toISOString())).toBe(true);
    expect(await state.service.planBatch('pronunciation', organizationId, 0)).toMatchObject({ planned: 1 });
    const job = state.database.snapshot().media_retention_jobs?.[0];
    expect(job).toMatchObject({ kind: 'pronunciation',
      eligibleAt: new Date(Date.parse(submittedAt) + ORIGINAL_AUDIO_RETENTION_MS).toISOString() });
    expect(await state.service.execute(job!._id)).toMatchObject({ status: 'completed' });
    expect(state.deleted).toEqual([fileId]);
    expect(state.database.snapshot().pronunciation_recordings?.[0]).toMatchObject({
      status: 'scored', score: { total: 78 }, modelVersion: 'vosk-model-small-en-us-0.15',
      mediaDeletedAt: new Date(Date.parse(submittedAt) + ORIGINAL_AUDIO_RETENTION_MS).toISOString(),
    });
    expect(state.database.snapshot().operation_logs?.[0]).toMatchObject({
      action: 'media-retention.deleteOriginal', targetType: 'pronunciation',
      metadata: { retainedHistory: true },
    });
    state.at(new Date(Date.parse(submittedAt) + ORIGINAL_AUDIO_RETENTION_MS + 86_400_000).toISOString());
    expect(await state.service.planBatch('pronunciation', organizationId, 0)).toMatchObject({ planned: 0 });
    expect(await state.service.execute(job!._id)).toMatchObject({ status: 'completed' });
    expect(state.deleted).toEqual([fileId]);
  });

  it('never deletes an unsubmitted draft, mismatched file path or changed submission reference', async () => {
    for (const source of [recording({ status: 'sealed' }),
      recording({ fileId: `cloud://other-env/pronunciation/private/${owner}/${recordingId}/${sha}.mp3` }),
      recording({ fileId: `cloud://${environmentId}/pronunciation/staging/${recordingId}.mp3` })]) {
      const state = fixture(source);
      state.at(new Date(Date.parse(submittedAt) + ORIGINAL_AUDIO_RETENTION_MS + 86_400_000).toISOString());
      expect(await state.service.planBatch('pronunciation', organizationId, 0)).toMatchObject({ planned: 0 });
      expect(state.deleted).toEqual([]);
    }
    const state = fixture();
    state.at(new Date(Date.parse(submittedAt) + ORIGINAL_AUDIO_RETENTION_MS).toISOString());
    state.unlink();
    expect(await state.service.planBatch('pronunciation', organizationId, 0)).toMatchObject({ planned: 0 });
  });

  it('marks a planned deletion stale if formal submission no longer references the recording', async () => {
    const state = fixture();
    state.at(new Date(Date.parse(submittedAt) + ORIGINAL_AUDIO_RETENTION_MS).toISOString());
    await state.service.planBatch('pronunciation', organizationId, 0);
    const job = state.database.snapshot().media_retention_jobs?.[0];
    state.unlink();
    expect(await state.service.execute(job!._id)).toMatchObject({ status: 'stale' });
    expect(state.deleted).toEqual([]);
    expect(state.database.snapshot().pronunciation_recordings?.[0]?.mediaDeletedAt).toBeUndefined();
  });

  it('cleans autonomous reading 30 days after sealing without a classroom submission', async () => {
    const sealedAt = '2026-01-01T00:00:00.000Z';
    const state = fixture(recording({ source: { kind: 'reading', resourceId: 'read_virtual_01' },
      status: 'sealed', sealedAt }));
    state.unlink();
    state.at(new Date(Date.parse(sealedAt) + AUTONOMOUS_READING_AUDIO_RETENTION_MS - 1).toISOString());
    expect(await state.service.planBatch('pronunciation', organizationId, 0)).toMatchObject({ planned: 0 });
    state.at(new Date(Date.parse(sealedAt) + AUTONOMOUS_READING_AUDIO_RETENTION_MS).toISOString());
    expect(await state.service.planBatch('pronunciation', organizationId, 0)).toMatchObject({ planned: 1 });
    const job = state.database.snapshot().media_retention_jobs?.[0];
    expect(await state.service.execute(job!._id)).toMatchObject({ status: 'completed' });
    expect(state.deleted).toEqual([fileId]);
  });
});
