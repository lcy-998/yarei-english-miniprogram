import type { SubjectDigestPort } from '../runtime/ports';
import { CloudBaseManagerStudentAuthPort, type CloudBaseManagerUserPort } from '../teacher-students/cloudbase-manager-auth-port';
import type { NativeAccountProvider, NativeIdentityReceipt } from './account-service';

/** Creates the phone identity only. The account holder sets a password through P-03 verification. */
export class CloudBaseNativeAccountProvider implements NativeAccountProvider {
  private readonly accounts: CloudBaseManagerStudentAuthPort;
  constructor(manager: CloudBaseManagerUserPort, digest: SubjectDigestPort) {
    this.accounts = new CloudBaseManagerStudentAuthPort(manager, digest);
  }
  mobileExists(mobile: string, operationKey: string): Promise<boolean> {
    return this.accounts.mobileExists(mobile, operationKey);
  }
  async provision(input: Readonly<{ mobile: string; displayName: string }>, operationKey: string): Promise<NativeIdentityReceipt> {
    // The reused adapter only reads mobile and operationKey; role is assigned in the business transaction.
    return this.accounts.createExternalStudent({ ...input,
      sourceLineNumber: 1, classId: '', studentNumber: '' }, operationKey);
  }
  blockUnlinked(receipt: NativeIdentityReceipt, operationKey: string): Promise<void> {
    return this.accounts.blockUnlinkedAccount(receipt, operationKey);
  }
}
