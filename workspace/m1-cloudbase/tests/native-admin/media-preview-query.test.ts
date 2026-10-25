import { describe, expect, it } from 'vitest'
import type { TrustedActorContext } from '../../src/auth/trusted-actor'
import { NativeAdminDataService } from '../../src/native-admin/data-service'
import { DocumentNativeAdminGrantRepository, nativeAdminGrantId } from '../../src/native-admin/document-grant-repository'
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database'
import { buildVerifiedCentralMediaResource } from '../../src/teacher-media/asset-import'
import type { TeacherMediaCandidate } from '../../src/teacher-media/publish-gate'

const actor: TrustedActorContext = { requestId: 'request_media', sessionId: 'session_media',
  actorUserId: 'teacher_demo', actorRole: 'teacher', organizationId: 'org_demo',
  platformSubjectDigest: 'digest_teacher', permissions: [], scopeIds: ['class_one'],
  authzVersion: 1 }

function media(): TeacherMediaCandidate {
  return { id: 'audio_demo', organizationId: 'org_demo', title: '虚构听力',
    kind: 'listening', version: 1, status: 'draft', reviewVersion: null,
    reviewedBy: null, reviewedAt: null, copyrightStatus: 'unverified',
    copyrightEvidenceKey: 'cloud://private/proof', scanStatus: 'clean',
    transcodeStatus: 'ready', mediaAssetKey: 'cloud://private/audio.mp3',
    mediaSha256: 'a'.repeat(64), durationMs: 10000, allowedClassIds: [],
    questionIds: ['q1', 'q2', 'q3'], questions: [
      { questionId: 'q1', questionType: 'single_choice', stem: 'Choose an animal', options: ['cat', 'dog'] },
      { questionId: 'q2', questionType: 'single_choice', stem: 'Choose a color', options: ['red', 'blue'] },
      { questionId: 'q3', questionType: 'single_choice', stem: 'Choose a place', options: ['home', 'school'] },
    ], answerKeys: [
      { questionId: 'q1', correctAnswer: 'cat', explanation: 'private answer' },
      { questionId: 'q2', correctAnswer: 'red', explanation: 'private answer' },
      { questionId: 'q3', correctAnswer: 'home', explanation: 'private answer' },
    ], clips: [
      { questionId: 'q1', segmentId: 'clip1', startMs: 0, endMs: 3000 },
      { questionId: 'q2', segmentId: 'clip2', startMs: 3000, endMs: 6000 },
      { questionId: 'q3', segmentId: 'clip3', startMs: 6000, endMs: 10000 },
    ],
    continuousPlaybackEnforced: true,
    sourceScanEvidence: { engine: 'ci', signatureVersion: 'v1',
      scannedAt: '2026-10-06T01:00:00.000Z', scannedSha256: 'b'.repeat(64),
      reportId: 'source_scan' },
    transcodeEvidence: { engine: 'ci', engineVersion: 'v1',
      transcodedAt: '2026-10-06T02:00:00.000Z', sourceSha256: 'b'.repeat(64),
      outputSha256: 'a'.repeat(64), outputAssetKey: 'cloud://private/audio.mp3' },
    scanEvidence: { engine: 'ci', signatureVersion: 'v1',
      scannedAt: '2026-10-06T03:00:00.000Z', scannedSha256: 'a'.repeat(64),
      reportId: 'output_scan' } }
}

describe('A-08 protected media preview and history', () => {
  it('signs a short preview and returns clips without answer keys', async () => {
    const row = buildVerifiedCentralMediaResource({ resourceId: 'audio_demo',
      organizationId: 'org_demo', contentVersion: 1, manifestSha256: 'c'.repeat(64),
      sourceSha256: 'b'.repeat(64), reviewId: 'review_demo',
      importedBy: 'asset_editor', verifiedAt: '2026-10-06T04:00:00.000Z',
      grade: '三年级', processedMedia: media() })
    const base = { organizationId: 'org_demo', schemaVersion: 1 as const,
      version: 1, deletedAt: null }
    const db = new FakeDocumentDatabase({ users: [{ _id: 'teacher_demo', ...base,
      authorizationVersion: 1, status: 'active' }],
    native_admin_grants: [{ _id: nativeAdminGrantId('org_demo', 'teacher_demo'), ...base,
      teacherId: 'teacher_demo', status: 'active', permissions: ['media.review'],
      scope: { organizationWide: true, classIds: [] } }],
    learning_resources: [row], operation_logs: [{ _id: 'issue_one', ...base,
      targetType: 'learning_resource', targetId: 'audio_demo',
      action: 'asset_library.media.issue', actorUserId: 'teacher_demo',
      occurredAt: '2026-10-06T05:00:00.000Z',
      metadata: { issueReason: '片段有误' } }] })
    const service = new NativeAdminDataService(new DocumentNativeAdminGrantRepository(db),
      db, { getTempFileURL: async ({ fileList }) => ({ fileList: fileList.map(file => ({
        fileID: file.fileID, tempFileURL: 'https://example.test/audio.mp3', code: 'SUCCESS' })) }) })
    const preview = await service.getMediaPreview(actor, 'audio_demo')
    expect(await service.listRecords(actor, 'media', 20, 0,
      { mediaKind: 'video' })).toMatchObject({ items: [] })
    expect(await service.listRecords(actor, 'media', 20, 0,
      { mediaKind: 'listening' })).toMatchObject({ items: [{ id: 'audio_demo' }] })
    expect(preview).toMatchObject({ temporaryUrl: 'https://example.test/audio.mp3',
      clips: [
        { questionId: 'q1', startMs: 0, endMs: 3000 },
        { questionId: 'q2', startMs: 3000, endMs: 6000 },
        { questionId: 'q3', startMs: 6000, endMs: 10000 },
      ] })
    expect(JSON.stringify(preview)).not.toContain('correctAnswer')
    expect(JSON.stringify(preview)).not.toContain('cloud://')
    expect(await service.listMediaAudit(actor, 'audio_demo', 20, 0))
      .toMatchObject({ items: [{ action: 'asset_library.media.issue',
        issueReason: '片段有误' }], nextOffset: null })
    await expect(service.getMediaPreview({ ...actor, authzVersion: 0 }, 'audio_demo'))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})
