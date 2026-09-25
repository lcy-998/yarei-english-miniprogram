import { actorHasPermission, adminHasScope } from './authorization';
import type { OrgContentIdempotencyBoundary } from './idempotency';
import type { OrgContentRepository, OrgContentTransaction } from './repository';
import type { JsonValue } from '../shared/protocol';
import {
  OrgContentError,
  type Actor,
  type BindingCodeEntity,
  type BindingCodeIssueView,
  type ParentStudentLinkEntity,
  type ParentStudentLinkView,
  type RelationshipAuditEntity,
  type SliceClock,
} from './types';
import { userSafeView } from './organization-service';

export interface BindingCodeGenerator {
  nextSixDigits(): string;
  deriveSixDigits?(seed: string): string;
}

export interface BindingCodeDigestPort {
  digest(value: string): string;
}

export interface RelationshipIdGenerator {
  next(prefix: string): string;
}

type BindOutcome =
  | { readonly kind: 'success'; readonly link: ParentStudentLinkEntity }
  | { readonly kind: 'failure'; readonly code: 'VALIDATION_ERROR' | 'FORBIDDEN' | 'CONFLICT'; readonly audited: boolean };

type RelationshipAuditReasonCode =
  | OrgContentError['code']
  | 'INTERNAL_ERROR'
  | 'invalid_credentials'
  | 'expired'
  | 'locked'
  | 'mismatch'
  | 'already_bound'
  | 'parent_limit'
  | 'student_limit';

class RelationshipCommandError extends OrgContentError {
  public constructor(code: OrgContentError['code'], public readonly audited: boolean) {
    super(code);
  }
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function expiresIn24Hours(now: string): string {
  const timestamp = Date.parse(now);
  if (!Number.isFinite(timestamp)) throw new OrgContentError('CONFLICT');
  return new Date(timestamp + ONE_DAY_MS).toISOString();
}

export class RelationshipService {
  public constructor(
    private readonly repository: OrgContentRepository,
    private readonly clock: SliceClock,
    private readonly ids: RelationshipIdGenerator,
    private readonly codes: BindingCodeGenerator,
    private readonly digests: BindingCodeDigestPort,
    private readonly idempotency: OrgContentIdempotencyBoundary,
  ) {}

  public async issueBindingCode(actor: Actor, studentId: string, operationId: string): Promise<BindingCodeIssueView> {
    const codeSeed = `${actor.organizationId}:${studentId}:${operationId}`;
    return this.idempotency.execute({
      actor,
      functionName: 'relationship-command',
      action: 'issueBindingCode',
      operationId,
      payload: { studentId },
      onBoundaryError: async (error, transaction) => this.writeDeniedAudit(actor, 'binding_code.rejected', studentId, undefined, error, transaction),
      serializeResult: (value) => ({ expiresAt: value.expiresAt }),
      restoreResult: (value) => this.restoreBindingCodeIssue(value, codeSeed),
      perform: async (transaction) => {
        try {
          return await this.issueBindingCodeCore(actor, studentId, codeSeed, transaction);
        } catch (error: unknown) {
          if (error instanceof OrgContentError) {
            await this.writeDeniedAudit(actor, 'binding_code.rejected', studentId, undefined, error, transaction);
          }
          throw error;
        }
      },
    });
  }

