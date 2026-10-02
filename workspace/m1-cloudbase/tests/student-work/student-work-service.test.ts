import { describe, expect, it, vi } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { InMemoryStudentWorkRepository } from '../../src/student-work/memory-repository';
import type { RecordingSealPort } from '../../src/student-work/repository';
import { StudentWorkService } from '../../src/student-work/service';
import type { WorkMaterial } from '../../src/student-work/types';

const actor: TrustedActorContext = { requestId: 'request_student_work', sessionId: 'session_student_work',
  actorUserId: 'student_demo', actorRole: 'student', organizationId: 'org_demo',
  platformSubjectDigest: 'digest_student', permissions: [], scopeIds: ['student_demo'], authzVersion: 1 };
const sealed = { fileId: 'cloud://demo/private/student-work-demo-1.mp3', contentSha256: 'a'.repeat(64),
  sizeBytes: 120_000, durationMs: 12_000, codec: 'mp3' as const };
let nextId = 0;

function fixture(extraMaterials: readonly WorkMaterial[] = []) {
  let now = '2026-09-27T09:00:00+08:00';
  const repository = new InMemoryStudentWorkRepository({
    memberships: [{ organizationId: 'org_demo', studentId: 'student_demo', classId: 'class_demo', status: 'active' },
      { organizationId: 'org_demo', studentId: 'other_student', classId: 'other_class', status: 'active' }],
    materials: [{ id: 'material_animals', organizationId: 'org_demo', title: '动物配音',
      contentVersion: 'demo-v1', status: 'published', visibility: { type: 'classes', classIds: ['class_demo'] },
      demonstrationFileId: 'cloud://demo/materials/animals.mp4', subtitle: 'Animals are here.' },
      { id: 'material_hidden', organizationId: 'org_demo', title: '他班配音',
        contentVersion: 'demo-v1', status: 'published', visibility: { type: 'classes', classIds: ['other_class'] },
        demonstrationFileId: 'cloud://demo/materials/hidden.mp4', subtitle: 'Hidden.' },
      ...extraMaterials],
  });
  const inspectAndSeal = vi.fn<RecordingSealPort['inspectAndSeal']>(async () => sealed);
  const service = new StudentWorkService(repository, { inspectAndSeal },
    { nowIso: () => now },
    { next: (prefix) => `${prefix}_demo_${++nextId}` },
    { async temporaryUrl() { return 'https://example.test/private/work.mp3?short-lived=1'; } });
  return { repository, service, inspectAndSeal, setNow: (value: string) => { now = value; } };
}

