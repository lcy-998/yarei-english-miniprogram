import { describe, expect, it } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import type { VersionedDocument } from '../../src/repositories/document-database-port';
import { DocumentTextbookRepository, TEXTBOOK_COLLECTIONS } from '../../src/textbook/document-repository';
import { TeacherTextbookService } from '../../src/textbook/service';
import { validateTeacherTextbookCommandRequest, validateTeacherTextbookQueryRequest } from '../../src/contracts/teacher-textbook-functions';

const organizationId = 'org_textbook_demo';
const teacherId = 'teacher_textbook_demo';
const classId = 'class_textbook_demo';
const otherClassId = 'class_textbook_other';
const actor: TrustedActorContext = { requestId: 'request_textbook_demo', sessionId: 'session_textbook_demo',
  actorUserId: teacherId, actorRole: 'teacher', organizationId, platformSubjectDigest: 'digest_textbook_demo',
  permissions: ['content.read', 'task.publish'], scopeIds: [classId], authzVersion: 1 };
function document(id: string, fields: Record<string, VersionedDocument[string]>): VersionedDocument {
  return { _id: id, organizationId, schemaVersion: 1, version: 1, deletedAt: null, ...fields };
}
function fixture() {
  const database = new FakeDocumentDatabase({
    [TEXTBOOK_COLLECTIONS.classes]: [
      document(classId, { name: '三年级 2 班', grade: '三年级', term: '上学期', status: 'active' }),
      document(otherClassId, { name: '三年级 3 班', grade: '三年级', term: '上学期', status: 'active' }),
    ],
    [TEXTBOOK_COLLECTIONS.grants]: [document('grant_textbook_demo', { teacherId, classId,
      permissions: ['content.read', 'task.publish'], status: 'active' })],
    [TEXTBOOK_COLLECTIONS.memberships]: [document('membership_textbook_demo', { classId, studentId: 'student_demo', status: 'active' })],
    [TEXTBOOK_COLLECTIONS.resources]: [
      document('book_sync_demo', { type: 'reading', category: 'synchronized', title: '虚构同步课本',
        grade: '三年级', term: '上学期', textbook: '虚构演示版', status: 'published', contentVersion: 'v1',
        visibility: { type: 'classes', classIds: [classId] }, payload: { category: 'synchronized',
          grade: '三年级', term: '上学期', textbook: '虚构演示版', textbookChapters: [
            { id: 'unit_1', title: '第一单元', lessons: [{ id: 'lesson_1', title: '第一课' }, { id: 'lesson_2', title: '第二课' }] },
            { id: 'unit_2', title: '第二单元', lessons: [] },
          ] } }),
      document('book_hidden_demo', { type: 'reading', category: 'synchronized', title: '其他班级课本',
        grade: '三年级', term: '上学期', textbook: '虚构演示版', status: 'published', contentVersion: 'v1',
        visibility: { type: 'classes', classIds: [otherClassId] }, payload: { textbookChapters: [] } }),
    ],
  });
  const service = new TeacherTextbookService(new DocumentTextbookRepository(database),
    { nowIso: () => '2026-09-27T09:00:00+08:00' });
  return { database, service };
}
const item = { textbookId: 'book_sync_demo', contentVersion: 'v1',
  chapterIds: ['unit_2', 'unit_1'], lessonIds: ['lesson_2', 'lesson_1'] };

