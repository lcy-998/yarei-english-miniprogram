import { describe, expect, it } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import type { VersionedDocument } from '../../src/repositories/document-database-port';
import { TextbookAdminService, TEXTBOOK_ADMIN_COLLECTIONS } from '../../src/textbook/admin-service';
import { TeacherTextbookService } from '../../src/textbook/service';
import { DocumentTextbookRepository } from '../../src/textbook/document-repository';
import { validateTextbookAdminCommandRequest, validateTextbookAdminQueryRequest } from '../../src/contracts/textbook-admin-functions';

const organizationId = 'org_textbook_admin_demo';
const classId = 'class_textbook_admin_demo';
const otherClassId = 'class_textbook_admin_other';
const actor: TrustedActorContext = { requestId: 'request_textbook_admin', sessionId: 'session_textbook_admin',
  actorUserId: 'admin_textbook_demo', actorRole: 'admin', organizationId,
  platformSubjectDigest: 'digest_textbook_admin', permissions: ['organization.manage', 'content.read'],
  scopeIds: [organizationId], authzVersion: 1 };
const teacher: TrustedActorContext = { ...actor, actorRole: 'teacher', actorUserId: 'teacher_textbook_demo',
  permissions: ['content.read', 'task.publish'], scopeIds: [classId] };
function document(id: string, fields: Record<string, VersionedDocument[string]>): VersionedDocument {
  return { _id: id, organizationId, schemaVersion: 1, version: 1, deletedAt: null, ...fields };
}
function fixture() {
  const database = new FakeDocumentDatabase({
    [TEXTBOOK_ADMIN_COLLECTIONS.classes]: [
      document(classId, { name: '三年级 2 班', grade: '三年级', term: '上学期', status: 'active' }),
      document(otherClassId, { name: '三年级 3 班', grade: '三年级', term: '上学期', status: 'active' }),
    ],
    [TEXTBOOK_ADMIN_COLLECTIONS.resources]: [document('book_sync_admin_demo', {
      type: 'reading', category: 'synchronized', title: '虚构同步课本', status: 'draft',
      contentVersion: 'v1', copyrightStatus: 'demo', grade: '三年级', term: '上学期',
      textbook: '虚构演示版', difficulty: '基础', visibility: { type: 'classes', classIds: [otherClassId] },
      chapters: [{ id: 'chapter_demo', title: '虚构第一单元', order: 1, pages: [{ id: 'page_demo',
        pageNumber: 1, order: 1, thumbnailAssetKey: 'demo-thumb', imageAssetKey: 'demo-page',
        width: 750, height: 1000, assetVersion: 'v1' }] }],
    })],
    teacher_class_grants: [document('grant_textbook_admin_demo', { teacherId: teacher.actorUserId,
      classId, permissions: ['content.read', 'task.publish'], status: 'active' })],
  });
  const admin = new TextbookAdminService(database, { nowIso: () => '2026-09-27T09:00:00+08:00' });
  const teacherService = new TeacherTextbookService(new DocumentTextbookRepository(database),
    { nowIso: () => '2026-09-27T09:00:00+08:00' });
  return { database, admin, teacherService };
}
const layout = { classTextbooksEnabled: true, synchronizedTextbooksEnabled: true,
  visibleClassIds: [classId], dashboardFields: ['grade', 'studentCount'] as const };

