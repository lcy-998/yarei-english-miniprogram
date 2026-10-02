import { describe, expect, it } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import type { VersionedDocument } from '../../src/repositories/document-database-port';
import { DocumentStudentWorkRepository, STUDENT_WORK_COLLECTIONS } from '../../src/student-work/document-repository';
import { StudentWorkService } from '../../src/student-work/service';

const organizationId = 'org_work_demo';
const studentId = 'student_work_demo';
const classId = 'class_work_demo';
const actor: TrustedActorContext = { requestId: 'request_work_demo', sessionId: 'session_work_demo',
  actorUserId: studentId, actorRole: 'student', organizationId,
  platformSubjectDigest: 'digest_work_demo', permissions: [], scopeIds: [studentId], authzVersion: 1 };
function document(id: string, fields: Record<string, VersionedDocument[string]>): VersionedDocument {
  return { _id: id, organizationId, schemaVersion: 1, version: 1, deletedAt: null, ...fields };
}
function database(): FakeDocumentDatabase {
  return new FakeDocumentDatabase({
    [STUDENT_WORK_COLLECTIONS.users]: [document(studentId, { id: studentId, status: 'active' })],
    [STUDENT_WORK_COLLECTIONS.classes]: [document(classId, { id: classId, status: 'active' })],
    [STUDENT_WORK_COLLECTIONS.memberships]: [document('membership_work_demo', { studentId, classId, status: 'active' })],
    [STUDENT_WORK_COLLECTIONS.materials]: [document('material_animals', {
      id: 'material_animals', title: '动物配音', type: 'work', contentVersion: 'demo-v1', status: 'published',
      grade: '三年级', textbook: '演示教材', unit: 'Unit 1',
      visibility: { type: 'classes', classIds: [classId] },
      payload: { demonstrationFileId: 'cloud://demo/materials/animals.mp4', subtitle: 'Animals are here.' },
    })],
  });
}
let sequence = 0;
function service(documents: FakeDocumentDatabase) {
  return new StudentWorkService(new DocumentStudentWorkRepository(documents), {
    async inspectAndSeal() { return { fileId: 'cloud://demo/private/work.mp3', contentSha256: 'a'.repeat(64),
      sizeBytes: 120_000, durationMs: 10_000, codec: 'mp3' }; },
  }, { nowIso: () => '2026-09-27T09:00:00+08:00' },
  { next: prefix => `${prefix}_document_${++sequence}` });
}

describe('M2 autonomous work document boundary', () => {
  it('saves the draft and the sealed submitted work with separate atomic receipts', async () => {
    const documents = database();
    const works = service(documents);
    expect((await works.listMaterials(actor)).map(item => item.id)).toEqual(['material_animals']);
    expect(await works.listMaterialFacets(actor)).toEqual([{ grade: '三年级', textbook: '演示教材', unit: 'Unit 1' }]);
    const draft = await works.beginDraft(actor, 'material_animals', 'operation_work_document_begin');
    expect(draft).toMatchObject({ status: 'draft', version: 1, studentId });
    const input = { workId: draft.id, stagingFileId: `cloud://demo/${draft.stagingPath}`, note: '虚构作品' };
    expect(await works.submit(actor, input, 1, 'operation_work_document_submit')).toMatchObject({
      status: 'submitted', version: 2, durationMs: 10_000, contentSha256: 'a'.repeat(64),
    });
    expect(await works.submit(actor, input, 1, 'operation_work_document_submit')).toMatchObject({ status: 'submitted' });
    expect(documents.snapshot()[STUDENT_WORK_COLLECTIONS.works]).toHaveLength(1);
    expect(documents.snapshot()[STUDENT_WORK_COLLECTIONS.receipts]).toHaveLength(2);
    expect((await works.listMine(actor)).map(item => item.id)).toEqual([draft.id]);
  });

  it('rolls back a draft when the idempotency receipt cannot be written', async () => {
    const documents = database();
    documents.failNext({ operation: 'create', collection: STUDENT_WORK_COLLECTIONS.receipts, kind: 'conflict' });
    await expect(service(documents).beginDraft(actor, 'material_animals', 'operation_work_receipt_failed'))
      .rejects.toThrow();
    expect(documents.snapshot()[STUDENT_WORK_COLLECTIONS.works] ?? []).toHaveLength(0);
  });

  it('keeps deleted draft metadata and receipt atomically while hiding it from the owner list', async () => {
    const documents = database();
    const works = service(documents);
    const draft = await works.beginDraft(actor, 'material_animals', 'operation_work_document_delete_begin');
    documents.failNext({ operation: 'create', collection: STUDENT_WORK_COLLECTIONS.receipts, kind: 'conflict' });
    await expect(works.deleteDraft(actor, draft.id, 1, 'operation_work_document_delete_failed')).rejects.toThrow();
    expect(documents.snapshot()[STUDENT_WORK_COLLECTIONS.works]?.[0]?.deletedAt).toBeNull();
    const deleted = await works.deleteDraft(actor, draft.id, 1, 'operation_work_document_delete_success');
    expect(deleted.deletedAt).toBe('2026-09-27T09:00:00+08:00');
    expect(documents.snapshot()[STUDENT_WORK_COLLECTIONS.works]?.[0]).toMatchObject({
      version: 2, deletedAt: deleted.deletedAt, recoverableUntil: deleted.recoverableUntil,
      deletedByUserId: studentId, stagingPath: draft.stagingPath,
    });
    expect(documents.snapshot()[STUDENT_WORK_COLLECTIONS.receipts]?.slice(-1)[0]).toMatchObject({
      action: 'deleteDraft', occurredAt: deleted.deletedAt,
      result: { id: draft.id, deletedAt: deleted.deletedAt },
    });
    expect(await works.listMine(actor)).toEqual([]);
    expect(await works.deleteDraft(actor, draft.id, 1, 'operation_work_document_delete_success')).toEqual(deleted);
  });
});