  private async issueBindingCodeCore(
    actor: Actor,
    studentId: string,
    codeSeed: string,
    providedTransaction?: OrgContentTransaction,
  ): Promise<BindingCodeIssueView> {
    const code = this.codeForOperation(codeSeed);
    if (!/^\d{6}$/.test(code)) throw new OrgContentError('CONFLICT');
    const now = this.clock.nowIso();
    const expiresAt = expiresIn24Hours(now);
    await this.runTransaction(providedTransaction, async (transaction) => {
      // CloudBase transactions serialize reads. Parallel reads may be rejected as
      // transaction-busy, which otherwise becomes an indistinguishable conflict.
      const student = await transaction.findUser(actor.organizationId, studentId);
      const membership = await transaction.findActiveMembershipForStudent(actor.organizationId, studentId);
      const activeCode = await transaction.findActiveBindingCodeForStudent(actor.organizationId, studentId);
      if (student === null || student.status !== 'active' || !student.roles.includes('student') || membership === null) throw new OrgContentError('NOT_FOUND');
      if (actor.actorRole === 'teacher') {
        const grant = await transaction.findActiveTeacherGrant(actor.organizationId, actor.actorUserId, membership.classId);
        if (!actorHasPermission(actor, 'student.bind-code.issue')
          || !actor.scopeIds.includes(membership.classId)
          || grant === null
          || !grant.permissions.includes('student.bind-code.issue')) throw new OrgContentError('FORBIDDEN');
      } else if (actor.actorRole !== 'admin'
        || !actorHasPermission(actor, 'student.bind-code.issue')
        || !adminHasScope(actor, actor.organizationId, membership.classId)) {
        throw new OrgContentError('FORBIDDEN');
      }
      if (activeCode !== null) {
        await transaction.saveBindingCode({ ...activeCode, status: 'revoked', version: activeCode.version + 1 });
      }
      const bindingCode: BindingCodeEntity = {
        id: this.ids.next('bnd'),
        organizationId: actor.organizationId,
        studentId,
        codeDigest: this.digestCode(actor.organizationId, studentId, code),
        status: 'active',
        attemptCount: 0,
        expiresAt,
        createdBy: actor.actorUserId,
        createdAt: now,
        version: 1,
      };
      await transaction.saveBindingCode(bindingCode);
      await transaction.appendRelationshipAudit(this.audit(actor, 'binding_code.issued', studentId, 'succeeded'));
    });
    return { code, expiresAt };
  }

  public async bindChild(actor: Actor, studentNumber: string, code: string, operationId: string): Promise<ParentStudentLinkView> {
    return this.idempotency.execute({
      actor,
      functionName: 'relationship-command',
      action: 'bindChild',
      operationId,
      payload: { studentNumber, code },
      onBoundaryError: async (error, transaction) => this.writeDeniedAudit(actor, 'binding_code.rejected', 'student_unresolved', actor.actorUserId, error, transaction),
      perform: async (transaction) => {
        try {
          return await this.bindChildCore(actor, studentNumber, code, transaction);
        } catch (error: unknown) {
          if (error instanceof OrgContentError
            && (!(error instanceof RelationshipCommandError) || !error.audited)) {
            await this.writeDeniedAudit(actor, 'binding_code.rejected', 'student_unresolved', actor.actorUserId, error, transaction);
          }
          throw error;
        }
      },
    });
  }

  private async bindChildCore(
    actor: Actor,
    studentNumber: string,
    code: string,
    providedTransaction?: OrgContentTransaction,
  ): Promise<ParentStudentLinkView> {
    if (actor.actorRole !== 'parent' || !actorHasPermission(actor, 'child.bind')) throw new OrgContentError('FORBIDDEN');
    if (studentNumber.trim().length === 0 || !/^\d{6}$/.test(code)) throw new OrgContentError('VALIDATION_ERROR');
    const execute = async (transaction: OrgContentTransaction) => {
      const student = await transaction.findUserByStudentNumber(actor.organizationId, studentNumber);
      if (student === null || student.status !== 'active') throw new OrgContentError('VALIDATION_ERROR');
      const outcome = await this.bindInTransaction(transaction, actor, student.id, code);
      return { student, outcome };
    };
    const completed = providedTransaction === undefined
      ? await this.repository.transaction(execute)
      : await execute(providedTransaction);
    if (completed.outcome.kind === 'failure') {
      throw new RelationshipCommandError(completed.outcome.code, completed.outcome.audited);
    }
    return {
      id: completed.outcome.link.id,
      child: userSafeView(completed.student),
      confirmedAt: completed.outcome.link.confirmedAt,
      version: completed.outcome.link.version,
    };
  }

  public async unbindChild(actor: Actor, childId: string, expectedVersion: number, reason: string, operationId: string): Promise<void> {
    return this.idempotency.execute({
      actor,
      functionName: 'relationship-command',
      action: 'unbindChild',
      operationId,
      payload: { childId, reason },
      expectedVersion,
      onBoundaryError: async (error, transaction) => this.writeDeniedAudit(actor, 'parent_student.unbound', childId, actor.actorUserId, error, transaction),
      perform: async (transaction) => {
        try {
          await this.unbindChildCore(actor, childId, expectedVersion, reason, transaction);
        } catch (error: unknown) {
          if (error instanceof OrgContentError) {
            await this.writeDeniedAudit(actor, 'parent_student.unbound', childId, actor.actorUserId, error, transaction);
          }
          throw error;
        }
      },
    });
  }

