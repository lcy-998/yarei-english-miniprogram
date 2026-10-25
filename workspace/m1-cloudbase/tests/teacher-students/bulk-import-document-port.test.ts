import { describe, expect, it } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import { TeacherStudentBulkImportService } from '../../src/teacher-students/bulk-import-command';
import { DocumentTeacherStudentBulkImportPort, TEACHER_STUDENT_IMPORT_COLLECTIONS,
  type TeacherStudentAuthProvisioningPort } from '../../src/teacher-students/bulk-import-document-port';

const organizationId = 'org_demo';
const teacherId = 'teacher_demo';
const classId = 'class_demo';
const actor: TrustedActorContext = { requestId: 'req_teacher', sessionId: 'ses_teacher',
  actorUserId: teacherId, actorRole: 'teacher', organizationId,
  platformSubjectDigest: 'digest_teacher', permissions: ['student.import'],
  scopeIds: [classId], authzVersion: 1 };
const bytes = new TextEncoder().encode('student_number,display_name,mobile,class_id\r\nDEMO100,测试学员甲,13900000100,class_demo\r\n');

function fixture() {
  const database = new FakeDocumentDatabase({
    [TEACHER_STUDENT_IMPORT_COLLECTIONS.users]: [{ _id: teacherId, organizationId,
      schemaVersion: 1, version: 1, deletedAt: null, status: 'active', authorizationVersion: 1 }],
    [TEACHER_STUDENT_IMPORT_COLLECTIONS.classes]: [{ _id: classId, organizationId,
      schemaVersion: 1, version: 1, deletedAt: null, status: 'active' }],
    [TEACHER_STUDENT_IMPORT_COLLECTIONS.grants]: [{ _id: 'grant_demo', organizationId,
      schemaVersion: 1, version: 1, deletedAt: null, teacherId, classId,
      status: 'active', permissions: ['student.import'] }],
  });
  const accounts = new Map<string, string>();
  const blocked: string[] = [];
  const auth: TeacherStudentAuthProvisioningPort = {
    async mobileExists(mobile) { return [...accounts.values()].includes(mobile); },
    async createExternalStudent(row, rowOperationId) {
      accounts.set(rowOperationId, row.mobile);
      return { platformUid: `uid_${rowOperationId}`, subjectDigest: `sd1_${rowOperationId}` };
    },
    async blockUnlinkedAccount(_account, rowOperationId) { blocked.push(rowOperationId); },
  };
  const service = new TeacherStudentBulkImportService(new DocumentTeacherStudentBulkImportPort(database,
    auth, { nowIso: () => '2026-10-03T08:00:00+08:00' }));
  return { database, service, blocked };
}

describe('T-02 protected import document transaction', () => {
  it('creates one login identity, student role and class membership without saving mobile or password', async () => {
    const { database, service } = fixture();
    const result = await service.execute(actor, bytes, 'operation_import_demo');
    expect(result).toMatchObject({ ok: true, totalRowCount: 1,
      outcomes: [{ status: 'created', classId }] });
    const snapshot = database.snapshot();
    const users = snapshot[TEACHER_STUDENT_IMPORT_COLLECTIONS.users] ?? [];
    expect(users).toHaveLength(2);
    expect(users.find(row => row.studentNumber === 'DEMO100')).toMatchObject({
      displayName: '测试学员甲', displayNameMasked: '测**', authorizationVersion: 1 });
    expect(snapshot[TEACHER_STUDENT_IMPORT_COLLECTIONS.identities]).toMatchObject([{
      provider: 'cloudbase_uid', status: 'active' }]);
    expect(snapshot[TEACHER_STUDENT_IMPORT_COLLECTIONS.roles]).toMatchObject([{
      role: 'student', permissions: ['content.read', 'task.read'] }]);
    expect(snapshot[TEACHER_STUDENT_IMPORT_COLLECTIONS.memberships]).toMatchObject([{
      classId, status: 'active' }]);
    expect(snapshot[TEACHER_STUDENT_IMPORT_COLLECTIONS.studentNumbers])
      .toMatchObject([{ studentNumber: 'DEMO100' }]);
    expect(snapshot[TEACHER_STUDENT_IMPORT_COLLECTIONS.classes]?.[0]).toMatchObject({ version: 2 });
    expect(JSON.stringify(snapshot)).not.toContain('13900000100');
    expect(JSON.stringify(snapshot)).not.toContain('password');
    const replay = await service.execute(actor, bytes, 'operation_import_demo');
    expect(replay).toMatchObject({ ok: true, totalRowCount: 1 });
    expect(database.snapshot()[TEACHER_STUDENT_IMPORT_COLLECTIONS.users]).toHaveLength(2);
  });

  it('blocks an orphaned Auth account when the business transaction rolls back', async () => {
    const { database, service, blocked } = fixture();
    database.failNext({ operation: 'create', collection: TEACHER_STUDENT_IMPORT_COLLECTIONS.identities,
      kind: 'conflict' });
    const result = await service.execute(actor, bytes, 'operation_import_failure');
    expect(result).toMatchObject({ ok: true,
      outcomes: [{ status: 'failed', code: 'BUSINESS_COMMIT_FAILED' }] });
    expect(blocked).toHaveLength(1);
    expect(blocked[0]).toMatch(/^row_[a-f0-9]{64}$/);
    expect(database.snapshot()[TEACHER_STUDENT_IMPORT_COLLECTIONS.users]).toHaveLength(1);
    expect(database.snapshot()[TEACHER_STUDENT_IMPORT_COLLECTIONS.commits] ?? []).toHaveLength(0);
  });
});
