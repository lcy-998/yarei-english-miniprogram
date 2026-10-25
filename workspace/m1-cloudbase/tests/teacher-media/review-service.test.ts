import { describe, expect, it } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import type { NativeAdminGrantReader } from '../../src/native-admin/authorization';
import { TeacherMediaReviewService, type TeacherMediaOperationReceipt,
  type TeacherMediaRecord, type TeacherMediaUnitOfWork } from '../../src/teacher-media/review-service';

const owner: TrustedActorContext = { requestId: 'req_owner', sessionId: 'ses_owner', actorUserId: 'teacher_owner',
  actorRole: 'teacher', organizationId: 'org_demo', platformSubjectDigest: 'digest_owner',
  permissions: ['media.upload'], scopeIds: ['class_demo'], authzVersion: 1 };
const reviewer: TrustedActorContext = { ...owner, actorUserId: 'teacher_reviewer',
  sessionId: 'ses_reviewer', permissions: [], authzVersion: 3 };

function fixture() {
  let record: TeacherMediaRecord = { id: 'media_demo', organizationId: 'org_demo',
    title: '虚构听力素材', ownerTeacherId: 'teacher_owner',
    kind: 'listening', version: 2, recordVersion: 1, status: 'draft', reviewVersion: null,
    reviewedAt: null, reviewedBy: null, rejectionReason: null, copyrightStatus: 'unverified',
    copyrightEvidenceKey: 'cloud://demo/fictional-proof.txt',
    scanStatus: 'clean', transcodeStatus: 'ready', mediaAssetKey: 'cloud://demo/audio.mp3',
    sourceScanEvidence: { engine: 'clamav', signatureVersion: 'virtual-unit-v1',
      scannedAt: '2026-10-02T07:58:00+08:00', scannedSha256: 'b'.repeat(64),
      reportId: 'virtual_source_scan_01' },
    scanEvidence: { engine: 'clamav', signatureVersion: 'virtual-unit-v1',
      scannedAt: '2026-10-02T08:00:00+08:00', scannedSha256: 'a'.repeat(64), reportId: 'virtual_scan_01' },
    transcodeEvidence: { engine: 'ffmpeg', engineVersion: 'virtual-unit-v1',
      transcodedAt: '2026-10-02T07:59:00+08:00', sourceSha256: 'b'.repeat(64),
      outputSha256: 'a'.repeat(64),
      outputAssetKey: 'cloud://demo/audio.mp3' },
    mediaSha256: 'a'.repeat(64), durationMs: 12000, allowedClassIds: ['class_demo'],
    questionIds: ['question_1', 'question_2', 'question_3'], questions: [
      { questionId: 'question_1', questionType: 'single_choice', stem: 'Choose the animal.', options: ['cat', 'dog'] },
      { questionId: 'question_2', questionType: 'single_choice', stem: 'Choose the color.', options: ['red', 'blue'] },
      { questionId: 'question_3', questionType: 'single_choice', stem: 'Choose the place.', options: ['home', 'school'] },
    ], answerKeys: [
      { questionId: 'question_1', correctAnswer: 'cat', explanation: 'The audio says cat.' },
      { questionId: 'question_2', correctAnswer: 'red', explanation: 'The audio says red.' },
      { questionId: 'question_3', correctAnswer: 'home', explanation: 'The audio says home.' },
    ], clips: [
      { questionId: 'question_1', segmentId: 'segment_1', startMs: 0, endMs: 4000 },
      { questionId: 'question_2', segmentId: 'segment_2', startMs: 4000, endMs: 8000 },
      { questionId: 'question_3', segmentId: 'segment_3', startMs: 8000, endMs: 12000 },
    ], continuousPlaybackEnforced: true };
  let revoked = false;
  const receipts = new Map<string, TeacherMediaOperationReceipt>();
  const audits: string[] = [];
  const repository: TeacherMediaUnitOfWork = {
    async transaction(work) { return work({
      async find() { return record; },
      async save(next, expected) { if (record.recordVersion !== expected) return false; record = next; return true; },
      async findReceipt(_org, actorId, operationId) { return receipts.get(`${actorId}:${operationId}`) ?? null; },
      async saveReceipt(_org, actorId, operationId, receipt) { receipts.set(`${actorId}:${operationId}`, receipt); return true; },
      async hasCurrentTeacherClassGrant() { return !revoked; },
      async appendAudit(entry) { audits.push(`${entry.action}:${entry.result}`); },
    }); },
  };
  const grants: NativeAdminGrantReader = {
    async currentAuthorizationVersion() { return revoked ? 4 : 3; },
    async findGrant() { return { organizationId: 'org_demo', teacherId: 'teacher_reviewer',
      status: revoked ? 'revoked' as const : 'active' as const,
      permissions: ['media.review'] as const, scope: { organizationWide: false, classIds: ['class_demo'] }, version: 1 }; },
  };
  return { service: new TeacherMediaReviewService(repository, grants,
    { nowIso: () => '2026-10-02T08:00:00+08:00' }), audits,
    revoke() { revoked = true; }, get record() { return record; } };
}

describe('teacher media review lifecycle', () => {
  it('requires owner submission, independent reviewer approval and audited publication', async () => {
    const state = fixture();
    const pending = await state.service.submitForReview(owner, 'media_demo', 1, 'operation_submit_01');
    expect(pending.status).toBe('pending_review');
    await expect(state.service.review(owner, 'media_demo', 2, 'operation_self_01', 'approved', ''))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    const approved = await state.service.review(reviewer, 'media_demo', 2, 'operation_review_01', 'approved', '');
    expect(approved).toMatchObject({ status: 'approved', reviewVersion: 2,
      copyrightStatus: 'verified', recordVersion: 3 });
    expect(await state.service.publish(reviewer, 'media_demo', 3, 'operation_publish_01'))
      .toMatchObject({ status: 'published', recordVersion: 4 });
    expect(state.audits).toEqual(['submit:succeeded', 'approved:denied',
      'approved:succeeded', 'publish:succeeded']);
    expect(await state.service.publish(reviewer, 'media_demo', 3, 'operation_publish_01'))
      .toMatchObject({ status: 'published', recordVersion: 4 });
    state.revoke();
    await expect(state.service.publish(reviewer, 'media_demo', 3, 'operation_publish_01'))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
