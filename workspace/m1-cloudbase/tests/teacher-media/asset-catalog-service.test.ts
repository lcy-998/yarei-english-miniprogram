import { describe, expect, it } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import type { OrgContentRepository } from '../../src/org-content/repository';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import { TeacherAssetCatalogService } from '../../src/teacher-media/asset-catalog-service';
import { buildCentralMediaDraft, buildVerifiedCentralMediaResource,
  projectPublicMediaForOrganization } from '../../src/teacher-media/asset-import';
import type { TeacherMediaCandidate } from '../../src/teacher-media/publish-gate';

const actor: TrustedActorContext = { requestId: 'request_teacher_asset', sessionId: 'session_teacher',
  actorUserId: 'teacher_demo', actorRole: 'teacher', organizationId: 'org_demo',
  platformSubjectDigest: 'digest_teacher', permissions: ['content.read'],
  scopeIds: ['class_one'], authzVersion: 1 };
const clock = { nowIso: () => '2026-10-03T08:00:00.000Z' };
const authorized = { listActiveTeacherGrants: async () => [{ classId: 'class_one',
  permissions: ['content.read'] }] } as unknown as OrgContentRepository;

function resource(withOrigin = true) {
  return { _id: 'audio_demo', organizationId: 'org_demo', schemaVersion: 1 as const,
    version: 1, deletedAt: null, type: 'listening', title: '虚构动物听力',
    status: 'published', contentVersion: 3, grade: '三年级', textbook: '测试教材', unit: 'Unit 3',
    visibility: { type: 'classes', classIds: ['class_one'] },
    payload: {
      ...(withOrigin ? { assetLibrary: { kind: 'central_asset_library',
        resourceId: 'audio_demo', version: 3, manifestSha256: 'c'.repeat(64),
        reviewId: 'review_audio_demo', importedBy: 'asset_editor_demo', reviewStatus: 'approved' } } : {}),
      teacherMedia: { allowedClassIds: ['class_one'], reviewVersion: 3,
        reviewedBy: 'reviewer_demo', reviewedAt: '2026-10-03T07:00:00.000Z',
        copyrightStatus: 'verified', copyrightEvidenceKey: 'cloud://private/proof',
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
        continuousPlaybackEnforced: true },
    } };
}

