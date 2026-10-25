import { describe, expect, it } from 'vitest'
import type { TrustedActorContext } from '../../src/auth/trusted-actor'
import { DocumentNativeAdminGrantRepository, nativeAdminGrantId } from '../../src/native-admin/document-grant-repository'
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database'
import { createTaskCoreDocumentRepository } from '../../src/repositories/task-core-document-adapter'
import { AssetReviewService } from '../../src/teacher-media/asset-review-service'
import { PublicMediaDistributionService, publicMediaProjectionId } from '../../src/teacher-media/public-media-distribution'
import type { TeacherMediaCandidate } from '../../src/teacher-media/publish-gate'

const sourceId = 'central_audio'
const clock = { nowIso: () => '2026-10-06T04:00:00.000Z' }
const base = (organizationId: string) => ({ organizationId, schemaVersion: 1 as const,
  version: 1, deletedAt: null })
const actor: TrustedActorContext = { requestId: 'request_admin', sessionId: 'session_admin',
  actorUserId: 'admin_two', actorRole: 'teacher', organizationId: 'org_two',
  platformSubjectDigest: 'digest_admin', permissions: [], scopeIds: ['class_one'],
  authzVersion: 1 }

function candidate(): TeacherMediaCandidate {
  return { id: sourceId, organizationId: 'org_one', title: '公共虚构听力',
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

describe('controlled public media distribution', () => {
  it('materializes every school, retries safely, syncs a new school, and revokes centrally', async () => {
    const db = new FakeDocumentDatabase({ organizations: [
      { _id: 'org_one', ...base('org_one'), status: 'active' },
      { _id: 'org_two', ...base('org_two'), status: 'active' },
    ], users: [{ _id: 'admin_two', ...base('org_two'), authorizationVersion: 1,
      status: 'active' }],
    native_admin_grants: [{ _id: nativeAdminGrantId('org_two', 'admin_two'),
      ...base('org_two'), teacherId: 'admin_two', status: 'active',
      permissions: ['media.review'], scope: { organizationWide: true, classIds: [] } }],
    learning_resources: [], operation_logs: [], native_admin_content_operations: [] })
    const distribution = new PublicMediaDistributionService(db, clock)
    const input = { resourceId: sourceId, organizationId: 'org_one',
      contentVersion: 1, manifestSha256: 'c'.repeat(64), sourceSha256: 'b'.repeat(64),
      reviewId: 'controlled_review', importedBy: 'asset_editor',
      verifiedAt: clock.nowIso(), grade: '三年级', processedMedia: candidate() }
    expect(await distribution.importVerified(input)).toMatchObject({
      projectedOrganizations: ['org_one', 'org_two'] })
    expect(await distribution.importVerified(input)).toMatchObject({ sourceId })
    const oneId = sourceId
    const twoId = publicMediaProjectionId(sourceId, 'org_two')
    const repository = createTaskCoreDocumentRepository(db)
    expect(await repository.findResource('org_one', oneId)).toMatchObject({ id: oneId })
    expect(await repository.findResource('org_two', twoId)).toMatchObject({ id: twoId })
    await db.runTransaction(async tx => {
      await tx.create('organizations', { _id: 'org_three', ...base('org_three'), status: 'active' })
    })
    expect(await distribution.syncOrganization('org_three')).toBe(1)
    const threeId = publicMediaProjectionId(sourceId, 'org_three')
    expect(await repository.findResource('org_three', threeId)).toMatchObject({ id: threeId })
    const review = new AssetReviewService(db, new DocumentNativeAdminGrantRepository(db), clock)
    await review.unpublish(actor, twoId, 1, 'operation_unpublish_public_1', '音频片段需要修正')
    expect(await db.get('learning_resources', sourceId)).toMatchObject({ status: 'offline' })
    expect(await repository.findResource('org_two', twoId)).toBeNull()
    expect(await repository.findResource('org_three', threeId)).toBeNull()
    await expect(distribution.syncOrganization('org_three')).resolves.toBe(0)
  })
})
