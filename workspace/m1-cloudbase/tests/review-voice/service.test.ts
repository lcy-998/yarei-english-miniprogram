import { describe, expect, it } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { ReviewVoiceCommentService, type ReviewVoiceDraft, type ReviewVoicePort,
} from '../../src/review-voice/service';

const teacher: TrustedActorContext = { requestId: 'req_teacher', sessionId: 'ses_teacher',
  actorUserId: 'teacher_demo', actorRole: 'teacher', organizationId: 'org_demo',
  platformSubjectDigest: 'digest_demo', permissions: ['submission.review'],
  scopeIds: ['class_demo'], authzVersion: 1 };

function fixture() {
  let now = Date.parse('2026-10-03T08:00:00+08:00');
  let authorized = true;
  const drafts = new Map<string, ReviewVoiceDraft>();
  const begins = new Map<string, ReviewVoiceDraft>();
  const seals = new Map<string, { fingerprint: string; draft: ReviewVoiceDraft }>();
  let next = 0;
  const port: ReviewVoicePort = {
    async findTarget(actor, submissionId) {
      return authorized && actor.actorUserId === 'teacher_demo' && submissionId === 'submission_demo'
        ? { organizationId: 'org_demo', taskId: 'task_demo', assignmentId: 'assignment_demo',
          submissionId, submissionVersion: 2, classId: 'class_demo', status: 'submitted' } : null;
    },
    async findDraft(id) { return drafts.get(id) ?? null; },
    async findSealReceipt(_org, _teacher, operationId) { return seals.get(operationId) ?? null; },
    async createDraft(draft, operationId) {
      const prior = begins.get(operationId);
      if (prior) return prior;
      drafts.set(draft.id, draft); begins.set(operationId, draft); return draft;
    },
    async sealDraft(draft, expectedVersion, operationId, fingerprint) {
      if (drafts.get(draft.id)?.version !== expectedVersion) return null;
      drafts.set(draft.id, draft); seals.set(operationId, { fingerprint, draft }); return draft;
    },
    nextId() { next += 1; return `review_voice_${next}`; },
    async inspectAndSeal(stagingPath, stagingFileId) {
      return stagingFileId === `cloud://${stagingPath}` ? {
        fileId: 'cloud://private/sealed-review.mp3', contentType: 'audio/mpeg',
        durationMs: 3000, sizeBytes: 1024, contentSha256: 'a'.repeat(64),
      } : null;
    },
  };
  return { service: new ReviewVoiceCommentService(port, { nowIso: () => new Date(now).toISOString() },
    { maxDurationMs: 300000, maxBytes: 20 * 1024 * 1024 }),
  advance(ms: number) { now += ms; }, revoke() { authorized = false; } };
}

describe('T-08 protected voice comment draft', () => {
  it('seals a bound recording, keeps file ID private, and resolves it only for formal feedback', async () => {
    const state = fixture();
    const begun = await state.service.begin(teacher, 'submission_demo', 'operation_begin_voice');
    expect(begun).toMatchObject({ ok: true, data: { recordingId: 'review_voice_1',
      submissionVersion: 2, status: 'draft' } });
    if (!begun.ok) throw new Error('draft expected');
    const stagingFileId = `cloud://${begun.data.stagingPath}`;
    const sealed = await state.service.seal(teacher, begun.data.recordingId, stagingFileId, 1,
      'operation_seal_voice');
    expect(sealed).toMatchObject({ ok: true, data: { status: 'sealed', durationMs: 3000, version: 2 } });
    expect(JSON.stringify(sealed)).not.toContain('private/sealed-review');
    expect(await state.service.seal(teacher, begun.data.recordingId, stagingFileId, 1,
      'operation_seal_voice')).toEqual(sealed);
    expect(await state.service.resolveForFeedback(teacher, 'submission_demo', 2, begun.data.recordingId))
      .toMatchObject({ recordingId: 'review_voice_1', fileId: 'cloud://private/sealed-review.mp3' });
    expect(await state.service.resolveForFeedback(teacher, 'submission_demo', 1, begun.data.recordingId))
      .toBeNull();
    state.revoke();
    expect(await state.service.resolveForFeedback(teacher, 'submission_demo', 2, begun.data.recordingId))
      .toBeNull();
  });

  it('rejects another teacher and a storage object outside its issued staging path', async () => {
    const state = fixture();
    const other = { ...teacher, actorUserId: 'teacher_other' };
    expect(await state.service.begin(other, 'submission_demo', 'operation_other'))
      .toEqual({ ok: false, code: 'FORBIDDEN' });
    const begun = await state.service.begin(teacher, 'submission_demo', 'operation_begin');
    if (!begun.ok) throw new Error('draft expected');
    expect(await state.service.seal(teacher, begun.data.recordingId,
      'cloud://private/other.mp3', 1, 'operation_bad_seal'))
      .toEqual({ ok: false, code: 'MEDIA_INVALID' });
    state.advance(24 * 60 * 60 * 1000);
    expect(await state.service.seal(teacher, begun.data.recordingId,
      `cloud://${begun.data.stagingPath}`, 1, 'operation_expired'))
      .toEqual({ ok: false, code: 'CONFLICT' });
  });
});