describe('M2 textbook center administrator', () => {
  it('uses accepted M1 numeric class grades when reviewing and publishing a demo textbook', async () => {
    const { admin, database, teacherService } = fixture();
    await database.runTransaction(async transaction => {
      const classroom = (await transaction.get(TEXTBOOK_ADMIN_COLLECTIONS.classes, classId))!;
      await transaction.replace(TEXTBOOK_ADMIN_COLLECTIONS.classes, classId, classroom.version,
        { ...classroom, grade: 3, version: classroom.version + 1 });
      const book = (await transaction.get(TEXTBOOK_ADMIN_COLLECTIONS.resources, 'book_sync_admin_demo'))!;
      await transaction.replace(TEXTBOOK_ADMIN_COLLECTIONS.resources, book._id, book.version,
        { ...book, grade: '3', version: book.version + 1 });
    });
    expect((await admin.overview(actor)).classes).toContainEqual(expect.objectContaining({ id: classId, grade: '3' }));
    const draft = await admin.saveCatalogDraft(actor, 'book_sync_admin_demo', [classId],
      0, 'operation_textbook_numeric_grade_draft');
    await admin.changeCatalogStatus(actor, 'book_sync_admin_demo', draft.version,
      'operation_textbook_numeric_grade_publish', true);
    expect((await teacherService.listTextbooks(teacher, {}, { limit: 20, offset: 0 })).items)
      .toMatchObject([{ id: 'book_sync_admin_demo', grade: '3' }]);
  });

  it('keeps draft module settings private until published and then restricts teacher listing', async () => {
    const { admin, teacherService } = fixture();
    expect((await teacherService.getCenterSettings(teacher)).visibleClassIds).toEqual([classId]);
    const saved = await admin.saveSettings(actor, { ...layout, synchronizedTextbooksEnabled: false },
      0, 'operation_textbook_settings_save', false);
    expect(saved).toMatchObject({ status: 'draft', published: null, version: 1 });
    expect((await teacherService.getCenterSettings(teacher)).synchronizedTextbooksEnabled).toBe(true);
    const published = await admin.saveSettings(actor, { ...layout, synchronizedTextbooksEnabled: false },
      1, 'operation_textbook_settings_publish', true);
    expect(published).toMatchObject({ status: 'published', version: 2,
      published: { synchronizedTextbooksEnabled: false } });
    expect((await teacherService.getCenterSettings(teacher)).synchronizedTextbooksEnabled).toBe(false);
    await expect(teacherService.listTextbooks(teacher, {}, { limit: 20, offset: 0 }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('saves class visibility as draft, publishes valid content, and later disables new citation', async () => {
    const { database, admin, teacherService } = fixture();
    const draft = await admin.saveCatalogDraft(actor, 'book_sync_admin_demo', [classId],
      0, 'operation_textbook_catalog_save');
    expect(draft).toMatchObject({ status: 'draft', version: 1, classIds: [classId] });
    expect((await database.get(TEXTBOOK_ADMIN_COLLECTIONS.resources, 'book_sync_admin_demo'))?.status).toBe('draft');
    expect((await teacherService.listTextbooks(teacher, {}, { limit: 20, offset: 0 })).items).toEqual([]);
    const published = await admin.changeCatalogStatus(actor, 'book_sync_admin_demo', 1,
      'operation_textbook_catalog_publish', true);
    expect(published).toMatchObject({ status: 'published', version: 2 });
    expect((await teacherService.listTextbooks(teacher, {}, { limit: 20, offset: 0 })).items)
      .toMatchObject([{ id: 'book_sync_admin_demo' }]);
    const stopped = await admin.changeCatalogStatus(actor, 'book_sync_admin_demo', 2,
      'operation_textbook_catalog_disable', false);
    expect(stopped.status).toBe('disabled');
    expect((await teacherService.listTextbooks(teacher, {}, { limit: 20, offset: 0 })).items).toEqual([]);
    expect(database.snapshot()[TEXTBOOK_ADMIN_COLLECTIONS.audits]).toHaveLength(3);
  });

  it('denies non-admin and cross-organization actions and rolls back if audit append fails', async () => {
    const { database, admin } = fixture();
    await expect(admin.overview(teacher)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(admin.overview({ ...actor, organizationId: 'org_other' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    database.failNext({ operation: 'append', collection: TEXTBOOK_ADMIN_COLLECTIONS.audits, kind: 'conflict' });
    await expect(admin.saveSettings(actor, layout, 0, 'operation_textbook_audit_fail', false)).rejects.toThrow();
    expect(database.snapshot()[TEXTBOOK_ADMIN_COLLECTIONS.settings] ?? []).toHaveLength(0);
    expect(database.snapshot()[TEXTBOOK_ADMIN_COLLECTIONS.receipts] ?? []).toHaveLength(0);
  });

  it('does not publish a placeholder without valid pages or accept stale versions', async () => {
    const { admin, database } = fixture();
    const draft = await admin.saveCatalogDraft(actor, 'book_sync_admin_demo', [classId],
      0, 'operation_textbook_catalog_draft');
    await expect(admin.changeCatalogStatus(actor, 'book_sync_admin_demo', 0,
      'operation_textbook_catalog_stale', true)).rejects.toMatchObject({ code: 'CONFLICT' });
    const source = (await database.get(TEXTBOOK_ADMIN_COLLECTIONS.resources, 'book_sync_admin_demo'))!;
    await database.runTransaction(async transaction => {
      await transaction.replace(TEXTBOOK_ADMIN_COLLECTIONS.resources, source._id, source.version,
        { ...source, version: source.version + 1, chapters: [] });
    });
    await expect(admin.changeCatalogStatus(actor, 'book_sync_admin_demo', draft.version,
      'operation_textbook_catalog_no_pages', true)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('strictly rejects actor claims and unknown config fields in request payloads', () => {
    expect(validateTextbookAdminQueryRequest({ apiVersion: 'm1.v1', action: 'getOverview',
      payload: { organizationId } })).toMatchObject({ ok: false });
    expect(validateTextbookAdminCommandRequest({ apiVersion: 'm1.v1', action: 'saveSettings',
      payload: { layout: { ...layout, secret: 'forged' } }, expectedVersion: 0,
      operationId: 'operation_textbook_contract' })).toMatchObject({ ok: false });
  });
});
