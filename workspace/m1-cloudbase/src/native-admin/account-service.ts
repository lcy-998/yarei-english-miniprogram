import { createHash } from 'node:crypto';
import { cloudbaseUsernameSubject, type TrustedActorContext } from '../auth/trusted-actor';
import type { DocumentDatabasePort, DocumentDatabaseTransactionPort, VersionedDocument } from '../repositories/document-database-port';
import type { SubjectDigestPort } from '../runtime/ports';
import { authorizeNativeAdmin, type NativeAdminGrantReader } from './authorization';
import { nativeAdminGrantId } from './document-grant-repository';

export type NativeAccountRole = 'student' | 'parent' | 'teacher' | 'admin';
export interface NativeAccountInput { displayName: string; mobile: string; role: NativeAccountRole;
  classId: string; reason: string }
export interface NativeAccountView { id: string; displayName: string; role: NativeAccountRole;
  status: 'active'; version: number; setupStatus: 'self_service_required' }
export interface NativeIdentityReceipt { platformUid: string; subjectDigest: string }
/** Supplied only by trusted runtime composition, never from a request or a client SDK. */
export interface NativeAccountProvider {
  mobileExists(mobile: string, operationKey: string): Promise<boolean>;
  /** Reconciles the deterministic phone identity without setting a password or sending SMS. */
  provision(input: Readonly<{ mobile: string; displayName: string }>, operationKey: string): Promise<NativeIdentityReceipt>;
  /** Blocks only this operation's unlinked identity, never a pre-existing account. */
  blockUnlinked(receipt: NativeIdentityReceipt, operationKey: string): Promise<void>;
}
export class NativeAccountError extends Error {
  constructor(public readonly code: 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION_ERROR' | 'SERVICE_UNAVAILABLE') { super(code); }
}

const OPERATIONS = 'native_admin_account_operations';
type AccountOperation = VersionedDocument & { fingerprint: string; state: string };

export class NativeAdminAccountService {
  constructor(private readonly database: DocumentDatabasePort, private readonly grants: NativeAdminGrantReader,
    private readonly digest: SubjectDigestPort, private readonly clock: Readonly<{ nowIso(): string }>,
    private readonly provider?: NativeAccountProvider) {}

