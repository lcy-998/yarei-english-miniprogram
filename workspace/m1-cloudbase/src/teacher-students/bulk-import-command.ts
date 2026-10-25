import { createHash } from 'node:crypto';
import type { TrustedActorContext } from '../auth/trusted-actor';
import {
  planTeacherStudentCsvImport, type TeacherStudentImportCommandPlanRow,
  type TeacherStudentImportError,
} from './bulk-csv';

export type BulkImportRowOutcome =
  | Readonly<{ lineNumber: number; status: 'created'; studentId: string; classId: string }>
  | Readonly<{ lineNumber: number; status: 'rejected' | 'failed'; code: string }>;

export interface BulkImportAccountReceipt {
  readonly platformUid: string;
  readonly subjectDigest: string;
}

/** Protected server ports; mobile and account secrets must never enter business logs. */
export interface TeacherStudentBulkImportPort {
  authorizedClassIds(actor: TrustedActorContext): Promise<readonly string[]>;
  existingStudentNumbers(organizationId: string): Promise<readonly string[]>;
  mobileExists(mobile: string, rowOperationId: string): Promise<boolean>;
  findOperation(organizationId: string, teacherId: string, operationId: string): Promise<Readonly<{
    fileDigest: string; totalRowCount: number; outcomes: readonly BulkImportRowOutcome[];
  }> | null>;
  findRowOutcome(organizationId: string, teacherId: string, operationId: string,
    lineNumber: number): Promise<BulkImportRowOutcome | null>;
  /** Must be idempotent by row operation key, including after network ambiguity. */
  createAuthAccount(row: TeacherStudentImportCommandPlanRow, rowOperationId: string): Promise<BulkImportAccountReceipt>;
  /** Must atomically create user, role, membership, identity mapping and audit, idempotent by row key. */
  commitStudent(input: Readonly<{ actor: TrustedActorContext; row: TeacherStudentImportCommandPlanRow;
    account: BulkImportAccountReceipt; rowOperationId: string; sourceFileDigest: string }>): Promise<string>;
  /** Resolves an ambiguous business commit before compensation. */
  findCommittedStudent(organizationId: string, rowOperationId: string): Promise<string | null>;
  /** Blocks an orphaned Auth account; never deletes a pre-existing user. */
  blockUnlinkedAccount(account: BulkImportAccountReceipt, rowOperationId: string): Promise<void>;
  saveRowOutcome(organizationId: string, teacherId: string, operationId: string,
    outcome: BulkImportRowOutcome): Promise<void>;
  saveOperation(organizationId: string, teacherId: string, operationId: string, fileDigest: string, totalRowCount: number,
    outcomes: readonly BulkImportRowOutcome[]): Promise<void>;
  appendAudit(entry: Readonly<{ organizationId: string; teacherId: string; operationId: string;
    fileDigest: string; createdCount: number; rejectedCount: number; failedCount: number }>): Promise<void>;
}

export type TeacherStudentBulkImportResult =
  | Readonly<{ ok: true; fileDigest: string; totalRowCount: number; outcomes: readonly BulkImportRowOutcome[];
    validationErrors: readonly TeacherStudentImportError[] }>
  | Readonly<{ ok: false; code: 'FORBIDDEN' | 'VALIDATION_ERROR' | 'CONFLICT' | 'SERVICE_UNAVAILABLE' }>;

/** Protected row-by-row import service; runtime composition supplies document and account ports. */
export class TeacherStudentBulkImportService {
  public constructor(private readonly port: TeacherStudentBulkImportPort) {}

