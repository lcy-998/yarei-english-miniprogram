import { describe, expect, it } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import type { NativeAdminGrantReader } from '../../src/native-admin/authorization';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import { createTaskCoreDocumentRepository } from '../../src/repositories/task-core-document-adapter';
import { DocumentTeacherMediaUnitOfWork, TEACHER_MEDIA_COLLECTIONS,
} from '../../src/teacher-media/document-review-port';
import { TeacherMediaReviewService } from '../../src/teacher-media/review-service';

const owner: TrustedActorContext = { requestId: 'req_owner', sessionId: 'ses_owner',
  actorUserId: 'teacher_owner', actorRole: 'teacher', organizationId: 'org_demo',
  platformSubjectDigest: 'digest_owner', permissions: ['media.upload'],
  scopeIds: ['class_demo'], authzVersion: 1 };
const reviewer: TrustedActorContext = { ...owner, actorUserId: 'teacher_reviewer',
  permissions: [], authzVersion: 3 };

describe('persistent T-19/A-08 review transition', () => {
  it('persists independent approval and separate publication with receipts and audit', async () => {
    const db = new FakeDocumentDatabase({
      [TEACHER_MEDIA_COLLECTIONS.records]: [{ _id: 'media_demo', organizationId: 'org_demo',
        schemaVersion: 1, version: 1, deletedAt: null, mediaVersion: 2,
        ownerTeacherId: 'teacher_owner', title: '虚构听力素材', kind: 'listening', status: 'draft',
        reviewVersion: null, reviewedBy: null, reviewedAt: null, rejectionReason: null,
        copyrightStatus: 'unverified', copyrightEvidenceKey: 'cloud://demo/fictional-proof.txt',
        scanStatus: 'clean', transcodeStatus: 'ready',
        sourceScanEvidence: { engine: 'clamav', signatureVersion: 'virtual-unit-v1',
          scannedAt: '2026-10-03T07:58:00+08:00', scannedSha256: 'b'.repeat(64),
          reportId: 'virtual_source_scan_01' },
        scanEvidence: { engine: 'clamav', signatureVersion: 'virtual-unit-v1',
          scannedAt: '2026-10-03T08:00:00+08:00', scannedSha256: 'a'.repeat(64),
          reportId: 'virtual_scan_01' },
        transcodeEvidence: { engine: 'ffmpeg', engineVersion: 'virtual-unit-v1',
          transcodedAt: '2026-10-03T07:59:00+08:00', sourceSha256: 'b'.repeat(64),
          outputSha256: 'a'.repeat(64),
          outputAssetKey: 'cloud://demo/audio.mp3' },
        mediaAssetKey: 'cloud://demo/audio.mp3', mediaSha256: 'a'.repeat(64), durationMs: 10000,
        allowedClassIds: ['class_demo'], questionIds: ['question_1', 'question_2', 'question_3'],
        questions: [
          { questionId: 'question_1', questionType: 'single_choice', stem: 'Which animal?', options: ['cat', 'dog'] },
          { questionId: 'question_2', questionType: 'single_choice', stem: 'Which color?', options: ['red', 'blue'] },
          { questionId: 'question_3', questionType: 'single_choice', stem: 'Which place?', options: ['home', 'school'] },
        ], answerKeys: [
          { questionId: 'question_1', correctAnswer: 'cat', explanation: '' },
          { questionId: 'question_2', correctAnswer: 'red', explanation: '' },
          { questionId: 'question_3', correctAnswer: 'home', explanation: '' },
        ], clips: [
          { questionId: 'question_1', segmentId: 'segment_1', startMs: 0, endMs: 3000 },
          { questionId: 'question_2', segmentId: 'segment_2', startMs: 3000, endMs: 6000 },
          { questionId: 'question_3', segmentId: 'segment_3', startMs: 6000, endMs: 10000 },
        ],
        continuousPlaybackEnforced: true }],
      [TEACHER_MEDIA_COLLECTIONS.grants]: [{ _id: 'grant_owner', organizationId: 'org_demo',
        schemaVersion: 1, version: 1, deletedAt: null, teacherId: 'teacher_owner',
        classId: 'class_demo', status: 'active', permissions: ['media.upload'] }],
    });
    const grants: NativeAdminGrantReader = { async currentAuthorizationVersion() { return 3; },
      async findGrant() { return { organizationId: 'org_demo', teacherId: 'teacher_reviewer',
        status: 'active', permissions: ['media.review'],
        scope: { organizationWide: false, classIds: ['class_demo'] }, version: 1 }; } };
    const service = new TeacherMediaReviewService(new DocumentTeacherMediaUnitOfWork(db),
      grants, { nowIso: () => '2026-10-03T08:00:00+08:00' });
    expect(await service.submitForReview(owner, 'media_demo', 1, 'operation_submit_01'))
      .toMatchObject({ status: 'pending_review', recordVersion: 2 });
    expect(await service.review(reviewer, 'media_demo', 2, 'operation_review_01', 'approved', ''))
      .toMatchObject({ status: 'approved', recordVersion: 3 });
    expect(await service.publish(reviewer, 'media_demo', 3, 'operation_publish_01'))
      .toMatchObject({ status: 'published', recordVersion: 4 });
    expect(db.snapshot()[TEACHER_MEDIA_COLLECTIONS.records]?.[0])
      .toMatchObject({ status: 'published', version: 4, mediaVersion: 2 });
    expect(db.snapshot()[TEACHER_MEDIA_COLLECTIONS.resources]?.[0])
      .toMatchObject({ type: 'listening', status: 'published', contentVersion: 2,
        payload: { teacherMedia: { reviewVersion: 2, status: 'published' } } });
    expect(await createTaskCoreDocumentRepository(db).findResource('org_demo', 'media_demo'))
      .toMatchObject({ type: 'listening', status: 'published', contentVersion: 2 });
    expect(db.snapshot()[TEACHER_MEDIA_COLLECTIONS.operations]).toHaveLength(3);
    expect(db.snapshot()[TEACHER_MEDIA_COLLECTIONS.audit]).toHaveLength(3);
  });
});