  public async createUser(actor: TrustedActorContext, input: NativeAccountInput, expectedVersion: number,
    operationId: string): Promise<NativeAccountView> {
    validateOperation(operationId, input.reason);
    if (expectedVersion !== 0 || !/^1\d{10}$/.test(input.mobile) || input.displayName.trim().length > 50
      || !['student', 'parent', 'teacher', 'admin'].includes(input.role)
      || input.classId && !validId(input.classId) || input.role === 'student' && !input.classId
      || input.role !== 'student' && input.classId) throw new NativeAccountError('VALIDATION_ERROR');
    await this.access(actor, input.role, input.classId);
    if (!this.provider) throw new NativeAccountError('SERVICE_UNAVAILABLE');
    const key = operationKey(actor, operationId);
    const fingerprint = this.digest.digest(JSON.stringify(['createUser', input]));
    const prior = await this.database.runTransaction(tx => this.readOperation(tx, key, fingerprint));
    if (prior?.state === 'committed') return accountResult(prior.result);
    if (prior && prior.state !== 'pending') {
      await this.resumeCompensation(key, prior);
      throw new NativeAccountError('SERVICE_UNAVAILABLE');
    }
    try {
      if (await this.provider.mobileExists(input.mobile, key)) throw new NativeAccountError('CONFLICT');
    } catch (error) {
      throw error instanceof NativeAccountError ? error : new NativeAccountError('SERVICE_UNAVAILABLE');
    }
    const prepared = await this.database.runTransaction(async tx => {
      await this.guard(tx, actor, input.role, input.classId);
      const prior = await this.readOperation(tx, key, fingerprint);
      if (prior) return prior;
      const mobileKey = `mobile_${hash(this.digest.digest(`native_account_mobile:${input.mobile}`))}`;
      const reservation = await tx.get(OPERATIONS, mobileKey);
      if (reservation && reservation.operationKey !== key) throw new NativeAccountError('CONFLICT');
      if (!reservation && !await tx.create(OPERATIONS, { ...base(actor.organizationId, mobileKey), operationKey: key })) {
        throw new NativeAccountError('CONFLICT');
      }
      const row: AccountOperation = { ...base(actor.organizationId, key), fingerprint, state: 'pending',
        actorUserId: actor.actorUserId, action: 'createUser', createdAt: this.clock.nowIso() };
      if (!await tx.create(OPERATIONS, row)) throw new NativeAccountError('CONFLICT');
      return row;
    });
    if (prepared.state === 'committed') return accountResult(prepared.result);
    if (prepared.state !== 'pending') {
      await this.resumeCompensation(key, prepared);
      throw new NativeAccountError('SERVICE_UNAVAILABLE');
    }
    let receipt: NativeIdentityReceipt;
    try {
      receipt = await this.provider.provision({ mobile: input.mobile, displayName: input.displayName.trim() }, key);
      if (!/^sd1_[A-Za-z0-9_-]+$/.test(receipt.subjectDigest)
        || !receipt.platformUid
        || this.digest.digest(cloudbaseUsernameSubject(receipt.platformUid)) !== receipt.subjectDigest) {
        throw new NativeAccountError('SERVICE_UNAVAILABLE');
      }
    } catch (error) {
      // An uncertain provider response is reconciled with this exact operation key on retry.
      throw error instanceof NativeAccountError ? error : new NativeAccountError('SERVICE_UNAVAILABLE');
    }
    try {
      return await this.database.runTransaction(async tx => {
        await this.guard(tx, actor, input.role, input.classId);
        const operation = await this.readOperation(tx, key, fingerprint);
        if (!operation) throw new NativeAccountError('SERVICE_UNAVAILABLE');
        if (operation.state === 'committed') return accountResult(operation.result);
        if (operation.state !== 'pending') throw new NativeAccountError('CONFLICT');
        const identityId = `auth_native_${hash(receipt.subjectDigest)}`;
        const identities = await tx.find('auth_identities', { provider: 'cloudbase_uid',
          providerSubjectDigest: receipt.subjectDigest, deletedAt: null });
        if (identities.length) throw new NativeAccountError('CONFLICT');
        const id = `usr_native_${hash(key)}`;
        const name = input.displayName.trim() || '未命名用户';
        const now = this.clock.nowIso();
        const result: NativeAccountView = { id, displayName: name, role: input.role, status: 'active', version: 1, setupStatus: 'self_service_required' };
        const studentNumber = `N${hash(key).slice(0, 14).toUpperCase()}`;
        const documents: Array<readonly [string, VersionedDocument]> = [
          ['users', { ...base(actor.organizationId, id), displayName: name, displayNameMasked: maskName(name),
            mobileMasked: `${input.mobile.slice(0, 3)}****${input.mobile.slice(-4)}`,
            roles: [input.role], status: 'active', authorizationVersion: 1,
            ...(input.role === 'student' ? { studentNumber } : {}) }],
          ['auth_identities', { ...base(actor.organizationId, identityId), userId: id, provider: 'cloudbase_uid',
            providerSubjectDigest: receipt.subjectDigest, status: 'active', verifiedAt: now }],
          ['role_assignments', { ...base(actor.organizationId, `role_native_${hash(key)}`), userId: id,
            role: input.role, status: 'active', nativeAccountManaged: true,
            ...defaultRole(input.role, id), grantedAt: now, grantedBy: actor.actorUserId }],
        ];
        if (input.role === 'student') {
          const classroom = await tx.get('classes', input.classId);
          if (!visible(classroom, actor.organizationId) || classroom.status !== 'active') throw new NativeAccountError('FORBIDDEN');
          documents.push(['class_memberships', { ...base(actor.organizationId, `mem_native_${hash(key)}`),
            classId: input.classId, studentId: id, status: 'active', joinedAt: now }]);
          if (!await tx.replace('classes', classroom._id, classroom.version, { ...classroom, version: classroom.version + 1 })) throw new NativeAccountError('CONFLICT');
        }
        for (const [collection, document] of documents) {
          if (!await tx.create(collection, document)) throw new NativeAccountError('CONFLICT');
        }
        await this.audit(tx, actor, key, 'native_admin.user.created', id, input.reason);
        if (!await tx.replace(OPERATIONS, key, operation.version, { ...operation, state: 'committed',
          result: { ...result }, version: operation.version + 1 })) throw new NativeAccountError('CONFLICT');
        return result;
      });
    } catch (error) {
      // Claim compensation transactionally: a concurrent commit must win or lose this same row.
      const outcome = await this.database.runTransaction(async tx => {
        const operation = await this.readOperation(tx, key, fingerprint);
        if (!operation) throw new NativeAccountError('SERVICE_UNAVAILABLE');
        if (operation.state === 'committed') return operation;
        if (operation.state !== 'pending') return operation;
        const mappings = await tx.find('auth_identities', { provider: 'cloudbase_uid',
          providerSubjectDigest: receipt.subjectDigest, deletedAt: null });
        if (mappings.length) {
          const conflicted: AccountOperation = { ...operation, state: 'identity_conflict', version: operation.version + 1 };
          if (!await tx.replace(OPERATIONS, key, operation.version, conflicted)) throw new NativeAccountError('SERVICE_UNAVAILABLE');
          return conflicted;
        }
        const next: AccountOperation = { ...operation, state: 'compensating', account: { ...receipt }, version: operation.version + 1 };
        if (!await tx.replace(OPERATIONS, key, operation.version, next)) throw new NativeAccountError('SERVICE_UNAVAILABLE');
        return next;
      });
      if (outcome.state === 'committed') return accountResult(outcome.result);
      await this.resumeCompensation(key, outcome);
      throw error instanceof NativeAccountError ? error : new NativeAccountError('SERVICE_UNAVAILABLE');
    }
  }

