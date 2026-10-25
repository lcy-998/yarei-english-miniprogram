import { describe, expect, it } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { TeacherStudentBulkImportService, type BulkImportRowOutcome,
  type TeacherStudentBulkImportPort } from '../../src/teacher-students/bulk-import-command';

const teacher: TrustedActorContext = { requestId: 'req_demo', sessionId: 'ses_demo',
  actorUserId: 'teacher_demo', actorRole: 'teacher', organizationId: 'org_demo',
  platformSubjectDigest: 'digest_demo', permissions: ['student.import'],
  scopeIds: ['class_demo'], authzVersion: 1 };

function csv(rows: readonly string[]): Uint8Array {
  return new TextEncoder().encode(`student_number,display_name,mobile,class_id\r\n${rows.join('\r\n')}\r\n`);
}

function fixture() {
  let classAllowed = true;
  let failCommit = false;
  let failRowReceipt = false;
  let authCreates = 0;
  let existingStudentNumberReads = 0;
  const created = new Map<string, string>();
  const outcomes = new Map<string, BulkImportRowOutcome>();
  const operations = new Map<string, { fileDigest: string; totalRowCount: number; outcomes: readonly BulkImportRowOutcome[] }>();
  const blocked: string[] = [];
  const audit: unknown[] = [];
  const port: TeacherStudentBulkImportPort = {
    async authorizedClassIds() { return classAllowed ? ['class_demo'] : []; },
    async existingStudentNumbers() { existingStudentNumberReads += 1; return [...created.values()]; },
    async mobileExists() { return false; },
    async findOperation(_org, teacherId, operationId) {
      return operations.get(`${teacherId}:${operationId}`) ?? null; },
    async findRowOutcome(_org, teacherId, operationId, lineNumber) {
      return outcomes.get(`${teacherId}:${operationId}:${lineNumber}`) ?? null; },
    async createAuthAccount(_row, rowOperationId) { authCreates += 1;
      return { platformUid: `uid_${rowOperationId}`, subjectDigest: `sd1_${rowOperationId}` }; },
    async commitStudent({ row, rowOperationId }) {
      if (failCommit) throw new Error('simulated failure');
      created.set(rowOperationId, row.studentNumber);
      return `usr_${row.studentNumber}`;
    },
    async findCommittedStudent(_org, rowOperationId) {
      const number = created.get(rowOperationId); return number ? `usr_${number}` : null;
    },
    async blockUnlinkedAccount(account) { blocked.push(account.platformUid); },
    async saveRowOutcome(_org, teacherId, operationId, outcome) {
      if (failRowReceipt && outcome.status === 'created') throw new Error('receipt unavailable');
      outcomes.set(`${teacherId}:${operationId}:${outcome.lineNumber}`, outcome); },
    async saveOperation(_org, teacherId, operationId, fileDigest, totalRowCount, rows) {
      operations.set(`${teacherId}:${operationId}`, { fileDigest, totalRowCount, outcomes: rows });
    },
    async appendAudit(entry) { audit.push(entry); },
  };
  return { service: new TeacherStudentBulkImportService(port), blocked, audit,
    get authCreates() { return authCreates; }, revoke() { classAllowed = false; },
    get existingStudentNumberReads() { return existingStudentNumberReads; },
    failBusiness() { failCommit = true; }, setRowReceiptAvailable(value: boolean) { failRowReceipt = !value; } };
}

describe('protected teacher bulk import orchestration', () => {
  it('creates only valid rows, records safe results and replays without another Auth account', async () => {
    const state = fixture();
    const bytes = csv(['DEMO001,测试学员甲,13900000001,class_demo',
      'BAD002,测试学员乙,13900000002,class_other']);
    const first = await state.service.execute(teacher, bytes, 'import_demo');
    expect(first).toMatchObject({ ok: true, totalRowCount: 2,
      outcomes: [{ lineNumber: 2, status: 'created', studentId: 'usr_DEMO001' },
        { lineNumber: 3, status: 'rejected', code: 'CLASS_NOT_ALLOWED' }] });
    const replay = await state.service.execute(teacher, bytes, 'import_demo');
    expect(replay).toMatchObject({ ok: true, totalRowCount: 2 });
    expect(state.authCreates).toBe(1);
    expect(state.existingStudentNumberReads).toBe(1);
    expect(JSON.stringify(state.audit)).not.toContain('13900000001');
    expect(JSON.stringify(state.audit)).not.toContain('测试学员甲');
    expect(await state.service.execute(teacher, csv(['DEMO999,测试学员丙,13900000003,class_demo']), 'import_demo'))
      .toEqual({ ok: false, code: 'CONFLICT' });
  });

  it('blocks an unlinked Auth account when the business transaction fails', async () => {
    const state = fixture(); state.failBusiness();
    const result = await state.service.execute(teacher,
      csv(['DEMO010,测试学员甲,13900000010,class_demo']), 'import_failed');
    expect(result).toMatchObject({ ok: true, outcomes: [{ status: 'failed', code: 'BUSINESS_COMMIT_FAILED' }] });
    expect(state.blocked).toHaveLength(1);
    expect(state.blocked[0]).toMatch(/^uid_row_[a-f0-9]{64}$/);
  });

  it('rejects an old session after grant revocation even for an existing operation', async () => {
    const state = fixture();
    const bytes = csv(['DEMO011,测试学员甲,13900000011,class_demo']);
    await state.service.execute(teacher, bytes, 'import_revoked');
    state.revoke();
    expect(await state.service.execute(teacher, bytes, 'import_revoked')).toEqual({ ok: false, code: 'FORBIDDEN' });
  });

  it('keeps row receipts and external account keys separate for two teachers sharing an operation ID', async () => {
    const state = fixture();
    const otherTeacher = { ...teacher, actorUserId: 'teacher_other', requestId: 'req_other' };
    const first = await state.service.execute(teacher,
      csv(['DEMO021,测试学员甲,13900000021,class_demo']), 'import_same');
    const second = await state.service.execute(otherTeacher,
      csv(['DEMO022,测试学员乙,13900000022,class_demo']), 'import_same');
    expect(first).toMatchObject({ ok: true, outcomes: [{ status: 'created', studentId: 'usr_DEMO021' }] });
    expect(second).toMatchObject({ ok: true, outcomes: [{ status: 'created', studentId: 'usr_DEMO022' }] });
    expect(state.authCreates).toBe(2);
  });

  it('reconciles a committed row when its receipt failed before a retry', async () => {
    const state = fixture(); state.setRowReceiptAvailable(false);
    const input = csv(['DEMO031,测试学员甲,13900000031,class_demo']);
    expect(await state.service.execute(teacher, input, 'import_lost_receipt'))
      .toEqual({ ok: false, code: 'SERVICE_UNAVAILABLE' });
    state.setRowReceiptAvailable(true);
    const replay = await state.service.execute(teacher, input, 'import_lost_receipt');
    expect(replay).toMatchObject({ ok: true,
      outcomes: [{ status: 'created', studentId: 'usr_DEMO031' }] });
    expect(state.authCreates).toBe(1);
  });
});
