import { describe, expect, it } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import type { VersionedDocument } from '../../src/repositories/document-database-port';
import { DocumentTemplateRepository, TEMPLATE_COLLECTIONS } from '../../src/task-template/document-repository';
import { TaskTemplateService } from '../../src/task-template/service';

const organizationId = 'org_template_document';
const teacherId = 'teacher_template_document';
const classId = 'class_template_document';
const teacher: TrustedActorContext = { requestId: 'request_template_document', sessionId: 'session_template_document',
  actorUserId: teacherId, actorRole: 'teacher', organizationId,
  platformSubjectDigest: 'digest_template_document', permissions: ['task.publish', 'content.read'],
  scopeIds: [classId], authzVersion: 1 };
function document(id: string, fields: Record<string, VersionedDocument[string]>): VersionedDocument {
  return { _id: id, organizationId, schemaVersion: 1, version: 1, deletedAt: null, ...fields };
}
function database(): FakeDocumentDatabase {
  return new FakeDocumentDatabase({
    [TEMPLATE_COLLECTIONS.classes]: [document(classId, { id: classId, status: 'active' })],
    [TEMPLATE_COLLECTIONS.grants]: [document('grant_template', { teacherId, classId, status: 'active',
      permissions: ['task.publish', 'content.read'] })],
    [TEMPLATE_COLLECTIONS.resources]: [document('resource_reading', { id: 'resource_reading',
      type: 'reading', title: '虚构绘本', contentVersion: 1, status: 'published',
      visibility: { type: 'classes', classIds: [classId] }, payload: { pages: [{ id: 'page_1' }] } })],
  });
}
let sequence = 0;
function service(documents: FakeDocumentDatabase) {
  return new TaskTemplateService(new DocumentTemplateRepository(documents),
    { nowIso: () => '2026-09-27T09:00:00+08:00' },
    { next: prefix => `${prefix}_document_${++sequence}` });
}
const input = { title: '虚构阅读模板', description: '阅读一页', itemRefs: [{
  id: 'item_reading', resourceId: 'resource_reading', order: 1,
  completionRule: { kind: 'reading_pages', requiredPageCount: 1 },
  scoringRule: { kind: 'automatic', maxScore: 100 },
}] };

describe('M2 task template document boundary', () => {
  it('persists an owner-scoped snapshot and an independent copied template', async () => {
    const documents = database();
    const templates = service(documents);
    const original = await templates.save(teacher, input, 0, 'operation_template_document_save');
    expect(original).toMatchObject({ scope: 'personal', ownerTeacherId: teacherId,
      items: [{ resourceSnapshot: { title: '虚构绘本' } }] });
    const copied = await templates.copyPersonal(teacher, original.id, '第二份模板', 1,
      'operation_template_document_copy');
    expect(copied.id).not.toBe(original.id);
    expect((await templates.list(teacher)).map(item => item.id)).toEqual([original.id, copied.id]);
    expect(await templates.use(teacher, copied.id, 1, 'operation_template_document_use'))
      .toMatchObject({ useCount: 0, version: 1 });
    expect(documents.snapshot()[TEMPLATE_COLLECTIONS.templates]).toHaveLength(2);
    expect(documents.snapshot()[TEMPLATE_COLLECTIONS.receipts]).toHaveLength(2);
  });

  it('rolls back template creation when its receipt cannot be stored', async () => {
    const documents = database();
    documents.failNext({ operation: 'create', collection: TEMPLATE_COLLECTIONS.receipts, kind: 'conflict' });
    await expect(service(documents).save(teacher, input, 0, 'operation_template_document_failed'))
      .rejects.toThrow();
    expect(documents.snapshot()[TEMPLATE_COLLECTIONS.templates] ?? []).toHaveLength(0);
  });
});
