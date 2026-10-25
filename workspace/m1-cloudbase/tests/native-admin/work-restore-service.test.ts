import { describe, expect, it } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import { hashHex } from '../../src/shared/request-summary';
import { DocumentNativeAdminGrantRepository,
  nativeAdminGrantId } from '../../src/native-admin/document-grant-repository';
import { NativeAdminWorkRestoreService } from '../../src/native-admin/work-restore-service';

const ORG = 'org_demo';
const STUDENT = 'student_demo';
const WORK = 'student_work_demo';
const NOW = '2026-09-27T09:00:00+08:00';
const DELETED = '2026-09-26T09:00:00+08:00';
const DEADLINE = '2026-10-03T01:00:00.000Z';
const STAGING = `student-works/staging/${hashHex(JSON.stringify([ORG, STUDENT]))}/${WORK}.mp3`;
const actor: TrustedActorContext = { requestId: 'req_teacher_restore', sessionId: 'ses_teacher',
  actorUserId: 'teacher_manager', actorRole: 'teacher', organizationId: ORG,
  platformSubjectDigest: 'digest_teacher', permissions: ['task.read'],
  scopeIds: ['class_other'], authzVersion: 2 };

function fixture(permissions = ['dashboard.read', 'user.manage', 'student_work.restore'],
  recoverableUntil = DEADLINE, membershipClassId = 'class_demo', now = NOW) {
  const base = { organizationId: ORG, schemaVersion: 1 as const, version: 1,
    deletedAt: null };
  const database = new FakeDocumentDatabase({
    users: [{ _id: actor.actorUserId, ...base, version: 2, status: 'active', authorizationVersion: 2 },
      { _id: STUDENT, ...base, status: 'active' }],
    native_admin_grants: [{ _id: nativeAdminGrantId(ORG, actor.actorUserId), ...base,
      teacherId: actor.actorUserId, status: 'active', permissions,
      scope: { organizationWide: false, classIds: ['class_demo'] } }],
    class_memberships: [{ _id: 'member_demo', ...base, studentId: STUDENT,
      classId: membershipClassId, status: 'active' }],
    student_works: [{ _id: WORK, id: WORK, ...base, version: 2,
      deletedAt: DELETED, recoverableUntil, deletedByUserId: STUDENT,
      recoveryState: 'deleted', studentId: STUDENT, classId: 'class_demo',
      materialId: 'material_demo', materialVersion: 'demo-v1', stagingPath: STAGING,
      status: 'draft', fileId: null, contentSha256: null, sizeBytes: null,
      durationMs: null, note: '', createdAt: '2026-09-25T09:00:00+08:00', submittedAt: null }],
    learning_resources: [{ _id: 'material_demo', ...base, title: '虚构配音素材', type: 'work' }],
  });
  const service = new NativeAdminWorkRestoreService(database,
    new DocumentNativeAdminGrantRepository(database), { nowIso: () => now });
  return { database, service };
}

describe('A-03 native teacher recovery', () => {
  it('lists minimal records and restores with current fine-grained grant, CAS and audit', async () => {
    const { database, service } = fixture();
    const page = await service.listDeleted(actor, STUDENT, 20, 0);
    expect(page).toMatchObject({ items: [{ id: WORK, restorable: true }], nextOffset: null });
    expect(JSON.stringify(page)).not.toContain('stagingPath');
    const input = { studentId: STUDENT, workId: WORK, reason: '核对虚构误删草稿' };
    const first = await service.restore(actor, input, 2, 'operation_native_restore');
    expect(first).toMatchObject({ id: WORK, version: 3, restoredByUserId: actor.actorUserId });
    expect(await service.restore(actor, input, 2, 'operation_native_restore')).toEqual(first);
    expect(database.snapshot().operation_logs?.[0]).toMatchObject({ actorRole: 'teacher',
      action: 'student_work.restoreDraft' });
    expect(database.snapshot().student_works?.[0]).toMatchObject({ deletedAt: null,
      recoveryState: 'active', version: 3 });
  });

  it('rejects missing restore permission, old sessions and expired drafts', async () => {
    await expect(fixture(['dashboard.read', 'user.manage']).service.listDeleted(actor, STUDENT, 20, 0))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(fixture().service.listDeleted({ ...actor, authzVersion: 1 }, STUDENT, 20, 0))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    const { service } = fixture();
    await expect(service.restore(actor, { studentId: STUDENT, workId: WORK,
      reason: '过期后尝试' }, 1, 'operation_old_version')).rejects.toMatchObject({ code: 'CONFLICT' });
    const extended = fixture(undefined, '2026-10-05T01:00:00.000Z');
    expect((await extended.service.listDeleted(actor, STUDENT, 20, 0)).items[0])
      .toMatchObject({ restorable: false, blockedReason: 'invalid_record' });
    await expect(extended.service.restore(actor, { studentId: STUDENT, workId: WORK,
      reason: '异常延长期限' }, 2, 'operation_extended')).rejects.toMatchObject({ code: 'CONFLICT' });
    const expired = fixture(undefined, DEADLINE, 'class_demo', DEADLINE);
    expect((await expired.service.listDeleted(actor, STUDENT, 20, 0)).items[0])
      .toMatchObject({ restorable: false, blockedReason: 'expired' });
    const crossClass = fixture(undefined, DEADLINE, 'class_other');
    await expect(crossClass.service.restore(actor, { studentId: STUDENT, workId: WORK,
      reason: '越班恢复' }, 2, 'operation_cross')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
