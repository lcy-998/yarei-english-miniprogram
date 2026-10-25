import { describe, expect, it } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { DocumentNativeAdminGrantRepository, nativeAdminGrantId } from '../../src/native-admin/document-grant-repository';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import { AssetReviewService } from '../../src/teacher-media/asset-review-service';

const actor: TrustedActorContext = { requestId: 'request_review', sessionId: 'session_review',
  actorUserId: 'reviewer_demo', actorRole: 'teacher', organizationId: 'org_demo',
  platformSubjectDigest: 'digest_review', permissions: [],
  scopeIds: ['class_one'], authzVersion: 1 };
const base = { organizationId: 'org_demo', schemaVersion: 1 as const,
  version: 1, deletedAt: null };

function fixture(importedBy = 'asset_editor_demo', allowedClass = 'class_one') {
  const db = new FakeDocumentDatabase({
    users: [{ _id: 'reviewer_demo', ...base, authorizationVersion: 1, status: 'active' }],
    native_admin_grants: [{ _id: nativeAdminGrantId('org_demo', 'reviewer_demo'), ...base,
      teacherId: 'reviewer_demo', status: 'active', permissions: ['media.review'],
      scope: { organizationWide: false, classIds: ['class_one'] } }],
    learning_resources: [{ _id: 'audio_demo', ...base, type: 'listening',
      title: '虚构后台听力', contentVersion: 3, status: 'draft',
      visibility: { type: 'classes', classIds: [allowedClass] },
      payload: { assetLibrary: { kind: 'central_asset_library', resourceId: 'audio_demo',
        version: 3, manifestSha256: 'c'.repeat(64), reviewId: 'review_audio_demo',
        importedBy, reviewStatus: 'pending' },
      teacherMedia: { status: 'pending_review', allowedClassIds: [allowedClass],
        reviewVersion: null, reviewedBy: null, reviewedAt: null,
        copyrightStatus: 'unverified', copyrightEvidenceKey: 'cloud://private/proof',
        scanStatus: 'clean', transcodeStatus: 'ready',
        mediaAssetKey: 'cloud://private/audio.mp3', mediaSha256: 'a'.repeat(64), durationMs: 10000,
        sourceScanEvidence: { engine: 'clamav', signatureVersion: 'virtual-test',
          scannedAt: '2026-10-03T06:00:00.000Z', scannedSha256: 'b'.repeat(64), reportId: 'source_scan' },
        transcodeEvidence: { engine: 'ffmpeg', engineVersion: 'virtual-test',
          transcodedAt: '2026-10-03T06:30:00.000Z', sourceSha256: 'b'.repeat(64),
          outputSha256: 'a'.repeat(64), outputAssetKey: 'cloud://private/audio.mp3' },
        scanEvidence: { engine: 'clamav', signatureVersion: 'virtual-test',
          scannedAt: '2026-10-03T06:40:00.000Z', scannedSha256: 'a'.repeat(64), reportId: 'output_scan' },
        questionIds: ['q1', 'q2', 'q3'], questions: [
          { questionId: 'q1', questionType: 'single_choice', stem: 'Choose the animal', options: ['cat', 'dog'] },
          { questionId: 'q2', questionType: 'single_choice', stem: 'Choose the color', options: ['red', 'blue'] },
          { questionId: 'q3', questionType: 'single_choice', stem: 'Choose the place', options: ['home', 'school'] },
        ], answerKeys: [
          { questionId: 'q1', correctAnswer: 'cat', explanation: 'private answer' },
          { questionId: 'q2', correctAnswer: 'red', explanation: 'private answer' },
          { questionId: 'q3', correctAnswer: 'home', explanation: 'private answer' },
        ], clips: [
          { questionId: 'q1', segmentId: 'clip1', startMs: 0, endMs: 3000 },
          { questionId: 'q2', segmentId: 'clip2', startMs: 3000, endMs: 6000 },
          { questionId: 'q3', segmentId: 'clip3', startMs: 6000, endMs: 10000 },
        ],
        continuousPlaybackEnforced: true } } }],
    native_admin_content_operations: [], operation_logs: [],
  });
  return { db, service: new AssetReviewService(db,
    new DocumentNativeAdminGrantRepository(db),
    { nowIso: () => '2026-10-03T08:00:00.000Z' }) };
}

describe('A-08 central asset review', () => {
  it('reviews and publishes the same asset record used by task selection', async () => {
    const { db, service } = fixture();
    const approved = await service.review(actor, 'audio_demo', 1,
      'operation_review_01', 'approved', '');
    expect(approved).toEqual({ id: 'audio_demo', status: 'approved',
      recordVersion: 2, reviewVersion: 3 });
    expect(await service.review(actor, 'audio_demo', 1,
      'operation_review_01', 'approved', '')).toEqual(approved);
    const published = await service.publish(actor, 'audio_demo', 2, 'operation_publish_01');
    expect(published).toEqual({ id: 'audio_demo', status: 'published',
      recordVersion: 3, reviewVersion: 3 });
    expect(await db.get('learning_resources', 'audio_demo')).toMatchObject({
      status: 'published', payload: { assetLibrary: { reviewStatus: 'approved' },
        teacherMedia: { status: 'published', reviewVersion: 3 } },
    });
    expect(await db.find('operation_logs', { organizationId: 'org_demo' }))
      .toMatchObject([{ action: 'asset_library.media.approved' },
        { action: 'asset_library.media.publish' }]);
  });

  it('unpublishes a published asset with a required reason while preserving review history', async () => {
    const { db, service } = fixture()
    await service.review(actor, 'audio_demo', 1, 'operation_review_offline_1', 'approved', '')
    await service.publish(actor, 'audio_demo', 2, 'operation_publish_offline_1')
    const result = await service.unpublish(actor, 'audio_demo', 3,
      'operation_unpublish_01', '素材需要重新校对')
    expect(result).toMatchObject({ status: 'offline', recordVersion: 4, reviewVersion: 3 })
    expect(await db.get('learning_resources', 'audio_demo')).toMatchObject({ status: 'offline',
      payload: { teacherMedia: { status: 'offline', reviewVersion: 3,
        unpublishReason: '素材需要重新校对' } } })
  })

  it('records an issue without changing whether a published asset is assignable', async () => {
    const { db, service } = fixture()
    await service.review(actor, 'audio_demo', 1, 'operation_review_issue_1', 'approved', '')
    await service.publish(actor, 'audio_demo', 2, 'operation_publish_issue_1')
    const issue = await service.reportIssue(actor, 'audio_demo', 3,
      'operation_report_issue_1', '第二题片段有误')
    expect(issue).toMatchObject({ status: 'published', recordVersion: 4 })
    expect(await db.get('learning_resources', 'audio_demo')).toMatchObject({
      status: 'published', version: 4 })
    expect(await db.find('operation_logs', { action: 'asset_library.media.issue' }))
      .toMatchObject([{ metadata: { issueReason: '第二题片段有误' } }])
    expect(await service.reportIssue(actor, 'audio_demo', 3,
      'operation_report_issue_1', '第二题片段有误')).toEqual(issue)
  })

  it('rejects self review, cross-class review and stale versions', async () => {
    await expect(fixture('reviewer_demo').service.review(actor, 'audio_demo', 1,
      'operation_self_01', 'approved', '')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(fixture('asset_editor_demo', 'class_two').service.review(actor, 'audio_demo', 1,
      'operation_other_class_01', 'approved', '')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(fixture().service.review(actor, 'audio_demo', 2,
      'operation_stale_01', 'approved', '')).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
