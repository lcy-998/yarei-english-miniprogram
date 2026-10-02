import { describe, expect, it } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import type { VersionedDocument } from '../../src/repositories/document-database-port';
import { hashHex } from '../../src/shared/request-summary';
import { StudentWorkAdminService } from '../../src/student-work/admin-service';
import { DocumentStudentWorkRepository } from '../../src/student-work/document-repository';
import { StudentWorkService } from '../../src/student-work/service';

const ORG = 'org_demo';
const STUDENT = 'student_demo';
const WORK = 'student_work_demo_1';
const DELETED = '2026-09-26T09:00:00+08:00';
const DEADLINE = '2026-10-03T01:00:00.000Z';
const NOW = '2026-09-27T09:00:00+08:00';
const STAGING = `student-works/staging/${hashHex(JSON.stringify([ORG, STUDENT]))}/${WORK}.mp3`;
const admin: TrustedActorContext = { requestId: 'request_restore', sessionId: 'admin_session_demo',
  actorUserId: 'admin_demo', actorRole: 'admin', organizationId: ORG,
  platformSubjectDigest: 'digest_admin', permissions: ['student_work.restore'],
  scopeIds: [ORG], authzVersion: 1 };
const student: TrustedActorContext = { ...admin, actorUserId: STUDENT, actorRole: 'student',
  sessionId: 'student_session_demo', permissions: [], scopeIds: [STUDENT] };
function document(id: string, fields: Record<string, VersionedDocument[string]>): VersionedDocument {
  return { _id: id, organizationId: ORG, schemaVersion: 1, version: 1, deletedAt: null, ...fields };
}
function deletedDraft(overrides: Record<string, VersionedDocument[string]> = {}): VersionedDocument {
  return { _id: WORK, id: WORK, organizationId: ORG, schemaVersion: 1, version: 2,
    deletedAt: DELETED, recoverableUntil: DEADLINE, deletedByUserId: STUDENT,
    recoveryState: 'deleted', studentId: STUDENT, classId: 'class_demo',
    materialId: 'material_demo', materialVersion: 'demo-v1', stagingPath: STAGING,
    status: 'draft', fileId: null, contentSha256: null, sizeBytes: null,
    durationMs: null, note: '', createdAt: '2026-09-25T09:00:00+08:00', submittedAt: null,
    ...overrides };
}
function setup(work = deletedDraft(), now = NOW) {
  const database = new FakeDocumentDatabase({
    student_works: [work],
    learning_resources: [document('material_demo', { id: 'material_demo', title: '虚构动物配音', type: 'work' })],
    users: [document(STUDENT, { id: STUDENT, status: 'active' })],
    classes: [document('class_demo', { id: 'class_demo', status: 'active' })],
    class_memberships: [document('membership_demo', { studentId: STUDENT, classId: 'class_demo', status: 'active' })],
  });
  return { database, service: new StudentWorkAdminService(database, { nowIso: () => now }) };
}
const command = { studentId: STUDENT, workId: WORK, expectedVersion: 2,
  operationId: 'operation_restore_work_demo_1', reason: '学生误删，已核对记录' };