describe('M2 teacher textbook service', () => {
  it('reads numeric grades from the accepted M1 class and resource documents', async () => {
    const original = fixture().database.snapshot();
    const database = new FakeDocumentDatabase({ ...original,
      [TEXTBOOK_COLLECTIONS.classes]: (original[TEXTBOOK_COLLECTIONS.classes] ?? []).map(row =>
        row._id === classId ? { ...row, grade: 3 } : row),
      [TEXTBOOK_COLLECTIONS.resources]: (original[TEXTBOOK_COLLECTIONS.resources] ?? []).map(row =>
        row._id === 'book_sync_demo' ? { ...row, grade: 3 } : row),
    });
    const service = new TeacherTextbookService(new DocumentTextbookRepository(database),
      { nowIso: () => '2026-09-27T09:00:00+08:00' });
    expect(await service.listClasses(actor)).toMatchObject([{ id: classId, grade: '3' }]);
    expect(await service.getClass(actor, classId)).toMatchObject({ id: classId, grade: '3' });
    expect((await service.listTextbooks(actor, {}, { limit: 20, offset: 0 })).items)
      .toMatchObject([{ id: 'book_sync_demo', grade: '3' }]);
  });

  it('scopes class and synchronized book listings to current grants and visibility', async () => {
    const { service } = fixture();
    expect(await service.listClasses(actor)).toMatchObject([{ id: classId, studentCount: 1, config: null }]);
    const catalog = await service.listTextbooks(actor, {}, { limit: 20, offset: 0 });
    expect(catalog.items).toMatchObject([{ id: 'book_sync_demo', title: '虚构同步课本' }]);
    expect(JSON.stringify(catalog)).not.toContain('allowedClassIds');
    await expect(service.getClass(actor, otherClassId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.getTextbook(actor, 'book_hidden_demo')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('scans stable bounded pages without skipping a book after unrelated reading records', async () => {
    const { service, database } = fixture();
    await database.runTransaction(async transaction => {
      for (let index = 0; index < 55; index += 1) {
        const id = `a_reading_${String(index).padStart(3, '0')}`;
        await transaction.create(TEXTBOOK_COLLECTIONS.resources, document(id, { type: 'reading',
          category: 'picture_book', status: 'published', title: '虚构绘本', contentVersion: 'v1' }));
      }
    });
    const result = await service.listTextbooks(actor, {}, { limit: 1, offset: 0 });
    expect(result.items.map(item => item.id)).toEqual(['book_sync_demo']);
  });

  it('saves ordering, publishes a separate visible snapshot, and keeps idempotent retry stable', async () => {
    const { service, database } = fixture();
    const draft = await service.save(actor, { classId, textbooks: [item], note: '虚构教学安排' },
      0, 'operation_textbook_save_first', false);
    expect(draft).toMatchObject({ status: 'draft', version: 1, publishedTextbooks: [],
      textbooks: [{ chapterIds: ['unit_2', 'unit_1'], lessonIds: ['lesson_2', 'lesson_1'] }] });
    expect(await service.save(actor, { classId, textbooks: [item], note: '虚构教学安排' },
      0, 'operation_textbook_save_first', false)).toEqual(draft);
    const published = await service.save(actor, { classId, textbooks: [item], note: '虚构教学安排' },
      1, 'operation_textbook_publish_first', true);
    expect(published).toMatchObject({ status: 'published', version: 2,
      publishedTextbooks: [{ textbookId: 'book_sync_demo' }] });
    const revised = await service.save(actor, { classId, textbooks: [{ ...item, chapterIds: ['unit_1', 'unit_2'] }], note: '' },
      2, 'operation_textbook_revise_first', false);
    expect(revised).toMatchObject({ status: 'draft', version: 3,
      textbooks: [{ chapterIds: ['unit_1', 'unit_2'] }], publishedTextbooks: [{ chapterIds: ['unit_2', 'unit_1'] }] });
    expect((await service.getClass(actor, classId)).config?.publishedTextbooks).toEqual(published.textbooks);
    expect(database.snapshot()[TEXTBOOK_COLLECTIONS.receipts]).toHaveLength(3);
  });

  it('rejects revoked write permission, offline content and stale versions without changing prior config', async () => {
    const { service, database } = fixture();
    await expect(service.save({ ...actor, permissions: ['content.read'] }, { classId, textbooks: [item], note: '' },
      0, 'operation_textbook_no_write', false)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.save(actor, { classId, textbooks: [{ ...item, contentVersion: 'v2' }], note: '' },
      0, 'operation_textbook_old_resource', false)).rejects.toMatchObject({ code: 'RESOURCE_OFFLINE' });
    await service.save(actor, { classId, textbooks: [item], note: '' }, 0, 'operation_textbook_create_ok', false);
    await expect(service.save(actor, { classId, textbooks: [item], note: '' },
      0, 'operation_textbook_stale_version', false)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(database.snapshot()[TEXTBOOK_COLLECTIONS.configs]).toHaveLength(1);
  });

  it('rolls back config creation if its operation receipt fails', async () => {
    const { service, database } = fixture();
    database.failNext({ operation: 'create', collection: TEXTBOOK_COLLECTIONS.receipts, kind: 'conflict' });
    await expect(service.save(actor, { classId, textbooks: [item], note: '' },
      0, 'operation_textbook_receipt_fail', false)).rejects.toThrow();
    expect(database.snapshot()[TEXTBOOK_COLLECTIONS.configs] ?? []).toHaveLength(0);
  });

  it('strictly rejects unknown filters and forged command fields', () => {
    const query = validateTeacherTextbookQueryRequest({ apiVersion: 'm1.v1', action: 'listTextbooks',
      payload: { filters: { keyword: '虚构', studentId: 'forged' }, page: { limit: 20, offset: 0 } } });
    expect(query.ok).toBe(false);
    const command = validateTeacherTextbookCommandRequest({ apiVersion: 'm1.v1', action: 'publishClassTextbooks',
      payload: { classId, textbooks: [item], note: '', organizationId: 'other' },
      expectedVersion: 0, operationId: 'operation_textbook_contract' });
    expect(command.ok).toBe(false);
  });
});