  /** Legacy admin action is closed; the account holder uses P-03 phone verification. */
  public async requestPasswordReset(_actor: TrustedActorContext, _input: Readonly<{ userId: string; reason: string }>,
    _expectedVersion: number, _operationId: string): Promise<never> {
    throw new NativeAccountError('FORBIDDEN');
  }
  private async access(actor: TrustedActorContext, role: NativeAccountRole, classId: string) {
    const decision = await authorizeNativeAdmin(this.grants, actor, 'user.manage', classId || undefined);
    if (!decision.allowed || role !== 'student' && !decision.scope.organizationWide) throw new NativeAccountError('FORBIDDEN');
    if (role === 'admin' && !(await authorizeNativeAdmin(this.grants, actor, 'authorization.manage')).allowed) throw new NativeAccountError('FORBIDDEN');
  }
  private async guard(tx: DocumentDatabaseTransactionPort, actor: TrustedActorContext, role: NativeAccountRole, classId: string) {
    const user = await tx.get('users', actor.actorUserId);
    const grant = await tx.get('native_admin_grants', nativeAdminGrantId(actor.organizationId, actor.actorUserId));
    const scope = grant?.scope as { organizationWide?: boolean; classIds?: string[] } | undefined;
    if (!visible(user, actor.organizationId) || user.status !== 'active' || user.authorizationVersion !== actor.authzVersion
      || actor.actorRole !== 'teacher' || !visible(grant, actor.organizationId) || grant.status !== 'active'
      || !Array.isArray(grant.permissions) || !grant.permissions.includes('user.manage')
      || role === 'admin' && !grant.permissions.includes('authorization.manage')
      || !scope || role !== 'student' && !scope.organizationWide
      || classId && !scope.organizationWide && !scope.classIds?.includes(classId)) throw new NativeAccountError('FORBIDDEN');
    if (classId) {
      const classroom = await tx.get('classes', classId);
      if (!visible(classroom, actor.organizationId) || classroom.status !== 'active') throw new NativeAccountError('FORBIDDEN');
    }
  }
  private async readOperation(tx: Pick<DocumentDatabaseTransactionPort, 'get'>, key: string, fingerprint: string): Promise<AccountOperation | null> {
    const row = await tx.get(OPERATIONS, key);
    if (!row) return null;
    if (row.fingerprint !== fingerprint || typeof row.state !== 'string') throw new NativeAccountError('CONFLICT');
    return row as AccountOperation;
  }
  private async resumeCompensation(key: string, operation: AccountOperation): Promise<void> {
    if (operation.state !== 'compensating' || !this.provider) return;
    const accountValue = operation.account;
    if (!accountValue || typeof accountValue !== 'object' || Array.isArray(accountValue)) throw new NativeAccountError('SERVICE_UNAVAILABLE');
    const row = accountValue as Readonly<Record<string, unknown>>;
    if (typeof row.platformUid !== 'string' || typeof row.subjectDigest !== 'string') throw new NativeAccountError('SERVICE_UNAVAILABLE');
    const account = { platformUid: row.platformUid, subjectDigest: row.subjectDigest };
    try { await this.provider.blockUnlinked(account, key); } catch { throw new NativeAccountError('SERVICE_UNAVAILABLE'); }
    await this.database.runTransaction(async tx => {
      const row = await tx.get(OPERATIONS, key);
      if (row?.state !== 'compensating') return;
      if (!await tx.replace(OPERATIONS, key, row.version, { ...row, state: 'compensated', version: row.version + 1 })) throw new NativeAccountError('SERVICE_UNAVAILABLE');
    });
  }
  private async audit(tx: DocumentDatabaseTransactionPort, actor: TrustedActorContext, key: string,
    action: string, targetId: string, reason: string) {
    if (!await tx.append('operation_logs', { ...base(actor.organizationId, `audit_${hash(key)}`),
      actorUserId: actor.actorUserId, actorRole: 'teacher', requestId: actor.requestId, action,
      targetType: 'user', targetId, result: 'succeeded', errorCode: null, occurredAt: this.clock.nowIso(),
      metadata: { operationId: key, reason } })) throw new NativeAccountError('CONFLICT');
  }
}
function operationKey(actor: TrustedActorContext, operationId: string): string { return `row_${hash([actor.organizationId, actor.actorUserId, operationId], 64)}`; }
function hash(value: unknown, length = 40): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, length); }
function base(organizationId: string, id: string): VersionedDocument { return { _id: id, organizationId, schemaVersion: 1, version: 1, deletedAt: null }; }
function visible(row: VersionedDocument | null, organizationId: string): row is VersionedDocument { return row !== null && row.organizationId === organizationId && row.deletedAt === null; }
function validId(value: string): boolean { return /^[A-Za-z0-9_-]{1,128}$/.test(value); }
function validateOperation(id: string, reason: string): void { if (!/^[A-Za-z0-9_-]{8,128}$/.test(id) || !reason.trim() || reason.length > 200) throw new NativeAccountError('VALIDATION_ERROR'); }
function maskName(name: string): string { return name.length > 1 ? `${name[0]}**` : name; }
function defaultRole(role: NativeAccountRole, id: string) {
  const permissions = role === 'student' ? ['content.read', 'task.read']
    : role === 'parent' ? ['child.read', 'child.bind', 'child.unbind'] : role === 'teacher' ? ['class.read'] : [];
  // Teacher/class and management grants are deliberately separate subsequent actions.
  return role === 'teacher' ? { permissions, scopeType: 'classes', scopeIds: [] }
    : { permissions, scopeType: 'self', scopeIds: [id] };
}
function accountResult(value: unknown): NativeAccountView {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new NativeAccountError('SERVICE_UNAVAILABLE');
  const row = value as Readonly<Record<string, unknown>>;
  if (typeof row.id !== 'string' || typeof row.displayName !== 'string' || row.status !== 'active'
    || row.version !== 1 || row.setupStatus !== 'self_service_required' || typeof row.role !== 'string'
    || !['student', 'parent', 'teacher', 'admin'].includes(row.role)) throw new NativeAccountError('SERVICE_UNAVAILABLE');
  return { id: row.id, displayName: row.displayName, status: 'active', version: 1, setupStatus: 'self_service_required', role: row.role as NativeAccountRole };
}