describe('M2 autonomous student work service', () => {
  it('searches authorized materials in pages and reads a selected item without exposing other classes', async () => {
    const { service } = fixture([{ id: 'material_zoo', organizationId: 'org_demo', title: 'Zoo Friends 配音',
      contentVersion: 'demo-v1', status: 'published', visibility: { type: 'classes', classIds: ['class_demo'] },
      demonstrationFileId: 'cloud://demo/materials/zoo.mp4', subtitle: 'Friends at the zoo.',
      grade: '三年级', textbook: '演示教材', unit: 'Unit 1' }]);
    expect(await service.searchMaterials(actor, '', 0, 1)).toMatchObject({ total: 2,
      items: [{ id: 'material_animals' }], nextOffset: 1 });
    expect(await service.searchMaterials(actor, '', 1, 1)).toMatchObject({ total: 2,
      items: [{ id: 'material_zoo' }], nextOffset: null });
    expect(await service.searchMaterials(actor, 'zoo', 0, 20)).toMatchObject({ total: 1,
      items: [{ id: 'material_zoo' }] });
    expect(await service.searchMaterials(actor, '', 0, 20, { grade: '三年级', textbook: '演示教材', unit: 'Unit 1' }))
      .toMatchObject({ total: 1, items: [{ id: 'material_zoo' }] });
    expect(await service.searchMaterials(actor, '', 0, 20, { grade: '__unlabeled_grade__' }))
      .toMatchObject({ total: 1, items: [{ id: 'material_animals' }] });
    expect(await service.listMaterialFacets(actor)).toEqual(expect.arrayContaining([
      {}, { grade: '三年级', textbook: '演示教材', unit: 'Unit 1' },
    ]));
    expect(await service.getMaterial(actor, 'material_zoo')).toMatchObject({ id: 'material_zoo' });
    await expect(service.getMaterial(actor, 'material_hidden')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.searchMaterials({ ...actor, actorRole: 'teacher' }, '', 0, 20))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('issues a private draft path only for the current student and authorized material', async () => {
    const { repository, service } = fixture();
    expect((await service.listMaterials(actor)).map(item => item.id)).toEqual(['material_animals']);
    expect(JSON.stringify(await service.listMaterials(actor))).not.toContain('demonstrationFileId');
    expect(await service.getMaterialPlayback(actor, 'material_animals')).toMatchObject({
      materialId: 'material_animals', temporaryUrl: 'https://example.test/private/work.mp3?short-lived=1',
    });
    await expect(service.getMaterialPlayback(actor, 'material_hidden')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const draft = await service.beginDraft(actor, 'material_animals', 'operation_work_begin_1');
    expect(draft).toMatchObject({ studentId: actor.actorUserId, classId: 'class_demo',
      materialVersion: 'demo-v1', status: 'draft', version: 1 });
    expect(draft.stagingPath).toMatch(/^student-works\/staging\/[a-f0-9]+\/student_work_demo_\d+\.mp3$/);
    expect(draft.stagingPath).not.toContain(actor.actorUserId);
    expect(await service.beginDraft(actor, 'material_animals', 'operation_work_begin_1')).toEqual(draft);
    expect(repository.snapshot().works).toHaveLength(1);
    await expect(service.beginDraft(actor, 'material_hidden', 'operation_work_hidden'))
      .rejects.toMatchObject({ code: 'RESOURCE_OFFLINE' });
    await expect(service.beginDraft({ ...actor, actorRole: 'teacher' }, 'material_animals', 'operation_work_teacher'))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('seals a readable recording once, saves metadata and keeps retries idempotent', async () => {
    const { repository, service, inspectAndSeal } = fixture();
    const draft = await service.beginDraft(actor, 'material_animals', 'operation_work_begin_2');
    const input = { workId: draft.id, stagingFileId: `cloud://demo/${draft.stagingPath}`, note: '我的虚构配音' };
    const submitted = await service.submit(actor, input, 1, 'operation_work_submit_2');
    expect(submitted).toMatchObject({ status: 'submitted', version: 2, fileId: sealed.fileId,
      contentSha256: sealed.contentSha256, durationMs: 12_000, note: '我的虚构配音' });
    expect(inspectAndSeal).toHaveBeenCalledWith({ stagingFileId: input.stagingFileId,
      stagingPath: draft.stagingPath, organizationId: actor.organizationId,
      studentId: actor.actorUserId, workId: draft.id });
    expect(await service.submit(actor, input, 1, 'operation_work_submit_2')).toEqual(submitted);
    expect(inspectAndSeal).toHaveBeenCalledTimes(1);
    expect((await service.listMine(actor)).map(item => item.id)).toEqual([draft.id]);
    expect(repository.snapshot().works).toHaveLength(1);
    expect(await service.getPlayback(actor, draft.id)).toMatchObject({ workId: draft.id,
      temporaryUrl: 'https://example.test/private/work.mp3?short-lived=1' });
    await expect(service.getPlayback({ ...actor, actorUserId: 'other_student' }, draft.id))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.submit({ ...actor, actorUserId: 'other_student' }, input, 1, 'operation_work_foreign'))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('keeps the submitted work visible but stops playback at 180 days before physical cleanup', async () => {
    const { service, setNow } = fixture();
    const draft = await service.beginDraft(actor, 'material_animals', 'operation_work_begin_retention');
    await service.submit(actor, { workId: draft.id, stagingFileId: `cloud://demo/${draft.stagingPath}`,
      note: '' }, 1, 'operation_work_submit_retention');
    setNow('2027-03-27T09:00:00+08:00');
    expect(await service.listMine(actor)).toMatchObject([{ status: 'submitted', mediaExpired: true }]);
    await expect(service.getPlayback(actor, draft.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects invalid recording metadata and retains the draft for retry', async () => {
    const { repository, service, inspectAndSeal } = fixture();
    const draft = await service.beginDraft(actor, 'material_animals', 'operation_work_begin_3');
    inspectAndSeal.mockResolvedValueOnce({ ...sealed, sizeBytes: 21 * 1024 * 1024 });
    const input = { workId: draft.id, stagingFileId: `cloud://demo/${draft.stagingPath}`, note: '' };
    await expect(service.submit(actor, input, 1, 'operation_work_invalid_media'))
      .rejects.toMatchObject({ code: 'MEDIA_INVALID' });
    expect(repository.snapshot().works[0]).toMatchObject({ status: 'draft', version: 1, fileId: null });
    await expect(service.getPlayback(actor, draft.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(repository.snapshot().receipts).toHaveLength(1);
    expect(await service.submit(actor, input, 1, 'operation_work_retry_media'))
      .toMatchObject({ status: 'submitted', version: 2 });
  });

  it('rechecks material and class authorization after upload before accepting a work', async () => {
    const { repository, service, inspectAndSeal } = fixture();
    const draft = await service.beginDraft(actor, 'material_animals', 'operation_work_begin_4');
    const material = repository.snapshot().materials[0]!;
    vi.spyOn(repository, 'findMaterial').mockResolvedValueOnce(material)
      .mockResolvedValueOnce({ ...material, status: 'offline' });
    await expect(service.submit(actor, {
      workId: draft.id, stagingFileId: `cloud://demo/${draft.stagingPath}`, note: '' },
    1, 'operation_work_offline_after_upload')).rejects.toMatchObject({ code: 'RESOURCE_OFFLINE' });
    expect(inspectAndSeal).toHaveBeenCalledTimes(1);
    expect(repository.snapshot().works[0]).toMatchObject({ status: 'draft', version: 1 });
  });

  it('soft deletes only its owner’s versioned draft and keeps a seven-day audit receipt', async () => {
    const { repository, service, inspectAndSeal } = fixture();
    const draft = await service.beginDraft(actor, 'material_animals', 'operation_work_begin_delete');
    await expect(service.deleteDraft({ ...actor, actorUserId: 'other_student' }, draft.id, 1,
      'operation_work_delete_foreign')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.deleteDraft({ ...actor, actorRole: 'teacher' }, draft.id, 1,
      'operation_work_delete_teacher')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.deleteDraft(actor, draft.id, 2, 'operation_work_delete_stale'))
      .rejects.toMatchObject({ code: 'CONFLICT' });
    const deleted = await service.deleteDraft(actor, draft.id, 1, 'operation_work_delete_owner');
    expect(deleted).toMatchObject({ status: 'draft', version: 2,
      deletedAt: '2026-09-27T09:00:00+08:00', deletedByUserId: actor.actorUserId,
      recoverableUntil: '2026-10-04T01:00:00.000Z' });
    expect(await service.listMine(actor)).toEqual([]);
    expect(repository.snapshot().works).toHaveLength(1);
    expect(repository.snapshot().works[0]).toMatchObject({ id: draft.id, fileId: null, deletedAt: deleted.deletedAt });
    expect(repository.snapshot().receipts.slice(-1)[0]).toMatchObject({ action: 'deleteDraft',
      occurredAt: deleted.deletedAt, studentId: actor.actorUserId, result: { id: draft.id } });
    expect(await service.deleteDraft(actor, draft.id, 1, 'operation_work_delete_owner')).toEqual(deleted);
    await expect(service.deleteDraft(actor, 'other_work', 1, 'operation_work_delete_owner'))
      .rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(service.deleteDraft(actor, draft.id, 1, 'operation_work_delete_again'))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(inspectAndSeal).not.toHaveBeenCalled();
  });

  it('does not delete a submitted work or its playable recording', async () => {
    const { repository, service } = fixture();
    const draft = await service.beginDraft(actor, 'material_animals', 'operation_work_begin_submitted_delete');
    await service.submit(actor, { workId: draft.id, stagingFileId: `cloud://demo/${draft.stagingPath}`,
      note: '' }, 1, 'operation_work_submit_before_delete');
    await expect(service.deleteDraft(actor, draft.id, 2, 'operation_work_delete_submitted'))
      .rejects.toMatchObject({ code: 'CONFLICT' });
    expect(repository.snapshot().works[0]).toMatchObject({ status: 'submitted' });
    expect(repository.snapshot().works[0]?.deletedAt).toBeUndefined();
    expect(await service.getPlayback(actor, draft.id)).toMatchObject({ workId: draft.id });
  });
});
