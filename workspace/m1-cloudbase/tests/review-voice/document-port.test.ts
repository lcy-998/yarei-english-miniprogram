import { describe, expect, it } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import { DocumentReviewVoicePort, REVIEW_VOICE_COLLECTIONS } from '../../src/review-voice/document-port';
import { ReviewVoiceCommentService } from '../../src/review-voice/service';
import type { TaskAssignmentRecord, SubmissionRecord } from '../../src/task-core/types';

const teacher: TrustedActorContext = { requestId: 'req_teacher', sessionId: 'ses_teacher',
  actorUserId: 'teacher_demo', actorRole: 'teacher', organizationId: 'org_demo',
  platformSubjectDigest: 'digest_demo', permissions: ['submission.review'],
  scopeIds: ['class_demo'], authzVersion: 1 };
const submission: SubmissionRecord = { id: 'submission_demo', organizationId: 'org_demo',
  taskId: 'task_demo', assignmentId: 'assignment_demo', studentId: 'student_demo',
  submissionVersion: 2, recordVersion: 1, status: 'submitted', answers: [],
  isLate: false, submittedAt: '2026-10-03T08:00:00+08:00', supersedesSubmissionId: null };
const assignment: TaskAssignmentRecord = { id: 'assignment_demo', organizationId: 'org_demo',
  taskId: 'task_demo', studentId: 'student_demo', classId: 'class_demo', status: 'awaiting_review',
  latestSubmissionId: submission.id, latestSubmissionVersion: 2, redoCount: 0, redoDueAt: null,
  isLate: false, submittedAt: '2026-10-03T08:00:00+08:00', reviewedAt: null, version: 2 };

describe('T-08 persistent review voice drafts', () => {
  it('creates and seals one current submission-bound private voice with receipts', async () => {
    const db = new FakeDocumentDatabase({});
    let grantActive = true;
    const tasks = { async findSubmission() { return submission; },
      async findAssignmentById() { return assignment; },
      async listActiveTeacherGrants() { return grantActive ? [{ _id: 'grant_demo',
        organizationId: 'org_demo', teacherId: 'teacher_demo', classId: 'class_demo',
        status: 'active' as const, permissions: ['submission.review'], version: 1, deletedAt: null }] : []; } };
    const port = new DocumentReviewVoicePort(tasks, db, { async inspectAndSeal() {
      return { fileId: 'cloud://private/review.mp3', contentType: 'audio/mpeg' as const,
        durationMs: 3000, sizeBytes: 1024, contentSha256: 'a'.repeat(64) };
    } });
    const service = new ReviewVoiceCommentService(port,
      { nowIso: () => '2026-10-03T09:00:00+08:00' },
      { maxDurationMs: 300000, maxBytes: 20 * 1024 * 1024 });
    const begun = await service.begin(teacher, submission.id, 'operation_begin_voice');
    expect(begun).toMatchObject({ ok: true, data: { submissionVersion: 2, status: 'draft' } });
    if (!begun.ok) throw new Error('draft expected');
    expect(await service.begin(teacher, submission.id, 'operation_begin_voice'))
      .toMatchObject({ ok: true, data: { recordingId: begun.data.recordingId } });
    const sealed = await service.seal(teacher, begun.data.recordingId,
      `cloud://${begun.data.stagingPath}`, 1, 'operation_seal_voice');
    expect(sealed).toMatchObject({ ok: true, data: { status: 'sealed', durationMs: 3000 } });
    expect(await service.resolveForFeedback(teacher, submission.id, 2, begun.data.recordingId))
      .toMatchObject({ fileId: 'cloud://private/review.mp3', mediaVersion: 1 });
    expect(db.snapshot()[REVIEW_VOICE_COLLECTIONS.drafts]).toHaveLength(1);
    expect(db.snapshot()[REVIEW_VOICE_COLLECTIONS.operations]).toHaveLength(2);
    grantActive = false;
    expect(await service.resolveForFeedback(teacher, submission.id, 2, begun.data.recordingId)).toBeNull();
  });
});
