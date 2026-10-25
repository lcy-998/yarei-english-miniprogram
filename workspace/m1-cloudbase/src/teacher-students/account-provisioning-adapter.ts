import type { NativeAccountProvider } from '../native-admin/account-service';
import type { TeacherStudentImportCommandPlanRow } from './bulk-csv';
import type { TeacherStudentAuthProvisioningPort } from './bulk-import-document-port';

/** Reuses the protected account provider installed for authorized account creation. */
export class TeacherStudentAccountProvisioningAdapter implements TeacherStudentAuthProvisioningPort {
  public constructor(private readonly provider: NativeAccountProvider) {}

  public mobileExists(mobile: string, rowOperationId: string): Promise<boolean> {
    return this.provider.mobileExists(mobile, rowOperationId);
  }

  public createExternalStudent(row: TeacherStudentImportCommandPlanRow,
    rowOperationId: string): ReturnType<NativeAccountProvider['provision']> {
    return this.provider.provision({ mobile: row.mobile, displayName: row.displayName }, rowOperationId);
  }

  public blockUnlinkedAccount(account: Parameters<NativeAccountProvider['blockUnlinked']>[0],
    rowOperationId: string): Promise<void> {
    return this.provider.blockUnlinked(account, rowOperationId);
  }
}
