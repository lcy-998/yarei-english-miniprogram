import { describe, expect, it } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import type { NativeAdminGrantReader } from '../../src/native-admin/authorization';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import { DocumentTeacherMediaDraftPort } from '../../src/teacher-media/document-draft-port';
import { DocumentTeacherMediaUnitOfWork, TEACHER_MEDIA_COLLECTIONS,
} from '../../src/teacher-media/document-review-port';
import { TeacherMediaDraftService } from '../../src/teacher-media/draft-service';
import { TeacherMediaReviewService } from '../../src/teacher-media/review-service';

const owner: TrustedActorContext = { requestId: 'req_owner', sessionId: 'ses_owner',
  actorUserId: 'teacher_owner', actorRole: 'teacher', organizationId: 'org_demo',
  platformSubjectDigest: 'digest_owner', permissions: ['media.upload'],
  scopeIds: ['class_demo'], authzVersion: 1 };
const reviewer: TrustedActorContext = { ...owner, actorUserId: 'teacher_reviewer',
  permissions: [], authzVersion: 3 };

describe('T-20 draft and processing proof boundary', () => {
  it('holds an unprocessed draft, then accepts only a processor receipt before independent review', async () => {
    const db = new FakeDocumentDatabase({
      [TEACHER_MEDIA_COLLECTIONS.grants]: [{ _id: 'grant_owner', organizationId: 'org_demo',
        schemaVersion: 1, version: 1, deletedAt: null, teacherId: 'teacher_owner',
        classId: 'class_demo', status: 'active', permissions: ['media.upload'] }],
    });
    const draftPort = new DocumentTeacherMediaDraftPort(db);
    const clock = { nowIso: () => '2026-10-03T08:00:00+08:00' };
    const input = { title: '虚构听力素材', kind: 'listening' as const,
      allowedClassIds: ['class_demo'], copyrightEvidenceKey: 'cloud://demo/fictional-proof.txt',
      questionIds: ['question_1', 'question_2', 'question_3'], questions: [
        { questionId: 'question_1', questionType: 'single_choice' as const, stem: 'Which animal?', options: ['cat', 'dog'] },
        { questionId: 'question_2', questionType: 'single_choice' as const, stem: 'Which color?', options: ['red', 'blue'] },
        { questionId: 'question_3', questionType: 'single_choice' as const, stem: 'Which place?', options: ['home', 'school'] },
      ], answerKeys: [
        { questionId: 'question_1', correctAnswer: 'cat', explanation: '' },
        { questionId: 'question_2', correctAnswer: 'red', explanation: '' },
        { questionId: 'question_3', correctAnswer: 'home', explanation: '' },
      ], clips: [
        { questionId: 'question_1', segmentId: 'segment_1', startMs: 0, endMs: 3000 },
        { questionId: 'question_2', segmentId: 'segment_2', startMs: 3000, endMs: 6000 },
        { questionId: 'question_3', segmentId: 'segment_3', startMs: 6000, endMs: 10000 },
      ],
    };
    const noProcessor = new TeacherMediaDraftService(draftPort, null, clock);
    const begun = await noProcessor.begin(owner, input, 'operation_begin_media');
    expect(begun).toMatchObject({ ok: true, data: { status: 'draft', scanStatus: 'pending',
      transcodeStatus: 'pending', recordVersion: 1 } });
    if (!begun.ok) throw new Error('draft expected');
    const mediaId = begun.data.mediaId;
    expect(await noProcessor.sealProcessed(owner, mediaId,
      `cloud://${begun.data.stagingPath}`, 1, 'operation_unavailable'))
      .toEqual({ ok: false, code: 'SERVICE_UNAVAILABLE' });
    const admin: NativeAdminGrantReader = { async currentAuthorizationVersion() { return 3; },
      async findGrant() { return { organizationId: 'org_demo', teacherId: 'teacher_reviewer',
        status: 'active', permissions: ['media.review'],
        scope: { organizationWide: false, classIds: ['class_demo'] }, version: 1 }; } };
    const review = new TeacherMediaReviewService(new DocumentTeacherMediaUnitOfWork(db), admin, clock);
    await expect(review.submitForReview(owner, mediaId, 1, 'operation_early_submit'))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    const processor = new TeacherMediaDraftService(draftPort, { async process(stagingPath, stagingFileId) {
      expect(stagingFileId).toBe(`cloud://${stagingPath}`);
      return { mediaAssetKey: 'cloud://demo/processed.mp3', mediaSha256: 'a'.repeat(64),
        durationMs: 10000,
        sourceScanEvidence: { engine: 'clamav' as const, signatureVersion: 'virtual-unit-v1',
          scannedAt: '2026-10-03T07:58:00+08:00', scannedSha256: 'b'.repeat(64),
          reportId: 'virtual_source_scan_01' },
        transcodeEvidence: { engine: 'ffmpeg' as const, engineVersion: 'virtual-unit-v1',
          transcodedAt: '2026-10-03T07:59:00+08:00', sourceSha256: 'b'.repeat(64),
          outputSha256: 'a'.repeat(64), outputAssetKey: 'cloud://demo/processed.mp3' },
        scanEvidence: { engine: 'clamav' as const, signatureVersion: 'virtual-unit-v1',
          scannedAt: '2026-10-03T08:00:00+08:00', scannedSha256: 'a'.repeat(64),
          reportId: 'virtual_output_scan_01' },
      };
    } }, clock, true);
    expect(await processor.sealProcessed(owner, mediaId, `cloud://${begun.data.stagingPath}`,
      1, 'operation_seal_media')).toMatchObject({ ok: true,
      data: { status: 'draft', scanStatus: 'clean', transcodeStatus: 'ready', recordVersion: 2 } });
    expect(await processor.sealProcessed(owner, mediaId, `cloud://${begun.data.stagingPath}`,
      1, 'operation_seal_media')).toMatchObject({ ok: true,
      data: { recordVersion: 2 } });
    expect(await review.submitForReview(owner, mediaId, 2, 'operation_submit_media'))
      .toMatchObject({ status: 'pending_review', recordVersion: 3 });
    expect(await review.review(reviewer, mediaId, 3, 'operation_review_media', 'approved', ''))
      .toMatchObject({ status: 'approved', copyrightStatus: 'verified', recordVersion: 4 });
    expect(await review.publish(reviewer, mediaId, 4, 'operation_publish_media'))
      .toMatchObject({ status: 'published', recordVersion: 5 });
    expect(db.snapshot()[TEACHER_MEDIA_COLLECTIONS.resources]?.[0])
      .toMatchObject({ status: 'published', payload: { teacherMedia: { scanEvidence: {
        reportId: 'virtual_output_scan_01' } } } });
  });
});
