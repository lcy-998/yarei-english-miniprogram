import { createHash } from 'node:crypto';
import type { DocumentDatabasePort, DocumentDatabaseTransactionPort,
  VersionedDocument } from '../repositories/document-database-port';
import type { JsonValue } from '../shared/protocol';
import type { OperationLogRecord } from '../runtime/records';
import { NATIVE_ADMIN_PERMISSIONS, type NativeAdminGrant, type NativeAdminGrantReader,
  type NativeAdminPermission } from './authorization';
import { NativeAdminGrantError, type NativeAdminGrantTransaction,
  type NativeAdminGrantUnitOfWork, type NativeAdminGrantUser } from './grant-service';

export const NATIVE_ADMIN_COLLECTIONS = {
  grants: 'native_admin_grants', users: 'users', roles: 'role_assignments',
  classes: 'classes', operations: 'native_admin_operations', audit: 'operation_logs',
} as const;

export function nativeAdminGrantId(organizationId: string, teacherId: string): string {
  return `native_admin_${createHash('sha256').update(JSON.stringify([organizationId, teacherId]))
    .digest('hex').slice(0, 40)}`;
}

export class DocumentNativeAdminGrantRepository implements NativeAdminGrantReader, NativeAdminGrantUnitOfWork {
  public constructor(private readonly documents: DocumentDatabasePort) {}

  public async findGrant(organizationId: string, teacherId: string): Promise<NativeAdminGrant | null> {
    const document = await this.documents.get(NATIVE_ADMIN_COLLECTIONS.grants,
      nativeAdminGrantId(organizationId, teacherId));
    return decodeGrant(document, organizationId, teacherId);
  }

  public async currentAuthorizationVersion(organizationId: string, teacherId: string): Promise<number | null> {
    const user = await this.documents.get(NATIVE_ADMIN_COLLECTIONS.users, teacherId);
    return user?.organizationId === organizationId && user.deletedAt === null && user.status === 'active'
      && Number.isSafeInteger(user.authorizationVersion) && Number(user.authorizationVersion) >= 1
      ? Number(user.authorizationVersion) : null;
  }

  public transaction<T>(work: (transaction: NativeAdminGrantTransaction) => Promise<T>): Promise<T> {
    return this.documents.runTransaction(documents => work(new DocumentNativeAdminGrantTransaction(documents)));
  }
}

class DocumentNativeAdminGrantTransaction implements NativeAdminGrantTransaction {
  public constructor(private readonly documents: DocumentDatabaseTransactionPort) {}

  public async findUser(organizationId: string, userId: string): Promise<NativeAdminGrantUser | null> {
    const user = await this.documents.get(NATIVE_ADMIN_COLLECTIONS.users, userId);
    if (!user || user.organizationId !== organizationId || user.deletedAt !== null
      || (user.status !== 'active' && user.status !== 'disabled')
      || !Number.isSafeInteger(user.authorizationVersion)) return null;
    return { id: userId, organizationId, status: user.status,
      authorizationVersion: Number(user.authorizationVersion), version: user.version };
  }

  public async hasActiveTeacherRole(organizationId: string, userId: string): Promise<boolean> {
    const rows = await this.documents.find(NATIVE_ADMIN_COLLECTIONS.roles, {
      organizationId, userId, role: 'teacher', status: 'active', deletedAt: null });
    return rows.length === 1;
  }

  public async classIsActive(organizationId: string, classId: string): Promise<boolean> {
    const row = await this.documents.get(NATIVE_ADMIN_COLLECTIONS.classes, classId);
    return row?.organizationId === organizationId && row.deletedAt === null && row.status === 'active';
  }

  public async findGrant(organizationId: string, teacherId: string): Promise<NativeAdminGrant | null> {
    return decodeGrant(await this.documents.get(NATIVE_ADMIN_COLLECTIONS.grants,
      nativeAdminGrantId(organizationId, teacherId)), organizationId, teacherId);
  }

  public async saveGrant(grant: NativeAdminGrant, expectedVersion: number): Promise<boolean> {
    const document: VersionedDocument = { _id: nativeAdminGrantId(grant.organizationId, grant.teacherId),
      organizationId: grant.organizationId, schemaVersion: 1, version: grant.version,
      deletedAt: null, teacherId: grant.teacherId, status: grant.status,
      permissions: [...grant.permissions], scope: { organizationWide: grant.scope.organizationWide,
        classIds: [...grant.scope.classIds] } };
    return expectedVersion === 0
      ? this.documents.create(NATIVE_ADMIN_COLLECTIONS.grants, document)
      : this.documents.replace(NATIVE_ADMIN_COLLECTIONS.grants, document._id, expectedVersion, document);
  }