  public async execute(actor: TrustedActorContext, bytes: Uint8Array,
    operationId: string): Promise<TeacherStudentBulkImportResult> {
    if (actor.actorRole !== 'teacher' || !actor.permissions.includes('student.import')) {
      return { ok: false, code: 'FORBIDDEN' };
    }
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(operationId)) return { ok: false, code: 'VALIDATION_ERROR' };
    const fileDigest = createHash('sha256').update(bytes).digest('hex');
    const classIds = await this.port.authorizedClassIds(actor);
    if (classIds.length === 0) return { ok: false, code: 'FORBIDDEN' };
    const previous = await this.port.findOperation(actor.organizationId, actor.actorUserId, operationId);
    if (previous !== null) {
      if (previous.fileDigest !== fileDigest) return { ok: false, code: 'CONFLICT' };
      if (previous.outcomes.some(row => row.status === 'created' && !classIds.includes(row.classId))) {
        return { ok: false, code: 'FORBIDDEN' };
      }
      await this.auditSummary(actor, operationId, fileDigest, previous.outcomes);
      return { ok: true, fileDigest, totalRowCount: previous.totalRowCount,
        outcomes: previous.outcomes, validationErrors: [] };
    }
    const plan = planTeacherStudentCsvImport(bytes, {
      allowedClassIds: classIds,
    });
    if (plan.blocked || plan.totalRowCount === 0) return { ok: false, code: 'VALIDATION_ERROR' };
    const existingStudentNumbers = new Set((await this.port.existingStudentNumbers(actor.organizationId))
      .map(number => number.toUpperCase()));
    const validationByLine = new Map<number, TeacherStudentImportError>();
    for (const issue of plan.errors) if (!validationByLine.has(issue.lineNumber)) validationByLine.set(issue.lineNumber, issue);
    const outcomes: BulkImportRowOutcome[] = [...validationByLine.values()].map(issue => ({ lineNumber: issue.lineNumber,
      status: 'rejected' as const, code: issue.code }));
    for (const row of plan.commands) {
      const currentClassIds = await this.port.authorizedClassIds(actor);
      const saved = await this.port.findRowOutcome(actor.organizationId, actor.actorUserId,
        operationId, row.sourceLineNumber);
      if (saved !== null) {
        if (saved.status === 'created' && !currentClassIds.includes(saved.classId)) {
          return { ok: false, code: 'FORBIDDEN' };
        }
        if (saved.status === 'created') existingStudentNumbers.add(row.studentNumber.toUpperCase());
        outcomes.push(saved);
        continue;
      }
      if (!currentClassIds.includes(row.classId)) {
        outcomes.push(await this.saveRejected(actor, operationId, row.sourceLineNumber, 'CLASS_NOT_ALLOWED'));
        continue;
      }
      const rowOperationId = `row_${createHash('sha256').update(JSON.stringify([
        actor.organizationId, actor.actorUserId, operationId, row.sourceLineNumber,
      ])).digest('hex')}`;
      const committed = await this.port.findCommittedStudent(actor.organizationId, rowOperationId);
      if (committed !== null) {
        const created = { lineNumber: row.sourceLineNumber, status: 'created' as const,
          studentId: committed, classId: row.classId };
        try { await this.port.saveRowOutcome(actor.organizationId, actor.actorUserId, operationId, created); }
        catch (_error: unknown) { return { ok: false, code: 'SERVICE_UNAVAILABLE' }; }
        existingStudentNumbers.add(row.studentNumber.toUpperCase());
        outcomes.push(created);
        continue;
      }
      if (existingStudentNumbers.has(row.studentNumber.toUpperCase())) {
        outcomes.push(await this.saveRejected(actor, operationId, row.sourceLineNumber, 'DUPLICATE_STUDENT_NUMBER'));
        continue;
      }
      if (await this.port.mobileExists(row.mobile, rowOperationId)) {
        outcomes.push(await this.saveRejected(actor, operationId, row.sourceLineNumber, 'DUPLICATE_MOBILE'));
        continue;
      }
      let account: BulkImportAccountReceipt;
      try {
        account = await this.port.createAuthAccount(row, rowOperationId);
      } catch (_error: unknown) {
        // Creation may have succeeded remotely even if its response was lost.
        // Retry with the same row key so the protected adapter can reconcile it.
        return { ok: false, code: 'SERVICE_UNAVAILABLE' };
      }
      try {
        // A grant may be revoked while the external Auth request is in flight.
        if (!(await this.port.authorizedClassIds(actor)).includes(row.classId)) {
          try { await this.port.blockUnlinkedAccount(account, rowOperationId); } catch (_error: unknown) {
            return { ok: false, code: 'SERVICE_UNAVAILABLE' };
          }
          outcomes.push(await this.saveRejected(actor, operationId, row.sourceLineNumber, 'CLASS_NOT_ALLOWED'));
          continue;
        }
        const studentId = await this.port.commitStudent({ actor, row, account, rowOperationId,
          sourceFileDigest: fileDigest });
        const created = { lineNumber: row.sourceLineNumber, status: 'created' as const,
          studentId, classId: row.classId };
        await this.port.saveRowOutcome(actor.organizationId, actor.actorUserId, operationId, created);
        existingStudentNumbers.add(row.studentNumber.toUpperCase());
        outcomes.push(created);
      } catch (_error: unknown) {
        const committed = await this.port.findCommittedStudent(actor.organizationId, rowOperationId);
        if (committed !== null) {
          const created = { lineNumber: row.sourceLineNumber, status: 'created' as const,
            studentId: committed, classId: row.classId };
          try { await this.port.saveRowOutcome(actor.organizationId, actor.actorUserId, operationId, created); }
          catch (_receiptError: unknown) { return { ok: false, code: 'SERVICE_UNAVAILABLE' }; }
          existingStudentNumbers.add(row.studentNumber.toUpperCase());
          outcomes.push(created);
          continue;
        }
        try { await this.port.blockUnlinkedAccount(account, rowOperationId); } catch (_blockError: unknown) {
          return { ok: false, code: 'SERVICE_UNAVAILABLE' };
        }
        const failure = { lineNumber: row.sourceLineNumber, status: 'failed' as const, code: 'BUSINESS_COMMIT_FAILED' };
        await this.port.saveRowOutcome(actor.organizationId, actor.actorUserId, operationId, failure);
        outcomes.push(failure);
      }
    }
    outcomes.sort((left, right) => left.lineNumber - right.lineNumber);
    await this.port.saveOperation(actor.organizationId, actor.actorUserId, operationId, fileDigest, plan.totalRowCount, outcomes);
    await this.auditSummary(actor, operationId, fileDigest, outcomes);
    return { ok: true, fileDigest, totalRowCount: plan.totalRowCount, outcomes,
      validationErrors: plan.errors };
  }

  private async saveRejected(actor: TrustedActorContext, operationId: string, lineNumber: number,
    code: string): Promise<BulkImportRowOutcome> {
    const rejected = { lineNumber, status: 'rejected' as const, code };
    await this.port.saveRowOutcome(actor.organizationId, actor.actorUserId, operationId, rejected);
    return rejected;
  }

  private auditSummary(actor: TrustedActorContext, operationId: string, fileDigest: string,
    outcomes: readonly BulkImportRowOutcome[]): Promise<void> {
    return this.port.appendAudit({ organizationId: actor.organizationId, teacherId: actor.actorUserId,
      operationId, fileDigest, createdCount: outcomes.filter(row => row.status === 'created').length,
      rejectedCount: outcomes.filter(row => row.status === 'rejected').length,
      failedCount: outcomes.filter(row => row.status === 'failed').length });
  }
}
