import { describe, expect, it } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import { PRIVATE_VIDEO_COLLECTION, TeacherPrivateVideoService,
  type PrivateVideoProcessed, type PrivateVideoQuestion } from '../../src/teacher-media/private-video';
import { TeacherAssetCatalogService } from '../../src/teacher-media/asset-catalog-service';
import type { OrgContentRepository } from '../../src/org-content/repository';
import type { CloudBasePlaybackSdkPort } from '../../src/student-work/cloudbase-playback';

const owner: TrustedActorContext = { requestId: 'request_owner', sessionId: 'session_owner',
  actorUserId: 'teacher_owner', actorRole: 'teacher', organizationId: 'org_demo',
  platformSubjectDigest: 'digest_owner', permissions: ['task.publish', 'content.read'],
  scopeIds: ['class_demo'], authzVersion: 1 };
const other = { ...owner, actorUserId: 'teacher_other' };
const clock = { nowIso: () => '2026-10-16T20:00:00+08:00' };
const grants = { async listActiveTeacherGrants() { return [{ id: 'grant_owner',
  organizationId: 'org_demo', teacherId: 'teacher_owner', classId: 'class_demo',
  permissions: ['task.publish', 'content.read'] as const, status: 'active' as const,
  grantedBy: 'admin_demo', grantedAt: clock.nowIso(), version: 1 }]; } };
const question = (id: string): PrivateVideoQuestion => ({ questionId: id,
  questionType: 'single_choice', stem: `Question ${id}`, options: ['A', 'B'],
  correctAnswer: 'A', explanation: 'A is correct.' });
const processed = (durationMs = 12_000): PrivateVideoProcessed => ({
  mediaAssetKey: 'cloud://env_demo/teacher-videos/private/video.mp4',
  mediaSha256: 'a'.repeat(64), durationMs,
  sourceScanEvidence: { engine: 'clamav', signatureVersion: 'test-1',
    scannedAt: '2026-10-16T19:58:00+08:00', scannedSha256: 'b'.repeat(64), reportId: 'source_report' },
  transcodeEvidence: { engine: 'ffmpeg', engineVersion: 'test-1',
    transcodedAt: '2026-10-16T19:59:00+08:00', sourceSha256: 'b'.repeat(64),
    outputSha256: 'a'.repeat(64), outputAssetKey: 'cloud://env_demo/teacher-videos/private/video.mp4' },
  scanEvidence: { engine: 'clamav', signatureVersion: 'test-1',
    scannedAt: '2026-10-16T20:00:00+08:00', scannedSha256: 'a'.repeat(64), reportId: 'output_report' },
});