  public async bumpUserAuthorization(user: NativeAdminGrantUser): Promise<boolean> {
    const current = await this.documents.get(NATIVE_ADMIN_COLLECTIONS.users, user.id);
    if (!current || current.organizationId !== user.organizationId || current.status !== 'active'
      || current.version !== user.version || current.authorizationVersion !== user.authorizationVersion) return false;
    return this.documents.replace(NATIVE_ADMIN_COLLECTIONS.users, user.id, user.version,
      { ...current, version: user.version + 1,
        authorizationVersion: user.authorizationVersion + 1 });
  }

  public async findReceipt(organizationId: string, actorId: string, operationId: string): Promise<Readonly<{
    fingerprint: string; result: NativeAdminGrant;
  }> | null> {
    const row = await this.documents.get(NATIVE_ADMIN_COLLECTIONS.operations,
      operationDocumentId(organizationId, actorId, operationId));
    if (!row || row.organizationId !== organizationId || row.deletedAt !== null
      || row.actorId !== actorId || row.operationId !== operationId
      || typeof row.fingerprint !== 'string' || !isRecord(row.result)
      || typeof row.result.teacherId !== 'string') return null;
    const result = decodeGrant({ _id: nativeAdminGrantId(organizationId, row.result.teacherId),
      organizationId, schemaVersion: 1, deletedAt: null,
      ...row.result } as VersionedDocument, organizationId, row.result.teacherId);
    return result ? { fingerprint: row.fingerprint, result } : null;
  }

  public async saveReceipt(organizationId: string, actorId: string, operationId: string,
    fingerprint: string, result: NativeAdminGrant): Promise<boolean> {
    return this.documents.create(NATIVE_ADMIN_COLLECTIONS.operations, {
      _id: operationDocumentId(organizationId, actorId, operationId), organizationId,
      schemaVersion: 1, version: 1, deletedAt: null, actorId, operationId,
      fingerprint, result: JSON.parse(JSON.stringify(result)) as JsonValue });
  }

  public async appendAudit(entry: OperationLogRecord): Promise<void> {
    const created = await this.documents.append(NATIVE_ADMIN_COLLECTIONS.audit, {
      _id: entry.id, organizationId: entry.organizationId, schemaVersion: 1,
      version: 1, deletedAt: null, requestId: entry.requestId,
      actorUserId: entry.actorUserId, actorRole: entry.actorRole,
      action: entry.action, targetType: entry.targetType, targetId: entry.targetId,
      result: entry.result, errorCode: entry.errorCode, occurredAt: entry.occurredAt,
      metadata: JSON.parse(JSON.stringify(entry.metadata)) as JsonValue });
    if (!created) throw new NativeAdminGrantError('CONFLICT');
  }
}

function operationDocumentId(organizationId: string, actorId: string, operationId: string): string {
  return `native_admin_op_${createHash('sha256').update(JSON.stringify([organizationId, actorId, operationId]))
    .digest('hex').slice(0, 40)}`;
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function decodeGrant(document: VersionedDocument | null, organizationId: string,
  teacherId: string): NativeAdminGrant | null {
  if (!document || document.organizationId !== organizationId || document.deletedAt !== null
    || document.teacherId !== teacherId || document._id !== nativeAdminGrantId(organizationId, teacherId)
    || (document.status !== 'active' && document.status !== 'revoked')
    || !Number.isSafeInteger(document.version) || document.version < 1
    || !Array.isArray(document.permissions) || !document.permissions.every(permission =>
      typeof permission === 'string' && NATIVE_ADMIN_PERMISSIONS.includes(permission as NativeAdminPermission))
    || !isScope(document.scope)) return null;
  return { organizationId, teacherId, status: document.status,
    permissions: [...document.permissions] as NativeAdminPermission[],
    scope: { organizationWide: document.scope.organizationWide,
      classIds: [...document.scope.classIds] }, version: document.version };
}

function isScope(value: unknown): value is { organizationWide: boolean; classIds: string[] } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const scope = value as Record<string, unknown>;
  return typeof scope.organizationWide === 'boolean' && Array.isArray(scope.classIds)
    && scope.classIds.every(item => typeof item === 'string' && item.length > 0)
    && new Set(scope.classIds).size === scope.classIds.length;
}