describe('A-03 administrator recovery of S-12 drafts', () => {
  it('shows only minimal same-organization metadata and requires explicit restore permission', async () => {
    const { service } = setup();
    const page = await service.listDeletedDrafts(admin, STUDENT, { limit: 20, offset: 0 });
    expect(page).toEqual({ items: [{ id: WORK, studentId: STUDENT, materialId: 'material_demo',
      materialTitle: '虚构动物配音', version: 2, deletedAt: DELETED, recoverableUntil: DEADLINE,
      stagingCleanupStatus: 'none', restorable: true, blockedReason: null }], nextOffset: null });
    expect(JSON.stringify(page)).not.toContain('stagingPath');
    expect(JSON.stringify(page)).not.toContain('fileId');
    expect(await service.listDeletedDrafts(admin, 'student_other', { limit: 20, offset: 0 }))
      .toEqual({ items: [], nextOffset: null });
    await expect(service.listDeletedDrafts({ ...admin, permissions: [] }, STUDENT, { limit: 20, offset: 0 }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.listDeletedDrafts({ ...admin, scopeIds: ['class_demo'] }, STUDENT, { limit: 20, offset: 0 }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.listDeletedDrafts({ ...admin, actorRole: 'teacher' }, STUDENT, { limit: 20, offset: 0 }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    const missing = setup(deletedDraft({ materialId: 'missing_material' }));
    expect((await missing.service.listDeletedDrafts(admin, STUDENT, { limit: 20, offset: 0 })).items[0])
      .toMatchObject({ materialTitle: null });
  });

  it('restores a draft in one transaction, makes it visible to its owner and records reason and actor', async () => {
    const { database, service } = setup();
    const restored = await service.restoreDraft(admin, command);
    expect(restored).toEqual({ id: WORK, studentId: STUDENT, materialId: 'material_demo',
      version: 3, restoredAt: NOW, restoredByUserId: admin.actorUserId });
    expect(database.snapshot().student_works?.[0]).toMatchObject({ status: 'draft',
      deletedAt: null, recoverableUntil: null, recoveryState: 'active', version: 3,
      stagingPath: STAGING, restoredByUserId: admin.actorUserId });
    expect(database.snapshot().student_work_operations?.[0]).toMatchObject({
      action: 'restoreDraft', reason: command.reason, actorUserId: admin.actorUserId,
      requestId: admin.requestId, result: restored });
    expect(database.snapshot().operation_logs?.[0]).toMatchObject({
      action: 'student_work.restoreDraft', actorUserId: admin.actorUserId,
      requestId: admin.requestId, targetId: WORK, result: 'succeeded',
      metadata: { reasonProvided: true, affectedCount: 1 } });
    expect(database.snapshot().operation_logs?.[0]?.metadata).toEqual({ reasonProvided: true, affectedCount: 1 });
    expect(JSON.stringify(database.snapshot().operation_logs)).not.toContain(command.reason);
    const owner = new StudentWorkService(new DocumentStudentWorkRepository(database), null,
      { nowIso: () => NOW }, { next: prefix => `${prefix}_unused_1` });
    expect(await owner.listMine(student)).toMatchObject([{ id: WORK, status: 'draft', version: 3 }]);
    expect(await service.listDeletedDrafts(admin, STUDENT, { limit: 20, offset: 0 }))
      .toEqual({ items: [], nextOffset: null });
    expect(await service.restoreDraft(admin, command)).toEqual(restored);
    expect(database.snapshot().student_work_operations).toHaveLength(1);
    expect(database.snapshot().operation_logs).toHaveLength(1);
    await expect(service.restoreDraft(admin, { ...command, reason: '更换原因' }))
      .rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects expired, locked, cleaned, submitted, restored, cross-organization and stale works', async () => {
    const cases: Array<[VersionedDocument, string]> = [
      [deletedDraft(), 'expired'],
      [deletedDraft({ stagingCleanupStatus: 'deleting' }), 'cleanup_locked'],
      [deletedDraft({ stagingCleanupStatus: 'deleted', stagingMediaDeletedAt: NOW }), 'staging_deleted'],
    ];
    for (const [work, blockedReason] of cases) {
      const at = blockedReason === 'expired' ? DEADLINE : NOW;
      const { service } = setup(work, at);
      expect((await service.listDeletedDrafts(admin, STUDENT, { limit: 20, offset: 0 })).items[0])
        .toMatchObject({ restorable: false, blockedReason });
      await expect(service.restoreDraft(admin, command)).rejects.toMatchObject({ code: 'CONFLICT' });
    }
    await expect(setup(deletedDraft({ status: 'submitted', submittedAt: DELETED,
      fileId: 'cloud://demo/private/work.mp3' })).service.restoreDraft(admin, command))
      .rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(setup(deletedDraft({ deletedAt: null, recoveryState: 'active' })).service.restoreDraft(admin, command))
      .rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(setup(deletedDraft({ organizationId: 'org_other' })).service.restoreDraft(admin, command))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(setup().service.restoreDraft(admin, { ...command, expectedVersion: 1 }))
      .rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(setup().service.restoreDraft({ ...admin, permissions: [] }, command))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rolls back the restored state and receipt when audit persistence fails', async () => {
    const { database, service } = setup();
    database.failNext({ operation: 'append', collection: 'operation_logs', kind: 'conflict' });
    await expect(service.restoreDraft(admin, command)).rejects.toThrow();
    expect(database.snapshot().student_works?.[0]).toMatchObject({ deletedAt: DELETED,
      recoveryState: 'deleted', version: 2 });
    expect(database.snapshot().student_work_operations ?? []).toHaveLength(0);
    expect(database.snapshot().operation_logs ?? []).toHaveLength(0);
  });
});