describe('teacher private video lifecycle', () => {
  it('publishes a directly verified MP4 without a separate worker', async () => {
    const db = new FakeDocumentDatabase({});
    const service = new TeacherPrivateVideoService(db, {
      async process(fileId) { return { mediaAssetKey: fileId.replace('/staging/', '/private/'),
        mediaSha256: 'c'.repeat(64), durationMs: 10_000,
        directUploadEvidence: { verifiedAt: clock.nowIso(), mediaSha256: 'c'.repeat(64),
          mediaAssetKey: fileId.replace('/staging/', '/private/'), durationMs: 10_000,
          videoCodec: 'h264' as const, audioCodec: 'aac' as const } }; },
    }, clock, grants);
    expect(await service.available(owner)).toBe(true);
    const draft = await service.save(owner, { title: '虚构直传视频', questions: [question('q_1')] });
    const upload = await service.beginUpload(owner, draft.id, draft.version);
    const ready = await service.seal(owner, draft.id, upload.version,
      `cloud://env_demo/${upload.stagingPath}`);
    expect(ready.status).toBe('ready');
    expect((await service.publish(owner, draft.id, ready.version)).status).toBe('published');
  });
  it('keeps ownership, processing proof, questions and publication isolated', async () => {
    const db = new FakeDocumentDatabase({});
    let dispatched: { organizationId: string; videoId: string; processingToken: string } | null = null;
    const service = new TeacherPrivateVideoService(db,
      { async process() { return processed(); } }, clock, grants, undefined,
      { async dispatch(job) { dispatched = job; } });
    expect(await service.available(owner)).toBe(true);
    expect(await service.available({ ...owner, actorRole: 'student' })).toBe(false);
    const draft = await service.save(owner, { title: '虚构教师短讲', questions: [question('q_1')] });
    await expect(service.get(other, draft.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const upload = await service.beginUpload(owner, draft.id, draft.version);
    expect(upload.stagingPath).toContain(`/teacher_owner/${draft.id}/`);
    const sealed = await service.seal(owner, draft.id, upload.version,
      `cloud://env_demo/${upload.stagingPath}`);
    expect(sealed.status).toBe('processing');
    expect(dispatched).not.toBeNull();
    expect(await service.processAccepted({ ...dispatched!, processingToken: '0'.repeat(32) }))
      .toBe('stale');
    expect(await service.processAccepted(dispatched!)).toBe('ready');
    expect(await service.processAccepted(dispatched!)).toBe('stale');
    const ready = await service.get(owner, draft.id);
    expect(ready.status).toBe('ready');
    const published = await service.publish(owner, draft.id, ready.version);
    expect(published.status).toBe('published');
    const resource = await db.get('learning_resources', draft.id);
    expect(resource).toMatchObject({ status: 'published', teacherPrivateOwnerId: 'teacher_owner',
      contentVersion: 1, payload: { teacherPrivate: { ownerTeacherId: 'teacher_owner' } } });
    expect((resource?.payload as { teacherMedia?: { answerKeys?: unknown[] } })?.teacherMedia?.answerKeys).toHaveLength(1);
    const catalog = new TeacherAssetCatalogService(db, grants as unknown as OrgContentRepository,
      { async getTempFileURL() { return { fileList: [{ fileID: 'cloud://env_demo/teacher-videos/private/video.mp4',
        tempFileURL: 'https://example.test/private-video.mp4', code: 'SUCCESS' }] }; } } as CloudBasePlaybackSdkPort, clock);
    expect((await catalog.list(owner, { kind: 'video', scope: 'mine' }, { limit: 20, offset: 0 })).items)
      .toMatchObject([{ id: draft.id, privateToTeacher: true, questionCount: 1 }]);
    expect((await catalog.list(owner, { kind: 'video' }, { limit: 20, offset: 0 })).items)
      .toEqual([]);
    await expect(catalog.preview(other, draft.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await catalog.preview(owner, draft.id)).playback.temporaryUrl).toContain('private-video.mp4');
    const revised = await service.save(owner, { title: '虚构教师短讲新版',
      questions: [question('q_1'), question('q_2')] }, draft.id, published.version);
    expect(revised).toMatchObject({ status: 'ready', contentVersion: 2 });
    expect((await db.get('learning_resources', draft.id))?.status).toBe('draft');
    const republished = await service.publish(owner, draft.id, revised.version);
    expect((await db.get('learning_resources', draft.id))?.contentVersion).toBe(2);
    const withdrawn = await service.withdraw(owner, draft.id, republished.version);
    expect(withdrawn.status).toBe('offline');
    expect((await db.get('learning_resources', draft.id))?.status).toBe('offline');
    expect(await db.get(PRIVATE_VIDEO_COLLECTION, draft.id)).not.toBeNull();
    expect((await db.find('operation_logs', { organizationId: owner.organizationId }))
      .filter(row => row.targetId === draft.id).length).toBeGreaterThanOrEqual(6);
  });

  it('rejects seven questions, overlong video and missing processor', async () => {
    const db = new FakeDocumentDatabase({});
    let dispatched: { organizationId: string; videoId: string; processingToken: string } | null = null;
    const service = new TeacherPrivateVideoService(db,
      { async process() { return processed(601_000); } }, clock, grants, undefined,
      { async dispatch(job) { dispatched = job; } });
    await expect(service.save(owner, { title: 'Too many',
      questions: Array.from({ length: 7 }, (_, i) => question(`q_${i}`)) }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect((await service.save(owner, { title: 'Six questions',
      questions: Array.from({ length: 6 }, (_, i) => question(`q_${i}`)) })).questionCount).toBe(6);
    const draft = await service.save(owner, { title: 'Short lesson', questions: [question('q_1')] });
    const revoked = new TeacherPrivateVideoService(db, { async process() { return processed(); } },
      clock, { async listActiveTeacherGrants() { return []; } });
    await expect(revoked.beginUpload(owner, draft.id, draft.version))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    const upload = await service.beginUpload(owner, draft.id, draft.version);
    const unavailable = new TeacherPrivateVideoService(db, null, clock, grants);
    expect(await unavailable.available(owner)).toBe(false);
    await expect(unavailable.seal(owner, draft.id, upload.version,
      `cloud://env_demo/${upload.stagingPath}`)).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    expect((await service.seal(owner, draft.id, upload.version,
      `cloud://env_demo/${upload.stagingPath}`)).status).toBe('processing');
    expect(await service.processAccepted(dispatched!)).toBe('failed');
    expect((await service.get(owner, draft.id)).processingError).toBe('MEDIA_INVALID');
    const noProcessor = new TeacherPrivateVideoService(db, null, clock, grants, undefined,
      { async dispatch(job) { dispatched = job; } });
    const failed = await service.get(owner, draft.id);
    expect((await noProcessor.retryProcessing(owner, draft.id, failed.version)).status)
      .toBe('processing');
    expect(await noProcessor.processAccepted(dispatched!)).toBe('failed');
    expect((await service.get(owner, draft.id)).processingError).toBe('SERVICE_UNAVAILABLE');
    const workerAudits = (await db.find('operation_logs', { organizationId: owner.organizationId }))
      .filter(row => row.action === 'teacher-private-video-worker.failed');
    expect(new Set(workerAudits.map(row => row.requestId)).size).toBe(2);
  });

  it('returns one draft when the same create operation is retried after a lost response', async () => {
    const db = new FakeDocumentDatabase({});
    const service = new TeacherPrivateVideoService(db, null, clock, grants);
    const input = { title: '虚构短讲', questions: [question('q_1')] };
    const first = await service.save(owner, input, undefined, undefined, 'operation_teacher_video_create');
    const replay = await service.save(owner, input, undefined, undefined, 'operation_teacher_video_create');
    expect(replay.id).toBe(first.id);
    expect((await service.list(owner))).toHaveLength(1);
    await expect(service.save(owner, { ...input, title: '不同视频' }, undefined, undefined,
      'operation_teacher_video_create')).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