  private async unbindChildCore(actor: Actor, childId: string, expectedVersion: number, reason: string, providedTransaction?: OrgContentTransaction): Promise<void> {
    if (actor.actorRole !== 'parent' || !actorHasPermission(actor, 'child.unbind')) throw new OrgContentError('FORBIDDEN');
    if (reason.trim().length === 0) throw new OrgContentError('VALIDATION_ERROR');
    await this.runTransaction(providedTransaction, async (transaction) => {
      const current = await transaction.findActiveParentLink(actor.organizationId, actor.actorUserId, childId);
      if (current === null) throw new OrgContentError('NOT_FOUND');
      if (current.version !== expectedVersion) throw new OrgContentError('CONFLICT');
      const revokedAt = this.clock.nowIso();
      await transaction.saveParentLink({
        ...current,
        status: 'revoked',
        revokedAt,
        revokedBy: actor.actorUserId,
        revokeReason: reason.trim(),
        version: current.version + 1,
      });
      await transaction.appendRelationshipAudit(this.audit(actor, 'parent_student.unbound', childId, 'succeeded', actor.actorUserId));
    });
  }

  public async getLinkedChild(actor: Actor, childId: string): Promise<ParentStudentLinkView> {
    if (actor.actorRole !== 'parent' || !actorHasPermission(actor, 'child.read')) throw new OrgContentError('FORBIDDEN');
    const link = await this.repository.findActiveParentLink(actor.organizationId, actor.actorUserId, childId);
    if (link === null) throw new OrgContentError('NOT_FOUND');
    const child = await this.repository.findUser(actor.organizationId, childId);
    if (child === null || child.status !== 'active') throw new OrgContentError('NOT_FOUND');
    return { id: link.id, child: userSafeView(child), confirmedAt: link.confirmedAt, version: link.version };
  }

  private async bindInTransaction(transaction: OrgContentTransaction, actor: Actor, studentId: string, code: string): Promise<BindOutcome> {
    const now = this.clock.nowIso();
    // Keep transaction reads sequential for the CloudBase document adapter.
    const student = await transaction.findUser(actor.organizationId, studentId);
    const parent = await transaction.findUser(actor.organizationId, actor.actorUserId);
    const membership = await transaction.findActiveMembershipForStudent(actor.organizationId, studentId);
    const bindingCode = await transaction.findActiveBindingCodeForStudent(actor.organizationId, studentId);
    if (student === null || student.status !== 'active' || !student.roles.includes('student') || membership === null
      || parent === null || parent.status !== 'active' || !parent.roles.includes('parent')) {
      return { kind: 'failure', code: parent === null || parent.status !== 'active' || !parent.roles.includes('parent') ? 'FORBIDDEN' : 'VALIDATION_ERROR', audited: false };
    }
    if (bindingCode === null) {
      await transaction.appendRelationshipAudit(this.audit(actor, 'binding_code.rejected', studentId, 'denied', actor.actorUserId, 'invalid_credentials'));
      return { kind: 'failure', code: 'VALIDATION_ERROR', audited: true };
    }
    if (Date.parse(bindingCode.expiresAt) <= Date.parse(now)) {
      await transaction.saveBindingCode({ ...bindingCode, status: 'expired', version: bindingCode.version + 1 });
      await transaction.appendRelationshipAudit(this.audit(actor, 'binding_code.rejected', studentId, 'denied', actor.actorUserId, 'expired'));
      return { kind: 'failure', code: 'VALIDATION_ERROR', audited: true };
    }
    if (bindingCode.codeDigest !== this.digestCode(actor.organizationId, studentId, code)) {
      const attemptCount = bindingCode.attemptCount + 1;
      await transaction.saveBindingCode({
        ...bindingCode,
        attemptCount,
        status: attemptCount >= 5 ? 'locked' : 'active',
        version: bindingCode.version + 1,
      });
      await transaction.appendRelationshipAudit(this.audit(actor, 'binding_code.rejected', studentId, 'denied', actor.actorUserId, attemptCount >= 5 ? 'locked' : 'mismatch'));
      return { kind: 'failure', code: 'VALIDATION_ERROR', audited: true };
    }
    const existing = await transaction.findActiveParentLink(actor.organizationId, actor.actorUserId, studentId);
    const childCount = await transaction.countActiveChildren(actor.organizationId, actor.actorUserId);
    const parentCount = await transaction.countActiveParents(actor.organizationId, studentId);
    if (existing !== null || childCount >= 5 || parentCount >= 3) {
      const reason = existing !== null ? 'already_bound' : childCount >= 5 ? 'parent_limit' : 'student_limit';
      await transaction.appendRelationshipAudit(this.audit(actor, 'binding_code.rejected', studentId, 'denied', actor.actorUserId, reason));
      return { kind: 'failure', code: 'CONFLICT', audited: true };
    }
    const link: ParentStudentLinkEntity = {
      id: this.ids.next('psl'),
      organizationId: actor.organizationId,
      parentId: actor.actorUserId,
      studentId,
      status: 'active',
      confirmedBy: bindingCode.createdBy,
      confirmedAt: now,
      confirmationSource: 'binding_code',
      version: 1,
    };
    await transaction.saveParentLink(link);
    await transaction.saveBindingCode({
      ...bindingCode,
      status: 'used',
      usedAt: now,
      usedByParentId: actor.actorUserId,
      version: bindingCode.version + 1,
    });
    await transaction.appendRelationshipAudit(this.audit(actor, 'parent_student.bound', studentId, 'succeeded', actor.actorUserId));
    return { kind: 'success', link };
  }

