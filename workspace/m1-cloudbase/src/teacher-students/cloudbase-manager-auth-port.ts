import { createHash } from 'node:crypto';
import { cloudbaseUsernameSubject } from '../auth/trusted-actor';
import type { SubjectDigestPort } from '../runtime/ports';
import type { TeacherStudentImportCommandPlanRow } from './bulk-csv';
import type { BulkImportAccountReceipt } from './bulk-import-command';
import type { TeacherStudentAuthProvisioningPort } from './bulk-import-document-port';

interface ManagedUser {
  readonly Uid: string;
  readonly Name: string;
  readonly Type: string;
  readonly Phone: string;
  readonly UserStatus: 'ACTIVE' | 'BLOCKED';
}

/** Structural surface of the CloudBase Management SDK 5.x user module. Credentials are supplied elsewhere. */
export interface CloudBaseManagerUserPort {
  describeUserList(options: Readonly<{ uidList?: readonly string[]; phone?: string;
    pageNo?: number; pageSize?: number }>): Promise<Readonly<{ Data: Readonly<{
      Total: number; UserList: readonly ManagedUser[];
    }> }>>;
  createUser(options: Readonly<{ uid: string; name: string; phone: string;
    type: 'externalUser'; userStatus: 'ACTIVE' }>): Promise<Readonly<{
      Data: Readonly<{ Uid: string }>;
    }>>;
  modifyUser(options: Readonly<{ uid: string; userStatus: 'BLOCKED' }>): Promise<Readonly<{
    Data: Readonly<{ Success: boolean }>;
  }>>;
}

/**
 * Server-only candidate. A trusted runtime must supply a scoped manager client and the
 * same subject-digest boundary used by login; this file neither loads nor logs secrets.
 */
export class CloudBaseManagerStudentAuthPort implements TeacherStudentAuthProvisioningPort {
  public constructor(private readonly manager: CloudBaseManagerUserPort,
    private readonly subjectDigest: SubjectDigestPort) {}

  public async mobileExists(mobile: string, rowOperationId: string): Promise<boolean> {
    const expectedUid = managedUid(rowOperationId);
    const result = await this.manager.describeUserList({ phone: mobile, pageNo: 1, pageSize: 100 });
    const users = result.Data.UserList;
    if (!Number.isSafeInteger(result.Data.Total) || result.Data.Total < users.length
      || result.Data.Total > users.length) throw new Error('AUTH_LOOKUP_INCOMPLETE');
    return users.some(user => user.Phone === mobile && user.Uid !== expectedUid);
  }

  public async createExternalStudent(row: TeacherStudentImportCommandPlanRow,
    rowOperationId: string): Promise<BulkImportAccountReceipt> {
    const uid = managedUid(rowOperationId);
    // A retry after a lost create response must reconcile before issuing another create.
    const existing = await this.findByUid(uid);
    if (existing !== null) return this.receiptFor(existing, row.mobile, uid);
    try {
      const created = await this.manager.createUser({ uid, name: uid, phone: row.mobile,
        type: 'externalUser', userStatus: 'ACTIVE' });
      if (created.Data.Uid !== uid) throw new Error('AUTH_UID_MISMATCH');
      return { platformUid: uid, subjectDigest: this.subjectDigest.digest(cloudbaseUsernameSubject(uid)) };
    } catch (_error: unknown) {
      // Reconcile the deterministic UID after a lost provider response. Never create a second account.
      const reconciled = await this.findByUid(uid);
      if (reconciled === null) throw new Error('AUTH_CREATE_UNCERTAIN');
      return this.receiptFor(reconciled, row.mobile, uid);
    }
  }

  public async blockUnlinkedAccount(account: BulkImportAccountReceipt,
    rowOperationId: string): Promise<void> {
    const uid = managedUid(rowOperationId);
    if (account.platformUid !== uid || account.subjectDigest !== this.subjectDigest.digest(cloudbaseUsernameSubject(uid))) {
      throw new Error('AUTH_ACCOUNT_MISMATCH');
    }
    const current = await this.findByUid(uid);
    if (current === null) return;
    if (current.Name !== uid || current.Type !== 'externalUser') throw new Error('AUTH_ACCOUNT_MISMATCH');
    if (current.UserStatus === 'BLOCKED') return;
    const result = await this.manager.modifyUser({ uid, userStatus: 'BLOCKED' });
    if (!result.Data.Success) throw new Error('AUTH_BLOCK_FAILED');
  }

  private async findByUid(uid: string): Promise<ManagedUser | null> {
    const result = await this.manager.describeUserList({ uidList: [uid], pageNo: 1, pageSize: 1 });
    const matched = result.Data.UserList.filter(user => user.Uid === uid);
    if (result.Data.Total > 1 || matched.length > 1) throw new Error('AUTH_UID_CONFLICT');
    return matched[0] ?? null;
  }

  private receiptFor(user: ManagedUser, mobile: string, uid: string): BulkImportAccountReceipt {
    if (user.Uid !== uid || user.Name !== uid || user.Type !== 'externalUser'
      || user.Phone !== mobile || user.UserStatus !== 'ACTIVE') throw new Error('AUTH_ACCOUNT_CONFLICT');
    return { platformUid: uid, subjectDigest: this.subjectDigest.digest(cloudbaseUsernameSubject(uid)) };
  }
}

function managedUid(rowOperationId: string): string {
  if (!/^row_[a-f0-9]{64}$/.test(rowOperationId)) throw new Error('AUTH_OPERATION_INVALID');
  return `imp_${createHash('sha256').update(rowOperationId).digest('hex').slice(0, 40)}`;
}