describe('central asset teacher catalog', () => {
  it('turns a processed library package into a pending central draft without teacher ownership', () => {
    const media = { ...resource().payload.teacherMedia,
      id: 'audio_demo', organizationId: 'org_demo', title: '虚构动物听力',
      kind: 'listening', version: 3, status: 'draft' } as unknown as TeacherMediaCandidate;
    const draft = buildCentralMediaDraft({ resourceId: 'audio_demo', organizationId: 'org_demo',
      contentVersion: 3, manifestSha256: 'c'.repeat(64), reviewId: 'review_audio_demo',
      importedBy: 'asset_editor_demo', grade: '三年级',
      visibility: { type: 'classes', classIds: ['class_one'] }, processedMedia: media });
    expect(draft).toMatchObject({ status: 'draft', payload: {
      assetLibrary: { reviewStatus: 'pending', importedBy: 'asset_editor_demo' },
      teacherMedia: { status: 'pending_review', reviewVersion: null },
    } });
    expect(JSON.stringify(draft)).not.toContain('ownerTeacherId');
    expect(() => buildCentralMediaDraft({ resourceId: 'audio_demo', organizationId: 'org_demo',
      contentVersion: 3, manifestSha256: 'c'.repeat(64), reviewId: 'review_audio_demo',
      importedBy: 'asset_editor_demo', grade: '三年级',
      visibility: { type: 'classes', classIds: ['class_one'] },
      processedMedia: { ...media, clips: [] } })).toThrow();
  });

  it('lists approved class assets and signs only an audited, read-only preview', async () => {
    const database = new FakeDocumentDatabase({ learning_resources: [resource()], operation_logs: [] });
    const service = new TeacherAssetCatalogService(database, authorized, {
      async getTempFileURL({ fileList }) { return { fileList: fileList.map(item => ({
        fileID: item.fileID, tempFileURL: 'https://example.test/audio.mp3', code: 'SUCCESS',
      })) }; },
    }, clock);
    const page = await service.list(actor, { kind: 'listening', keyword: '动物',
      targetClassIds: ['class_one'] }, { limit: 20, offset: 0 });
    expect(page).toMatchObject({ items: [{ id: 'audio_demo', questionCount: 3 }], nextOffset: null });
    expect(page.items[0]?.allowedClassIds).toEqual(['class_one']);
    expect(await service.facets(actor, 'listening', ['class_one']))
      .toEqual([{ grade: '三年级', textbook: '测试教材', unit: 'Unit 3' }]);
    expect(JSON.stringify(page)).not.toContain('correctAnswer');
    const preview = await service.preview(actor, 'audio_demo', ['class_one']);
    expect(preview).toMatchObject({ playback: { temporaryUrl: 'https://example.test/audio.mp3' },
      clips: [{ segmentId: 'clip1' }, { segmentId: 'clip2' }, { segmentId: 'clip3' }],
      questions: [{ questionId: 'q1' }, { questionId: 'q2' }, { questionId: 'q3' }] });
    expect(JSON.stringify(preview)).not.toContain('correctAnswer');
    expect(JSON.stringify(preview)).not.toContain('cloud://');
    expect((await database.find('operation_logs', { organizationId: 'org_demo' })))
      .toMatchObject([{ action: 'content-query.previewTeacherAsset', targetId: 'audio_demo' }]);
  });

  it('makes a fully checked new asset visible to every authorized teaching class', async () => {
    const base = resource();
    const media = { ...base.payload.teacherMedia, allowedClassIds: [],
      id: 'audio_demo', organizationId: 'org_demo', title: '虚构动物听力',
      kind: 'listening', version: 3, status: 'draft' } as unknown as TeacherMediaCandidate;
    const ready = buildVerifiedCentralMediaResource({ resourceId: 'audio_demo',
      organizationId: 'org_demo', contentVersion: 3, manifestSha256: 'c'.repeat(64),
      sourceSha256: 'b'.repeat(64), reviewId: 'review_audio_demo',
      importedBy: 'asset_editor_demo', verifiedAt: clock.nowIso(),
      grade: '三年级', processedMedia: media });
    expect(ready).toMatchObject({ status: 'published', visibility: { type: 'organization' },
      payload: { assetLibrary: { reviewStatus: 'user_acceptance',
        acceptanceStatus: 'pending_user_acceptance' },
      teacherMedia: { catalogScope: 'all_teachers', status: 'published' } } });
    const grants = { listActiveTeacherGrants: async () => [{ classId: 'class_two',
      permissions: ['content.read'] }] } as unknown as OrgContentRepository;
    const database = new FakeDocumentDatabase({ learning_resources: [ready] });
    const service = new TeacherAssetCatalogService(database, grants, undefined, clock);
    const otherClassActor = { ...actor, scopeIds: ['class_two'] };
    expect(await service.list(otherClassActor, { kind: 'listening' }, { limit: 20, offset: 0 }))
      .toMatchObject({ items: [{ id: 'audio_demo', allowedClassIds: ['class_two'] }] });
    const classlessService = new TeacherAssetCatalogService(database,
      { listActiveTeacherGrants: async () => [] } as unknown as OrgContentRepository,
      undefined, clock);
    expect(await classlessService.list({ ...actor, permissions: [], scopeIds: [] },
      { kind: 'listening' }, { limit: 20, offset: 0 }))
      .toMatchObject({ items: [{ id: 'audio_demo', allowedClassIds: [] }] });
    const anotherSchool = projectPublicMediaForOrganization(ready, 'org_other', 'audio_other');
    const otherSchoolDb = new FakeDocumentDatabase({ learning_resources: [ready, anotherSchool] });
    const otherSchoolService = new TeacherAssetCatalogService(otherSchoolDb, grants, undefined, clock);
    expect(await otherSchoolService.list({ ...otherClassActor, organizationId: 'org_other' },
      { kind: 'listening' }, { limit: 20, offset: 0 }))
      .toMatchObject({ items: [{ id: 'audio_other' }] });
    expect(() => projectPublicMediaForOrganization({ ...resource(),
      _id: 'private_source' }, 'org_other', 'private_other')).toThrow();
    expect(() => buildVerifiedCentralMediaResource({ resourceId: 'audio_demo',
      organizationId: 'org_demo', contentVersion: 3, manifestSha256: 'c'.repeat(64),
      sourceSha256: 'b'.repeat(64), reviewId: 'review_audio_demo',
      importedBy: 'asset_editor_demo', verifiedAt: clock.nowIso(), grade: '三年级',
      processedMedia: { ...media, clips: [] } })).toThrow();
  });

  it('imports a source-verified teaching asset without a pending acceptance label', async () => {
    const base = resource();
    const media = { ...base.payload.teacherMedia, allowedClassIds: [],
      id: 'audio_formal', organizationId: 'org_demo', title: 'Rooms and actions',
      kind: 'listening', version: 1, status: 'draft' } as unknown as TeacherMediaCandidate;
    const formal = buildVerifiedCentralMediaResource({ resourceId: 'audio_formal',
      organizationId: 'org_demo', contentVersion: 1, manifestSha256: 'c'.repeat(64),
      sourceSha256: 'b'.repeat(64), reviewId: 'review_audio_formal',
      importedBy: 'controlled_import', verifiedAt: clock.nowIso(), grade: '三年级',
      releaseMode: 'formal_reusable', processedMedia: media });
    expect(formal).toMatchObject({ status: 'published', testOnly: false,
      visibility: { type: 'organization' }, payload: {
        assetLibrary: { reviewStatus: 'source_verified_reusable', testOnly: false },
        teacherMedia: { catalogScope: 'all_teachers', status: 'published' },
      } });
    expect(JSON.stringify(formal)).not.toContain('pending_user_acceptance');
    const projection = projectPublicMediaForOrganization(formal, 'org_other', 'audio_formal_other');
    expect(projection).toMatchObject({ organizationId: 'org_other', testOnly: false,
      payload: { assetLibrary: { reviewStatus: 'source_verified_reusable',
        sourcePublicId: 'audio_formal' } } });
    const grants = { listActiveTeacherGrants: async () => [{ classId: 'class_two',
      permissions: ['content.read'] }] } as unknown as OrgContentRepository;
    const service = new TeacherAssetCatalogService(new FakeDocumentDatabase({
      learning_resources: [formal, projection],
    }), grants, undefined, clock);
    const page = await service.list({ ...actor, scopeIds: ['class_two'] },
      { kind: 'listening' }, { limit: 20, offset: 0 });
    expect(page.items).toMatchObject([{ id: 'audio_formal', allowedClassIds: ['class_two'] }]);
    expect(JSON.stringify(page)).not.toContain('pending_user_acceptance');
  });

  it('returns only the caller’s granted class IDs for target selection', async () => {
    const original = resource();
    const wider = { ...original,
      visibility: { type: 'classes', classIds: ['class_one', 'class_two'] },
      payload: { ...original.payload, teacherMedia: {
        ...original.payload.teacherMedia, allowedClassIds: ['class_one', 'class_two'],
      } },
    };
    const database = new FakeDocumentDatabase({ learning_resources: [wider] });
    const service = new TeacherAssetCatalogService(database, authorized, undefined, clock);
    const page = await service.list(actor, { kind: 'listening' }, { limit: 20, offset: 0 });
    expect(page.items[0]?.allowedClassIds).toEqual(['class_one']);
  });

  it('includes facet values that appear beyond the first resource page', async () => {
    const rows = Array.from({ length: 51 }, (_, index) => {
      const base = resource();
      const id = `audio_demo_${index}`;
      return { ...base, _id: id, title: `虚构音频 ${index}`,
        grade: index === 50 ? '四年级' : '三年级',
        payload: { ...base.payload, assetLibrary: {
          ...base.payload.assetLibrary, resourceId: id,
        } },
      };
    });
    const database = new FakeDocumentDatabase({ learning_resources: rows });
    const service = new TeacherAssetCatalogService(database, authorized, undefined, clock);
    const facets = await service.facets(actor, 'listening');
    expect(facets.map(item => item.grade)).toEqual(['三年级', '四年级']);
  });

  it('hides teacher-owned records and rejects cross-class or non-teacher requests', async () => {
    const database = new FakeDocumentDatabase({ learning_resources: [resource(false)], operation_logs: [] });
    const service = new TeacherAssetCatalogService(database, authorized, undefined, clock);
    expect(await service.list(actor, { kind: 'listening' }, { limit: 20, offset: 0 }))
      .toEqual({ items: [], nextOffset: null });
    await expect(service.preview(actor, 'audio_demo')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.list(actor, { kind: 'listening', targetClassIds: ['class_two'] },
      { limit: 20, offset: 0 })).resolves.toMatchObject({ items: [] });
    await expect(service.list({ ...actor, actorRole: 'student' }, { kind: 'listening' },
      { limit: 20, offset: 0 })).resolves.toMatchObject({ items: [] });
  });
});