  private digestCode(organizationId: string, studentId: string, code: string): string {
    return this.digests.digest(`${organizationId}:${studentId}:${code}`);
  }

  private codeForOperation(seed: string): string {
    return this.codes.deriveSixDigits?.(seed) ?? this.codes.nextSixDigits();
  }

  private restoreBindingCodeIssue(value: JsonValue, seed: string): BindingCodeIssueView {
    if (!isJsonObject(value)
      || typeof value.expiresAt !== 'string' || this.codes.deriveSixDigits === undefined) {
      throw new OrgContentError('CONFLICT');
    }
    const code = this.codes.deriveSixDigits(seed);
    if (!/^\d{6}$/.test(code)) throw new OrgContentError('CONFLICT');
    return { code, expiresAt: value.expiresAt };
  }

  private audit(
    actor: Actor,
    action: RelationshipAuditEntity['action'],
    studentId: string,
    result: RelationshipAuditEntity['result'],
    parentId?: string,
    reasonCode?: RelationshipAuditReasonCode,
  ): RelationshipAuditEntity {
    const targetType = action.startsWith('binding_code.') ? 'binding_code' : 'parent_student_link';
    return {
      id: this.ids.next('rel_audit'),
      organizationId: actor.organizationId,
      requestId: actor.requestId,
      actorUserId: actor.actorUserId,
      actorRole: actor.actorRole,
      action,
      targetType,
      targetId: studentId,
      result,
      errorCode: result === 'succeeded' ? null : relationshipAuditErrorCode(reasonCode),
      metadata: {
        studentId,
        ...(parentId === undefined ? {} : { parentId }),
        ...(reasonCode === undefined ? {} : { reasonCode }),
      },
      occurredAt: this.clock.nowIso(),
    };
  }

  private async writeDeniedAudit(
    actor: Actor,
    action: RelationshipAuditEntity['action'],
    studentId: string,
    parentId: string | undefined,
    error: unknown,
    providedTransaction?: OrgContentTransaction,
  ): Promise<void> {
    const reasonCode = error instanceof OrgContentError ? error.code : 'INTERNAL_ERROR';
    await this.runTransaction(providedTransaction, async (transaction) => transaction.appendRelationshipAudit(
      this.audit(actor, action, studentId, error instanceof OrgContentError ? 'denied' : 'failed', parentId, reasonCode),
    ));
  }

  private runTransaction<T>(
    transaction: OrgContentTransaction | undefined,
    work: (current: OrgContentTransaction) => Promise<T>,
  ): Promise<T> {
    return transaction === undefined ? this.repository.transaction(work) : work(transaction);
  }
}

function relationshipAuditErrorCode(reasonCode: RelationshipAuditReasonCode | undefined): OrgContentError['code'] | 'INTERNAL_ERROR' {
  if (reasonCode === 'INTERNAL_ERROR') return reasonCode;
  if (reasonCode === 'FORBIDDEN' || reasonCode === 'NOT_FOUND' || reasonCode === 'RESOURCE_OFFLINE') return reasonCode;
  if (reasonCode === 'CONFLICT' || reasonCode === 'already_bound' || reasonCode === 'parent_limit' || reasonCode === 'student_limit') {
    return 'CONFLICT';
  }
  return 'VALIDATION_ERROR';
}

function isJsonObject(value: JsonValue): value is Readonly<Record<string, JsonValue>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
